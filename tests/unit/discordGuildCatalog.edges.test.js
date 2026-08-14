'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  collectionValues,
  serializeMember,
  serializeGuild,
  serializeChannel,
  refreshDiscordCaches,
  channelIsChatInsight,
  parseDiscordChatChannel,
  discordChatChannelKey
} = require('../../functions/discordGuildCatalog');

function makeCache (items) {
  return {
    values () { return items[Symbol.iterator](); }
  };
}

describe('discordGuildCatalog edges', () => {
  it('collectionValues reads arrays, caches, and managers', () => {
    assert.deepStrictEqual(collectionValues(null), []);
    assert.deepStrictEqual(collectionValues([1, 2]), [1, 2]);
    assert.deepStrictEqual(collectionValues(makeCache(['a'])), ['a']);
    assert.deepStrictEqual(collectionValues({ cache: makeCache(['b']) }), ['b']);
  });

  it('serializeMember accepts GuildMember or User-shaped objects', () => {
    const fromMember = serializeMember({
      id: 'u1',
      displayName: 'Alice',
      user: { id: 'u1', username: 'alice', bot: false, avatar: 'aa' },
      presence: { status: 'online' }
    });
    assert.strictEqual(fromMember.displayName, 'Alice');
    assert.strictEqual(fromMember.status, 'online');
    assert.strictEqual(fromMember.avatar, 'aa');
    const fromUser = serializeMember({ id: 'u2', username: 'bob', bot: true });
    assert.strictEqual(fromUser.username, 'bob');
    assert.strictEqual(fromUser.bot, true);
    assert.strictEqual(serializeMember({}), null);
  });

  it('serializeGuild caps members and prefers guild.memberCount', () => {
    const members = [];
    for (let i = 0; i < 12; i++) {
      members.push({ id: 'u' + i, user: { id: 'u' + i, username: 'user' + String(i).padStart(2, '0') } });
    }
    const row = serializeGuild({
      id: 'g1',
      name: 'Ops',
      memberCount: 400,
      channels: { cache: makeCache([{ id: 'c1', name: 'general', type: 0, position: 0 }]) },
      members: { cache: makeCache(members) }
    }, { memberLimit: 5 });
    assert.strictEqual(row.members.length, 5);
    assert.strictEqual(row.memberCount, 400);
    assert.strictEqual(row.channels[0].chatInsight, true);
  });

  it('refreshDiscordCaches falls back to members.fetch and records errors', async () => {
    const guildOk = {
      id: 'g1',
      channels: {
        cache: makeCache([]),
        async fetch () {}
      },
      members: {
        cache: makeCache([{ id: 'u1', user: { id: 'u1', username: 'a' } }]),
        async fetch () {}
      }
    };
    const guildBad = {
      id: 'g2',
      channels: {
        cache: makeCache([]),
        async fetch () { throw new Error('channels down'); }
      },
      members: {
        cache: makeCache([]),
        async list () { throw new Error('privileged intent'); }
      }
    };
    const client = {
      guilds: {
        cache: makeCache([guildOk, guildBad]),
        async fetch () {}
      }
    };
    const sync = await refreshDiscordCaches(client, { memberLimit: 10 });
    assert.strictEqual(sync.ok, false);
    assert.ok(sync.errors.some((e) => e.scope === 'channels' && e.guildId === 'g2'));
    assert.ok(sync.errors.some((e) => e.scope === 'members' && e.guildId === 'g2'));
    assert.strictEqual(sync.guildsFetched, 2);
  });

  it('refreshDiscordCaches without a client is a closed failure', async () => {
    const sync = await refreshDiscordCaches(null);
    assert.strictEqual(sync.ok, false);
    assert.strictEqual(sync.error, 'no_client');
  });

  it('channel insight helpers', () => {
    assert.strictEqual(channelIsChatInsight(0), true);
    assert.strictEqual(channelIsChatInsight(5), true);
    assert.strictEqual(channelIsChatInsight(2), false);
    assert.strictEqual(parseDiscordChatChannel(discordChatChannelKey(' 99 ')), '99');
    assert.strictEqual(serializeChannel({ id: 'x', name: 'n', type: 15 }).typeName, 'forum');
  });

  it('filterCatalogGuilds matches channel, guild, and user names', () => {
    const { filterCatalogGuilds } = require('../../functions/discordGuildCatalog');
    const guilds = [
      {
        id: 'g1',
        name: 'Fleet Ops',
        channels: [
          { id: 'c1', name: 'general', type: 0, typeName: 'text', canAnnounce: true },
          { id: 'c2', name: 'voice-bridge', type: 2, typeName: 'voice', canAnnounce: false }
        ],
        members: [{ id: 'u1', displayName: 'Alice', username: 'alice' }]
      },
      {
        id: 'g2',
        name: 'Social',
        channels: [{ id: 'c3', name: 'lounge', type: 0, typeName: 'text', canAnnounce: true }],
        members: [{ id: 'u2', displayName: 'Bob', username: 'bob' }]
      }
    ];
    const byChannel = filterCatalogGuilds(guilds, 'lounge');
    assert.strictEqual(byChannel.length, 1);
    assert.strictEqual(byChannel[0].id, 'g2');
    assert.strictEqual(byChannel[0].channels.length, 1);

    const byGuild = filterCatalogGuilds(guilds, 'fleet');
    assert.strictEqual(byGuild.length, 1);
    assert.strictEqual(byGuild[0].channels.length, 2);

    const byUser = filterCatalogGuilds(guilds, 'alice');
    assert.strictEqual(byUser.length, 1);
    assert.ok(byUser[0].members.some((m) => m.username === 'alice'));

    assert.strictEqual(filterCatalogGuilds(guilds, 'zzzz').length, 0);
    assert.strictEqual(filterCatalogGuilds(guilds, '').length, 2);
  });
});
