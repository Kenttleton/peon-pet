// Uses the pre-bundled dist/pixi.mjs, not lib/index.mjs (package.json's
// "exports" "import" target) — lib/index.mjs re-exports `eventemitter3` as
// a bare specifier, which Node/bundlers resolve via node_modules but a
// browser's native ES module loader cannot ("Failed to resolve module
// specifier"); dist/pixi.mjs inlines every dependency, so it has none.
import * as PIXI from '../node_modules/pixi.js/dist/pixi.mjs';
import {
  createPlayer,
  shouldForwardEvent,
  computeDotLayout,
  hitTestDot,
  buildTooltipHtml,
  createPixiTextureLoader,
} from './player.mjs';

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
  if (winW === currentWinWidth && winH === app.renderer.height) return;
  currentWinWidth = winW;

  window.peonBridge.resizePet({ width: winW, height: winH });
  document.documentElement.style.width = `${winW}px`;
  document.documentElement.style.height = `${winH}px`;
  document.body.style.width = `${winW}px`;
  document.body.style.height = `${winH}px`;
  app.renderer.resize(winW, winH);

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
