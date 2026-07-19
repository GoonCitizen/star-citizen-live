'use strict';

/**
 * Prepare browser assets for Electron packaging.
 * Copies the live dashboard to assets/index.html (production fallback).
 * The running app prefers the LiveRelay HTTP server for live data.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'assets', 'dashboard.html');
const dest = path.join(root, 'assets', 'index.html');

if (!fs.existsSync(src)) {
  console.error('[BUILD]', 'Missing assets/dashboard.html');
  process.exit(1);
}

fs.copyFileSync(src, dest);
console.log('[BUILD]', 'Wrote assets/index.html from dashboard.html');
