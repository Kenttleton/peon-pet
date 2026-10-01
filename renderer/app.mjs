// This file is bundled by esbuild (scripts/build-renderer.js, run before
// npm start/dev) into renderer/dist/app.js — never loaded as raw source by
// the browser. Bare imports like 'pixi.js' and 'pixi.js/unsafe-eval' are
// resolved by esbuild the normal Node/bundler way; the output bundle has
// no imports left to resolve, so Electron's renderer process never needs
// to resolve a bare specifier itself.
//
// 'pixi.js/unsafe-eval' is imported for its side effect only: it patches
// PixiJS's internal renderer/shader/particle classes to use CSP-safe
// polyfills instead of `new Function(...)`-based code generation, which
// this app's CSP (script-src 'self', no unsafe-eval) blocks outright —
// without this import, PIXI.Application.init() throws immediately
// ("Current environment does not allow unsafe-eval").
import * as PIXI from 'pixi.js';
import 'pixi.js/unsafe-eval';
import {
  createPlayer,
  shouldForwardEvent,
  computeDotLayout,
  hitTestDot,
  buildTooltipHtml,
  createPixiTextureLoader,
} from './player.mjs';

// PixiJS's default texture loader offloads createImageBitmap() decoding to
// a Web Worker, spun up from a `blob:` URL (checkImageBitmap.worker.mjs).
// This app's CSP has no worker-src, so it falls back to script-src 'self',
// which blocks `new Worker(blob:...)` outright — the worker constructor
// throws synchronously, rejecting every texture load. createImageBitmap()
// itself isn't CSP-gated; only the worker wrapper around it is, so turning
// preferWorkers off keeps the fast native bitmap decode path and only
// drops the (here, impossible) off-main-thread optimization.
PIXI.Assets.setPreferences({ preferWorkers: false });

const canvas = document.getElementById('c');
const app = new PIXI.Application();
await app.init({ canvas, backgroundAlpha: 0, antialias: false, resolution: window.devicePixelRatio || 1 });

const DOT_COLOR_DEFAULTS = Object.freeze({
  hot: 'rgba(68, 255, 68, 1.0)',
  warm: 'rgba(68, 255, 68, 0.25)',
  off: 'rgba(51, 51, 51, 1.0)',
});
let dotColors = { ...DOT_COLOR_DEFAULTS };
let currentWinWidth = 200;
let currentWinHeight = 200;
let currentScale = 1;
let currentBorderMargin = { x: 0, y: 0 };

function createSprite() {
  const sprite = new PIXI.Sprite();
  sprite.texture.source.scaleMode = 'nearest';
  return sprite;
}

