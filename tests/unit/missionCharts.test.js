'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { topPilots } = require('../../functions/missionCharts');

describe('missionCharts.topPilots', () => {
  it('ranks by completed missions then total, with deaths', () => {
    const rows = topPilots([
      { player: 'Neorion', outcome: 'Complete' },
      { player: 'Neorion', outcome: 'Complete' },
      { player: 'Neorion', outcome: 'Fail' },
      { player: 'WATCHMAN', outcome: 'Abandon' },
      { player: 'WATCHMAN', outcome: 'Complete' }
    ], [
      { player: 'WATCHMAN' },
      { player: 'WATCHMAN' }
    ], { limit: 10 });
    assert.equal(rows[0].n, 'Neorion');
    assert.equal(rows[0].tot, 3);
    assert.equal(rows[0].done, 2);
    assert.equal(rows[0].deaths, 0);
    assert.equal(rows[1].n, 'WATCHMAN');
    assert.equal(rows[1].deaths, 2);
  });

  it('caps the table at the requested limit', () => {
    const missions = [];
    for (let i = 0; i < 20; i++) {
      missions.push({ player: 'P' + i, outcome: 'Complete' });
    }
    const rows = topPilots(missions, [], { limit: 5 });
    assert.equal(rows.length, 5);
  });
});
