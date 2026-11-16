# Config Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `lib/pet-config.js` with `lib/config-manager.js` — absorbing its raw `fs` I/O directly and adding typed, namespaced accessors for two concerns: **window state** (position, snap corner) and **app config** (pet, scale, border, cornerRadius, remoteUrl, subAgentMargin). Migrate `main.js` and all CLI files off `pet-config` imports; delete `pet-config.js` and its test.

**Architecture:** `ConfigManager` owns the raw `fs.readFileSync` / `fs.writeFileSync` calls and the `paths.getConfigPath()` call directly — no wrapper, no intermediate module. It exposes typed getters with defaults (`getWindowState()`, `getAppConfig()`) and namespace-scoped writers (`saveWindowState(patch)`, `saveAppConfig(patch)`), each stripping `undefined` before writing. `lib/pet-config.js` and `tests/pet-config.test.js` are deleted when all callers are migrated. The `ConfigManager` is the prerequisite for the `WindowManager` plan.

**Tech Stack:** Node.js (CommonJS `'use strict'`), `lib/paths.js` (existing), `fs` (stdlib), Jest 30 (node environment)

**Spec:** `docs/superpowers/specs/2026-09-25-radial-subagent-pets-design.md` (§5 config propagation)

## Global Constraints

- CommonJS (`'use strict'`; `module.exports`), no ESM
- No new npm dependencies
- The underlying JSON file format and path are unchanged — no migration needed
- All keys written today by `main.js` must still be written by the same name (no renames)
- Tests use `jest.mock('../lib/paths', ...)` exactly as `tests/pet-config.test.js` does — copy that pattern verbatim
- `lib/pet-config.js` and `tests/pet-config.test.js` are DELETED by the end of this plan

## Config namespaces and keys

### Window state (`getWindowState` / `saveWindowState`)

| Key | Type | Default | Description |
|---|---|---|---|
| `windowX` | `number \| undefined` | `undefined` | Last dragged X position |
| `windowY` | `number \| undefined` | `undefined` | Last dragged Y position |
| `snapCorner` | `string \| undefined` | `undefined` | Last snapped corner (`'bottom-left'` etc) |

### App config (`getAppConfig` / `saveAppConfig`)

| Key | Type | Default | Description |
|---|---|---|---|
| `pet` | `string` | `'orc'` | Active pet pack name |
| `scale` | `number \| undefined` | `undefined` | Display scale (resolved with CLI arg by caller) |
| `border` | `boolean` | `false` | Border enabled |
| `cornerRadius` | `number` | `0` | Window corner radius |
| `remoteUrl` | `string` | `'http://127.0.0.1:19998'` | Remote relay URL |
| `subAgentMargin` | `number` | `12` | Radial margin px (spec §5) |

## Review Focus

- `getWindowState()` must return `{ windowX: undefined, windowY: undefined, snapCorner: undefined }` when config file is missing — callers check `windowX !== undefined` to decide whether to restore position. Test: call on empty config; assert all three are `undefined`.
- `saveWindowState` must not overwrite unrelated app config keys — a partial window-state write must preserve `pet`, `scale` etc. Test: write app config first, then `saveWindowState`, then read back full config and assert app keys are intact.
- `saveAppConfig` must not overwrite window state keys — symmetric to above. Test: write window state first, then `saveAppConfig`, then assert window keys intact.
- `getAppConfig()` defaults must match the values `main.js` uses today — wrong defaults are silent regressions. Test: call on empty config and assert each default matches the constant in main.js.
- `saveWindowState` with `undefined` values must not write those keys — if `windowX` is `undefined` in the patch, it must not appear in the JSON. Test: `saveWindowState({ windowX: undefined, windowY: 100 })`; assert only `windowY` appears in file.

---

## Task 1: `lib/config-manager.js` (replaces `lib/pet-config.js`)

**Files:**
- Create: `lib/config-manager.js`
- Create: `tests/config-manager.test.js`

**Interfaces:**
- Produces:
  - `class ConfigManager`
    - `constructor()` — loads nothing eagerly; each method reads fresh from disk
    - `getWindowState()` → `{ windowX, windowY, snapCorner }` — values from config or `undefined`
    - `saveWindowState(patch)` — writes only defined keys from patch; merges with existing
    - `getAppConfig()` → `{ pet, scale, border, cornerRadius, remoteUrl, subAgentMargin }` with defaults
    - `saveAppConfig(patch)` — writes only defined keys from patch; merges with existing
    - `getRaw()` → full config object (for callers that need keys outside the two namespaces — e.g. hot-reload resolution)
  - `module.exports = { ConfigManager }`

