'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const settingsStore = require('../../functions/settingsStore');
const { Store } = require('../../types/Store');
const { createIdentity } = require('../../functions/identity');

function request (port, method, reqPath, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-settings-'));
}

test('settingsStore round-trips allowlisted keys on the Fabric Store and rejects unknown ones', async () => {
  const dir = tmpDir();
  const registerDir = path.join(dir, 'register');
  const store = new Store({ path: registerDir });
  await store.start();

  settingsStore.putSetting(store, 'logfile', 'C:/Games/SC/LIVE/Game.log');
  settingsStore.putSetting(store, 'peers', [{ id: 'x', url: 'https://goon.vc' }]);
  const loaded = settingsStore.loadSettings(store);
  assert.strictEqual(loaded.logfile, 'C:/Games/SC/LIVE/Game.log');
  assert.strictEqual(loaded.peers.length, 1);
  assert.throws(() => settingsStore.putSetting(store, 'evil', 1), /unknown setting/);

  settingsStore.putSetting(store, 'identityAutoLockMinutes', 15);
  assert.strictEqual(settingsStore.loadSettings(store).identityAutoLockMinutes, 15);
  // null removes
  settingsStore.putSetting(store, 'logfile', null);
  assert.strictEqual(settingsStore.loadSettings(store).logfile, undefined);
  await store.stop();

  // Values survive a Store reopen (LevelDB, not a JSON file on disk).
  assert.ok(!fs.existsSync(path.join(dir, 'settings.json')), 'no settings.json is written');
  const reopened = new Store({ path: registerDir });
  await reopened.start();
  assert.strictEqual(settingsStore.loadSettings(reopened).identityAutoLockMinutes, 15);
  assert.strictEqual(settingsStore.loadSettings(reopened).logfile, undefined);
  await reopened.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('nickname setting sanitizes and round-trips; empty clears', async () => {
  const dir = tmpDir();
  const store = new Store({ path: path.join(dir, 'register') });
  await store.start();
  assert.ok(settingsStore.ALLOWED_KEYS.includes('nickname'));
  settingsStore.putSetting(store, 'nickname', '  Neorion  ');
  assert.strictEqual(settingsStore.loadSettings(store).nickname, 'Neorion');
  settingsStore.putSetting(store, 'nickname', 'x'.repeat(64));
  assert.strictEqual(settingsStore.loadSettings(store).nickname.length, settingsStore.NICKNAME_MAX);
  settingsStore.putSetting(store, 'nickname', '');
  assert.strictEqual(settingsStore.loadSettings(store).nickname, undefined);
  assert.strictEqual(settingsStore.sanitizeNickname('  a\nb  '), 'a b');
  await store.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('desktop notification settings round-trip on the Fabric Store', async () => {
  const dir = tmpDir();
  const store = new Store({ path: path.join(dir, 'register') });
  await store.start();
  for (const key of ['notifyDesktop', 'notifyChatGlobal', 'notifyChatGroups', 'notifyWhenFocused']) {
    assert.ok(settingsStore.ALLOWED_KEYS.includes(key), key);
  }
  settingsStore.putSetting(store, 'notifyDesktop', false);
  settingsStore.putSetting(store, 'notifyChatGlobal', true);
  settingsStore.putSetting(store, 'notifyChatGroups', false);
  settingsStore.putSetting(store, 'notifyWhenFocused', true);
  const loaded = settingsStore.loadSettings(store);
  assert.strictEqual(loaded.notifyDesktop, false);
  assert.strictEqual(loaded.notifyChatGlobal, true);
  assert.strictEqual(loaded.notifyChatGroups, false);
  assert.strictEqual(loaded.notifyWhenFocused, true);
  await store.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('legacy settings.json is imported into the Fabric Store once, then retired', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ logfile: '/legacy/Game.log', evil: 1 }) + '\n');

  const store = new Store({ path: path.join(dir, 'register') });
  await store.start();
  assert.strictEqual(settingsStore.loadSettings(store).logfile, '/legacy/Game.log');
  assert.ok(!fs.existsSync(path.join(dir, 'settings.json')), 'legacy file retired');
  assert.ok(fs.existsSync(path.join(dir, 'settings.json.migrated')), 'renamed .migrated');
  await store.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('GET /settings and PUT /settings/:name persist and flag restarts', async () => {
  const dir = tmpDir();
  const svc = new LiveRelay({ port: 0, settingsDir: dir, missions: { enable: false } });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const list = await request(port, 'GET', '/settings');
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.success, true);
    assert.strictEqual(list.body.editable, true);
    assert.ok(list.body.runtime);

    const put = await request(port, 'PUT', '/settings/logfile', { value: '/tmp/Game.log' });
    assert.strictEqual(put.status, 200);
    assert.strictEqual(put.body.requiresRestart, true, 'log path applies on restart');
    assert.strictEqual(settingsStore.loadSettings(svc.registerStore).logfile, '/tmp/Game.log');
    assert.ok(!fs.existsSync(path.join(dir, 'settings.json')), 'settings are in the Fabric Store, not JSON');

    const bad = await request(port, 'PUT', '/settings/nonsense', { value: 1 });
    assert.strictEqual(bad.status, 400);
  } finally { await svc.stop(); }
});

test('peer management: add, toggle, remove — persisted and live-applied', async () => {
  const dir = tmpDir();
  const svc = new LiveRelay({ port: 0, settingsDir: dir, missions: { enable: false }, peers: [], fabric: { enable: false } });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const added = await request(port, 'POST', '/peers', { address: 'relay.goon.vc:7777', label: 'org hub' });
    assert.strictEqual(added.status, 200);
    assert.strictEqual(added.body.data.address, 'relay.goon.vc:7777');
    const id = added.body.data.id;

    const dup = await request(port, 'POST', '/peers', { address: 'relay.goon.vc:7777' });
    assert.strictEqual(dup.status, 400);
    const badUrl = await request(port, 'POST', '/peers', { url: 'https://goon.vc' });
    assert.strictEqual(badUrl.status, 400);

    assert.strictEqual(settingsStore.loadSettings(svc.registerStore).peers.length, 1, 'persisted');

    const toggled = await request(port, 'POST', `/peers/${id}`, { enabled: false });
    assert.strictEqual(toggled.body.data.enabled, false);
    assert.strictEqual(svc._uplinkTargets().length, 0, 'disabled peer is not a target');

    await request(port, 'POST', `/peers/${id}`, { enabled: true });
    assert.strictEqual(svc._uplinkTargets().length, 1);

    const removed = await request(port, 'DELETE', `/peers/${id}`);
    assert.strictEqual(removed.status, 200);
    assert.strictEqual(settingsStore.loadSettings(svc.registerStore).peers.length, 0);
    assert.strictEqual((await request(port, 'GET', '/peers')).body.data.length, 0);
  } finally { await svc.stop(); }
});

test('peers persist across relay restarts via the Fabric Store', async () => {
  const dir = tmpDir();
  const boot = async () => {
    const svc = new LiveRelay({ port: 0, settingsDir: dir, missions: { enable: false }, peers: [], fabric: { enable: false } });
    await svc.start();
    return svc;
  };

  const first = await boot();
  try {
    const added = await request(first.server.address().port, 'POST', '/peers', { address: 'relay.goon.vc:7777', label: 'org hub' });
    assert.strictEqual(added.status, 200);
  } finally { await first.stop(); }

  const second = await boot();
  try {
    const peers = (await request(second.server.address().port, 'GET', '/peers')).body.data;
    assert.strictEqual(peers.length, 1, 'peer reloaded from the Fabric Store');
    assert.strictEqual(peers[0].address, 'relay.goon.vc:7777');
  } finally { await second.stop(); }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('settings/peers API is not exposed in hosted server mode', async () => {
  const svc = new LiveRelay({ port: 0, mode: 'server', settingsDir: tmpDir(), missions: { enable: false } });
  await svc.start();
  const port = svc.server.address().port;
  try {
    assert.strictEqual((await request(port, 'GET', '/settings')).status, 404);
    assert.strictEqual((await request(port, 'POST', '/peers', { address: 'x.example:7777' })).status, 404);
  } finally { await svc.stop(); }
});

test('SCEventBatch over Fabric delivers log events to a peer', async () => {
  const identity = createIdentity();
  const peerId = createIdentity();
  const fabA = 22000 + Math.floor(Math.random() * 3000);
  const fabB = fabA + 1;
  const dir = tmpDir();
  const dirB = tmpDir();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, timeoutMs = 20000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await fn()) return true;
      await sleep(100);
    }
    throw new Error('timeout');
  };

  // Seed the peer in constructor settings — POST /peers rejects loopback (127.0.0.1)
  // by design; local Fabric tests must dial via the LiveRelay peers list like fabric-peer.test.js.
  const serverA = new LiveRelay({
    port: 0,
    settingsDir: dirB,
    missions: { enable: false },
    peers: [],
    fabric: { enable: true, listen: true, port: fabB, peers: [], peersDb: null, relayAppMessages: true }
  });
  await serverA.start();
  serverA.setIdentity(peerId);
  await waitFor(() => serverA.fabricNetwork && serverA.fabricNetwork.ready);
  const portA = serverA.server.address().port;

  const client = new LiveRelay({
    port: 0,
    settingsDir: dir,
    missions: { enable: false },
    uplink: { intervalMs: 60000 },
    peers: [{
      address: `127.0.0.1:${fabB}`,
      label: 'peer-b',
      enabled: true,
      shareLogs: true
    }],
    fabric: { enable: true, listen: true, port: fabA, peers: [], peersDb: null }
  });
  await client.start();
  client.setIdentity(identity);
  await waitFor(() => client.fabricNetwork && client.fabricNetwork.ready);
  await waitFor(() => (
    client.fabricNetwork.status().fabricConnected >= 1 ||
    serverA.fabricNetwork.status().fabricConnected >= 1
  ));
  const clientPort = client.server.address().port;

  try {
    // Opt-in shareLogs is already true on the seeded peer; patch confirms the API path.
    const peerList = await request(clientPort, 'GET', '/peers');
    const roster = peerList.body.data.find((p) => String(p.address).includes(String(fabB)));
    assert.ok(roster, 'seeded peer present on roster');
    assert.strictEqual(roster.shareLogs, true);
    await request(clientPort, 'POST', `/peers/${roster.id}`, { shareLogs: true });

    client.handleLogChange("<2026-07-19T13:00:00.000Z> [Notice] <Actor Death> CActor::Kill: 'V' [1] in zone 'Z' killed by 'K' [2] using 'G' [Class R] with damage type 'B' from direction x: 0.1, y: 0.2, z: 0.3");
    assert.ok(client._uplinkQueue.length >= 1);
    await client._flushUplink();
    await waitFor(() => serverA.kills.length >= 1);

    const killsA = await request(portA, 'GET', '/services/star-citizen/kills');
    assert.strictEqual(killsA.body.data.length, 1, 'peer received the kill');
    assert.strictEqual(client._uplinkQueue.length, 0);
  } finally {
    await client.stop();
    await serverA.stop();
  }
});
