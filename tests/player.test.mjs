import { jest } from '@jest/globals';
import {
  advanceFrames,
  derivedFrameCacheKey,
  computeFrameRect,
  createTextureCaches,
  clearTextureCaches,
  stepParticle,
  shouldAutoSleep,
  postReactionAnim,
  shouldForwardEvent,
  createPlayer,
  computeDotLayout,
  hitTestDot,
  buildTooltipHtml,
} from '../renderer/player.mjs';

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

// A fake display object that behaves enough like a PIXI.Sprite for
// createPlayer's lifecycle to exercise real create/destroy paths —
// confirmed destroyed, confirmed on/off stage — without a real Pixi
// Container, which previously let plain {__kind, url} objects get pushed
// onto a real stage and crash (`child.emit is not a function`).
function makeFakeDisplayFactory() {
  const created = [];
  return {
    created,
    createSprite() {
      const sprite = {
        __isFakeSprite: true,
        destroyed: false,
        texture: null,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        destroy() { this.destroyed = true; },
      };
      created.push(sprite);
      return sprite;
    },
  };
}

// A fake texture loader that resolves immediately (no real network/GPU),
// tracking every (url, row, rows, frames, frameIndex) it was asked to
// slice, so tests can assert on what got requested without a real Pixi
// Assets/Texture pipeline.
function makeFakeTextureLoader() {
  const requests = [];
  return {
    requests,
    async loadFrame(caches, url, row, rows, frames, frameIndex) {
      requests.push({ url, row, rows, frames, frameIndex });
      const key = `${url}:${row}:${rows}:${frameIndex}`;
      const cached = caches.derived.get(key);
      if (cached) return cached;
      const texture = { __fakeTexture: true, url, row, rows, frameIndex };
      caches.derived.set(key, texture);
      return texture;
    },
  };
}

function makePlayerDeps(overrides = {}) {
  return {
    displayFactory: makeFakeDisplayFactory(),
    textureLoader: makeFakeTextureLoader(),
    ...overrides,
  };
}

function makeConfig(overrides = {}) {
  return {
    subAgent: false,
    scale: 1,
    animations: {
      sleeping: [{ frames: 2, fps: 4, loop: true, displayWidth: 64, displayHeight: 64, url: 'peon-asset://asset/0' }],
      typing: [{ frames: 4, fps: 20, loop: false, loops: 3, displayWidth: 64, displayHeight: 64, url: 'peon-asset://asset/0' }],
    },
    assets: {},
    ...overrides,
  };
}

