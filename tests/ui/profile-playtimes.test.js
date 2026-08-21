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
  it('offers Publish when I fly only on the operator profile', () => {
    const identity = new Identity({});
    identity.state.info = { pubkey: PEER_PK, exists: true, unlocked: true };
    const idText = textOf(identity.renderProfileActivity());
    assert.match(idText, /When you fly lives on/);
    assert.match(idText, /My profile/);
    assert.doesNotMatch(idText, /Publish when I fly to Federation/);
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
    assert.match(selfText, /When you fly/);
    assert.match(selfText, /Publish when I fly/);
    assert.match(selfText, /Off — this heatmap stays on this machine/);

    page.state.detail = {
      self: false,
      pubkey: PEER_PK,
      profile: { nickname: 'Alice', scHandle: 'PilotOne' },
      peering: { string: '' },
      playtimes: null
    };
    const otherText = textOf(page.render());
    assert.match(otherText, /has not shared when they fly/);
    assert.doesNotMatch(otherText, /Publish when I fly/);
    assert.doesNotMatch(otherText, /local history/);
    assert.doesNotMatch(otherText, /Show activity graph/);

    page.state.detail.playtimes = { cells: [{ d: 0, h: 20, n: 3 }] };
    const sharedText = textOf(page.render());
    assert.match(sharedText, /When they fly/);
    assert.doesNotMatch(sharedText, /Publish when I fly/);
  });

  it('does not paint this machine’s heatmap onto another peer inspect card', () => {
    const peers = new Peers({});
    const other = textOf(peers.renderProfileActivity({
      self: false,
      pubkey: PEER_PK,
      playtimes: null
    }));
    assert.match(other, /has not shared when they fly/);
    assert.doesNotMatch(other, /local history/);

    const shared = textOf(peers.renderProfileActivity({
      self: false,
      pubkey: PEER_PK,
      playtimes: { cells: [{ d: 2, h: 19, n: 1 }] }
    }));
    assert.match(shared, /When they fly/);
  });

  it('points Settings at the My profile publish opt-in instead of a local profile toggle', () => {
    const settings = new Settings({});
    settings.state.loading = false;
    const text = textOf(settings.render());
    assert.match(text, /When you fly/);
    assert.match(text, /Publish when I fly/);
    assert.match(text, /My profile/);
    assert.match(text, /chat\.catalog/);
    assert.doesNotMatch(text, /Show activity graph on player profiles/);
  });
});
