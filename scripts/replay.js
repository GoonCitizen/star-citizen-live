'use strict';

/**
 * Offline log replay (M2).
 *
 * Feeds a saved Star Citizen Game.log through the exact same pipeline as live
 * tailing, so you can test parsing/Discord without being in-game. READ-ONLY:
 * it never modifies the log or any game file.
 *
 * Usage:
 *   node scripts/replay.js /path/to/Game.log
 */

const path = require('path');
const StarCitizenService = require('../app/server');

async function main () {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/replay.js /path/to/Game.log');
    process.exit(1);
  }

  // Discord off; missions on. Tally what gets detected.
  const svc = new StarCitizenService({ discord: { enable: false } });
  const tally = {};
  svc.on('event', (e) => { tally[e.kind] = (tally[e.kind] || 0) + 1; });

  const start = Date.now();
  const lines = await svc.replayLog(path.resolve(file));
  const ms = Date.now() - start;

  console.log(`\nReplayed ${lines} lines in ${ms}ms from ${path.basename(file)}`);
  console.log(`Activities: ${svc.activities.length} | Players: ${svc.players.length} | Kills: ${svc.kills.length} | Vehicles: ${svc.vehicles.length}`);
  console.log('\nDetected events by kind:');
  const kinds = Object.keys(tally).sort((a, b) => tally[b] - tally[a]);
  if (!kinds.length) console.log('  (none classified beyond generic log lines)');
  for (const k of kinds) console.log(`  ${String(tally[k]).padStart(6)}  ${k}`);
  console.log('');
}

main().catch((e) => { console.error('Replay failed:', e.message); process.exit(1); });
