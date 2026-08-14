'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, hasClass, findByClass, findType } = require('../helpers/reactTree');
const {
  chatChannelsFromCatalog,
  buildDiscordGuildCatalog
} = require('../../functions/discordGuildCatalog');
const { makeCache } = require('../helpers/discordBotStub');

const Chat = require('../../components/Chat');
const DiscordChatSettings = require('../../components/DiscordChatSettings');

function sampleCatalog () {
  return buildDiscordGuildCatalog({
    guilds: {
      cache: makeCache([{
        id: 'g1',
        name: 'Fleet Ops',
        memberCount: 2,
        channels: {
          cache: makeCache([
            { id: 'c1', name: 'general', type: 0, position: 0 },
            { id: 'v1', name: 'voice', type: 2, position: 1 }
          ])
        },
        members: {
          cache: makeCache([
            { id: 'u1', displayName: 'Alice', user: { id: 'u1', username: 'alice', bot: false } },
            { id: 'b1', displayName: 'GoonBot', user: { id: 'b1', username: 'GoonBot', bot: true } }
          ])
        }
      }])
    }
  }, { botReady: true, botUser: 'GoonBot#0001', selectedChannelId: 'c1' });
}

describe('Chat Discord bridged UI', () => {
  let catalog;
  let discordChannels;

  before(() => {
    catalog = sampleCatalog();
    discordChannels = chatChannelsFromCatalog(catalog);
  });

  it('lists Discord text channels on the flattened rail and keeps voice off the rail', () => {
    const chat = new Chat({ identityPubkey: '02aa', nickname: 'Neorion' });
    chat.state.channels = [{ key: 'global', label: 'Global', kind: 'global' }];
    chat.state.discordCatalog = catalog;
    chat.state.discordChannels = discordChannels;
    chat.state.loading = false;
    chat.state.page = 'messages';
    chat.state.channel = 'global';
    const tree = chat.render();
    assert.ok(hasClass(tree, 'chat-plat'));
    assert.ok(hasClass(tree, 'chat-filter'));
    assert.ok(textOf(tree).includes('Search channels'));
    assert.ok(textOf(tree).includes('Fleet Ops'));
    assert.ok(textOf(tree).includes('general'));
    assert.ok(!textOf(tree).includes('voice'));
    assert.ok(textOf(tree).includes('Bot settings'));
    assert.ok(textOf(tree).includes('Discord'));
    assert.ok(textOf(tree).includes('Fabric'));
    assert.strictEqual(findByClass(tree, 'discord-ch').length, 1);
  });

  it('filters the channel rail across Fabric and Discord names', () => {
    const chat = new Chat({ identityPubkey: '02aa', nickname: 'Neorion' });
    chat.state.channels = [
      { key: 'global', label: 'Global', kind: 'global' },
      { key: 'group:g1', label: 'Starjump', kind: 'group', groupId: 'g1' }
    ];
    chat.state.discordCatalog = catalog;
    chat.state.discordChannels = discordChannels;
    chat.state.loading = false;
    chat.state.page = 'messages';
    chat.state.channel = 'global';
    chat.state.channelQuery = 'fleet';
    let tree = chat.render();
    assert.ok(textOf(tree).includes('Fleet Ops'));
    assert.ok(textOf(tree).includes('general'));
    assert.ok(!textOf(tree).includes('Starjump'));
    // Active channel stays pinned even when it does not match.
    assert.ok(textOf(tree).includes('Global'));

    chat.state.channelQuery = 'starjump';
    tree = chat.render();
    assert.ok(textOf(tree).includes('Starjump'));
    assert.ok(!textOf(tree).includes('Fleet Ops'));
    assert.strictEqual(findByClass(tree, 'discord-ch').length, 0);

    chat.state.channelQuery = '';
    chat.state.channelKind = 'discord';
    tree = chat.render();
    assert.ok(textOf(tree).includes('Fleet Ops'));
    assert.ok(!textOf(tree).includes('Starjump'));
    assert.ok(hasClass(tree, 'chat-filter-chip'));
  });

  it('renders a Discord channel as a bridged thread with guild members', () => {
    const chat = new Chat({ identityPubkey: '02aa', nickname: 'Neorion' });
    chat.state.channels = [{ key: 'global', label: 'Global', kind: 'global' }];
    chat.state.discordCatalog = catalog;
    chat.state.discordChannels = discordChannels;
    chat.state.channel = 'discord:c1';
    chat.state.loading = false;
    chat.state.page = 'messages';
    chat.state.messages = [{
      id: 'discord-msg:m1',
      author: 'discord:u1',
      handle: 'alice',
      body: 'o7 from Discord',
      ts: '2026-08-12T12:00:00.000Z',
      kind: 'discord'
    }];
    chat.state.members = [{
      pubkey: 'discord:u1',
      handle: 'Alice',
      kind: 'discord',
      discordUserId: 'u1',
      bot: false,
      online: true
    }, {
      pubkey: 'discord:b1',
      handle: 'GoonBot',
      kind: 'discord',
      discordUserId: 'b1',
      bot: true,
      online: true
    }];
    chat.state.membersLabel = 'Fleet Ops';
    chat.state.draft = 'hello guild';
    const tree = chat.render();
    const text = textOf(tree);
    assert.ok(text.includes('Discord channel — bot relays as itself'));
    assert.ok(text.includes('Message Discord as Neorion'));
    assert.ok(text.includes('o7 from Discord'));
    assert.ok(text.includes('Alice'));
    assert.ok(text.includes('bot'));
    assert.ok(hasClass(tree, 'chat-ch'));
    const send = findByClass(tree, 'chat-send')[0];
    assert.ok(send);
    assert.strictEqual(send.props.disabled, false);
  });

  it('shows Fabric and Discord badges when a group pins a Discord channel', () => {
    const chat = new Chat({ identityPubkey: '02aa', nickname: 'Neorion' });
    chat.state.channels = [
      { key: 'global', label: 'Global', kind: 'global' },
      { key: 'group:g1', label: 'Starjump', kind: 'group', groupId: 'g1' }
    ];
    chat.state.fabricGroups = [{
      id: 'g1',
      name: 'Starjump',
      pinnedChannels: ['discord:c1']
    }];
    chat.state.discordCatalog = catalog;
    chat.state.discordChannels = discordChannels;
    chat.state.loading = false;
    chat.state.page = 'messages';
    chat.state.channel = 'group:g1';
    const tree = chat.render();
    const text = textOf(tree);
    assert.ok(hasClass(tree, 'bridged'));
    assert.ok(text.includes('Starjump'));
    assert.ok(text.includes('Fabric + Discord'));
    assert.ok(text.includes('bot relays as itself'));
    const plats = findByClass(tree, 'chat-plat');
    assert.ok(plats.some((n) => String(n.props.className || '').includes('fabric')));
    assert.ok(plats.some((n) => String(n.props.className || '').includes('discord')));
  });

  it('sorts Discord channel members online then by lastMessageAt', async () => {
    const chat = new Chat({ identityPubkey: '02aa', nickname: 'Neorion' });
    chat.state.channel = 'discord:c1';
    chat.state.discordCatalog = catalog;
    const messages = [
      { author: 'discord:u1', handle: 'alice', ts: '2026-08-12T10:00:00.000Z' },
      { author: 'discord:b1', handle: 'GoonBot', ts: '2026-08-12T12:00:00.000Z' }
    ];
    const insight = {
      guild: { name: 'Fleet Ops' },
      members: [
        { id: 'offline1', displayName: 'Zed', username: 'zed', status: 'offline', bot: false },
        { id: 'u1', displayName: 'Alice', username: 'alice', status: 'online', bot: false },
        { id: 'b1', displayName: 'GoonBot', username: 'GoonBot', status: 'online', bot: true }
      ]
    };
    await chat.refreshMembers([], messages, insight);
    assert.deepStrictEqual(chat.state.members.map((m) => m.handle), [
      'GoonBot',
      'Alice',
      'Zed'
    ]);
  });

  it('marks listen-only Discord channels on the rail and locks compose', () => {
    const chat = new Chat({ identityPubkey: '02aa', nickname: 'Neorion' });
    chat.state.channels = [{ key: 'global', label: 'Global', kind: 'global' }];
    chat.state.discordCatalog = catalog;
    chat.state.discordChannels = discordChannels;
    chat.state.discordChatDirections = { c1: 'listen' };
    chat.state.channel = 'discord:c1';
    chat.state.loading = false;
    chat.state.page = 'messages';
    chat.state.draft = 'nope';
    const tree = chat.render();
    assert.ok(textOf(tree).includes('you'));
    assert.ok(textOf(tree).includes('listen-only') || textOf(tree).includes('You cannot chat'));
    const send = findByClass(tree, 'chat-send')[0];
    assert.strictEqual(send.props.disabled, true);
  });

  it('marks when the Discord bot cannot send on a channel', () => {
    const chat = new Chat({ identityPubkey: '02aa', nickname: 'Neorion' });
    chat.state.channels = [{ key: 'global', label: 'Global', kind: 'global' }];
    chat.state.discordCatalog = catalog;
    chat.state.discordChannels = [{
      key: 'discord:c1',
      label: '#general',
      kind: 'discord',
      guildName: 'Fleet Ops',
      channelId: 'c1',
      bot: { view: true, send: false }
    }];
    chat.state.channel = 'discord:c1';
    chat.state.loading = false;
    chat.state.page = 'messages';
    const tree = chat.render();
    assert.ok(textOf(tree).includes('bot cannot chat'));
    const send = findByClass(tree, 'chat-send')[0];
    assert.strictEqual(send.props.disabled, true);
  });

  it('offers + Channel to create a Federation group chat', () => {
    const chat = new Chat({ identityPubkey: '02aa', nickname: 'Neorion' });
    chat.state.loading = false;
    chat.state.page = 'messages';
    const tree = chat.render();
    assert.ok(textOf(tree).includes('+ Channel'));
  });

  it('posts into a Discord channel when identity is unlocked', async () => {
    const calls = [];
    const prev = global.fetch;
    global.fetch = async (url, opts) => {
      calls.push({ url: String(url), opts: opts || {} });
      return { ok: true, json: async () => ({ data: { id: 'm1' } }) };
    };
    const chat = new Chat({ identityPubkey: '02aa', nickname: 'Neorion' });
    chat.state.channel = 'discord:c1';
    chat.state.draft = 'hello discord';
    chat.state.sending = false;
    chat.refresh = async () => {};
    try {
      await chat.send();
      assert.strictEqual(chat.state.error, null);
      assert.ok(calls.some((c) => c.url.includes('/chat/messages') && c.opts.method === 'POST'));
    } finally {
      global.fetch = prev;
    }
  });

  it('opens a Fabric profile for a linked Discord member', () => {
    const chat = new Chat({ identityPubkey: '02aabbccddeeff0011' });
    chat.openProfile('02linkedpubkey0001');
    assert.ok(String(global.window.location.href).includes('/profiles/'));
  });

  it('opens a Discord profile page for an unlinked member', () => {
    const chat = new Chat({ identityPubkey: '02aa' });
    chat.openProfile('discord:u1');
    assert.ok(String(global.window.location.href).includes('/profiles/'));
    assert.ok(decodeURIComponent(String(global.window.location.href)).includes('discord:u1'));
  });

  it('opens the Discord settings page from the cog', () => {
    const chat = new Chat({});
    chat.openDiscordPage();
    assert.strictEqual(chat.state.page, 'discord');
    const tree = chat.render();
    assert.strictEqual(findType(tree, DiscordChatSettings).length, 1);
  });

  it('hides Discord bot settings on Android', () => {
    const prev = global.window.electronAPI;
    global.window.electronAPI = Object.assign({}, prev, { platform: 'android' });
    try {
      const chat = new Chat({ identityPubkey: '02aa', nickname: 'Neorion' });
      chat.state.channels = [{ key: 'global', label: 'Global', kind: 'global' }];
      chat.state.discordCatalog = catalog;
      chat.state.discordChannels = discordChannels;
      chat.state.loading = false;
      chat.state.page = 'messages';
      chat.state.channel = 'global';
      const tree = chat.render();
      const text = textOf(tree);
      assert.ok(!text.includes('Bot settings'));
      assert.equal(findType(tree, DiscordChatSettings).length, 0);
      chat.openDiscordPage();
      assert.strictEqual(chat.state.page, 'messages');
    } finally {
      global.window.electronAPI = prev;
    }
  });
});
