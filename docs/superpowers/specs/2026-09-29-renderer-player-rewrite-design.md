# Renderer/Player Rewrite Design

**Status:** Draft — pending user review

**Context:** While reviewing the window-registry plan (`docs/superpowers/plans/2026-09-28-window-registry.md`), the user asked how the renderer reacts to state changes and whether the renderer needs to be more efficient given it's duplicated per window. Investigation surfaced three separable problems, of which this spec addresses one:

1. **Event-ingestion latency** ("slow to react") — `lib/jsonl-watcher.js` polls `~/.claude/projects/*.jsonl` every 500ms instead of consuming real Claude Code hooks via `peon-ping`'s already-integrated local HTTP daemon (`readRemoteState`, currently also polled, at 5s). **Out of scope for this spec** — tracked as a separate architectural spec (ingestion redesign, retiring `jsonl-watcher.js`).
2. **Animation loop discontinuity** ("noticeable breaks") — a frame-accumulator bug in `renderer/app.js`.
3. **Renderer engine fit and per-window duplication** — `app.js` (757 lines) is loaded identically by every pet window (main + each sub-agent) and uses Three.js, a full 3D engine, for what is purely flat sprite-sheet playback with alpha compositing.

This spec covers (2) and (3): a renderer/player rewrite. It does not change the IPC contract (`peon-config`, `peon-event`, `session-update`, `show-tooltip`/`hide-tooltip`/`tooltip-size`) or `main.js`'s window-management logic (covered separately by the window-registry plan).

## Problems found

### Frame accumulator drops remainder

`renderer/app.js:711-744` advances animation frames with:

```js
frameTimer += delta;
if (frameTimer >= 1 / cfg.fps) {
  frameTimer = 0;   // BUG: drops the remainder instead of carrying it
  currentFrame++;
  ...
}
```

Resetting to exactly `0` instead of subtracting `1/cfg.fps` causes drift over time and, on any single delayed `requestAnimationFrame` tick (backgrounded window, GPU stall), the loop doesn't catch up — it waits a full extra `1/fps` interval before advancing again, producing a visible stall. This is a per-window correctness bug: each window's animation only needs to be smooth against its own clock, not synchronized with any other pet window's frame — no cross-window sync mechanism is needed or being added.

### Three.js is the wrong engine for this workload

Auditing every `THREE.*` call in `app.js` confirms the entire scene is flat 2D: an orthographic camera, textured `PlaneGeometry` quads for sprite/bg/border/flash layers, a `ShaderMaterial` for a flat color-tint flash overlay (`flash.vert`/`flash.frag` — no lighting, no 3D transforms), a second `ShaderMaterial` for per-session dot opacity pulsing (a scalar driving alpha), and a small hand-rolled particle burst (`BufferGeometry` + manual position/velocity integration). None of Three.js's actual value — 3D transforms, lighting, scene graph depth, camera projection — is used. Three.js (`node_modules/three`, 22MB) is a full 3D engine paying for machinery this app never touches.

### Hot-reload inconsistency across layers

Today, pack hot-swap (`initScene`, `renderer/app.js:571-646`) explicitly disposes and recreates bg/border meshes when their asset changes, but the main sprite's texture is swapped implicitly via `material.map = tex` inside `setFrame`, relying on `textureCache` (keyed by URL, **never cleared**) to serve the new pack's already-loaded texture. This is inconsistent: some layers get explicit teardown, others rely on cache-and-reassign. Per CEAP spec (`docs/ceap-spec.md:208-218`), a pack may share **one atlas across every category** (row-based) or use **one file per category** — author's choice — so texture identity across a pack switch cannot be assumed to always change, but the *slicing* (which region of which atlas backs "sleeping" vs. "typing") always changes.

## Design

### Architecture: per-window PixiJS contexts, shared player module

