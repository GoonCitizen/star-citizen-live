'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createIdentity } = require('../../functions/identity');
const { loadPeerKeySettings, hubRpcBase, playnetPeers, productionPlaynetTarget } = require('../../functions/playnetDeploy');

test('playnetDeploy.loadPeerKeySettings prefers FABRIC_XPRV', () => {
  const id = createIdentity();
  const prevX = process.env.FABRIC_XPRV;
  const prevS = process.env.FABRIC_SEED;
  try {
    process.env.FABRIC_XPRV = id.xprv;
    process.env.FABRIC_SEED = 'should-not-win';
    const key = loadPeerKeySettings({ allowLocalIdentityFallback: false });
    assert.ok(key && key.xprv === id.xprv);
  } finally {
    if (prevX === undefined) delete process.env.FABRIC_XPRV;
    else process.env.FABRIC_XPRV = prevX;
    if (prevS === undefined) delete process.env.FABRIC_SEED;
    else process.env.FABRIC_SEED = prevS;
  }
});

test('playnetDeploy.hubRpcBase and playnetPeers', () => {
  const prev = process.env.FABRIC_HUB_RPC_URL;
  const prevP = process.env.FABRIC_PLAYNET_PEERS;
  try {
    process.env.FABRIC_HUB_RPC_URL = 'http://127.0.0.1:28380/';
    assert.strictEqual(hubRpcBase(), 'http://127.0.0.1:28380');
    process.env.FABRIC_PLAYNET_PEERS = 'a:1, b:2';
    assert.deepStrictEqual(playnetPeers(), ['a:1', 'b:2']);
    assert.deepStrictEqual(playnetPeers(['127.0.0.1:7777']), ['127.0.0.1:7777']);
  } finally {
    if (prev === undefined) delete process.env.FABRIC_HUB_RPC_URL;
    else process.env.FABRIC_HUB_RPC_URL = prev;
    if (prevP === undefined) delete process.env.FABRIC_PLAYNET_PEERS;
    else process.env.FABRIC_PLAYNET_PEERS = prevP;
  }
});

test('playnetDeploy.productionPlaynetTarget defaults to public hub + relay', () => {
  const prevU = process.env.FABRIC_HUB_RPC_URL;
  const prevH = process.env.FABRIC_HUB_URL;
  const prevP = process.env.FABRIC_PLAYNET_PEERS;
  const prevF = process.env.FABRIC_FLUSH_PEERS;
  try {
    delete process.env.FABRIC_HUB_RPC_URL;
    delete process.env.FABRIC_HUB_URL;
    delete process.env.FABRIC_PLAYNET_PEERS;
    delete process.env.FABRIC_FLUSH_PEERS;
    const t = productionPlaynetTarget();
    assert.equal(t.hubUrl, 'https://hub.fabric.pub');
    assert.deepEqual(t.peers, ['hub.fabric.pub:7777', 'relay.goon.vc:7777']);
  } finally {
    if (prevU === undefined) delete process.env.FABRIC_HUB_RPC_URL;
    else process.env.FABRIC_HUB_RPC_URL = prevU;
    if (prevH === undefined) delete process.env.FABRIC_HUB_URL;
    else process.env.FABRIC_HUB_URL = prevH;
    if (prevP === undefined) delete process.env.FABRIC_PLAYNET_PEERS;
    else process.env.FABRIC_PLAYNET_PEERS = prevP;
    if (prevF === undefined) delete process.env.FABRIC_FLUSH_PEERS;
    else process.env.FABRIC_FLUSH_PEERS = prevF;
  }
});
