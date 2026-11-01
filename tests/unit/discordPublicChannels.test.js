'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const pub = require('../../functions/discordPublicChannels');

function fakeGuild (id) {
  return { id, roles: { everyone: { id } }, channels: { cache: new Map() } };
}

function fakeChannel (guild, { id, type = 0, nsfw = false, everyone = true }) {
  const channel = {
    id,
    type,
    nsfw,
    guild,
    permissionsFor: (role) => ({ has: (bit) => role === guild.roles.everyone && bit === pub.VIEW_CHANNEL && everyone })
  };
  guild.channels.cache.set(id, channel);
  return channel;
}

describe('discordPublicChannels', () => {
  it('passes only text / announcement channels @everyone can view', () => {
    const guild = fakeGuild('g1');
    assert.equal(pub.isPublicDiscordChannel(fakeChannel(guild, { id: '1' })), true);
    assert.equal(pub.isPublicDiscordChannel(fakeChannel(guild, { id: '2', type: 5 })), true);
    assert.equal(pub.isPublicDiscordChannel(fakeChannel(guild, { id: '3', everyone: false })), false, 'private');
    assert.equal(pub.isPublicDiscordChannel(fakeChannel(guild, { id: '4', nsfw: true })), false, 'age-restricted');
    assert.equal(pub.isPublicDiscordChannel(fakeChannel(guild, { id: '5', type: 2 })), false, 'voice chat');
    assert.equal(pub.isPublicDiscordChannel(fakeChannel(guild, { id: '6', type: 11 })), false, 'thread');
    assert.equal(pub.isPublicDiscordChannel({ id: '7', type: 0 }), false, 'no guild (DM)');
    assert.equal(pub.isPublicDiscordChannel(null), false);
    const throwing = fakeChannel(guild, { id: '8' });
    throwing.permissionsFor = () => { throw new Error('uncached'); };
    assert.equal(pub.isPublicDiscordChannel(throwing), false, 'fails closed');
  });

  it('collects public ids from a client and is empty without one', () => {
    const a = fakeGuild('g1');
    const b = fakeGuild('g2');
    fakeChannel(a, { id: '10' });
    fakeChannel(a, { id: '11', everyone: false });
    fakeChannel(b, { id: '20', type: 5 });
    const ids = pub.publicDiscordChannelIds({ guilds: { cache: new Map([['g1', a], ['g2', b]]) } });
    assert.deepEqual(Array.from(ids).sort(), ['10', '20']);
    assert.equal(pub.publicDiscordChannelIds(null).size, 0);
  });

  it('narrows catalog guilds to public channels and drops the rest', () => {
    const ids = new Set(['10']);
    const out = pub.publicCatalogGuilds([
      { id: 'g1', name: 'Home', members: [{ id: 'u1' }], channels: [{ id: '10', name: 'general' }, { id: '11', name: 'officers' }] },
      { id: 'g2', name: 'Learned from gossip', channels: [{ id: '30', name: 'ops' }] },
      { id: 'g3', name: 'No channels' }
    ], ids);
    assert.deepEqual(out.map((g) => g.id), ['g1']);
    assert.deepEqual(out[0].channels.map((c) => c.name), ['general']);
  });

  it('keeps Fabric chat, public Discord channels only, and never DMs', () => {
    const ids = new Set(['10']);
    const keep = (row) => pub.isShareableChatRow(row, ids);
    assert.equal(keep({ channel: 'global' }), true);
    assert.equal(keep({ channel: 'group:abc', discordMessageId: '99' }), true, 'own post to a bridged group');
    assert.equal(keep({ channel: 'discord:10' }), true);
    assert.equal(keep({ channel: 'discord:11' }), false, 'private guild channel');
    assert.equal(keep({ channel: 'discord:dm:123456789012' }), false);
    assert.equal(keep({ channel: 'discord:10', kind: 'discord-dm' }), false);
    assert.equal(keep(null), false);
  });
});
