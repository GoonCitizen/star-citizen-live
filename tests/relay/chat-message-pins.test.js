'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity } = require('../../functions/identity');

const BASE = '/services/star-citizen';

function request (port, method, reqPath, payload) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}

test('POST chat/messages/:id/pin toggles the message and group overlay', async () => {
  const alice = createIdentity();
  const bob = createIdentity();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-msg-pin-'));
  const svc = new LiveRelay({
    port: 0,
    missions: { enable: false },
    settingsDir: dir,
    peers: [],
    fabric: { enable: false }
  });
  await svc.start();
  const port = svc.server.address().port;
  try {
    svc.setIdentity(alice);
    const created = await request(port, 'POST', `${BASE}/groups`, {
      name: 'Pin Wing',
      members: [bob.pubkey],
      threshold: 1,
      creator: alice.pubkey
    });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const groupId = created.body.data.id;
    const channel = 'group:' + groupId;
    const posted = await request(port, 'POST', `${BASE}/chat/messages`, {
      channel,
      body: 'stand by for pin'
    });
    assert.strictEqual(posted.status, 200, JSON.stringify(posted.body));
    const id = posted.body.data.id;
    assert.ok(id);

    const pinned = await request(port, 'POST', `${BASE}/chat/messages/${encodeURIComponent(id)}/pin`, {
      pinned: true
    });
    assert.strictEqual(pinned.status, 200, JSON.stringify(pinned.body));
    assert.strictEqual(pinned.body.data.pinned, true);

    const listed = await request(port, 'GET', `${BASE}/chat/messages?channel=${encodeURIComponent(channel)}`);
    assert.strictEqual(listed.status, 200);
    const row = (listed.body.data || []).find((m) => m.id === id);
    assert.ok(row);
    assert.strictEqual(row.pinned, true);

    const group = svc.groupManager.getGroup(groupId);
    assert.ok(group.pinnedMessages.includes(id));

    const off = await request(port, 'POST', `${BASE}/chat/messages/${encodeURIComponent(id)}/pin`, {
      pinned: false
    });
    assert.strictEqual(off.status, 200, JSON.stringify(off.body));
    assert.strictEqual(off.body.data.pinned, false);
    const after = svc.groupManager.getGroup(groupId);
    assert.ok(!after.pinnedMessages.includes(id));
  } finally {
    await svc.stop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
});
