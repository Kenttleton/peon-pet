'use strict';

const log = require('electron-log/main');

// Captures renderer console.* (incl. PixiJS's own warnings) via
// 'console-message' on every webContents, with no renderer-side changes.
function initLogger(app) {
  const isDev = process.argv.includes('--dev');
  const level = app.isPackaged ? 'warn' : isDev ? 'debug' : 'info';

  log.transports.console.level = app.isPackaged ? false : level;
  log.transports.file.level = level;

  log.initialize({ preload: true, spyRendererConsole: true });
  log.errorHandler.startCatching();

  return log;
}

module.exports = { initLogger, log };
