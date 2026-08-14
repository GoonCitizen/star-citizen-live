'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { Store } = require('../../types/Store');
const acc = require('../../functions/discordCatalogAccumulate');

describe('discordCatalogAccumulate', () => {
  it('unions members across snapshots and never shrinks memberCount', () => {
    const store = new Store({ path: null });
    acc.foldGuilds(store, [{
      id: 'g1',
      name: 'Fleet Ops',
      memberCount: 12000,
      channels: [{ id: 'c1', name: 'general', type: 0, position: 0 }],
      members: [
        { id: 'u1', username: 'alice', displayName: 'Alice', bot: false }
      ]
    }], { via: 'bot' });
    acc.foldGuilds(store, [{
      id: 'g1',
      name: 'Fleet Ops',
      memberCount: 200,
      members: [
        { id: 'u2', username: 'bob', displayName: 'Bob', bot: false }
      ]
    }], { via: 'bot' });
    const [guild] = acc.loadAccumulatedGuilds(store);
    assert.strictEqual(guild.id, 'g1');
    assert.strictEqual(guild.memberCount, 12000);
    assert.strictEqual(guild.truncated, true);
    assert.ok(guild.members.some((m) => m.id === 'u1'));
    assert.ok(guild.members.some((m) => m.id === 'u2'));
    assert.ok(guild.channels.some((c) => c.id === 'c1'));
  });

  it('folds chat authors onto a known channel guild', () => {
    const store = new Store({ path: null });
    acc.foldGuilds(store, [{
      id: 'g1',
      name: 'Fleet Ops',
      channels: [{ id: 'c1', name: 'general', type: 0 }],
      members: []
    }], { via: 'bot' });
    const row = acc.foldObservation(store, {
      channelId: 'c1',
      authorId: 'u9',
      authorUsername: 'cara'
    });
    assert.ok(row);
    assert.ok(row.members.some((m) => m.id === 'u9' && m.username === 'cara'));
  });

  it('merges live bot catalog with stored gossip', () => {
    const stored = [{
      id: 'g-shared',
      name: 'Shared Org',
      memberCount: 40,
      source: 'gossip',
      channels: [{ id: 'cx', name: 'ops', type: 0, canAnnounce: true, chatInsight: true }],
      members: [{ id: 'u3', username: 'dee', displayName: 'Dee', bot: false }]
    }];
    const live = {
      botReady: true,
      guilds: [{
        id: 'g1',
        name: 'Local',
        memberCount: 2,
        channels: [],
        members: [{ id: 'u1', username: 'alice', displayName: 'Alice', bot: false }]
      }],
      users: [],
      error: null
    };
    const merged = acc.mergeLiveCatalog(live, stored);
    assert.strictEqual(merged.guilds.length, 2);
    assert.ok(merged.accumulated);
    assert.ok(merged.guilds.some((g) => g.id === 'g-shared'));
    assert.ok(merged.guilds.some((g) => g.id === 'g1'));
  });

  it('compacts shares and rejects payloads without a group', () => {
    assert.strictEqual(acc.buildShareObject({ guilds: [{ id: 'g1', name: 'A', members: [] }] }), null);
    const share = acc.buildShareObject({
      groupId: 'grp1',
      guilds: [{
        id: 'g1',
        name: 'Fleet Ops',
        memberCount: 500,
        channels: [{ id: 'c1', name: 'general', type: 0, position: 0 }],
        members: [{ id: 'u1', username: 'alice', displayName: 'Alice', bot: false }]
      }]
    });
    assert.ok(share);
    assert.strictEqual(share.type, acc.SHARE_TYPE);
    assert.strictEqual(share.groupId, 'grp1');
    assert.strictEqual(share.truncated, true);
    const clean = acc.sanitizeShareObject(share);
    assert.ok(clean);
    assert.strictEqual(clean.guilds[0].id, 'g1');
    assert.strictEqual(acc.sanitizeShareObject({ groupId: 'x', guilds: [] }), null);
  });

  it('reads guildId from activity-shaped blobs', () => {
    assert.strictEqual(acc.guildIdFromActivity(null), null);
    assert.strictEqual(acc.guildIdFromActivity({ guildId: 'g1' }), 'g1');
    assert.strictEqual(acc.guildIdFromActivity({ target: { guildId: 'g2' } }), 'g2');
    assert.strictEqual(acc.guildIdFromActivity({ target: { guild: { id: 'g3' } } }), 'g3');
  });

  it('accumulates channel messages without treating them as guilds', () => {
    const store = new Store({ path: null });
    acc.foldGuilds(store, [{
      id: 'g1',
      name: 'Fleet Ops',
      channels: [{ id: 'c1', name: 'general', type: 0 }],
      members: []
    }], { via: 'bot' });
    acc.foldMessages(store, [
      {
        discordMessageId: 'm1',
        channelId: 'c1',
        guildId: 'g1',
        authorId: 'u1',
        handle: 'alice',
        body: 'o7',
        ts: '2026-08-12T12:00:00.000Z'
      },
      {
        id: 'discord-msg:m2',
        channelId: 'c1',
        authorId: 'u1',
        body: 'still here',
        ts: '2026-08-12T12:01:00.000Z'
      }
    ]);
    const guilds = acc.loadAccumulatedGuilds(store);
    assert.strictEqual(guilds.length, 1);
    assert.strictEqual(guilds[0].id, 'g1');
    assert.ok(!guilds.some((g) => String(g.id).indexOf('channel:') === 0));
    const msgs = acc.loadAccumulatedMessages(store, 'c1');
    assert.strictEqual(msgs.length, 2);
    assert.strictEqual(msgs[0].body, 'o7');
    assert.strictEqual(msgs[1].discordMessageId, 'm2');
    const stats = acc.loadChannelMessageStats(store);
    assert.strictEqual(stats.length, 1);
    assert.strictEqual(stats[0].count, 2);
    const ch = guilds[0].channels.find((c) => c.id === 'c1');
    assert.ok(ch);
    assert.strictEqual(ch.messageCount, 2);
    const packed = acc.compactStoredMessagesForShare(store);
    assert.strictEqual(packed.channels.length, 1);
    assert.strictEqual(packed.channels[0].messages.length, 2);
  });
});
