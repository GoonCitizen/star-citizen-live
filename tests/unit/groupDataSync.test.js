'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const sync = require('../../functions/groupDataSync');

describe('groupDataSync', () => {
  it('builds GroupDataShare packs and drops unknown pack types', () => {
    const share = sync.buildShare({
      groupId: 'grp1',
      sourceAppId: 'app-9',
      packs: [
        {
          pack: 'future.other-bot',
          payload: { anything: true }
        },
        {
          pack: sync.PACK_DISCORD_CATALOG,
          payload: {
            guilds: [{
              id: 'g1',
              name: 'Fleet Ops',
              memberCount: 3,
              channels: [{ id: 'c1', name: 'general', type: 0, position: 0 }],
              members: [{ id: 'u1', username: 'alice', displayName: 'Alice', bot: false }]
            }]
          }
        },
        {
          pack: sync.PACK_DISCORD_MESSAGES,
          payload: {
            channels: [{
              channelId: 'c1',
              guildId: 'g1',
              messages: [{
                discordMessageId: 'm1',
                channelId: 'c1',
                authorId: 'u1',
                handle: 'alice',
                body: 'o7 from Discord',
                ts: '2026-08-12T12:00:00.000Z'
              }]
            }]
          }
        }
      ]
    });
    assert.ok(share);
    assert.strictEqual(share.type, sync.SHARE_TYPE);
    assert.strictEqual(share.groupId, 'grp1');
    assert.strictEqual(share.sourceAppId, 'app-9');
    assert.strictEqual(share.packs.length, 2);
    assert.strictEqual(share.packs[0].pack, sync.PACK_CHAT_CATALOG);
    assert.strictEqual(share.packs[0].platform, 'discord');
    assert.strictEqual(share.packs[1].pack, sync.PACK_CHAT_MESSAGES);
    assert.strictEqual(share.packs[1].platform, 'discord');
    assert.ok(!share.packs.some((p) => p.pack === 'future.other-bot'));
    assert.strictEqual(sync.canonicalPack(sync.PACK_DISCORD_CATALOG), sync.PACK_CHAT_CATALOG);
  });

  it('wraps legacy DiscordCatalogShare as a chat.catalog pack', () => {
    const wrapped = sync.sanitizeShare({
      type: 'DiscordCatalogShare',
      groupId: 'grp1',
      guilds: [{
        id: 'g-peer',
        name: 'Peer Guild',
        memberCount: 9,
        channels: [{ id: 'c-ops', name: 'ops', type: 0, position: 0 }],
        members: [{ id: 'u1', username: 'alice', displayName: 'Alice', bot: false }]
      }]
    });
    assert.ok(wrapped);
    assert.strictEqual(wrapped.type, sync.SHARE_TYPE);
    assert.strictEqual(wrapped.packs.length, 1);
    assert.strictEqual(wrapped.packs[0].pack, sync.PACK_CHAT_CATALOG);
    assert.strictEqual(wrapped.packs[0].platform, 'discord');
    assert.strictEqual(wrapped.packs[0].payload.guilds[0].id, 'g-peer');
  });

  it('accepts an opt-in profile.playtimes pack', () => {
    const pubkey = '02' + 'ab'.repeat(32);
    const share = sync.buildShare({
      groupId: 'grp1',
      packs: [{
        pack: sync.PACK_PROFILE_PLAYTIMES,
        payload: {
          pubkey,
          cells: [{ d: 0, h: 20, n: 4 }, { d: 5, h: 21, n: 2 }]
        }
      }]
    });
    assert.ok(share);
    assert.strictEqual(share.packs.length, 1);
    assert.strictEqual(share.packs[0].pack, sync.PACK_PROFILE_PLAYTIMES);
    assert.strictEqual(share.packs[0].payload.pubkey, pubkey);
    assert.strictEqual(share.packs[0].payload.sampleCount, 6);
  });

  it('accepts an opt-in profile.files listing pack without blob bytes', () => {
    const pubkey = '02' + 'ab'.repeat(32);
    const share = sync.buildShare({
      groupId: 'grp1',
      packs: [{
        pack: sync.PACK_PROFILE_FILES,
        payload: {
          pubkey,
          files: [{
            id: 'aa'.repeat(32),
            name: 'build.dmg',
            size: 4096,
            published: true,
            purchasePriceSats: 4,
            blobs: [{ contentBase64: 'nope' }]
          }]
        }
      }]
    });
    assert.ok(share);
    assert.strictEqual(share.packs.length, 1);
    assert.strictEqual(share.packs[0].pack, sync.PACK_PROFILE_FILES);
    assert.strictEqual(share.packs[0].payload.pubkey, pubkey);
    assert.strictEqual(share.packs[0].payload.files[0].name, 'build.dmg');
    assert.ok(!share.packs[0].payload.files[0].blobs);
  });

  it('composes a world view from catalog + message stats + playtimes', () => {
    const view = sync.composeWorldView({
      catalog: {
        guilds: [{
          id: 'g1',
          name: 'Fleet Ops',
          truncated: true,
          sources: [{ via: 'bot', appId: 'app-1', observedAt: '2026-08-12T12:00:00.000Z' }]
        }],
        users: [{ id: 'u1' }],
        truncated: true
      },
      messageStats: [{
        channelId: 'c1',
        guildId: 'g1',
        count: 4,
        lastMessageAt: '2026-08-12T12:01:00.000Z'
      }],
      playtimes: [{ pubkey: '02aa' }],
      files: [{ pubkey: '02aa' }],
      sourceAppId: 'app-1',
      botReady: false
    });
    assert.strictEqual(view['@type'], 'WorldView');
    assert.strictEqual(view.botReady, false);
    assert.strictEqual(view.offline, true);
    const catalogPack = view.packs.find((p) => p.pack === sync.PACK_CHAT_CATALOG);
    const msgPack = view.packs.find((p) => p.pack === sync.PACK_CHAT_MESSAGES);
    const playPack = view.packs.find((p) => p.pack === sync.PACK_PROFILE_PLAYTIMES);
    const filesPack = view.packs.find((p) => p.pack === sync.PACK_PROFILE_FILES);
    assert.strictEqual(catalogPack.platform, 'discord');
    assert.strictEqual(catalogPack.guildCount, 1);
    assert.strictEqual(msgPack.messageCount, 4);
    assert.strictEqual(msgPack.latestAt, '2026-08-12T12:01:00.000Z');
    assert.strictEqual(playPack.profileCount, 1);
    assert.strictEqual(filesPack.profileCount, 1);
    assert.ok(view.sources.some((s) => s.appId === 'app-1'));
  });
});
