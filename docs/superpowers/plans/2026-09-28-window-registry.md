# Window Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a generic, event-driven `WindowManager` in `lib/window-manager.js` that is the single authority over window visibility, position, mouse-passthrough state, group membership, LIFO activity ordering, and position persistence — then wire it into `main.js` to fix the tooltip-persists-on-hide bug and lay the foundation for the radial sub-agent layout.

**Architecture:** Each registered window carries unified state (`visible`, `autoShow`, `showInactive`, `ignoreMouseEvents`, `isDraggable`, `linkedTo`, `group`, `lastActivity`, `activity`, `zOrder`, bounds). The manager owns the 50ms cursor-tracking polling loop and a static layout template (strategy object) that computes sub-window positions automatically on register/unregister/reorder/resize. Position persistence is delegated to a `ConfigManager` instance injected at construction — the manager calls `cfgMgr.saveWindowState()` on drag-stop and snap, and reads initial position from `cfgMgr.getWindowState()` on register. Callers register windows with factory-produced state, then emit events (`hide-all`, `show-all`, `drag-start`, `drag-stop`, `snap`, `layout-changed`) or call `updateState(key, patch)` for targeted mutations; the manager applies all Electron calls idempotently. Linked windows cascade hide/show in one internal pass with cycle detection (Postgres CASCADE semantics). Groups are a tag on state; `entriesByGroup(group)` and `rankGroup(group)` provide typed iteration and LIFO ordering. `rankGroup` is a pure sort with no side effects — caller reads the returned order and applies visibility and `reorder()` explicitly. `gcGroup(group, { idleCutoff })` removes stale entries and returns removed keys for caller cleanup. `main.js` keeps `win`, `tooltipWin`, and `subAgentWindows` as typed references for IPC; the manager is an orthogonal state+position layer.

**Prerequisites:** `docs/superpowers/plans/2026-09-28-config-manager.md` must be complete and merged first — `ConfigManager` is a constructor dependency.

**Tech Stack:** Node.js (CommonJS `'use strict'`), Node.js `EventEmitter`, Electron `BrowserWindow`, `lib/config-manager.js` (existing after config-manager plan), Jest 30 (node environment)

**Spec:** `docs/superpowers/specs/2026-09-25-radial-subagent-pets-design.md`

## Global Constraints

- CommonJS (`'use strict'`; `module.exports`), no ESM — matches every file in `lib/`
- Jest test environment: `node` — no DOM, no Electron APIs in tests
- Tests live in `tests/` and match `**/tests/**/*.test.js`
- No new npm dependencies (use built-in `EventEmitter`)
- The manager is a pure state machine — type-agnostic, no strings like `'tooltip'`, `'pet'`, `'subagent'` in `lib/window-manager.js`; those are caller concerns expressed through state fields
- `rankGroup` is a pure sort with zero side effects — it returns a sorted key array, applies nothing
- `gcGroup` returns removed keys — caller is responsible for cleaning up any parallel data structures (e.g. `subAgentWindows`, `subAgentCreatedAt`)
- The manager never creates or destroys `BrowserWindow` instances
- Caller hooks on the polling loop are stubs now (YAGNI)
- `applyConfigHotReload` in `main.js` continues iterating `subAgentWindows` directly — known future migration point for the radial plan, not touched by this plan

## WindowState shape

```js
{
  // Visibility
  visible:      boolean,  // current actual state
  autoShow:     boolean,  // included in show-all broadcast
  showInactive: boolean,  // use showInactive() instead of show() on visibility true transition

  // Mouse / drag
  ignoreMouseEvents: boolean, // current actual state
  isDraggable:       boolean, // manager moves this window on drag events

  // Position / size (manager-owned; kept in sync via updateState)
  x: number, y: number, width: number, height: number,

  // Grouping and ordering
  group:        string | null,  // opaque tag; null = ungrouped
  lastActivity: number,         // ms timestamp; set by caller on any event; drives rankGroup
  activity:     string,         // opaque string ('reacting'|'active'|'sleeping' etc); stored, not interpreted

  // Relationships
  linkedTo: string | null,  // key of parent; hide/show cascades from parent inline
  zOrder:   number,         // informational; manager does not enforce today

  // Drag (transient; manager-internal but readable via getState)
  _dragOffsetX: number,
  _dragOffsetY: number,
}
```

## Polling loop design

One `setInterval` at 50ms owned by the manager. Starts when the first window is registered; stops when the last is unregistered. Each tick reads `screen.getCursorScreenPoint()` once, then for each registered window applies drag movement or hover enter/leave based on state flags. Caller stubs `onBeforeTick` / `onAfterTick` exist but do nothing.

## Manager API summary

| Method | Pure? | Description |
|---|---|---|
| `register(key, win, state)` | — | Add window; start loop if not running |
| `unregister(key)` | — | Remove window; stop loop if empty |
| `getState(key)` | read | Shallow copy of state, or `null` |
| `updateState(key, patch)` | side-effect | Merge patch → apply Electron calls (visibility, bounds, mouse) |
| `reorder(keys)` | side-effect | Move named keys to front; unlisted keep relative order |
| `entries()` | read | `IterableIterator<[key, {win, state}]>` in current order |
| `entriesByGroup(group)` | read | Filtered `entries()` for one group |
| `rankGroup(group)` | **pure** | Sort group by `lastActivity` desc → return `string[]` of keys; no side effects |
| `gcGroup(group, { idleCutoff })` | side-effect | Unregister entries with `lastActivity < idleCutoff`; return removed key array |
| emit `'hide-all'` | side-effect | Cascade hide from root windows (linkedTo null) downward; cycle-safe |
| emit `'show-all'` | side-effect | Cascade show from root windows downward; respects `autoShow` |
| emit `'drag-start' key` | side-effect | Begin drag for `isDraggable` window; enable mouse events |
| emit `'drag-stop' key` | side-effect | End drag; restore mouse passthrough; emit `'drag-ended'` |

