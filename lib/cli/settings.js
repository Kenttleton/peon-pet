'use strict';

const { ConfigManager } = require('../config-manager');
const cfgMgr = new ConfigManager();

const CORNER_ALIASES = {
  bl: 'bottom-left',
  br: 'bottom-right',
  tl: 'top-left',
  tr: 'top-right',
  'bottom-left': 'bottom-left',
  'bottom-right': 'bottom-right',
  'top-left': 'top-left',
  'top-right': 'top-right',
};

function registerSettingsCommands(program) {
  program
    .command('scale [value]')
    .description('Get or set the display scale multiplier (positive number)')
    .action((value) => {
      if (value === undefined) {
        const app = cfgMgr.getAppConfig();
        console.log(app.scale !== undefined ? String(app.scale) : '1 (default)');
        return;
      }
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) {
        process.stderr.write(`[peon-pet] Invalid scale "${value}" — must be a positive number.\n`);
        process.exit(1);
      }
      cfgMgr.saveAppConfig({ scale: n });
      console.log(`Scale set to ${n}.`);
    });

  program
    .command('border [on|off]')
    .description('Get or set border display (on/off)')
    .action((value) => {
      if (value === undefined) {
        const app = cfgMgr.getAppConfig();
        console.log(app.border ? 'on' : 'off');
        return;
      }
      if (value !== 'on' && value !== 'off') {
        process.stderr.write(`[peon-pet] Invalid value "${value}" — must be "on" or "off".\n`);
        process.exit(1);
      }
      cfgMgr.saveAppConfig({ border: value === 'on' });
      console.log(`Border set to ${value}.`);
    });

  program
    .command('corner [position]')
    .description('Get or set the screen corner (bl, br, tl, tr or full names)')
    .action((value) => {
      if (value === undefined) {
        const raw = cfgMgr.getRaw();
        console.log(raw.corner || 'bottom-left (default)');
        return;
      }
      const normalized = CORNER_ALIASES[value];
      if (!normalized) {
        process.stderr.write(
          `[peon-pet] Invalid corner "${value}" — use bl, br, tl, tr (or bottom-left, bottom-right, top-left, top-right).\n`
        );
        process.exit(1);
      }
      cfgMgr.saveAppConfig({ corner: normalized });
      console.log(`Corner set to ${normalized}.`);
    });

  program
    .command('corner-radius [pixels]')
    .description('Get or set the window corner radius in display pixels (0 = square)')
    .action((value) => {
      if (value === undefined) {
        const raw = cfgMgr.getRaw();
        console.log(raw.cornerRadius !== undefined ? String(raw.cornerRadius) : '0 (default)');
        return;
      }
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        process.stderr.write(`[peon-pet] Invalid corner-radius "${value}" — must be a non-negative number.\n`);
        process.exit(1);
      }
      cfgMgr.saveAppConfig({ cornerRadius: n });
      console.log(`Corner radius set to ${n}px.`);
    });

  program
    .command('remote [url]')
    .description('Get or set the peon-ping remote URL')
    .action((value) => {
      if (value === undefined) {
        const raw = cfgMgr.getRaw();
        console.log(raw.remoteUrl || 'http://127.0.0.1:19998 (default)');
        return;
      }
      cfgMgr.saveAppConfig({ remoteUrl: value });
      console.log(`Remote URL set to ${value}.`);
    });
}

module.exports = { registerSettingsCommands };