**Implementation notes:**
- `ConfigManager` calls `fs.readFileSync(getConfigPath(), 'utf8')` and `JSON.parse` directly — no `pet-config.js` import.
- Every method calls the internal `_load()` helper fresh — no in-memory cache. Disk is the source of truth.
- `saveWindowState` and `saveAppConfig` both call `_write(definedOnly(patch))` where `definedOnly` strips keys whose value is `undefined`.
- `_write(patch)` merges patch onto the existing file contents before writing, just as `pet-config.js` `writeConfig` did.
- `getAppConfig` applies defaults after reading: `{ pet: raw.pet ?? 'orc', scale: raw.scale, border: raw.border ?? false, ... }`. `scale` intentionally has no default here — it may be `undefined` and callers resolve it with the CLI arg.

- [ ] **Step 1: Write failing tests**

```js
// tests/config-manager.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_CFG_DIR  = path.join(os.tmpdir(), 'peon-pet-cfg-mgr-test');
const TEST_CFG_PATH = path.join(TEST_CFG_DIR, 'peon-pet-config.json');

jest.mock('../lib/paths', () => {
  const path = require('path');
  const os   = require('os');
  const dir  = path.join(os.tmpdir(), 'peon-pet-cfg-mgr-test');
  require('fs').mkdirSync(dir, { recursive: true });
  return {
    getUserDataDir:    () => dir,
    getConfigPath:     () => path.join(dir, 'peon-pet-config.json'),
    getBundledPacksDir:() => path.join(__dirname, '..', 'renderer', 'assets'),
    getCustomPacksDir: () => path.join(os.homedir(), '.openpeon', 'pets'),
  };
});

const { ConfigManager } = require('../lib/config-manager');

afterAll(() => { fs.rmSync(TEST_CFG_DIR, { recursive: true, force: true }); });
beforeEach(() => { if (fs.existsSync(TEST_CFG_PATH)) fs.unlinkSync(TEST_CFG_PATH); });

// ─── getWindowState ───────────────────────────────────────────────────────────

describe('getWindowState', () => {
  test('returns undefined for all keys when config is missing', () => {
    const cfg = new ConfigManager();
    const ws = cfg.getWindowState();
    expect(ws.windowX).toBeUndefined();
    expect(ws.windowY).toBeUndefined();
    expect(ws.snapCorner).toBeUndefined();
  });

  test('returns persisted values when present', () => {
    fs.writeFileSync(TEST_CFG_PATH, JSON.stringify({ windowX: 100, windowY: 200, snapCorner: 'bottom-left' }));
    const ws = new ConfigManager().getWindowState();
    expect(ws.windowX).toBe(100);
    expect(ws.windowY).toBe(200);
    expect(ws.snapCorner).toBe('bottom-left');
  });
});

// ─── saveWindowState ─────────────────────────────────────────────────────────

describe('saveWindowState', () => {
  test('writes window state keys', () => {
    const cfg = new ConfigManager();
    cfg.saveWindowState({ windowX: 50, windowY: 75 });
    const ws = cfg.getWindowState();
    expect(ws.windowX).toBe(50);
    expect(ws.windowY).toBe(75);
  });

  test('does not overwrite app config keys', () => {
    const cfg = new ConfigManager();
    cfg.saveAppConfig({ pet: 'orc', scale: 2 });
    cfg.saveWindowState({ windowX: 10, windowY: 20 });
    const app = cfg.getAppConfig();
    expect(app.pet).toBe('orc');
    expect(app.scale).toBe(2);
  });

  test('undefined values in patch are not written', () => {
    const cfg = new ConfigManager();
    cfg.saveWindowState({ windowX: undefined, windowY: 100 });
    const raw = JSON.parse(fs.readFileSync(TEST_CFG_PATH, 'utf8'));
    expect(Object.prototype.hasOwnProperty.call(raw, 'windowX')).toBe(false);
    expect(raw.windowY).toBe(100);
  });

  test('merges with existing window state', () => {
    const cfg = new ConfigManager();
    cfg.saveWindowState({ windowX: 10, windowY: 20 });
    cfg.saveWindowState({ windowX: 99 });
    const ws = cfg.getWindowState();
    expect(ws.windowX).toBe(99);
    expect(ws.windowY).toBe(20); // preserved
  });
});

// ─── getAppConfig ─────────────────────────────────────────────────────────────

describe('getAppConfig', () => {
  test('returns defaults when config is missing', () => {
    const app = new ConfigManager().getAppConfig();
    expect(app.pet).toBe('orc');
    expect(app.border).toBe(false);
    expect(app.cornerRadius).toBe(0);
    expect(app.remoteUrl).toBe('http://127.0.0.1:19998');
    expect(app.subAgentMargin).toBe(12);
    expect(app.scale).toBeUndefined();
  });

  test('returns persisted values over defaults', () => {
    fs.writeFileSync(TEST_CFG_PATH, JSON.stringify({ pet: 'capybara', scale: 2, border: true, cornerRadius: 8, remoteUrl: 'http://example.com', subAgentMargin: 20 }));
    const app = new ConfigManager().getAppConfig();
    expect(app.pet).toBe('capybara');
    expect(app.scale).toBe(2);
    expect(app.border).toBe(true);
    expect(app.cornerRadius).toBe(8);
    expect(app.remoteUrl).toBe('http://example.com');
    expect(app.subAgentMargin).toBe(20);
  });
});

// ─── saveAppConfig ────────────────────────────────────────────────────────────

describe('saveAppConfig', () => {
  test('writes app config keys', () => {
    const cfg = new ConfigManager();
    cfg.saveAppConfig({ pet: 'capybara', scale: 2 });
    const app = cfg.getAppConfig();
    expect(app.pet).toBe('capybara');
    expect(app.scale).toBe(2);
  });

  test('does not overwrite window state keys', () => {
    const cfg = new ConfigManager();
    cfg.saveWindowState({ windowX: 42, windowY: 99 });
    cfg.saveAppConfig({ pet: 'orc' });
    const ws = cfg.getWindowState();
    expect(ws.windowX).toBe(42);
    expect(ws.windowY).toBe(99);
  });

  test('undefined values in patch are not written', () => {
    const cfg = new ConfigManager();
    cfg.saveAppConfig({ pet: undefined, scale: 2 });
    const raw = JSON.parse(fs.readFileSync(TEST_CFG_PATH, 'utf8'));
    expect(Object.prototype.hasOwnProperty.call(raw, 'pet')).toBe(false);
    expect(raw.scale).toBe(2);
  });
});

// ─── getRaw ──────────────────────────────────────────────────────────────────

describe('getRaw', () => {
  test('returns full config object', () => {
    fs.writeFileSync(TEST_CFG_PATH, JSON.stringify({ pet: 'orc', windowX: 10 }));
    const raw = new ConfigManager().getRaw();
    expect(raw.pet).toBe('orc');
    expect(raw.windowX).toBe(10);
  });

  test('returns empty object when config missing', () => {
    expect(new ConfigManager().getRaw()).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to confirm they all fail**

```bash
npx jest tests/config-manager.test.js --no-coverage
```

Expected: `Cannot find module '../lib/config-manager'`

- [ ] **Step 3: Implement `lib/config-manager.js`**

```js
'use strict';