## Review Focus

- `show-all` must not show a window with `autoShow: false` — tooltip is cursor+size-driven. Test: register with `autoShow: false`, emit `show-all`, assert `.show()` never called.
- Circular `linkedTo` must not hang — A→B→A cycle. Test: two windows each `linkedTo` the other; emit `hide-all`; assert no hang and both hidden.
- `rankGroup` must have zero side effects — calling it must not change iteration order or visibility. Test: call `rankGroup` then assert `[...entries()]` order is unchanged.
- `gcGroup` returns removed keys — caller must be able to clean up parallel maps. Test: register two entries in a group, advance one past cutoff, call `gcGroup`, assert return value contains exactly the stale key and manager no longer has it.
- `updateState` on unknown key is a no-op — subagent stop events arrive after window unregistration. Test: call `updateState('ghost', { visible: false })` on fresh manager; no throw.

---

## Task 1: `lib/window-manager.js` — core manager and factories

**Files:**
- Create: `lib/window-manager.js`
- Create: `tests/window-manager.test.js`

**Interfaces:**
- Produces: `WindowManager`, `createMainWindowState`, `createTooltipWindowState`, `createSubAgentWindowState` (see shapes below)

### Factory function signatures

```js
// x, y, width, height: initial bounds from createWindow()
createMainWindowState(x, y, width, height)
// Returns:
{
  visible: true, autoShow: true, showInactive: false,
  ignoreMouseEvents: true, isDraggable: true,
  x, y, width, height,
  group: null, lastActivity: 0, activity: 'active',
  linkedTo: null, zOrder: 1,
  _dragOffsetX: 0, _dragOffsetY: 0,
}

// parentKey: the key used to register the main window (caller-supplied, e.g. 'main')
createTooltipWindowState(parentKey)
// Returns:
{
  visible: false, autoShow: false, showInactive: true,
  ignoreMouseEvents: true, isDraggable: false,
  x: 0, y: 0, width: 10, height: 10,
  group: null, lastActivity: 0, activity: 'active',
  linkedTo: parentKey, zOrder: 2,
  _dragOffsetX: 0, _dragOffsetY: 0,
}

// parentKey: key of main window; group: caller-defined group tag e.g. 'subagent-pet'
// x, y, width, height: initial position
createSubAgentWindowState(parentKey, group, x, y, width, height)
// Returns:
{
  visible: true, autoShow: true, showInactive: false,
  ignoreMouseEvents: true, isDraggable: false,
  x, y, width, height,
  group, lastActivity: Date.now(), activity: 'active',
  linkedTo: parentKey, zOrder: 1,
  _dragOffsetX: 0, _dragOffsetY: 0,
}
```

- [ ] **Step 1: Write failing tests**

