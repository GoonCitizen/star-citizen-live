'use strict';

function makeCache (items) {
  return {
    values () { return items[Symbol.iterator](); },
    map (fn) { return items.map(fn); }
  };
}

/**
 * discord.js-shaped client stub for LiveRelay catalog / insight tests.
 * @param {Object} [opts]
 * @returns {object}
 */
function stubDiscordBot (opts = {}) {
  const members = opts.members || [
    { id: 'u1', displayName: 'Alice', user: { id: 'u1', username: 'alice', bot: false } },
    { id: 'b1', displayName: 'GoonBot', user: { id: 'b1', username: 'GoonBot', bot: true } }
  ];
  const channels = opts.channels || [
    { id: 'c1', name: 'general', type: 0, position: 0, parentId: null },
    { id: 'v1', name: 'voice', type: 2, position: 1, parentId: null }
  ];
  const messages = opts.messages || [
    {
      id: 'm1',
      content: 'o7 from Discord',
      channelId: 'c1',
      createdTimestamp: Date.parse('2026-08-12T12:00:00.000Z'),
      author: { id: 'u1', username: 'alice', bot: false }
    }
  ];
  const stats = {
    guildsFetch: 0,
    channelsFetch: 0,
    membersList: 0,
    messagesFetch: 0,
    posted: [],
    dms: []
  };
  const guild = {
    id: 'g1',
    name: 'Fleet Ops',
    icon: null,
    memberCount: members.length,
    channels: {
      cache: makeCache(channels),
      async fetch () {
        stats.channelsFetch += 1;
        return makeCache(channels);
      }
    },
    members: {
      cache: makeCache(members),
      async list () {
        stats.membersList += 1;
        return makeCache(members);
      }
    }
  };
  const client = {
    isReady () { return true; },
    user: { id: 'b1', tag: 'GoonBot#0001', username: 'GoonBot', bot: true },
    guilds: {
      cache: makeCache([guild]),
      async fetch () {
        stats.guildsFetch += 1;
        return makeCache([guild]);
      }
    },
    users: {
      async fetch (userId) {
        const id = String(userId);
        return {
          id,
          async createDM () {
            return {
              id: 'dmch-' + id,
              async send (payload) {
                const row = {
                  channelId: 'dmch-' + id,
                  userId: id,
                  payload,
                  id: 'dm-posted-1'
                };
                stats.dms.push(row);
                stats.posted.push(row);
                return row;
              }
            };
          }
        };
      }
    },
    channels: {
      async fetch (id) {
        if (String(id) !== 'c1') throw new Error('unknown channel');
        return {
          id: 'c1',
          name: 'general',
          type: 0,
          guildId: 'g1',
          messages: {
            async fetch () {
              stats.messagesFetch += 1;
              return makeCache(messages);
            }
          }
        };
      }
    }
  };
  return {
    client,
    stats,
    async syncGuilds () { this._synced = true; },
    async postToChannel (channelId, payload) {
      const row = { channelId: String(channelId), payload, id: 'posted-1' };
      stats.posted.push(row);
      return row;
    }
  };
}

module.exports = {
  makeCache,
  stubDiscordBot
};
