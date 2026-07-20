'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const settingsStore = require('../../functions/settingsStore');
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

test('settingsStore round-trips allowlisted keys and rejects unknown ones', () => {
  const dir = tmpDir();
  settingsStore.putSetting(dir, 'logfile', 'C:/Games/SC/LIVE/Game.log');
  settingsStore.putSetting(dir, 'peers', [{ id: 'x', url: 'https://goon.vc' }]);
  const loaded = settingsStore.loadSettings(dir);
  assert.strictEqual(loaded.logfile, 'C:/Games/SC/LIVE/Game.log');
  assert.strictEqual(loaded.peers.length, 1);
  assert.throws(() => settingsStore.putSetting(dir, 'evil', 1), /unknown setting/);
  // null removes
  settingsStore.putSetting(dir, 'logfile', null);
  assert.strictEqual(settingsStore.loadSettings(dir).logfile, undefined);
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
    assert.strictEqual(settingsStore.loadSettings(dir).logfile, '/tmp/Game.log');

    const bad = await request(port, 'PUT', '/settings/nonsense', { value: 1 });
    assert.strictEqual(bad.status, 400);
  } finally { await svc.stop(); }
});

test('peer management: add, toggle, remove — persisted and live-applied', async () => {
  const dir = tmpDir();
  const svc = new LiveRelay({ port: 0, settingsDir: dir, missions: { enable: false } });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const added = await request(port, 'POST', '/peers', { url: 'https://goon.vc/', label: 'org hub' });
    assert.strictEqual(added.status, 200);
    assert.strictEqual(added.body.data.url, 'https://goon.vc', 'trailing slash trimmed');
    const id = added.body.data.id;

    const dup = await request(port, 'POST', '/peers', { url: 'https://goon.vc' });
    assert.strictEqual(dup.status, 400);
    const badUrl = await request(port, 'POST', '/peers', { url: 'ftp://nope' });
    assert.strictEqual(badUrl.status, 400);

    assert.strictEqual(settingsStore.loadSettings(dir).peers.length, 1, 'persisted');

    const toggled = await request(port, 'POST', `/peers/${id}`, { enabled: false });
    assert.strictEqual(toggled.body.data.enabled, false);
    assert.strictEqual(svc._uplinkTargets().length, 0, 'disabled peer is not a target');

    await request(port, 'POST', `/peers/${id}`, { enabled: true });
    assert.strictEqual(svc._uplinkTargets().length, 1);

    const removed = await request(port, 'DELETE', `/peers/${id}`);
    assert.strictEqual(removed.status, 200);
    assert.strictEqual(settingsStore.loadSettings(dir).peers.length, 0);
    assert.strictEqual((await request(port, 'GET', '/peers')).body.data.length, 0);
  } finally { await svc.stop(); }
});

test('settings/peers API is not exposed in hosted server mode', async () => {
  const svc = new LiveRelay({ port: 0, mode: 'server', settingsDir: tmpDir(), missions: { enable: false } });
  await svc.start();
  const port = svc.server.address().port;
  try {
    assert.strictEqual((await request(port, 'GET', '/settings')).status, 404);
    assert.strictEqual((await request(port, 'POST', '/peers', { url: 'https://x.example' })).status, 404);
  } finally { await svc.stop(); }
});

test('multi-peer uplink: batch lands on every enabled peer; retry only when all fail', async () => {
  const identity = createIdentity();

  const serverA = new LiveRelay({ port: 0, mode: 'server', missions: { enable: false } });
  const serverB = new LiveRelay({ port: 0, mode: 'server', missions: { enable: false } });
  await serverA.start(); await serverB.start();
  const portA = serverA.server.address().port;
  const portB = serverB.server.address().port;

  const dir = tmpDir();
  const client = new LiveRelay({ port: 0, settingsDir: dir, missions: { enable: false }, uplink: { intervalMs: 60000 } });
  await client.start();
  const clientPort = client.server.address().port;
  try {
    await request(clientPort, 'POST', '/peers', { url: `http://127.0.0.1:${portA}` });
    await request(clientPort, 'POST', '/peers', { url: `http://127.0.0.1:${portB}` });
    client.setIdentity(identity);
    assert.ok(client._uplinkTimer, 'uplink starts once identity + peers exist');

    client.handleLogChange("<2026-07-19T13:00:00.000Z> [Notice] <Actor Death> CActor::Kill: 'V' [1] in zone 'Z' killed by 'K' [2] using 'G' [Class R] with damage type 'B' from direction x: 0.1, y: 0.2, z: 0.3");
    await client._flushUplink();

    const killsA = await request(portA, 'GET', '/services/star-citizen/kills');
    const killsB = await request(portB, 'GET', '/services/star-citizen/kills');
    assert.strictEqual(killsA.body.data.length, 1, 'peer A received the kill');
    assert.strictEqual(killsB.body.data.length, 1, 'peer B received the kill');
    assert.strictEqual(killsA.body.data[0].id, killsB.body.data[0].id, 'same content id on both peers');
    assert.strictEqual(client._uplinkQueue.length, 0);

    // One peer down: batch still delivered to the live peer, queue drained.
    await serverB.stop();
    client.handleLogChange("<2026-07-19T13:05:00.000Z> [Notice] <Actor Death> CActor::Kill: 'V2' [3] in zone 'Z' killed by 'K' [2] using 'G' [Class R] with damage type 'B' from direction x: 0.1, y: 0.2, z: 0.3");
    await client._flushUplink();
    assert.strictEqual((await request(portA, 'GET', '/services/star-citizen/kills')).body.data.length, 2);
    assert.strictEqual(client._uplinkQueue.length, 0, 'delivered to at least one peer -> drained');
    const peers = (await request(clientPort, 'GET', '/peers')).body.data;
    const down = peers.find((p) => p.url.includes(String(portB)));
    assert.ok(down.lastError, 'dead peer records an error');

    // All peers down: events are requeued.
    await serverA.stop();
    client.handleLogChange("<2026-07-19T13:10:00.000Z> [Notice] <Actor Death> CActor::Kill: 'V3' [4] in zone 'Z' killed by 'K' [2] using 'G' [Class R] with damage type 'B' from direction x: 0.1, y: 0.2, z: 0.3");
    await client._flushUplink();
    assert.ok(client._uplinkQueue.length >= 1, 'all peers failed -> requeued');
  } finally {
    await client.stop();
    try { await serverA.stop(); } catch (_) { /* already stopped */ }
    try { await serverB.stop(); } catch (_) { /* already stopped */ }
  }
});
