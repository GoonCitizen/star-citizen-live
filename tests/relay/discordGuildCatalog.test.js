'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  channelCanAnnounce,
  serializeChannel,
  serializeGuild,
  serializeMember,
  serializeMessage,
  serializeMessages,
  buildDiscordGuildCatalog,
  refreshDiscordCaches,
  chatChannelsFromCatalog,
  parseDiscordChatChannel,
  discordChatChannelKey
} = require('../../functions/discordGuildCatalog');

function makeCache (items) {
  return {
    values () { return items[Symbol.iterator](); }
  };
}

describe('discordGuildCatalog', () => {
  it('marks text and announcement channels as announceable', () => {
    assert.strictEqual(channelCanAnnounce(0), true);
    assert.strictEqual(channelCanAnnounce(5), true);
    assert.strictEqual(channelCanAnnounce(2), false);
    assert.strictEqual(channelCanAnnounce(4), false);
  });

  it('serializes guild channels sorted by position then name', () => {
    const guild = {
      id: 'g1',
      name: 'Fleet Ops',
      icon: null,
      memberCount: 12,
      channels: {
        cache: makeCache([
          { id: 'c2', name: 'bravo', type: 0, position: 2, parentId: null },
          { id: 'c1', name: 'alpha', type: 0, position: 1, parentId: null },
          { id: 'v1', name: 'voice', type: 2, position: 0, parentId: null }
        ])
      }
    };
    const row = serializeGuild(guild);
    assert.strictEqual(row.id, 'g1');
    assert.strictEqual(row.channels.length, 3);
    assert.deepStrictEqual(row.channels.map((c) => c.id), ['v1', 'c1', 'c2']);
    assert.strictEqual(row.channels[1].canAnnounce, true);
    assert.strictEqual(row.channels[1].chatInsight, true);
    assert.strictEqual(row.channels[0].canAnnounce, false);
    assert.strictEqual(row.channels[0].chatInsight, false);
    assert.strictEqual(row.channels[0].typeName, 'voice');
    assert.deepStrictEqual(row.members, []);
  });

  it('serializes bot view/send bits from permissionsFor', () => {
    const row = serializeChannel({
      id: 'c1',
      name: 'general',
      type: 0,
      position: 0,
      guild: { members: { me: { id: 'bot' } } },
      permissionsFor () {
        return {
          has (name) {
            return name === 'ViewChannel';
          }
        };
      }
    });
    assert.strictEqual(row.bot.view, true);
    assert.strictEqual(row.bot.send, false);
  });

  it('buildDiscordGuildCatalog returns empty when bot not ready / no client', () => {
    const empty = buildDiscordGuildCatalog(null, { botReady: false, selectedChannelId: 'x' });
    assert.strictEqual(empty.botReady, false);
    assert.strictEqual(empty.selectedChannelId, 'x');
    assert.deepStrictEqual(empty.guilds, []);
    assert.strictEqual(empty.error, 'bot_not_ready');
  });

  it('buildDiscordGuildCatalog enumerates guilds from client cache', () => {
    const client = {
      guilds: {
        cache: makeCache([
          {
            id: 'g2',
            name: 'Beta',
            channels: { cache: makeCache([{ id: 't1', name: 'general', type: 0, position: 0 }]) }
          },
          {
            id: 'g1',
            name: 'Alpha',
            channels: { cache: makeCache([{ id: 'a1', name: 'announce', type: 5, position: 0 }]) }
          }
        ])
      }
    };
    const cat = buildDiscordGuildCatalog(client, {
      botReady: true,
      botUser: 'GoonBot#0001',
      selectedChannelId: 'a1'
    });
    assert.strictEqual(cat.botReady, true);
    assert.strictEqual(cat.botUser, 'GoonBot#0001');
    assert.strictEqual(cat.error, null);
    assert.deepStrictEqual(cat.guilds.map((g) => g.name), ['Alpha', 'Beta']);
    assert.strictEqual(cat.guilds[0].channels[0].typeName, 'announcement');
    assert.deepStrictEqual(cat.users, []);
    assert.strictEqual(serializeChannel(null), null);
  });

  it('serializes members and unique users across guilds', () => {
    const alice = {
      id: 'u1',
      displayName: 'Alice',
      user: { id: 'u1', username: 'alice', bot: false }
    };
    const bot = {
      id: 'b1',
      displayName: 'GoonBot',
      user: { id: 'b1', username: 'GoonBot', bot: true }
    };
    const guild = {
      id: 'g1',
      name: 'Ops',
      channels: { cache: makeCache([{ id: 'c1', name: 'general', type: 0, position: 0 }]) },
      members: { cache: makeCache([bot, alice]) }
    };
    const row = serializeGuild(guild);
    assert.deepStrictEqual(row.members.map((m) => m.id), ['u1', 'b1']);
    assert.strictEqual(row.members[0].displayName, 'Alice');
    assert.strictEqual(row.members[1].bot, true);
    const cat = buildDiscordGuildCatalog({ guilds: { cache: makeCache([guild]) } }, { botReady: true });
    assert.strictEqual(cat.users.length, 2);
    assert.ok(cat.users.some((u) => u.id === 'u1' && u.username === 'alice'));
  });

  it('refreshDiscordCaches fetches guilds, channels, and bounded members', async () => {
    const members = [
      { id: 'u1', user: { id: 'u1', username: 'alice' } }
    ];
    const channels = [{ id: 'c1', name: 'general', type: 0, position: 0 }];
    let guildsFetch = 0;
    let channelsFetch = 0;
    let membersList = 0;
    const guild = {
      id: 'g1',
      name: 'Ops',
      channels: {
        cache: makeCache(channels),
        async fetch () { channelsFetch += 1; }
      },
      members: {
        cache: makeCache(members),
        async list (opts) {
          membersList += 1;
          assert.strictEqual(opts.limit, 50);
        }
      }
    };
    const client = {
      guilds: {
        cache: makeCache([guild]),
        async fetch () { guildsFetch += 1; }
      }
    };
    const sync = await refreshDiscordCaches(client, { memberLimit: 50 });
    assert.strictEqual(sync.ok, true);
    assert.strictEqual(guildsFetch, 1);
    assert.strictEqual(channelsFetch, 1);
    assert.strictEqual(membersList, 1);
    assert.strictEqual(sync.guildsFetched, 1);
    assert.strictEqual(sync.membersFetched, 1);
  });

  it('chatChannelsFromCatalog only includes text insight channels', () => {
    const cat = buildDiscordGuildCatalog({
      guilds: {
        cache: makeCache([{
          id: 'g1',
          name: 'Ops',
          channels: {
            cache: makeCache([
              { id: 't1', name: 'general', type: 0, position: 0 },
              { id: 'v1', name: 'voice', type: 2, position: 1 }
            ])
          }
        }])
      }
    }, { botReady: true });
    const rows = chatChannelsFromCatalog(cat);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].key, discordChatChannelKey('t1'));
    assert.strictEqual(rows[0].kind, 'discord');
    assert.strictEqual(rows[0].guildName, 'Ops');
    assert.strictEqual(parseDiscordChatChannel(rows[0].key), 't1');
    assert.strictEqual(parseDiscordChatChannel('global'), null);
  });

  it('serializeMessages sorts by timestamp into Chat-shaped rows', () => {
    const rows = serializeMessages([
      {
        id: 'm2',
        content: 'later',
        channelId: 'c1',
        createdTimestamp: 2000,
        author: { id: 'u1', username: 'alice' }
      },
      {
        id: 'm1',
        content: 'first',
        channelId: 'c1',
        createdTimestamp: 1000,
        author: { id: 'u2', username: 'bob', bot: true }
      }
    ]);
    assert.deepStrictEqual(rows.map((m) => m.body), ['first', 'later']);
    assert.strictEqual(rows[0].kind, 'discord');
    assert.strictEqual(rows[0].author, 'discord:u2');
    assert.strictEqual(rows[0].bot, true);
    assert.strictEqual(serializeMessage(null), null);
    assert.strictEqual(serializeMember(null), null);
  });
});
