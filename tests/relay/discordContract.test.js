'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  DISCORD_REQUEST,
  DISCORD_CLAIM,
  DISCORD_RESPONSE,
  discordRequestId,
  requestFromDiscordActivity,
  buildDiscordClaim,
  buildDiscordResponse,
  winningClaim,
  claimIsActive,
  buildDiscordSequenceTree,
  createDiscordCoordJournal
} = require('../../functions/discordContract');

describe('discordContract', () => {
  it('builds stable request ids from channel + discord message id', () => {
    const a = discordRequestId({ channelId: '111', discordMessageId: '222' });
    const b = discordRequestId({ channelId: '111', discordMessageId: '222' });
    const c = discordRequestId({ channelId: '111', discordMessageId: '333' });
    assert.strictEqual(a, b);
    assert.notStrictEqual(a, c);
    assert.match(a, /^[a-f0-9]{64}$/);
  });

  it('parses DiscordMessage activities into DiscordRequest objects', () => {
    const req = requestFromDiscordActivity({
      type: 'DiscordMessage',
      actor: { ref: 'user1', username: 'alice' },
      object: { id: 'msg9', content: '!ping', created: 1700000000000 },
      target: { ref: 'chan1', type: 0 }
    }, { appId: 'app42' });
    assert.ok(req);
    assert.strictEqual(req.channelId, 'chan1');
    assert.strictEqual(req.discordMessageId, 'msg9');
    assert.strictEqual(req.content, '!ping');
    assert.strictEqual(req.appId, 'app42');
    assert.strictEqual(req.requestId, discordRequestId({
      channelId: 'chan1',
      discordMessageId: 'msg9'
    }));
  });

  it('picks the earlier claim (tie-break pubkey)', () => {
    const early = {
      requestId: 'r1',
      claimId: 'c1',
      claimantPubkey: 'bb',
      claimedAt: '2026-01-01T00:00:01.000Z',
      ttlMs: 30000
    };
    const late = {
      requestId: 'r1',
      claimId: 'c2',
      claimantPubkey: 'aa',
      claimedAt: '2026-01-01T00:00:02.000Z',
      ttlMs: 30000
    };
    assert.strictEqual(winningClaim(early, late), early);
    const sameTimeA = Object.assign({}, early, { claimantPubkey: 'aa', claimedAt: early.claimedAt });
    const sameTimeB = Object.assign({}, early, { claimantPubkey: 'bb', claimedAt: early.claimedAt });
    assert.strictEqual(winningClaim(sameTimeA, sameTimeB).claimantPubkey, 'aa');
    assert.ok(claimIsActive(early, Date.parse(early.claimedAt) + 1000));
    assert.ok(!claimIsActive(early, Date.parse(early.claimedAt) + 60000));
  });

  it('builds claim/response and auditor sequence trees', () => {
    const request = requestFromDiscordActivity({
      type: 'DiscordMessage',
      actor: { ref: 'u', username: 'bob' },
      object: { id: 'm1', content: '!help', created: Date.now() },
      target: { ref: 'c1' }
    });
    const claim = buildDiscordClaim(request, 'pubkey-a');
    assert.strictEqual(claim.requestId, request.requestId);
    assert.ok(claim.claimId);

    const response = buildDiscordResponse(request, claim, {
      status: 'ok',
      reply: { content: 'hi' },
      responderPubkey: 'pubkey-a'
    });
    assert.strictEqual(response.type, undefined);
    assert.strictEqual(response.status, 'ok');
    assert.strictEqual(response.claimId, claim.claimId);

    const journal = createDiscordCoordJournal();
    journal.append(DISCORD_REQUEST, request, { direction: 'out' });
    journal.append(DISCORD_CLAIM, claim, { direction: 'out', signer: 'pubkey-a' });
    journal.append(DISCORD_RESPONSE, response, { direction: 'out', signer: 'pubkey-a' });

    const tree = journal.treeFor(request.requestId);
    assert.strictEqual(tree.type, 'DiscordSequenceTree');
    assert.strictEqual(tree.requestId, request.requestId);
    assert.strictEqual(tree.nodes.length, 3);
    assert.strictEqual(tree.winningClaim.claimId, claim.claimId);
    assert.strictEqual(tree.responses.length, 1);

    const seeded = buildDiscordSequenceTree(request.requestId, [
      { type: DISCORD_REQUEST, object: request, ts: request.createdAt },
      { type: DISCORD_CLAIM, object: claim, ts: claim.claimedAt }
    ]);
    assert.strictEqual(seeded.nodes.length, 2);
  });
});
