'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findType } = require('../helpers/reactTree');
const Identity = require('../../components/Identity');
const Dashboard = require('../../components/Dashboard');
const LinkedDevices = require('../../components/LinkedDevices');
const PubkeyEmoji = require('../../components/PubkeyEmoji');

function renderLinked (identity, extraState) {
  const wrap = identity.renderLinkedDevices();
  const [el] = findType(wrap, LinkedDevices);
  const page = new LinkedDevices(el.props);
  if (extraState) page.state = Object.assign({}, page.state, extraState);
  return { wrap, page };
}

describe('Identity add-device UI', () => {
  it('offers create identity when none exists', () => {
    const identity = new Identity({});
    identity.state.info = { exists: false, unlocked: false };
    const text = textOf(identity.renderCreateIdentity());
    assert.match(text, /Create identity on this device/);
    assert.match(text, /Create identity/);
  });

  it('prompts unlock before adding a device', () => {
    const identity = new Identity({});
    identity.state.info = { exists: true, unlocked: false, pubkey: '02' + 'ab'.repeat(32) };
    const text = textOf(identity.renderAddDevice());
    assert.match(text, /Add a device/);
    assert.match(text, /Unlock this identity/);
  });

  it('shows QR and Passport landing when an offer is pending', () => {
    assert.match(Identity.CSS, /\.id-qr/);
    const identity = new Identity({});
    identity.state.info = { exists: true, unlocked: true, pubkey: '02' + 'ab'.repeat(32) };
    identity.state.linkOffer = {
      ok: true,
      initiatorId: 'id1desktopdesktopdesktopdesktopdesktopdesktopdesktop',
      protocolUrl: 'fabric://link?sessionId=aa&hub=https%3A%2F%2Frelay.goon.vc',
      httpsUrl: 'https://relay.goon.vc/#device-link=aa',
      qrDataUrl: 'data:image/png;base64,QQ=='
    };
    const text = textOf(identity.renderAddDevice());
    assert.match(text, /fabric:\/\/link/);
    assert.match(text, /#device-link=/);
    assert.match(text, /Copy HTTPS landing/);
    assert.match(text, /Open link/);
    assert.match(text, /fabric:\/\/link\?sessionId=/);
    assert.match(text, /header QR/);
    const [el] = findType(identity.renderAddDevice(), PubkeyEmoji);
    assert.ok(el, 'missing pubkey emoji on QR offer');
    const { emojiFingerprint } = require('../../functions/pubkeyEmoji');
    const fp = emojiFingerprint('id1desktopdesktopdesktopdesktopdesktopdesktopdesktop');
    assert.match(textOf(new PubkeyEmoji(el.props).render()), new RegExp(fp.emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(textOf(new PubkeyEmoji(el.props).render()), /same emoji/i);
  });

  it('lets an unlocked Security page paste a fabric://link', () => {
    const identity = new Identity({});
    identity.state.info = { exists: true, unlocked: true, pubkey: '02' + 'ab'.repeat(32) };
    const text = textOf(identity.renderAddDevice());
    assert.match(text, /Open link/);
    assert.match(text, /paste it here/i);
  });

  it('lists linked devices with Revoke', () => {
    const identity = new Identity({});
    identity.state.info = { exists: true, unlocked: true, pubkey: '02' + 'ab'.repeat(32) };
    identity.state.linkedDevices = [{
      peerFabricId: 'id1peerpeerpeer',
      peerPubkey: '02' + 'cd'.repeat(32),
      nonce: 'ab'.repeat(32),
      label: 'Passport'
    }];
    const { wrap, page } = renderLinked(identity);
    assert.match(textOf(wrap), /Linked devices/);
    assert.match(textOf(page.render()), /Revoke/);
    assert.match(textOf(page.render()), /Passport/);
  });

  it('Security page layout shows lock, add-device, and revoke', () => {
    const prev = window.electronAPI;
    window.electronAPI = Object.assign({}, prev, { identity: { get: async () => ({}) } });
    try {
      const identity = new Identity({ layout: 'page', section: 'security' });
      identity.state.info = {
        exists: true,
        unlocked: true,
        pubkey: '02' + 'ab'.repeat(32),
        autoLockMinutes: 30
      };
      identity.state.linkedDevices = [{
        peerFabricId: 'id1peer',
        peerPubkey: '02' + 'cd'.repeat(32),
        nonce: 'ab'.repeat(32),
        label: 'Desktop'
      }];
      const text = textOf(identity.renderBody());
      assert.match(text, /Add a device/);
      assert.match(text, /Linked devices/);
      assert.match(text, /Lock/);
      const [el] = findType(identity.renderBody(), LinkedDevices);
      const page = new LinkedDevices(el.props);
      assert.match(textOf(page.render()), /Revoke/);
      assert.match(textOf(page.render()), /Desktop/);
    } finally {
      window.electronAPI = prev;
    }
  });

  it('does not treat #device-link as a dashboard tab', () => {
    const resolved = Dashboard.resolveHash('device-link=' + 'ab'.repeat(24), false);
    assert.equal(resolved.tab, 'home');
    assert.equal(typeof Dashboard.offerPassportDeviceLink, 'function');
  });

  it('clears the QR when the hub says the offer expired', async () => {
    const prev = window.electronAPI;
    window.electronAPI = {
      identity: {
        tickDeviceLinkOffer: async () => ({
          ok: false,
          expired: true,
          error: 'unknown or expired device link'
        })
      }
    };
    try {
      const identity = new Identity({});
      identity.state.linkOffer = {
        ok: true,
        sessionId: 'aa'.repeat(24),
        hubBase: 'https://relay.goon.vc'
      };
      await identity.tickAddDevice();
      assert.equal(identity.state.linkOffer, null);
      assert.match(String(identity.state.error || ''), /expired/i);
    } finally {
      window.electronAPI = prev;
    }
  });

  it('keeps the QR when the identity is locked mid-poll', async () => {
    const prev = window.electronAPI;
    window.electronAPI = {
      identity: {
        tickDeviceLinkOffer: async () => ({ error: 'Identity is locked' })
      }
    };
    try {
      const identity = new Identity({});
      identity.state.linkOffer = {
        ok: true,
        sessionId: 'aa'.repeat(24),
        hubBase: 'https://relay.goon.vc'
      };
      await identity.tickAddDevice();
      assert.ok(identity.state.linkOffer);
      assert.match(String(identity.state.error || ''), /Unlock this identity/);
    } finally {
      window.electronAPI = prev;
    }
  });

  it('shows Remove on a pairing row with no nonce', () => {
    const identity = new Identity({});
    identity.state.info = { exists: true, unlocked: true, pubkey: '02' + 'ab'.repeat(32) };
    identity.state.linkedDevices = [{
      peerFabricId: 'id1stuckstuck',
      peerPubkey: '02' + 'ee'.repeat(32),
      label: 'Stuck phone'
    }];
    const { page } = renderLinked(identity);
    assert.match(textOf(page.render()), /Remove/);
  });
});
