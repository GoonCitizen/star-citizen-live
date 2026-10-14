'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { createIdentity, pubkeyXOnly } = require('../../functions/identity');
const {
  filterMembers,
  mergePeopleDirectory,
  searchPeople,
  commonDiscordGuilds,
  commonFabricGroups,
  peopleFromDiscordCatalog,
  canonicalPersonKey
} = require('../../functions/chatPeopleSearch');

const ALICE_PK = '02' + 'aa'.repeat(32);
const BOB_PK = '02' + 'bb'.repeat(32);

describe('chatPeopleSearch', () => {
  it('filters channel members by handle and pubkey', () => {
    const members = [
      { pubkey: ALICE_PK, handle: 'Alice' },
      { pubkey: BOB_PK, handle: 'Bob' }
    ];
    assert.deepStrictEqual(filterMembers(members, 'ali').map((m) => m.handle), ['Alice']);
    assert.strictEqual(filterMembers(members, 'nope').length, 0);
    assert.strictEqual(filterMembers(members, '').length, 2);
  });

  it('merges Discord catalog and Federation groups into a directory', () => {
    const catalog = {
      guilds: [{
        id: 'g1',
        name: 'Fleet Ops',
        members: [
          { id: 'u1', displayName: 'Alice', username: 'alice' },
          { id: 'u2', displayName: 'Cara', username: 'cara' }
        ]
      }],
      identityLinks: [{ discordUserId: 'u1', pubkey: ALICE_PK, username: 'alice' }]
    };
    const groups = [{
      id: 'grp1',
      name: 'Starjump',
      members: [ALICE_PK, BOB_PK]
    }];
    const dir = mergePeopleDirectory({ catalog, groups });
    const alice = dir.find((p) => canonicalPersonKey(p.pubkey) === canonicalPersonKey(ALICE_PK));
    assert.ok(alice);
    assert.strictEqual(alice.linked, true);
    assert.ok(alice.guildNames.includes('Fleet Ops'));
    assert.ok(alice.groupNames.includes('Starjump'));
    assert.ok(dir.some((p) => p.pubkey === 'discord:u2'));
    assert.ok(dir.some((p) => p.pubkey === BOB_PK && p.groupNames.includes('Starjump')));
  });

  it('searches the directory excluding people already on the rail', () => {
    const catalog = {
      guilds: [{
        id: 'g1',
        name: 'Fleet Ops',
        members: [
          { id: 'u1', displayName: 'Alice' },
          { id: 'u2', displayName: 'Cara' }
        ]
      }]
    };
    const dir = peopleFromDiscordCatalog(catalog);
    const hits = searchPeople(dir, 'cara', { exclude: ['discord:u1'] });
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].handle, 'Cara');
    assert.strictEqual(searchPeople(dir, '').length, 0);
  });

  it('lists common Discord servers and Fabric groups', () => {
    const catalog = {
      guilds: [
        {
          id: 'g1',
          name: 'Fleet Ops',
          members: [
            { id: 'u1', displayName: 'Alice' },
            { id: 'u2', displayName: 'Bob' }
          ]
        },
        {
          id: 'g2',
          name: 'Social',
          members: [{ id: 'u1', displayName: 'Alice' }]
        }
      ],
      identityLinks: [
        { discordUserId: 'u1', pubkey: ALICE_PK, username: 'alice' },
        { discordUserId: 'u2', pubkey: BOB_PK, username: 'bob' }
      ]
    };
    const shared = commonDiscordGuilds(catalog, ALICE_PK, BOB_PK);
    assert.deepStrictEqual(shared.map((g) => g.name), ['Fleet Ops']);
    const aliceOnly = commonDiscordGuilds(catalog, ALICE_PK, ALICE_PK);
    assert.strictEqual(aliceOnly.length, 2);

    const groups = [
      { id: 'grp1', name: 'Starjump', members: [ALICE_PK, BOB_PK] },
      { id: 'grp2', name: 'Wing', members: [ALICE_PK] }
    ];
    const common = commonFabricGroups(groups, ALICE_PK, BOB_PK);
    assert.deepStrictEqual(common.map((g) => g.name), ['Starjump']);
    assert.strictEqual(commonFabricGroups(groups, ALICE_PK, ALICE_PK).length, 2);
  });

  it('matches compressed and x-only Fabric ids in group overlap', () => {
    const alice = createIdentity();
    const bob = createIdentity();
    const groups = [{
      id: 'grp1',
      name: 'Starjump',
      members: [{ pubkey: alice.pubkey }, bob.pubkey]
    }];
    const shared = commonFabricGroups(groups, pubkeyXOnly(alice.pubkey), bob.pubkey);
    assert.deepStrictEqual(shared.map((g) => g.name), ['Starjump']);
  });
});
