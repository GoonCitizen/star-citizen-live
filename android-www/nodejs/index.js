'use strict';

/**
 * Capacitor-NodeJS starting point (must live under webDir/nodejs).
 * Always calls `main()` — requiring android-node.js alone does not start LiveRelay.
 */

const fs = require('fs');
const path = require('path');

function loadBoot () {
  const staged = path.join(__dirname, 'app', 'functions', 'androidNodeBoot.js');
  const repo = path.join(__dirname, '..', '..', 'functions', 'androidNodeBoot.js');
  if (fs.existsSync(staged)) return require(staged);
  if (fs.existsSync(repo)) return require(repo);
  throw new Error('GoonCitizen Android node missing — run npm run android:sync');
}

loadBoot().runFromNodejsRoot(__dirname).catch((exception) => {
  console.error('[STAR-CITIZEN]', '[ERROR]', 'Android node exception:', exception);
});
