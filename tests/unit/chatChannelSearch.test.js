'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  channelMatchesQuery,
  filterChannels,
  filterDiscordGuildGroups
} = require('../../functions/chatChannelSearch');

describe('chatChannelSearch', () => {
  const fabric = [
    { key: 'global', label: 'Global', kind: 'global' },
    { key: 'group:g1', label: 'Starjump', kind: 'group', groupId: 'g1' },
    { key: 'dm:02aa', label: 'Neorion', kind: 'dm', peerPubkey: '02aa' }
  ];
  const discord = [
    {
      key: 'discord:c1',
      label: '#general',
      kind: 'discord',
      guildId: 'g1',
      guildName: 'Fleet Ops',
      channelId: 'c1'
    },
    {
      key: 'discord:c2',
      label: '#ops',
      kind: 'discord',
      guildId: 'g1',
      guildName: 'Fleet Ops',
      channelId: 'c2'
    },
    {
      key: 'discord:c3',
      label: '#lounge',
      kind: 'discord',
      guildId: 'g2',
      guildName: 'Social',
      channelId: 'c3'
    }
  ];

  it('matches label, kind, and guild name', () => {
    assert.equal(channelMatchesQuery(fabric[1], 'star'), true);
    assert.equal(channelMatchesQuery(fabric[0], 'dm'), false);
    assert.equal(channelMatchesQuery(discord[0], 'fleet'), true);
    assert.equal(channelMatchesQuery(discord[0], 'ops'), true); // guild Fleet Ops
  });

  it('filters fabric channels and keeps the active key', () => {
    const filtered = filterChannels(fabric, 'neo');
    assert.deepStrictEqual(filtered.map((c) => c.key), ['dm:02aa']);
    const kept = filterChannels(fabric, 'zzzz', { keepKey: 'global' });
    assert.deepStrictEqual(kept.map((c) => c.key), ['global']);
  });

  it('filters Discord guild groups; guild hit keeps all channels', () => {
    const groups = [
      { id: 'g1', name: 'Fleet Ops', channels: discord.slice(0, 2) },
      { id: 'g2', name: 'Social', channels: [discord[2]] }
    ];
    const byChannel = filterDiscordGuildGroups(groups, 'lounge');
    assert.strictEqual(byChannel.length, 1);
    assert.strictEqual(byChannel[0].channels.length, 1);
    assert.strictEqual(byChannel[0].channels[0].key, 'discord:c3');

    const byGuild = filterDiscordGuildGroups(groups, 'fleet');
    assert.strictEqual(byGuild.length, 1);
    assert.strictEqual(byGuild[0].channels.length, 2);

    assert.strictEqual(filterDiscordGuildGroups(groups, { kind: 'group' }).length, 0);
    assert.strictEqual(filterDiscordGuildGroups(groups, { kind: 'discord' }).length, 2);
  });

  it('filters fabric channels by kind criteria', () => {
    const groupsOnly = filterChannels(fabric, { kind: 'group' });
    assert.deepStrictEqual(groupsOnly.map((c) => c.key), ['group:g1']);
  });

  it('matches bridged rows on both group and discord chips', () => {
    const { channelMatchesKind } = require('../../functions/chatChannelSearch');
    const bridged = {
      key: 'group:g1',
      kind: 'group',
      bridged: true,
      platforms: ['fabric', 'discord']
    };
    assert.equal(channelMatchesKind(bridged, 'group'), true);
    assert.equal(channelMatchesKind(bridged, 'discord'), true);
    assert.equal(channelMatchesKind(bridged, 'dm'), false);
  });
});
