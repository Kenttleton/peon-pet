'use strict';

const os = require('os');
const path = require('path');
const { getUserDataDir, getConfigPath, getBundledPacksDir, getCustomPacksDir } = require('../lib/paths');

describe('paths', () => {
  test('getUserDataDir returns macOS convention on darwin', () => {
    const dir = getUserDataDir();
    expect(dir).toBe(path.join(os.homedir(), 'Library', 'Application Support', 'Peon Pet'));
  });

  test('getConfigPath is inside getUserDataDir', () => {
    expect(getConfigPath()).toBe(path.join(getUserDataDir(), 'peon-pet-config.json'));
  });

  test('getBundledPacksDir points at renderer/assets', () => {
    expect(getBundledPacksDir()).toBe(path.join(__dirname, '..', 'renderer', 'assets'));
  });

  test('getCustomPacksDir points at ~/.openpeon/pets', () => {
    expect(getCustomPacksDir()).toBe(path.join(os.homedir(), '.openpeon', 'pets'));
  });
});
