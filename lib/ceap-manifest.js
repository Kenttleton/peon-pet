
'use strict';

const fs = require('fs');
const path = require('path');
const { getPngSize } = require('./png-size');

const CATEGORIES = Object.freeze(['sleeping', 'waking', 'typing', 'alarmed', 'celebrate', 'annoyed']);
const STEADY_STATES = Object.freeze(['sleeping', 'typing']);
const ASSET_KEYS = Object.freeze(['dock-icon', 'borders', 'bg']);
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+/;

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Shared by category variants and asset entries — both have file/row/rows,
// and an asset entry's frames/fps are the same "animated or static" shape a
// variant's are.
function validateFrameFields(label, entry, errors, { framesRequired }) {
  if (framesRequired) {
    if (!(Number.isInteger(entry.frames) && entry.frames > 0)) {
      errors.push(`${label}.frames is required and must be a positive integer`);
    }
    if (!(typeof entry.fps === 'number' && entry.fps > 0)) {
      errors.push(`${label}.fps is required and must be a positive number`);
    }
  } else {
    const frames = entry.frames ?? 1;
    if (!(Number.isInteger(frames) && frames > 0)) {
      errors.push(`${label}.frames must be a positive integer`);
    }
    if (frames > 1 && !(typeof entry.fps === 'number' && entry.fps > 0)) {
      errors.push(`${label}.fps is required and must be a positive number when frames > 1`);
    }
  }

  const row = entry.row ?? 0;
  const rows = entry.rows ?? 1;
  if (!(Number.isInteger(row) && row >= 0)) {
    errors.push(`${label}.row must be a non-negative integer`);
  }
  if (!(Number.isInteger(rows) && rows > 0)) {
    errors.push(`${label}.rows must be a positive integer`);
  }
  if (Number.isInteger(row) && Number.isInteger(rows) && row >= rows) {
    errors.push(`${label}.row (${row}) must be less than rows (${rows})`);
  }
  if (entry.loop !== undefined && typeof entry.loop !== 'boolean') {
    errors.push(`${label}.loop must be a boolean`);
  }
}

