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

/**
 * Picks a variant for `animName` from `animConfig`, applying CEAP's
 * no-immediate-repeat rule when a category has more than one variant
 * (docs/ceap-spec.md#variant-selection). Mirrors renderer/app.js:340-348's
 * pickVariant. A category the pack doesn't declare returns null — callers
 * must treat that as "no visible effect", never a substitute (CEAP's
 * category-fallback rule, renderer/app.js:456-459).
 *
 * @param {Record<string, Array<object>>} animConfig
 * @param {string} animName
 * @param {number|undefined} lastIndex - the index played last time for this category, or undefined
 * @returns {{variant: object, index: number} | null}
 */
export function pickVariant(animConfig, animName, lastIndex) {
  const variants = animConfig[animName];
  if (!variants || variants.length === 0) return null;
  if (variants.length === 1) return { variant: variants[0], index: 0 };
  const candidates = variants.map((_, i) => i).filter((i) => i !== lastIndex);
  const index = candidates[Math.floor(Math.random() * candidates.length)];
  return { variant: variants[index], index };
}

const REACTION_LOOPS = 3; // play reaction animations 3x before sleeping, matching renderer/app.js:328
const REACTION_HOLD_MS = 300; // matches renderer/app.js:724-737's setTimeout delay on the last frame of a reaction

/** Mirrors renderer/app.js:309-314's ANIM_FLASH map (color + intensity + decay per event). */
const ANIM_FLASH = {
  waking: { r: 0.4, g: 0.8, b: 1.0, intensity: 0.3, decay: 2.0 },
  alarmed: { r: 1.0, g: 0.1, b: 0.1, intensity: 0.5, decay: 2.5 },
  celebrate: { r: 1.0, g: 0.8, b: 0.0, intensity: 0.5, decay: 2.0 },
  annoyed: { r: 0.8, g: 0.4, b: 0.0, intensity: 0.3, decay: 2.0 },
};

/**
 * Default texture-loading/slicing strategy backed by real PixiJS: loads
 * each unique base texture once via PIXI.Assets, slices per-frame
 * PIXI.Texture regions from computeFrameRect via PIXI.Rectangle, and
 * caches both (keyed as createTextureCaches/derivedFrameCacheKey
 * describe). Overridable via createPlayer's `textureLoader` option so
 * tests can inject a fake that never touches a real GPU/network.
 *
 * @param {object} PIXI - the pixi.js module namespace (injected so this
 *   file has no top-level pixi.js import — keeps player.mjs loadable in
 *   Jest without a real PIXI.Assets/texture pipeline when a test instead
 *   provides its own textureLoader).
 */
export function createPixiTextureLoader(PIXI) {
  return {
    async loadFrame(caches, url, row, rows, frames, frameIndex) {
      const key = derivedFrameCacheKey(url, row, rows, frameIndex);
      const cached = caches.derived.get(key);
      if (cached) return cached;

      let base = caches.base.get(url);
      if (!base) {
        // peon-asset:// URLs are opaque tokens with no file extension
        // (main.js's toAssetUrl mints 'peon-asset://asset/<token>', by
        // design — see lib/asset-headers.js's Cache-Control invariant).
        // PIXI.Assets.load() normally infers which parser to use from the
        // URL's extension (loadTextures.test() checks path.extname against
        // .png/.jpg/etc) and silently fails to load ("we don't know how to
        // parse it") when there isn't one. Explicitly naming the parser
        // bypasses that extension sniffing entirely — every CEAP asset is
        // a PNG (lib/ceap-manifest.js's pngSizeOf), so this is always
        // correct, not a guess.
        base = await PIXI.Assets.load({ src: url, parser: 'loadTextures' });
        if (!base || !base.source) {
          throw new Error(`[peon-pet] Failed to load texture: ${url}`);
        }
        base.source.scaleMode = 'nearest';
        caches.base.set(url, base);
      }

      const rect = computeFrameRect(base.width, base.height, row, rows, frames, frameIndex);
      const frameTexture = new PIXI.Texture({
        source: base.source,
        frame: new PIXI.Rectangle(rect.x, rect.y, rect.width, rect.height),
      });
      caches.derived.set(key, frameTexture);
      return frameTexture;
    },
  };
}

