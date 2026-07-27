'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const eventChain = require('../../functions/eventChain');

describe('eventChain (gossip Chain of Blocks)', () => {
  it('is available when @fabric/core Chain/Block are linked', () => {
    assert.equal(eventChain.available, true);
  });

  it('mergeBatch unions by content id across sources', () => {
    const a = eventChain.createEmpty();
    eventChain.appendEvent(a, {
      kind: 'player:death',
      timestamp: '2026-01-01T00:00:00Z',
      player: 'Alice',
      bodyId: 'b1'
    }, { source: 'pkA' });
    eventChain.appendEvent(a, {
      kind: 'mission:end',
      timestamp: '2026-01-01T01:00:00Z',
      player: 'Alice',
      completionType: 'Complete'
    }, { source: 'pkA' });

    // Same source re-delivery of Alice death → dedup; Bob death is new.
    const batch = [
      {
        collection: 'deaths',
        data: {
          kind: 'player:death',
          timestamp: '2026-01-01T00:00:00Z',
          player: 'Alice',
          bodyId: 'b1'
        }
      },
      {
        collection: 'deaths',
        data: {
          kind: 'player:death',
          timestamp: '2026-01-01T00:30:00Z',
          player: 'Bob',
          bodyId: 'b2'
        }
      }
    ];
    eventChain.mergeBatch(a, batch, 'pkA');
    assert.equal(a.height, 3);

    // Different source describing the same Alice death keeps a distinct attributable copy.
    eventChain.mergeBatch(a, [batch[0]], 'pkB');
    assert.equal(a.height, 4);

    const { head, tail } = eventChain.split(a, { by: 'author', author: 'pkB' });
    assert.equal(head.height, 1);
    assert.equal(tail.height, 3);

    const folded = eventChain.foldToHistoryRecords(a);
    assert.equal(folded.deaths.length, 3);
    assert.equal(folded.missions.length, 1);
    assert.ok(eventChain.digest(a));
  });

  it('fromHistory hydrates and replay filters', () => {
    const history = {
      deaths: [{ id: 'd1', player: 'P', ts: '2026-02-01T00:00:00Z', bodyId: null }],
      missions: [{ id: 'm1', player: 'P', ts: '2026-02-01T02:00:00Z', outcome: 'Complete' }]
    };
    const chain = eventChain.fromHistory(history, 'pk');
    assert.equal(chain.height, 2);
    const deaths = eventChain.replay(chain, { filter: (e) => e.payload.kind === 'player:death' });
    assert.equal(deaths.length, 1);
  });
});
