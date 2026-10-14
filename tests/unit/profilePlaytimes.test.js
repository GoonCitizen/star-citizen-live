'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { Store } = require('../../types/Store');
const play = require('../../functions/profilePlaytimes');

describe('profilePlaytimes', () => {
  it('collapses month cells into a weekday × hour grid', () => {
    const cells = play.collapseHeatcells([
      { ym: '2026-07', d: 0, h: 20, n: 2 },
      { ym: '2026-08', d: 0, h: 20, n: 3 },
      { ym: '2026-08', d: 6, h: 9, n: 1 }
    ]);
    const eve = cells.find((c) => c.d === 0 && c.h === 20);
    assert.strictEqual(eve.n, 5);
    assert.ok(cells.some((c) => c.d === 6 && c.h === 9 && c.n === 1));
  });

  it('folds shared play times without treating them as guilds', () => {
    const store = new Store({ path: null });
    const pubkey = '02' + 'ab'.repeat(32);
    const row = play.foldPlaytimes(store, {
      pubkey,
      cells: [{ d: 1, h: 18, n: 4 }]
    }, { via: 'gossip', pubkey: '02' + 'cd'.repeat(32), groupId: 'grp1' });
    assert.ok(row);
    assert.strictEqual(row.pack, play.PACK);
    assert.strictEqual(row.sampleCount, 4);
    const loaded = play.loadPlaytimes(store, pubkey);
    assert.strictEqual(loaded.cells[0].n, 4);
    assert.strictEqual(play.loadAllPlaytimes(store).length, 1);
    assert.strictEqual(play.compactPlaytimesPayload({ pubkey, heatcells: [] }), null);
  });
});
