
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CATEGORIES,
  ASSET_KEYS,
  NAME_PATTERN,
  validateManifest,
  resolvePack,
  loadManifestFromDir,
} = require('../lib/ceap-manifest');

function validManifest(overrides = {}) {
  return {
    ceap_version: '1.0',
    name: 'test-pack',
    display_name: 'Test Pack',
    version: '1.0.0',
    categories: {
      sleeping: [{ file: 'atlas.png', row: 0, rows: 6, frames: 6, fps: 3, loop: true }],
      typing:   [{ file: 'atlas.png', row: 2, rows: 6, frames: 6, fps: 8 }],
    },
    assets: {
      borders: { file: 'borders.png' },
    },
    ...overrides,
  };
}

describe('constants', () => {
  test('CATEGORIES has the 6 fixed names', () => {
    expect([...CATEGORIES].sort()).toEqual(
      ['alarmed', 'annoyed', 'celebrate', 'sleeping', 'typing', 'waking']
    );
  });

  test('ASSET_KEYS has the 3 fixed names', () => {
    expect([...ASSET_KEYS].sort()).toEqual(['bg', 'borders', 'dock-icon']);
  });

  test('NAME_PATTERN accepts lowercase-with-hyphen names', () => {
    expect(NAME_PATTERN.test('hello-kitty')).toBe(true);
  });

  test('NAME_PATTERN rejects uppercase', () => {
    expect(NAME_PATTERN.test('Hello')).toBe(false);
  });
});

describe('validateManifest', () => {
  test('a fully valid manifest has no errors', () => {
    expect(validateManifest(validManifest())).toEqual([]);
  });

  test('rejects missing ceap_version', () => {
    const m = validManifest();
    delete m.ceap_version;
    expect(validateManifest(m).some(e => e.includes('ceap_version'))).toBe(true);
  });

  test('rejects a name that does not match NAME_PATTERN', () => {
    const m = validManifest({ name: 'Not Valid!' });
    expect(validateManifest(m).some(e => e.includes('name'))).toBe(true);
  });

  test('rejects a manifest with no categories at all', () => {
    const m = validManifest();
    delete m.categories;
    expect(validateManifest(m).some(e => e.includes('categories'))).toBe(true);
  });

  test('rejects a categories block missing the typing steady state', () => {
    const m = validManifest();
    delete m.categories.typing;
    expect(validateManifest(m).some(e => e.includes('typing'))).toBe(true);
  });

  test('rejects a categories block missing the sleeping steady state', () => {
    const m = validManifest();
    delete m.categories.sleeping;
    expect(validateManifest(m).some(e => e.includes('sleeping'))).toBe(true);
  });

  test('rejects an unknown category name', () => {
    const m = validManifest();
    m.categories.dancing = [{ file: 'atlas.png', frames: 6, fps: 8 }];
    expect(validateManifest(m).some(e => e.includes('dancing'))).toBe(true);
  });

  test('rejects a category with an empty variant array', () => {
    const m = validManifest();
    m.categories.typing = [];
    expect(validateManifest(m).some(e => e.includes('typing'))).toBe(true);
  });

  test('rejects a category value that is not an array', () => {
    const m = validManifest();
    m.categories.typing = { file: 'atlas.png', frames: 6, fps: 8 };
    expect(validateManifest(m).some(e => e.includes('typing'))).toBe(true);
  });

  test('rejects an unknown asset key', () => {
    const m = validManifest();
    m.assets.hat = { file: 'hat.png' };
    expect(validateManifest(m).some(e => e.includes('hat'))).toBe(true);
  });

  test('rejects a variant missing frames', () => {
    const m = validManifest();
    delete m.categories.sleeping[0].frames;
    expect(validateManifest(m).some(e => e.includes('frames'))).toBe(true);
  });

  test('rejects row >= rows', () => {
    const m = validManifest();
    m.categories.sleeping[0].row = 6;
    m.categories.sleeping[0].rows = 6;
    expect(validateManifest(m).some(e => e.includes('row'))).toBe(true);
  });

  test('rejects two variants sharing a file with different rows', () => {
    const m = validManifest();
    m.categories.typing[0].rows = 3;
    expect(validateManifest(m).some(e => e.includes('rows'))).toBe(true);
  });

  test('accepts two variants sharing a file with the same rows', () => {
    expect(validateManifest(validManifest())).toEqual([]);
  });

  test('accepts a category with multiple variants', () => {
    const m = validManifest();
    m.categories.typing.push({ file: 'typing-frantic.png', frames: 6, fps: 10, label: 'frantic' });
    expect(validateManifest(m)).toEqual([]);
  });

  test('rejects dock-icon declaring frames > 1', () => {
    const m = validManifest();
    m.assets['dock-icon'] = { file: 'dock-icon.png', frames: 2, fps: 4 };
    expect(validateManifest(m).some(e => e.includes('dock-icon'))).toBe(true);
  });

  test('accepts an animated borders/bg asset with frames + fps', () => {
    const m = validManifest();
    m.assets.borders = { file: 'borders-lightning.png', frames: 8, fps: 12, loop: true };
    expect(validateManifest(m)).toEqual([]);
  });

  test('rejects an animated asset missing fps', () => {
    const m = validManifest();
    m.assets.borders = { file: 'borders-lightning.png', frames: 8 };
    expect(validateManifest(m).some(e => e.includes('fps'))).toBe(true);
  });
});

