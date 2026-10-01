'use strict';

const path = require('path');
const { resolvePackDir } = require('../lib/cli/status');

describe('resolvePackDir', () => {
  // Regression test: resolvePackDir's body originally referenced an
  // undefined `cfg` variable (should have been the `app` parameter),
  // so `peon-pet status` threw `ReferenceError: cfg is not defined`
  // every time it ran, with no test coverage to catch it.
  test('does not throw and resolves a real bundled pack directory', () => {
    expect(() => resolvePackDir({ pet: 'orc' })).not.toThrow();
    const dir = resolvePackDir({ pet: 'orc' });
    expect(dir).toBe(path.join(__dirname, '..', 'renderer', 'assets', 'orc'));
  });

  test('defaults to orc when app.pet is undefined', () => {
    const dir = resolvePackDir({});
    expect(dir).toBe(path.join(__dirname, '..', 'renderer', 'assets', 'orc'));
  });

  test('resolves a different bundled pack by name', () => {
    const dir = resolvePackDir({ pet: 'hello-kitty' });
    expect(dir).toBe(path.join(__dirname, '..', 'renderer', 'assets', 'hello-kitty'));
  });

  test('returns "(not resolved)" for a pack name that does not exist anywhere', () => {
    const dir = resolvePackDir({ pet: 'definitely-not-a-real-pack-xyz' });
    expect(dir).toBe('(not resolved)');
  });
});