Each pet window (main and sub-agent) keeps its own `BrowserWindow`, its own renderer process, and its own `PIXI.Application` (one `<canvas>`, one WebGL context, with Pixi's automatic Canvas 2D fallback if WebGL is unavailable). This preserves everything the window-registry plan's `WindowManager` and the radial sub-agent layout depend on: independent OS-level position, independent `ignoreMouseEvents` click-through, independent drag. **No changes to `main.js`'s window-management logic or the WindowManager plan.**

The code-duplication concern is addressed by splitting today's single `app.js` into:

- **`renderer/player.js`** (new, shared) — the actual player: given a resolved CEAP config and a `PIXI.Application`, owns sprite/texture-atlas slicing and playback, the flash-tint effect, dot-pulse animation, particle burst, and frame advancement (with the accumulator fix). No IPC, no DOM event wiring, no `isSubAgent` branching beyond what its config says.
- **`renderer/app.js`** (rewritten, thin bootstrap) — per-window glue: creates the `PIXI.Application`, wires `window.peonBridge` IPC listeners (`onConfig`, `onEvent`, `onSessionUpdate`), wires drag/tooltip DOM event handlers, delegates all rendering to `player.js`.

Both `main.js`'s window-management responsibilities (unaffected) and the IPC contract (unaffected) stay exactly as they are — this is purely a renderer-side reorganization plus an engine swap.

### Engine: PixiJS replaces Three.js

PixiJS is a WebGL-backed 2D sprite engine (with an automatic Canvas 2D fallback), purpose-built for exactly this workload:

| Today (Three.js) | Rewrite (PixiJS) |
|---|---|
| Manual UV-offset math (`computeUVs` + `geometry.attributes.uv.setXY`) for sprite-sheet frames | Slice each atlas into per-frame `PIXI.Texture` regions (`baseTexture` + `Rectangle` frame); swap `sprite.texture` per frame |
| `flash.vert`/`flash.frag` custom `ShaderMaterial` — flat color+alpha overlay | A plain `PIXI.Sprite` filled with `flashColor` at `alpha = flashIntensity` layered above the pet sprite (or `ColorMatrixFilter`) — no custom GLSL |
| Dot-pulse `ShaderMaterial` (sine wave driving a uniform) | Directly animate `dotSprite.alpha`/`.tint` each tick with the same `(sin(time * 0.003 + i) + 1) / 2` formula — no shader |
| Hand-rolled particle burst via `BufferGeometry` + manual position/velocity arrays | `PIXI.ParticleContainer` holding small sprites; same velocity/gravity integration logic, writing to sprite `.x/.y` instead of a buffer attribute |
| `MeshBasicMaterial` planes for bg/border | Plain `PIXI.Sprite` instances; same conditional add/remove/dispose on pack switch |

Both custom GLSL files (`renderer/shaders/flash.vert`, `flash.frag`) are deleted — every effect becomes sprite/filter composition.

### Animation loop fix

`player.js` keeps a frame accumulator (Pixi's `AnimatedSprite.animationSpeed` assumes a fixed frames-per-tick rate, not this app's variable per-pack `fps` config, so the accumulator pattern is still the right tool) — but fixes the bug:

```js
frameTimer += deltaMS / 1000;
const frameDuration = 1 / cfg.fps;
while (frameTimer >= frameDuration) {
  frameTimer -= frameDuration;   // carry remainder instead of dropping it
  advanceFrame();
}
```

The `while` loop (not `if`) means a genuine stall catches up by playing through skipped frames rather than freezing for a full extra interval. This is scoped as a per-window fix — each window's ticker runs independently, and no explicit cross-window synchronization is added, since windows only need internal smoothness, not lockstep with each other.

### Hot-reload: uniform teardown across all layers

On every pack switch (`initScene` re-run), **all layers are torn down uniformly** — main sprite, bg, border, dots — with no layer special-cased to "cache and reassign":

1. Destroy every currently-live Pixi display object (sprite, bg, border, dot sprites).
2. Clear **two** caches completely:
   - **Base texture cache**, keyed by resolved `peon-asset://` file URL (today's `textureCache` concept).
   - **Derived per-frame texture cache**, keyed by `${url}:${row}:${rows}:${frameIndex}` — needed because a pack may share one atlas across many categories at different rows (CEAP spec, row-based sharing) or use one file per category; the *slicing*, not just the file, must be treated as pack-specific.
3. Preload (`preloadAllTextures`/`collectAllUrls`, functionally unchanged) collects every unique file URL for the *new* pack across all categories + bg/border, loads them all before showing anything — same loading-gate behavior as today.

This trades the minor efficiency of retaining shared base textures across a pack switch for guaranteed consistency: every layer behaves identically on hot-swap. Pack switching is a user-initiated, infrequent action, not a hot path, so the re-upload cost is acceptable.

### Cross-window resource sharing: Cache-Control on `peon-asset://`

The user wants rendering resources shared across windows as much as possible **without** merging windows into a shared/offscreen/full-screen render target — pets must remain small, independent, non-intrusive OS windows. A full-screen composited window (one candidate explored and rejected — see below) directly conflicts with this.

What *is* shareable without changing the window model: decode/upload cost. Today, `main.js`'s `peon-asset://` protocol handler (`registerPetProtocol`, `main.js:244-261`) serves pack assets via `net.fetch('file://' + absPath)` with no cache headers, so each window's renderer process independently fetches, decodes, and GPU-uploads the same bytes even when multiple pets (e.g. main + several sub-agents) display the same pack.

Fix: add `Cache-Control: max-age=31536000, immutable` to the `Response` returned by the `peon-asset://` handler. This is safe because of an existing invariant (`main.js:229-233`): asset tokens are never reused after a pack reload — a new pack always mints fresh tokens, so a given `peon-asset://<token>` URL's bytes never change during its lifetime. This lets Chromium's per-profile HTTP cache dedupe identical fetches across renderer processes for free — no new IPC, no shared-memory/`OffscreenCanvas` complexity. This is the one change in this spec that touches `main.js` rather than the renderer.

(An alternative — main-process pre-decode via `nativeImage`, serving bitmaps directly — was considered and rejected: it adds real complexity and doesn't save the GPU-upload step, since each window's WebGL context needs its own VRAM-resident texture regardless of how the source bytes were obtained.)

### Rejected: full-screen / offscreen shared rendering

Explicitly considered and rejected, not merely deferred:

- **Full-screen composited window** (all pets drawn into one transparent full-screen window with per-pet clip regions) — directly violates the product constraint that pets are small, non-intrusive, independently-positioned companions, not a full-screen overlay.
- **Electron offscreen rendering** (one Pixi context renders to textures, windows consume painted frames) — has known input-latency/paint-throttling quirks, still costs one native compositing pass per visible `BrowserWindow` regardless (Chromium composites each window as its own layer independent of what draws into it), and would require a new frame-delivery/synchronization protocol plus a new shared-failure mode (one context crash affects every pet at once).
- At the user's stated expected scale (2-8 concurrent pet windows, each with a handful of small sprites), the GPU/memory saved by either approach is likely unmeasurable against this cost and risk.

If sub-agent window counts grow well past this range in the future, this can be revisited as its own spec, informed by real measurement rather than speculation.

## Testing

- **Unit-testable** (Jest, `node` environment, matching existing conventions in `tests/`): frame-accumulator math, texture-cache/derived-frame-key logic, and particle velocity/gravity integration, extracted as functions in `player.js` that don't require a real Pixi/WebGL context (mock `PIXI.Application`/`Ticker`, similar to how `tests/window-manager.test.js` mocks `BrowserWindow`).
- **Not unit-testable, smoke-tested manually** (same limitation as today — Jest runs in `node`, no DOM/WebGL): actual visual rendering, texture loading, pack hot-swap correctness. Smoke test: switch packs live (`peon-pet packs use <pack>`), confirm sprite + bg + border all update together; hover for tooltip; trigger a flash-worthy event (e.g. `PermissionRequest`); watch each animation loop for ~30s to confirm no stutter (accumulator fix); spawn a sub-agent window showing the same pack as the main pet and confirm no functional regression (informal check that shared-cache texture loading doesn't break independent rendering).

## Out of scope

- Event-ingestion redesign (`lib/jsonl-watcher.js` → `peon-ping` push-based consumption) — separate spec.
- Any change to `main.js`'s window lifecycle, `WindowManager`, or the IPC contract's shape.
- Shared/offscreen rendering across windows — rejected above; revisit only with real measurement at higher window counts.
