'use strict';
const fs   = require('fs');
const path = require('path');
const { validateManifest } = require('../lib/ceap-manifest');

const ASSETS = path.join(__dirname, '../renderer/assets');

describe('required asset files', () => {
  test('orc/sprite-atlas.png exists', () => {
    expect(fs.existsSync(path.join(ASSETS, 'orc', 'sprite-atlas.png'))).toBe(true);
  });

  test('orc/dock-icon.png exists', () => {
    expect(fs.existsSync(path.join(ASSETS, 'orc', 'dock-icon.png'))).toBe(true);
  });

  test('orc/dock-icon.png is a valid PNG (starts with PNG magic bytes)', () => {
    const buf = fs.readFileSync(path.join(ASSETS, 'orc', 'dock-icon.png'));
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4E);
    expect(buf[3]).toBe(0x47);
  });

  test('orc/dock-icon.png is at least 10 KB', () => {
    const { size } = fs.statSync(path.join(ASSETS, 'orc', 'dock-icon.png'));
    expect(size).toBeGreaterThan(10_000);
  });

  test('orc/borders.png exists', () => {
    expect(fs.existsSync(path.join(ASSETS, 'orc', 'borders.png'))).toBe(true);
  });

  test('orc has no bg asset — its sprite already has a background baked in', () => {
    expect(fs.existsSync(path.join(ASSETS, 'orc', 'bg.png'))).toBe(false);
    const manifest = JSON.parse(fs.readFileSync(path.join(ASSETS, 'orc', 'openpeon.json'), 'utf8'));
    expect(manifest.assets?.bg).toBeUndefined();
  });

  test.each(['orc', 'orc-tavern', 'capybara', 'hello-kitty', 'test-atlas', 'laptop-guy'])(
    '%s/openpeon.json validates',
    (name) => {
      const manifest = JSON.parse(fs.readFileSync(path.join(ASSETS, name, 'openpeon.json'), 'utf8'));
      expect(validateManifest(manifest)).toEqual([]);
    }
  );

  test.each(['capybara', 'hello-kitty'])('%s/openpeon.json has no bg asset — it has no cross-pack fallback', (name) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ASSETS, name, 'openpeon.json'), 'utf8'));
    expect(manifest.assets?.bg).toBeUndefined();
  });

  test('orc-tavern has its own bg — a different sprite than the default orc pack', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ASSETS, 'orc-tavern', 'openpeon.json'), 'utf8'));
    expect(manifest.assets?.bg?.file).toBe('bg.png');
    expect(fs.existsSync(path.join(ASSETS, 'orc-tavern', 'bg.png'))).toBe(true);
  });

  test.each(['test-atlas', 'laptop-guy'])('%s has no borders/dock-icon — dock-icon falls back to orc, borders renders as none', (name) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ASSETS, name, 'openpeon.json'), 'utf8'));
    expect(manifest.assets).toBeUndefined();
  });

  test('laptop-guy declares only the categories its 4-row atlas has', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ASSETS, 'laptop-guy', 'openpeon.json'), 'utf8'));
    expect(Object.keys(manifest.categories).sort()).toEqual(['alarmed', 'sleeping', 'typing', 'waking']);
  });
});
