'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createIdentity } = require('../../functions/identity');
const {
  loadPeerKeySettings,
  hubRpcBase,
  playnetPeers,
  productionPlaynetTarget,
  mintOperatorAdminToken,
  resolveAcceptAdminToken,
  listAcceptAdminTokenCandidates,
  classifyPlaynetPosture,
  extractHubPubkey,
  acceptTrackedWithTokenCascade
} = require('../../functions/playnetDeploy');

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

test('playnetDeploy.mintOperatorAdminToken signs OP_IDENTITY/admin from FABRIC_XPRV', () => {
  const Key = require('@fabric/core/types/key');
  const Token = require('@fabric/core/types/token');
  const master = new Key();
  const minted = mintOperatorAdminToken({ xprv: master.xprv }, { persist: false });
  assert.ok(minted.token && minted.token.includes('.'));
  assert.equal(minted.source, 'operator-master');
  const payload = Token.verifySigned(minted.token, master);
  assert.ok(payload);
  assert.equal(payload.cap, 'OP_IDENTITY');
  assert.equal(payload.sub, 'admin');
});

test('playnetDeploy.listAcceptAdminTokenCandidates prefers env/file then mint', () => {
  const Key = require('@fabric/core/types/key');
  const master = new Key();
  const prev = process.env.FABRIC_HUB_ADMIN_TOKEN;
  try {
    process.env.FABRIC_HUB_ADMIN_TOKEN = 'hub-issued-token';
    const list = listAcceptAdminTokenCandidates({ xprv: master.xprv }, { persist: false });
    assert.ok(list.length >= 2);
    assert.equal(list[0].token, 'hub-issued-token');
    assert.ok(['env', 'file-or-env'].includes(list[0].source));
    assert.equal(list[1].source, 'operator-master');
    const resolved = resolveAcceptAdminToken({ xprv: master.xprv }, { persist: false });
    assert.equal(resolved.token, 'hub-issued-token');
  } finally {
    if (prev === undefined) delete process.env.FABRIC_HUB_ADMIN_TOKEN;
    else process.env.FABRIC_HUB_ADMIN_TOKEN = prev;
  }
});

test('playnetDeploy.acceptTrackedWithTokenCascade tries next candidate after reject', async () => {
  const calls = [];
  const fakeRpc = async (method, params) => {
    calls.push({ method, params });
    const token = params && params.adminToken;
    if (token === 'bad') return { status: 'error', message: 'adminToken invalid' };
    if (token === 'good') return { status: 'success', contractId: params.contractId };
    return { status: 'error', message: 'nope' };
  };
  const result = await acceptTrackedWithTokenCascade({
    contractId: 'abc',
    baseUrl: 'http://127.0.0.1:9',
    candidates: [
      { token: 'bad', source: 'operator-master' },
      { token: 'good', source: 'env' }
    ],
    rpc: fakeRpc
  });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'env');
  assert.deepEqual(result.attempts.map((a) => a.ok), [false, true]);
  assert.equal(calls.length, 2);
});

test('playnetDeploy.classifyPlaynetPosture: operator production vs ambiguous vs adversary', () => {
  const op = classifyPlaynetPosture({
    argv: ['--production'],
    script: 'deploy',
    peers: ['hub.fabric.pub:7777'],
    env: {}
  });
  assert.equal(op.posture, 'operator');
  assert.equal(op.treatAsOperatorPublish, true);
  assert.equal(op.treatAsAdversary, false);

  const adv = classifyPlaynetPosture({
    argv: ['--production'],
    script: 'adversary',
    peers: ['hub.fabric.pub:7777', 'relay.goon.vc:7777'],
    httpTarget: 'https://relay.goon.vc',
    env: { ADV_PRODUCTION: '1' }
  });
  assert.equal(adv.treatAsAdversary, true);

  const ambiguous = classifyPlaynetPosture({
    argv: ['--production', '--adversary'],
    script: 'unknown',
    peers: ['hub.fabric.pub:7777'],
    env: {}
  });
  assert.equal(ambiguous.posture, 'ambiguous');

  // Public hosts, deploy script, no flags → operator publish (local same config)
  const unclear = classifyPlaynetPosture({
    argv: [],
    script: 'deploy',
    peers: ['hub.fabric.pub:7777', 'relay.goon.vc:7777'],
    env: {}
  });
  assert.equal(unclear.posture, 'operator');
  assert.equal(unclear.treatAsOperatorPublish, true);

  // Ambiguous deploy still publishes with local config
  const ambDeploy = classifyPlaynetPosture({
    argv: ['--production', '--adversary'],
    script: 'deploy',
    peers: ['hub.fabric.pub:7777'],
    env: {}
  });
  assert.equal(ambDeploy.posture, 'ambiguous');
  assert.equal(ambDeploy.treatAsOperatorPublish, true);
});

test('playnetDeploy.extractHubPubkey reads compressed and x-only forms', () => {
  assert.equal(
    extractHubPubkey({ pubkey: '02' + 'ab'.repeat(32) }),
    '02' + 'ab'.repeat(32)
  );
  assert.equal(
    extractHubPubkey({ id: 'cd'.repeat(32) }),
    'cd'.repeat(32)
  );
  assert.equal(extractHubPubkey({ id: 'not-a-key' }), null);
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
