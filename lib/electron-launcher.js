'use strict';

// Spawns Electron in its own process group so that Ctrl+C in the terminal
// delivers SIGINT only to this wrapper, not to the Electron process directly.
// Chromium intercepts SIGINT at the C++ level before Node.js can deliver it
// to process.on('SIGINT') handlers; SIGTERM is not intercepted and works fine.
// This wrapper converts SIGINT → SIGTERM so main.js gets a handleable signal.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_DIR = path.join(__dirname, '..');

// Reads the active pack's display_name so the Dock tooltip shows the pet name.
// Checks --pet flag in args first, then the persisted config, then falls back
// to the default 'orc' pack. Never throws.
function resolveDisplayName(args) {
  let petName = null;

  const petFlagIdx = args.indexOf('--pet');
  if (petFlagIdx !== -1 && args[petFlagIdx + 1]) {
    petName = args[petFlagIdx + 1];
  }

  if (!petName) {
    try {
      const cfgPath = path.join(
        os.homedir(), 'Library', 'Application Support', 'Peon Pet', 'peon-pet-config.json'
      );
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.pet) petName = cfg.pet;
    } catch {}
  }

  if (!petName) petName = 'orc';

  for (const dir of [
    path.join(os.homedir(), '.openpeon', 'pets', petName),
    path.join(APP_DIR, 'renderer', 'assets', petName),
  ]) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'openpeon.json'), 'utf8'));
      if (typeof manifest.display_name === 'string' && manifest.display_name) {
        return manifest.display_name;
      }
    } catch {}
  }

  return 'Peon Pet';
}

// Patches CFBundleName and CFBundleDisplayName in the local Electron.app's
// Info.plist before launch. On macOS, the Dock reads these at process start to
// set the tooltip — app.setName() only updates NSProcessInfo and doesn't
// propagate to the Dock's cached bundle name.
function patchElectronBundleName(name) {
  const plistPath = path.join(
    APP_DIR, 'node_modules', 'electron', 'dist',
    'Electron.app', 'Contents', 'Info.plist'
  );
  try {
    let plist = fs.readFileSync(plistPath, 'utf8');
    plist = plist.replace(
      /(<key>CFBundleName<\/key>\s*<string>)[^<]*(<\/string>)/,
      `$1${name}$2`
    );
    plist = plist.replace(
      /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
      `$1${name}$2`
    );
    fs.writeFileSync(plistPath, plist, 'utf8');
  } catch {}
}

function launchElectron(extraArgs = []) {
  const electronBin = path.join(APP_DIR, 'node_modules', '.bin', 'electron');
  if (!fs.existsSync(electronBin)) {
    process.stderr.write('[peon-pet] Electron not found. Run: npm install\n');
    process.exit(1);
  }

  if (process.platform === 'darwin') {
    patchElectronBundleName(resolveDisplayName(extraArgs));
  }

  const child = spawn(electronBin, [APP_DIR, ...extraArgs], {
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
    windowsHide: false,
  });

  child.on('close', (code) => process.exit(code ?? 0));

  let exiting = false;
  function shutdown() {
    if (exiting) return;
    exiting = true;
    child.kill('SIGTERM');
  }

  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP',  shutdown);
}

module.exports = { launchElectron };