// window.peonBridge.computeWindowSize is preload.js's direct reference to
// lib/pet-size.js#computeWindowSize (not IPC — see preload.js). It is a
// CommonJS module outside renderer/'s ESM scope, so app.js consumes it via
// the existing bridge rather than importing lib/pet-size.js directly,
// preserving the "does not change the IPC contract" constraint.
function onVariantChanged(variant, { bgAsset, borderAsset }) {
  const spriteSize = window.peonBridge.computeWindowSize(variant, { scale: currentScale, subAgent: player.isSubAgent });
  const winSize = window.peonBridge.computeWindowSize(variant, {
    marginX: currentBorderMargin.x,
    marginY: currentBorderMargin.y,
    scale: currentScale,
    subAgent: player.isSubAgent,
  });
  const winW = Math.round(winSize.width);
  const winH = Math.round(winSize.height);
  const sizeChanged = winW !== currentWinWidth || winH !== currentWinHeight;
  currentWinWidth = winW;
  currentWinHeight = winH;

  // Window/canvas resize and OS-level resizePet are the only things gated
  // on an actual size change — everything below (sprite/bg/border
  // positioning, dot redraw) must run on every variant change regardless,
  // since a new PIXI.Sprite is created per initScene and starts with no
  // width/height/position at all; skipping this when the size happens to
  // match the previous variant's left every non-first category (e.g. an
  // atlas pack where every row shares one frame size, such as orc's
  // sleeping/waking/typing/alarmed/celebrate/annoyed) with a correctly
  // positioned sprite ONLY for the first-ever variant played, then frozen
  // — this is the bug behind "renders fine at first, then breaks": the
  // border/bg/main sprite's position/size was set once on the very first
  // onVariantChanged call and never updated again, so a resize_pet "did
  // something" 1-3 seconds later (driven by session polling, which plays
  // 'typing' as soon as any tracked session is hot — see main.js's
  // sendSessionUpdate/EVENT_TO_ANIM) requested the OS window at an
  // unchanged size, early-returned, and froze the visual state at
  // whatever generation count/texture mainSprite's animation happened to
  // land on, decoupled from its now-stale position/size.
  if (sizeChanged) {
    window.peonBridge.resizePet({ width: winW, height: winH });
    document.documentElement.style.width = `${winW}px`;
    document.documentElement.style.height = `${winH}px`;
    document.body.style.width = `${winW}px`;
    document.body.style.height = `${winH}px`;
    // PIXI.Renderer#resize only resizes the backing drawing buffer (to
    // winW/winH * resolution device pixels) — unlike Three.js's
    // WebGLRenderer#setSize (the previous engine), it does NOT set the
    // canvas element's CSS box size. Without this, the canvas displays at
    // its intrinsic device-pixel dimensions as a CSS size (e.g. 466x458
    // instead of 233x229 at resolution:2), showing only an unscaled corner
    // of the composited scene instead of the whole thing scaled to fit.
    canvas.style.width = `${winW}px`;
    canvas.style.height = `${winH}px`;
    app.renderer.resize(winW, winH);
  }

  const main = player.mainSprite;
  if (main) {
    main.width = spriteSize.width;
    main.height = spriteSize.height;
    main.x = (winW - spriteSize.width) / 2;
    main.y = (winH - spriteSize.height) / 2;
  }
  const bg = player.bgSprite;
  if (bg && bgAsset) {
    bg.width = spriteSize.width;
    bg.height = spriteSize.height;
    bg.x = (winW - spriteSize.width) / 2;
    bg.y = (winH - spriteSize.height) / 2;
    bg.zIndex = -1;
  }
  const border = player.borderSprite;
  if (border && borderAsset) {
    border.width = winW;
    border.height = winH;
    border.x = 0;
    border.y = 0;
    border.zIndex = 1;
  }
  app.stage.sortableChildren = true;

  redrawDots();
}

const player = createPlayer(app, {
  displayFactory: { createSprite },
  textureLoader: createPixiTextureLoader(PIXI),
  onVariantChanged,
});

let dragging = false;

// --- Session dots: real PIXI.Graphics circles, positioned/colored from
// player.js's pure computeDotLayout/hitTestDot (no custom GLSL — the pulse
// is animated via .alpha each tick instead of a shader, per the spec's
// stated design). Dots live in app.js (not player.js) because they're Pixi
// display objects tied to this window's stage, same as sprite/bg/border.
const MAX_DOTS = 10;
const dotGraphics = [];
for (let i = 0; i < MAX_DOTS; i++) {
  const g = new PIXI.Graphics();
  g.visible = false;
  g.zIndex = 2;
  app.stage.addChild(g);
  dotGraphics.push(g);
}

function colorToRgbaString(css) {
  const ctx = colorToRgbaString._ctx || (colorToRgbaString._ctx = document.createElement('canvas').getContext('2d'));
  ctx.fillStyle = '#000000';
  ctx.fillStyle = css;
  return ctx.fillStyle; // normalized '#rrggbb' or 'rgba(...)' — accepted by PIXI.Graphics's `.fill()` color parsing
}

function redrawDots() {
  if (player.isSubAgent) {
    for (const g of dotGraphics) g.visible = false;
    return;
  }
  const sessions = player.getCurrentSessions();
  const layout = computeDotLayout(sessions, currentWinWidth);
  const dotRadius = 6 * (currentWinWidth / 200);
  for (let i = 0; i < MAX_DOTS; i++) {
    const g = dotGraphics[i];
    if (i >= layout.length) {
      g.visible = false;
      continue;
    }
    const dot = layout[i];
    const color = dot.hot ? dotColors.hot : dot.warm ? dotColors.warm : dotColors.off;
    g.clear();
    g.circle(0, 0, dotRadius).fill(colorToRgbaString(color));
    g.position.set(dot.x, dot.y);
    g.visible = true;
  }
}

