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
const { createIdentity, pubkeyXOnly } = require('../../functions/identity');

function request (port, method, reqPath, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: reqPath,
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let body = null;
        try { body = buf ? JSON.parse(buf) : null; } catch (_) { body = buf; }
        resolve({ status: res.statusCode, body, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-primary-'));
}

test('settingsStore sanitizes primaryGroupId and groupOverlay', async () => {
  const dir = tmpDir();
  const store = new Store({ path: path.join(dir, 'register') });
  await store.start();
  settingsStore.putSetting(store, 'primaryGroupId', 'abcdef0123456789');
  settingsStore.putSetting(store, 'groupOverlay', true);
  const loaded = settingsStore.loadSettings(store);
  assert.strictEqual(loaded.primaryGroupId, 'abcdef0123456789');
  assert.strictEqual(loaded.groupOverlay, true);
  assert.strictEqual(settingsStore.sanitizePrimaryGroupId('bad'), null);
  assert.strictEqual(settingsStore.sanitizePrimaryGroupId(''), null);
  settingsStore.putSetting(store, 'primaryGroupId', null);
  assert.strictEqual(settingsStore.loadSettings(store).primaryGroupId, undefined);
});

test('GET overlay/primary-group returns members + ships for primary group', async () => {
  const alice = createIdentity();
  const bob = createIdentity();
  const dir = tmpDir();
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    missions: { enable: true, officers: [alice.pubkey] },
    peers: [],
    fabric: { enable: false }
  });
  await svc.start();
  svc.setIdentity(alice);
  const port = svc.server.address().port;

  try {
    const empty = await request(port, 'GET', '/services/star-citizen/overlay/primary-group');
    assert.strictEqual(empty.status, 200);
    assert.strictEqual(empty.body.data.groupId, null);

    const created = await svc.groupManager.createGroup({
      name: 'Overlay Wing',
      members: [bob.pubkey],
      threshold: 1
    }, alice.pubkey);
    assert.ok(created && created.id);

    await request(port, 'PUT', '/settings/primaryGroupId', { value: created.id });
    await request(port, 'PUT', '/settings/groupOverlay', { value: true });

    // Seed peer presence for bob (x-only key as wire authors often are).
    const xBob = pubkeyXOnly(bob.pubkey);
    svc._peerPresenceByPubkey[xBob] = {
      online: true,
      nickname: 'BobPilot',
      ship: { name: 'Aurora MR', slug: 'aurora-mr' },
      lastEventAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const overlay = await request(port, 'GET', '/services/star-citizen/overlay/primary-group');
    assert.strictEqual(overlay.status, 200);
    assert.strictEqual(overlay.body.data.groupId, created.id);
    assert.strictEqual(overlay.body.data.name, 'Overlay Wing');
    assert.strictEqual(overlay.body.data.overlayEnabled, true);
    assert.ok(Array.isArray(overlay.body.data.members));
    assert.ok(overlay.body.data.members.length >= 2);
    const bobRow = overlay.body.data.members.find((m) => m.pubkey === bob.pubkey || m.nickname === 'BobPilot');
    assert.ok(bobRow, 'bob should appear in overlay roster');
    assert.strictEqual(bobRow.online, true);
    assert.strictEqual(bobRow.ship.name, 'Aurora MR');

    const html = await request(port, 'GET', '/overlay');
    assert.strictEqual(html.status, 200);
    assert.match(String(html.headers['content-type'] || ''), /text\/html/);
  } finally {
    await svc.stop();
  }
});
