'use strict';

const log = require('electron-log/main');

const LEVEL_MAP = { info: 'info', warning: 'warn', error: 'error', debug: 'debug' };

// Tags each line with its source window (main/subagent:<id>/tooltip) so
// Chromium/DevTools-internal noise (Autofill, Autofocus, etc.) stays
// identifiable and skippable instead of being dropped — a dropped line
// could just as easily be a real uncaught error from a library that
// doesn't use our [peon-pet:*] prefix.
function tagConsoleMessages(webContents, windowLabel) {
  webContents.on('console-message', (event) => {
    log.processMessage({
      data: [`[renderer:${windowLabel}]`, event.message],
      level: LEVEL_MAP[event.level] || 'info',
    });
  });
}

function initLogger(app) {
  const isDev = process.argv.includes('--dev');
  const level = app.isPackaged ? 'warn' : isDev ? 'debug' : 'info';

  log.transports.console.level = app.isPackaged ? false : level;
  log.transports.file.level = level;

  log.initialize({ preload: true });
  log.errorHandler.startCatching();

  return log;
}

module.exports = { initLogger, tagConsoleMessages, log };
