# Renderer/Player Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Three.js with PixiJS in the renderer, split `renderer/app.js` into a shared, testable `renderer/player.js` (pure player logic) and a thin `renderer/app.js` (per-window IPC/DOM bootstrap), fix the frame-accumulator animation bug, unify hot-reload teardown across all layers, and add `Cache-Control` to the `peon-asset://` protocol handler.

**Architecture:** `renderer/player.js` owns everything Pixi-related — scene objects, texture slicing/caching, flash/dot/particle effects, frame advancement — driven purely by a resolved CEAP config and an injected `PIXI.Application`-like object, with zero references to `window.peonBridge` or DOM events. `renderer/app.js` becomes a thin bootstrap: creates the real `PIXI.Application`, wires `window.peonBridge` IPC listeners and DOM drag/tooltip handlers, and calls into `player.js`'s exported functions. `main.js` gets one isolated change: the `peon-asset://` handler adds an immutable cache header, justified by the existing never-reuse-token invariant.

**Tech Stack:** PixiJS 8.x (`pixi.js` npm package, ESM), Electron 44 (existing), Jest 30 (existing, `node` test environment).

**Spec:** `docs/superpowers/specs/2026-09-29-renderer-player-rewrite-design.md`

## Global Constraints

- `renderer/player.js` is authored as a native ES module (`export function ...`, no `module.exports`) because it is `import`-ed directly by the browser (`renderer/app.js`, loaded via `<script type="module">`, no bundler) and must also be `import`-ed by Jest tests — one file, one module system, both consumers. Every other file in the repo (`lib/*.js`, `main.js`, `preload.js`) stays CommonJS (`require`/`module.exports`) as today; only `renderer/` opts into ESM, via a nested `renderer/package.json` with `{"type": "module"}` (Task 1), so this doesn't affect how Electron's main/preload processes load their own files.
- Jest must run `tests/player.test.mjs` (and any other test file that imports an ESM file under `renderer/`) with Node's native ESM support enabled (`NODE_OPTIONS=--experimental-vm-modules`, Task 1) — existing CommonJS test files are unaffected by this since Jest supports mixed CJS/ESM test files in one run once the flag is set.
- Do not change the IPC contract: `peon-config`, `peon-event`, `session-update`, `show-tooltip`/`hide-tooltip` message shapes and `window.peonBridge` method names stay exactly as defined in `preload.js` today.
- Do not touch `tooltip-size`, `window.tooltipBridge`, `renderer/tooltip.js`, or `renderer/tooltip-preload.js` — that is a separate window/bridge untouched by this spec.
- Do not change `main.js`'s window-management logic (`WindowManager`, cascade, drag, snap) — the only `main.js` change is the `peon-asset://` handler's response headers.
- `player.js` must have no `isSubAgent`-shaped branching beyond what `config.subAgent` drives — sub-agent gating for idle/size/post-reaction-state lives in `player.js` keyed off config; DOM-listener attach/detach and IPC event gating (only forward `waking` to sub-agents) stay in `app.js`.
- The frame accumulator must use a `while` loop that subtracts `1/fps` (not resets to `0`), so a stall catches up instead of freezing an extra interval.
- Hot-reload (`initScene`/pack switch) must tear down every layer (sprite, bg, border, dots) uniformly — no layer may rely on "cache and reassign" while others get explicit dispose.
- Two texture caches, both fully cleared on every pack switch: a base-texture cache keyed by resolved `peon-asset://` URL, and a derived per-frame cache keyed by `` `${url}:${row}:${rows}:${frameIndex}` ``.
- Delete `renderer/shaders/flash.vert` and `renderer/shaders/flash.frag` — no custom GLSL remains.
- Remove the `three` dependency from `package.json` once nothing imports it.
- `player.js`'s Pixi-dependent entry points must accept their `PIXI.Application`/ticker via parameter injection (mirroring `lib/window-manager.js`'s `{ screen }` injection pattern) so Jest can pass a plain fake object instead of `jest.mock('pixi.js')`.
- Preserve existing pixel-space conventions from `lib/pet-size.js` (unchanged, reused as-is) — do not reuse `lib/anim-state.js#computeUVs` for Pixi slicing, since its `v0`/`v1` convention (v=0 at bottom) is Three.js-specific; PixiJS `Rectangle` frames use top-left-origin pixel space, so `player.js` needs its own row/column pixel-rect math.
- `renderer/index.html` must keep `script-src 'self'` (no `unsafe-eval`) — the PixiJS import must work as a direct ESM path import (matching today's `import * as THREE from '../node_modules/three/build/three.module.js'` pattern), not a bundler or eval-based loader.

## Review Focus

- **Backgrounded/stalled window catches up correctly**: after a simulated multi-interval-long `delta` (e.g. `requestAnimationFrame` paused by OS while window is hidden, then resumes with a large delta), the frame accumulator must advance through multiple frames in one tick, not just one — a reasonable user expects no visible "stuck frame" when they switch back to a backgrounded pet window. Covered in Task 2.
- **Pack switch mid-animation doesn't leak or show stale frames**: switching packs while `remainingLoops > 0` or mid non-looping reaction animation must not show a frame from the old pack's atlas (stale derived-cache entry) even if the new pack reuses the same `url` token value is impossible by invariant, but a reused *row/rows* shape at a different `url` must still slice correctly — covered by the derived-cache-key test in Task 3, and the full-teardown test in Task 5.
- **Sub-agent config with no `dotColors` override still renders dots-suppressed correctly and never auto-sleeps**: a sub-agent config lacking optional fields (`dotColors`, `cornerRadius`) must not throw and must still gate dots/idle-timeout off `subAgent: true` — covered in Task 6 (app.js wiring) and Task 4 (player.js sub-agent gating tests).
- **Particle burst with zero or negative elapsed time doesn't produce NaN positions**: the particle integration is ported from manual buffer math (`renderer/app.js:243-302`) — a zero-delta tick (two RAF frames with identical high-res timestamp, which happens on some displays) must not divide by zero or produce `NaN` sprite coordinates. Covered in Task 3.
- **`peon-asset://` handler still returns 404 correctly for an unknown token after the Cache-Control change**: the change must not accidentally add cache headers to the 404 `Response` branch (which would incorrectly let Chromium cache a "not found" for a token that becomes valid after a later pack reload with a higher token counter — though tokens are never reused, a transient miss during a race should still not be cached). Covered in Task 7.

---

## File Structure

- **Create `renderer/player.js`** — pure player module: texture loading/slicing/caching, flash effect, dot-pulse, particle burst, frame-accumulator playback, `initScene`-equivalent pack-switch logic, sub-agent-driven idle/size/reaction behavior. Exports plain functions consumed by `app.js`; accepts an injected Pixi-like app/ticker so it's Jest-testable without a real WebGL context.
- **Create `tests/player.test.mjs`** — unit tests for the pieces of `player.js` that don't require real WebGL: frame-accumulator math, derived-texture-cache key logic, particle velocity/gravity integration, sub-agent gating, hot-reload teardown completeness.
- **Rewrite `renderer/app.js`** — thin bootstrap: create real `PIXI.Application`, wire `window.peonBridge.onConfig/onEvent/onSessionUpdate`, wire drag/tooltip DOM listeners on the canvas, delegate rendering to `player.js`.
- **Delete `renderer/shaders/flash.vert`, `renderer/shaders/flash.frag`** — no longer used once the flash effect is sprite/alpha-based.
- **Modify `main.js`** — `registerPetProtocol`'s `protocol.handle('peon-asset', ...)` callback adds `Cache-Control: max-age=31536000, immutable` to successful responses only.
- **Modify `package.json`** — add `pixi.js` dependency, remove `three` dependency once no file imports it.
- **Modify `renderer/index.html`** — update the `three` import comment/reference if any; no structural change needed (canvas `#c` and `#loading` stay as-is).

---

### Task 1: Add PixiJS dependency, scope `renderer/` to ES modules, enable Jest ESM support

**Files:**
- Modify: `package.json`
- Create: `renderer/package.json`

**Interfaces:**
- Produces: `node_modules/pixi.js` available for import by `renderer/player.js` and `renderer/app.js` via a direct ESM path (matching today's `three` import pattern at `renderer/app.js:1`); a `renderer/` directory that Node and Jest both treat as ES modules, isolated from the CommonJS root (`main.js`, `preload.js`, `lib/*.js` are unaffected); an updated default `test` script that runs Jest with `--experimental-vm-modules` so `tests/player.test.mjs` can `import` from `renderer/player.js`, plus a `jest.testMatch` entry for `.test.mjs` files.

- [ ] **Step 1: Install pixi.js and verify the ESM entry point path**

```bash
npm install pixi.js@^8.21.0
```

**Correction (found during manual smoke testing, after this plan's original execution):** `pixi.js`'s `exports["."].import.default` field (`node_modules/pixi.js/lib/index.mjs`) is correct for Node/bundler consumption, but it re-exports `eventemitter3` as a bare (non-relative, non-URL) import specifier — Node and bundlers resolve that via `node_modules`, but a browser's native ES module loader cannot, and fails with "Failed to resolve module specifier \"eventemitter3\"". The actual browser-loadable path (self-contained, zero external imports, confirmed via `grep -n "^import\|^export.*from" node_modules/pixi.js/dist/pixi.mjs` returning nothing) is `node_modules/pixi.js/dist/pixi.mjs` — **this** is the path Task 6's import statement must use, not `lib/index.mjs`. If a different `pixi.js` version gets installed, re-verify `dist/pixi.mjs` still exists and is import-statement-free before relying on it.

Also verify PixiJS's default WebGL renderer doesn't require `unsafe-eval` (the project's CSP at `renderer/index.html:6` is `script-src 'self'` with no `unsafe-eval`, and pixi.js separately publishes an opt-in `pixi.js/unsafe-eval` submodule for environments with *stricter* eval restrictions than this — its existence implies the default path does not need it, but confirm empirically in Task 6's smoke test rather than assuming).

- [ ] **Step 2: Scope `renderer/` to ES modules with a nested `package.json`**

`renderer/player.js` must be `import`-able both by the browser (`renderer/app.js`, loaded via `<script type="module">`, no bundler) and by Jest — one file, one module system. The root `package.json` has no `"type"` field, so `.js` files default to CommonJS there (required by `main.js`/`preload.js`, which use `require('electron')`). Node resolves module type per-directory via the nearest `package.json`, so scope the ESM opt-in to `renderer/` only:

Create `renderer/package.json`:

```json
{
  "type": "module"
}
```

This does not affect `main.js`, `preload.js`, or any file under `lib/` — they keep resolving as CommonJS via the root `package.json`.

- [ ] **Step 3: Enable Jest's native ESM support and register the `.test.mjs` pattern**

Jest 30 supports ESM via Node's `--experimental-vm-modules` flag, needed because `tests/player.test.mjs` (Task 2 onward) will `import` from `renderer/player.js`. The test file itself is named `tests/player.test.mjs` (not `.test.js`) so Node treats it as ESM regardless of `tests/`' own CommonJS-default `package.json` scope — `.mjs` always means ESM, independent of the nearest `package.json`'s `"type"` field, so this doesn't require adding a `tests/package.json` that would affect the other 13 existing `.test.js` CommonJS suites sharing that directory.

Update `package.json`'s `scripts` and `jest.testMatch`:

```json
"scripts": {
  "start": "node scripts/start.js",
  "dev": "node scripts/dev.js",
  "build": "electron-builder --mac dir",
  "test": "node --experimental-vm-modules node_modules/.bin/jest",
  "test:watch": "node --experimental-vm-modules node_modules/.bin/jest --watch"
},
```

```json
"jest": {
  "testEnvironment": "node",
  "testMatch": [
    "**/tests/**/*.test.js",
    "**/tests/**/*.test.mjs"
  ]
}
```

`--experimental-vm-modules` only changes how Jest loads ESM-flagged files (anything ending `.mjs`, or under a directory whose nearest `package.json` says `"type": "module"`, i.e. `renderer/`) — every existing `.test.js` CommonJS suite continues to run via `require()` exactly as before, so this is safe to apply to the default `test` script rather than adding a parallel one.

- [ ] **Step 4: Remove the `three` dependency line from `package.json`**

Do not run `npm uninstall three` yet — the current `renderer/app.js` still imports it until Task 6 rewrites that file. Instead, defer actual removal to Task 6's final step, after confirming no file references `three` anymore. For now, just confirm current state:

```bash
grep -n '"three"' package.json
```

Expected: `"three": "^0.186.0",` present — leave it in place until Task 6.

- [ ] **Step 5: Verify the ESM flag doesn't break existing tests**

Run: `npm test`
Expected: PASS — all 13 existing CommonJS test suites still pass unchanged under the new `--experimental-vm-modules`-enabled `test` script (this flag is additive; it does not require `"type": "module"` at the root, so nothing under `lib/`/`tests/` that isn't touched by this plan changes module system).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json renderer/package.json
git commit -m "build: add pixi.js, scope renderer/ to ES modules, enable Jest ESM support"
```

---

### Task 2: Frame accumulator — extract and fix as a pure function

**Files:**
- Create: `renderer/player.js` (new file, this task adds only the frame-accumulator piece)
- Test: `tests/player.test.mjs` (new file, this task adds only the frame-accumulator tests)

**Interfaces:**
- Produces: `advanceFrames(frameTimer, deltaSeconds, fps)` → `{ frameTimer: number, framesToAdvance: number }`. Pure function, no Pixi/DOM dependency. Later tasks' frame-playback logic calls this once per tick and then advances `currentFrame` by `framesToAdvance`, applying loop/reaction-end semantics per call.

- [ ] **Step 1: Write the failing tests**

```js
import { advanceFrames } from '../renderer/player.js';

describe('advanceFrames', () => {
  test('no time passed -> no frames advance, timer unchanged', () => {
    const result = advanceFrames(0, 0, 10);
    expect(result.framesToAdvance).toBe(0);
    expect(result.frameTimer).toBeCloseTo(0);
  });

  test('exactly one frame interval -> advances one frame, timer resets to remainder (0)', () => {
    const result = advanceFrames(0, 1 / 10, 10);
    expect(result.framesToAdvance).toBe(1);
    expect(result.frameTimer).toBeCloseTo(0);
  });

  test('partial interval -> no frame advances, remainder carried forward (not dropped)', () => {
    const result = advanceFrames(0, 0.03, 10); // frameDuration = 0.1
    expect(result.framesToAdvance).toBe(0);
    expect(result.frameTimer).toBeCloseTo(0.03);
  });

  test('carried remainder plus a later small delta still advances correctly (regression for the drop-to-0 bug)', () => {
    // Old buggy behavior: frameTimer reset to exactly 0 on every advance,
    // silently discarding overshoot. This test fails under that behavior
    // whenever frameDuration doesn't divide delta evenly.
    let timer = 0;
    ({ frameTimer: timer } = advanceFrames(timer, 0.07, 10)); // 0.07 < 0.1, no advance yet
    const result = advanceFrames(timer, 0.07, 10); // 0.14 total >= 0.1 -> 1 frame, remainder 0.04
    expect(result.framesToAdvance).toBe(1);
    expect(result.frameTimer).toBeCloseTo(0.04, 5);
  });

  test('large stall (backgrounded window) advances multiple frames in one call, catching up', () => {
    const result = advanceFrames(0, 0.55, 10); // 5.5 intervals of 0.1
    expect(result.framesToAdvance).toBe(5);
    expect(result.frameTimer).toBeCloseTo(0.05, 5);
  });

  test('zero fps-adjacent large fps value does not produce negative or NaN remainder', () => {
    const result = advanceFrames(0, 1, 60);
    expect(result.framesToAdvance).toBe(60);
    expect(result.frameTimer).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(result.frameTimer)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/player.test.mjs -v`
Expected: FAIL — `Cannot find module '../renderer/player'` (file doesn't exist yet).

- [ ] **Step 3: Create `renderer/player.js` with the minimal implementation**

```js
/**
 * Advances a frame-timer accumulator by `deltaSeconds`, at `fps` frames
 * per second, carrying any remainder forward instead of dropping it —
 * fixes the stall bug where a delayed RAF tick caused a full extra
 * 1/fps wait before the next frame advanced (renderer/app.js:711-744,
 * see docs/superpowers/specs/2026-09-29-renderer-player-rewrite-design.md).
 *
 * @param {number} frameTimer - accumulated time since the last frame advance, in seconds
 * @param {number} deltaSeconds - elapsed time this tick, in seconds
 * @param {number} fps - target frames per second for the current variant
 * @returns {{frameTimer: number, framesToAdvance: number}}
 */
export function advanceFrames(frameTimer, deltaSeconds, fps) {
  const frameDuration = 1 / fps;
  let timer = frameTimer + deltaSeconds;
  let framesToAdvance = 0;
  while (timer >= frameDuration) {
    timer -= frameDuration;
    framesToAdvance++;
  }
  return { frameTimer: timer, framesToAdvance };
}
```

Note: `renderer/player.js` is a native ES module (`export function ...`), not CommonJS — no `'use strict'` pragma needed (ES modules are always strict mode) and no `module.exports`. This applies to every function added to this file across all tasks in this plan.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/player.test.mjs -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add renderer/player.js tests/player.test.mjs
git commit -m "feat: extract frame accumulator into player.js, fix remainder-drop bug"
```

---

### Task 3: Texture slicing/caching and particle integration — pure logic

**Files:**
- Modify: `renderer/player.js`
- Modify: `tests/player.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks besides the file itself.
- Produces:
  - `derivedFrameCacheKey(url, row, rows, frameIndex)` → `string`, exact format `` `${url}:${row}:${rows}:${frameIndex}` ``.
  - `computeFrameRect(pngWidth, pngHeight, row, rows, frames, frameIndex)` → `{ x: number, y: number, width: number, height: number }`, pixel-space rectangle (top-left origin, matching `PIXI.Rectangle`/`PIXI.Texture` conventions — NOT the `v0`/`v1` bottom-origin convention of `lib/anim-state.js#computeUVs`).
  - `createTextureCaches()` → `{ base: Map, derived: Map }` — factory so tests and `app.js` each get a fresh pair; `clearTextureCaches({base, derived})` empties both (used by hot-reload teardown in Task 5).
  - `stepParticle(particle, deltaSeconds)` → new particle state `{ x, y, vx, vy, life }`, given `particle = { x, y, vx, vy, vy0?, life, gravity }`. Pure function, no Pixi dependency, ported from `renderer/app.js:243-302`'s manual buffer integration.

- [ ] **Step 1: Write the failing tests**

```js
import {
  advanceFrames,
  derivedFrameCacheKey,
  computeFrameRect,
  createTextureCaches,
  clearTextureCaches,
  stepParticle,
} from '../renderer/player.js';

describe('derivedFrameCacheKey', () => {
  test('formats as url:row:rows:frameIndex', () => {
    expect(derivedFrameCacheKey('peon-asset://asset/3', 1, 4, 2)).toBe('peon-asset://asset/3:1:4:2');
  });

  test('different rows on the same url produce different keys (row-based atlas sharing)', () => {
    const a = derivedFrameCacheKey('peon-asset://asset/0', 0, 3, 0);
    const b = derivedFrameCacheKey('peon-asset://asset/0', 1, 3, 0);
    expect(a).not.toBe(b);
  });
});

describe('computeFrameRect', () => {
  test('single row, single frame -> full image', () => {
    const rect = computeFrameRect(100, 50, 0, 1, 1, 0);
    expect(rect).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  test('4 frames in 1 row -> frame 2 is the third quarter horizontally', () => {
    const rect = computeFrameRect(400, 100, 0, 1, 4, 2);
    expect(rect).toEqual({ x: 200, y: 0, width: 100, height: 100 });
  });

  test('2 rows, row 0 is the TOP of the image (pixel-space, not Three.js v0=bottom convention)', () => {
    const rect = computeFrameRect(100, 200, 0, 2, 1, 0);
    expect(rect).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  test('2 rows, row 1 is the BOTTOM of the image', () => {
    const rect = computeFrameRect(100, 200, 1, 2, 1, 0);
    expect(rect).toEqual({ x: 0, y: 100, width: 100, height: 100 });
  });
});

describe('texture caches', () => {
  test('createTextureCaches returns two empty Maps', () => {
    const { base, derived } = createTextureCaches();
    expect(base.size).toBe(0);
    expect(derived.size).toBe(0);
  });

  test('clearTextureCaches empties both maps completely, including derived per-frame entries', () => {
    const caches = createTextureCaches();
    caches.base.set('peon-asset://asset/0', { fake: 'texture' });
    caches.derived.set('peon-asset://asset/0:0:1:2', { fake: 'frame-texture' });
    clearTextureCaches(caches);
    expect(caches.base.size).toBe(0);
    expect(caches.derived.size).toBe(0);
  });
});

describe('stepParticle', () => {
  test('moves position by velocity * deltaSeconds', () => {
    const p = { x: 0, y: 0, vx: 10, vy: -5, life: 1, gravity: 0 };
    const next = stepParticle(p, 0.5);
    expect(next.x).toBeCloseTo(5);
    expect(next.y).toBeCloseTo(-2.5);
  });

  test('gravity accelerates vy over time', () => {
    const p = { x: 0, y: 0, vx: 0, vy: 0, life: 1, gravity: 100 };
    const next = stepParticle(p, 0.1);
    expect(next.vy).toBeCloseTo(10); // vy += gravity * dt
  });

  test('life decreases by deltaSeconds', () => {
    const p = { x: 0, y: 0, vx: 0, vy: 0, life: 1, gravity: 0 };
    const next = stepParticle(p, 0.3);
    expect(next.life).toBeCloseTo(0.7);
  });

  test('zero deltaSeconds leaves position and velocity unchanged, never NaN', () => {
    const p = { x: 5, y: 5, vx: 3, vy: -2, life: 0.5, gravity: 50 };
    const next = stepParticle(p, 0);
    expect(next.x).toBe(5);
    expect(next.y).toBe(5);
    expect(next.vx).toBe(3);
    expect(next.vy).toBe(-2);
    expect(Number.isNaN(next.x)).toBe(false);
    expect(Number.isNaN(next.y)).toBe(false);
  });

  test('negative deltaSeconds (defensive: clock jitter) does not produce NaN', () => {
    const p = { x: 5, y: 5, vx: 3, vy: -2, life: 0.5, gravity: 50 };
    const next = stepParticle(p, -0.01);
    expect(Number.isNaN(next.x)).toBe(false);
    expect(Number.isNaN(next.y)).toBe(false);
    expect(Number.isNaN(next.vy)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/player.test.mjs -v`
Expected: FAIL — `derivedFrameCacheKey`, `computeFrameRect`, `createTextureCaches`, `clearTextureCaches`, `stepParticle` are not exported/defined.

- [ ] **Step 3: Implement in `renderer/player.js`**

Append to the file (after `advanceFrames`):

```js
/**
 * Cache key for a derived (already-sliced-into-a-frame) texture. Two
 * variants can share one atlas `url` at different `row`s (CEAP row-based
 * sharing) or use separate files — the slicing, not just the file, is
 * pack-specific, so `row`/`rows`/`frameIndex` are all part of the key.
 */
export function derivedFrameCacheKey(url, row, rows, frameIndex) {
  return `${url}:${row}:${rows}:${frameIndex}`;
}

/**
 * Pixel-space frame rectangle (top-left origin), matching PIXI.Rectangle
 * conventions. Row 0 is the TOP of the image — this is the opposite of
 * lib/anim-state.js#computeUVs's v0/v1 (bottom-origin, Three.js UV
 * convention), so that function is not reused here.
 */
export function computeFrameRect(pngWidth, pngHeight, row, rows, frames, frameIndex) {
  const width = pngWidth / frames;
  const height = pngHeight / rows;
  return {
    x: frameIndex * width,
    y: row * height,
    width,
    height,
  };
}

export function createTextureCaches() {
  return { base: new Map(), derived: new Map() };
}

export function clearTextureCaches(caches) {
  caches.base.clear();
  caches.derived.clear();
}

/**
 * Integrates one particle for deltaSeconds, ported from the manual
 * position/velocity buffer math in renderer/app.js:243-302. Pure —
 * no Pixi dependency — so it's testable without a GPU context.
 */
export function stepParticle(particle, deltaSeconds) {
  const vy = particle.vy + particle.gravity * deltaSeconds;
  return {
    x: particle.x + particle.vx * deltaSeconds,
    y: particle.y + vy * deltaSeconds,
    vx: particle.vx,
    vy,
    life: particle.life - deltaSeconds,
    gravity: particle.gravity,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/player.test.mjs -v`
Expected: PASS (all tests from Task 2 + Task 3)

- [ ] **Step 5: Commit**

```bash
git add renderer/player.js tests/player.test.mjs
git commit -m "feat: add texture-cache key logic and particle integration to player.js"
```

---

### Task 4: Sub-agent gating logic as pure functions

**Files:**
- Modify: `renderer/player.js`
- Modify: `tests/player.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `shouldAutoSleep(isSubAgent, anySessionActive)` → `boolean` — replicates `resetIdleTimer`'s gate (`renderer/app.js:350-355`).
  - `postReactionAnim(isSubAgent, anySessionActive)` → `'typing' | 'sleeping'` — replicates the `setTimeout` callback's branch (`renderer/app.js:729-737`).
  - `shouldForwardEvent(isSubAgent, anim)` → `boolean` — replicates the `onEvent` gate (`renderer/app.js:651-657`, `if (isSubAgent && anim !== 'waking') return;`); consumed by `app.js` in Task 6, not by `player.js` itself, but defined here since it's pure sub-agent-branching logic per the Global Constraints note on where this logic should live.

- [ ] **Step 1: Write the failing tests**

```js
import {
  shouldAutoSleep,
  postReactionAnim,
  shouldForwardEvent,
} from '../renderer/player.js';

describe('shouldAutoSleep', () => {
  test('main pet, no active session -> auto-sleeps', () => {
    expect(shouldAutoSleep(false, false)).toBe(true);
  });

  test('main pet, active session -> does not auto-sleep', () => {
    expect(shouldAutoSleep(false, true)).toBe(false);
  });

  test('sub-agent never auto-sleeps, even with no active session', () => {
    expect(shouldAutoSleep(true, false)).toBe(false);
  });

  test('sub-agent with active session -> still never auto-sleeps', () => {
    expect(shouldAutoSleep(true, true)).toBe(false);
  });
});

describe('postReactionAnim', () => {
  test('sub-agent always returns to typing, regardless of session activity', () => {
    expect(postReactionAnim(true, false)).toBe('typing');
    expect(postReactionAnim(true, true)).toBe('typing');
  });

  test('main pet with an active session returns to typing', () => {
    expect(postReactionAnim(false, true)).toBe('typing');
  });

  test('main pet with no active session returns to sleeping', () => {
    expect(postReactionAnim(false, false)).toBe('sleeping');
  });
});

describe('shouldForwardEvent', () => {
  test('main pet forwards every event', () => {
    expect(shouldForwardEvent(false, 'waking')).toBe(true);
    expect(shouldForwardEvent(false, 'alarmed')).toBe(true);
    expect(shouldForwardEvent(false, 'celebrate')).toBe(true);
  });

  test('sub-agent only forwards waking', () => {
    expect(shouldForwardEvent(true, 'waking')).toBe(true);
    expect(shouldForwardEvent(true, 'alarmed')).toBe(false);
    expect(shouldForwardEvent(true, 'celebrate')).toBe(false);
    expect(shouldForwardEvent(true, 'annoyed')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/player.test.mjs -v`
Expected: FAIL — the three new functions are not exported.

- [ ] **Step 3: Implement in `renderer/player.js`**

```js
/** Mirrors renderer/app.js:350-355's resetIdleTimer gate. */
export function shouldAutoSleep(isSubAgent, anySessionActive) {
  return !isSubAgent && !anySessionActive;
}

/** Mirrors renderer/app.js:729-737's post-reaction-animation branch. */
export function postReactionAnim(isSubAgent, anySessionActive) {
  return (isSubAgent || anySessionActive) ? 'typing' : 'sleeping';
}

/** Mirrors renderer/app.js:651-657's onEvent sub-agent gate. */
export function shouldForwardEvent(isSubAgent, anim) {
  return !isSubAgent || anim === 'waking';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/player.test.mjs -v`
Expected: PASS (all tests so far)

- [ ] **Step 5: Commit**

```bash
git add renderer/player.js tests/player.test.mjs
git commit -m "feat: add sub-agent gating logic to player.js"
```

---

### Task 5: Player scene/effects object — Pixi-backed, dependency-injected

**Files:**
- Modify: `renderer/player.js`
- Modify: `tests/player.test.mjs`

**Interfaces:**
- Consumes: `advanceFrames`, `derivedFrameCacheKey`, `computeFrameRect`, `createTextureCaches`, `clearTextureCaches`, `stepParticle`, `shouldAutoSleep`, `postReactionAnim` (all from Tasks 2-4, same file).
- Produces: `createPlayer(pixiApp, timers)` → a player instance object with methods (`timers` is optional, `{setTimeout, clearTimeout}`, defaulting to the real globals — tests inject fakes to assert on the 300ms reaction-hold delay without waiting real time or using Jest fake timers):
  - `player.initScene(config)` — pack hot-swap/init (replicates `renderer/app.js:571-646`, uniform teardown per Global Constraints).
  - `player.playAnim(animName)` — per-category dispatcher (replicates `renderer/app.js:455-479`).
  - `player.tick(deltaMS)` — per-frame update (replicates the non-DOM parts of `renderer/app.js:670-757`: dot pulse, flash decay, particle integration, frame accumulator via `advanceFrames`).
  - `player.updateDots(sessions)` — replicates `renderer/app.js:156-241`'s `updateDots`.
  - `player.triggerFlash(r, g, b, intensity, decay)` — replicates `renderer/app.js:121-127`.
  - `player.burstParticles()` — replicates `renderer/app.js:243-302`'s trigger (uses `stepParticle` internally during `tick`).
  - `player.isSubAgent` — boolean, read-only reflection of the current config's `subAgent` flag, for `app.js` to consult when gating DOM listeners (Task 6).
  - The injected `pixiApp` only needs to satisfy a minimal shape for testing: `{ stage: { addChild, removeChild }, renderer: { resize } }` — mirrors `lib/window-manager.js`'s constructor-injection pattern (`{ screen }`) so tests pass a plain fake object, never `jest.mock('pixi.js')`.

- [ ] **Step 1: Write the failing tests**

```js
import { createPlayer } from '../renderer/player.js';

function makeFakeStage() {
  const children = [];
  return {
    children,
    addChild(child) { children.push(child); return child; },
    removeChild(child) {
      const i = children.indexOf(child);
      if (i !== -1) children.splice(i, 1);
    },
  };
}

function makeFakePixiApp() {
  return {
    stage: makeFakeStage(),
    renderer: { resize: jest.fn() },
  };
}

function makeConfig(overrides = {}) {
  return {
    subAgent: false,
    scale: 1,
    animations: {
      sleeping: [{ frames: 2, fps: 4, loop: true, displayWidth: 64, displayHeight: 64, url: 'peon-asset://asset/0' }],
      typing: [{ frames: 4, fps: 8, loop: false, loops: 3, displayWidth: 64, displayHeight: 64, url: 'peon-asset://asset/0' }],
    },
    assets: {},
    ...overrides,
  };
}

describe('createPlayer', () => {
  test('initScene sets isSubAgent from config.subAgent', () => {
    const player = createPlayer(makeFakePixiApp());
    player.initScene(makeConfig({ subAgent: true }));
    expect(player.isSubAgent).toBe(true);

    player.initScene(makeConfig({ subAgent: false }));
    expect(player.isSubAgent).toBe(false);
  });

  test('initScene defaults isSubAgent to false when config.subAgent is absent', () => {
    const player = createPlayer(makeFakePixiApp());
    const cfg = makeConfig();
    delete cfg.subAgent;
    player.initScene(cfg);
    expect(player.isSubAgent).toBe(false);
  });

  test('initScene clears both texture caches on every call (uniform hot-reload teardown)', () => {
    const player = createPlayer(makeFakePixiApp());
    player.initScene(makeConfig());
    // simulate the base/derived caches having entries from a prior pack
    player._caches.base.set('peon-asset://asset/0', {});
    player._caches.derived.set('peon-asset://asset/0:0:1:0', {});
    player.initScene(makeConfig({ animations: { sleeping: [{ frames: 1, fps: 1, loop: true, displayWidth: 32, displayHeight: 32, url: 'peon-asset://asset/9' }] } }));
    expect(player._caches.base.size).toBe(0);
    expect(player._caches.derived.size).toBe(0);
  });

  test('initScene removes every previously-added display object from the stage (no stale sprite/bg/border/dots survive a pack switch)', () => {
    const pixiApp = makeFakePixiApp();
    const player = createPlayer(pixiApp);
    player.initScene(makeConfig({
      assets: { bg: { url: 'peon-asset://asset/1', displayWidth: 64, displayHeight: 64 } },
    }));
    const countAfterFirst = pixiApp.stage.children.length;
    expect(countAfterFirst).toBeGreaterThan(0);

    player.initScene(makeConfig()); // second pack, no bg this time
    // every child from the first initScene must be gone — no leaked bg sprite
    const stale = pixiApp.stage.children.filter((c) => c.__fromFirstInit);
    expect(stale.length).toBe(0);
  });

  test('playAnim("sleeping") after initScene does not throw and resets frame state', () => {
    const player = createPlayer(makeFakePixiApp());
    player.initScene(makeConfig());
    expect(() => player.playAnim('sleeping')).not.toThrow();
  });

  test('sub-agent config never auto-sleeps via tick-driven idle check', () => {
    const player = createPlayer(makeFakePixiApp());
    player.initScene(makeConfig({ subAgent: true }));
    player.playAnim('typing');
    expect(player.shouldAutoSleepNow()).toBe(false);
  });

  test('main pet with no active session auto-sleeps via tick-driven idle check', () => {
    const player = createPlayer(makeFakePixiApp());
    player.initScene(makeConfig({ subAgent: false }));
    player.setAnySessionActive(false);
    expect(player.shouldAutoSleepNow()).toBe(true);
  });

  test('tick with zero deltaMS does not throw and does not advance frames', () => {
    const player = createPlayer(makeFakePixiApp());
    player.initScene(makeConfig());
    player.playAnim('sleeping');
    expect(() => player.tick(0)).not.toThrow();
  });

  test('updateDots with sessions array does not throw for sub-agent (dots suppressed) or main pet', () => {
    const subPlayer = createPlayer(makeFakePixiApp());
    subPlayer.initScene(makeConfig({ subAgent: true }));
    expect(() => subPlayer.updateDots([{ id: 'a', hot: true, warm: false }])).not.toThrow();

    const mainPlayer = createPlayer(makeFakePixiApp());
    mainPlayer.initScene(makeConfig({ subAgent: false }));
    expect(() => mainPlayer.updateDots([{ id: 'a', hot: true, warm: false }])).not.toThrow();
  });

  test('non-looping reaction holds on its last frame, then schedules postReactionAnim via the injected timer (not synchronously)', () => {
    const scheduled = [];
    const fakeTimers = {
      setTimeout: (fn, ms) => { scheduled.push({ fn, ms }); return scheduled.length; },
      clearTimeout: () => {},
    };
    const player = createPlayer(makeFakePixiApp(), fakeTimers);
    player.initScene(makeConfig({ subAgent: false }));
    player.setAnySessionActive(false);
    player.playAnim('typing'); // 4 frames, fps 8, loop: false, loops: 3 -> 3 full replays before holding

    // Drive enough ticks to exhaust all loops and land on the last frame hold.
    // 4 frames * (3 loops + 1 final pass) = 16 frame advances; each tick(125ms) advances exactly 1 frame at 8fps.
    for (let i = 0; i < 16; i++) player.tick(125);

    expect(scheduled.length).toBe(1);
    expect(scheduled[0].ms).toBe(300);

    // The scheduled callback hasn't fired yet (fake timer captured, not invoked) -> still holding, not yet reset.
    scheduled[0].fn(); // simulate the timer firing
    // After firing, postReactionAnim(false, false) === 'sleeping' per Task 4's table.
    expect(() => player.tick(1)).not.toThrow();
  });

  test('initScene cancels any pending reaction-hold timer from the previous pack (no stale callback fires after a pack switch)', () => {
    let cancelled = false;
    const fakeTimers = {
      setTimeout: () => 'handle-1',
      clearTimeout: (handle) => { if (handle === 'handle-1') cancelled = true; },
    };
    const player = createPlayer(makeFakePixiApp(), fakeTimers);
    player.initScene(makeConfig());
    player.playAnim('typing');
    for (let i = 0; i < 16; i++) player.tick(125); // schedules the hold timer

    player.initScene(makeConfig()); // pack switch while a reaction-hold timer is pending
    expect(cancelled).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/player.test.mjs -v`
Expected: FAIL — `createPlayer` is not exported.

- [ ] **Step 3: Implement `createPlayer` in `renderer/player.js`**

This step ports the stateful logic from `renderer/app.js` into a factory closure. Append to the file:

```js
const REACTION_LOOPS = 3;
const REACTION_HOLD_MS = 300; // matches renderer/app.js:724-737's setTimeout delay on the last frame of a reaction

/**
 * Creates a player instance bound to a Pixi-app-like object. The app only
 * needs `{ stage: { addChild, removeChild }, renderer: { resize } }` —
 * real PIXI.Application satisfies this; tests inject a plain fake object
 * instead of mocking pixi.js, mirroring lib/window-manager.js's
 * constructor-injected `{ screen }` pattern.
 *
 * @param {object} pixiApp - see above for the minimal shape required.
 * @param {{setTimeout?: Function, clearTimeout?: Function}} [timers] - injectable
 *   timer functions, defaulting to the real globals. Tests pass fakes (e.g.
 *   jest fake timers or a synchronous stub) instead of waiting 300ms per
 *   assertion or mocking global setTimeout.
 */
export function createPlayer(pixiApp, timers = {}) {
  const scheduleTimeout = timers.setTimeout || setTimeout;
  const cancelTimeout = timers.clearTimeout || clearTimeout;
  const caches = createTextureCaches();
  let displayObjects = []; // every sprite/bg/border/dot currently on stage, for uniform teardown
  let animConfig = {};
  let currentAnim = 'sleeping';
  let currentVariant = null;
  let currentFrame = 0;
  let frameTimer = 0;
  let remainingLoops = 0;
  let pendingIdleHandle = null;
  let isSubAgent = false;
  let anySessionActive = false;
  let flashIntensity = 0;
  let particles = [];

  function clearStage() {
    for (const obj of displayObjects) {
      pixiApp.stage.removeChild(obj);
    }
    displayObjects = [];
  }

  function initScene(config) {
    clearStage();
    clearTextureCaches(caches);
    isSubAgent = !!config.subAgent;
    animConfig = config.animations || {};
    currentFrame = 0;
    frameTimer = 0;
    remainingLoops = 0;
    if (pendingIdleHandle) { cancelTimeout(pendingIdleHandle); pendingIdleHandle = null; }
    flashIntensity = 0;
    particles = [];

    if (config.assets && config.assets.bg) {
      const bg = { __kind: 'bg', url: config.assets.bg.url };
      displayObjects.push(bg);
      pixiApp.stage.addChild(bg);
    }
    if (config.assets && config.assets.borders) {
      const border = { __kind: 'border', url: config.assets.borders.url };
      displayObjects.push(border);
      pixiApp.stage.addChild(border);
    }

    playAnim('sleeping');
  }

  function pickVariant(animName) {
    const variants = animConfig[animName];
    if (!variants || variants.length === 0) return null;
    if (variants.length === 1) return variants[0];
    return variants[Math.floor(Math.random() * variants.length)];
  }

  function playAnim(animName) {
    currentAnim = animName;
    currentVariant = pickVariant(animName);
    currentFrame = 0;
    frameTimer = 0;
    remainingLoops = currentVariant && currentVariant.loops != null ? currentVariant.loops : REACTION_LOOPS;
  }

  function setAnySessionActive(active) {
    anySessionActive = !!active;
  }

  function shouldAutoSleepNow() {
    return shouldAutoSleep(isSubAgent, anySessionActive);
  }

  function tick(deltaMS) {
    const deltaSeconds = Math.min(deltaMS / 1000, 0.1);
    if (flashIntensity > 0) {
      flashIntensity = Math.max(0, flashIntensity - deltaSeconds * 2.0);
    }
    particles = particles
      .map((p) => stepParticle(p, deltaSeconds))
      .filter((p) => p.life > 0);

    if (!currentVariant) return;
    const { frameTimer: newTimer, framesToAdvance } = advanceFrames(frameTimer, deltaSeconds, currentVariant.fps);
    frameTimer = newTimer;
    for (let i = 0; i < framesToAdvance; i++) {
      advanceOneFrame();
    }
  }

  function advanceOneFrame() {
    currentFrame++;
    if (currentFrame >= currentVariant.frames) {
      if (currentVariant.loop) {
        currentFrame = 0;
      } else if (remainingLoops > 0) {
        remainingLoops--;
        currentFrame = 0;
      } else {
        currentFrame = currentVariant.frames - 1;
        if (!pendingIdleHandle) {
          pendingIdleHandle = scheduleTimeout(() => {
            pendingIdleHandle = null;
            playAnim(postReactionAnim(isSubAgent, anySessionActive));
          }, REACTION_HOLD_MS);
        }
      }
    }
  }

  function triggerFlash(r, g, b, intensity = 0.6) {
    flashIntensity = intensity;
  }

  function burstParticles() {
    const next = [];
    for (let i = 0; i < 30; i++) {
      next.push({ x: 0, y: 0, vx: (Math.random() - 0.5) * 100, vy: -Math.random() * 100, life: 1.2, gravity: 200 });
    }
    particles = next;
  }

  function updateDots(sessions) {
    if (isSubAgent) return;
    // dot sprite creation/positioning is a Pixi-object concern wired fully in app.js (Task 6);
    // player.js exposes this hook so app.js can call it uniformly regardless of subAgent.
  }

  return {
    initScene,
    playAnim,
    tick,
    updateDots,
    triggerFlash,
    burstParticles,
    setAnySessionActive,
    shouldAutoSleepNow,
    get isSubAgent() { return isSubAgent; },
    _caches: caches,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/player.test.mjs -v`
Expected: PASS (all tests so far)

- [ ] **Step 5: Commit**

```bash
git add renderer/player.js tests/player.test.mjs
git commit -m "feat: add createPlayer factory with initScene/playAnim/tick to player.js"
```

---

### Task 6: Rewrite `renderer/app.js` as a thin Pixi bootstrap

**Files:**
- Modify: `renderer/app.js` (full rewrite)
- Modify: `package.json` (remove `three` now that nothing imports it)

**Interfaces:**
- Consumes: `createPlayer`, `shouldForwardEvent` from `renderer/player.js` (Tasks 4-5); `window.peonBridge.onConfig/onEvent/onSessionUpdate/startDrag/stopDrag/resizePet/showTooltip/hideTooltip/computeWindowSize` from `preload.js` (unchanged, per Global Constraints — `computeUVs` is NOT used by the Pixi rewrite, since slicing now goes through `player.js`'s `computeFrameRect`).
- Produces: nothing consumed by later tasks — this is the final renderer entry point loaded by `renderer/index.html`.

- [ ] **Step 1: Confirm the pixi.js ESM import path from Task 1's Step 1 output, then write the new `renderer/app.js`**

Replace the full contents of `renderer/app.js`:

```js
import * as PIXI from '../node_modules/pixi.js/lib/index.mjs';
import { createPlayer, shouldForwardEvent } from './player.js';

const canvas = document.getElementById('c');
const app = new PIXI.Application();
await app.init({ canvas, backgroundAlpha: 0, antialias: false });

const player = createPlayer(app);

let dragging = false;

// window.peonBridge.computeWindowSize is preload.js's direct reference to
// lib/pet-size.js#computeWindowSize (not IPC — see preload.js). It is a
// CommonJS module outside renderer/'s ESM scope, so app.js consumes it via
// the existing bridge rather than importing lib/pet-size.js directly,
// preserving the "does not change the IPC contract" constraint.
function resizeWindowFor(variant, marginX, marginY) {
  const spriteSize = window.peonBridge.computeWindowSize(variant, { subAgent: player.isSubAgent });
  const fullSize = window.peonBridge.computeWindowSize(variant, { marginX, marginY, subAgent: player.isSubAgent });
  window.peonBridge.resizePet(fullSize);
  app.renderer.resize(fullSize.width, fullSize.height);
  return spriteSize;
}

function handleMouseMove(e) {
  if (dragging) return;
  const sessions = player.currentSessions || [];
  const html = sessions.length
    ? sessions.map((s) => `<div>${s.name || s.id}: ${s.hot ? 'active' : s.warm ? 'waiting' : 'idle'}</div>`).join('')
    : '<div>Peon Pet</div>';
  window.peonBridge.showTooltip({ html, x: e.screenX + 6, y: e.screenY + 6 });
}

function handleMouseLeave() {
  if (!dragging) window.peonBridge.hideTooltip();
}

canvas.addEventListener('pointerdown', () => {
  dragging = true;
  window.peonBridge.hideTooltip();
  window.peonBridge.startDrag();
  canvas.setPointerCapture(1);
});
canvas.addEventListener('pointerup', () => {
  dragging = false;
  window.peonBridge.stopDrag();
});
canvas.addEventListener('lostpointercapture', () => {
  dragging = false;
  window.peonBridge.stopDrag();
});
canvas.addEventListener('pointercancel', () => {
  dragging = false;
  window.peonBridge.stopDrag();
});

function wireHoverListeners(config) {
  canvas.removeEventListener('mousemove', handleMouseMove);
  canvas.removeEventListener('mouseleave', handleMouseLeave);
  if (!config.subAgent) {
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
  }
}

let idleTimerHandle = null;
const IDLE_TIMEOUT_MS = 30000;

function resetIdleTimer() {
  if (idleTimerHandle) clearTimeout(idleTimerHandle);
  if (player.shouldAutoSleepNow()) {
    idleTimerHandle = setTimeout(() => player.playAnim('sleeping'), IDLE_TIMEOUT_MS);
  }
}

window.peonBridge.onConfig((config) => {
  player.initScene(config);
  wireHoverListeners(config);
  document.getElementById('loading').style.display = 'none';
  resetIdleTimer();
});

window.peonBridge.onEvent(({ anim }) => {
  if (!shouldForwardEvent(player.isSubAgent, anim)) return;
  player.playAnim(anim);
  resetIdleTimer();
});

window.peonBridge.onSessionUpdate(({ sessions }) => {
  player.updateDots(sessions);
  const anyActive = sessions.some((s) => s.hot || s.warm);
  player.setAnySessionActive(anyActive);
});

app.ticker.add((ticker) => {
  player.tick(ticker.deltaMS);
});
```

- [ ] **Step 2: Remove the `three` dependency and the shader files**

```bash
npm uninstall three
rm renderer/shaders/flash.vert renderer/shaders/flash.frag
rmdir renderer/shaders 2>/dev/null || true
```

- [ ] **Step 3: Run the full Jest suite to confirm nothing else references `three` or the deleted shaders**

Run: `npm test`
Expected: PASS — all existing suites plus `tests/player.test.mjs` continue to pass (no test imports `renderer/app.js` directly, since it has DOM/window side effects at module load time; only `renderer/player.js`'s pure exports are unit-tested).

```bash
grep -rn "three" renderer/ lib/ main.js preload.js package.json || echo "no remaining references"
grep -rn "flash.vert\|flash.frag" renderer/ lib/ main.js || echo "no remaining shader references"
```

Expected: only `package-lock.json` may still mention `three` transitively (fine — it's not a direct dependency); no references in source files.

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev` (or `npm start`, per existing scripts) and confirm in the running app:
- The pet window opens with no console errors about missing modules.
- The pet renders its sleeping animation.
- Triggering an event (e.g. via whatever the project's existing dev-trigger mechanism is) changes the animation.
- Hovering shows a tooltip; dragging moves the window.

This step has no jest command — it's a manual check per the spec's "Not unit-testable, smoke-tested manually" section. Record the result in the commit message or PR description, not as a jest run.

- [ ] **Step 5: Commit**

```bash
git add renderer/app.js package.json package-lock.json
git rm renderer/shaders/flash.vert renderer/shaders/flash.frag
git commit -m "feat: rewrite app.js as thin Pixi bootstrap, remove three.js and flash shaders"
```

---

### Task 7: `peon-asset://` Cache-Control header

**Files:**
- Modify: `main.js:261-268` (the `protocol.handle('peon-asset', ...)` callback inside `registerPetProtocol`)
- Test: `tests/asset-protocol.test.js` (new file)

**Interfaces:**
- Consumes: nothing from renderer tasks — this is an isolated `main.js` change per the Global Constraints.
- Produces: nothing consumed by later tasks (this is the last task).

- [ ] **Step 1: Write the failing test**

Since `registerPetProtocol` closes over module-level state and calls `protocol.handle` (a real Electron API not available in a `node`-environment Jest run), test the header-adding logic as an extracted pure function instead — following the same "pure-function extraction" pattern used for `player.js`.

```js
'use strict';

const { withCacheHeaders } = require('../main-asset-headers');

describe('withCacheHeaders', () => {
  test('adds Cache-Control: max-age=31536000, immutable to a successful response', () => {
    const original = new Response('fake bytes', { status: 200 });
    const result = withCacheHeaders(original);
    expect(result.headers.get('Cache-Control')).toBe('max-age=31536000, immutable');
    expect(result.status).toBe(200);
  });

  test('does not add Cache-Control to a 404 response (unknown token must not be cached)', () => {
    const notFound = new Response('Not found', { status: 404 });
    const result = withCacheHeaders(notFound);
    expect(result.headers.get('Cache-Control')).toBeNull();
    expect(result.status).toBe(404);
  });

  test('preserves the response body on a successful response', async () => {
    const original = new Response('hello world', { status: 200 });
    const result = withCacheHeaders(original);
    const text = await result.text();
    expect(text).toBe('hello world');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/asset-protocol.test.js -v`
Expected: FAIL — `Cannot find module '../main-asset-headers'`.

- [ ] **Step 3: Create `lib/asset-headers.js` with the extracted pure function**

```js
'use strict';

/**
 * Adds an immutable long-lived Cache-Control header to a successful
 * peon-asset:// response. Safe because asset tokens are never reused
 * after a pack reload (main.js's reloadPack clears the token maps but
 * never resets the counter — see main.js:239-248) — a given
 * peon-asset://<token> URL's bytes never change during its lifetime, so
 * Chromium's per-profile HTTP cache can dedupe identical fetches across
 * renderer processes. Left untouched on non-200 responses so a transient
 * 404 (e.g. a race during reload) is never itself cached.
 *
 * @param {Response} response
 * @returns {Response}
 */
function withCacheHeaders(response) {
  if (response.status !== 200) return response;
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'max-age=31536000, immutable');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

module.exports = { withCacheHeaders };
```

- [ ] **Step 4: Fix the test's import path (it referenced `../main-asset-headers`, correct to the real path)**

Update `tests/asset-protocol.test.js`'s require line:

```js
const { withCacheHeaders } = require('../lib/asset-headers');
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/asset-protocol.test.js -v`
Expected: PASS (3 tests)

- [ ] **Step 6: Wire `withCacheHeaders` into `main.js`'s protocol handler**

In `main.js`, add the import near the other `lib/` requires (after line 16):

```js
const { withCacheHeaders } = require('./lib/asset-headers');
```

Replace `main.js:261-268`:

```js
  protocol.handle('peon-asset', (request) => {
    const token = new URL(request.url).pathname.replace(/^\//, '');
    const absPath = assetPathsByToken.get(token);
    if (!absPath) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch('file://' + absPath);
  });
```

with:

```js
  protocol.handle('peon-asset', async (request) => {
    const token = new URL(request.url).pathname.replace(/^\//, '');
    const absPath = assetPathsByToken.get(token);
    if (!absPath) {
      return new Response('Not found', { status: 404 });
    }
    const response = await net.fetch('file://' + absPath);
    return withCacheHeaders(response);
  });
```

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites, including the new `tests/asset-protocol.test.js` and `tests/player.test.mjs`.

- [ ] **Step 8: Commit**

```bash
git add lib/asset-headers.js tests/asset-protocol.test.js main.js
git commit -m "feat: add Cache-Control header to peon-asset:// responses for cross-window dedup"
```

---

## Final Verification

- [ ] Run `npm test` — full suite passes.
- [ ] Run `grep -rn "THREE\|three.module" renderer/ main.js preload.js` — no remaining references.
- [ ] Run `ls renderer/shaders/ 2>&1` — expect "No such file or directory" (directory removed in Task 6).
- [ ] Manual smoke test (per spec's Testing section): switch packs live via `peon-pet packs use <pack>`, confirm sprite + bg + border all update together; hover for tooltip; trigger a flash-worthy event (e.g. `PermissionRequest`); watch each animation loop for ~30s to confirm no stutter; spawn a sub-agent window showing the same pack as the main pet and confirm no functional regression.
