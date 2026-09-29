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
