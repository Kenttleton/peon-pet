'use strict';

// Bundles renderer/app.mjs (which imports pixi.js, pixi.js/unsafe-eval, and
// ./player.mjs) into a single browser-loadable file at renderer/dist/app.js.
//
// This project has no other bundled dependency — Three.js (the previous
// renderer engine) shipped a self-contained, dependency-free ESM build
// (three.module.js) that the browser could load directly with zero
// tooling. PixiJS does not: its published ESM entry point re-exports
// `eventemitter3` as a bare import specifier (resolved via node_modules by
// Node/bundlers, but unresolvable by a browser's native module loader),
// and its CSP-safe "unsafe-eval" polyfill package only composes correctly
// through a bundler that can tree-shake and monkeypatch the right internal
// classes — it has no browser-ready prebuilt equivalent. Both problems are
// solved by bundling once at build time rather than loading raw ESM.

const esbuild = require('esbuild');
const path = require('path');

const ENTRY = path.join(__dirname, '..', 'renderer', 'app.mjs');
const OUTFILE = path.join(__dirname, '..', 'renderer', 'dist', 'app.js');

async function build(watch) {
  const ctx = await esbuild.context({
    entryPoints: [ENTRY],
    outfile: OUTFILE,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: true,
    logLevel: 'info',
  });

  if (watch) {
    await ctx.watch();
    process.stdout.write('[build-renderer] watching renderer/app.mjs for changes...\n');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

const watch = process.argv.includes('--watch');
build(watch).catch((err) => {
  console.error('[build-renderer] build failed:', err);
  process.exit(1);
});
