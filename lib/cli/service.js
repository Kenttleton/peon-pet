'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');

const PLIST_LABEL = 'com.peonpet.app';
const PLIST_DEST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);
const APP_DIR = path.join(__dirname, '..', '..');

function resolveElectronBin() {
  const bin = path.join(APP_DIR, 'node_modules', '.bin', 'electron');
  if (!fs.existsSync(bin)) {
    process.stderr.write('[peon-pet] Electron not found. Run: npm install\n');
    process.exit(1);
  }
  // Resolve symlink so launchd gets the real binary path
  try {
    return fs.realpathSync(bin);
  } catch {
    return bin;
  }
}

function launchctl(...args) {
  const result = spawnSync('launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return result;
}

function registerServiceCommands(program) {
  program
    .command('install')
    .description('Install peon-pet as a macOS LaunchAgent (starts at login)')
    .action(() => {
      if (process.platform !== 'darwin') {
        process.stderr.write('[peon-pet] install only supports macOS.\n');
        process.exit(1);
      }

      const electronReal = resolveElectronBin();
      const plistSrc = path.join(APP_DIR, 'com.peonpet.app.plist');
      const template = fs.readFileSync(plistSrc, 'utf8');
      const plist = template
        .replace(/ELECTRON_BIN_PLACEHOLDER/g, electronReal)
        .replace(/APP_DIR_PLACEHOLDER/g, APP_DIR);

      fs.mkdirSync(path.dirname(PLIST_DEST), { recursive: true });
      fs.writeFileSync(PLIST_DEST, plist, 'utf8');

      // Unload any existing instance before loading
      launchctl('unload', PLIST_DEST);

      const load = launchctl('load', '-w', PLIST_DEST);
      if (load.status !== 0) {
        process.stderr.write(`[peon-pet] launchctl load failed:\n${load.stderr}\n`);
        process.exit(1);
      }

      console.log('peon-pet installed as a LaunchAgent.');
      console.log(`  App dir:  ${APP_DIR}`);
      console.log(`  Electron: ${electronReal}`);
      console.log('peon-pet will start at login and restart if it quits.');
      console.log('Logs: /tmp/peon-pet.log  /tmp/peon-pet.err');
    });

  program
    .command('uninstall')
    .description('Remove the peon-pet LaunchAgent')
    .action(() => {
      if (process.platform !== 'darwin') {
        process.stderr.write('[peon-pet] uninstall only supports macOS.\n');
        process.exit(1);
      }

      if (!fs.existsSync(PLIST_DEST)) {
        console.log('peon-pet LaunchAgent is not installed.');
        return;
      }

      launchctl('unload', PLIST_DEST);
      fs.unlinkSync(PLIST_DEST);
      console.log('peon-pet LaunchAgent removed.');
    });
}

module.exports = { registerServiceCommands };