describe('resolvePack', () => {
  const active = validManifest({
    name: 'active-pack',
    categories: {
      sleeping: [{ file: 'active-atlas.png', row: 0, rows: 1, frames: 6, fps: 3, loop: true }],
      typing:   [{ file: 'active-atlas.png', row: 0, rows: 1, frames: 6, fps: 8 }],
    },
    assets: {
      borders: { file: 'active-borders.png' },
    },
  });
  const dflt = validManifest({
    name: 'orc',
    categories: {
      sleeping:  [{ file: 'orc-atlas.png', row: 0, rows: 6, frames: 6, fps: 3, loop: true }],
      typing:    [{ file: 'orc-atlas.png', row: 2, rows: 6, frames: 6, fps: 8 }],
      celebrate: [{ file: 'orc-atlas.png', row: 4, rows: 6, frames: 6, fps: 8 }],
    },
    assets: {
      'dock-icon': { file: 'orc-dock-icon.png' },
      borders:     { file: 'orc-borders.png' },
      bg:          { file: 'orc-bg.png' },
    },
  });

  test('categories resolve from the active pack only, with an absolute path attached', () => {
    const { categories } = resolvePack(active, '/active/dir', dflt, '/default/dir');
    expect(categories.typing[0].file).toBe('active-atlas.png');
    expect(categories.typing[0].path).toBe(path.join('/active/dir', 'active-atlas.png'));
  });

  test('a category the active pack omits is absent from the result — no cross-pack fallback', () => {
    const { categories } = resolvePack(active, '/active/dir', dflt, '/default/dir');
    expect(categories.celebrate).toBeUndefined();
    expect('celebrate' in categories).toBe(false);
  });

  test('dock-icon falls back to the default pack when the active pack omits it', () => {
    const { assets } = resolvePack(active, '/active/dir', dflt, '/default/dir');
    expect(assets['dock-icon'].file).toBe('orc-dock-icon.png');
    expect(assets['dock-icon'].path).toBe(path.join('/default/dir', 'orc-dock-icon.png'));
  });

  test('bg has no fallback — absent from the result when the active pack omits it', () => {
    const { assets } = resolvePack(active, '/active/dir', dflt, '/default/dir');
    expect(assets.bg).toBeUndefined();
  });

  test('borders resolves from the active pack, with the active pack\'s own path', () => {
    const { assets } = resolvePack(active, '/active/dir', dflt, '/default/dir');
    expect(assets.borders.file).toBe('active-borders.png');
    expect(assets.borders.path).toBe(path.join('/active/dir', 'active-borders.png'));
  });
});

describe('loadManifestFromDir', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ceap-manifest-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns null when openpeon.json does not exist', () => {
    expect(loadManifestFromDir(tmpDir)).toBeNull();
  });

  test('parses and returns a valid manifest', () => {
    fs.writeFileSync(path.join(tmpDir, 'openpeon.json'), JSON.stringify(validManifest()));
    const manifest = loadManifestFromDir(tmpDir);
    expect(manifest.name).toBe('test-pack');
  });

  test('throws on malformed JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'openpeon.json'), '{ not json');
    expect(() => loadManifestFromDir(tmpDir)).toThrow(/Invalid JSON/);
  });

  test('throws on a manifest that fails validation', () => {
    fs.writeFileSync(path.join(tmpDir, 'openpeon.json'), JSON.stringify({ ceap_version: '1.0' }));
    expect(() => loadManifestFromDir(tmpDir)).toThrow(/Invalid CEAP manifest/);
  });
});
