'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findByClass } = require('../helpers/reactTree');
const Chat = require('../../components/Chat');
const { listSlashCommands } = require('../../functions/chatAttachment');

describe('Chat compose UI', () => {
  it('enables Send on global when identity and draft are set', () => {
    const chat = new Chat({ identityPubkey: '02aa', nickname: 'Neorion' });
    chat.state.loading = false;
    chat.state.channels = [{ key: 'global', label: 'Global', kind: 'global' }];
    chat.state.channel = 'global';
    chat.state.page = 'messages';
    chat.onDraftChange('o7 fleet');
    const tree = chat.render();
    const send = findByClass(tree, 'chat-send')[0];
    assert.ok(send);
    assert.strictEqual(send.props.disabled, false);
    assert.ok(textOf(tree).includes('Message as Neorion'));
  });

  it('opens the slash menu for /l and applies /help', () => {
    const chat = new Chat({ identityPubkey: '02aa' });
    chat.state.loading = false;
    chat.state.channels = [{ key: 'global', label: 'Global', kind: 'global' }];
    chat.state.channel = 'global';
    chat.onDraftChange('/l');
    assert.strictEqual(chat.state.slashOpen, true);
    let tree = chat.render();
    assert.ok(findByClass(tree, 'chat-slash').length >= 1);
    assert.ok(textOf(tree).includes('/lookup'));

    const help = listSlashCommands().find((c) => c.action === 'help');
    chat.applySlash(help);
    assert.strictEqual(chat.state.slashOpen, false);
    assert.match(chat.state.error || '', /\/lookup/);
    tree = chat.render();
    assert.ok(findByClass(tree, 'chat-err').length >= 1);
  });

  it('keeps compose locked without an identity', () => {
    const chat = new Chat({});
    chat.state.loading = false;
    chat.state.channels = [{ key: 'global', label: 'Global', kind: 'global' }];
    chat.state.channel = 'global';
    chat.state.draft = 'hello';
    const tree = chat.render();
    const send = findByClass(tree, 'chat-send')[0];
    assert.strictEqual(send.props.disabled, true);
    assert.ok(textOf(tree).includes('Unlock identity'));
    assert.ok(textOf(tree).includes('Desktop / Passport'));
  });

  it('disables Discord compose when the channel is listen-only', () => {
    const chat = new Chat({ identityPubkey: '02aa', nickname: 'Neorion' });
    chat.state.loading = false;
    chat.state.page = 'messages';
    chat.state.channel = 'discord:123456789012345678';
    chat.state.discordCatalog = { botReady: true, botUser: 'Bot#0001' };
    chat.state.discordChannels = [{
      key: 'discord:123456789012345678',
      label: '#ops',
      kind: 'discord',
      guildName: 'Fleet'
    }];
    chat.state.discordChatDirections = { '123456789012345678': 'listen' };
    chat.state.draft = 'should not send';
    const tree = chat.render();
    const send = findByClass(tree, 'chat-send')[0];
    assert.ok(send);
    assert.strictEqual(send.props.disabled, true);
    assert.ok(textOf(tree).includes('You cannot chat here'));
    assert.ok(textOf(tree).includes('listen-only'));
  });
});
