'use strict';

const fs = require('fs');
const { getConfigPath } = require('./paths');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(patch) {
  const configPath = getConfigPath();
  const current = loadConfig();
  const next = { ...current, ...patch };
  fs.mkdirSync(require('path').dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

module.exports = { loadConfig, writeConfig };