/**
 * Creates a player instance bound to a Pixi-app-like object. The app only
 * needs `{ stage: { addChild, removeChild } }` for tests — real
 * PIXI.Application satisfies this; tests inject a plain fake object
 * instead of mocking pixi.js, mirroring lib/window-manager.js's
 * constructor-injected `{ screen }` pattern.
 *
 * Display-object creation (sprite/bg/border) is itself injected via
 * `displayFactory`, so tests can verify teardown/lifecycle without a real
 * Pixi/WebGL context — the default (used by app.mjs) creates real
 * PIXI.Sprite instances; a test factory returns plain trackable objects.
 * This is what fixes the Critical bug where a first version of this
 * player pushed plain `{__kind, url}` objects directly onto a REAL
 * PIXI.Container's stage, which throws (`child.emit is not a function`)
 * because PIXI.Container.addChild requires an actual display object.
 *
 * @param {object} pixiApp - see above for the minimal shape required.
 * @param {object} [options]
 * @param {{setTimeout?: Function, clearTimeout?: Function}} [options.timers] - injectable
 *   timer functions, defaulting to the real globals. Tests pass fakes (e.g.
 *   a synchronous stub) instead of waiting 300ms per assertion.
 * @param {{createSprite?: Function, createGraphicsRect?: Function}} [options.displayFactory] -
 *   `createSprite()` returns a fresh Pixi-like sprite object with a
 *   settable `.texture`, `.width`, `.height`, `.x`, `.y`. Defaults to a
 *   factory that throws if used without a real `displayFactory` supplied
 *   — app.mjs always supplies one backed by `new PIXI.Sprite()`.
 * @param {{loadFrame: Function}} [options.textureLoader] - see
 *   createPixiTextureLoader; tests supply a fake that resolves
 *   synchronously-ish fake texture objects instead of touching the GPU.
 */
