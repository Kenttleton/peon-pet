import * as PIXI from '../node_modules/pixi.js/lib/index.mjs';
import { createPlayer, shouldForwardEvent, computeDotLayout, hitTestDot, buildTooltipHtml } from './player.mjs';

const canvas = document.getElementById('c');
const app = new PIXI.Application();
await app.init({ canvas, backgroundAlpha: 0, antialias: false });

const player = createPlayer(app);

let dragging = false;
let currentWinWidth = 200;
let dotColors = { hot: 'rgba(68, 255, 68, 1.0)', warm: 'rgba(68, 255, 68, 0.25)', off: 'rgba(51, 51, 51, 1.0)' };

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
  app.stage.addChild(g);
  dotGraphics.push(g);
}

function colorToHex(css) {
  const ctx = colorToHex._ctx || (colorToHex._ctx = document.createElement('canvas').getContext('2d'));
  ctx.fillStyle = '#000000';
  ctx.fillStyle = css;
  return ctx.fillStyle; // normalized '#rrggbb' or 'rgba(...)' — PIXI.Graphics accepts both forms via its color parsing
}

// window.peonBridge.computeWindowSize is preload.js's direct reference to
// lib/pet-size.js#computeWindowSize (not IPC — see preload.js). It is a
// CommonJS module outside renderer/'s ESM scope, so app.js consumes it via
// the existing bridge rather than importing lib/pet-size.js directly,
// preserving the "does not change the IPC contract" constraint.
function resizeWindowFor(variant, marginX, marginY) {
  const spriteSize = window.peonBridge.computeWindowSize(variant, { subAgent: player.isSubAgent });
  const fullSize = window.peonBridge.computeWindowSize(variant, { marginX, marginY, subAgent: player.isSubAgent });
  window.peonBridge.resizePet(fullSize);
  app.renderer.resize(fullSize.width, fullSize.height);
  currentWinWidth = fullSize.width;
  return spriteSize;
}

function redrawDots() {
  const sessions = player.getCurrentSessions();
  const layout = computeDotLayout(sessions, currentWinWidth);
  for (let i = 0; i < MAX_DOTS; i++) {
    const g = dotGraphics[i];
    if (i >= layout.length) {
      g.visible = false;
      continue;
    }
    const dot = layout[i];
    const color = dot.hot ? dotColors.hot : dot.warm ? dotColors.warm : dotColors.off;
    g.clear();
    g.circle(0, 0, 6).fill(colorToHex(color));
    g.position.set(currentWinWidth / 2 + dot.x, dot.y);
    g.visible = true;
  }
}

function handlePointerMove(e) {
  if (dragging) return;
  const sessions = player.getCurrentSessions();
  const layout = computeDotLayout(sessions, currentWinWidth);
  const hitIndex = hitTestDot(e.offsetX, e.offsetY, layout, currentWinWidth);
  const html = buildTooltipHtml(sessions, hitIndex, dotColors);
  window.peonBridge.showTooltip({ html, x: e.screenX + 6, y: e.screenY + 6 });
}

function handlePointerLeave() {
  if (!dragging) window.peonBridge.hideTooltip();
}

canvas.addEventListener('pointerdown', () => {
  dragging = true;
  window.peonBridge.hideTooltip();
  window.peonBridge.startDrag();
  canvas.setPointerCapture(1);
});
canvas.addEventListener('pointerup', () => {
  dragging = false;
  window.peonBridge.stopDrag();
});
canvas.addEventListener('lostpointercapture', () => {
  dragging = false;
  window.peonBridge.stopDrag();
});
canvas.addEventListener('pointercancel', () => {
  dragging = false;
  window.peonBridge.stopDrag();
});

function wireHoverListeners(config) {
  canvas.removeEventListener('pointermove', handlePointerMove);
  canvas.removeEventListener('pointerleave', handlePointerLeave);
  for (const g of dotGraphics) g.visible = false;
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

window.peonBridge.onConfig((config) => {
  player.initScene(config);
  if (config.dotColors) dotColors = { ...dotColors, ...config.dotColors };
  wireHoverListeners(config);
  document.getElementById('loading').style.display = 'none';
  resetIdleTimer();
});

window.peonBridge.onEvent(({ anim }) => {
  if (!shouldForwardEvent(player.isSubAgent, anim)) return;
  player.playAnim(anim);
  resetIdleTimer();
});

window.peonBridge.onSessionUpdate(({ sessions }) => {
  player.updateDots(sessions);
  if (!player.isSubAgent) redrawDots();
  const anyActive = sessions.some((s) => s.hot || s.warm);
  player.setAnySessionActive(anyActive);
});

app.ticker.add((ticker) => {
  player.tick(ticker.deltaMS);
});
