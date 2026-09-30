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
