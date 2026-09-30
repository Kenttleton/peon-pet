/**
 * Advances a frame-timer accumulator by `deltaSeconds`, at `fps` frames
 * per second, carrying any remainder forward instead of dropping it —
 * fixes the stall bug where a delayed RAF tick caused a full extra
 * 1/fps wait before the next frame advanced (renderer/app.js:711-744,
 * see docs/superpowers/specs/2026-09-29-renderer-player-rewrite-design.md).
 *
 * Uses division + floor rather than iterative subtraction: repeatedly
 * subtracting frameDuration accumulates floating-point rounding error
 * (e.g. 1/60 is not exactly representable), which can make the loop
 * terminate one frame early on an otherwise-exact boundary (1 second at
 * 60fps landed on 59 frames, not 60, under the naive while-loop form).
 * The small epsilon absorbs that same rounding error in the other
 * direction, at the floor() step, without needing per-call tolerance.
 *
 * @param {number} frameTimer - accumulated time since the last frame advance, in seconds
 * @param {number} deltaSeconds - elapsed time this tick, in seconds
 * @param {number} fps - target frames per second for the current variant
 * @returns {{frameTimer: number, framesToAdvance: number}}
 */
export function advanceFrames(frameTimer, deltaSeconds, fps) {
  const frameDuration = 1 / fps;
  const totalTime = frameTimer + deltaSeconds;
  const framesToAdvance = Math.floor(totalTime / frameDuration + 1e-9);
  const timer = totalTime - framesToAdvance * frameDuration;
  return { frameTimer: timer, framesToAdvance };
}
