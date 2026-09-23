'use strict';

const { computeUVs } = require('../lib/anim-state');

describe('computeUVs', () => {
  test('returns u0, u1, v0, v1', () => {
    const uv = computeUVs({ row: 0, rows: 1, frames: 6 }, 0);
    expect(uv).toHaveProperty('u0');
    expect(uv).toHaveProperty('u1');
    expect(uv).toHaveProperty('v0');
    expect(uv).toHaveProperty('v1');
  });

  test('first frame: u0=0, u1=1/frames', () => {
    const uv = computeUVs({ row: 0, rows: 1, frames: 6 }, 0);
    expect(uv.u0).toBeCloseTo(0);
    expect(uv.u1).toBeCloseTo(1 / 6);
  });

  test('second frame: u0=1/frames, u1=2/frames', () => {
    const uv = computeUVs({ row: 0, rows: 1, frames: 6 }, 1);
    expect(uv.u0).toBeCloseTo(1 / 6);
    expect(uv.u1).toBeCloseTo(2 / 6);
  });

  test('last frame: u0=(frames-1)/frames, u1=1', () => {
    const uv = computeUVs({ row: 0, rows: 1, frames: 6 }, 5);
    expect(uv.u0).toBeCloseTo(5 / 6);
    expect(uv.u1).toBeCloseTo(1);
  });

  test('row 0 of a 6-row atlas covers the top of the atlas (v goes bottom->top)', () => {
    const uv = computeUVs({ row: 0, rows: 6, frames: 6 }, 0);
    expect(uv.v0).toBeCloseTo(5 / 6);
    expect(uv.v1).toBeCloseTo(1);
  });

  test('row 1 of a 6-row atlas is one row below row 0', () => {
    const uv = computeUVs({ row: 1, rows: 6, frames: 6 }, 0);
    expect(uv.v0).toBeCloseTo(4 / 6);
    expect(uv.v1).toBeCloseTo(5 / 6);
  });

  test('row and rows default to 0 and 1 (a single-row, own-file animation)', () => {
    const uv = computeUVs({ frames: 4 }, 0);
    expect(uv.v0).toBeCloseTo(0);
    expect(uv.v1).toBeCloseTo(1);
  });

  test('u0 < u1 for every frame', () => {
    const cfg = { row: 2, rows: 6, frames: 8 };
    for (let f = 0; f < cfg.frames; f++) {
      const uv = computeUVs(cfg, f);
      expect(uv.u0).toBeLessThan(uv.u1);
    }
  });

  test('v0 < v1', () => {
    const uv = computeUVs({ row: 2, rows: 6, frames: 6 }, 0);
    expect(uv.v0).toBeLessThan(uv.v1);
  });

  test('all UV values stay within [0, 1]', () => {
    const cfg = { row: 3, rows: 6, frames: 6 };
    for (let f = 0; f < cfg.frames; f++) {
      const { u0, u1, v0, v1 } = computeUVs(cfg, f);
      expect(u0).toBeGreaterThanOrEqual(0);
      expect(u1).toBeLessThanOrEqual(1);
      expect(v0).toBeGreaterThanOrEqual(0);
      expect(v1).toBeLessThanOrEqual(1);
    }
  });
});
