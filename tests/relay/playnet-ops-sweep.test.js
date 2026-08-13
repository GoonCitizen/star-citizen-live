'use strict';

/**
 * Playnet one-time ops sweep coverage:
 *   wipe regtest tip → Hub faucet funds → deploy GoonCitizen contracts
 *
 * Always runs offline with injectables / fake Hub.
 * Live Hub+bitcoind (optional):
 *   FABRIC_PLAYNET_SWEEP=1 npm test -- tests/relay/playnet-ops-sweep.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const Key = require('@fabric/core/types/key');

const LiveRelay = require('../../services/LiveRelay');
const hubBitcoinProxy = require('../../functions/hubBitcoinProxy');
const {
  SWEEP_STEPS,
  normalizeSnapshotHash,
  buildFlushChainBody,
  planPlaynetSweep,
  runLocalChainWipe,
  acquireHubFaucetFunds,
  buildGoonCitizenPublishMessage,
  buildAcceptTrackedParams,
  runPlaynetSweep
} = require('../../functions/playnetOpsSweep');
const {
  gooncitizenContractId,
  gooncitizenContractDefinition
} = require('../../contracts/gooncitizen');
const { createIdentity } = require('../../functions/identity');

const BASE = '/services/star-citizen';
const LIVE = process.env.FABRIC_PLAYNET_SWEEP === '1';

function request (port, method, reqPath, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: reqPath,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let body = null;
        try { body = buf ? JSON.parse(buf) : null; } catch (_) { body = { raw: buf }; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}

function startFakeHub (handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let parsed = null;
        try { parsed = body ? JSON.parse(body) : null; } catch (_) { parsed = null; }
        Promise.resolve(handler(req, url, parsed, res)).catch((e) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        });
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, origin: `http://127.0.0.1:${port}` });
    });
  });
}

test('sweep plan orders wipe → faucet → deploy', () => {
  assert.deepStrictEqual(SWEEP_STEPS, ['wipe', 'faucet', 'deploy']);
  const snap = 'ab'.repeat(32);
  const plan = planPlaynetSweep({
    snapshotBlockHash: snap,
    receiveAddress: 'bcrt1qtest',
    faucetAmountSats: 25000,
    accept: true,
    hub: 'http://127.0.0.1:8080'
  });
  assert.deepStrictEqual(plan.steps, SWEEP_STEPS);
  assert.strictEqual(plan.wipe.flushBody.snapshotBlockHash, snap);
  assert.strictEqual(plan.wipe.flushBody.network, 'regtest');
  assert.strictEqual(plan.faucet.amountSats, 25000);
  assert.strictEqual(plan.deploy.contractId, gooncitizenContractId());
  assert.strictEqual(plan.deploy.accept, true);
  assert.strictEqual(plan.deploy.definition.name, gooncitizenContractDefinition().name);
});

test('wipe: snapshot hash validation + flush body', () => {
  assert.throws(() => normalizeSnapshotHash('nope'), /64 hex/);
  assert.throws(() => buildFlushChainBody({ snapshotBlockHash: 'zz' }), /64 hex/);
  const hash = 'cd'.repeat(32);
  const body = buildFlushChainBody({
    snapshotBlockHash: hash,
    network: 'regtest',
    label: 'unit-wipe'
  });
  assert.deepStrictEqual(body, {
    snapshotBlockHash: hash,
    network: 'regtest',
    label: 'unit-wipe'
  });
});

test('wipe: local invalidate walks tip back to snapshot', async () => {
  const genesis = '11'.repeat(32);
  const mid = '22'.repeat(32);
  const tip = '33'.repeat(32);
  const chain = [genesis, mid, tip];
  let cursor = chain.length - 1;
  const result = await runLocalChainWipe(genesis, {
    getBestBlockHash: async () => chain[cursor],
    invalidateBlock: async (hash) => {
      assert.strictEqual(hash, chain[cursor]);
      cursor -= 1;
    }
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.steps, 2);
  assert.strictEqual(result.tip, genesis);
});

test('faucet: acquire from fake local Hub via LiveRelay proxy', async () => {
  const id = createIdentity();
  const recv = hubBitcoinProxy.deriveReceiveAddress(id.xpub, 0, 'regtest');
  assert.ok(recv && recv.address);

  let faucetPosts = 0;
  const hub = await startFakeHub((req, url, parsed, res) => {
    if (req.method === 'OPTIONS' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'FakePlaynetHub',
        services: {
          faucet: {
            available: true,
            network: 'regtest',
            source: 'beacon',
            balanceSats: 5_000_000,
            defaultAmountSats: 10000,
            maxAmountSats: 1_000_000,
            endpointBasePath: '/services/bitcoin/faucet'
          }
        }
      }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/services/bitcoin/faucet') {
      faucetPosts += 1;
      assert.strictEqual(parsed.address, recv.address);
      assert.strictEqual(parsed.amountSats, 10000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        faucet: { txid: 'ee'.repeat(32), amountSats: 10000, address: parsed.address }
      }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  const svc = new LiveRelay({
    port: 0,
    missions: { enable: false },
    fabric: { enable: false },
    bitcoin: { enable: true, hub: hub.origin, network: 'regtest' }
  });
  await svc.start();
  svc.setIdentity(id);
  const port = svc.server.address().port;

  try {
    const disc = await request(port, 'GET', `${BASE}/bitcoin/faucet`);
    assert.strictEqual(disc.status, 200);
    assert.strictEqual(disc.body.data.available, true);

    const pull = await request(port, 'POST', `${BASE}/bitcoin/faucet`, {
      address: recv.address,
      amountSats: 10000
    });
    assert.strictEqual(pull.status, 200, JSON.stringify(pull.body));
    assert.ok(pull.body.data.faucet.txid);
    assert.strictEqual(faucetPosts, 1);

    const viaHelper = await acquireHubFaucetFunds({
      address: recv.address,
      amountSats: 10000,
      hub: hub.origin
    });
    assert.strictEqual(viaHelper.available, true);
    assert.strictEqual(faucetPosts, 2);
  } finally {
    await svc.stop().catch(() => {});
    await new Promise((r) => hub.server.close(r));
  }
});

test('deploy: CONTRACT_PUBLISH message + AcceptTracked params', () => {
  const key = new Key();
  const pub = buildGoonCitizenPublishMessage(key);
  assert.strictEqual(pub.contractId, gooncitizenContractId());
  // Lockstep with hub.fabric.pub/scripts/lib/playnetOps.js fallback.
  assert.strictEqual(
    pub.contractId,
    'e2515747c655eece28f33f03cd353c0ea3f17c6d64219a5451743765c5353ecb'
  );
  assert.ok(pub.hex && pub.hex.length > 64);
  assert.ok(pub.message);
  assert.throws(() => buildAcceptTrackedParams(pub.contractId, ''), /adminToken/);
  const accept = buildAcceptTrackedParams(pub.contractId, 'test-admin-token');
  assert.deepStrictEqual(accept, {
    contractId: pub.contractId,
    adminToken: 'test-admin-token'
  });
});

test('full sweep orchestration with injectable runners', async () => {
  const snap = 'aa'.repeat(32);
  const plan = planPlaynetSweep({
    snapshotBlockHash: snap,
    receiveAddress: 'bcrt1qexample',
    accept: true
  });
  const calls = [];
  const out = await runPlaynetSweep(plan, {
    wipe: async (wipe) => {
      calls.push('wipe');
      assert.strictEqual(wipe.flushBody.snapshotBlockHash, snap);
      return runLocalChainWipe(snap, {
        getBestBlockHash: async () => snap,
        invalidateBlock: async () => { throw new Error('should not invalidate'); }
      });
    },
    faucet: async (faucet) => {
      calls.push('faucet');
      assert.strictEqual(faucet.network, 'regtest');
      return {
        txid: 'ff'.repeat(32),
        address: faucet.address,
        amountSats: faucet.amountSats
      };
    },
    deploy: async (deploy) => {
      calls.push('deploy');
      assert.strictEqual(deploy.contractId, gooncitizenContractId());
      assert.strictEqual(deploy.accept, true);
      const key = new Key();
      const pub = buildGoonCitizenPublishMessage(key, deploy.definition);
      const accept = buildAcceptTrackedParams(pub.contractId, 'tok');
      return { published: true, accept, hexBytes: pub.hex.length / 2 };
    }
  });
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(calls, ['wipe', 'faucet', 'deploy']);
  assert.strictEqual(out.results.wipe.steps, 0);
  assert.ok(out.results.deploy.published);
});

test('live playnet sweep (opt-in FABRIC_PLAYNET_SWEEP=1)', async (t) => {
  if (!LIVE) {
    t.skip('set FABRIC_PLAYNET_SWEEP=1 with local Hub+regtest to exercise live wipe/faucet/deploy');
    return;
  }
  const hub = String(process.env.FABRIC_HUB_RPC_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
  // Best-effort: discover faucet; skip if Hub down.
  let discovered;
  try {
    discovered = await hubBitcoinProxy.discoverFaucet({ hub, network: 'regtest' });
  } catch (e) {
    t.skip(`Hub unreachable: ${e.message}`);
    return;
  }
  if (!discovered.available) {
    t.skip(`Hub faucet not available (${discovered.reason || 'unknown'})`);
    return;
  }
  const id = createIdentity();
  const recv = hubBitcoinProxy.deriveReceiveAddress(id.xpub, 0, 'regtest');
  const funded = await acquireHubFaucetFunds({
    hub,
    address: recv.address,
    amountSats: discovered.faucet.defaultAmountSats || 10000
  });
  assert.ok(funded.result);
  const pub = buildGoonCitizenPublishMessage(new Key());
  assert.strictEqual(pub.contractId, gooncitizenContractId());
});