// Advances real (non-fake) timers/microtasks enough for a createPlayer
// await chain (initScene/playAnim -> applyFrame -> textureLoader.loadFrame)
// to settle, since the fake texture loader is async even though it
// resolves immediately.
async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('createPlayer', () => {
  test('initScene sets isSubAgent from config.subAgent', async () => {
    const player = createPlayer(makeFakePixiApp(), makePlayerDeps());
    await player.initScene(makeConfig({ subAgent: true }));
    expect(player.isSubAgent).toBe(true);

    await player.initScene(makeConfig({ subAgent: false }));
    expect(player.isSubAgent).toBe(false);
  });

  test('initScene defaults isSubAgent to false when config.subAgent is absent', async () => {
    const player = createPlayer(makeFakePixiApp(), makePlayerDeps());
    const cfg = makeConfig();
    delete cfg.subAgent;
    await player.initScene(cfg);
    expect(player.isSubAgent).toBe(false);
  });

  test('initScene clears both texture caches on every call (uniform hot-reload teardown) — stale entries from the prior pack never survive', async () => {
    const player = createPlayer(makeFakePixiApp(), makePlayerDeps());
    await player.initScene(makeConfig());
    // simulate the base/derived caches having entries from a prior pack
    player._caches.base.set('peon-asset://asset/0', {});
    player._caches.derived.set('peon-asset://asset/0:0:1:0', {});
    await player.initScene(makeConfig({ animations: { sleeping: [{ frames: 1, fps: 1, loop: true, displayWidth: 32, displayHeight: 32, url: 'peon-asset://asset/9' }] } }));
    // the stale prior-pack entries must be gone...
    expect(player._caches.base.has('peon-asset://asset/0')).toBe(false);
    expect(player._caches.derived.has('peon-asset://asset/0:0:1:0')).toBe(false);
    // ...even though the new pack's own sleeping-frame-0 load repopulates the
    // derived-frame cache with its own entry (initScene plays sleeping
    // immediately; the fake textureLoader only populates `derived`, mirroring
    // that the real loader's `base` entry is an implementation detail of
    // createPixiTextureLoader, not something every textureLoader must use).
    expect(player._caches.derived.has('peon-asset://asset/9:0:1:0')).toBe(true);
  });

  test('initScene creates and adds a real main sprite to the stage (Critical fix: the pet must actually render)', async () => {
    const pixiApp = makeFakePixiApp();
    const player = createPlayer(pixiApp, makePlayerDeps());
    await player.initScene(makeConfig());
    expect(player.mainSprite).not.toBeNull();
    expect(player.mainSprite.__isFakeSprite).toBe(true);
    expect(pixiApp.stage.children).toContain(player.mainSprite);
  });

  test('initScene creates bg/border sprites only when the config declares them, and never leaves a plain non-display object on the stage', async () => {
    const pixiApp = makeFakePixiApp();
    const player = createPlayer(pixiApp, makePlayerDeps());
    await player.initScene(makeConfig({
      assets: { bg: { url: 'peon-asset://asset/1' }, borders: { url: 'peon-asset://asset/2' } },
    }));
    expect(player.bgSprite).not.toBeNull();
    expect(player.borderSprite).not.toBeNull();
    for (const child of pixiApp.stage.children) {
      // every object ever pushed onto the real stage must be a real display
      // object our fake factory created, never a plain {__kind, url} record
      // (that shape crashes a real PIXI.Container.addChild).
      expect(child.__isFakeSprite).toBe(true);
    }
  });

  test('initScene destroys every previously-created sprite (main/bg/border) on a pack switch (uniform teardown)', async () => {
    const pixiApp = makeFakePixiApp();
    const player = createPlayer(pixiApp, makePlayerDeps());
    await player.initScene(makeConfig({ assets: { bg: { url: 'peon-asset://asset/1' } } }));
    const firstMain = player.mainSprite;
    const firstBg = player.bgSprite;

    await player.initScene(makeConfig()); // second pack, no bg this time
    expect(firstMain.destroyed).toBe(true);
    expect(firstBg.destroyed).toBe(true);
    expect(pixiApp.stage.children).not.toContain(firstMain);
    expect(pixiApp.stage.children).not.toContain(firstBg);
  });

  test('initScene loads and applies a texture for the initial sleeping frame', async () => {
    const player = createPlayer(makeFakePixiApp(), makePlayerDeps());
    await player.initScene(makeConfig());
    expect(player.mainSprite.texture).not.toBeNull();
    expect(player.mainSprite.texture.__fakeTexture).toBe(true);
  });

  test('playAnim("sleeping") after initScene does not throw and resets frame state', async () => {
    const player = createPlayer(makeFakePixiApp(), makePlayerDeps());
    await player.initScene(makeConfig());
    await expect(player.playAnim('sleeping')).resolves.not.toThrow();
  });

  test('playAnim for a category the pack does not declare has no visible effect (CEAP category fallback) — current animation keeps playing', async () => {
    const player = createPlayer(makeFakePixiApp(), makePlayerDeps());
    await player.initScene(makeConfig());
    await player.playAnim('typing');
    expect(player.getCurrentAnim()).toBe('typing');

    await player.playAnim('annoyed'); // not declared in makeConfig()'s animations
    expect(player.getCurrentAnim()).toBe('typing'); // unchanged, not stuck/frozen on a null variant
    expect(() => player.tick(50)).not.toThrow();
  });

  test('non-looping reaction plays exactly `loops` total passes, not loops+1 (regression: a prior version played one extra loop)', async () => {
    const player = createPlayer(makeFakePixiApp(), makePlayerDeps());
    await player.initScene(makeConfig());
    await player.playAnim('typing'); // frames:4, fps:20, loops:3

    // 3 total passes of 4 frames = 12 frame advances to reach the final held frame.
    // A 4th extra pass (the bug) would need 16 advances instead.
    for (let i = 0; i < 12; i++) player.tick(50);
    await flushAsync();
    expect(player.mainSprite.texture.frameIndex).toBe(3); // held on last frame (index 3 of 4)

    // One more full pass worth of ticks must NOT restart the animation if the
    // hold has already been reached — frame should stay at the last index.
    player.tick(50);
    await flushAsync();
    expect(player.mainSprite.texture.frameIndex).toBe(3);
  });

  test('sub-agent config never auto-sleeps via tick-driven idle check', async () => {
    const player = createPlayer(makeFakePixiApp(), makePlayerDeps());
    await player.initScene(makeConfig({ subAgent: true }));
    await player.playAnim('typing');
    expect(player.shouldAutoSleepNow()).toBe(false);
  });

  test('main pet with no active session auto-sleeps via tick-driven idle check', async () => {
    const player = createPlayer(makeFakePixiApp(), makePlayerDeps());
    await player.initScene(makeConfig({ subAgent: false }));
    player.setAnySessionActive(false);
    expect(player.shouldAutoSleepNow()).toBe(true);
  });

  test('tick with zero deltaMS does not throw and does not advance frames', async () => {
    const player = createPlayer(makeFakePixiApp(), makePlayerDeps());
    await player.initScene(makeConfig());
    await player.playAnim('sleeping');
    expect(() => player.tick(0)).not.toThrow();
  });

  test('updateDots with sessions array does not throw for sub-agent (dots suppressed) or main pet', async () => {
    const subPlayer = createPlayer(makeFakePixiApp(), makePlayerDeps());
    await subPlayer.initScene(makeConfig({ subAgent: true }));
    expect(() => subPlayer.updateDots([{ id: 'a', hot: true, warm: false }])).not.toThrow();

    const mainPlayer = createPlayer(makeFakePixiApp(), makePlayerDeps());
    await mainPlayer.initScene(makeConfig({ subAgent: false }));
    expect(() => mainPlayer.updateDots([{ id: 'a', hot: true, warm: false }])).not.toThrow();
  });

  test('ANIM_FLASH-mapped events (waking/alarmed/celebrate/annoyed) trigger a flash; others do not (regression: a prior version dropped this entirely)', async () => {
    const player = createPlayer(makeFakePixiApp(), makePlayerDeps());
    await player.initScene(makeConfig({
      animations: {
        sleeping: [{ frames: 1, fps: 1, loop: true, url: 'x' }],
        alarmed: [{ frames: 1, fps: 1, loop: false, loops: 1, url: 'x' }],
        typing: [{ frames: 1, fps: 1, loop: false, loops: 1, url: 'x' }],
      },
    }));
    await player.playAnim('alarmed');
    expect(player.getFlashIntensity()).toBeGreaterThan(0);

    await player.initScene(makeConfig({
      animations: {
        sleeping: [{ frames: 1, fps: 1, loop: true, url: 'x' }],
        typing: [{ frames: 1, fps: 1, loop: false, loops: 1, url: 'x' }],
      },
    }));
    await player.playAnim('typing'); // not in ANIM_FLASH
    expect(player.getFlashIntensity()).toBe(0);
  });

  test('non-looping reaction holds on its last frame, then schedules postReactionAnim via the injected timer (not synchronously)', async () => {
    const scheduled = [];
    const fakeTimers = {
      setTimeout: (fn, ms) => { scheduled.push({ fn, ms }); return scheduled.length; },
      clearTimeout: () => {},
    };
    const player = createPlayer(makeFakePixiApp(), makePlayerDeps({ timers: fakeTimers }));
    await player.initScene(makeConfig({ subAgent: false }));
    player.setAnySessionActive(false);
    await player.playAnim('typing'); // 4 frames, fps 20, loop: false, loops: 3 -> 3 total passes before holding

    // Drive enough ticks to exhaust all loops and land on the last frame hold.
    // 4 frames * 3 loops = 12 frame advances; each tick(50ms) advances exactly 1
    // frame at 20fps (frameDuration 0.05s) — chosen to stay under tick()'s 0.1s delta clamp, unlike
    // 8fps (frameDuration 0.125s > clamp), which would advance slower than 1 frame per tick.
    for (let i = 0; i < 12; i++) player.tick(50);

    expect(scheduled.length).toBe(1);
    expect(scheduled[0].ms).toBe(300);

    // The scheduled callback hasn't fired yet (fake timer captured, not invoked) -> still holding, not yet reset.
    await scheduled[0].fn(); // simulate the timer firing
    // After firing, postReactionAnim(false, false) === 'sleeping' per Task 4's table.
    expect(() => player.tick(1)).not.toThrow();
  });

  test('initScene cancels any pending reaction-hold timer from the previous pack (no stale callback fires after a pack switch)', async () => {
    let cancelled = false;
    const fakeTimers = {
      setTimeout: () => 'handle-1',
      clearTimeout: (handle) => { if (handle === 'handle-1') cancelled = true; },
    };
    const player = createPlayer(makeFakePixiApp(), makePlayerDeps({ timers: fakeTimers }));
    await player.initScene(makeConfig());
    await player.playAnim('typing');
    for (let i = 0; i < 12; i++) player.tick(50); // schedules the hold timer

    await player.initScene(makeConfig()); // pack switch while a reaction-hold timer is pending
    expect(cancelled).toBe(true);
  });

  test('a slow texture load from a superseded pack never overwrites the current pack\'s sprite (stale-frame-after-rapid-pack-switch guard)', async () => {
    const pixiApp = makeFakePixiApp();
    let resolveSlowLoad;
    const slowFirstLoader = {
      requests: [],
      loadFrame(caches, url) {
        this.requests.push(url);
        if (url === 'slow-pack') {
          return new Promise((resolve) => { resolveSlowLoad = () => resolve({ __fakeTexture: true, url: 'slow-pack' }); });
        }
        return Promise.resolve({ __fakeTexture: true, url });
      },
    };
    const player = createPlayer(pixiApp, makePlayerDeps({ textureLoader: slowFirstLoader }));

    const firstInit = player.initScene(makeConfig({
      animations: { sleeping: [{ frames: 1, fps: 1, loop: true, url: 'slow-pack' }] },
    })); // intentionally not awaited yet — simulates a slow load in flight
    await player.initScene(makeConfig({
      animations: { sleeping: [{ frames: 1, fps: 1, loop: true, url: 'fast-pack' }] },
    })); // second pack switch completes first

    expect(player.mainSprite.texture.url).toBe('fast-pack');
    resolveSlowLoad();
    await firstInit;
    await flushAsync();
    // the now-superseded first pack's slow load must NOT clobber the second pack's sprite
    expect(player.mainSprite.texture.url).toBe('fast-pack');
  });
});

