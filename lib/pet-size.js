'use strict';

/**
 * Computes a pet window's final on-screen size from one variant's
 * density-adjusted display size, applying:
 * - `marginX`/`marginY`: the border's frame margin on each axis, already
 *   in density-adjusted pixel space (i.e. divided by render_density — see
 *   lib/ceap-manifest.js's resolvePack, which attaches this as
 *   `displayMargin: {x, y}` on the resolved borders asset). Both 0 when
 *   no border is active. A border's frame ring is rarely the same
 *   thickness on both axes, so these are independent. The window grows by
 *   the margin on each side; the sprite itself always renders at its
 *   exact displayWidth/displayHeight, never shrunk to make room for a
 *   frame.
 * - `subAgent`: sub-agent mini windows render at half size.
 * - `scale`: the user's global size preference (--scale / config).
 *
 * Margins are added *before* scale/subAgent are applied, so a border's
 * on-screen thickness scales right along with everything else — doubling
 * `scale` doubles the margin in actual on-screen pixels too, not just the
 * sprite.
 *
 * @param {{displayWidth: number, displayHeight: number}} variant
 * @param {{marginX?: number, marginY?: number, scale?: number, subAgent?: boolean}} [opts]
 * @returns {{width: number, height: number}}
 */
function computeWindowSize(variant, opts = {}) {
  const marginX = opts.marginX ?? 0;
  const marginY = opts.marginY ?? 0;
  const scale = opts.scale ?? 1;
  const subAgent = !!opts.subAgent;
  const mult = (subAgent ? 0.5 : 1) * scale;
  return {
    width: (variant.displayWidth + 2 * marginX) * mult,
    height: (variant.displayHeight + 2 * marginY) * mult,
  };
}

module.exports = { computeWindowSize };
