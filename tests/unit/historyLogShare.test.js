'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { eventsFromLocalHistory } = require('../../functions/historyLogShare');

test('eventsFromLocalHistory maps local rows and skips peer-sourced', () => {
  const events = eventsFromLocalHistory({
    missions: [
      { id: 'm1', player: 'Me', ts: '2026-01-01T00:00:00.000Z', outcome: 'Complete', missionId: 'x', source: 'local' },
      { id: 'm2', player: 'Peer', ts: '2026-01-02T00:00:00.000Z', outcome: 'Complete', missionId: 'y', source: '02abc' }
    ],
    deaths: [
      { id: 'd1', player: 'Me', ts: '2026-01-01T01:00:00.000Z', bodyId: '1', source: 'local' }
    ],
    incap: [],
    quantum: [
      { id: 'q1', phase: 'select', player: 'Me', ts: '2026-01-01T02:00:00.000Z', destination: 'Area18', source: 'local' }
    ],
    crimestat: [],
    players: ['Me', 'Peer']
  });

  assert.equal(events.filter((e) => e.collection === 'missionlog').length, 1);
  assert.equal(events.find((e) => e.collection === 'missionlog').data.player, 'Me');
  assert.equal(events.filter((e) => e.collection === 'deaths').length, 1);
  assert.equal(events.filter((e) => e.collection === 'quantum').length, 1);
  assert.ok(events.some((e) => e.collection === 'players' && e.data.name === 'Me'));
});

test('eventsFromLocalHistory treats missing source as local', () => {
  const events = eventsFromLocalHistory({
    missions: [{ id: 'legacy', player: 'Old', ts: '2025-01-01T00:00:00.000Z', outcome: 'Abandon' }],
    deaths: [],
    players: []
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].data.completionType, 'Abandon');
});
