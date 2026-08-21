'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const FabricNetwork = require('../../services/FabricNetwork');

describe('FabricNetwork _wrapPeerConnect', () => {
  it('rewrites stale hub NIC :7778 before core _connect', () => {
    const net = new FabricNetwork({
      enable: false,
      listen: false,
      peers: [],
      peersDb: null,
      port: 7777,
      advertiseHost: null
    });
    const dials = [];
    const peer = { _connect (addr) { dials.push(addr); } };
    net._wrapPeerConnect(peer);
    peer._connect('65.21.231.149:7778');
    peer._connect('65.21.231.166:7778');
    assert.deepEqual(dials, ['relay.goon.vc:7777', 'hub.fabric.pub:7777']);
  });

  it('skips self relay NIC when advertiseHost is set', () => {
    const net = new FabricNetwork({
      enable: false,
      listen: false,
      peers: [],
      peersDb: null,
      port: 7777,
      advertiseHost: 'relay.goon.vc'
    });
    const dials = [];
    const peer = { _connect (addr) { dials.push(addr); } };
    net._wrapPeerConnect(peer);
    peer._connect('65.21.231.149:7778');
    assert.deepEqual(dials, []);
  });

  it('dialClusterCandidates enqueues LAN peers and skips hubs', () => {
    const net = new FabricNetwork({
      enable: false,
      listen: false,
      peers: [],
      peersDb: null,
      port: 7777,
      advertiseHost: null
    });
    const enqueued = [];
    net._peer = {
      _enqueuePeeringCandidate (h, p) { enqueued.push(`${h}:${p}`); },
      _fillPeerSlots () { return 0; }
    };
    const queued = net.dialClusterCandidates([
      '192.168.1.40:7777',
      'hub.fabric.pub:7777',
      '127.0.0.1:7777'
    ], { pubkey: 'ab'.repeat(32) });
    assert.deepEqual(queued, ['192.168.1.40:7777']);
    assert.deepEqual(enqueued, ['192.168.1.40:7777']);
  });
});