const fs = require('fs');
const path = require('path');
const { getConfigPath } = require('./paths');

function definedOnly(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

class ConfigManager {
  _load() {
    try { return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8')); }
    catch { return {}; }
  }

  _write(patch) {
    const configPath = getConfigPath();
    const current = this._load();
    const next = { ...current, ...patch };
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
    return next;
  }

  getWindowState() {
    const raw = this._load();
    return {
      windowX:    raw.windowX,
      windowY:    raw.windowY,
      snapCorner: raw.snapCorner,
    };
  }

  saveWindowState(patch) {
    this._write(definedOnly(patch));
  }

  getAppConfig() {
    const raw = this._load();
    return {
      pet:            raw.pet           ?? 'orc',
      scale:          raw.scale,
      border:         raw.border        ?? false,
      cornerRadius:   raw.cornerRadius  ?? 0,
      remoteUrl:      raw.remoteUrl     ?? 'http://127.0.0.1:19998',
      subAgentMargin: raw.subAgentMargin ?? 12,
    };
  }

  saveAppConfig(patch) {
    this._write(definedOnly(patch));
  }

  getRaw() {
    return this._load();
  }
}

module.exports = { ConfigManager };
```

- [ ] **Step 4: Run tests to confirm they all pass**

```bash
npx jest tests/config-manager.test.js --no-coverage
```

Expected: all green

- [ ] **Step 5: Run full suite**

```bash
npx jest --no-coverage
```

Expected: all existing tests still passing (pet-config.test.js still passes because pet-config.js still exists at this point)

- [ ] **Step 6: Commit**

```bash
git add lib/config-manager.js tests/config-manager.test.js
git commit -m "feat: add ConfigManager with typed window-state and app-config namespaces

Owns fs I/O directly from lib/paths — not a wrapper over pet-config.js.
Prerequisite for WindowManager persistence.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Migrate `main.js` to `ConfigManager`

**Files:**
- Modify: `main.js`

**What changes:** Replace the two inline functions `loadPetConfig` / `writeConfig` (main.js lines 179–191) with a `ConfigManager` instance. All call sites in `main.js` update to use typed methods. The inline functions are deleted.

**Call site migration table:**

| Current call | Replacement |
|---|---|
| `const cfg = loadPetConfig()` then `cfg.windowX` / `cfg.windowY` | `const ws = cfgMgr.getWindowState()` then `ws.windowX` / `ws.windowY` |
| `const cfg = loadPetConfig()` then `cfg.pet`, `cfg.scale`, `cfg.border` etc | `const app = cfgMgr.getAppConfig()` |
| `const cfg = loadPetConfig()` in `reloadPack` / `applyConfigHotReload` (needs all keys) | `const raw = cfgMgr.getRaw()` — these functions use keys outside the two namespaces |
| `writeConfig({ windowX: x, windowY: y })` in drag-stop | `cfgMgr.saveWindowState({ windowX: x, windowY: y })` |
| `writeConfig({ windowX: nx, windowY: ny })` in `snapToCorner` | `cfgMgr.saveWindowState({ windowX: nx, windowY: ny })` |

**Note:** `startPolling` calls `loadPetConfig()` to read `remoteUrl`. Replace with `cfgMgr.getAppConfig().remoteUrl`. `applyConfigHotReload` and `reloadPack` call `loadPetConfig()` to pass the full config object to `resolveScale`, `resolveBorderEnabled`, `reloadPack` — replace these with `cfgMgr.getRaw()` since those functions read arbitrary keys.

- [ ] **Step 1: Add require and instantiate `cfgMgr`**

Add after the last `require` line:
```js
const { ConfigManager } = require('./lib/config-manager');
```

Delete the inline `loadPetConfig` and `writeConfig` function definitions (lines 179–191).

After the `protocol.registerSchemesAsPrivileged` block, add:
```js
const cfgMgr = new ConfigManager();
```

- [ ] **Step 2: Migrate `createWindow` position restore**

Replace:
```js
const cfg = loadPetConfig();
// ...
if (cfg.windowX !== undefined && cfg.windowY !== undefined) {
  x = cfg.windowX;
  y = cfg.windowY;
}
```
with:
```js
const ws = cfgMgr.getWindowState();
// ...
if (ws.windowX !== undefined && ws.windowY !== undefined) {
  x = ws.windowX;
  y = ws.windowY;
}
```

And the `peon-config` send in `did-finish-load`:
```js
const cfg = loadPetConfig(); // → const app = cfgMgr.getAppConfig();
// cornerRadius: cfg.cornerRadius ?? 0  → cornerRadius: app.cornerRadius
```

- [ ] **Step 3: Migrate `snapToCorner` persistence**

```js
cfgMgr.saveWindowState({ windowX: nx, windowY: ny });
```

- [ ] **Step 4: Migrate drag-stop persistence**

```js
cfgMgr.saveWindowState({ windowX: x, windowY: y });
```

- [ ] **Step 5: Migrate `startPolling` remoteUrl**

```js
const remoteUrl = cfgMgr.getAppConfig().remoteUrl;
```

- [ ] **Step 6: Migrate `app.whenReady` startup block**

```js
const cfg = loadPetConfig(); // → const raw = cfgMgr.getRaw();
scale = resolveScale(raw);   // resolveScale reads process.argv then raw.scale
borderEnabled = resolveBorderEnabled(raw);
const packInfo = registerPetProtocol(raw);
```

- [ ] **Step 7: Migrate `applyConfigHotReload`**

```js
const cfg = loadPetConfig(); // → const raw = cfgMgr.getRaw();
// All cfg.* references → raw.*
// cfg.cornerRadius ?? 0 → raw.cornerRadius ?? 0  (or cfgMgr.getAppConfig().cornerRadius)
```

- [ ] **Step 8: Run full suite**

```bash
npx jest --no-coverage
```

Expected: all tests still passing

- [ ] **Step 9: Smoke test**

1. `npm start` — app launches, pet appears at last saved position
2. Drag pet — position saved on stop; confirmed by restart
3. Snap to corner from dock menu — position saved; confirmed by restart
4. `npm run dev` — hot-reload still works (config watch fires, `applyConfigHotReload` runs)

- [ ] **Step 10: Commit**

```bash
git add main.js
git commit -m "refactor: migrate main.js config reads/writes to ConfigManager

Removes inline loadPetConfig/writeConfig; all config access goes
through typed ConfigManager methods. Window state and app config
are now namespaced — prerequisite for WindowManager persistence.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Migrate CLI files to `ConfigManager`; delete `pet-config.js`

**Files:**
- Modify: `lib/cli/settings.js`
- Modify: `lib/cli/status.js`
- Modify: `lib/cli/packs.js`
- Delete: `lib/pet-config.js`
- Delete: `tests/pet-config.test.js`

**What changes:** The three CLI files each import `loadConfig` and/or `writeConfig` from `../pet-config`. Replace those imports with `ConfigManager` and update the call sites. Then delete the now-unused `pet-config.js` and its test file.

**Call site migration table:**

| File | Current | Replacement |
|---|---|---|
| `lib/cli/settings.js` | `const { loadConfig, writeConfig } = require('../pet-config');` | `const { ConfigManager } = require('../config-manager'); const cfgMgr = new ConfigManager();` |
| `lib/cli/settings.js` | `const cfg = loadConfig(); cfg.scale` | `const app = cfgMgr.getAppConfig(); app.scale` |
| `lib/cli/settings.js` | `writeConfig({ scale: n })` | `cfgMgr.saveAppConfig({ scale: n })` |
| `lib/cli/settings.js` | `writeConfig({ border: ... })` | `cfgMgr.saveAppConfig({ border: ... })` |
| `lib/cli/settings.js` | `writeConfig({ corner: ... })` (note: `corner` key, not `snapCorner`) | `cfgMgr.saveAppConfig({ corner: normalized })` — `corner` is an app preference, not a window-state key |
| `lib/cli/settings.js` | `writeConfig({ cornerRadius: n })` | `cfgMgr.saveAppConfig({ cornerRadius: n })` |
| `lib/cli/settings.js` | `writeConfig({ remoteUrl: value })` | `cfgMgr.saveAppConfig({ remoteUrl: value })` |
| `lib/cli/status.js` | `const { loadConfig } = require('../pet-config');` | `const { ConfigManager } = require('../config-manager'); const cfgMgr = new ConfigManager();` |
| `lib/cli/status.js` | `const cfg = loadConfig(); cfg.pet`, `cfg.scale`, etc | `const app = cfgMgr.getAppConfig(); app.pet`, `app.scale`, etc |
| `lib/cli/packs.js` | `const { loadConfig, writeConfig } = require('../pet-config');` | `const { ConfigManager } = require('../config-manager'); const cfgMgr = new ConfigManager();` |
| `lib/cli/packs.js` | `const cfg = loadConfig(); cfg.pet` | `const app = cfgMgr.getAppConfig(); app.pet` |
| `lib/cli/packs.js` | `writeConfig({ pet: name })` | `cfgMgr.saveAppConfig({ pet: name })` |

**Note on `corner` vs `snapCorner`:** The CLI `settings.js` writes a `corner` key (dock snap corner preference set by the user via CLI). The window manager will write `snapCorner` (position persisted after a live drag-snap). These are two different concerns that happen to be stored in the same JSON file. `corner` goes through `saveAppConfig`; `snapCorner` goes through `saveWindowState`. Do not conflate them.

- [ ] **Step 1: Migrate `lib/cli/settings.js`**

Replace the import line:
```js
const { loadConfig, writeConfig } = require('../pet-config');
```
with:
```js
const { ConfigManager } = require('../config-manager');
const cfgMgr = new ConfigManager();
```

Replace every `loadConfig()` call with `cfgMgr.getAppConfig()` (all reads in `settings.js` are app config — `scale`, `border`, `corner`, `cornerRadius`, `remoteUrl`).

Replace every `writeConfig({ key: val })` call with `cfgMgr.saveAppConfig({ key: val })`.

After the changes, `lib/cli/settings.js` should have no references to `pet-config`.

- [ ] **Step 2: Migrate `lib/cli/status.js`**

Replace the import line:
```js
const { loadConfig } = require('../pet-config');
```
with:
```js
const { ConfigManager } = require('../config-manager');
const cfgMgr = new ConfigManager();
```

In `registerStatusCommand`'s action handler, replace:
```js
const cfg = loadConfig();
const pet = cfg.pet || 'orc (default)';
const scale = cfg.scale !== undefined ? cfg.scale : '1 (default)';
const border = cfg.border === true ? 'on' : 'off';
const corner = cfg.corner || 'bottom-left (default)';
const remote = cfg.remoteUrl || 'http://127.0.0.1:19998 (default)';
const cornerRadius = cfg.cornerRadius !== undefined ? `${cfg.cornerRadius}px` : '0 (default)';
```
with:
```js
const app = cfgMgr.getAppConfig();
const raw = cfgMgr.getRaw();
const pet = app.pet === 'orc' && raw.pet === undefined ? 'orc (default)' : app.pet;
const scale = app.scale !== undefined ? app.scale : '1 (default)';
const border = app.border ? 'on' : 'off';
const corner = raw.corner || 'bottom-left (default)';
const remote = raw.remoteUrl !== undefined ? app.remoteUrl : 'http://127.0.0.1:19998 (default)';
const cornerRadius = raw.cornerRadius !== undefined ? `${app.cornerRadius}px` : '0 (default)';
```

Note: `status.js` displays `(default)` suffix when a value was not set by the user. `getRaw()` lets us distinguish "user wrote this value" from "this is a default". The `corner` key (CLI preference) is not in `getAppConfig()`'s namespace, so read it from `getRaw()` directly.

- [ ] **Step 3: Migrate `lib/cli/packs.js`**

Replace the import line:
```js
const { loadConfig, writeConfig } = require('../pet-config');
```
with:
```js
const { ConfigManager } = require('../config-manager');
const cfgMgr = new ConfigManager();
```

In `packs list` action, replace:
```js
const cfg = loadConfig();
const active = cfg.pet || 'orc';
```
with:
```js
const active = cfgMgr.getAppConfig().pet;
```

In `packs use` action, replace:
```js
writeConfig({ pet: name });
```
with:
```js
cfgMgr.saveAppConfig({ pet: name });
```

- [ ] **Step 4: Run full suite**

```bash
npx jest --no-coverage
```

Expected: all existing tests pass, `pet-config.test.js` still passes (pet-config.js still exists)

- [ ] **Step 5: Verify no remaining pet-config imports**

```bash
grep -r 'pet-config' lib/ main.js
```

Expected: no output (zero callers remain)

- [ ] **Step 6: Delete `lib/pet-config.js` and `tests/pet-config.test.js`**

```bash
rm lib/pet-config.js tests/pet-config.test.js
```

- [ ] **Step 7: Run full suite again to confirm nothing broke**

```bash
npx jest --no-coverage
```

Expected: all tests pass; `pet-config.test.js` no longer in the run

- [ ] **Step 8: Smoke test CLI commands**

```bash
node bin/peon-pet.js status
node bin/peon-pet.js scale 2
node bin/peon-pet.js border on
node bin/peon-pet.js corner bl
node bin/peon-pet.js packs list
```

Expected: each command runs without error; `status` shows the values set by the commands above.

- [ ] **Step 9: Commit**

```bash
git add lib/cli/settings.js lib/cli/status.js lib/cli/packs.js
git rm lib/pet-config.js tests/pet-config.test.js
git commit -m "refactor: migrate CLI files to ConfigManager; delete pet-config.js

All callers of lib/pet-config.js (settings.js, status.js, packs.js) now
use ConfigManager directly. pet-config.js and its test are deleted —
ConfigManager is the sole config layer.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
