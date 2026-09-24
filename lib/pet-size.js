'use strict';

/**
 * Computes a pet window's final on-screen size from one variant's
 * density-adjusted display size, applying:
 * - `margin`: the border's frame margin (fraction per side, [0, 0.5)) —
 *   0 when no border is active. The window grows to make room for the
 *   frame; the sprite itself always renders at its exact displayWidth/
 *   displayHeight, never shrunk.
 * - `subAgent`: sub-agent mini windows render at half size.
 * - `scale`: the user's global size preference (--scale / config).
 *
 * @param {{displayWidth: number, displayHeight: number}} variant
 * @param {{margin?: number, scale?: number, subAgent?: boolean}} [opts]
 * @returns {{width: number, height: number}}
 */
function computeWindowSize(variant, opts = {}) {
  const margin = opts.margin ?? 0;
  const scale = opts.scale ?? 1;
  const subAgent = !!opts.subAgent;
  const growth = 1 - 2 * margin;
  const mult = (subAgent ? 0.5 : 1) * scale;
  return {
    width: (variant.displayWidth / growth) * mult,
    height: (variant.displayHeight / growth) * mult,
  };
}

module.exports = { computeWindowSize };
