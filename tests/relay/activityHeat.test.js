'use strict';

const test = require('node:test');
const assert = require('node:assert');
const activityHeat = require('../../functions/activityHeat');

test('heatcellsFromEvents aggregates weekday/hour and filters by player', () => {
  // 2024-01-01 was a Monday (local timezone dependent — use UTC noon mid-week).
  const events = [
    { ts: '2024-06-03T15:00:00.000Z', player: 'Alice' }, // Mon in many TZ; hour varies
    { ts: '2024-06-03T15:30:00.000Z', player: 'Alice' },
    { ts: '2024-06-03T15:00:00.000Z', player: 'Bob' },
    { ts: 'not-a-date', player: 'Alice' },
    { player: 'Alice' }
  ];
  const all = activityHeat.heatcellsFromEvents(events);
  assert.ok(all.length >= 1);
  const alice = activityHeat.heatcellsFromEvents(events, { player: 'Alice' });
  const bob = activityHeat.heatcellsFromEvents(events, { player: 'Bob' });
  const aliceN = alice.reduce((s, c) => s + c.n, 0);
  const bobN = bob.reduce((s, c) => s + c.n, 0);
  assert.strictEqual(aliceN, 2);
  assert.strictEqual(bobN, 1);
});

test('resolveHeatcells uses aggregate heat or rebuilds for a player', () => {
  const analytics = {
    heatcells: [{ ym: '2024-06', d: 0, h: 10, n: 5 }],
    missions: [
      { ts: '2024-06-03T12:00:00.000Z', player: 'Neorion' },
      { ts: '2024-06-03T13:00:00.000Z', player: 'Other' }
    ],
    sessions: [],
    deaths: [],
    quantum: [],
    incap: [],
    crimestat: []
  };
  const all = activityHeat.resolveHeatcells(analytics);
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].n, 5);

  const scoped = activityHeat.resolveHeatcells(analytics, { player: 'Neorion' });
  assert.ok(scoped.length >= 1);
  assert.strictEqual(scoped.reduce((s, c) => s + c.n, 0), 1);

  analytics.missions[1].source = '02peer';
  analytics.missions[0].source = 'local';
  const localOnly = activityHeat.resolveHeatcells(analytics, {
    rebuild: true,
    keep: (row) => !row.source || row.source === 'local'
  });
  assert.strictEqual(localOnly.reduce((s, c) => s + c.n, 0), 1);
});

test('renderHeatSvg returns empty or SVG', () => {
  const empty = activityHeat.renderHeatSvg([]);
  assert.match(empty, /no activity|empty/);
  const svg = activityHeat.renderHeatSvg([{ ym: '2024-06', d: 1, h: 14, n: 3 }]);
  assert.match(svg, /<svg/);
  assert.match(svg, /rect/);
});