```js
// tests/window-manager.test.js
'use strict';

const { WindowManager, createMainWindowState, createTooltipWindowState, createSubAgentWindowState } = require('../lib/window-manager');

function makeWin(opts = {}) {
  const { destroyed = false, x = 0, y = 0, w = 100, h = 100 } = opts;
  return {
    _shown: true, _ignoring: true,
    _x: x, _y: y, _w: w, _h: h,
    _showCount: 0, _hideCount: 0, _showInactiveCount: 0, _ignoreCallCount: 0,
    isDestroyed: () => destroyed,
    show()                      { this._showCount++; this._shown = true; },
    hide()                      { this._hideCount++; this._shown = false; },
    showInactive()              { this._showInactiveCount++; this._shown = true; },
    setIgnoreMouseEvents(v)     { this._ignoreCallCount++; this._ignoring = v; },
    getPosition()               { return [this._x, this._y]; },
    getSize()                   { return [this._w, this._h]; },
    setPosition(x, y)           { this._x = x; this._y = y; },
    setBounds({ x, y, width: w, height: h }) { this._x = x; this._y = y; this._w = w; this._h = h; },
  };
}

function makeScreen(cursor = { x: 0, y: 0 }) {
  return { getCursorScreenPoint: () => ({ ...cursor }) };
}

// ─── factories ────────────────────────────────────────────────────────────────

describe('createMainWindowState', () => {
  test('visible, autoShow, isDraggable true; linkedTo null; group null', () => {
    const s = createMainWindowState(10, 20, 200, 200);
    expect(s.visible).toBe(true);
    expect(s.autoShow).toBe(true);
    expect(s.isDraggable).toBe(true);
    expect(s.linkedTo).toBeNull();
    expect(s.group).toBeNull();
    expect(s.x).toBe(10);
    expect(s.y).toBe(20);
  });
});

describe('createTooltipWindowState', () => {
  test('autoShow false; showInactive true; isDraggable false; linkedTo parentKey', () => {
    const s = createTooltipWindowState('main');
    expect(s.autoShow).toBe(false);
    expect(s.showInactive).toBe(true);
    expect(s.isDraggable).toBe(false);
    expect(s.linkedTo).toBe('main');
    expect(s.group).toBeNull();
  });
});

describe('createSubAgentWindowState', () => {
  test('autoShow true; isDraggable false; linkedTo parentKey; group set', () => {
    const s = createSubAgentWindowState('main', 'subagent-pet', 50, 60, 100, 100);
    expect(s.autoShow).toBe(true);
    expect(s.isDraggable).toBe(false);
    expect(s.linkedTo).toBe('main');
    expect(s.group).toBe('subagent-pet');
    expect(s.x).toBe(50);
    expect(s.y).toBe(60);
  });

  test('lastActivity is set to a recent timestamp', () => {
    const before = Date.now();
    const s = createSubAgentWindowState('main', 'subagent-pet', 0, 0, 100, 100);
    expect(s.lastActivity).toBeGreaterThanOrEqual(before);
  });
});

// ─── register / unregister / entries ─────────────────────────────────────────

describe('register / entries', () => {
  test('registered window appears in entries', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const w = makeWin();
    wm.register('main', w, createMainWindowState(0, 0, 100, 100));
    const e = [...wm.entries()];
    expect(e.length).toBe(1);
    expect(e[0][0]).toBe('main');
    expect(e[0][1].win).toBe(w);
  });

  test('registering same key twice overwrites', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    wm.register('main', makeWin(), createMainWindowState(0, 0, 100, 100));
    const w2 = makeWin();
    wm.register('main', w2, createMainWindowState(0, 0, 100, 100));
    expect([...wm.entries()].length).toBe(1);
    expect([...wm.entries()][0][1].win).toBe(w2);
  });
});

describe('unregister', () => {
  test('removes the entry', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    wm.register('main', makeWin(), createMainWindowState(0, 0, 100, 100));
    wm.unregister('main');
    expect([...wm.entries()].length).toBe(0);
  });

  test('unknown key is a no-op', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    expect(() => wm.unregister('ghost')).not.toThrow();
  });
});

// ─── getState / updateState ───────────────────────────────────────────────────

describe('getState', () => {
  test('returns shallow copy', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    wm.register('main', makeWin(), createMainWindowState(5, 10, 200, 200));
    const s = wm.getState('main');
    expect(s.x).toBe(5);
    expect(s.visible).toBe(true);
  });

  test('returns null for unknown key', () => {
    expect(new WindowManager({ screen: makeScreen() }).getState('ghost')).toBeNull();
  });

  test('returned copy does not mutate internal state', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    wm.register('main', makeWin(), createMainWindowState(0, 0, 100, 100));
    wm.getState('main').visible = false;
    expect(wm.getState('main').visible).toBe(true);
  });
});

describe('updateState', () => {
  test('visible false → calls hide()', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const w = makeWin();
    wm.register('main', w, createMainWindowState(0, 0, 100, 100));
    wm.updateState('main', { visible: false });
    expect(w._hideCount).toBe(1);
    expect(wm.getState('main').visible).toBe(false);
  });

  test('visible true with showInactive → calls showInactive() not show()', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const w = makeWin(); w._shown = false;
    const s = createTooltipWindowState('main'); s.visible = false;
    wm.register('tooltip', w, s);
    wm.updateState('tooltip', { visible: true });
    expect(w._showInactiveCount).toBe(1);
    expect(w._showCount).toBe(0);
  });

  test('bounds patch applies setBounds', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const w = makeWin();
    wm.register('main', w, createMainWindowState(0, 0, 100, 100));
    wm.updateState('main', { x: 50, y: 60, width: 200, height: 150 });
    expect(w._x).toBe(50); expect(w._y).toBe(60);
    expect(w._w).toBe(200); expect(w._h).toBe(150);
  });

  test('same-state visibility is idempotent — no Electron call', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const w = makeWin();
    wm.register('main', w, createMainWindowState(0, 0, 100, 100)); // visible: true
    wm.updateState('main', { visible: true });
    expect(w._showCount).toBe(0);
    expect(w._hideCount).toBe(0);
  });

  test('unknown key is a no-op', () => {
    expect(() => new WindowManager({ screen: makeScreen() }).updateState('ghost', { visible: false })).not.toThrow();
  });

  test('lastActivity and activity are stored', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    wm.register('main', makeWin(), createMainWindowState(0, 0, 100, 100));
    wm.updateState('main', { lastActivity: 12345, activity: 'sleeping' });
    const s = wm.getState('main');
    expect(s.lastActivity).toBe(12345);
    expect(s.activity).toBe('sleeping');
  });
});

// ─── reorder ─────────────────────────────────────────────────────────────────

describe('reorder', () => {
  test('moves named keys to front in given order', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    ['a','b','c'].forEach(k => wm.register(k, makeWin(), createMainWindowState(0,0,100,100)));
    wm.reorder(['c', 'a']);
    expect([...wm.entries()].map(([k]) => k)).toEqual(['c', 'a', 'b']);
  });

  test('partial reorder preserves all windows', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    wm.register('main',    makeWin(), createMainWindowState(0,0,100,100));
    wm.register('tooltip', makeWin(), createTooltipWindowState('main'));
    wm.register('sub1',    makeWin(), createSubAgentWindowState('main','subagent-pet',0,0,50,50));
    wm.reorder(['sub1']);
    const keys = [...wm.entries()].map(([k]) => k);
    expect(keys).toContain('main');
    expect(keys).toContain('tooltip');
    expect(keys.length).toBe(3);
  });
});

// ─── entriesByGroup ───────────────────────────────────────────────────────────

describe('entriesByGroup', () => {
  test('returns only entries matching group', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    wm.register('main',    makeWin(), createMainWindowState(0,0,100,100));           // group: null
    wm.register('tooltip', makeWin(), createTooltipWindowState('main'));             // group: null
    wm.register('sub1',    makeWin(), createSubAgentWindowState('main','subagent-pet',0,0,50,50));
    wm.register('sub2',    makeWin(), createSubAgentWindowState('main','subagent-pet',0,0,50,50));
    const keys = [...wm.entriesByGroup('subagent-pet')].map(([k]) => k);
    expect(keys).toEqual(['sub1', 'sub2']);
  });

  test('returns empty iterator for unknown group', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    wm.register('main', makeWin(), createMainWindowState(0,0,100,100));
    expect([...wm.entriesByGroup('nope')].length).toBe(0);
  });
});

// ─── rankGroup ────────────────────────────────────────────────────────────────

describe('rankGroup', () => {
  test('returns keys sorted by lastActivity descending (LIFO)', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const s1 = createSubAgentWindowState('main','g',0,0,50,50); s1.lastActivity = 1000;
    const s2 = createSubAgentWindowState('main','g',0,0,50,50); s2.lastActivity = 3000;
    const s3 = createSubAgentWindowState('main','g',0,0,50,50); s3.lastActivity = 2000;
    wm.register('a', makeWin(), s1);
    wm.register('b', makeWin(), s2);
    wm.register('c', makeWin(), s3);
    expect(wm.rankGroup('g')).toEqual(['b', 'c', 'a']);
  });

  test('is pure — does not change iteration order', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const s1 = createSubAgentWindowState('main','g',0,0,50,50); s1.lastActivity = 1000;
    const s2 = createSubAgentWindowState('main','g',0,0,50,50); s2.lastActivity = 3000;
    wm.register('a', makeWin(), s1);
    wm.register('b', makeWin(), s2);
    const orderBefore = [...wm.entries()].map(([k]) => k);
    wm.rankGroup('g');
    const orderAfter = [...wm.entries()].map(([k]) => k);
    expect(orderAfter).toEqual(orderBefore);
  });

  test('is pure — does not change visibility', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const s1 = createSubAgentWindowState('main','g',0,0,50,50); s1.lastActivity = 1000; s1.visible = false;
    const s2 = createSubAgentWindowState('main','g',0,0,50,50); s2.lastActivity = 3000; s2.visible = true;
    const w1 = makeWin(); w1._shown = false;
    wm.register('a', w1, s1);
    wm.register('b', makeWin(), s2);
    wm.rankGroup('g');
    expect(w1._shown).toBe(false); // untouched
    expect(wm.getState('a').visible).toBe(false);
  });

  test('returns empty array for unknown group', () => {
    expect(new WindowManager({ screen: makeScreen() }).rankGroup('nope')).toEqual([]);
  });
});

// ─── gcGroup ─────────────────────────────────────────────────────────────────

describe('gcGroup', () => {
  test('removes entries with lastActivity below cutoff and returns their keys', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const s1 = createSubAgentWindowState('main','g',0,0,50,50); s1.lastActivity = 1000;
    const s2 = createSubAgentWindowState('main','g',0,0,50,50); s2.lastActivity = 5000;
    wm.register('stale', makeWin(), s1);
    wm.register('fresh', makeWin(), s2);
    const removed = wm.gcGroup('g', { idleCutoff: 3000 });
    expect(removed).toEqual(['stale']);
    expect(wm.getState('stale')).toBeNull();
    expect(wm.getState('fresh')).not.toBeNull();
  });

  test('returns empty array when nothing is stale', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const s = createSubAgentWindowState('main','g',0,0,50,50); s.lastActivity = 9000;
    wm.register('fresh', makeWin(), s);
    expect(wm.gcGroup('g', { idleCutoff: 3000 })).toEqual([]);
  });

  test('only removes entries in the named group', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const sm = createMainWindowState(0,0,100,100); sm.lastActivity = 0;
    wm.register('main', makeWin(), sm);                                              // group: null
    const ss = createSubAgentWindowState('main','g',0,0,50,50); ss.lastActivity = 0;
    wm.register('sub', makeWin(), ss);
    wm.gcGroup('g', { idleCutoff: 9999 });
    expect(wm.getState('main')).not.toBeNull();  // ungrouped; untouched
  });
});

// ─── hide-all / show-all with cascade ────────────────────────────────────────

describe('hide-all event', () => {
  test('hides all registered windows', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const w1 = makeWin(), w2 = makeWin();
    wm.register('main', w1, createMainWindowState(0,0,100,100));
    wm.register('sub',  w2, createSubAgentWindowState('main','g',0,0,50,50));
    wm.emit('hide-all');
    expect(w1._shown).toBe(false);
    expect(w2._shown).toBe(false);
  });

  test('cascades to linkedTo children', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const main = makeWin(), tooltip = makeWin();
    wm.register('main',    main,    createMainWindowState(0,0,100,100));
    wm.register('tooltip', tooltip, createTooltipWindowState('main'));
    wm.emit('hide-all');
    expect(tooltip._shown).toBe(false);
  });

  test('is idempotent', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const w = makeWin();
    wm.register('main', w, createMainWindowState(0,0,100,100));
    wm.emit('hide-all');
    wm.emit('hide-all');
    expect(w._hideCount).toBe(1);
  });

  test('circular linkedTo does not hang', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const sa = createMainWindowState(0,0,100,100); sa.linkedTo = 'b';
    const sb = createMainWindowState(0,0,100,100); sb.linkedTo = 'a';
    wm.register('a', makeWin(), sa);
    wm.register('b', makeWin(), sb);
    expect(() => wm.emit('hide-all')).not.toThrow();
  });

  test('skips destroyed windows', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    wm.register('dead', makeWin({ destroyed: true }), createMainWindowState(0,0,100,100));
    expect(() => wm.emit('hide-all')).not.toThrow();
  });
});

describe('show-all event', () => {
  test('shows autoShow windows', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const w = makeWin(); w._shown = false;
    const s = createMainWindowState(0,0,100,100); s.visible = false;
    wm.register('main', w, s);
    wm.emit('show-all');
    expect(w._shown).toBe(true);
  });

  test('does not show autoShow: false windows', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const w = makeWin(); w._shown = false;
    const s = createTooltipWindowState('main'); s.visible = false;
    wm.register('tooltip', w, s);
    wm.emit('show-all');
    expect(w._shown).toBe(false);
  });

  test('is idempotent', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const w = makeWin(); w._shown = false;
    const s = createMainWindowState(0,0,100,100); s.visible = false;
    wm.register('main', w, s);
    wm.emit('show-all');
    wm.emit('show-all');
    expect(w._showCount).toBe(1);
  });
});

// ─── drag events ─────────────────────────────────────────────────────────────

describe('drag-start / drag-stop', () => {
  test('drag-start enables mouse events on draggable window', () => {
    const cursor = { x: 150, y: 250 };
    const wm = new WindowManager({ screen: { getCursorScreenPoint: () => ({ ...cursor }) } });
    const w = makeWin({ x: 100, y: 200 });
    wm.register('main', w, createMainWindowState(100, 200, 100, 100));
    wm.emit('drag-start', 'main');
    expect(w._ignoring).toBe(false);
  });

  test('drag-start on non-draggable window is a no-op', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const w = makeWin();
    wm.register('tooltip', w, createTooltipWindowState('main'));
    wm.emit('drag-start', 'tooltip');
    expect(w._ignoring).toBe(true);
  });

  test('drag-stop restores ignoreMouseEvents and emits drag-ended', () => {
    const cursor = { x: 150, y: 250 };
    const wm = new WindowManager({ screen: { getCursorScreenPoint: () => ({ ...cursor }) } });
    const w = makeWin({ x: 100, y: 200 });
    wm.register('main', w, createMainWindowState(100, 200, 100, 100));
    wm.emit('drag-start', 'main');
    let ended = null;
    wm.on('drag-ended', (key, pos) => { ended = { key, pos }; });
    wm.emit('drag-stop', 'main');
    expect(w._ignoring).toBe(true);
    expect(ended.key).toBe('main');
    expect(ended.pos).toHaveProperty('x');
  });
});

// ─── _tick ────────────────────────────────────────────────────────────────────

describe('_tick', () => {
  test('moves dragging window by offset', () => {
    const cursor = { x: 150, y: 250 };
    const wm = new WindowManager({ screen: { getCursorScreenPoint: () => ({ ...cursor }) } });
    const w = makeWin({ x: 100, y: 200 });
    wm.register('main', w, createMainWindowState(100, 200, 100, 100));
    wm.emit('drag-start', 'main'); // offset = cursor - winPos = (50, 50)
    wm._tick({ x: 200, y: 300 });
    expect(w._x).toBe(150); // 200 - 50
    expect(w._y).toBe(250); // 300 - 50
  });

  test('hover enter enables mouse events', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const w = makeWin({ x: 0, y: 0, w: 100, h: 100 });
    wm.register('main', w, createMainWindowState(0, 0, 100, 100));
    wm._tick({ x: 50, y: 50 });
    expect(w._ignoring).toBe(false);
  });

  test('hover leave disables mouse events', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const w = makeWin({ x: 0, y: 0, w: 100, h: 100 });
    wm.register('main', w, createMainWindowState(0, 0, 100, 100));
    wm._tick({ x: 50, y: 50 });  // enter
    wm._tick({ x: 200, y: 200 }); // leave
    expect(w._ignoring).toBe(true);
  });

  test('hover enter/leave is idempotent', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    const w = makeWin({ x: 0, y: 0, w: 100, h: 100 });
    wm.register('main', w, createMainWindowState(0, 0, 100, 100));
    wm._tick({ x: 50, y: 50 });
    wm._tick({ x: 50, y: 50 }); // same — no-op
    expect(w._ignoreCallCount).toBe(1);
  });

  test('skips destroyed windows', () => {
    const wm = new WindowManager({ screen: makeScreen() });
    wm.register('dead', makeWin({ destroyed: true }), createMainWindowState(0,0,100,100));
    expect(() => wm._tick({ x: 0, y: 0 })).not.toThrow();
  });
});

// ─── polling loop lifecycle ───────────────────────────────────────────────────

describe('polling loop', () => {
  test('unregistering last window stops the loop', () => {
    jest.useFakeTimers();
    const clearSpy = jest.spyOn(global, 'clearInterval');
    const wm = new WindowManager({ screen: makeScreen() });
    wm.register('main', makeWin(), createMainWindowState(0,0,100,100));
    wm.unregister('main');
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
    jest.useRealTimers();
  });
});
```

