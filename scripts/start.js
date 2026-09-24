'use strict';

const { launchElectron } = require('../lib/electron-launcher');

launchElectron(process.argv.slice(2));
