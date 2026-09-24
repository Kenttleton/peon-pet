'use strict';

const { WIN_MARGIN, cornerPosition } = require('../lib/window-position');

// ─── constants ────────────────────────────────────────────────────────────────

describe('constants', () => {
  test('WIN_MARGIN is 20', () => {
    expect(WIN_MARGIN).toBe(20);
  });
});

// ─── cornerPosition ──────────────────────────────────────────────────────────

describe('cornerPosition', () => {
  const W = 1920;
  const H = 1080;
  const PET_W = 200;
  const PET_H = 200;

  test('bottom-left places window at left edge with margin', () => {
    const { x, y } = cornerPosition('bottom-left', W, H, PET_W, PET_H);
    expect(x).toBe(WIN_MARGIN);
    expect(y).toBe(H - PET_H - WIN_MARGIN);
  });

  test('bottom-right places window at right edge with margin', () => {
    const { x, y } = cornerPosition('bottom-right', W, H, PET_W, PET_H);
    expect(x).toBe(W - PET_W - WIN_MARGIN);
    expect(y).toBe(H - PET_H - WIN_MARGIN);
  });

  test('top-left places window at top-left with margin', () => {
    const { x, y } = cornerPosition('top-left', W, H, PET_W, PET_H);
    expect(x).toBe(WIN_MARGIN);
    expect(y).toBe(WIN_MARGIN);
  });

  test('top-right places window at top-right with margin', () => {
    const { x, y } = cornerPosition('top-right', W, H, PET_W, PET_H);
    expect(x).toBe(W - PET_W - WIN_MARGIN);
    expect(y).toBe(WIN_MARGIN);
  });

  test('defaults to bottom-left for undefined corner', () => {
    const { x, y } = cornerPosition(undefined, W, H, PET_W, PET_H);
    expect(x).toBe(WIN_MARGIN);
    expect(y).toBe(H - PET_H - WIN_MARGIN);
  });

  test('defaults to bottom-left for unknown string', () => {
    const { x, y } = cornerPosition('center', W, H, PET_W, PET_H);
    expect(x).toBe(WIN_MARGIN);
    expect(y).toBe(H - PET_H - WIN_MARGIN);
  });

  test('works with small screen (e.g. 800x600)', () => {
    const { x, y } = cornerPosition('bottom-right', 800, 600, PET_W, PET_H);
    expect(x).toBe(800 - PET_W - WIN_MARGIN);
    expect(y).toBe(600 - PET_H - WIN_MARGIN);
  });

  test('all four corners return different positions on a non-square screen', () => {
    const positions = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
      .map(c => cornerPosition(c, W, H, PET_W, PET_H));
    const unique = new Set(positions.map(p => `${p.x},${p.y}`));
    expect(unique.size).toBe(4);
  });

  test('window fits within screen bounds for all corners', () => {
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      const { x, y } = cornerPosition(corner, W, H, PET_W, PET_H);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + PET_W).toBeLessThanOrEqual(W);
      expect(y + PET_H).toBeLessThanOrEqual(H);
    }
  });

  test('accounts for a non-square pet window (width != height)', () => {
    const wide = { w: 300, h: 100 };
    const { x, y } = cornerPosition('bottom-right', W, H, wide.w, wide.h);
    expect(x).toBe(W - wide.w - WIN_MARGIN);
    expect(y).toBe(H - wide.h - WIN_MARGIN);
  });
});
