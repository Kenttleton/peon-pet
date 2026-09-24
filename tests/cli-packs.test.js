'use strict';

const path = require('path');
const { listBundledPackNames, listCustomPackNames } = require('../lib/cli/packs');

describe('listBundledPackNames', () => {
  test('returns sorted list of bundled pack names', () => {
    const names = listBundledPackNames();
    expect(Array.isArray(names)).toBe(true);
    expect(names).toContain('orc');
    expect(names).toEqual([...names].sort());
  });

  test('only includes directories that have openpeon.json', () => {
    const names = listBundledPackNames();
    const assetsDir = path.join(__dirname, '..', 'renderer', 'assets');
    const fs = require('fs');
    for (const name of names) {
      expect(fs.existsSync(path.join(assetsDir, name, 'openpeon.json'))).toBe(true);
    }
  });
});

describe('listCustomPackNames', () => {
  test('returns an array (empty if directory does not exist)', () => {
    const names = listCustomPackNames();
    expect(Array.isArray(names)).toBe(true);
  });
});
