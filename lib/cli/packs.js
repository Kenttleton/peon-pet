'use strict';

const fs = require('fs');
const path = require('path');
const { loadManifestFromDir } = require('../ceap-manifest');
const { loadConfig, writeConfig } = require('../pet-config');
const { getBundledPacksDir, getCustomPacksDir } = require('../paths');

function listBundledPackNames() {
  const assetsDir = getBundledPacksDir();
  try {
    return fs.readdirSync(assetsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .filter((e) => fs.existsSync(path.join(assetsDir, e.name, 'openpeon.json')))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function listCustomPackNames() {
  const petsDir = getCustomPacksDir();
  try {
    return fs.readdirSync(petsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .filter((e) => fs.existsSync(path.join(petsDir, e.name, 'openpeon.json')))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function registerPacksCommand(program) {
  const packs = program.command('packs').description('Manage animation packs');

  packs
    .command('list')
    .description('List available animation packs')
    .action(() => {
      const cfg = loadConfig();
      const active = cfg.pet || 'orc';
      const bundled = listBundledPackNames();
      const custom = listCustomPackNames();

      if (bundled.length) {
        console.log('Bundled:');
        for (const name of bundled) {
          console.log(`  ${name === active ? '* ' : '  '}${name}`);
        }
      }
      if (custom.length) {
        console.log('Custom (~/.openpeon/pets):');
        for (const name of custom) {
          console.log(`  ${name === active ? '* ' : '  '}${name}`);
        }
      }
      if (!bundled.length && !custom.length) {
        console.log('No packs found.');
      }
    });

  packs
    .command('use <name>')
    .description('Set the active animation pack')
    .action((name) => {
      const assetsDir = getBundledPacksDir();
      const petsDir = getCustomPacksDir();
      const customDir = path.join(petsDir, name);
      const bundledDir = path.join(assetsDir, name);

      let resolved = false;
      for (const dir of [customDir, bundledDir]) {
        try {
          if (loadManifestFromDir(dir)) {
            resolved = true;
            break;
          }
        } catch (err) {
          process.stderr.write(`[peon-pet] Invalid pack at ${dir}: ${err.message}\n`);
        }
      }

      if (!resolved) {
        const available = listBundledPackNames().join(', ');
        process.stderr.write(`[peon-pet] Unknown pack "${name}". Available bundled packs: ${available}\n`);
        process.exit(1);
      }

      writeConfig({ pet: name });
      console.log(`Active pack set to "${name}". Restart peon-pet for it to take effect.`);
    });
}

module.exports = { registerPacksCommand, listBundledPackNames, listCustomPackNames };
