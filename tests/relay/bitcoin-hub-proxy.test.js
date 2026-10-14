'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const hubBitcoinProxy = require('../../functions/hubBitcoinProxy');
const { createIdentity } = require('../../functions/identity');

const BASE = '/services/star-citizen';

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

test('hubBitcoinProxy.deriveReceiveAddress: BIP44 with xprv matches Hub faucet path', () => {
  const id = createIdentity();
  const got = hubBitcoinProxy.deriveReceiveAddress(id.xpub, 0, 'regtest', { xprv: id.xprv });
  assert.ok(got);
  assert.match(got.address, /^bcrt1/);
  assert.strictEqual(got.path, "m/44'/0'/0'/0/0");
  assert.ok(got.accountXpub && got.accountXpub.startsWith('xpub'));
  const watch = hubBitcoinProxy.bitcoinWatchXpubFromIdentity(id);
  assert.strictEqual(watch, got.accountXpub);
  const legacy = hubBitcoinProxy.deriveReceiveAddress(id.xpub, 0, 'regtest');
  assert.ok(legacy);
  assert.notStrictEqual(legacy.address, got.address);
});

test('hubBitcoinProxy.deriveReceiveAddress: Fabric xpub → bcrt1 on regtest', () => {
  const id = createIdentity();
  const got = hubBitcoinProxy.deriveReceiveAddress(id.xpub, 0, 'regtest');
  assert.ok(got);
  assert.match(got.address, /^bcrt1/);
  assert.strictEqual(got.index, 0);
});

test('bitcoin.enable false → /bitcoin/* returns 503', async () => {
  const svc = new LiveRelay({
    port: 0,
    missions: { enable: false },
    fabric: { enable: false },
    bitcoin: { enable: false, hub: 'http://127.0.0.1:9' }
  });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const res = await request(port, 'GET', `${BASE}/bitcoin/status`);
    assert.strictEqual(res.status, 503);
    assert.match(String(res.body.error || ''), /disabled/i);
  } finally {
    await svc.stop();
  }
});

