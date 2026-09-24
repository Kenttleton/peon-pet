
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const {
  CATEGORIES,
  ASSET_KEYS,
  NAME_PATTERN,
  validateManifest,
  resolvePack,
  loadManifestFromDir,
} = require('../lib/ceap-manifest');

// A minimal, real, valid PNG at the given pixel dimensions — resolvePack
// now reads each variant's actual file to compute display size, so tests
// need real files on disk, not just fake path strings.
function writeMinimalPng(filePath, width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const crc = typeof zlib.crc32 === 'function' ? zlib.crc32(Buffer.concat([typeBuf, data])) : 0;
    crcBuf.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  const rowBytes = width + 1;
  const raw = Buffer.alloc(rowBytes * height, 0);
  const idatData = zlib.deflateSync(raw);
  fs.writeFileSync(filePath, Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idatData), chunk('IEND', Buffer.alloc(0))]));
}

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

  test('accepts a borders margin with non-negative x/y (native pixels)', () => {
    const m = validManifest();
    m.assets.borders = { file: 'borders.png', margin: { x: 90, y: 60 } };
    expect(validateManifest(m)).toEqual([]);
  });

  test('accepts a zero borders margin', () => {
    const m = validManifest();
    m.assets.borders = { file: 'borders.png', margin: { x: 0, y: 0 } };
    expect(validateManifest(m)).toEqual([]);
  });

  test('rejects a negative margin component', () => {
    const m = validManifest();
    m.assets.borders = { file: 'borders.png', margin: { x: -1, y: 0 } };
    expect(validateManifest(m).some(e => e.includes('margin'))).toBe(true);
  });

  test('rejects a margin missing the y component', () => {
    const m = validManifest();
    m.assets.borders = { file: 'borders.png', margin: { x: 10 } };
    expect(validateManifest(m).some(e => e.includes('margin'))).toBe(true);
  });

  test('rejects a bare-number margin — must be an {x, y} object', () => {
    const m = validManifest();
    m.assets.borders = { file: 'borders.png', margin: 10 };
    expect(validateManifest(m).some(e => e.includes('margin'))).toBe(true);
  });

  test('rejects margin on an asset other than borders', () => {
    const m = validManifest();
    m.assets.bg = { file: 'bg.png', margin: { x: 0.1, y: 0.1 } };
    expect(validateManifest(m).some(e => e.includes('margin'))).toBe(true);
  });

  test('accepts a positive render_density', () => {
    const m = validManifest({ render_density: 2 });
    expect(validateManifest(m)).toEqual([]);
  });

  test('rejects a zero or negative render_density', () => {
    expect(validateManifest(validManifest({ render_density: 0 })).some(e => e.includes('render_density'))).toBe(true);
    expect(validateManifest(validManifest({ render_density: -1 })).some(e => e.includes('render_density'))).toBe(true);
  });

  test('rejects a non-numeric render_density', () => {
    expect(validateManifest(validManifest({ render_density: '2' })).some(e => e.includes('render_density'))).toBe(true);
  });
});

