'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf } = require('../helpers/reactTree');
const Identity = require('../../components/Identity');
const ProfilePage = require('../../components/ProfilePage');
const Peers = require('../../components/Peers');
const Settings = require('../../components/Settings');
const FilePage = require('../../components/FilePage');

const PEER_PK = '02' + 'ab'.repeat(32);
const FILE_ID = 'ab'.repeat(32);

describe('profile files UI', () => {
  it('points operators at 📌 pin-to-profile instead of a bulk share toggle', () => {
    const identity = new Identity({});
    const idText = textOf(identity.renderProfileActivity());
    assert.match(idText, /Pin files to this profile/);
    assert.doesNotMatch(idText, /List my published files on my profile for Federation groups/);

    const page = new ProfilePage({});
    page.state.loading = false;
    page.state.error = null;
    page.state.detail = {
      self: true,
      pubkey: PEER_PK,
      profile: { nickname: 'Me' },
      peering: { string: '' },
      files: { files: [], shared: false }
    };
    const selfEmpty = textOf(page.render());
    assert.match(selfEmpty, /Nothing pinned yet/);
    assert.match(selfEmpty, /Pin to profile/);

    page.state.detail.files = {
      files: [{ id: FILE_ID, name: 'build.dmg', size: 4096, purchasePriceSats: 4, href: '/files/' + FILE_ID }],
      shared: true
    };
    const selfText = textOf(page.render());
    assert.match(selfText, /Pinned files/);
    assert.match(selfText, /build\.dmg/);
    assert.match(selfText, /1 pinned file/);

    page.state.detail = {
      self: false,
      pubkey: PEER_PK,
      profile: { nickname: 'Alice', scHandle: 'PilotOne' },
      peering: { string: '' },
      files: null
    };
    const otherText = textOf(page.render());
    assert.match(otherText, /has not pinned files to their profile/);
    assert.match(otherText, /No connection string shared/);
    assert.doesNotMatch(otherText, /List my published files/);
    assert.doesNotMatch(otherText, /Copy peering string/);

    page.state.detail.peering = { string: PEER_PK + '@relay.goon.vc:7777' };
    page.state.detail.files = {
      files: [{ id: 'bb', name: 'alice.apk', purchasePriceSats: 2, href: '/files/bb' }],
      shared: true
    };
    page.state.detail.playtimes = { cells: [{ d: 0, h: 20, n: 3 }], sampleCount: 12 };
    const sharedText = textOf(page.render());
    assert.match(sharedText, /alice\.apk/);
    assert.match(sharedText, /connection/);
    assert.match(sharedText, /play times \(12 samples\)/);
    assert.match(sharedText, /1 pinned file/);
  });

  it('does not paint this node’s catalog onto another peer inspect card', () => {
    const peers = new Peers({});
    const other = textOf(peers.renderProfileFiles({
      self: false,
      pubkey: PEER_PK,
      files: null
    }));
    assert.match(other, /has not pinned files to their profile/);

    const shared = textOf(peers.renderProfileFiles({
      self: false,
      pubkey: PEER_PK,
      files: { files: [{ id: 'cc', name: 'shared.bin', purchasePriceSats: 8 }] }
    }));
    assert.match(shared, /shared\.bin/);
  });

  it('points Settings at the per-file pin', () => {
    const settings = new Settings({});
    settings.state.loading = false;
    const text = textOf(settings.render());
    assert.match(text, /Files on your profile/);
    assert.match(text, /Pin to profile/);
  });
});

describe('file page UI', () => {
  it('exposes pin to profile on a local file', () => {
    const page = new FilePage({ fileId: FILE_ID });
    page.state.loading = false;
    page.state.error = null;
    page.state.detail = {
      id: FILE_ID,
      self: true,
      local: true,
      profilePinned: false,
      record: {
        id: FILE_ID,
        name: 'gooncitizen.dmg',
        mime: 'application/octet-stream',
        size: 4096,
        published: true,
        purchasePriceSats: 4
      },
      offers: []
    };
    const text = textOf(page.render());
    assert.match(text, /gooncitizen\.dmg/);
    assert.match(text, /Pin to profile/);
    assert.match(text, /Publisher profile|Files catalog/);
    assert.match(text, /Sync to my other devices/);
    assert.match(text, /identity cluster/);
  });

  it('shows peer offers without operator cost basis or file bytes', () => {
    const page = new FilePage({ fileId: FILE_ID });
    page.state.loading = false;
    page.state.error = null;
    page.state.detail = {
      id: FILE_ID,
      self: false,
      local: false,
      record: {
        id: FILE_ID,
        name: 'ghost.txt',
        mime: 'text/plain',
        purchasePriceSats: 10,
        local: false,
        costBasisSats: 99999,
        contentBase64: 'AAAA'
      },
      offers: [
        { peerAlias: 'Ops', purchasePriceSats: 10, costBasisSats: 99999 },
        { peerAlias: 'Wing', purchasePriceSats: 40 }
      ]
    };
    const text = textOf(page.render());
    assert.match(text, /ghost\.txt/);
    assert.match(text, /peer listing/);
    assert.match(text, /Ops/);
    assert.doesNotMatch(text, /99999/);
    assert.doesNotMatch(text, /AAAA/);
    assert.doesNotMatch(text, /Cost basis/);
  });
});
