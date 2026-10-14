'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findType } = require('../helpers/reactTree');
const Chat = require('../../components/Chat');
const IdentityNotePanel = require('../../components/IdentityNotePanel');
const { createIdentity } = require('../../functions/identity');

describe('Chat people search UI', () => {
  let alice;
  let bob;

  before(() => {
    alice = createIdentity();
    bob = createIdentity();
  });

  function catalog () {
    return {
      guilds: [{
        id: 'g1',
        name: 'Fleet Ops',
        members: [
          { id: 'u1', displayName: 'Alice', username: 'alice' },
          { id: 'u2', displayName: 'Cara', username: 'cara' },
          { id: 'u3', displayName: 'Bob', username: 'bob' }
        ]
      }],
      identityLinks: [
        { discordUserId: 'u1', pubkey: alice.pubkey, username: 'alice' },
        { discordUserId: 'u3', pubkey: bob.pubkey, username: 'bob' }
      ]
    };
  }

  function chatWithDirectory (extra = {}) {
    const chat = new Chat({ identityPubkey: alice.pubkey, nickname: 'Alice' });
    chat.state.loading = false;
    chat.state.page = 'messages';
    chat.state.channel = 'global';
    chat.state.channels = [{ key: 'global', label: 'Global', kind: 'global' }];
    chat.state.members = [{
      pubkey: alice.pubkey,
      handle: 'Alice',
      kind: 'linked',
      linked: true,
      discordUserId: 'u1',
      online: true
    }];
    chat.state.discordCatalog = catalog();
    chat.state.fabricGroups = [{
      id: 'grp1',
      name: 'Starjump',
      members: [alice.pubkey, bob.pubkey]
    }];
    Object.assign(chat.state, extra);
    return chat;
  }

  it('keeps channel search on the left rail and people search on members', () => {
    const chat = chatWithDirectory();
    const tree = chat.render();
    assert.ok(textOf(tree).includes('Search channels'));
    assert.ok(textOf(tree).includes('Search people'));
  });

  it('filters on-channel members by the people query', () => {
    const chat = chatWithDirectory({
      members: [
        { pubkey: alice.pubkey, handle: 'Alice', online: true },
        { pubkey: bob.pubkey, handle: 'Bob', online: false }
      ],
      peopleQuery: 'ali'
    });
    const rail = chat.renderMembers();
    const text = textOf(rail);
    assert.ok(text.includes('Alice'));
    assert.ok(!text.includes('Bob'));
    assert.ok(!text.includes('Also in world view'));
  });

  it('surfaces Discord catalog people under Also in world view', () => {
    const chat = chatWithDirectory({ peopleQuery: 'cara' });
    const rail = chat.renderMembers();
    const text = textOf(rail);
    assert.ok(text.includes('Also in world view'));
    assert.ok(text.includes('Cara'));
    assert.ok(text.includes('Fleet Ops'));
  });

  it('lists common Discord servers and Fabric groups on a peer hover card', () => {
    const chat = chatWithDirectory({ hoverPubkey: bob.pubkey });
    const card = chat.renderMemberCard();
    const text = textOf(card);
    assert.ok(text.includes('Common Discord servers'));
    assert.ok(text.includes('Fleet Ops'));
    assert.ok(text.includes('Common Fabric groups'));
    assert.ok(text.includes('Starjump'));
    assert.ok(text.includes('Notes stay on this node'));
    assert.strictEqual(findType(card, IdentityNotePanel).length, 1);
    assert.strictEqual(findType(card, IdentityNotePanel)[0].props.sharePeer, bob.pubkey);
  });

  it('offers Share with this person when a Fabric peer hover has a note', () => {
    const panel = new IdentityNotePanel({
      actor: bob.pubkey,
      handle: 'Bob',
      sharePeer: bob.pubkey,
      shareGroups: [{ id: 'grp1', name: 'Starjump' }]
    });
    panel.state.notes = [{ id: 'n1', body: 'Intel: flies evenings', visibility: 'private' }];
    const text = textOf(panel.render());
    assert.ok(text.includes('Share with this person'));
    assert.ok(text.includes('📌'));
    assert.ok(text.includes('Pin this note to profile'));
    assert.ok(text.includes('Share this note to a Federation group'));
    assert.ok(!text.includes('Share to group or peer'));
  });
});
