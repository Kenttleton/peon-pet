const { app, BrowserWindow, screen, Menu, protocol, net, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  isValidSessionId,
  createSessionTracker,
  buildSessionStates,
  EVENT_TO_ANIM,
} = require('./lib/session-tracker');
const { JsonlWatcher } = require('./lib/jsonl-watcher');
const os = require('os');
const { loadManifestFromDir, resolvePack } = require('./lib/ceap-manifest');
const { migrateLegacyCharacters } = require('./lib/ceap-migration');
const { computeWindowSize } = require('./lib/pet-size');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'peon-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let win;
let petVisible = true;
const subAgentWindows = new Map(); // session_id → BrowserWindow
const subAgentCreatedAt = new Map(); // session_id → creation timestamp (ms)
const dummySessionIds = new Set(); // dev-only: protected from sync cleanup
const MAX_SUB_AGENT_WINDOWS = 5;
const SUB_AGENT_BASE_Y_OFFSET = 170; // px from bottom of work area to main pet
const SUB_AGENT_TTL_MS = 10 * 60 * 1000; // 10 min — destroy stale windows if SubagentStop never fired

// A second, always-on-top window for the tooltip — an OS window is a hard
// rectangular canvas, so a tooltip drawn *inside* the pet window's own
// bounds can never render past its edge (CSS overflow doesn't apply to
// the platform's own window clipping). Created lazily on first hover;
// resized to fit its content exactly once the tooltip page reports its
// natural size back (see the 'tooltip-size' handler below).
let tooltipWin = null;
let pendingTooltipAnchor = { x: 0, y: 0 };

function ensureTooltipWindow() {
  if (tooltipWin && !tooltipWin.isDestroyed()) return tooltipWin;
  tooltipWin = new BrowserWindow({
    width: 10,
    height: 10,
    show: false,
    transparent: true,
    frame: false,
    roundedCorners: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'tooltip-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  tooltipWin.setIgnoreMouseEvents(true);
  tooltipWin.loadFile('renderer/tooltip.html');
  return tooltipWin;
}


// --- Pet system ---
let resolvedPack = null; // { categories, assets } — set once in registerPetProtocol
let scale = 1; // resolved once in app.whenReady, before any window is created
let borderEnabled = false; // resolved once in app.whenReady

// Maps an opaque token -> absolute filesystem path, so the peon-asset://
// protocol never has to parse a real path out of a URL. A `standard: true`
// scheme's "host" goes through Chromium's domain/IPv4 host-parsing rules —
// a bare digit-string host like "6" gets silently rewritten to "0.0.0.6"
// (the IPv4 heuristic), and an absolute path like /Users/Name/... breaks
// outright (slashes aren't legal in a host at all). Either way the
// texture loader has no error callback, so failures are completely
// silent. The token instead lives in the URL's *path*, under a fixed,
// always-safe host — host-parsing quirks never apply to the path.
const assetPathsByToken = new Map();
const assetTokensByPath = new Map(); // absPath -> token, so multiple categories
// sharing one atlas file (the common case) resolve to the same URL and the
// renderer's texture cache dedupes them into a single load.
let nextAssetToken = 0;

function toAssetUrl(absPath) {
  let token = assetTokensByPath.get(absPath);
  if (token === undefined) {
    token = String(nextAssetToken++);
    assetTokensByPath.set(absPath, token);
    assetPathsByToken.set(token, absPath);
  }
  return 'peon-asset://asset/' + token;
}

function toIpcVariant(variant) {
  return { ...variant, url: toAssetUrl(variant.path) };
}

function toIpcAnimations(categories) {
  const out = {};
  for (const [name, variants] of Object.entries(categories)) {
    out[name] = variants.map(toIpcVariant);
  }
  return out;
}

// Borders are an enhancement a pack may or may not include, and the player
// defaults to full-bleed (no border, no frame margin) even when the active
// pack has one — the user opts in via --border or the "border" config
// field. Bare minimum is sleeping+typing; everything else (borders, bg,
// reaction categories) only shows up when actually enabled.
function toIpcAssets(assets, isBorderEnabled) {
  return {
    borders: (isBorderEnabled && assets.borders) ? toIpcVariant(assets.borders) : undefined,
    bg: assets.bg ? toIpcVariant(assets.bg) : undefined,
  };
}

function parseArgPath(flag) {
  const i = process.argv.indexOf(flag);
  return (i !== -1 && process.argv[i + 1]) ? process.argv[i + 1] : null;
}

const argPet = parseArgPath('--pet');

// Resolves the user's size preference: --scale (one-shot override) then the
// "scale" config field (persistent default), then 1. Returns null on an
// invalid value — the caller treats that as a hard error, same as an
// unresolvable --pet, rather than silently falling back to 1.
function resolveScale(cfg) {
  const raw = parseArgPath('--scale') ?? (cfg.scale !== undefined ? String(cfg.scale) : null);
  if (raw === null) return 1;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`[peon-pet] Invalid --scale/config "scale" value ${JSON.stringify(raw)} — must be a positive number.`);
    return null;
  }
  return value;
}