describe('computeDotLayout', () => {
  test('empty sessions -> empty layout', () => {
    expect(computeDotLayout([], 200)).toEqual([]);
  });

  test('single session is centered horizontally in canvas-pixel space (x = winWidth/2, not 0)', () => {
    const layout = computeDotLayout([{ hot: true, warm: false }], 200);
    expect(layout).toHaveLength(1);
    // canvas-pixel space: the window's horizontal center is winWidth/2, not 0
    // (0 would be centered-origin space, which app.js no longer uses — see
    // the Critical coordinate-space bug this replaces).
    expect(layout[0].x).toBeCloseTo(100);
  });

  test('positions scale with window width relative to the 200px reference width', () => {
    const at200 = computeDotLayout([{ hot: true, warm: false }, { hot: false, warm: true }], 200);
    const at400 = computeDotLayout([{ hot: true, warm: false }, { hot: false, warm: true }], 400);
    // at double the reference width, dot spacing (gap between dot centers) doubles
    const gap200 = at200[1].x - at200[0].x;
    const gap400 = at400[1].x - at400[0].x;
    expect(gap400).toBeCloseTo(gap200 * 2);
  });

  test('caps at 10 dots even with more sessions', () => {
    const sessions = Array.from({ length: 15 }, () => ({ hot: false, warm: false }));
    const layout = computeDotLayout(sessions, 200);
    expect(layout).toHaveLength(10);
  });

  test('each entry carries hot/warm through for color selection', () => {
    const layout = computeDotLayout([{ hot: true, warm: false }, { hot: false, warm: true }], 200);
    expect(layout[0].hot).toBe(true);
    expect(layout[1].warm).toBe(true);
  });
});