describe('resolvePack', () => {
  let activeDir, defaultDir;

  beforeEach(() => {
    activeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ceap-active-'));
    defaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ceap-default-'));
    // active-atlas.png: 600x100, 6 frames in 1 row -> 100x100 per frame.
    writeMinimalPng(path.join(activeDir, 'active-atlas.png'), 600, 100);
    // orc-atlas.png: 600x600, 6 cols x 6 rows -> 100x100 per frame.
    writeMinimalPng(path.join(defaultDir, 'orc-atlas.png'), 600, 600);
  });

  afterEach(() => {
    fs.rmSync(activeDir, { recursive: true, force: true });
    fs.rmSync(defaultDir, { recursive: true, force: true });
  });

  function makeActive(overrides = {}) {
    return validManifest({
      name: 'active-pack',
      categories: {
        sleeping: [{ file: 'active-atlas.png', row: 0, rows: 1, frames: 6, fps: 3, loop: true }],
        typing:   [{ file: 'active-atlas.png', row: 0, rows: 1, frames: 6, fps: 8 }],
      },
      assets: {
        borders: { file: 'active-borders.png' },
      },
      ...overrides,
    });
  }

  function makeDefault() {
    return validManifest({
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
  }

  test('categories resolve from the active pack only, with an absolute path attached', () => {
    const { categories } = resolvePack(makeActive(), activeDir, makeDefault(), defaultDir);
    expect(categories.typing[0].file).toBe('active-atlas.png');
    expect(categories.typing[0].path).toBe(path.join(activeDir, 'active-atlas.png'));
  });

  test('a category the active pack omits is absent from the result — no cross-pack fallback', () => {
    const { categories } = resolvePack(makeActive(), activeDir, makeDefault(), defaultDir);
    expect(categories.celebrate).toBeUndefined();
    expect('celebrate' in categories).toBe(false);
  });

  test('dock-icon falls back to the default pack when the active pack omits it', () => {
    writeMinimalPng(path.join(defaultDir, 'orc-dock-icon.png'), 512, 512);
    const { assets } = resolvePack(makeActive(), activeDir, makeDefault(), defaultDir);
    expect(assets['dock-icon'].file).toBe('orc-dock-icon.png');
    expect(assets['dock-icon'].path).toBe(path.join(defaultDir, 'orc-dock-icon.png'));
  });

  test('bg has no fallback — absent from the result when the active pack omits it', () => {
    const { assets } = resolvePack(makeActive(), activeDir, makeDefault(), defaultDir);
    expect(assets.bg).toBeUndefined();
  });

  test('borders resolves from the active pack, with the active pack\'s own path', () => {
    const { assets } = resolvePack(makeActive(), activeDir, makeDefault(), defaultDir);
    expect(assets.borders.file).toBe('active-borders.png');
    expect(assets.borders.path).toBe(path.join(activeDir, 'active-borders.png'));
  });

  test('displayWidth/displayHeight come from each variant\'s own file, not one canonical category', () => {
    // sleeping: 100x100 frame (default density 1) -> 100x100 display.
    // A category with a bigger native frame should display bigger, with
    // no density change needed — this is deliberate, so e.g. `alarmed`
    // can be a more dynamic, physically larger reaction.
    writeMinimalPng(path.join(activeDir, 'big-alarmed.png'), 1200, 200); // 6 frames, 1 row -> 200x200
    const active = makeActive({
      categories: {
        sleeping: [{ file: 'active-atlas.png', row: 0, rows: 1, frames: 6, fps: 3, loop: true }],
        typing:   [{ file: 'active-atlas.png', row: 0, rows: 1, frames: 6, fps: 8 }],
        alarmed:  [{ file: 'big-alarmed.png', rows: 1, frames: 6, fps: 8 }],
      },
    });
    const { categories } = resolvePack(active, activeDir, makeDefault(), defaultDir);
    expect(categories.sleeping[0].displayWidth).toBeCloseTo(100);
    expect(categories.sleeping[0].displayHeight).toBeCloseTo(100);
    expect(categories.alarmed[0].displayWidth).toBeCloseTo(200);
    expect(categories.alarmed[0].displayHeight).toBeCloseTo(200);
  });

  test('a non-square frame produces a non-square displayWidth/displayHeight', () => {
    writeMinimalPng(path.join(activeDir, 'wide.png'), 1200, 50); // 6 frames, 1 row -> 200x50
    const active = makeActive({
      categories: {
        sleeping: [{ file: 'wide.png', rows: 1, frames: 6, fps: 3, loop: true }],
        typing:   [{ file: 'active-atlas.png', row: 0, rows: 1, frames: 6, fps: 8 }],
      },
    });
    const { categories } = resolvePack(active, activeDir, makeDefault(), defaultDir);
    expect(categories.sleeping[0].displayWidth).toBeCloseTo(200);
    expect(categories.sleeping[0].displayHeight).toBeCloseTo(50);
  });

  test('render_density scales every file uniformly', () => {
    const active = makeActive({ render_density: 2 });
    const { categories } = resolvePack(active, activeDir, makeDefault(), defaultDir);
    expect(categories.sleeping[0].displayWidth).toBeCloseTo(50);
    expect(categories.sleeping[0].displayHeight).toBeCloseTo(50);
  });

  test('render_density defaults to 1 when omitted', () => {
    const { categories } = resolvePack(makeActive(), activeDir, makeDefault(), defaultDir);
    expect(categories.sleeping[0].displayWidth).toBeCloseTo(100);
  });

  test('borders.margin resolves to displayMargin {x, y}, each divided by the same render_density', () => {
    const active = makeActive({ render_density: 2 });
    active.assets.borders.margin = { x: 20, y: 8 }; // native pixels
    const { assets } = resolvePack(active, activeDir, makeDefault(), defaultDir);
    expect(assets.borders.displayMargin.x).toBeCloseTo(10);
    expect(assets.borders.displayMargin.y).toBeCloseTo(4);
  });

  test('borders.margin defaults to displayMargin {x:0, y:0} when omitted', () => {
    const { assets } = resolvePack(makeActive(), activeDir, makeDefault(), defaultDir);
    expect(assets.borders.displayMargin).toEqual({ x: 0, y: 0 });
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