- [ ] **Step 2: Run tests to confirm they all fail**

```bash
npx jest tests/window-manager.test.js --no-coverage
```

Expected: multiple failures — `Cannot find module '../lib/window-manager'`

- [ ] **Step 3: Implement `lib/window-manager.js`**

```js
'use strict';

const { EventEmitter } = require('events');

class WindowManager extends EventEmitter {
  constructor({ screen } = {}) {
    super();
    this._entries = new Map(); // key → { win, state }
    this._screen = screen || require('electron').screen;
    this._intervalId = null;
    this._dragging = new Map(); // key → true

    this.onBeforeTick = () => {};
    this.onAfterTick  = () => {};

    this.on('hide-all', () => {
      const visited = new Set();
      for (const [key, { state }] of this._entries) {
        if (state.linkedTo == null) this._cascade(key, false, visited);
      }
    });

    this.on('show-all', () => {
      const visited = new Set();
      for (const [key, { state }] of this._entries) {
        if (state.linkedTo == null) this._cascade(key, true, visited);
      }
    });

    this.on('drag-start', (key) => {
      const entry = this._entries.get(key);
      if (!entry || !entry.state.isDraggable || entry.win.isDestroyed()) return;
      const { win, state } = entry;
      const cursor = this._screen.getCursorScreenPoint();
      state._dragOffsetX = cursor.x - state.x;
      state._dragOffsetY = cursor.y - state.y;
      this._dragging.set(key, true);
      if (state.ignoreMouseEvents) {
        state.ignoreMouseEvents = false;
        win.setIgnoreMouseEvents(false);
      }
    });

    this.on('drag-stop', (key) => {
      const entry = this._entries.get(key);
      if (!entry || !entry.state.isDraggable) return;
      const { win, state } = entry;
      this._dragging.delete(key);
      if (!state.ignoreMouseEvents) {
        state.ignoreMouseEvents = true;
        if (!win.isDestroyed()) win.setIgnoreMouseEvents(true);
      }
      this.emit('drag-ended', key, { x: state.x, y: state.y });
    });
  }

  register(key, win, state) {
    this._entries.set(key, { win, state: { ...state } });
    this._startLoop();
  }

  unregister(key) {
    this._entries.delete(key);
    this._dragging.delete(key);
    if (this._entries.size === 0) this._stopLoop();
  }

  getState(key) {
    const entry = this._entries.get(key);
    return entry ? { ...entry.state } : null;
  }

  updateState(key, patch) {
    const entry = this._entries.get(key);
    if (!entry) return;
    const { win, state } = entry;
    if (win.isDestroyed()) return;

    const prevVisible = state.visible;
    const prevX = state.x, prevY = state.y, prevW = state.width, prevH = state.height;
    const prevIgnore = state.ignoreMouseEvents;

    Object.assign(state, patch);

    if (state.visible !== prevVisible) {
      this._applyVisibility(entry, state.visible);
    }
    if (state.x !== prevX || state.y !== prevY || state.width !== prevW || state.height !== prevH) {
      win.setBounds({ x: state.x, y: state.y, width: state.width, height: state.height });
    }
    if (state.ignoreMouseEvents !== prevIgnore) {
      win.setIgnoreMouseEvents(state.ignoreMouseEvents);
    }
  }

  reorder(keys) {
    const next = new Map();
    for (const k of keys) {
      if (this._entries.has(k)) next.set(k, this._entries.get(k));
    }
    for (const [k, v] of this._entries) {
      if (!next.has(k)) next.set(k, v);
    }
    this._entries = next;
  }

  entries() {
    return this._entries.entries();
  }

  entriesByGroup(group) {
    const result = [];
    for (const [key, entry] of this._entries) {
      if (entry.state.group === group) result.push([key, entry]);
    }
    return result[Symbol.iterator]();
  }

  rankGroup(group) {
    const members = [];
    for (const [key, { state }] of this._entries) {
      if (state.group === group) members.push({ key, lastActivity: state.lastActivity });
    }
    members.sort((a, b) => b.lastActivity - a.lastActivity);
    return members.map(m => m.key);
  }

  gcGroup(group, { idleCutoff }) {
    const removed = [];
    for (const [key, { state }] of this._entries) {
      if (state.group === group && state.lastActivity < idleCutoff) {
        removed.push(key);
      }
    }
    for (const key of removed) this.unregister(key);
    return removed;
  }

  _applyVisibility(entry, visible) {
    const { win, state } = entry;
    if (win.isDestroyed()) return;
    if (visible) {
      state.showInactive ? win.showInactive() : win.show();
    } else {
      win.hide();
    }
    state.visible = visible;
  }

  _cascade(key, visible, visited) {
    if (visited.has(key)) return;
    visited.add(key);
    const entry = this._entries.get(key);
    if (!entry) return;
    const { state } = entry;
    if (!visible || state.autoShow) {
      if (state.visible !== visible) this._applyVisibility(entry, visible);
    }
    for (const [childKey, { state: cs }] of this._entries) {
      if (cs.linkedTo === key) this._cascade(childKey, visible, visited);
    }
  }

  _tick(cursor) {
    this.onBeforeTick(cursor);
    for (const [key, { win, state }] of this._entries) {
      if (win.isDestroyed()) continue;
      if (this._dragging.get(key)) {
        const nx = cursor.x - state._dragOffsetX;
        const ny = cursor.y - state._dragOffsetY;
        if (nx !== state.x || ny !== state.y) {
          state.x = nx; state.y = ny;
          win.setPosition(nx, ny);
        }
        continue;
      }
      const inside = cursor.x >= state.x && cursor.x <= state.x + state.width
                  && cursor.y >= state.y && cursor.y <= state.y + state.height;
      const shouldIgnore = !inside;
      if (shouldIgnore !== state.ignoreMouseEvents) {
        state.ignoreMouseEvents = shouldIgnore;
        win.setIgnoreMouseEvents(shouldIgnore);
      }
    }
    this.onAfterTick(cursor);
  }

  _startLoop() {
    if (this._intervalId !== null) return;
    this._intervalId = setInterval(() => {
      this._tick(this._screen.getCursorScreenPoint());
    }, 50);
  }

  _stopLoop() {
    if (this._intervalId === null) return;
    clearInterval(this._intervalId);
    this._intervalId = null;
  }
}

function createMainWindowState(x, y, width, height) {
  return {
    visible: true, autoShow: true, showInactive: false,
    ignoreMouseEvents: true, isDraggable: true,
    x: x || 0, y: y || 0, width: width || 100, height: height || 100,
    group: null, lastActivity: 0, activity: 'active',
    linkedTo: null, zOrder: 1,
    _dragOffsetX: 0, _dragOffsetY: 0,
  };
}

function createTooltipWindowState(parentKey) {
  return {
    visible: false, autoShow: false, showInactive: true,
    ignoreMouseEvents: true, isDraggable: false,
    x: 0, y: 0, width: 10, height: 10,
    group: null, lastActivity: 0, activity: 'active',
    linkedTo: parentKey || null, zOrder: 2,
    _dragOffsetX: 0, _dragOffsetY: 0,
  };
}

function createSubAgentWindowState(parentKey, group, x, y, width, height) {
  return {
    visible: true, autoShow: true, showInactive: false,
    ignoreMouseEvents: true, isDraggable: false,
    x: x || 0, y: y || 0, width: width || 100, height: height || 100,
    group: group || null, lastActivity: Date.now(), activity: 'active',
    linkedTo: parentKey || null, zOrder: 1,
    _dragOffsetX: 0, _dragOffsetY: 0,
  };
}

module.exports = { WindowManager, createMainWindowState, createTooltipWindowState, createSubAgentWindowState };
```

