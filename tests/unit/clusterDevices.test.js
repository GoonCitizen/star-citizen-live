'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mergeDeviceRows, stageLabel, pendingFromClusterInstance } = require('../../functions/clusterDevices');

const ME = '02' + 'aa'.repeat(32);
const PEER = '02' + 'bb'.repeat(32);

describe('clusterDevices', () => {
  it('marks a paired device waiting for mutual IdentityCrossSign', () => {
    const model = mergeDeviceRows({
      localPubkey: ME,
      linkedDevices: [{ peerFabricId: PEER, peerPubkey: PEER, label: 'Desktop' }],
      cluster: { members: [ME], pending: [{ from: ME.slice(2), to: PEER.slice(2) }] },
      sync: {
        local: { pubkey: ME, candidates: ['192.168.1.8:7777'] },
        members: [ME],
        fabric: { ready: true, connected: 2 }
      }
    });
    assert.equal(model.stage, 'waiting-cross-sign');
    const desk = model.devices.find((d) => d.kind === 'sibling');
    assert.equal(desk.label, 'Desktop');
    assert.equal(desk.stage, 'waiting-cross-sign');
    assert.match(stageLabel(desk.stage), /cross-sign/i);
  });

  it('copies a pairing nonce onto the sibling row', () => {
    const model = mergeDeviceRows({
      localPubkey: ME,
      linkedDevices: [{
        peerFabricId: PEER,
        peerPubkey: PEER,
        label: 'Desktop',
        nonce: 'ab'.repeat(32)
      }],
      cluster: { members: [ME], pending: [] },
      sync: { local: { pubkey: ME }, members: [ME] }
    });
    const desk = model.devices.find((d) => d.kind === 'sibling');
    assert.equal(desk.nonce, 'ab'.repeat(32));
  });

  it('promotes LAN + DeviceDataShare to synced', () => {
    const model = mergeDeviceRows({
      localPubkey: ME,
      linkedDevices: [{ peerFabricId: PEER, peerPubkey: PEER, label: 'Phone' }],
      cluster: { members: [ME, PEER] },
      sync: {
        local: { pubkey: ME, candidates: ['192.168.1.8:7777'] },
        members: [ME, PEER],
        peers: [{ pubkey: PEER, candidates: ['10.0.0.4:7777'] }],
        collection: { count: 1 },
        fabric: { ready: true, connected: 1 }
      },
      mesh: {
        registered: ['https://hub.fabric.pub'],
        discovered: [{ pubkey: PEER, candidates: ['10.0.0.4:7777'], hub: 'https://hub.fabric.pub' }]
      }
    });
    assert.equal(model.stage, 'synced');
    const phone = model.devices.find((d) => d.kind === 'sibling');
    assert.equal(phone.stage, 'synced');
    assert.equal(phone.webrtc, true);
  });

  it('attaches local inventory and last inbound share counts', () => {
    const model = mergeDeviceRows({
      localPubkey: ME,
      linkedDevices: [{ peerFabricId: PEER, peerPubkey: PEER, label: 'Phone' }],
      cluster: { members: [ME, PEER] },
      sync: {
        local: { pubkey: ME, candidates: ['192.168.1.8:7777'] },
        members: [ME, PEER],
        collection: { count: 1 },
        inventory: {
          local: { notes: 12, logs: 6, missions: 40, chat: 3 },
          outbound: { notes: 12, generatedAt: '2026-08-15T12:00:00.000Z' },
          inbound: [{
            pubkey: PEER,
            notes: 2,
            logs: 0,
            missions: 0,
            generatedAt: '2026-08-15T12:01:00.000Z',
            applied: ['notes']
          }]
        }
      }
    });
    const self = model.devices.find((d) => d.kind === 'this');
    const phone = model.devices.find((d) => d.kind === 'sibling');
    assert.equal(self.inventory.notes, 12);
    assert.equal(self.inventory.logs, 6);
    assert.equal(self.published.notes, 12);
    assert.equal(phone.inventory.notes, 2);
    assert.deepEqual(phone.inventory.applied, ['notes']);
  });

  it('reads Hub IdentityCluster toJSON pending Map entries', () => {
    const pending = pendingFromClusterInstance({
      toJSON: () => ({
        pending: [[
          ME.slice(2) + '->' + PEER.slice(2),
          { local: ME.slice(2), peer: PEER.slice(2), nonce: 'ff'.repeat(32) }
        ]]
      })
    }, ME);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].to, PEER.slice(2));
  });
});