// --border is a one-shot override to force borders on for this run; the
// "border" config field is the persistent default. There's no --no-border
// — off is already the default, so overriding "on" back to "off" for one
// run just means not passing --border and leaving the config alone.
function resolveBorderEnabled(cfg) {
  if (process.argv.includes('--border')) return true;
  return typeof cfg.border === 'boolean' ? cfg.border : false;
}

// A border's frame margin (already density-adjusted pixels, per axis — see
// resolvePack's displayMargin) only matters while borders are actually
// enabled (user opt-in) and the active pack actually has one — otherwise
// {x:0, y:0}, so the window never grows to make room for a frame nothing
// will draw.
function activeBorderMargin() {
  return (borderEnabled && resolvedPack.assets.borders?.displayMargin) || { x: 0, y: 0 };
}

function windowSizeForVariant(variant, isSubAgentWindow) {
  const margin = activeBorderMargin();
  const { width, height } = computeWindowSize(variant, {
    marginX: margin.x,
    marginY: margin.y,
    scale,
    subAgent: isSubAgentWindow,
  });
  return { width: Math.round(width), height: Math.round(height) };
}

function loadPetConfig() {
  try {
    return JSON.parse(fs.readFileSync(
      path.join(app.getPath('userData'), 'peon-pet-config.json'), 'utf8'
    ));
  } catch { return {}; }
}

function listBundledPetNames(assetsDir) {
  return fs.readdirSync(assetsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => fs.existsSync(path.join(assetsDir, entry.name, 'openpeon.json')))
    .map((entry) => entry.name)
    .sort();
}

