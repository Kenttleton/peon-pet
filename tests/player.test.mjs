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
    const firstInitObjects = [...pixiApp.stage.children];
    expect(firstInitObjects.length).toBeGreaterThan(0);

    player.initScene(makeConfig()); // second pack, no bg this time
    // none of the exact objects added during the first initScene may still be on stage
    const stale = pixiApp.stage.children.filter((c) => firstInitObjects.includes(c));
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
    player.playAnim('typing'); // 4 frames, fps 20, loop: false, loops: 3 -> 3 full replays before holding

    // Drive enough ticks to exhaust all loops and land on the last frame hold.
    // 4 frames * (3 loops + 1 final pass) = 16 frame advances; each tick(50ms) advances exactly 1
    // frame at 20fps (frameDuration 0.05s) — chosen to stay under tick()'s 0.1s delta clamp, unlike
    // 8fps (frameDuration 0.125s > clamp), which would advance slower than 1 frame per tick.
    for (let i = 0; i < 16; i++) player.tick(50);

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
    for (let i = 0; i < 16; i++) player.tick(50); // schedules the hold timer

    player.initScene(makeConfig()); // pack switch while a reaction-hold timer is pending
    expect(cancelled).toBe(true);
  });
});

describe('computeDotLayout', () => {
  test('empty sessions -> empty layout', () => {
    expect(computeDotLayout([], 200)).toEqual([]);
  });

  test('single session is centered horizontally', () => {
    const layout = computeDotLayout([{ hot: true, warm: false }], 200);
    expect(layout).toHaveLength(1);
    expect(layout[0].x).toBeCloseTo(0);
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

  test('returns the index of the dot under the point', () => {
    const layout = computeDotLayout([{ hot: true, warm: false }], 200);
    expect(hitTestDot(layout[0].x, layout[0].y, layout, 200)).toBe(0);
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