function validateVariant(categoryName, index, entry, errors, fileGroups) {
  const label = `categories.${categoryName}[${index}]`;
  if (!isPlainObject(entry)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (typeof entry.file !== 'string' || entry.file.length === 0) {
    errors.push(`${label}.file is required and must be a non-empty string`);
  }
  validateFrameFields(label, entry, errors, { framesRequired: true });
  if (entry.loops !== undefined && !(Number.isInteger(entry.loops) && entry.loops > 0)) {
    errors.push(`${label}.loops must be a positive integer`);
  }
  if (entry.label !== undefined && typeof entry.label !== 'string') {
    errors.push(`${label}.label must be a string`);
  }
  if (typeof entry.file === 'string') {
    const rows = entry.rows ?? 1;
    if (!fileGroups.has(entry.file)) fileGroups.set(entry.file, []);
    fileGroups.get(entry.file).push({ label, rows });
  }
}

function validateAssetEntry(key, entry, errors, fileGroups) {
  const label = `assets.${key}`;
  if (!isPlainObject(entry)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (typeof entry.file !== 'string' || entry.file.length === 0) {
    errors.push(`${label}.file is required and must be a non-empty string`);
  }
  if (key === 'dock-icon' && Number.isInteger(entry.frames) && entry.frames > 1) {
    errors.push(`${label}.frames must not be > 1 — dock-icon cannot animate`);
    return;
  }
  if (key === 'borders' && entry.margin !== undefined) {
    if (!(typeof entry.margin === 'number' && Number.isFinite(entry.margin) && entry.margin >= 0 && entry.margin < 0.5)) {
      errors.push(`${label}.margin must be a number in [0, 0.5)`);
    }
  } else if (key !== 'borders' && entry.margin !== undefined) {
    errors.push(`${label}.margin is only meaningful on borders`);
  }
  validateFrameFields(label, entry, errors, { framesRequired: false });
  if (typeof entry.file === 'string') {
    const rows = entry.rows ?? 1;
    if (!fileGroups.has(entry.file)) fileGroups.set(entry.file, []);
    fileGroups.get(entry.file).push({ label, rows });
  }
}

function validateManifest(manifest) {
  if (!isPlainObject(manifest)) {
    return ['manifest must be an object'];
  }

  const errors = [];

  if (manifest.ceap_version !== '1.0') {
    errors.push(`ceap_version must be "1.0", got ${JSON.stringify(manifest.ceap_version)}`);
  }
  if (typeof manifest.name !== 'string' || !NAME_PATTERN.test(manifest.name)) {
    errors.push(`name must match ${NAME_PATTERN}`);
  }
  if (typeof manifest.display_name !== 'string' || manifest.display_name.length < 1 || manifest.display_name.length > 128) {
    errors.push('display_name is required and must be 1-128 characters');
  }
  if (typeof manifest.version !== 'string' || !VERSION_PATTERN.test(manifest.version)) {
    errors.push('version is required and must look like a semver string (e.g. "1.0.0")');
  }
  if (manifest.author !== undefined) {
    if (!isPlainObject(manifest.author)) {
      errors.push('author must be an object');
    } else {
      if (manifest.author.name !== undefined && typeof manifest.author.name !== 'string') {
        errors.push('author.name must be a string');
      }
      if (manifest.author.github !== undefined && typeof manifest.author.github !== 'string') {
        errors.push('author.github must be a string');
      }
    }
  }
  if (manifest.license !== undefined && typeof manifest.license !== 'string') {
    errors.push('license must be a string');
  }
  if (manifest.render_density !== undefined) {
    if (!(typeof manifest.render_density === 'number' && manifest.render_density > 0 && Number.isFinite(manifest.render_density))) {
      errors.push('render_density must be a positive finite number');
    }
  }

  const fileGroups = new Map(); // file -> [{ label, rows }]

  if (!isPlainObject(manifest.categories)) {
    errors.push('categories is required and must be an object');
  } else {
    for (const state of STEADY_STATES) {
      if (!(state in manifest.categories)) {
        errors.push(`categories.${state} is required — both steady states must be present`);
      }
    }
    for (const [name, value] of Object.entries(manifest.categories)) {
      if (!CATEGORIES.includes(name)) {
        errors.push(`unknown category "${name}" — must be one of ${CATEGORIES.join(', ')}`);
        continue;
      }
      if (!Array.isArray(value) || value.length === 0) {
        errors.push(`categories.${name} must be a non-empty array of variants`);
        continue;
      }
      value.forEach((entry, index) => validateVariant(name, index, entry, errors, fileGroups));
    }
  }

  if (manifest.assets !== undefined) {
    if (!isPlainObject(manifest.assets)) {
      errors.push('assets must be an object');
    } else {
      for (const [key, entry] of Object.entries(manifest.assets)) {
        if (!ASSET_KEYS.includes(key)) {
          errors.push(`unknown asset "${key}" — must be one of ${ASSET_KEYS.join(', ')}`);
          continue;
        }
        validateAssetEntry(key, entry, errors, fileGroups);
      }
    }
  }

  for (const [file, group] of fileGroups) {
    const rowsValues = new Set(group.map((g) => g.rows));
    if (rowsValues.size > 1) {
      const labels = group.map((g) => g.label).join(', ');
      errors.push(`entries sharing file "${file}" (${labels}) must all declare the same "rows" value`);
    }
  }

  return errors;
}

// No cross-pack fallback for categories, `borders`, or `bg` — only
// `dock-icon` falls back to the default pack. See
// docs/ceap-spec.md#fallback-behavior.
//
// Every category variant also gets a displayWidth/displayHeight, computed
// per-file from that file's own real PNG pixel dimensions — not from any
// one canonical category. This is deliberate: an artist can make e.g.
// `alarmed`'s art physically bigger than `sleeping`'s to make a reaction
// more dynamic, and different variants of the same category can differ
// too. Keeping that consistent across a pack's own categories/variants is
// the pack author's responsibility, not something this function enforces.
// `render_density` (default 1, no cross-pack fallback) is the one knob
// that scales every file uniformly: displaySize = nativePixels / density.
function resolvePack(activeManifest, activeDir, defaultManifest, defaultDir) {
  const density = activeManifest.render_density ?? 1;
  const pngSizeCache = new Map(); // absolute path -> {width, height}, since
  // many variants commonly share one atlas file.

  function pngSizeOf(absPath) {
    if (!pngSizeCache.has(absPath)) {
      pngSizeCache.set(absPath, getPngSize(absPath));
    }
    return pngSizeCache.get(absPath);
  }

  const categories = {};
  for (const [name, variants] of Object.entries(activeManifest.categories || {})) {
    categories[name] = variants.map((variant) => {
      const absPath = path.join(activeDir, variant.file);
      const { width: pngWidth, height: pngHeight } = pngSizeOf(absPath);
      const rows = variant.rows ?? 1;
      return {
        ...variant,
        path: absPath,
        displayWidth: (pngWidth / variant.frames) / density,
        displayHeight: (pngHeight / rows) / density,
      };
    });
  }

  const assets = {};
  for (const key of ASSET_KEYS) {
    const activeEntry = activeManifest.assets?.[key];
    if (activeEntry) {
      assets[key] = { ...activeEntry, path: path.join(activeDir, activeEntry.file) };
      continue;
    }
    if (key === 'dock-icon') {
      const defaultEntry = defaultManifest?.assets?.[key];
      assets[key] = defaultEntry
        ? { ...defaultEntry, path: path.join(defaultDir, defaultEntry.file) }
        : undefined;
      continue;
    }
    assets[key] = undefined;
  }

  return { categories, assets };
}

function loadManifestFromDir(dir) {
  const manifestPath = path.join(dir, 'openpeon.json');
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${manifestPath}: ${err.message}`);
  }
  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`Invalid CEAP manifest at ${manifestPath}:\n  - ${errors.join('\n  - ')}`);
  }
  return manifest;
}

module.exports = {
  CATEGORIES,
  ASSET_KEYS,
  NAME_PATTERN,
  validateManifest,
  resolvePack,
  loadManifestFromDir,
};
