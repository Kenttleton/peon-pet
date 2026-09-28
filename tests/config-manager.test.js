'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_CFG_DIR  = path.join(os.tmpdir(), 'peon-pet-cfg-mgr-test');
const TEST_CFG_PATH = path.join(TEST_CFG_DIR, 'peon-pet-config.json');

jest.mock('../lib/paths', () => {
  const path = require('path');
  const os   = require('os');
  const dir  = path.join(os.tmpdir(), 'peon-pet-cfg-mgr-test');
  require('fs').mkdirSync(dir, { recursive: true });
  return {
    getUserDataDir:    () => dir,
    getConfigPath:     () => path.join(dir, 'peon-pet-config.json'),
    getBundledPacksDir:() => path.join(__dirname, '..', 'renderer', 'assets'),
    getCustomPacksDir: () => path.join(os.homedir(), '.openpeon', 'pets'),
  };
});

const { ConfigManager } = require('../lib/config-manager');

afterAll(() => { fs.rmSync(TEST_CFG_DIR, { recursive: true, force: true }); });
beforeEach(() => { if (fs.existsSync(TEST_CFG_PATH)) fs.unlinkSync(TEST_CFG_PATH); });

// ─── getWindowState ───────────────────────────────────────────────────────────

describe('getWindowState', () => {
  test('returns undefined for all keys when config is missing', () => {
    const cfg = new ConfigManager();
    const ws = cfg.getWindowState();
    expect(ws.windowX).toBeUndefined();
    expect(ws.windowY).toBeUndefined();
    expect(ws.snapCorner).toBeUndefined();
  });

  test('returns persisted values when present', () => {
    fs.writeFileSync(TEST_CFG_PATH, JSON.stringify({ windowX: 100, windowY: 200, snapCorner: 'bottom-left' }));
    const ws = new ConfigManager().getWindowState();
    expect(ws.windowX).toBe(100);
    expect(ws.windowY).toBe(200);
    expect(ws.snapCorner).toBe('bottom-left');
  });
});

// ─── saveWindowState ─────────────────────────────────────────────────────────

describe('saveWindowState', () => {
  test('writes window state keys', () => {
    const cfg = new ConfigManager();
    cfg.saveWindowState({ windowX: 50, windowY: 75 });
    const ws = cfg.getWindowState();
    expect(ws.windowX).toBe(50);
    expect(ws.windowY).toBe(75);
  });

  test('does not overwrite app config keys', () => {
    const cfg = new ConfigManager();
    cfg.saveAppConfig({ pet: 'orc', scale: 2 });
    cfg.saveWindowState({ windowX: 10, windowY: 20 });
    const app = cfg.getAppConfig();
    expect(app.pet).toBe('orc');
    expect(app.scale).toBe(2);
  });

  test('undefined values in patch are not written', () => {
    const cfg = new ConfigManager();
    cfg.saveWindowState({ windowX: undefined, windowY: 100 });
    const raw = JSON.parse(fs.readFileSync(TEST_CFG_PATH, 'utf8'));
    expect(Object.prototype.hasOwnProperty.call(raw, 'windowX')).toBe(false);
    expect(raw.windowY).toBe(100);
  });

  test('merges with existing window state', () => {
    const cfg = new ConfigManager();
    cfg.saveWindowState({ windowX: 10, windowY: 20 });
    cfg.saveWindowState({ windowX: 99 });
    const ws = cfg.getWindowState();
    expect(ws.windowX).toBe(99);
    expect(ws.windowY).toBe(20);
  });
});

// ─── getAppConfig ─────────────────────────────────────────────────────────────

describe('getAppConfig', () => {
  test('returns defaults when config is missing', () => {
    const app = new ConfigManager().getAppConfig();
    expect(app.pet).toBe('orc');
    expect(app.border).toBe(false);
    expect(app.cornerRadius).toBe(0);
    expect(app.remoteUrl).toBe('http://127.0.0.1:19998');
    expect(app.subAgentMargin).toBe(12);
    expect(app.scale).toBeUndefined();
  });

  test('returns persisted values over defaults', () => {
    fs.writeFileSync(TEST_CFG_PATH, JSON.stringify({ pet: 'capybara', scale: 2, border: true, cornerRadius: 8, remoteUrl: 'http://example.com', subAgentMargin: 20 }));
    const app = new ConfigManager().getAppConfig();
    expect(app.pet).toBe('capybara');
    expect(app.scale).toBe(2);
    expect(app.border).toBe(true);
    expect(app.cornerRadius).toBe(8);
    expect(app.remoteUrl).toBe('http://example.com');
    expect(app.subAgentMargin).toBe(20);
  });
});

// ─── saveAppConfig ────────────────────────────────────────────────────────────

describe('saveAppConfig', () => {
  test('writes app config keys', () => {
    const cfg = new ConfigManager();
    cfg.saveAppConfig({ pet: 'capybara', scale: 2 });
    const app = cfg.getAppConfig();
    expect(app.pet).toBe('capybara');
    expect(app.scale).toBe(2);
  });

  test('does not overwrite window state keys', () => {
    const cfg = new ConfigManager();
    cfg.saveWindowState({ windowX: 42, windowY: 99 });
    cfg.saveAppConfig({ pet: 'orc' });
    const ws = cfg.getWindowState();
    expect(ws.windowX).toBe(42);
    expect(ws.windowY).toBe(99);
  });

  test('undefined values in patch are not written', () => {
    const cfg = new ConfigManager();
    cfg.saveAppConfig({ pet: undefined, scale: 2 });
    const raw = JSON.parse(fs.readFileSync(TEST_CFG_PATH, 'utf8'));
    expect(Object.prototype.hasOwnProperty.call(raw, 'pet')).toBe(false);
    expect(raw.scale).toBe(2);
  });
});

// ─── getRaw ──────────────────────────────────────────────────────────────────

describe('getRaw', () => {
  test('returns full config object', () => {
    fs.writeFileSync(TEST_CFG_PATH, JSON.stringify({ pet: 'orc', windowX: 10 }));
    const raw = new ConfigManager().getRaw();
    expect(raw.pet).toBe('orc');
    expect(raw.windowX).toBe(10);
  });

  test('returns empty object when config missing', () => {
    expect(new ConfigManager().getRaw()).toEqual({});
  });
});
