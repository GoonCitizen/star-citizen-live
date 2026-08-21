'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity } = require('../../functions/identity');

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-voice-'));
}

function request (port, method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const headers = body ? { 'Content-Type': 'application/json' } : {};
    if (token) headers.Authorization = 'Bearer ' + token;
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: urlPath,
      headers
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = buf ? JSON.parse(buf) : null; } catch (_) { parsed = buf; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test('group voice join is members-only and registers on Hub JSON-RPC', async () => {
  const alice = createIdentity();
  const eve = createIdentity();
  const rpc = [];
  const svc = new LiveRelay({
    port: 0,
    settingsDir: tmpDir(),
    peers: [],
    fabric: { enable: false },
    discord: { enable: false },
    voiceHubFetch: async (url, opts) => {
      const body = JSON.parse(opts.body);
      rpc.push({ url, method: body.method, params: body.params[0] });
      return { ok: true, json: async () => ({ result: { status: 'success' } }) };
    },
    voiceHubWebSocket: null
  });
  await svc.start();
  svc.setIdentity(alice);
  const group = await svc.groupManager.createGroup({ name: 'Voice Wing', threshold: 1 }, alice.pubkey);
  const addr = svc.server.address();
  const port = addr.port;
  const base = '/services/star-citizen';

  try {
    const snap = await request(port, 'GET', base + '/voice');
    assert.equal(snap.status, 200);
    assert.equal(snap.body.data.joined, false);
    assert.equal(snap.body.data.hubOrigin, 'https://hub.fabric.pub');

    svc.setIdentity(eve);
    const forbidden = await request(port, 'POST',
      base + '/groups/' + encodeURIComponent(group.id) + '/voice/join', {});
    assert.equal(forbidden.status, 403);

    svc.setIdentity(alice);
    const joined = await request(port, 'POST',
      base + '/groups/' + encodeURIComponent(group.id) + '/voice/join', {});
    assert.equal(joined.status, 200);
    assert.equal(joined.body.data.joined, true);
    assert.equal(joined.body.data.groupId, group.id);
    assert.ok(String(joined.body.data.webrtcPeerId).startsWith('gv-'));
    assert.ok(rpc.some((c) => c.method === 'RegisterWebRTCPeer'));
    assert.equal(rpc.find((c) => c.method === 'RegisterWebRTCPeer').params.metadata.kind,
      'gooncitizen-group-voice');

    const left = await request(port, 'POST', base + '/voice/leave', {});
    assert.equal(left.status, 200);
    assert.equal(left.body.data.joined, false);
  } finally {
    await svc.stop();
  }
});

test('group voice join uses the unlocked wallet when FABRIC_XPRV differs', async () => {
  const wallet = createIdentity();
  const publisher = createIdentity();
  const eve = createIdentity();
  const svc = new LiveRelay({
    port: 0,
    settingsDir: tmpDir(),
    peers: [],
    fabric: { enable: false },
    discord: { enable: false },
    voiceHubFetch: async () => ({ ok: true, json: async () => ({ result: { status: 'success' } }) }),
    voiceHubWebSocket: null
  });
  await svc.start();
  const addr = svc.server.address();
  const port = addr.port;
  const base = '/services/star-citizen';
  const pathFor = (id) => base + '/groups/' + encodeURIComponent(id) + '/voice/join';

  try {
    svc.setIdentity(publisher, { unlockedPubkey: wallet.pubkey });
    const created = await svc.groupManager.createGroup(
      { name: 'Wallet Wing', threshold: 1 }, wallet.pubkey);

    const asUnlocked = await request(port, 'POST', pathFor(created.id), {});
    assert.equal(asUnlocked.status, 200);
    assert.equal(asUnlocked.body.data.joined, true);
    await request(port, 'POST', base + '/voice/leave', {});

    svc.setIdentity(publisher);
    const other = await svc.groupManager.createGroup(
      { name: 'Claim Wing', threshold: 1 }, wallet.pubkey);
    const asPublisher = await request(port, 'POST', pathFor(other.id), {});
    assert.equal(asPublisher.status, 403);

    const asClaim = await request(port, 'POST', pathFor(other.id), { pubkey: wallet.pubkey });
    assert.equal(asClaim.status, 200);

    svc.setIdentity(eve);
    const outsider = await request(port, 'POST', pathFor(other.id), { pubkey: eve.pubkey });
    assert.equal(outsider.status, 403);
  } finally {
    await svc.stop();
  }
});
