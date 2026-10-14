'use strict';

const test = require('node:test');
const assert = require('node:assert');

const chatLookup = require('../../functions/chatLookup');
const { matchSlashMenu } = require('../../functions/chatAttachment');

test('parseLookupCommand: /lookup and query', () => {
  assert.deepStrictEqual(chatLookup.parseLookupCommand('/lookup'), {
    isLookup: true,
    query: ''
  });
  assert.deepStrictEqual(chatLookup.parseLookupCommand('/lookup starjump'), {
    isLookup: true,
    query: 'starjump'
  });
  assert.strictEqual(chatLookup.parseLookupCommand('/lookupfoo'), null);
  assert.strictEqual(chatLookup.parseLookupCommand('lookup x'), null);
  assert.strictEqual(chatLookup.parseLookupCommand(null), null);
  assert.strictEqual(chatLookup.parseLookupCommand(''), null);
});

test('lookupRequestId is stable for same chatMessageId', () => {
  const a = chatLookup.lookupRequestId({
    channel: 'global',
    chatMessageId: 'msg-abc',
    query: 'ignored-when-id-present'
  });
  const b = chatLookup.lookupRequestId({
    channel: 'global',
    chatMessageId: 'msg-abc',
    query: 'different'
  });
  assert.strictEqual(a, b);
  assert.notStrictEqual(
    a,
    chatLookup.lookupRequestId({ channel: 'global', chatMessageId: 'msg-xyz' })
  );
});

test('queryLocalPublicListings: public groups only + player filter', () => {
  const out = chatLookup.queryLocalPublicListings({
    query: 'go',
    players: [
      { name: 'GoonPilot' },
      { name: 'Other' },
      { handle: 'go-handle' }
    ],
    groups: [
      { id: '1', name: 'Goon Wing', visibility: 'public', members: ['a', 'b'], slug: 'goon' },
      { id: '2', name: 'Secret Ops', visibility: 'private', members: ['a'] },
      { id: '3', name: 'Alpha', visibility: 'public', members: [], slug: 'alpha' }
    ],
    fleets: [
      { id: 'f1', name: 'Goon Fleet', visibility: 'public', shipCount: 3 },
      { id: 'f2', name: 'Hidden', visibility: 'private', shipCount: 9 }
    ],
    peers: [
      { alias: 'goon-relay', address: 'relay.goon.vc:7777' },
      { alias: 'other', address: 'x:1' }
    ],
    discordGuilds: [{ id: '1', name: 'GoonCitizen', memberCount: 10 }],
    discordUsers: [{ id: 'u1', displayName: 'GoonPilot', username: 'goon' }],
    localTags: [{ id: 't1', name: 'Goon Friends', members: ['a', 'b'] }],
    includeLocalTags: true
  });
  assert.strictEqual(out.players.length, 2);
  assert.ok(out.players.every((p) => /go/i.test(p.name)));
  assert.strictEqual(out.groups.length, 1);
  assert.strictEqual(out.groups[0].name, 'Goon Wing');
  assert.ok(out.groups.every((g) => g.visibility === 'public'));
  assert.strictEqual(out.fleets.length, 1);
  assert.strictEqual(out.fleets[0].name, 'Goon Fleet');
  assert.ok(out.peers.some((p) => p.alias === 'goon-relay'));
  assert.strictEqual(out.discordGuilds.length, 1);
  assert.ok(out.discordUsers.some((u) => u.name === 'GoonPilot'));
  assert.strictEqual(out.localTags.length, 1);
});

test('queryLocalPublicListings omits local tags unless includeLocalTags', () => {
  const hidden = chatLookup.queryLocalPublicListings({
    localTags: [{ id: 't1', name: 'Hangar intel', members: ['a'] }]
  });
  assert.deepStrictEqual(hidden.localTags, []);
  const shown = chatLookup.queryLocalPublicListings({
    localTags: [{ id: 't1', name: 'Hangar intel', members: ['a'] }],
    includeLocalTags: true
  });
  assert.strictEqual(shown.localTags.length, 1);
  assert.strictEqual(shown.localTags[0].name, 'Hangar intel');
});

test('formatLookupReply includes master report sections', () => {
  const text = chatLookup.formatLookupReply({ query: 'x' }, {
    query: 'x',
    players: [{ name: 'P1' }],
    groups: [{ name: 'G1', memberCount: 2 }],
    fleets: [{ name: 'F1', shipCount: 4 }],
    peers: [{ alias: 'peer1' }],
    discordGuilds: [{ name: 'Srv' }],
    discordUsers: [{ name: 'Disc' }],
    localTags: [{ name: 'Tag', memberCount: 1 }]
  });
  assert.match(text, /Lookup «x»/);
  assert.match(text, /Players \(1\): P1/);
  assert.match(text, /Public groups \(1\): G1 \[2\]/);
  assert.match(text, /Public fleets \(1\): F1 \[4 ships\]/);
  assert.match(text, /Peers \(1\): peer1/);
  assert.match(text, /Discord servers \(1\): Srv/);
  assert.match(text, /Discord users \(1\): Disc/);
  assert.match(text, /Local tags \(1\): Tag \[1\]/);
});

test('winningClaim: earliest claimedAt wins; pubkey tie-break', () => {
  const early = {
    claimId: '1',
    claimantPubkey: 'bb',
    claimedAt: '2026-01-01T00:00:02.000Z'
  };
  const late = {
    claimId: '2',
    claimantPubkey: 'aa',
    claimedAt: '2026-01-01T00:00:03.000Z'
  };
  assert.strictEqual(chatLookup.winningClaim(early, late), early);
  const sameT = {
    claimId: '3',
    claimantPubkey: 'aa',
    claimedAt: '2026-01-01T00:00:02.000Z'
  };
  assert.strictEqual(chatLookup.winningClaim(early, sameT), sameT);
});

test('coord journal: first claim wins tree', () => {
  const journal = chatLookup.createLookupCoordJournal({ capacity: 50 });
  const request = chatLookup.buildLookupRequest({
    channel: 'global',
    query: 'x',
    chatMessageId: 'm1'
  });
  journal.append(chatLookup.LOOKUP_REQUEST, request);
  const c1 = chatLookup.buildLookupClaim(request, 'pubkey-b', {
    claimedAt: '2026-06-01T12:00:00.100Z'
  });
  const c2 = chatLookup.buildLookupClaim(request, 'pubkey-a', {
    claimedAt: '2026-06-01T12:00:00.050Z'
  });
  journal.append(chatLookup.LOOKUP_CLAIM, c1);
  journal.append(chatLookup.LOOKUP_CLAIM, c2);
  const win = journal.getWinningClaim(request.requestId);
  assert.strictEqual(win.claimantPubkey, 'pubkey-a');
  const tree = journal.treeFor(request.requestId);
  assert.strictEqual(tree.winningClaim.claimId, c2.claimId);
});

test('formatLookupReply lists players and groups', () => {
  const text = chatLookup.formatLookupReply(
    { query: 'go' },
    {
      query: 'go',
      players: [{ name: 'GoonPilot' }],
      groups: [{ name: 'Goon Wing', memberCount: 2 }]
    }
  );
  assert.match(text, /Lookup «go»/);
  assert.match(text, /GoonPilot/);
  assert.match(text, /Goon Wing \[2\]/);
});

test('slash menu includes /lookup', () => {
  const hits = matchSlashMenu('/look');
  assert.ok(hits.some((c) => c.cmd === '/lookup' && c.action === 'lookup'));
});
