'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findType } = require('../helpers/reactTree');
const LinkedDevices = require('../../components/LinkedDevices');
const Identity = require('../../components/Identity');
const Account = require('../../components/Account');
const Dashboard = require('../../components/Dashboard');

const ME = '02' + 'ab'.repeat(32);
const PEER = '02' + 'cd'.repeat(32);

describe('LinkedDevices page', () => {
  it('renders pairing stages and this-device card', () => {
    const page = new LinkedDevices({ variant: 'page', localPubkey: ME });
    page.state.snapshot = {
      local: { pubkey: ME, candidates: ['192.168.1.9:7777'] },
      members: [ME],
      linkedDevices: [],
      fabric: { ready: true, connected: 1 },
      mesh: { registered: ['https://hub.fabric.pub'], discovered: [] }
    };
    const text = textOf(page.render());
    assert.match(text, /Your devices/);
    assert.match(text, /DeviceDataShare/);
    assert.match(text, /Hub WebRTC/);
    assert.match(text, /Sync account now/);
    assert.match(text, /This device/);
    assert.match(Identity.CSS, /\.ld-wrap/);
  });

  it('shows per-device notes and Game.log counts', () => {
    const page = new LinkedDevices({
      variant: 'page',
      localPubkey: ME,
      linkedDevices: [{ peerFabricId: PEER, peerPubkey: PEER, label: 'Desktop' }]
    });
    page.state.snapshot = {
      local: { pubkey: ME, candidates: ['192.168.1.9:7777'] },
      members: [ME, PEER],
      collection: { count: 1 },
      fabric: { ready: true, connected: 1 },
      inventory: {
        local: {
          notes: 12,
          groups: 1,
          tags: 2,
          chat: 8,
          files: 0,
          logs: 6,
          missions: 1841,
          sessions: 22
        },
        inbound: [{
          pubkey: PEER,
          notes: 3,
          logs: 0,
          missions: 0,
          chat: 4,
          applied: ['notes']
        }]
      }
    };
    const text = textOf(page.render());
    assert.match(text, /On this device/);
    assert.match(text, /Notes/);
    assert.match(text, /12/);
    assert.match(text, /Logs/);
    assert.match(text, /1841/);
    assert.match(text, /Last share from them/);
    assert.match(text, /Applied notes/);
  });

  it('shows revoke on a sibling', () => {
    const page = new LinkedDevices({
      variant: 'embed',
      localPubkey: ME,
      linkedDevices: [{ peerFabricId: PEER, peerPubkey: PEER, label: 'Desktop' }],
      onRevoke: () => {}
    });
    page.state.snapshot = {
      local: { pubkey: ME },
      members: [ME, PEER],
      collection: { count: 1 },
      fabric: { ready: true, connected: 1 }
    };
    const text = textOf(page.render());
    assert.match(text, /Desktop/);
    assert.match(text, /Revoke/);
  });

  it('offers Retry Fabric sign while waiting for mutual IdentityCrossSign', () => {
    const page = new LinkedDevices({
      variant: 'page',
      localPubkey: ME,
      linkedDevices: [{ peerFabricId: PEER, peerPubkey: PEER, label: 'Desktop' }]
    });
    page.state.snapshot = {
      local: { pubkey: ME },
      members: [ME],
      pending: [{ from: ME.slice(2), to: PEER.slice(2) }],
      linkedDevices: [{ peerFabricId: PEER, peerPubkey: PEER, label: 'Desktop' }]
    };
    const text = textOf(page.render());
    assert.match(text, /Retry Fabric sign/);
    assert.match(text, /waiting for the other device/i);
  });

  it('Identity devices section mounts LinkedDevices', () => {
    const prev = window.electronAPI;
    window.electronAPI = Object.assign({}, prev, { identity: { get: async () => ({}) } });
    try {
      const identity = new Identity({ layout: 'page', section: 'devices' });
      identity.state.info = { exists: true, unlocked: true, pubkey: ME };
      identity.state.linkedDevices = [{ peerFabricId: PEER, peerPubkey: PEER, label: 'Phone' }];
      const body = identity.renderBody();
      const [el] = findType(body, LinkedDevices);
      assert.ok(el, 'missing LinkedDevices');
      assert.match(textOf(el.props.addDevice), /Add a device/);
    } finally {
      window.electronAPI = prev;
    }
  });

  it('Account nav includes Devices and Dashboard hash resolves', () => {
    assert.ok(Account.SECTIONS.some((row) => row[0] === 'devices'));
    const resolved = Dashboard.resolveHash('devices', false);
    assert.equal(resolved.tab, 'devices');
  });
});
