'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  searchCorpus,
  buildHits,
  applySearchHit,
  CHAT_CHANNEL_KEY,
  CHAT_PEOPLE_KEY,
  GROUPS_ROSTER_KEY
} = require('../../functions/appSearch');
const groupDataSync = require('../../functions/groupDataSync');

const ALICE_PK = '02' + 'aa'.repeat(32);

describe('appSearch', () => {
  const corpus = {
    catalog: {
      guilds: [{
        id: 'g1',
        name: 'Fleet Ops',
        members: [
          { id: 'u1', displayName: 'Cara', username: 'cara' },
          { id: 'u2', displayName: 'Alice', username: 'alice' }
        ],
        channels: [{ id: 'c1', name: 'general' }]
      }],
      identityLinks: [{ discordUserId: 'u2', pubkey: ALICE_PK, username: 'alice' }]
    },
    discordMessages: [{
      discordMessageId: 'm1',
      channelId: 'c1',
      handle: 'Cara',
      body: 'Need a gunner tonight'
    }],
    notes: [{
      id: 'n1',
      subject: 'discord:u1',
      subjectHandle: 'Cara',
      body: 'Nights-only gunner',
      visibility: 'private'
    }],
    groups: [{ id: 'grp1', name: 'Starjump', members: [ALICE_PK], visibility: 'public' }],
    localTags: [{ id: 'tag1', name: 'Hangar' }],
    missions: [{ id: 'ms1', title: 'Bounty sweep', status: 'open', type: 'bounty' }],
    fleets: [{ id: 'fl1', name: 'Permafleet', shipCount: 3 }],
    peers: [{ pubkey: ALICE_PK, alias: 'Neorion', address: '127.0.0.1:7777' }],
    playtimes: [{ pubkey: ALICE_PK, pack: groupDataSync.PACK_PROFILE_PLAYTIMES }]
  };

  it('finds people, notes, Discord packs, groups, and register rows', () => {
    const cara = searchCorpus(corpus, 'cara');
    assert.ok(cara.hits.some((h) => h.kind === 'person' && /cara/i.test(h.title)));
    const caraPerson = cara.hits.find((h) => h.kind === 'person' && /cara/i.test(h.title));
    assert.ok(caraPerson.href.includes('/profiles/'));
    assert.ok(caraPerson.href.includes(encodeURIComponent('discord:u1')));
    const noteHit = cara.hits.find((h) => h.kind === 'note');
    assert.ok(noteHit.href.includes('/collections/note/'));
    assert.ok(cara.hits.some((h) => h.kind === 'note' && /gunner/i.test(h.title)));
    assert.ok(cara.packs.some((p) => p.pack === groupDataSync.PACK_CHAT_CATALOG && p.indexed));

    const guild = searchCorpus(corpus, 'fleet ops');
    assert.ok(guild.hits.some((h) => h.kind === 'guild' && h.title === 'Fleet Ops'));
    const guildHit = guild.hits.find((h) => h.kind === 'guild');
    assert.ok(guildHit.href.includes('/collections/guild/'));
    assert.ok(guild.hits.some((h) => h.kind === 'channel' && h.channel === 'discord:c1'));
    const channelHit = guild.hits.find((h) => h.kind === 'channel');
    assert.ok(channelHit.href.includes('/collections/channel/'));

    const group = searchCorpus(corpus, 'starjump');
    assert.ok(group.hits.some((h) => h.kind === 'group' && h.href && h.href.includes('/groups/')));

    const mission = searchCorpus(corpus, 'bounty');
    assert.ok(mission.hits.some((h) => h.kind === 'mission' && h.href.includes('/missions/')));

    const empty = searchCorpus(corpus, '   ');
    assert.deepStrictEqual(empty.hits, []);
  });

  it('requires every keyword and ranks title matches first', () => {
    const hits = searchCorpus(corpus, 'nights gunner').hits;
    assert.ok(hits.length >= 1);
    assert.strictEqual(hits[0].kind, 'note');
    assert.strictEqual(searchCorpus(corpus, 'nights missing').hits.length, 0);
  });

  it('applies Chat channel / people and Groups local-tag side effects', () => {
    const session = new Map();
    const local = new Map();
    const storage = (map) => ({
      setItem: (k, v) => map.set(k, v),
      getItem: (k) => (map.has(k) ? map.get(k) : null)
    });
    const href = applySearchHit({
      kind: 'channel',
      channel: 'discord:c1',
      peopleQuery: 'Cara',
      rosterMode: 'local',
      href: null,
      hash: 'chat'
    }, storage(session), storage(local));
    assert.strictEqual(href, '#chat');
    assert.strictEqual(session.get(CHAT_CHANNEL_KEY), 'discord:c1');
    assert.strictEqual(session.get(CHAT_PEOPLE_KEY), 'Cara');
    assert.strictEqual(local.get(GROUPS_ROSTER_KEY), 'local');
  });

  it('indexes playtimes and peer aliases onto profile hrefs', () => {
    const hits = buildHits(corpus);
    assert.ok(hits.some((h) => h.kind === 'playtimes' && h.href.includes('/profiles/')));
    const peer = searchCorpus(corpus, 'neorion').hits.find((h) => h.kind === 'peer');
    assert.ok(peer);
    assert.ok(peer.href.includes('/profiles/'));
  });
});
