import {
  advanceFrames,
  derivedFrameCacheKey,
  computeFrameRect,
  createTextureCaches,
  clearTextureCaches,
  stepParticle,
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
