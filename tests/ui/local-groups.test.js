'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findType } = require('../helpers/reactTree');
const Groups = require('../../components/Groups');
const LocalGroups = require('../../components/LocalGroups');
const Chat = require('../../components/Chat');
const IdentityNotePanel = require('../../components/IdentityNotePanel');

describe('Local tags UI', () => {
  it('renders Local tags from the Groups roster toggle', () => {
    const page = new Groups({ identityPubkey: '02aabbccddeeff0011' });
    page.state.loading = false;
    page.state.groups = [];
    page.state.pubkey = '02aabbccddeeff0011';
    page.state.rosterMode = 'local';
    const tree = page.render();
    assert.strictEqual(findType(tree, LocalGroups).length, 1);
    const pane = new LocalGroups(findType(tree, LocalGroups)[0].props);
    pane.state.loading = false;
    pane.state.groups = [];
    assert.ok(textOf(pane.render()).includes('Local tags'));
  });

  it('shows create-tag copy on the local pane', () => {
    const pane = new LocalGroups({ identityPubkey: '02aa' });
    pane.state.loading = false;
    pane.state.groups = [];
    const tree = pane.render();
    assert.ok(textOf(tree).includes('Create tag'));
    assert.ok(textOf(tree).includes('no local tags yet') || textOf(tree).includes('New local tag'));
  });

  it('puts note controls on Discord member hover cards', () => {
    const chat = new Chat({ identityPubkey: '02aabbccddeeff0011', nickname: 'Neorion' });
    chat.state.hoverPubkey = 'discord:u1';
    chat.state.members = [{
      pubkey: 'discord:u1',
      handle: 'Alice',
      kind: 'discord',
      discordUserId: 'u1',
      bot: false,
      online: true
    }];
    const card = chat.renderMemberCard();
    assert.strictEqual(findType(card, IdentityNotePanel).length, 1);
    const panel = new IdentityNotePanel(findType(card, IdentityNotePanel)[0].props);
    assert.ok(textOf(panel.render()).includes('Notes'));
    assert.ok(textOf(card).includes('Alice') || textOf(card).includes('Discord'));
  });
});
