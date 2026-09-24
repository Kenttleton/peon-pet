'use strict';

const os = require('os');
const path = require('path');

const APP_NAME = 'Peon Pet';

function getUserDataDir() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
  }
  return path.join(os.homedir(), '.config', APP_NAME);
}

function getConfigPath() {
  return path.join(getUserDataDir(), 'peon-pet-config.json');
}

function getBundledPacksDir() {
  return path.join(__dirname, '..', 'renderer', 'assets');
}

function getCustomPacksDir() {
  return path.join(os.homedir(), '.openpeon', 'pets');
}

module.exports = { getUserDataDir, getConfigPath, getBundledPacksDir, getCustomPacksDir };
