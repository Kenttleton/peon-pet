'use strict';

// Generates the full macOS ICNS icon set for every bundled pack that has a
// dock-icon.png, following Apple's icon spec:
//   - Render master at 1024×1024 (icon_512x512@2x)
//   - Inner content area: 824×824, ~100px margins for drop shadow clearance
//   - Corner radius: ~185px (continuous superellipse)
//   - Drop shadow: rgba(0,0,0,0.38), y-offset 6px, blur 12px
//   - Downscale master to each ICNS output size
//
// Output files go into a per-pack `icons/macos/` subdirectory.
// This is a pack-author utility — NOT a build step. Run it when source
// dock-icon.png files change, then commit the results.

const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '..', 'renderer', 'assets');

// Apple master canvas
const MASTER = 1024;
const INNER  = 824;
const MARGIN = (MASTER - INNER) / 2;  // ~100px
const RADIUS = Math.round(INNER * 0.225); // ~185px

const SHADOW_COLOR = 'rgba(0,0,0,0.38)';
const SHADOW_Y     = 6;
const SHADOW_BLUR  = 12;

// All 10 macOS ICNS slots: key → output pixel size
const MACOS_SIZES = [
  ['icon_16x16',      16],
  ['icon_16x16@2x',   32],
  ['icon_32x32',      32],
  ['icon_32x32@2x',   64],
  ['icon_128x128',    128],
  ['icon_128x128@2x', 256],
  ['icon_256x256',    256],
  ['icon_256x256@2x', 512],
  ['icon_512x512',    512],
  ['icon_512x512@2x', 1024],
];

async function renderMaster(srcPath) {
  const c = createCanvas(MASTER, MASTER);
  const ctx = c.getContext('2d');

  const x = MARGIN, y = MARGIN, w = INNER, h = INNER, r = RADIUS;

  function squirclePath() {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // Drop shadow (fill a solid shape behind, then draw art over it)
  ctx.save();
  ctx.shadowColor    = SHADOW_COLOR;
  ctx.shadowOffsetX  = 0;
  ctx.shadowOffsetY  = SHADOW_Y;
  ctx.shadowBlur     = SHADOW_BLUR;
  squirclePath();
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();

  // Clip and draw source art
  ctx.save();
  squirclePath();
  ctx.clip();
  const img = await loadImage(srcPath);
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();

  return c;
}

function downscale(masterCanvas, size) {
  const c = createCanvas(size, size);
  c.getContext('2d').drawImage(masterCanvas, 0, 0, size, size);
  return c;
}

async function generateIconSet(srcPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const master = await renderMaster(srcPath);

  for (const [key, px] of MACOS_SIZES) {
    const canvas = px === MASTER ? master : downscale(master, px);
    const outPath = path.join(outDir, `${key}.png`);
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
    console.log(`  ${path.relative(process.cwd(), outPath)}`);
  }
}

(async () => {
  const packs = fs.readdirSync(ASSETS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  let count = 0;
  for (const pack of packs) {
    const src = path.join(ASSETS_DIR, pack, 'dock-icon.png');
    if (!fs.existsSync(src)) continue;
    const outDir = path.join(ASSETS_DIR, pack, 'icons', 'macos');
    try {
      console.log(`${pack}:`);
      await generateIconSet(src, outDir);
      count++;
    } catch (err) {
      console.error(`  failed ${pack}: ${err.message}`);
    }
  }
  console.log(`\ngenerate-dock-icons: ${count} pack(s) written`);
})();