function handlePointerMove(e) {
  if (dragging) return;
  const sessions = player.getCurrentSessions();
  const layout = computeDotLayout(sessions, currentWinWidth);
  const hitIndex = hitTestDot(e.offsetX, e.offsetY, layout, currentWinWidth);
  const html = buildTooltipHtml(sessions, hitIndex, dotColors);
  // e.screenX/screenY are the cursor's absolute screen position — the
  // tooltip window is positioned by main.js, independent of this window's
  // own bounds, so there's no window-relative math needed here at all.
  window.peonBridge.showTooltip({ html, x: e.screenX + 6, y: e.screenY + 6 });
}

function handlePointerLeave() {
  if (!dragging) window.peonBridge.hideTooltip();
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return; // left-click only, matches renderer/app.js:508
  dragging = true;
  window.peonBridge.hideTooltip();
  canvas.setPointerCapture(e.pointerId);
  window.peonBridge.startDrag();
});
canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !dragging) return;
  dragging = false;
  window.peonBridge.stopDrag();
});
canvas.addEventListener('lostpointercapture', () => {
  if (!dragging) return;
  dragging = false;
  window.peonBridge.stopDrag();
});
canvas.addEventListener('pointercancel', () => {
  if (!dragging) return;
  dragging = false;
  window.peonBridge.stopDrag();
});

function wireHoverListeners(config) {
  canvas.removeEventListener('pointermove', handlePointerMove);
  canvas.removeEventListener('pointerleave', handlePointerLeave);
  if (!config.subAgent) {
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerleave', handlePointerLeave);
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

window.peonBridge.onConfig(async (config) => {
  currentScale = config.scale ?? 1;
  currentBorderMargin = (config.assets && config.assets.borders && config.assets.borders.displayMargin) || { x: 0, y: 0 };
  // Reset to defaults every config, never merge onto the previous pack's
  // colors (regression fix: a prior version spread onto the existing
  // `dotColors`, so a pack without its own dot_colors inherited whatever
  // the last pack set instead of falling back to the documented defaults).
  const packColors = (config.dotColors) || {};
  dotColors = {
    hot: packColors.hot ?? DOT_COLOR_DEFAULTS.hot,
    warm: packColors.warm ?? DOT_COLOR_DEFAULTS.warm,
    off: packColors.off ?? DOT_COLOR_DEFAULTS.off,
  };
  document.body.style.borderRadius = `${config.cornerRadius ?? 0}px`;

  await player.initScene(config);
  wireHoverListeners(config);
  redrawDots(); // dots must reappear immediately after a hot-reload, not wait for the next session-update
  document.getElementById('loading').style.display = 'none';
  resetIdleTimer();
});

window.peonBridge.onEvent(({ anim }) => {
  if (!shouldForwardEvent(player.isSubAgent, anim)) return;
  // Don't wake if already active — only wake from sleep (renderer/app.js:655)
  if (anim === 'waking' && player.getCurrentAnim() !== 'sleeping') return;
  player.playAnim(anim);
  resetIdleTimer();
});

window.peonBridge.onSessionUpdate(({ sessions }) => {
  player.updateDots(sessions);
  redrawDots();
  // anySessionActive matches renderer/app.js:663 exactly: `hot` only, never
  // `hot || warm` — this gates auto-sleep (shouldAutoSleep) and the
  // post-reaction return-to-state (postReactionAnim), so changing it would
  // change when the pet auto-sleeps/returns to typing after a reaction.
  const wasActive = player.getAnySessionActive();
  const anyHot = sessions.some((s) => s.hot);
  player.setAnySessionActive(anyHot);
  // If a session just became hot and the character is sleeping, wake to
  // typing (renderer/app.js:662-667). The original's playAnim() resets the
  // idle timer for every non-sleeping animation (app.js:476-478); mirrored
  // here since player.js has no timer/DOM access of its own.
  if (anyHot && !wasActive && player.getCurrentAnim() === 'sleeping') {
    player.playAnim('typing');
    resetIdleTimer();
  }
});

app.ticker.add((ticker) => {
  player.tick(ticker.deltaMS);
});