// Returns the registered protocol info, or null if `pet` doesn't resolve to
// any valid pack — a misspelled or nonexistent name is a mistake the user
// should be told about immediately, not one that silently degrades to orc.
function registerPetProtocol() {
  const cfg = loadPetConfig();
  const pet = argPet || cfg.pet || 'orc';
  const assetsDir = path.join(__dirname, 'renderer', 'assets');
  const defaultBundledDir = path.join(assetsDir, 'orc');
  const bundledDir = path.join(assetsDir, pet);
  const petsDir = path.join(os.homedir(), '.openpeon', 'pets');
  const customDir = path.join(petsDir, pet);

  const defaultManifest = loadManifestFromDir(defaultBundledDir);

  let activeManifest = null;
  let activeDir = null;
  let lastError = null;
  try {
    activeManifest = loadManifestFromDir(customDir);
    if (activeManifest) activeDir = customDir;
  } catch (err) {
    console.warn(`[peon-pet] Ignoring invalid custom pack at ${customDir}, trying the bundled pack instead: ${err.message}`);
    lastError = err;
  }
  if (!activeManifest) {
    try {
      activeManifest = loadManifestFromDir(bundledDir);
      if (activeManifest) activeDir = bundledDir;
    } catch (err) {
      lastError = err;
    }
  }

  if (!activeManifest) {
    const available = listBundledPetNames(assetsDir).join(', ');
    const reason = lastError ? lastError.message : `no pack found at ${bundledDir} or ${customDir}`;
    console.error(`[peon-pet] Unknown or invalid pet "${pet}": ${reason}\nAvailable bundled pets: ${available}`);
    return null;
  }

  resolvedPack = resolvePack(activeManifest, activeDir, defaultManifest, defaultBundledDir);

  // Every token this protocol is ever asked for was minted by toAssetUrl()
  // from a path inside resolvedPack, in this same process — the renderer
  // never constructs one itself, so a miss here means a stale/foreign URL.
  protocol.handle('peon-asset', (request) => {
    const token = new URL(request.url).pathname.replace(/^\//, '');
    const absPath = assetPathsByToken.get(token);
    if (!absPath) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch('file://' + absPath);
  });

  return { pet, assetsDir, defaultBundledDir };
}

const tracker = createSessionTracker();
const sessionCwds = new Map();  // session_id → cwd string
const remoteSessionIds = new Set();
const remoteLastEvents = new Map();  // session_id → last event string
const SESSION_PRUNE_MS = 10 * 60 * 1000;  // 10min — prune cold sessions
const HOT_MS  = 30 * 1000;       // 30s  — actively working right now
const WARM_MS = 2 * 60 * 1000;   // 2min — session open but idle

async function readRemoteState(baseUrl) {
  try {
    const res = await net.fetch(`${baseUrl}/state`, { signal: AbortSignal.timeout(150) });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// Sub-agent windows can each be a different size (their pet resizes per
// active category same as the main window, just at half scale), so they're
// stacked by summing actual current heights rather than a fixed per-slot
// spacing — this keeps them touching with no gap or overlap regardless.
function repositionSubAgentWindows() {
  const { height } = screen.getPrimaryDisplay().workAreaSize;
  let stackY = height - SUB_AGENT_BASE_Y_OFFSET;
  for (const [, subWin] of subAgentWindows) {
    if (!subWin.isDestroyed()) {
      const [, winH] = subWin.getSize();
      stackY -= winH;
      subWin.setPosition(20, stackY);
    }
  }
}

function createSubAgentWindow(sessionId) {
  if (subAgentWindows.size >= MAX_SUB_AGENT_WINDOWS) return;
  if (subAgentWindows.has(sessionId)) return;

  const sleepingVariant = resolvedPack.categories.sleeping[0];
  const { width: subW, height: subH } = windowSizeForVariant(sleepingVariant, true);

  const subWin = new BrowserWindow({
    width: subW,
    height: subH,
    x: 20,
    y: 0, // provisional — repositionSubAgentWindows() below fixes this immediately
    transparent: true,
    frame: false,
    roundedCorners: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  subWin.setIgnoreMouseEvents(true);

  subWin.loadFile('renderer/index.html');

  subWin.webContents.once('did-finish-load', () => {
    subWin.webContents.send('peon-config', {
      subAgent: true,
      scale,
      animations: toIpcAnimations(resolvedPack.categories),
      assets: toIpcAssets(resolvedPack.assets, borderEnabled),
    });
    subWin.webContents.send('peon-event', { anim: 'waking', event: 'SessionStart' });
    startMouseTrackingForWindow(subWin);
  });

  // Don't quit app when sub-agent window closes
  subWin.on('closed', () => {
    subAgentWindows.delete(sessionId);
    subAgentCreatedAt.delete(sessionId);
    repositionSubAgentWindows();
  });

  if (!petVisible) subWin.hide();

  subAgentWindows.set(sessionId, subWin);
  subAgentCreatedAt.set(sessionId, Date.now());
  repositionSubAgentWindows();
}

function destroySubAgentWindow(sessionId) {
  const subWin = subAgentWindows.get(sessionId);
  if (subWin && !subWin.isDestroyed()) {
    subWin.destroy();
  }
  subAgentWindows.delete(sessionId);
  subAgentCreatedAt.delete(sessionId);
  repositionSubAgentWindows();
}

function handleSessionEvent({ sessionId, event, cwd, timestamp }) {
  if (!isValidSessionId(sessionId)) return;

  const now = Date.now();

  // SessionCwd: just update the display name, no tracker change
  if (event === 'SessionCwd') {
    if (cwd) {
      sessionCwds.set(sessionId, cwd);
      sendSessionUpdate(now);
    }
    return;
  }

  if (event === 'SessionEnd') {
    tracker.remove(sessionId);
    sessionCwds.delete(sessionId);
  } else if (event === 'SessionSeen') {
    // File existed at startup: register with actual file mtime, no animation, no dedup
    tracker.update(sessionId, timestamp || now);
    if (cwd) sessionCwds.set(sessionId, cwd);
  } else {
    if (event === 'SessionStart') {
      // Deduplicate /resume: if exactly one session was seen <5s ago, replace it
      const existing = tracker.entries();
      const isNew = !existing.some(([id]) => id === sessionId);
      if (isNew && existing.length === 1) {
        const [oldId, oldTime] = existing[0];
        if ((now - oldTime) < 5000) tracker.remove(oldId);
      }
    }
    tracker.update(sessionId, now);
    if (cwd) sessionCwds.set(sessionId, cwd);
  }

  tracker.prune(now - SESSION_PRUNE_MS);
  for (const id of sessionCwds.keys()) {
    if (!tracker.entries().some(([sid]) => sid === id)) sessionCwds.delete(id);
  }

  sendSessionUpdate(now);

  const anim = EVENT_TO_ANIM[event];
  if (anim && win && !win.isDestroyed()) {
    win.webContents.send('peon-event', { anim, event });
  }
}

function sendSessionUpdate(now) {
  if (!win || win.isDestroyed()) return;
  const sessions = buildSessionStates(tracker.entries(), now, HOT_MS, WARM_MS, 10);
  win.webContents.send('session-update', {
    sessions: sessions.map(s => ({
      ...s,
      cwd: sessionCwds.get(s.id) || null,
      name: sessionCwds.get(s.id) ? path.basename(sessionCwds.get(s.id)) : null,
    })),
  });
}

function syncRemoteSessionsToTracker(state) {
  if (!state || !state.sessions) return;
  const now = Date.now();
  const incoming = state.sessions;

  for (const [sid, entry] of Object.entries(incoming)) {
    if (!isValidSessionId(sid)) continue;
    tracker.update(sid, entry.timestamp * 1000);  // relay uses Unix seconds
    if (entry.cwd) sessionCwds.set(sid, entry.cwd);
    remoteSessionIds.add(sid);
    const anim = EVENT_TO_ANIM[entry.event];
    if (anim && entry.event !== remoteLastEvents.get(sid)) {
      remoteLastEvents.set(sid, entry.event);
      if (win && !win.isDestroyed()) win.webContents.send('peon-event', { anim, event: entry.event });
    }
  }

  for (const sid of [...remoteSessionIds]) {
    if (!incoming[sid]) {
      tracker.remove(sid);
      sessionCwds.delete(sid);
      remoteSessionIds.delete(sid);
      remoteLastEvents.delete(sid);
    }
  }

  sendSessionUpdate(now);
}

let pollingWatcher = null;
let heartbeatInterval = null;
let remoteInterval = null;

function startPolling() {
  const cfg = loadPetConfig();
  const remoteUrl = cfg.remoteUrl || 'http://127.0.0.1:19998';

  pollingWatcher = new JsonlWatcher();

  pollingWatcher.on('session-event', handleSessionEvent);
  pollingWatcher.on('subagent-event', ({ parentToolId, event }) => {
    if (event === 'SubagentStart') createSubAgentWindow(parentToolId);
    if (event === 'SubagentStop')  destroySubAgentWindow(parentToolId);
  });

  pollingWatcher.start();

  // Heartbeat: refresh session hot/warm status so the pet correctly decays.
  // Sessions with pending tools are kept hot so the pet stays awake during long tool runs.
  // Also runs the TTL sweep for sub-agent windows whose SubagentStop never fired.
  heartbeatInterval = setInterval(() => {
    const now = Date.now();
    const expired = [...subAgentCreatedAt.entries()]
      .filter(([sid, createdAt]) => now - createdAt > SUB_AGENT_TTL_MS && !dummySessionIds.has(sid))
      .map(([sid]) => sid);
    for (const sid of expired) destroySubAgentWindow(sid);

    if (tracker.entries().length === 0) return;
    for (const sessionId of pollingWatcher.getActiveSessionIds()) {
      tracker.update(sessionId, now);
    }
    sendSessionUpdate(now);
  }, 5000);

  // Remote relay sync (less frequent, not time-critical)
  remoteInterval = setInterval(async () => {
    syncRemoteSessionsToTracker(await readRemoteState(remoteUrl));
  }, 5000);
}

// --- Drag state ---
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let ignoringMouse = true;  // tracks last setIgnoreMouseEvents value

ipcMain.on('drag-start', () => {
  if (!win || win.isDestroyed()) return;
  isDragging = true;
  const { x: cx, y: cy } = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  dragOffsetX = cx - wx;
  dragOffsetY = cy - wy;
  if (ignoringMouse) {
    win.setIgnoreMouseEvents(false);
    ignoringMouse = false;
  }
});

ipcMain.on('drag-stop', () => {
  isDragging = false;
});

ipcMain.on('show-tooltip', (_event, { html, x, y }) => {
  const tw = ensureTooltipWindow();
  pendingTooltipAnchor = { x, y };
  tw.webContents.send('tooltip-show', html);
});

ipcMain.on('hide-tooltip', () => {
  if (tooltipWin && !tooltipWin.isDestroyed()) tooltipWin.hide();
});

// The tooltip page reports its natural content size after every update
// (see renderer/tooltip.js) — only then do we know the right window size,
// so showing happens here rather than in the 'show-tooltip' handler above.
ipcMain.on('tooltip-size', (_event, { width, height }) => {
  if (!tooltipWin || tooltipWin.isDestroyed()) return;
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const x = Math.round(Math.min(pendingTooltipAnchor.x, screenW - width - 2));
  const y = Math.round(Math.min(pendingTooltipAnchor.y, screenH - height - 2));
  tooltipWin.setBounds({ x, y, width, height });
  tooltipWin.showInactive();
});

// Poll cursor position to enable mouse events only when hovering the window.
// This lets the renderer receive mousemove for tooltips while keeping click-through.
// During drag, moves the window to follow the cursor.
function startMouseTrackingForWindow(targetWin) {
  const intervalId = setInterval(() => {
    if (!targetWin || targetWin.isDestroyed()) {
      clearInterval(intervalId);
      return;
    }
    const { x: cx, y: cy } = screen.getCursorScreenPoint();

    if (targetWin === win && isDragging) {
      const nx = cx - dragOffsetX;
      const ny = cy - dragOffsetY;
      const [wx, wy] = targetWin.getPosition();
      if (nx !== wx || ny !== wy) targetWin.setPosition(nx, ny);
      return;
    }

    const [wx, wy] = targetWin.getPosition();
    const [ww, wh] = targetWin.getSize();
    const inside = cx >= wx && cx <= wx + ww && cy >= wy && cy <= wy + wh;
    if (targetWin === win) {
      if (inside !== !ignoringMouse) {
        targetWin.setIgnoreMouseEvents(!inside);
        ignoringMouse = !inside;
      }
    } else {
      targetWin.setIgnoreMouseEvents(!inside);
    }
  }, 50);
}

function buildDockMenu() {
  return Menu.buildFromTemplate([
    {
      label: petVisible ? 'Hide Pet' : 'Show Pet',
      click() {
        if (!win || win.isDestroyed()) return;
        if (petVisible) {
          win.hide();
          for (const [, subWin] of subAgentWindows) {
            if (!subWin.isDestroyed()) subWin.hide();
          }
        } else {
          win.show();
          for (const [, subWin] of subAgentWindows) {
            if (!subWin.isDestroyed()) subWin.show();
          }
        }
        petVisible = !petVisible;
        app.dock.setMenu(buildDockMenu());
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click() {
        app.quit();
      },
    },
  ]);
}

const { WIN_MARGIN, cornerPosition } = require('./lib/window-position');

function createWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const cfg = loadPetConfig();
  const sleepingVariant = resolvedPack.categories.sleeping[0];
  const { width: petW, height: petH } = windowSizeForVariant(sleepingVariant, false);
  const { x, y } = cornerPosition(cfg.corner, screenW, screenH, petW, petH);

  win = new BrowserWindow({
    width: petW,
    height: petH,
    x,
    y,
    transparent: true,
    frame: false,
    roundedCorners: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setIgnoreMouseEvents(true);

  win.loadFile('renderer/index.html');

  if (process.platform === 'darwin') {
    const dockIconEntry = resolvedPack?.assets?.['dock-icon'];
    if (dockIconEntry) {
      app.dock.setIcon(dockIconEntry.path);
    }
    app.dock.setMenu(buildDockMenu());
  }

  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  // Reset drag if renderer reloads or crashes
  win.webContents.on('did-finish-load', () => { isDragging = false; });

  // Clean up sub-agent windows when main window closes
  win.on('closed', () => {
    for (const subWin of subAgentWindows.values()) {
      if (!subWin.isDestroyed()) subWin.destroy();
    }
    subAgentWindows.clear();
    if (tooltipWin && !tooltipWin.isDestroyed()) tooltipWin.destroy();
    tooltipWin = null;
  });

  // Start polling once window is ready
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('peon-config', {
      subAgent: false,
      scale,
      animations: toIpcAnimations(resolvedPack.categories),
      assets: toIpcAssets(resolvedPack.assets, borderEnabled),
    });
    startPolling();
    startMouseTrackingForWindow(win);

    // Dev-only: spawn dummy sub-agents for visual testing
    if (process.argv.includes('--spawn-test')) {
      const dummyIds = ['dummy-1', 'dummy-2', 'dummy-3'];
      for (const id of dummyIds) {
        dummySessionIds.add(id);
        createSubAgentWindow(id);
      }
      setTimeout(() => {
        for (const id of dummyIds) {
          dummySessionIds.delete(id);
          destroySubAgentWindow(id);
        }
      }, 3000);
    }
  });
}

app.setName('Peon Pet');

// Renderer-requested resize: only the main process can resize a real OS
// window, but variant selection (which picks the size) happens in the
// renderer, so it reports the final size (already scaled/margined/halved
// for a sub-agent, per lib/pet-size.js) here on every category transition.
ipcMain.on('resize-pet', (event, { width, height }) => {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  if (!senderWin || senderWin.isDestroyed()) return;
  senderWin.setSize(w, h);
  if (senderWin === win) {
    const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
    const cfg = loadPetConfig();
    const { x, y } = cornerPosition(cfg.corner, screenW, screenH, w, h);
    senderWin.setPosition(x, y);
  } else {
    repositionSubAgentWindows();
  }
});

// Route OS signals through Electron's quit flow so before-quit / will-quit
// handlers run and windows are destroyed cleanly.
process.on('SIGINT',  () => app.quit());
process.on('SIGTERM', () => app.quit());
process.on('SIGHUP',  () => app.quit());

app.on('before-quit', () => {
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
  if (remoteInterval)    { clearInterval(remoteInterval);    remoteInterval = null; }
  if (pollingWatcher)    { pollingWatcher.stop();             pollingWatcher = null; }
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    const legacyCharactersDir = path.join(app.getPath('userData'), 'characters');
    const petsDir = path.join(os.homedir(), '.openpeon', 'pets');
    migrateLegacyCharacters(legacyCharactersDir, petsDir);

    const cfg = loadPetConfig();
    scale = resolveScale(cfg);
    if (scale === null) {
      app.exit(1);
      return;
    }
    borderEnabled = resolveBorderEnabled(cfg);

    if (!registerPetProtocol()) {
      app.exit(1);
      return;
    }
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
