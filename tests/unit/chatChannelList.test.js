'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  flattenChatChannels,
  bridgeForChannel,
  channelRowMatchesKey,
  pickKeyForRow
} = require('../../functions/chatChannelList');

describe('chatChannelList', () => {
  const fabric = [
    { key: 'global', label: 'Global', kind: 'global' },
    { key: 'group:g1', label: 'Starjump', kind: 'group', groupId: 'g1' }
  ];
  const discord = [
    {
      key: 'discord:c1',
      label: '#general',
      kind: 'discord',
      guildId: 'guild1',
      guildName: 'Fleet Ops',
      channelId: 'c1',
      bot: { view: true, send: false }
    },
    {
      key: 'discord:c2',
      label: '#ops',
      kind: 'discord',
      guildId: 'guild1',
      guildName: 'Fleet Ops',
      channelId: 'c2'
    }
  ];
  const groups = [{
    id: 'g1',
    name: 'Starjump',
    pinnedChannels: ['discord:c1']
  }];

  it('flattens Fabric and Discord into one list', () => {
    const rows = flattenChatChannels({
      fabricChannels: fabric,
      discordChannels: discord
    });
    assert.deepStrictEqual(rows.map((r) => r.key), [
      'global',
      'group:g1',
      'discord:c1',
      'discord:c2'
    ]);
    assert.deepStrictEqual(rows[0].platforms, ['fabric']);
    assert.deepStrictEqual(rows[2].platforms, ['discord']);
    assert.strictEqual(rows[2].bridged, false);
  });

  it('merges a group-pinned Discord channel onto the Fabric group row', () => {
    const rows = flattenChatChannels({
      fabricChannels: fabric,
      discordChannels: discord,
      groups
    });
    const group = rows.find((r) => r.key === 'group:g1');
    assert.ok(group.bridged);
    assert.deepStrictEqual(group.platforms, ['fabric', 'discord']);
    assert.strictEqual(group.discordKey, 'discord:c1');
    assert.strictEqual(group.guildName, 'Fleet Ops');
    assert.deepStrictEqual(group.bot, { view: true, send: false });
    assert.ok(!rows.some((r) => r.key === 'discord:c1'));
    assert.ok(rows.some((r) => r.key === 'discord:c2'));
  });

  it('bridgeForChannel maps both directions', () => {
    const fromGroup = bridgeForChannel('group:g1', groups);
    assert.strictEqual(fromGroup.bridged, true);
    assert.strictEqual(fromGroup.discordKey, 'discord:c1');
    const fromDiscord = bridgeForChannel('discord:c1', groups);
    assert.strictEqual(fromDiscord.bridged, true);
    assert.strictEqual(fromDiscord.fabricKey, 'group:g1');
    const lone = bridgeForChannel('discord:c2', groups);
    assert.strictEqual(lone.bridged, false);
  });

  it('pickKeyForRow opens the Fabric key for bridged rows', () => {
    const rows = flattenChatChannels({
      fabricChannels: fabric,
      discordChannels: discord,
      groups
    });
    const group = rows.find((r) => r.key === 'group:g1');
    assert.strictEqual(pickKeyForRow(group), 'group:g1');
    assert.ok(channelRowMatchesKey(group, 'discord:c1'));
    assert.ok(channelRowMatchesKey(group, 'group:g1'));
  });
});
