import { advanceFrames } from '../renderer/player.mjs';

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