describe('hitTestDot', () => {
  test('returns -1 when there are no dots', () => {
    expect(hitTestDot(0, 0, [], 200)).toBe(-1);
  });

  test('returns the index of the dot under the point, using the exact canvas-pixel coordinates computeDotLayout produced (regression: a prior version required callers to add winWidth/2 themselves, which app.js forgot to do)', () => {
    const layout = computeDotLayout([{ hot: true, warm: false }], 200);
    expect(hitTestDot(layout[0].x, layout[0].y, layout, 200)).toBe(0);
  });

  test('hit-tests correctly at a non-centered, asymmetric window width where centered-origin and canvas-pixel space would disagree', () => {
    const layout = computeDotLayout([{ hot: true, warm: false }], 300);
    // At winWidth=300, a single dot's canvas-pixel x is 150 (winWidth/2).
    // A caller mistakenly using centered-origin space (x=0) would miss
    // this hit entirely; this test fails under that bug.
    expect(layout[0].x).toBeCloseTo(150);
    expect(hitTestDot(150, layout[0].y, layout, 300)).toBe(0);
    expect(hitTestDot(0, layout[0].y, layout, 300)).toBe(-1);
  });

  test('returns -1 when the point is far from every dot', () => {
    const layout = computeDotLayout([{ hot: true, warm: false }], 200);
    expect(hitTestDot(layout[0].x + 1000, layout[0].y + 1000, layout, 200)).toBe(-1);
  });
});

