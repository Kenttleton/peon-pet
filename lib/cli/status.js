'use strict';

const { spawnSync } = require('child_process');
const { loadConfig } = require('../pet-config');
const { getConfigPath, getBundledPacksDir, getCustomPacksDir } = require('../paths');
const path = require('path');

function getLaunchAgentState() {
  const uid = process.getuid ? process.getuid() : null;
  if (uid === null) return { installed: false, loaded: false };

  const plistDest = path.join(
    process.env.HOME || require('os').homedir(),
    'Library', 'LaunchAgents', 'com.peonpet.app.plist'
  );

  const installed = require('fs').existsSync(plistDest);

  let loaded = false;
  if (installed) {
    const result = spawnSync(
      'launchctl', ['print', `gui/${uid}/com.peonpet.app`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    loaded = result.status === 0;
  }

  return { installed, loaded };
}

function registerStatusCommand(program) {
  program
    .command('status')
    .description('Show current peon-pet configuration and service state')
    .option('-v, --verbose', 'Show additional details')
    .action((opts) => {
      const cfg = loadConfig();
      const configPath = getConfigPath();
      const pet = cfg.pet || 'orc (default)';
      const scale = cfg.scale !== undefined ? cfg.scale : '1 (default)';
      const border = cfg.border === true ? 'on' : 'off';
      const corner = cfg.corner || 'bottom-left (default)';
      const remote = cfg.remoteUrl || 'http://127.0.0.1:19998 (default)';

      let packDir = '(not resolved)';
      const assetsDir = getBundledPacksDir();
      const customDir = path.join(getCustomPacksDir(), cfg.pet || 'orc');
      const bundledDir = path.join(assetsDir, cfg.pet || 'orc');
      const { loadManifestFromDir } = require('../ceap-manifest');
      for (const dir of [customDir, bundledDir]) {
        try {
          if (loadManifestFromDir(dir)) { packDir = dir; break; }
        } catch { /* try next */ }
      }

      console.log(`pack:    ${pet}`);
      console.log(`dir:     ${packDir}`);
      console.log(`scale:   ${scale}`);
      console.log(`border:  ${border}`);
      console.log(`corner:  ${corner}`);
      console.log(`remote:  ${remote}`);

      if (opts.verbose) {
        console.log(`config:  ${configPath}`);
        const { installed, loaded } = getLaunchAgentState();
        console.log(`service: ${installed ? (loaded ? 'installed, running' : 'installed, not running') : 'not installed'}`);
      }
    });
}

module.exports = { registerStatusCommand };