- [ ] **Step 4: Run tests to confirm they all pass**

```bash
npx jest tests/window-manager.test.js --no-coverage
```

Expected: all green

- [ ] **Step 5: Run full suite**

```bash
npx jest --no-coverage
```

Expected: all 198/198 still passing

- [ ] **Step 6: Commit**

```bash
git add lib/window-manager.js tests/window-manager.test.js
git commit -m "feat: add WindowManager with groups, LIFO rankGroup, cascade, drag, gcGroup

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Wire `WindowManager` into `main.js`

**Files:**
- Modify: `main.js`

**What stays:** `win`, `tooltipWin`, `subAgentWindows`, `subAgentCreatedAt`, `isDragging`, `dragOffsetX/Y`, `ignoringMouse` kept as typed IPC/query references. `applyConfigHotReload` continues iterating `subAgentWindows` — future migration point.

**Change table:**

| Site | Current code | Replacement |
|---|---|---|
| After last `require` | — | `const { WindowManager, createMainWindowState, createTooltipWindowState, createSubAgentWindowState } = require('./lib/window-manager');` |
| After `let tooltipWin = null` | — | `const wm = new WindowManager();` then `wm.on('drag-ended', (key, { x, y }) => { if (key === 'main') writeConfig({ windowX: x, windowY: y }); });` |
| `ensureTooltipWindow` — after `tooltipWin.setIgnoreMouseEvents(true)` | — | `wm.register('tooltip', tooltipWin, createTooltipWindowState('main'));` |
| `ensureTooltipWindow` — early-return path | `return tooltipWin` | add `if (!wm.getState('tooltip')) wm.register('tooltip', tooltipWin, createTooltipWindowState('main'));` before return |
| `createWindow` — after `win.setIgnoreMouseEvents(true)` | — | `wm.register('main', win, createMainWindowState(x, y, petW, petH));` |
| `win.on('closed')` | cleanup loop | add `wm.unregister('main'); wm.unregister('tooltip');` before existing cleanup |
| `ipcMain.on('drag-start')` | `win.setIgnoreMouseEvents(false); ignoringMouse = false` | replace with `wm.emit('drag-start', 'main'); ignoringMouse = wm.getState('main')?.ignoreMouseEvents ?? false;` — remove the manual setIgnoreMouseEvents call |
| `ipcMain.on('drag-stop')` | `isDragging = false; writeConfig(...)` | keep `isDragging = false`; add `wm.emit('drag-stop', 'main');`; remove `writeConfig` block (handled by `drag-ended`) |
| `ipcMain.on('hide-tooltip')` | `tooltipWin.hide()` | `wm.updateState('tooltip', { visible: false });` |
| `ipcMain.on('tooltip-size')` | `setBounds + showInactive` | `wm.updateState('tooltip', { x, y, width, height, visible: true });` |
| `buildDockMenu` hide branch | `win.hide(); for…subWin.hide()` | `wm.emit('hide-all');` |
| `buildDockMenu` show branch | `win.show(); for…subWin.show()` | `wm.emit('show-all');` |
| `startMouseTrackingForWindow` function | entire function | **delete** — manager loop replaces it |
| All `startMouseTrackingForWindow(...)` call sites | function calls | **delete** |
| `createSubAgentWindow` — after `subAgentWindows.set(sessionId, subWin)` | — | `wm.register(parentToolId, subWin, createSubAgentWindowState('main', 'subagent-pet', 20, 0, subW, subH));` |
| `createSubAgentWindow` — `if (!petVisible) subWin.hide()` | direct hide | `if (!petVisible) wm.updateState(parentToolId, { visible: false });` |
| `destroySubAgentWindow` — after `subAgentWindows.delete(sessionId)` | — | `wm.unregister(parentToolId);` |
| `subWin.on('closed')` — after `subAgentWindows.delete` | — | `wm.unregister(parentToolId);` |
| `ipcMain.on('resize-pet')` — after `senderWin.setSize(w, h)` | — | sync bounds: `if (senderWin === win) { wm.updateState('main', { width: w, height: h }); } else { for (const [id, sw] of subAgentWindows) { if (sw === senderWin) { wm.updateState(id, { width: w, height: h }); break; } } }` |
| Heartbeat TTL sweep | `destroySubAgentWindow(sid)` per expired entry | replace with: `const removed = wm.gcGroup('subagent-pet', { idleCutoff: now - SUB_AGENT_TTL_MS }); for (const key of removed) { const sw = subAgentWindows.get(key); if (sw && !sw.isDestroyed()) sw.destroy(); subAgentWindows.delete(key); subAgentCreatedAt.delete(key); }` |

**Note on key naming:** `createSubAgentWindow(sessionId)` receives `sessionId` but the map key in `subAgentWindows` is `parentToolId` (the tool invocation ID, set from `pollingWatcher.on('subagent-event', ({ parentToolId }))`). The `wm.register` call uses `parentToolId` as the key — consistent with `subAgentWindows`. The function parameter name `sessionId` in `createSubAgentWindow` is a pre-existing misnomer; do not rename it in this task.

- [ ] **Step 1: Add require, instantiate `wm`, wire `drag-ended`**

After the last `require` line:
```js
const { WindowManager, createMainWindowState, createTooltipWindowState, createSubAgentWindowState } = require('./lib/window-manager');
```

After `let tooltipWin = null;`:
```js
const wm = new WindowManager();
wm.on('drag-ended', (key, { x, y }) => {
  if (key === 'main') writeConfig({ windowX: x, windowY: y });
});
```

- [ ] **Step 2: Register `win` in `createWindow`**

After `win.setIgnoreMouseEvents(true);`:
```js
wm.register('main', win, createMainWindowState(x, y, petW, petH));
```

In `win.on('closed', ...)`, before the existing cleanup loop:
```js
wm.unregister('main');
wm.unregister('tooltip');
```

- [ ] **Step 3: Register `tooltipWin` in `ensureTooltipWindow`**

After `tooltipWin.setIgnoreMouseEvents(true);`:
```js
wm.register('tooltip', tooltipWin, createTooltipWindowState('main'));
```

On the early-return path, before `return tooltipWin`:
```js
if (!wm.getState('tooltip')) wm.register('tooltip', tooltipWin, createTooltipWindowState('main'));
```

- [ ] **Step 4: Replace tooltip IPC handlers**

```js
ipcMain.on('hide-tooltip', () => {
  wm.updateState('tooltip', { visible: false });
});

