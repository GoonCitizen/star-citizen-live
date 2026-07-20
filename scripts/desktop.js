#!/usr/bin/env node
'use strict';

/**
 * Cross-platform Electron launcher.
 *
 * Cursor / some CI shells set ELECTRON_RUN_AS_NODE=1, which makes
 * require('electron') return a filesystem path instead of the Electron API
 * and breaks the desktop app. Clear it, then spawn Electron with the same
 * args npm would pass (e.g. `.` or `--dev`).
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

delete process.env.ELECTRON_RUN_AS_NODE;

const root = path.join(__dirname, '..');
const electronCli = path.join(root, 'node_modules', 'electron', 'cli.js');

if (!fs.existsSync(electronCli)) {
  console.error('[ELECTRON]', 'electron is not installed. Run: npm install');
  process.exit(1);
}

const args = process.argv.slice(2);
const child = spawn(process.execPath, [electronCli, ...args], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error('[ELECTRON]', `Electron exited with signal ${signal}`);
    process.exit(1);
  }
  process.exit(code == null ? 1 : code);
});
