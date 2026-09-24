#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const { launchElectron } = require('../lib/electron-launcher');
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
    launchElectron();
  });

registerPacksCommand(program);
registerSettingsCommands(program);
registerStatusCommand(program);
registerServiceCommands(program);

program.parse(process.argv);
