'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const FabricNetwork = require('../../services/FabricNetwork');
const LiveRelay = require('../../services/LiveRelay');

test('isSelfFabricAddress: loopback only matches listen port', () => {
  assert.strictEqual(FabricNetwork.isSelfFabricAddress('127.0.0.1:7777', 7777), true);
  assert.strictEqual(FabricNetwork.isSelfFabricAddress('127.0.0.1:7778', 7777), false);
  assert.strictEqual(FabricNetwork.isSelfFabricAddress('hub.fabric.pub:7777', 7777), false);
});

test('isSelfFabricAddress: advertiseHost and ownHosts are self (any port)', () => {
  assert.strictEqual(
    FabricNetwork.isSelfFabricAddress('relay.goon.vc:7777', {
      listenPort: 7777,
      advertiseHost: 'relay.goon.vc',
      includeLocalInterfaces: false
    }),
    true
  );
  assert.strictEqual(
    FabricNetwork.isSelfFabricAddress('relay.goon.vc:7778', {
      listenPort: 7777,
      advertiseHost: 'relay.goon.vc',
      includeLocalInterfaces: false
    }),
    true
  );
  assert.strictEqual(
    FabricNetwork.isSelfFabricAddress('hub.fabric.pub:7777', {
      listenPort: 7777,
      advertiseHost: 'relay.goon.vc',
      includeLocalInterfaces: false
    }),
    false
  );
  assert.strictEqual(
    FabricNetwork.isSelfFabricAddress('65.21.231.166:7778', {
      listenPort: 7777,
      ownHosts: ['65.21.231.166'],
      includeLocalInterfaces: false,
      resolveDns: false
    }),
    true
  );
});

test('_isOwnFabricPubkeyHex matches identity', async () => {
  const { createIdentity } = require('../../functions/identity');
  const id = createIdentity();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-own-pk-'));
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    missions: { enable: false },
    fabric: { enable: false },
    peers: []
  });
  await svc.start();
  try {
    svc._identity = id;
    assert.strictEqual(svc._isOwnFabricPubkeyHex(id.pubkey), true);
    assert.strictEqual(svc._isOwnFabricPubkeyHex('ab'.repeat(32)), false);
    svc.peers = [
      { id: 'x', address: 'evil.example:7777', enabled: true, expectedPubkey: id.pubkey }
    ];
    assert.deepStrictEqual(svc._fabricPeerAddresses(), []);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('heal roster drops self hub seed when fabricAdvertiseHost matches', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-self-hub-'));
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    missions: { enable: false },
    fabric: { enable: false },
    peers: []
  });
  await svc.start();
  try {
    svc._fabricAdvertiseHost = 'relay.goon.vc';
    svc.settings.fabric = Object.assign({}, svc.settings.fabric, { port: 7777 });
    svc.peers = [
      { id: 'a', address: 'hub.fabric.pub:7777', enabled: true },
      { id: 'b', address: 'relay.goon.vc:7777', enabled: true }
    ];
    const healed = svc._healPeerRoster({ persist: true, forceHubs: true });
    assert.ok(healed.removed.includes('relay.goon.vc:7777'));
    assert.deepStrictEqual(
      svc.peers.map((p) => p.address).sort(),
      ['hub.fabric.pub:7777']
    );
    assert.deepStrictEqual(svc._fabricPeerAddresses(), ['hub.fabric.pub:7777']);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /peers rejects self when advertiseHost is set', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-self-post-'));
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    missions: { enable: false },
    fabric: { enable: false },
    peers: []
  });
  await svc.start();
  const port = svc.server.address().port;
  svc._fabricAdvertiseHost = 'relay.goon.vc';
  try {
    const body = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/peers',
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
      });
      req.on('error', reject);
      req.write(JSON.stringify({ address: 'relay.goon.vc:7777' }));
      req.end();
    });
    assert.strictEqual(body.status, 400);
    assert.match(String(body.body.error || ''), /self/i);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
