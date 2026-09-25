
'use strict';

const fs = require('fs');
const path = require('path');
const { getPngSize } = require('./png-size');

const CATEGORIES = Object.freeze(['sleeping', 'waking', 'typing', 'alarmed', 'celebrate', 'annoyed']);
const STEADY_STATES = Object.freeze(['sleeping', 'typing']);
const ASSET_KEYS = Object.freeze(['borders', 'bg']);
const ICONS_OS_KEYS = Object.freeze(['macos', 'windows', 'linux', 'default']);
// Maps Node's process.platform to the key pack authors use in `assets.icons`
const PLATFORM_TO_ICONS_KEY = Object.freeze({ darwin: 'macos', win32: 'windows', linux: 'linux' });
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

// Validates a single leaf icon entry: { file, [frames] } — always static.
function validateLeafIconEntry(label, entry, errors, fileGroups) {
  if (!isPlainObject(entry)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (typeof entry.file !== 'string' || entry.file.length === 0) {
    errors.push(`${label}.file is required and must be a non-empty string`);
  }
  if (Number.isInteger(entry.frames) && entry.frames > 1) {
    errors.push(`${label}.frames must not be > 1 — icons cannot animate`);
  }
  if (typeof entry.file === 'string') {
    if (!fileGroups.has(entry.file)) fileGroups.set(entry.file, []);
    fileGroups.get(entry.file).push({ label, rows: 1 });
  }
}

// Validates one OS value inside `assets.icons`. Can be either:
//   - a leaf icon: { file: "x.png" }
//   - a size map: { icon_512x512: { file: "x.png" }, default: { file: "y.png" } }
// The presence of a top-level "file" key distinguishes the two.
function validateIconEntry(label, entry, errors, fileGroups) {
  if (!isPlainObject(entry)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if ('file' in entry) {
    // Flat leaf entry
    validateLeafIconEntry(label, entry, errors, fileGroups);
  } else {
    // Size map — keys are OS-specific size names (e.g. icon_512x512) or "default"
    const keys = Object.keys(entry);
    if (keys.length === 0) {
      errors.push(`${label} must have at least one size key or a "file" field`);
      return;
    }
    for (const sizeKey of keys) {
      validateLeafIconEntry(`${label}.${sizeKey}`, entry[sizeKey], errors, fileGroups);
    }
  }
}

// Validates the `assets.icons` block: an object whose keys are OS names
// (macos, windows, linux) and/or "default". At least one key is required.
// Each OS value is either a leaf { file } entry or a size map.
function validateIconsEntry(entry, errors, fileGroups) {
  const label = 'assets.icons';
  if (!isPlainObject(entry)) {
    errors.push(`${label} must be an object`);
    return;
  }
  for (const key of Object.keys(entry)) {
    if (!ICONS_OS_KEYS.includes(key)) {
      errors.push(`${label}: unknown key "${key}" — must be one of ${ICONS_OS_KEYS.join(', ')}`);
    }
  }
  if (!ICONS_OS_KEYS.some(k => entry[k] !== undefined)) {
    errors.push(`${label} must have at least one of: ${ICONS_OS_KEYS.join(', ')}`);
    return;
  }
  for (const osKey of ICONS_OS_KEYS) {
    if (entry[osKey] !== undefined) {
      validateIconEntry(`${label}.${osKey}`, entry[osKey], errors, fileGroups);
    }
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
  if (key === 'borders' && entry.margin !== undefined) {
    const m = entry.margin;
    const validComponent = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
    if (!(isPlainObject(m) && validComponent(m.x) && validComponent(m.y))) {
      errors.push(`${label}.margin must be an object { x, y } of non-negative numbers (native pixels, same space as frames/rows) — a border's frame ring is rarely the same thickness on both axes`);
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
        if (key === 'icons') {
          validateIconsEntry(entry, errors, fileGroups);
        } else if (ASSET_KEYS.includes(key)) {
          validateAssetEntry(key, entry, errors, fileGroups);
        } else {
          errors.push(`unknown asset "${key}" — must be one of icons, ${ASSET_KEYS.join(', ')}`);
        }
      }
    }
  }

  if (manifest.dot_colors !== undefined) {
    if (!isPlainObject(manifest.dot_colors)) {
      errors.push('dot_colors must be an object');
    } else {
      const DOT_COLOR_KEYS = new Set(['hot', 'warm', 'off']);
      for (const [key, value] of Object.entries(manifest.dot_colors)) {
        if (!DOT_COLOR_KEYS.has(key)) {
          errors.push(`dot_colors.${key} is not a valid key — must be one of hot, warm, off`);
        } else if (typeof value !== 'string' || value.length === 0) {
          errors.push(`dot_colors.${key} must be a non-empty string (any valid CSS color)`);
        }
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
// `icons` falls back to the default pack. See
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

  // Picks the right icon entry for the current OS from an `assets.icons` map.
  // Returns a resolved entry (with `path`, `osSpecific`, and optionally
  // `sizeMap` added) or undefined.
  //
  // When the OS value is a size map (no top-level `file` key), the returned
  // object includes `sizeMap: { [sizeKey]: { file, path } }` so the caller
  // (setupDockIcon) can pick the best resolution for the current display
  // scale factor at runtime. The `file`/`path` on the top-level entry are
  // set to the last size key's values as a fallback.
  function pickIcon(iconsMap, dir) {
    if (!iconsMap) return undefined;
    const osKey = PLATFORM_TO_ICONS_KEY[process.platform];
    const osValue = (osKey && iconsMap[osKey]) || iconsMap.default;
    if (!osValue) return undefined;
    const osSpecific = !!(osKey && iconsMap[osKey]);

    if ('file' in osValue) {
      // Flat leaf entry
      return { ...osValue, path: path.join(dir, osValue.file), osSpecific };
    }

    // Size map — resolve all entries, pick best as the default leaf
    const sizeKeys = Object.keys(osValue).filter(k => k !== 'default');
    const resolvedSizeMap = {};
    for (const k of [...sizeKeys, ...(osValue.default ? ['default'] : [])]) {
      const leaf = osValue[k];
      if (leaf && typeof leaf.file === 'string') {
        resolvedSizeMap[k] = { ...leaf, path: path.join(dir, leaf.file) };
      }
    }
    // Default leaf: last non-"default" size key (smallest-first convention → last is largest)
    const fallbackKey = sizeKeys[sizeKeys.length - 1] || 'default';
    const fallback = resolvedSizeMap[fallbackKey];
    if (!fallback) return undefined;

    return { ...fallback, osSpecific, sizeMap: resolvedSizeMap };
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

  // icons: pick for current OS from active pack, fall back to default pack
  assets.icons = pickIcon(activeManifest.assets?.icons, activeDir)
    ?? pickIcon(defaultManifest?.assets?.icons, defaultDir);

  for (const key of ASSET_KEYS) {
    const activeEntry = activeManifest.assets?.[key];
    if (activeEntry) {
      const resolved = { ...activeEntry, path: path.join(activeDir, activeEntry.file) };
      // margin is { x, y } in native pixels, same space as frames/rows math
      // — divide both components by the same density so they scale through
      // lib/pet-size.js exactly like displayWidth/displayHeight do. A
      // border's frame ring is rarely the same thickness on both axes.
      if (key === 'borders') {
        resolved.displayMargin = {
          x: (activeEntry.margin?.x ?? 0) / density,
          y: (activeEntry.margin?.y ?? 0) / density,
        };
      }
      assets[key] = resolved;
    } else {
      assets[key] = undefined;
    }
  }

  const dotColors = activeManifest.dot_colors
    ? { ...activeManifest.dot_colors }
    : undefined;

  return { categories, assets, dotColors };
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
  ICONS_OS_KEYS,
  NAME_PATTERN,
  validateManifest,
  resolvePack,
  loadManifestFromDir,
};
