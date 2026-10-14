'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findType } = require('../helpers/reactTree');
const ProfilePage = require('../../components/ProfilePage');
const IdentityNotePanel = require('../../components/IdentityNotePanel');

const PEER_PK = '02' + 'ab'.repeat(32);

describe('profile notes UI', () => {
  it('lets the operator browse My notes on their own profile', () => {
    const page = new ProfilePage({});
    page.state.loading = false;
    page.state.error = null;
    page.state.detail = {
      self: true,
      pubkey: PEER_PK,
      profile: { nickname: 'Me' },
      peering: { string: '' },
      notes: { notes: [], shared: false },
      myNotes: []
    };
    const tree = page.render();
    const text = textOf(tree);
    assert.match(text, /My notes/);
    assert.match(text, /Nothing pinned yet/);
    assert.match(text, /Pin to profile|📌/);
    const panels = findType(tree, IdentityNotePanel);
    assert.strictEqual(panels.length, 1);
    assert.strictEqual(panels[0].props.mine, true);
    assert.strictEqual(panels[0].props.actor, PEER_PK);
    const panel = new IdentityNotePanel(panels[0].props);
    panel.state.notes = [{ id: 'n1', body: 'Callsign confirmed', visibility: 'private' }];
    const panelText = textOf(panel.render());
    assert.match(panelText, /My notes/);
    assert.match(panelText, /Callsign confirmed/);
    assert.match(panelText, /Pin this note to profile/);
    assert.match(panelText, /Share this note to a Federation group/);
  });

  it('shows public notes pinned onto another profile', () => {
    const page = new ProfilePage({});
    page.state.loading = false;
    page.state.error = null;
    page.state.detail = {
      self: false,
      pubkey: PEER_PK,
      profile: { nickname: 'Alice' },
      peering: { string: '' },
      notes: {
        notes: [{ id: 'n1', body: 'Reliable wingman', author: '02cc' }],
        shared: true
      }
    };
    const text = textOf(page.render());
    assert.match(text, /Public notes/);
    assert.match(text, /Reliable wingman/);
    assert.match(text, /1 public note/);
    assert.doesNotMatch(text, /My notes/);
  });
});