describe('buildTooltipHtml', () => {
  test('no sessions -> default label', () => {
    expect(buildTooltipHtml([], -1, { hot: 'g', warm: 'y', off: 'gray' })).toBe('Peon Pet');
  });

  test('hovering a specific dot shows that session\'s cwd-derived name and status', () => {
    const sessions = [{ id: 'abc12345', hot: true, warm: false, cwd: '/Users/x/my-project' }];
    const html = buildTooltipHtml(sessions, 0, { hot: 'green', warm: 'yellow', off: 'gray' });
    expect(html).toContain('my-project');
    expect(html).toContain('active');
    expect(html).toContain('green');
  });

  test('hovering a dot with no cwd falls back to a truncated session id', () => {
    const sessions = [{ id: 'abcdefgh12345678', hot: false, warm: true, cwd: null }];
    const html = buildTooltipHtml(sessions, 0, { hot: 'g', warm: 'y', off: 'gray' });
    expect(html).toContain('12345678');
    expect(html).toContain('idle');
  });

  test('not hovering any dot, with sessions present, shows cwd names joined', () => {
    const sessions = [
      { id: 'a', hot: true, warm: false, cwd: '/x/proj-one' },
      { id: 'b', hot: false, warm: false, cwd: '/x/proj-two' },
    ];
    const html = buildTooltipHtml(sessions, -1, { hot: 'g', warm: 'y', off: 'gray' });
    expect(html).toContain('proj-one');
    expect(html).toContain('proj-two');
  });

  test('not hovering any dot, sessions with no cwd fall back to an active/total count', () => {
    const sessions = [
      { id: 'a', hot: true, warm: false, cwd: null },
      { id: 'b', hot: false, warm: false, cwd: null },
    ];
    const html = buildTooltipHtml(sessions, -1, { hot: 'g', warm: 'y', off: 'gray' });
    expect(html).toBe('1/2 sessions');
  });
});
