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
main(settings).catch((exception) => {
  console.error('[FABRIC:STAR-CITIZEN]', '[ERROR]', 'Main Process Exception:', exception);
}).then((output) => {
  console.debug('[FABRIC:STAR-CITIZEN]', '[OUTPUT]', 'Main Process Complete:', output);
});
