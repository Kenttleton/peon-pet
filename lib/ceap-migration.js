
'use strict';

const fs = require('fs');
const path = require('path');
const { validateManifest } = require('./ceap-manifest');

// Row layout used by every pre-CEAP `character.json` folder (CONTRIBUTING.md's
// fixed 6x6 grid, and today's hardcoded ANIM_CONFIG). Legacy folders have no
// openpeon.json, so migration synthesizes one from this layout. Every
// category gets exactly one variant — legacy folders never had alternates.
const LEGACY_ROW_LAYOUT = {
  sleeping:  { row: 0, fps: 3, loop: true },
  waking:    { row: 1, fps: 2, loop: false, loops: 1 },
  typing:    { row: 2, fps: 8, loop: false },
  alarmed:   { row: 3, fps: 8, loop: false },
  celebrate: { row: 4, fps: 8, loop: false },
  annoyed:   { row: 5, fps: 8, loop: false },
};
const LEGACY_ROWS = 6;
const LEGACY_FRAMES = 6;

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function synthesizeLegacyManifest(dir, slug) {
  const legacy = readJsonSafe(path.join(dir, 'character.json')) || {};

  const manifest = {
    ceap_version: '1.0',
    name: legacy.slug || slug,
    display_name: legacy.name || slug,
    version: legacy.version || '1.0.0',
  };
  if (legacy.author) manifest.author = { name: legacy.author };

  if (fs.existsSync(path.join(dir, 'sprite-atlas.png'))) {
    manifest.categories = {};
    for (const [category, cfg] of Object.entries(LEGACY_ROW_LAYOUT)) {
      manifest.categories[category] = [{
        file: 'sprite-atlas.png',
        row: cfg.row,
        rows: LEGACY_ROWS,
        frames: LEGACY_FRAMES,
        fps: cfg.fps,
        loop: cfg.loop,
        ...(cfg.loops ? { loops: cfg.loops } : {}),
      }];
    }
  }
  // No sprite-atlas.png means no `categories` key at all — CEAP requires
  // categories unconditionally, so this manifest will fail validation and
  // migrateLegacyCharacters will skip writing it (files are still copied).

  const assets = {};
  if (fs.existsSync(path.join(dir, 'borders.png'))) assets.borders = { file: 'borders.png' };
  if (fs.existsSync(path.join(dir, 'bg.png'))) assets.bg = { file: 'bg.png' };
  if (fs.existsSync(path.join(dir, 'dock-icon.png'))) assets['dock-icon'] = { file: 'dock-icon.png' };
  if (Object.keys(assets).length > 0) manifest.assets = assets;

  return manifest;
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// One-time migration: `<userData>/characters/<name>/` (pre-CEAP,
// character.json based) -> `~/.openpeon/pets/<name>/` (CEAP, openpeon.json
// based). No-ops if the new location already exists, or the legacy one
// doesn't.
function migrateLegacyCharacters(legacyDir, petsDir) {
  if (fs.existsSync(petsDir)) return;
  if (!fs.existsSync(legacyDir)) return;

  fs.mkdirSync(petsDir, { recursive: true });

  for (const entry of fs.readdirSync(legacyDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const srcDir = path.join(legacyDir, slug);
    const destDir = path.join(petsDir, slug);
    copyDirSync(srcDir, destDir);

    const manifestPath = path.join(destDir, 'openpeon.json');
    if (fs.existsSync(manifestPath)) continue;

    const manifest = synthesizeLegacyManifest(destDir, slug);
    const errors = validateManifest(manifest);
    if (errors.length === 0) {
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    } else {
      console.warn(`[peon-pet] Skipped synthesizing openpeon.json for legacy character "${slug}": ${errors.join('; ')}`);
    }
  }
}

module.exports = { migrateLegacyCharacters, synthesizeLegacyManifest, LEGACY_ROW_LAYOUT };
