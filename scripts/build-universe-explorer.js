'use strict';

/**
 * Build the lazy Three.js universe explorer bundle.
 * Output: assets/scripts/universe-explorer.js (not inlined into the SPA shell).
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const entry = path.join(__dirname, 'universe-explorer-entry.js');
const dest = path.join(root, 'assets', 'scripts', 'universe-explorer.js');

async function main () {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    outfile: dest,
    format: 'iife',
    globalName: 'GoonUniverseExplorerBundle',
    platform: 'browser',
    target: ['chrome100'],
    minify: true,
    logLevel: 'warning',
    footer: {
      js: 'window.GoonUniverseExplorer=window.GoonUniverseExplorer||GoonUniverseExplorerBundle;'
    }
  });
  const st = fs.statSync(dest);
  console.log('[BUILD]', 'Wrote assets/scripts/universe-explorer.js (' + st.size + ' bytes)');
}

main().catch((err) => {
  console.error('[BUILD]', err);
  process.exit(1);
});
