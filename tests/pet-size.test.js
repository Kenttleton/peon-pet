'use strict';

const { computeWindowSize } = require('../lib/pet-size');

describe('computeWindowSize', () => {
  test('defaults: no margin, no scale, not a sub-agent -> exact display size', () => {
    const { width, height } = computeWindowSize({ displayWidth: 200, displayHeight: 150 });
    expect(width).toBeCloseTo(200);
    expect(height).toBeCloseTo(150);
  });

  test('scale multiplies both dimensions', () => {
    const { width, height } = computeWindowSize({ displayWidth: 200, displayHeight: 100 }, { scale: 1.5 });
    expect(width).toBeCloseTo(300);
    expect(height).toBeCloseTo(150);
  });

  test('scale below 1 shrinks', () => {
    const { width } = computeWindowSize({ displayWidth: 200, displayHeight: 200 }, { scale: 0.5 });
    expect(width).toBeCloseTo(100);
  });

  test('subAgent halves the size, independent of scale', () => {
    const { width, height } = computeWindowSize({ displayWidth: 200, displayHeight: 200 }, { subAgent: true });
    expect(width).toBeCloseTo(100);
    expect(height).toBeCloseTo(100);
  });

  test('subAgent and scale compose multiplicatively', () => {
    const { width } = computeWindowSize({ displayWidth: 200, displayHeight: 200 }, { subAgent: true, scale: 2 });
    expect(width).toBeCloseTo(200); // 200 * 0.5 * 2
  });

  test('marginX/marginY grow each axis independently, without shrinking the sprite', () => {
    const { width, height } = computeWindowSize({ displayWidth: 160, displayHeight: 100 }, { marginX: 20, marginY: 5 });
    expect(width).toBeCloseTo(200);  // 160 + 2*20
    expect(height).toBeCloseTo(110); // 100 + 2*5
  });

  test('zero margin (no border, or border disabled) leaves size unchanged', () => {
    const { width, height } = computeWindowSize({ displayWidth: 200, displayHeight: 200 }, { marginX: 0, marginY: 0 });
    expect(width).toBeCloseTo(200);
    expect(height).toBeCloseTo(200);
  });

  test('margins scale along with scale and subAgent, not just the sprite', () => {
    const { width, height } = computeWindowSize(
      { displayWidth: 160, displayHeight: 160 },
      { marginX: 20, marginY: 20, scale: 2, subAgent: true }
    );
    // (160 + 2*20) * 0.5 * 2 = 200
    expect(width).toBeCloseTo(200);
    expect(height).toBeCloseTo(200);
  });
});
