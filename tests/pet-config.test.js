'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Fixed path so it can be derived both inside the factory (hoisted) and in test cleanup
const TEST_CFG_DIR = path.join(os.tmpdir(), 'peon-pet-cfg-test');
const TEST_CFG_PATH = path.join(TEST_CFG_DIR, 'peon-pet-config.json');

jest.mock('../lib/paths', () => {
  const path = require('path');
  const os = require('os');
  const dir = path.join(os.tmpdir(), 'peon-pet-cfg-test');
  require('fs').mkdirSync(dir, { recursive: true });
  return {
    getUserDataDir: () => dir,
    getConfigPath: () => path.join(dir, 'peon-pet-config.json'),
    getBundledPacksDir: () => path.join(__dirname, '..', 'renderer', 'assets'),
    getCustomPacksDir: () => path.join(os.homedir(), '.openpeon', 'pets'),
  };
});

const { loadConfig, writeConfig } = require('../lib/pet-config');

afterAll(() => {
  fs.rmSync(TEST_CFG_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  if (fs.existsSync(TEST_CFG_PATH)) fs.unlinkSync(TEST_CFG_PATH);
});

describe('loadConfig', () => {
  test('returns empty object when config file does not exist', () => {
    expect(loadConfig()).toEqual({});
  });

  test('returns parsed config when file exists', () => {
    fs.writeFileSync(TEST_CFG_PATH, JSON.stringify({ pet: 'orc', scale: 2 }));
    expect(loadConfig()).toEqual({ pet: 'orc', scale: 2 });
  });
});

describe('writeConfig', () => {
  test('writes a new config file', () => {
    writeConfig({ pet: 'capybara' });
    expect(loadConfig()).toEqual({ pet: 'capybara' });
  });

  test('merges patch onto existing config', () => {
    writeConfig({ pet: 'orc', scale: 1 });
    writeConfig({ scale: 2 });
    expect(loadConfig()).toEqual({ pet: 'orc', scale: 2 });
  });

  test('returns the merged config', () => {
    writeConfig({ pet: 'orc' });
    const result = writeConfig({ border: true });
    expect(result).toEqual({ pet: 'orc', border: true });
  });
});