test('bitcoin.enable true → status/wallet/receive/transactions/send via mock Hub', async () => {
  const id = createIdentity();
  const fake = await startFakeHub((req, url, body, res) => {
    const json = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'OPTIONS' && url.pathname === '/') {
      return json(200, {
        '@type': 'ApplicationResourceContract',
        name: 'hub.fabric.pub',
        services: {
          peering: { endpointBasePath: '/services/peering' },
          faucet: {
            kind: 'BitcoinFaucet',
            source: 'beacon',
            network: 'regtest',
            endpointBasePath: '/services/bitcoin/faucet',
            method: 'POST',
            available: true,
            funded: true,
            balanceSats: 500000,
            maxAmountSats: 1000000,
            defaultAmountSats: 10000
          }
        }
      });
    }
    if (req.method === 'GET' && url.pathname === '/services/bitcoin') {
      return json(200, { available: true, status: 'ONLINE', network: 'regtest' });
    }
    if (req.method === 'GET' && url.pathname === '/services/bitcoin/xpub') {
      assert.ok(url.searchParams.get('xpub'));
      return json(200, { balanceSats: 12345, confirmedSats: 12345, unconfirmedSats: 0 });
    }
    if (req.method === 'GET' && url.pathname === '/services/bitcoin/xpub/transactions') {
      return json(200, {
        network: 'regtest',
        transactions: [{ txid: 'ab'.repeat(32), confirmations: 1, ourAmount: 0.0001 }]
      });
    }
    if (req.method === 'GET' && url.pathname === '/services/bitcoin/xpub/utxos') {
      assert.ok(url.searchParams.get('xpub'));
      return json(200, {
        network: 'regtest',
        utxos: [{ txid: 'ab'.repeat(32), vout: 0, amountSats: 12345 }]
      });
    }
    if (req.method === 'POST' && url.pathname === '/payments') {
      assert.ok(body && body.adminToken === 'test-admin');
      assert.ok(body.to);
      return json(200, { txid: 'cd'.repeat(32), amountSats: body.amountSats });
    }
    if (req.method === 'POST' && url.pathname === '/services/bitcoin/faucet') {
      assert.ok(body && body.address);
      return json(200, {
        status: 'success',
        network: 'regtest',
        source: 'beacon',
        faucet: {
          txid: 'ef'.repeat(32),
          destination: body.address,
          amountSats: body.amountSats || 10000
        }
      });
    }
    return json(404, { error: 'not found', path: url.pathname });
  });

  const svc = new LiveRelay({
    port: 0,
    missions: { enable: false },
    fabric: { enable: false },
    bitcoin: {
      enable: true,
      hub: fake.origin,
      network: 'regtest',
      adminToken: 'test-admin'
    }
  });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const settings = await request(port, 'GET', '/settings');
    assert.strictEqual(settings.status, 200);
    assert.strictEqual(settings.body.runtime.bitcoin.enable, true);
    assert.strictEqual(settings.body.runtime.bitcoin.hub, fake.origin);

    const status = await request(port, 'GET', `${BASE}/bitcoin/status`);
    assert.strictEqual(status.status, 200);
    assert.strictEqual(status.body.data.status, 'ONLINE');

    const wallet = await request(port, 'GET',
      `${BASE}/bitcoin/wallet?xpub=${encodeURIComponent(id.xpub)}`);
    assert.strictEqual(wallet.status, 200);
    assert.strictEqual(wallet.body.data.balanceSats, 12345);

    const recv = await request(port, 'GET',
      `${BASE}/bitcoin/receive?xpub=${encodeURIComponent(id.xpub)}&index=0`);
    assert.strictEqual(recv.status, 200);
    assert.match(recv.body.data.address, /^bcrt1/);

    const txs = await request(port, 'GET',
      `${BASE}/bitcoin/transactions?xpub=${encodeURIComponent(id.xpub)}`);
    assert.strictEqual(txs.status, 200);
    assert.strictEqual(txs.body.data.transactions.length, 1);

    const utxos = await request(port, 'GET',
      `${BASE}/bitcoin/utxos?xpub=${encodeURIComponent(id.xpub)}`);
    assert.strictEqual(utxos.status, 200);
    assert.strictEqual(utxos.body.data.utxos.length, 1);
    assert.strictEqual(utxos.body.data.utxos[0].amountSats, 12345);

    const faucetDisc = await request(port, 'GET', `${BASE}/bitcoin/faucet`);
    assert.strictEqual(faucetDisc.status, 200);
    assert.strictEqual(faucetDisc.body.data.available, true);
    assert.strictEqual(faucetDisc.body.data.faucet.source, 'beacon');
    assert.strictEqual(faucetDisc.body.data.faucet.balanceSats, 500000);

    const faucetPull = await request(port, 'POST', `${BASE}/bitcoin/faucet`, {
      address: recv.body.data.address,
      amountSats: 2500
    });
    assert.strictEqual(faucetPull.status, 200);
    assert.ok(faucetPull.body.data.faucet.txid);

    const send = await request(port, 'POST', `${BASE}/bitcoin/send`, {
      to: recv.body.data.address,
      amountSats: 1000,
      xpub: id.xpub
    });
    assert.strictEqual(send.status, 200);
    assert.ok(send.body.data.txid);
  } finally {
    await svc.stop();
    await new Promise((r) => fake.server.close(r));
  }
});

test('faucet discovery hidden when Hub OPTIONS omits faucet (signet/mainnet style)', async () => {
  const fake = await startFakeHub((req, url, _body, res) => {
    const json = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'OPTIONS' && url.pathname === '/') {
      return json(200, {
        '@type': 'ApplicationResourceContract',
        name: 'hub.fabric.pub',
        services: { peering: { endpointBasePath: '/services/peering' } }
      });
    }
    return json(404, { error: 'not found' });
  });

  const discovered = await hubBitcoinProxy.discoverFaucet({
    hub: fake.origin,
    network: 'regtest'
  });
  assert.strictEqual(discovered.available, false);
  assert.strictEqual(discovered.reason, 'faucet_not_advertised');

  const signet = await hubBitcoinProxy.discoverFaucet({
    hub: fake.origin,
    network: 'signet'
  });
  assert.strictEqual(signet.available, false);
  assert.strictEqual(signet.reason, 'network_not_regtest');

  await new Promise((r) => fake.server.close(r));
});

test('faucetFromOptionsDocument rejects mainnet advertisements', () => {
  assert.strictEqual(hubBitcoinProxy.faucetFromOptionsDocument({
    services: {
      faucet: {
        available: true,
        network: 'mainnet',
        endpointBasePath: '/services/bitcoin/faucet'
      }
    }
  }), null);
  assert.ok(hubBitcoinProxy.faucetFromOptionsDocument({
    services: {
      faucet: {
        available: true,
        network: 'regtest',
        endpointBasePath: '/services/bitcoin/faucet',
        balanceSats: 1
      }
    }
  }));
});
