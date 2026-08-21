'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  requestFromDiscordActivity,
  buildDiscordClaim,
  buildDiscordResponse,
  winningClaim,
  claimIsActive,
  createDiscordCoordJournal,
  DEFAULT_CLAIM_TTL_MS
} = require('../../functions/discordContract');

describe('discordContract edges', () => {
  it('requestFromDiscordActivity rejects non-DiscordMessage and empty targets', () => {
    assert.strictEqual(requestFromDiscordActivity(null), null);
    assert.strictEqual(requestFromDiscordActivity({ type: 'ChatMessage' }), null);
    assert.strictEqual(requestFromDiscordActivity({
      type: 'DiscordMessage',
      object: { content: 'hi' },
      target: {}
    }), null);
    const viaOpts = requestFromDiscordActivity({
      type: 'DiscordMessage',
      object: { content: 'hi there' },
      actor: { id: 'u1', username: 'alice' }
    }, { channelId: 'c9', guildId: 'g1', appId: 'app' });
    assert.ok(viaOpts);
    assert.strictEqual(viaOpts.channelId, 'c9');
    assert.strictEqual(viaOpts.guildId, 'g1');
    assert.strictEqual(viaOpts.authorId, 'u1');
    const fromActivity = requestFromDiscordActivity({
      type: 'DiscordMessage',
      guildId: 'g9',
      object: { content: 'yo', id: 'm1' },
      actor: { ref: 'u2', username: 'bob' },
      target: { ref: 'c2', guildId: 'g-ignored' }
    });
    assert.strictEqual(fromActivity.guildId, 'g9');
  });

  it('buildDiscordClaim requires requestId and pubkey', () => {
    assert.throws(() => buildDiscordClaim({}, 'pk'), /requestId/);
    assert.throws(() => buildDiscordClaim({ requestId: 'r1' }, ''), /claimantPubkey/);
    const claim = buildDiscordClaim({ requestId: 'r1' }, 'aa', { ttlMs: 50 });
    assert.strictEqual(claim.ttlMs, 1000);
    assert.ok(claimIsActive(claim, Date.parse(claim.claimedAt)));
    assert.ok(!claimIsActive(claim, Date.parse(claim.claimedAt) + DEFAULT_CLAIM_TTL_MS + 1));
    assert.ok(!claimIsActive(null));
  });

  it('winningClaim and response tolerate missing sides', () => {
    assert.strictEqual(winningClaim(null, null), null);
    const only = { claimedAt: '2026-01-01T00:00:00.000Z', claimantPubkey: 'aa' };
    assert.strictEqual(winningClaim(only, null), only);
    const res = buildDiscordResponse({ requestId: 'r1' }, null, { status: 'error', error: 'nope' });
    assert.strictEqual(res.status, 'error');
    assert.strictEqual(res.error, 'nope');
    assert.strictEqual(res.claimId, null);
    assert.throws(() => buildDiscordResponse({}, null, {}), /requestId/);
  });

  it('coordination journal evicts oldest rows past capacity', () => {
    const journal = createDiscordCoordJournal({ capacity: 50 });
    for (let i = 0; i < 55; i++) {
      journal.append('DiscordRequest', {
        requestId: 'r' + i,
        channelId: 'c',
        content: 'x'
      }, { direction: 'in' });
    }
    assert.strictEqual(journal.listRecent(500).length, 50);
    assert.strictEqual(journal.treeFor('r0').request, null);
    assert.ok(journal.treeFor('r54').request);
    assert.strictEqual(journal.getWinningClaim('missing'), null);
  });
});
