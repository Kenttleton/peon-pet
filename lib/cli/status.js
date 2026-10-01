'use strict';

const { spawnSync } = require('child_process');
const { ConfigManager } = require('../config-manager');
const cfgMgr = new ConfigManager();
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

// Resolves the on-disk directory for app.pet (or 'orc' if unset), checking
// the custom packs dir before the bundled one, same precedence as the
// renderer's own pack resolution. Returns '(not resolved)' if neither has
// a valid manifest. Extracted as a pure function (parameterized on `app`,
// not reading cfgMgr itself) so it's testable without a real config file.
function resolvePackDir(app) {
  const assetsDir = getBundledPacksDir();
  const customDir = path.join(getCustomPacksDir(), app.pet || 'orc');
  const bundledDir = path.join(assetsDir, app.pet || 'orc');
  const { loadManifestFromDir } = require('../ceap-manifest');
  for (const dir of [customDir, bundledDir]) {
    try {
      if (loadManifestFromDir(dir)) return dir;
    } catch { /* try next */ }
  }
  return '(not resolved)';
}

function registerStatusCommand(program) {
  program
    .command('status')
    .description('Show current peon-pet configuration and service state')
    .option('-v, --verbose', 'Show additional details')
    .action((opts) => {
      const app = cfgMgr.getAppConfig();
      const raw = cfgMgr.getRaw();
      const configPath = getConfigPath();
      const pet = raw.pet !== undefined ? app.pet : 'orc (default)';
      const scale = app.scale !== undefined ? app.scale : '1 (default)';
      const border = app.border ? 'on' : 'off';
      const corner = raw.corner || 'bottom-left (default)';
      const remote = raw.remoteUrl !== undefined ? app.remoteUrl : 'http://127.0.0.1:19998 (default)';
      const cornerRadius = raw.cornerRadius !== undefined ? `${app.cornerRadius}px` : '0 (default)';
      const packDir = resolvePackDir(app);

      console.log(`pack:    ${pet}`);
      console.log(`dir:     ${packDir}`);
      console.log(`scale:   ${scale}`);
      console.log(`border:  ${border}`);
      console.log(`corner:  ${corner}`);
      console.log(`radius:  ${cornerRadius}`);
      console.log(`remote:  ${remote}`);

      if (opts.verbose) {
        console.log(`config:  ${configPath}`);
        const { installed, loaded } = getLaunchAgentState();
        console.log(`service: ${installed ? (loaded ? 'installed, running' : 'installed, not running') : 'not installed'}`);
      }
    });
}

module.exports = { registerStatusCommand, resolvePackDir };
