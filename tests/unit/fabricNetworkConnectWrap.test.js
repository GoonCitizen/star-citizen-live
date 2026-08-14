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
});
