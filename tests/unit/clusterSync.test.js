'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Key = require('@fabric/core/types/key');

const clusterSync = require('../../functions/clusterSync');
const deviceDataSync = require('../../functions/deviceDataSync');

describe('clusterSync', () => {
  it('collects RFC1918 LAN candidates and skips loopback / hub NICs', () => {
    const candidates = clusterSync.localDialCandidates({
      port: 7777,
      advertiseHost: 'desk.local',
      env: {},
      interfaceAddresses: {
        en0: [{ address: '192.168.1.20', internal: false }],
        eth0: [{ address: '65.21.231.149', internal: false }],
        lo0: [{ address: '127.0.0.1', internal: true }]
      }
    });
    assert.ok(candidates.includes('192.168.1.20:7777'));
    assert.ok(candidates.includes('desk.local:7777'));
    assert.ok(!candidates.some((a) => a.startsWith('127.0.0.1')));
    assert.ok(!candidates.some((a) => a.includes('65.21.231.149')));
    assert.ok(!candidates.some((a) => a.includes('relay.goon.vc')));
  });

  it('does not scan a subnet — only advertised local addresses', () => {
    const candidates = clusterSync.localDialCandidates({
      port: 7777,
      env: {},
      interfaceAddresses: {
        wlan0: [{ address: '10.0.0.4', internal: false }]
      }
    });
    assert.deepEqual(candidates, ['10.0.0.4:7777']);
  });

  it('dialTargets skips self pubkey and overlapping LAN addresses', () => {
    const key = new Key();
    const peers = clusterSync.compactPeers({
      pubkey: key.pubkey,
      candidates: ['192.168.1.20:7777', '192.168.1.21:7777', '127.0.0.1:7777']
    });
    assert.ok(peers);
    assert.ok(!peers.candidates.includes('127.0.0.1:7777'));
    assert.ok(peers.webrtc.hubs.includes('https://hub.fabric.pub'));
    const targets = clusterSync.dialTargets(peers, {
      localPubkey: key.pubkey,
      selfCandidates: ['192.168.1.20:7777']
    });
    assert.deepEqual(targets, []);
    const other = clusterSync.dialTargets(peers, {
      localPubkey: 'ab'.repeat(32),
      selfCandidates: ['192.168.1.20:7777']
    });
    assert.deepEqual(other, ['192.168.1.21:7777']);
  });

  it('round-trips DeviceDataShare through a FabricMessageCollection', () => {
    const key = new Key();
    const share = deviceDataSync.buildShare({
      fromPubkey: key.pubkey,
      packs: [{
        pack: deviceDataSync.PACK_PEERS,
        payload: {
          pubkey: key.pubkey,
          candidates: ['192.168.4.12:7777'],
          mnemonic: 'should-not-travel'
        }
      }]
    });
    assert.ok(share);
    assert.ok(!JSON.stringify(share).includes('should-not-travel'));
    const collection = clusterSync.shareToCollection(share, { key });
    assert.equal(collection.type, 'FabricMessageCollection');
    assert.equal(collection.count, 1);
    const restored = clusterSync.replayShareCollection(collection);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].share.fromPubkey, key.pubkey);
    assert.equal(restored[0].share.packs[0].pack, deviceDataSync.PACK_PEERS);
    assert.deepEqual(restored[0].share.packs[0].payload.candidates, ['192.168.4.12:7777']);
  });

  it('TRANSPORT lists TCP before Hub WebRTC', () => {
    assert.deepEqual(clusterSync.TRANSPORT, [
      'tcp-lan',
      'tcp-advertise',
      'tcp-hub-relay',
      'webrtc-hub'
    ]);
  });

  it('summarizeSyncStatus maps solo / pending / synced', () => {
    const solo = clusterSync.summarizeSyncStatus({
      members: ['aa'],
      fabric: { ready: true, connected: 2 },
      local: { candidates: ['192.168.1.8:7777'] }
    });
    assert.equal(solo.state, 'solo');
    assert.equal(solo.tone, 'muted');
    assert.match(solo.detail, /add a device/i);

    const pending = clusterSync.summarizeSyncStatus({
      members: ['aa', 'bb'],
      fabric: { ready: true, connected: 1 },
      peers: [{ pubkey: 'bb', candidates: ['10.0.0.2:7777'] }]
    });
    assert.equal(pending.state, 'pending');
    assert.equal(pending.tone, 'warn');

    const synced = clusterSync.summarizeSyncStatus({
      members: ['aa', 'bb'],
      fabric: { ready: true, connected: 1 },
      collection: { count: 1, root: 'ab' }
    });
    assert.equal(synced.state, 'synced');
    assert.equal(synced.tone, 'good');
    assert.match(synced.label, /synced/i);

    const chatting = clusterSync.summarizeSyncStatus({
      members: ['aa', 'bb'],
      fabric: { ready: true, connected: 1 },
      collection: { count: 3 },
      inventory: {
        local: { chat: 12 },
        inbound: [{ pubkey: 'bb', chat: 8 }]
      }
    });
    assert.equal(chatting.state, 'synced');
    assert.match(chatting.label, /Chat syncing/);
    assert.match(chatting.detail, /12 chat here/);
    assert.match(chatting.detail, /8 from siblings/);
  });
});
