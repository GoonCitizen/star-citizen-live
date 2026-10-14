'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const clusterInventory = require('../../functions/clusterInventory');

describe('clusterInventory', () => {
  it('folds Game.log history into log / mission counts', () => {
    const stats = clusterInventory.fromHistory({
      missions: [{ id: 'a' }, { id: 'b' }],
      sessions: [{ id: 's' }],
      deaths: [],
      incap: [{ id: 'i' }],
      meta: { files: 6, lines: 12000 }
    });
    assert.equal(stats.logs, 6);
    assert.equal(stats.logLines, 12000);
    assert.equal(stats.missions, 2);
    assert.equal(stats.sessions, 1);
    assert.equal(stats.incap, 1);
    assert.equal(stats.deaths, 0);
  });

  it('merges account.stats with pack lengths from a DeviceDataShare', () => {
    const share = {
      type: 'DeviceDataShare',
      fromPubkey: 'aa'.repeat(32),
      generatedAt: '2026-08-15T12:00:00.000Z',
      packs: [
        {
          pack: 'account.stats',
          payload: { notes: 12, logs: 6, missions: 1841, mnemonic: 'nope' }
        },
        { pack: 'account.notes', payload: { notes: [{ id: 'n1' }, { id: 'n2' }] } }
      ]
    };
    const inv = clusterInventory.fromShare(share, { applied: ['notes', 'notes'] });
    assert.equal(inv.notes, 2);
    assert.equal(inv.logs, 6);
    assert.equal(inv.missions, 1841);
    assert.deepEqual(inv.applied, ['notes']);
    assert.ok(!JSON.stringify(inv).includes('nope'));
  });

  it('chips keep zeros visible and add deaths when present', () => {
    const chips = clusterInventory.chipsFor({
      notes: 12,
      groups: 0,
      logs: 6,
      deaths: 3
    }, { includeZero: true });
    const byKey = Object.fromEntries(chips.map((c) => [c.key, c.count]));
    assert.equal(byKey.notes, 12);
    assert.equal(byKey.groups, 0);
    assert.equal(byKey.logs, 6);
    assert.equal(byKey.deaths, 3);
    assert.match(clusterInventory.relativeTime(Date.now() - 5000), /just now/);
  });

  it('mergeStats keeps the larger chat count across chunked shares', () => {
    const header = clusterInventory.fromShare({
      type: 'DeviceDataShare',
      packs: [{ pack: 'account.stats', payload: { notes: 12, chat: 80, logs: 6 } }]
    }, { applied: ['stats'] });
    const chatChunk = clusterInventory.fromShare({
      type: 'DeviceDataShare',
      packs: [{
        pack: 'account.chat',
        payload: { messages: [{ id: 'a' }, { id: 'b' }] }
      }]
    }, { applied: ['chat'] });
    const merged = clusterInventory.mergeStats(header, chatChunk);
    assert.equal(merged.notes, 12);
    assert.equal(merged.chat, 80);
    assert.equal(merged.logs, 6);
    assert.ok(merged.applied.includes('stats'));
    assert.ok(merged.applied.includes('chat'));
  });
});
