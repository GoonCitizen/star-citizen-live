'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf } = require('../helpers/reactTree');
const Identity = require('../../components/Identity');
const Dashboard = require('../../components/Dashboard');

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
    const text = textOf(identity.renderLinkedDevices());
    assert.match(text, /Linked devices/);
    assert.match(text, /Revoke/);
    assert.match(text, /Passport/);
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
      assert.match(text, /Revoke/);
      assert.match(text, /Lock/);
    } finally {
      window.electronAPI = prev;
    }
  });

  it('does not treat #device-link as a dashboard tab', () => {
    const resolved = Dashboard.resolveHash('device-link=' + 'ab'.repeat(24), false);
    assert.equal(resolved.tab, 'home');
    assert.equal(typeof Dashboard.offerPassportDeviceLink, 'function');
  });
});
