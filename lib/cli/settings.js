'use strict';

const { loadConfig, writeConfig } = require('../pet-config');

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
        const cfg = loadConfig();
        console.log(cfg.scale !== undefined ? String(cfg.scale) : '1 (default)');
        return;
      }
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) {
        process.stderr.write(`[peon-pet] Invalid scale "${value}" — must be a positive number.\n`);
        process.exit(1);
      }
      writeConfig({ scale: n });
      console.log(`Scale set to ${n}. Restart peon-pet for it to take effect.`);
    });

  program
    .command('border [on|off]')
    .description('Get or set border display (on/off)')
    .action((value) => {
      if (value === undefined) {
        const cfg = loadConfig();
        console.log(cfg.border === true ? 'on' : 'off');
        return;
      }
      if (value !== 'on' && value !== 'off') {
        process.stderr.write(`[peon-pet] Invalid value "${value}" — must be "on" or "off".\n`);
        process.exit(1);
      }
      writeConfig({ border: value === 'on' });
      console.log(`Border set to ${value}. Restart peon-pet for it to take effect.`);
    });

  program
    .command('corner [position]')
    .description('Get or set the screen corner (bl, br, tl, tr or full names)')
    .action((value) => {
      if (value === undefined) {
        const cfg = loadConfig();
        console.log(cfg.corner || 'bottom-left (default)');
        return;
      }
      const normalized = CORNER_ALIASES[value];
      if (!normalized) {
        process.stderr.write(
          `[peon-pet] Invalid corner "${value}" — use bl, br, tl, tr (or bottom-left, bottom-right, top-left, top-right).\n`
        );
        process.exit(1);
      }
      writeConfig({ corner: normalized });
      console.log(`Corner set to ${normalized}. Restart peon-pet for it to take effect.`);
    });

  program
    .command('remote [url]')
    .description('Get or set the peon-ping remote URL')
    .action((value) => {
      if (value === undefined) {
        const cfg = loadConfig();
        console.log(cfg.remoteUrl || 'http://127.0.0.1:19998 (default)');
        return;
      }
      writeConfig({ remoteUrl: value });
      console.log(`Remote URL set to ${value}. Restart peon-pet for it to take effect.`);
    });
}

module.exports = { registerSettingsCommands };
