#!/usr/bin/env node
'use strict';

// Settings
const settings = require('../settings/local');

// Serevices
const StarCitizen = require('../services/StarCitizen');

// Main Process
async function main (input = {}) {
  const sc = new StarCitizen(input);
  await sc.start();
  return {
    id: sc.id
  };
}

// Run the main process, catch any exceptions, and log the output
console.log('[STAR-CITIZEN-LIVE]', '[STATUS]', 'Starting node...');
main(settings).catch((exception) => {
  console.error('[STAR-CITIZEN-LIVE]', '[ERROR]', 'Main Process Exception:', exception);
}).then((output) => {
  console.log('[STAR-CITIZEN-LIVE]', '[OUTPUT]', 'Main Process:', JSON.stringify(output));
  console.log('[STAR-CITIZEN-LIVE]', '[STATUS]', 'Listening for logs...');
});
