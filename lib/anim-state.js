'use strict';

/**
 * Compute UV coordinates for a frame of a CEAP category.
 * Matches the Three.js convention: v=0 is bottom, v=1 is top.
 *
 * @param {{row?: number, rows?: number, frames: number}} categoryConfig
 * @param {number} frame
 * @returns {{u0: number, u1: number, v0: number, v1: number}}
 */
function computeUVs(categoryConfig, frame) {
  const { frames } = categoryConfig;
  const row = categoryConfig.row ?? 0;
  const rows = categoryConfig.rows ?? 1;
  const u0 = frame / frames;
  const u1 = (frame + 1) / frames;
  const v0 = (rows - 1 - row) / rows;  // bottom of this row
  const v1 = (rows - row) / rows;       // top of this row
  return { u0, u1, v0, v1 };
}

module.exports = { computeUVs };