export function createPlayer(pixiApp, options = {}) {
  const scheduleTimeout = options.timers?.setTimeout || setTimeout;
  const cancelTimeout = options.timers?.clearTimeout || clearTimeout;
  const createSprite = options.displayFactory?.createSprite || (() => {
    throw new Error('createPlayer requires options.displayFactory.createSprite to create real display objects');
  });
  const textureLoader = options.textureLoader || null;
  // Called whenever playAnim picks a new variant, with that variant and the
  // current bg/border assets (if any) — app.js uses this to resize the
  // window (window.peonBridge.computeWindowSize/resizePet) and position the
  // bg/border sprites, since window sizing is IPC-driven and out of scope
  // for player.js per the "no DOM/IPC in player.js" constraint.
  const onVariantChanged = options.onVariantChanged || (() => {});

  const caches = createTextureCaches();
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
  let lastPlayedIndex = {};
  let currentSessions = [];

  let mainSprite = null;
  let bgSprite = null;
  let borderSprite = null;
  let bgAsset = null;
  let borderAsset = null;
  // Each initScene bumps this; an in-flight loadFrame promise from a
  // superseded pack checks it before mutating state, so a slow load from
  // pack N never clobbers pack N+1's already-current sprite after a rapid
  // pack switch (prevents the exact kind of stale-frame bug the spec's
  // Review Focus section calls out).
  let sceneGeneration = 0;

  function destroySprite(sprite) {
    if (!sprite) return;
    pixiApp.stage.removeChild(sprite);
    if (typeof sprite.destroy === 'function') sprite.destroy();
  }

  function clearStage() {
    destroySprite(mainSprite);
    destroySprite(bgSprite);
    destroySprite(borderSprite);
    mainSprite = null;
    bgSprite = null;
    borderSprite = null;
  }

  function initScene(config) {
    sceneGeneration++;
    const myGeneration = sceneGeneration;

    clearStage();
    clearTextureCaches(caches);
    isSubAgent = !!config.subAgent;
    animConfig = config.animations || {};
    currentFrame = 0;
    frameTimer = 0;
    remainingLoops = 0;
    lastPlayedIndex = {};
    if (pendingIdleHandle) { cancelTimeout(pendingIdleHandle); pendingIdleHandle = null; }
    flashIntensity = 0;
    particles = [];

    bgAsset = (config.assets && config.assets.bg) || null;
    borderAsset = (config.assets && config.assets.borders) || null;

    if (bgAsset) {
      bgSprite = createSprite();
      pixiApp.stage.addChild(bgSprite);
    }
    if (borderAsset) {
      borderSprite = createSprite();
      pixiApp.stage.addChild(borderSprite);
    }
    mainSprite = createSprite();
    pixiApp.stage.addChild(mainSprite);

    return playAnim('sleeping', myGeneration);
  }

  function playAnim(animName, generationAtCallTime) {
    const generation = generationAtCallTime ?? sceneGeneration;
    // CEAP category fallback: a pack that doesn't declare this category
    // has no visible effect — never substitute a different animation, and
    // never clear the one already playing (renderer/app.js:456-461).
    const picked = pickVariant(animConfig, animName, lastPlayedIndex[animName]);
    if (!picked) return Promise.resolve();

    if (pendingIdleHandle) { cancelTimeout(pendingIdleHandle); pendingIdleHandle = null; }
    currentAnim = animName;
    currentVariant = picked.variant;
    lastPlayedIndex[animName] = picked.index;
    currentFrame = 0;
    frameTimer = 0;
    const loops = currentVariant.loops != null ? currentVariant.loops : REACTION_LOOPS;
    remainingLoops = animName !== 'sleeping' ? loops - 1 : 0;

    const flash = ANIM_FLASH[animName];
    if (flash) triggerFlash(flash.r, flash.g, flash.b, flash.intensity, flash.decay);

    onVariantChanged(currentVariant, { bgAsset, borderAsset });
    return applyFrame(generation);
  }

  async function applyFrame(generation) {
    if (!currentVariant || !mainSprite || !textureLoader) return;
    const row = currentVariant.row ?? 0;
    const rows = currentVariant.rows ?? 1;
    const texture = await textureLoader.loadFrame(caches, currentVariant.url, row, rows, currentVariant.frames, currentFrame);
    if (generation !== sceneGeneration) return; // superseded by a later initScene/pack switch
    mainSprite.texture = texture;
  }

  function setAnySessionActive(active) {
    anySessionActive = !!active;
  }

  function getAnySessionActive() {
    return anySessionActive;
  }

  function shouldAutoSleepNow() {
    return shouldAutoSleep(isSubAgent, anySessionActive);
  }

  function tick(deltaMS) {
    const deltaSeconds = Math.min(deltaMS / 1000, 0.1);
    if (flashIntensity > 0) {
      flashIntensity = Math.max(0, flashIntensity - deltaSeconds * flashDecayRate);
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
          const generation = sceneGeneration;
          pendingIdleHandle = scheduleTimeout(() => {
            pendingIdleHandle = null;
            playAnim(postReactionAnim(isSubAgent, anySessionActive), generation);
          }, REACTION_HOLD_MS);
        }
        return; // don't re-apply the held last frame below; applyFrame already ran for it when it was first reached
      }
    }
    applyFrame(sceneGeneration);
  }

  let flashDecayRate = 2.0;

  function triggerFlash(r, g, b, intensity = 0.6, decay = 3.0) {
    flashIntensity = intensity;
    flashDecayRate = decay;
  }

  function burstParticles() {
    const next = [];
    for (let i = 0; i < 30; i++) {
      next.push({ x: 0, y: 0, vx: (Math.random() - 0.5) * 100, vy: -Math.random() * 100, life: 1.2, gravity: 200 });
    }
    particles = next;
  }

  function updateDots(sessions) {
    currentSessions = sessions;
  }

  function getCurrentSessions() {
    return currentSessions;
  }

  function getCurrentAnim() {
    return currentAnim;
  }

  function getFlashIntensity() {
    return flashIntensity;
  }

  return {
    initScene,
    playAnim,
    tick,
    updateDots,
    getCurrentSessions,
    getCurrentAnim,
    getFlashIntensity,
    triggerFlash,
    burstParticles,
    setAnySessionActive,
    getAnySessionActive,
    shouldAutoSleepNow,
    get isSubAgent() { return isSubAgent; },
    get bgSprite() { return bgSprite; },
    get borderSprite() { return borderSprite; },
    get mainSprite() { return mainSprite; },
    _caches: caches,
  };
}

// --- Session dots (ported from renderer/app.js:156-241, 486-502, 533-557) ---

const MAX_DOTS = 10;
const DOT_SIZE_BASE = 12;
const DOT_GAP_BASE = 6;
const DOT_TOP_PADDING_BASE = 12;
const DOT_REFERENCE_WIDTH = 200; // window width these base constants were tuned for

