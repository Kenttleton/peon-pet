#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { registerPacksCommand } = require('../lib/cli/packs');
const { registerSettingsCommands } = require('../lib/cli/settings');
const { registerStatusCommand } = require('../lib/cli/status');
const { registerServiceCommands } = require('../lib/cli/service');

const program = new Command();

program
  .name('peon-pet')
  .description('CLI for configuring and managing peon-pet')
  .version(require('../package.json').version)
  .action(() => {
    const appDir = path.join(__dirname, '..');
    const electronBin = path.join(appDir, 'node_modules', '.bin', 'electron');
    if (!fs.existsSync(electronBin)) {
      process.stderr.write('[peon-pet] Electron not found. Run: npm install\n');
      process.exit(1);
    }
    const child = spawn(electronBin, [appDir], { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code || 0));
  });

registerPacksCommand(program);
registerSettingsCommands(program);
registerStatusCommand(program);
registerServiceCommands(program);

program.parse(process.argv);
