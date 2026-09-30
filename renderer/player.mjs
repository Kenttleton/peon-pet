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
