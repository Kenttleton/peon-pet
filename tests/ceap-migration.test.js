
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { migrateLegacyCharacters, synthesizeLegacyManifest } = require('../lib/ceap-migration');
const { validateManifest } = require('../lib/ceap-manifest');

function mkdtemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ceap-migration-'));
}

describe('synthesizeLegacyManifest', () => {
  let dir;
  beforeEach(() => { dir = mkdtemp(); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('builds a valid manifest from character.json + sprite-atlas.png', () => {
    fs.writeFileSync(path.join(dir, 'character.json'), JSON.stringify({
      name: 'My Character', slug: 'my-character', author: 'someone', version: '2.0.0',
    }));
    fs.writeFileSync(path.join(dir, 'sprite-atlas.png'), Buffer.from([0]));

    const manifest = synthesizeLegacyManifest(dir, 'my-character');

    expect(validateManifest(manifest)).toEqual([]);
    expect(manifest.name).toBe('my-character');
    expect(manifest.display_name).toBe('My Character');
    expect(manifest.version).toBe('2.0.0');
    expect(manifest.categories.sleeping).toHaveLength(1);
    expect(manifest.categories.sleeping[0].file).toBe('sprite-atlas.png');
    expect(manifest.categories.sleeping[0].rows).toBe(6);
    expect(Object.keys(manifest.categories).sort()).toEqual(
      ['alarmed', 'annoyed', 'celebrate', 'sleeping', 'typing', 'waking']
    );
  });

  test('falls back to the slug when character.json is missing', () => {
    fs.writeFileSync(path.join(dir, 'sprite-atlas.png'), Buffer.from([0]));
    const manifest = synthesizeLegacyManifest(dir, 'fallback-slug');
    expect(manifest.name).toBe('fallback-slug');
    expect(manifest.display_name).toBe('fallback-slug');
  });

  test('includes only the optional assets that exist on disk', () => {
    fs.writeFileSync(path.join(dir, 'sprite-atlas.png'), Buffer.from([0]));
    fs.writeFileSync(path.join(dir, 'borders.png'), Buffer.from([0]));
    const manifest = synthesizeLegacyManifest(dir, 'slug');
    expect(manifest.assets).toEqual({ borders: { file: 'borders.png' } });
  });

  test('a folder with no sprite-atlas.png fails validation, even with other assets present', () => {
    fs.writeFileSync(path.join(dir, 'borders.png'), Buffer.from([0]));
    const manifest = synthesizeLegacyManifest(dir, 'no-atlas-slug');
    // categories is required in CEAP v1.0 — an assets-only synthesis can never validate.
    expect(validateManifest(manifest).some(e => e.includes('categories'))).toBe(true);
  });
});

describe('migrateLegacyCharacters', () => {
  let legacyDir, petsDir;

  beforeEach(() => {
    const root = mkdtemp();
    legacyDir = path.join(root, 'characters');
    petsDir = path.join(root, 'pets');
  });

  test('no-ops when the legacy dir does not exist', () => {
    migrateLegacyCharacters(legacyDir, petsDir);
    expect(fs.existsSync(petsDir)).toBe(false);
  });

  test('no-ops when the pets dir already exists', () => {
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.mkdirSync(petsDir, { recursive: true });
    fs.writeFileSync(path.join(petsDir, 'sentinel.txt'), 'keep');

    migrateLegacyCharacters(legacyDir, petsDir);

    expect(fs.existsSync(path.join(petsDir, 'sentinel.txt'))).toBe(true);
  });

  test('copies a legacy character folder and synthesizes a manifest', () => {
    const legacyCharDir = path.join(legacyDir, 'my-character');
    fs.mkdirSync(legacyCharDir, { recursive: true });
    fs.writeFileSync(path.join(legacyCharDir, 'character.json'), JSON.stringify({
      name: 'My Character', slug: 'my-character', version: '1.0.0',
    }));
    fs.writeFileSync(path.join(legacyCharDir, 'sprite-atlas.png'), Buffer.from([0]));

    migrateLegacyCharacters(legacyDir, petsDir);

    const manifestPath = path.join(petsDir, 'my-character', 'openpeon.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.name).toBe('my-character');
    expect(fs.existsSync(path.join(petsDir, 'my-character', 'sprite-atlas.png'))).toBe(true);
  });

  test('copies files but skips writing a manifest when synthesis would be invalid', () => {
    const legacyCharDir = path.join(legacyDir, 'broken-character');
    fs.mkdirSync(legacyCharDir, { recursive: true });
    fs.writeFileSync(path.join(legacyCharDir, 'character.json'), JSON.stringify({ name: 'Broken' }));

    migrateLegacyCharacters(legacyDir, petsDir);

    expect(fs.existsSync(path.join(petsDir, 'broken-character', 'character.json'))).toBe(true);
    expect(fs.existsSync(path.join(petsDir, 'broken-character', 'openpeon.json'))).toBe(false);
  });
});
