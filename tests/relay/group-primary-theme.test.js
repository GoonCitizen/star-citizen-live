'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const {
  sanitizePrimaryColor,
  hexToRgba
} = require('../../functions/groupPrimaryColor');
const {
  parseDefaultGroupRef,
  resolveDefaultGroup,
  localJsSnippetFor
} = require('../../functions/defaultGroupMessage');
const { createIdentity } = require('../../functions/identity');
const { Store } = require('../../types/Store');
const settingsStore = require('../../functions/settingsStore');

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
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-theme-'));
}

test('sanitizePrimaryColor accepts #RRGGBB and rejects junk', () => {
  assert.strictEqual(sanitizePrimaryColor('#3B82F6'), '#3b82f6');
  assert.strictEqual(sanitizePrimaryColor('aabbcc'), '#aabbcc');
  assert.strictEqual(sanitizePrimaryColor(''), null);
  assert.strictEqual(sanitizePrimaryColor('#fff'), null);
  assert.strictEqual(sanitizePrimaryColor('red'), null);
  assert.match(hexToRgba('#3b82f6', 0.15), /^rgba\(59,130,246,0\.15\)$/);
});

test('parseDefaultGroupRef handles group id and message hash', () => {
  const gid = parseDefaultGroupRef('abcdef0123456789');
  assert.strictEqual(gid.kind, 'groupId');
  assert.strictEqual(gid.groupId, 'abcdef0123456789');

  const hash = 'a'.repeat(64);
  const mid = parseDefaultGroupRef(hash);
  assert.strictEqual(mid.kind, 'messageHash');
  assert.strictEqual(mid.messageId, hash);

  assert.match(localJsSnippetFor(hash), /defaultGroupMessageId:/);
});

test('resolveDefaultGroup requires known group when manager provided', () => {
  const r = resolveDefaultGroup('abcdef0123456789', {
    groupManager: { getGroup: () => null, findGroup: () => null }
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /does not have that group/i);
});

test('Group primaryColor update + settings runtime theme color', async () => {
  const alice = createIdentity();
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
    const created = await svc.groupManager.createGroup({
      name: 'Accent Wing',
      members: [],
      threshold: 1
    }, alice.pubkey);
    assert.ok(created.id);

    const updated = await svc.groupManager.updateGroup(created.id, { primaryColor: '#c45c26' }, alice.pubkey);
    assert.strictEqual(updated.primaryColor, '#c45c26');

    await request(port, 'PUT', '/settings/primaryGroupId', { value: created.id });
    const settings = await request(port, 'GET', '/settings');
    assert.strictEqual(settings.body.runtime.primaryGroupId, created.id);
    assert.strictEqual(settings.body.runtime.primaryGroupColor, '#c45c26');

    const fromMsg = await request(port, 'POST', '/settings/primaryGroup/from-message', {
      value: created.id,
      apply: true
    });
    assert.strictEqual(fromMsg.status, 200, JSON.stringify(fromMsg.body));
    assert.strictEqual(fromMsg.body.data.groupId, created.id);
    assert.ok(fromMsg.body.data.localJsSnippet.includes('defaultGroupMessageId'));
  } finally {
    await svc.stop().catch(() => {});
  }
});

test('defaultGroupMessageId in local settings seeds primaryGroupId', async () => {
  const alice = createIdentity();
  const dir = tmpDir();
  const storePath = path.join(dir, 'register');
  const store = new Store({ path: storePath });
  await store.start();

  const bootstrap = new LiveRelay({
    port: 0,
    settingsDir: dir,
    store,
    missions: { enable: true, officers: [alice.pubkey] },
    peers: [],
    fabric: { enable: false }
  });
  await bootstrap.start();
  bootstrap.setIdentity(alice);
  const g = await bootstrap.groupManager.createGroup({
    name: 'Boot Wing',
    members: [],
    threshold: 1
  }, alice.pubkey);
  await bootstrap.stop().catch(() => {});

  const store2 = new Store({ path: storePath });
  await store2.start();
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    store: store2,
    defaultGroupMessageId: g.id,
    missions: { enable: true, officers: [alice.pubkey] },
    peers: [],
    fabric: { enable: false }
  });
  await svc.start();
  try {
    assert.strictEqual(svc._primaryGroupId, g.id);
    const loaded = settingsStore.loadSettings(store2);
    assert.strictEqual(loaded.primaryGroupId, g.id);
  } finally {
    await svc.stop().catch(() => {});
  }
});
