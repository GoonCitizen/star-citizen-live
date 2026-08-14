'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, hasClass, findByClass } = require('../helpers/reactTree');
const { buildDiscordGuildCatalog } = require('../../functions/discordGuildCatalog');
const { makeCache } = require('../helpers/discordBotStub');
const DiscordChatSettings = require('../../components/DiscordChatSettings');

describe('DiscordChatSettings UI', () => {
  it('shows guilds, users, and the selected announce channel', () => {
    const catalog = buildDiscordGuildCatalog({
      guilds: {
        cache: makeCache([{
          id: 'g1',
          name: 'Fleet Ops',
          memberCount: 2,
          channels: {
            cache: makeCache([
              { id: 'c1', name: 'general', type: 0, position: 0 },
              { id: 'a1', name: 'announce', type: 5, position: 1 }
            ])
          },
          members: {
            cache: makeCache([
              { id: 'u1', displayName: 'Alice', user: { id: 'u1', username: 'alice' } },
              { id: 'b1', displayName: 'GoonBot', user: { id: 'b1', username: 'GoonBot', bot: true } }
            ])
          }
        }])
      }
    }, { botReady: true, botUser: 'GoonBot#0001', selectedChannelId: 'c1' });

    const page = new DiscordChatSettings({});
    page.state.loading = false;
    page.state.catalog = catalog;
    page.state.selectedChannelId = 'c1';
    page.state.openGuildIds = { g1: true };

    const tree = page.render();
    const text = textOf(tree);
    assert.ok(hasClass(tree, 'dc-page'));
    assert.ok(text.includes('Fleet Ops'));
    assert.ok(text.includes('Alice'));
    assert.ok(text.includes('GoonBot'));
    assert.ok(text.includes('users'));
    assert.ok(text.includes('Bot ready'));
    assert.ok(text.includes('Fabric ↔ Discord identity'));
    assert.ok(text.includes('Filter servers') || textOf(tree).toLowerCase().includes('filter'));
    const selected = findByClass(tree, 'dc-ch-row').filter((n) => (n.props.className || '').includes(' on'));
    assert.ok(selected.length >= 1);
    assert.ok(hasClass(tree, 'dc-guild-list'));
  });

  it('shows you/bot permission tags next to channel direction controls', () => {
    const catalog = buildDiscordGuildCatalog({
      guilds: {
        cache: makeCache([{
          id: 'g1',
          name: 'Fleet Ops',
          channels: {
            cache: makeCache([
              { id: 'c1', name: 'general', type: 0, position: 0 }
            ])
          },
          members: { cache: makeCache([]) }
        }])
      }
    }, { botReady: true, selectedChannelId: 'c1' });
    catalog.guilds[0].channels[0].bot = { view: true, send: false };

    const page = new DiscordChatSettings({ identityPubkey: '02aa' });
    page.state.loading = false;
    page.state.catalog = catalog;
    page.state.selectedChannelId = 'c1';
    page.state.openGuildIds = { g1: true };
    page.state.discordChatDirections = { c1: 'listen' };

    const tree = page.render();
    const text = textOf(tree);
    assert.ok(text.includes('you'));
    assert.ok(text.includes('bot'));
  });

  it('filters servers and channels by serverQuery', () => {
    const catalog = buildDiscordGuildCatalog({
      guilds: {
        cache: makeCache([
          {
            id: 'g1',
            name: 'Fleet Ops',
            channels: {
              cache: makeCache([
                { id: 'c1', name: 'general', type: 0, position: 0 },
                { id: 'c2', name: 'ops-bridge', type: 0, position: 1 }
              ])
            },
            members: { cache: makeCache([]) }
          },
          {
            id: 'g2',
            name: 'Social',
            channels: {
              cache: makeCache([{ id: 'c3', name: 'lounge', type: 0, position: 0 }])
            },
            members: { cache: makeCache([]) }
          }
        ])
      }
    }, { botReady: true });

    const page = new DiscordChatSettings({});
    page.state.loading = false;
    page.state.catalog = catalog;
    page.state.serverQuery = 'lounge';
    page.state.openGuildIds = {};

    const tree = page.render();
    const text = textOf(tree);
    assert.ok(text.includes('Social'));
    assert.ok(text.includes('lounge'));
    assert.ok(!text.includes('Fleet Ops'));
    assert.ok(text.includes('Showing 1 server'));
  });

  it('warns when the bot is not ready', () => {
    const page = new DiscordChatSettings({});
    page.state.loading = false;
    page.state.catalog = { botReady: false, guilds: [], users: [] };
    const tree = page.render();
    assert.ok(textOf(tree).includes('Discord bot is not ready'));
    assert.ok(hasClass(tree, 'dc-banner'));
  });

  it('lists accumulated guilds from group shares when the bot is down', () => {
    const page = new DiscordChatSettings({});
    page.state.loading = false;
    page.state.catalog = {
      botReady: false,
      accumulated: true,
      truncated: true,
      guilds: [{
        id: 'g-peer',
        name: 'Peer Guild',
        memberCount: 9000,
        truncated: true,
        source: 'gossip',
        channels: [{ id: 'c1', name: 'ops', type: 0, canAnnounce: true, typeName: 'text' }],
        members: [{ id: 'u1', displayName: 'Alice', username: 'alice', bot: false }]
      }],
      users: [{ id: 'u1', displayName: 'Alice', username: 'alice', bot: false }]
    };
    page.state.openGuildIds = { 'g-peer': true };
    const tree = page.render();
    const text = textOf(tree);
    assert.ok(hasClass(tree, 'dc-guild-list'));
    assert.ok(text.includes('Peer Guild'));
    assert.ok(text.includes('shared') || text.includes('accumulated'));
    assert.ok(text.includes('group data shares') || text.includes('group shares'));
    assert.ok(text.includes('9000') || text.includes('~9000') || text.includes('/ ~9000'));
  });

  it('shows a generated link code and linked status', () => {
    const page = new DiscordChatSettings({ identityPubkey: '02aa' });
    page.state.loading = false;
    page.state.catalog = { botReady: true, guilds: [], users: [] };
    page.state.linkStatus = {
      linked: null,
      pending: {
        code: 'AB23XY89',
        instruction: 'Post `!link AB23XY89` in any Discord channel this bot can see.'
      }
    };
    const tree = page.render();
    const text = textOf(tree);
    assert.ok(text.includes('AB23XY89'));
    assert.ok(text.includes('Generate link code') || text.includes('New code'));
  });

  it('explores co-membership on the Network tab', () => {
    const catalog = buildDiscordGuildCatalog({
      guilds: {
        cache: makeCache([
          {
            id: 'g1',
            name: 'Fleet Ops',
            memberCount: 2,
            channels: { cache: makeCache([{ id: 'c1', name: 'general', type: 0, position: 0 }]) },
            members: {
              cache: makeCache([
                { id: 'u1', displayName: 'Alice', user: { id: 'u1', username: 'alice' } },
                { id: 'u2', displayName: 'Bob', user: { id: 'u2', username: 'bob' } }
              ])
            }
          },
          {
            id: 'g2',
            name: 'Social',
            memberCount: 2,
            channels: { cache: makeCache([{ id: 'c2', name: 'lounge', type: 0, position: 0 }]) },
            members: {
              cache: makeCache([
                { id: 'u1', displayName: 'Alice', user: { id: 'u1', username: 'alice' } },
                { id: 'u3', displayName: 'Cara', user: { id: 'u3', username: 'cara' } }
              ])
            }
          }
        ])
      }
    }, { botReady: true, botUser: 'GoonBot#0001' });
    catalog.identityLinks = [{
      discordUserId: 'u1',
      pubkey: '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      username: 'alice'
    }];

    const page = new DiscordChatSettings({});
    page.state.loading = false;
    page.state.catalog = catalog;
    page.state.view = 'network';
    page.state.selectedUserId = 'u1';
    const tree = page.render();
    const text = textOf(tree);
    assert.ok(hasClass(tree, 'dc-net'));
    assert.ok(text.includes('shared Discord servers'));
    assert.ok(text.includes('Alice'));
    assert.ok(text.includes('Fleet Ops'));
    assert.ok(text.includes('Social'));
    assert.ok(text.includes('Bob') || text.includes('Cara'));
    assert.ok(text.includes('multi-server') || text.includes('Shared with'));
  });
});
