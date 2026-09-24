'use strict';

const WIN_MARGIN = 20;

// petWidth/petHeight are the pet window's *actual* current size — no
// longer a fixed constant, since it's derived per-pack from render_density
// and varies per active category (see lib/ceap-manifest.js resolvePack).
function cornerPosition(corner, screenWidth, screenHeight, petWidth, petHeight) {
  const right = screenWidth - petWidth - WIN_MARGIN;
  const bottom = screenHeight - petHeight - WIN_MARGIN;
  switch (corner) {
    case 'top-left':     return { x: WIN_MARGIN, y: WIN_MARGIN };
    case 'top-right':    return { x: right,      y: WIN_MARGIN };
    case 'bottom-right': return { x: right,      y: bottom };
    default:             return { x: WIN_MARGIN, y: bottom }; // bottom-left
  }
}

module.exports = { WIN_MARGIN, cornerPosition };
