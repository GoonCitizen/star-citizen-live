'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const chatLookup = require('../../functions/chatLookup');

describe('chatLookup edges', () => {
  it('parseLookupCommand rejects empty and non-commands', () => {
    assert.strictEqual(chatLookup.parseLookupCommand(null), null);
    assert.strictEqual(chatLookup.parseLookupCommand(''), null);
    assert.strictEqual(chatLookup.parseLookupCommand('/help'), null);
    assert.ok(chatLookup.parseLookupCommand('/lookup   starjump').query === 'starjump');
  });

  it('buildLookupClaim clamps ttl and requires ids', () => {
    assert.throws(() => chatLookup.buildLookupClaim({}, 'pk'), /requestId/);
    assert.throws(() => chatLookup.buildLookupClaim({ requestId: 'r1' }, ''), /claimantPubkey/);
    const claim = chatLookup.buildLookupClaim({ requestId: 'r1' }, 'aa', { ttlMs: 10 });
    assert.strictEqual(claim.ttlMs, 500);
    assert.ok(chatLookup.claimIsActive(claim, Date.parse(claim.claimedAt)));
    assert.ok(!chatLookup.claimIsActive(claim, Date.parse(claim.claimedAt) + claim.ttlMs + 1));
  });

  it('formatLookupReply handles empty catalogs', () => {
    const text = chatLookup.formatLookupReply({ query: '' }, {
      query: '',
      players: [],
      groups: []
    });
    assert.match(text, /Lookup report \(all\)/);
    assert.match(text, /Players \(0\): none/);
    assert.match(text, /Public groups \(0\): none/);
    assert.match(text, /Public fleets \(0\): none/);
    assert.match(text, /Peers \(0\): none/);
    assert.match(text, /Discord servers \(0\): none/);
    assert.match(text, /Discord users \(0\): none/);
    assert.match(text, /Local tags \(0\): none/);
  });
});