/**
 * Lays out up to MAX_DOTS session dots in CANVAS-PIXEL space (origin
 * top-left, same space as PointerEvent.offsetX/offsetY and PIXI display
 * object positions) — not centered-origin space. Returning canvas-pixel
 * coordinates directly means the same `x`/`y` values feed both rendering
 * (app.js positions dot sprites from this) and hit-testing (hitTestDot
 * below), so the two paths can never disagree about which coordinate
 * space they're in. The original renderer/app.js had this exact bug: its
 * Three.js scene used centered-origin coordinates for rendering while its
 * canvas-pixel hit-testing had to manually add `+ currentWinW / 2` to
 * compensate (app.js:496) — a seam a Pixi rewrite doesn't need to carry
 * forward, since Pixi's own coordinate space is canvas-pixel already.
 *
 * Mirrors renderer/app.js's updateDots (lines 215-241) and hitTestDots
 * (lines 486-502) positioning math otherwise unchanged.
 *
 * @param {Array<{hot: boolean, warm: boolean}>} sessions
 * @param {number} winWidth
 * @returns {Array<{x: number, y: number, hot: boolean, warm: boolean}>}
 */
export function computeDotLayout(sessions, winWidth) {
  const scaleFactor = winWidth / DOT_REFERENCE_WIDTH;
  const dotSize = DOT_SIZE_BASE * scaleFactor;
  const dotGap = DOT_GAP_BASE * scaleFactor;
  const count = Math.min(sessions.length, MAX_DOTS);
  const totalWidth = count * dotSize + Math.max(0, count - 1) * dotGap;
  const startX = winWidth / 2 - totalWidth / 2 + dotSize / 2;
  const y = DOT_TOP_PADDING_BASE * scaleFactor;

  const layout = [];
  for (let i = 0; i < count; i++) {
    layout.push({
      x: startX + i * (dotSize + dotGap),
      y,
      hot: !!sessions[i].hot,
      warm: !!sessions[i].warm,
    });
  }
  return layout;
}

/**
 * Finds which dot (if any) contains point (px, py), using a hit radius
 * slightly wider than the visual dot for easier hover (mirrors
 * renderer/app.js:486-502's hitTestDots). `px`/`py` and `dotLayout`
 * entries must both be in canvas-pixel space — computeDotLayout's output
 * already is, so callers pass PointerEvent.offsetX/offsetY directly with
 * no extra coordinate conversion.
 *
 * @param {number} px
 * @param {number} py
 * @param {Array<{x: number, y: number}>} dotLayout - from computeDotLayout
 * @param {number} winWidth
 * @returns {number} dot index, or -1 if no dot contains the point
 */
export function hitTestDot(px, py, dotLayout, winWidth) {
  if (dotLayout.length === 0) return -1;
  const scaleFactor = winWidth / DOT_REFERENCE_WIDTH;
  const hitRadius = DOT_SIZE_BASE * scaleFactor;
  for (let i = 0; i < dotLayout.length; i++) {
    const dx = px - dotLayout[i].x;
    const dy = py - dotLayout[i].y;
    if (dx * dx + dy * dy < hitRadius * hitRadius) return i;
  }
  return -1;
}

/**
 * Builds the tooltip's HTML content: per-dot detail when hovering a
 * specific dot (hitIndex >= 0), otherwise an aggregate summary — mirrors
 * renderer/app.js:538-557's handleMouseMove body.
 *
 * @param {Array<{id: string, hot: boolean, warm: boolean, cwd: ?string}>} sessions
 * @param {number} hitIndex - index into `sessions`, or -1 for no hover hit
 * @param {{hot: string, warm: string, off: string}} dotColors - CSS color strings
 * @returns {string} HTML
 */
export function buildTooltipHtml(sessions, hitIndex, dotColors) {
  if (hitIndex >= 0 && sessions[hitIndex]) {
    const s = sessions[hitIndex];
    const status = s.hot
      ? `<span style="color:${dotColors.hot}">active</span>`
      : s.warm
        ? `<span style="color:${dotColors.warm}">idle</span>`
        : `<span style="color:${dotColors.off}">cold</span>`;
    const label = s.cwd ? s.cwd.split('/').filter(Boolean).pop() : ('…' + s.id.slice(-8));
    return `${label} &bull; ${status}`;
  }

  const active = sessions.filter((s) => s.hot).length;
  const total = sessions.length;
  if (total === 0) return 'Peon Pet';

  const names = sessions
    .map((s) => (s.cwd ? s.cwd.split('/').filter(Boolean).pop() : null))
    .filter(Boolean);
  return names.length ? names.join('<br>') : `${active}/${total} sessions`;
}
