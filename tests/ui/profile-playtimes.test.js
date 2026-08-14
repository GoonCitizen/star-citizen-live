'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf } = require('../helpers/reactTree');
const Identity = require('../../components/Identity');
const ProfilePage = require('../../components/ProfilePage');
const Peers = require('../../components/Peers');
const Settings = require('../../components/Settings');

const PEER_PK = '02' + 'ab'.repeat(32);

describe('profile playtimes UI', () => {
  it('offers Share when I play only on the operator profile', () => {
    const identity = new Identity({});
    identity.state.sharePlaytimes = false;
    const idText = textOf(identity.renderProfileActivity());
    assert.match(idText, /Share when I play/);
    assert.match(idText, /Off by default/);
    assert.doesNotMatch(idText, /Show activity graph on player profiles/);

    const page = new ProfilePage({});
    page.state.loading = false;
    page.state.error = null;
    page.state.analytics = { heatcells: [{ ym: '2026-08', d: 0, h: 20, n: 2 }] };
    page.state.sharePlaytimes = false;
    page.state.detail = {
      self: true,
      pubkey: PEER_PK,
      profile: { nickname: 'Me' },
      peering: { string: '' }
    };
    const selfText = textOf(page.render());
    assert.match(selfText, /Share when I play/);
    assert.match(selfText, /When you play/);

    page.state.detail = {
      self: false,
      pubkey: PEER_PK,
      profile: { nickname: 'Alice', scHandle: 'PilotOne' },
      peering: { string: '' },
      playtimes: null
    };
    const otherText = textOf(page.render());
    assert.match(otherText, /has not shared when they play/);
    assert.doesNotMatch(otherText, /Share when I play/);
    assert.doesNotMatch(otherText, /local history/);
    assert.doesNotMatch(otherText, /Show activity graph/);

    page.state.detail.playtimes = { cells: [{ d: 0, h: 20, n: 3 }] };
    const sharedText = textOf(page.render());
    assert.match(sharedText, /When they play/);
    assert.doesNotMatch(sharedText, /Share when I play/);
  });

  it('does not paint this machine’s heatmap onto another peer inspect card', () => {
    const peers = new Peers({});
    const other = textOf(peers.renderProfileActivity({
      self: false,
      pubkey: PEER_PK,
      playtimes: null
    }));
    assert.match(other, /has not shared when they play/);
    assert.doesNotMatch(other, /local history/);

    const shared = textOf(peers.renderProfileActivity({
      self: false,
      pubkey: PEER_PK,
      playtimes: { cells: [{ d: 2, h: 19, n: 1 }] }
    }));
    assert.match(shared, /When they play/);
  });

  it('points Settings at the Identity/Profile opt-in instead of a local profile toggle', () => {
    const settings = new Settings({});
    settings.state.loading = false;
    const text = textOf(settings.render());
    assert.match(text, /When you play/);
    assert.match(text, /Share when I play/);
    assert.match(text, /chat\.catalog/);
    assert.doesNotMatch(text, /Show activity graph on player profiles/);
  });
});
