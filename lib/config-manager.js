'use strict';

const fs = require('fs');
const path = require('path');
const { getConfigPath } = require('./paths');

function definedOnly(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

class ConfigManager {
  _load() {
    try { return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8')); }
    catch { return {}; }
  }

  _write(patch) {
    const configPath = getConfigPath();
    const current = this._load();
    const next = { ...current, ...patch };
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
    return next;
  }

  getWindowState() {
    const raw = this._load();
    return {
      windowX:    raw.windowX,
      windowY:    raw.windowY,
      snapCorner: raw.snapCorner,
    };
  }

  saveWindowState(patch) {
    this._write(definedOnly(patch));
  }

  getAppConfig() {
    const raw = this._load();
    return {
      pet:            raw.pet            ?? 'orc',
      scale:          raw.scale,
      border:         raw.border         ?? false,
      cornerRadius:   raw.cornerRadius   ?? 0,
      remoteUrl:      raw.remoteUrl      ?? 'http://127.0.0.1:19998',
      subAgentMargin: raw.subAgentMargin ?? 12,
    };
  }

  saveAppConfig(patch) {
    this._write(definedOnly(patch));
  }

  getRaw() {
    return this._load();
  }
}

module.exports = { ConfigManager };