ipcMain.on('tooltip-size', (_event, { width, height }) => {
  if (!tooltipWin || tooltipWin.isDestroyed()) return;
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const x = Math.round(Math.min(pendingTooltipAnchor.x, screenW - width - 2));
  const y = Math.round(Math.min(pendingTooltipAnchor.y, screenH - height - 2));
  wm.updateState('tooltip', { x, y, width, height, visible: true });
});
```

- [ ] **Step 5: Replace dock-menu show/hide and drag IPC**

In `buildDockMenu` click handler:
```js
if (petVisible) {
  wm.emit('hide-all');
} else {
  wm.emit('show-all');
}
```

In `ipcMain.on('drag-start')`, replace the `if (ignoringMouse)` block:
```js
wm.emit('drag-start', 'main');
ignoringMouse = wm.getState('main')?.ignoreMouseEvents ?? false;
```

In `ipcMain.on('drag-stop')`, after `isDragging = false`:
```js
wm.emit('drag-stop', 'main');
```
Remove the `writeConfig({ windowX, windowY })` lines — handled by `drag-ended`.

- [ ] **Step 6: Delete `startMouseTrackingForWindow` and call sites**

Delete the entire function (lines 558–586) and both call sites:
- `startMouseTrackingForWindow(win)` in `createWindow`
- `startMouseTrackingForWindow(subWin)` in `createSubAgentWindow`

- [ ] **Step 7: Register/unregister sub-agent windows; replace TTL sweep**

In `createSubAgentWindow`, after `subAgentWindows.set(sessionId, subWin)`:
```js
wm.register(sessionId, subWin, createSubAgentWindowState('main', 'subagent-pet', 20, 0, subW, subH));
```

Replace `if (!petVisible) subWin.hide()`:
```js
if (!petVisible) wm.updateState(sessionId, { visible: false });
```

In `destroySubAgentWindow`, after `subAgentWindows.delete(sessionId)`:
```js
wm.unregister(sessionId);
```

In `subWin.on('closed')`, after `subAgentWindows.delete(sessionId)`:
```js
wm.unregister(sessionId);
```

Replace the TTL sweep in the heartbeat interval:
```js
const removed = wm.gcGroup('subagent-pet', { idleCutoff: now - SUB_AGENT_TTL_MS });
for (const key of removed) {
  const sw = subAgentWindows.get(key);
  if (sw && !sw.isDestroyed()) sw.destroy();
  subAgentWindows.delete(key);
  subAgentCreatedAt.delete(key);
}
```

- [ ] **Step 8: Sync resize-pet bounds into manager**

In `ipcMain.on('resize-pet')`, after `senderWin.setSize(w, h)`:
```js
if (senderWin === win) {
  wm.updateState('main', { width: w, height: h });
} else {
  for (const [id, sw] of subAgentWindows) {
    if (sw === senderWin) { wm.updateState(id, { width: w, height: h }); break; }
  }
}
```

- [ ] **Step 9: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all 198+ tests still passing

- [ ] **Step 10: Smoke test**

1. `npm start`
2. Hover over pet — tooltip appears
3. Dock → Hide Pet — tooltip disappears with pet (bug fix)
4. Dock → Show Pet — pet reappears; tooltip does not ghost
5. Drag pet — position persists across restart
6. Hover again — tooltip reappears normally

- [ ] **Step 11: Commit**

```bash
git add main.js
git commit -m "fix: wire WindowManager into main.js; tooltip hides with pet

Replaces startMouseTrackingForWindow, scattered hide/show loops,
and manual drag persistence with event-driven WindowManager.
Tooltip cascades as a linked child of main on hide-all/show-all.
Sub-agent windows join 'subagent-pet' group for ranked iteration
and gcGroup-based TTL cleanup.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
