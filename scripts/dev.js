'use strict';

// Spawns Electron in its own process group so that Ctrl+C in the terminal
// delivers SIGINT only to this wrapper, not to the Electron process directly.
// Chromium intercepts SIGINT at the C++ level before Node.js can deliver it
// to process.on('SIGINT') handlers; SIGTERM is not intercepted and works fine.
// This wrapper converts SIGINT → SIGTERM so main.js gets a handleable signal.

const { spawn } = require('child_process');
const electron = require('electron');

const child = spawn(electron, ['.', '--dev'], {
  stdio: ['ignore', 'inherit', 'inherit'],
  detached: true,
  windowsHide: false,
});

child.on('close', (code) => process.exit(code ?? 0));

let exiting = false;
function shutdown() {
  if (exiting) return;
  exiting = true;
  child.kill('SIGTERM');
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP',  shutdown);
