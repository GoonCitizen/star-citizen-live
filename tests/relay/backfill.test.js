'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { ingestFiles, toStore } = require('../scripts/backfill');

test('backfill ingests a log into compact aggregates (missions, deaths, heat, pilots)', async () => {
  const acc = await ingestFiles([path.join(__dirname, 'fixtures', 'sample-missions.log')]);

  // The fixture has 3 ended missions (Complete/Abandon/Fail) and 2 deaths for Kersa.
  assert.strictEqual(acc.missions.length, 3, 'three ended missions');
  assert.deepStrictEqual(acc.missions.map((m) => m.outcome).sort(), ['Abandon', 'Complete', 'Fail']);
  assert.ok(acc.missions.every((m) => m.player === 'Kersa'), 'attributed to the logged-in pilot');
  assert.strictEqual(acc.deaths.length, 2, 'two deaths');
  assert.ok(acc.players.has('Kersa'));
  assert.ok(Object.keys(acc.heat).length >= 1, 'activity heat buckets recorded');

  const store = toStore(acc, '2026-06-18T00:00:00.000Z');
  assert.ok(Array.isArray(store.players) && store.players.includes('Kersa'));
  assert.strictEqual(store.meta.generatedAt, '2026-06-18T00:00:00.000Z');
});
