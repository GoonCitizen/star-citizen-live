'use strict';

const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const {
  createFabricMessageLog,
  summarizeMessage,
  isKeepaliveType
} = require('../../functions/fabricMessageLog');
const LiveRelay = require('../../services/LiveRelay');

function tmpDir (prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function request (port, method, reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: reqPath
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
    req.end();
  });
}

test('isKeepaliveType recognizes ping/pong', () => {
  assert.equal(isKeepaliveType('P2P_PING'), true);
  assert.equal(isKeepaliveType('CONTRACT_MESSAGE'), false);
});

test('createFabricMessageLog rings, filters, pause', () => {
  const log = createFabricMessageLog({ capacity: 3 });
  log.append(summarizeMessage({
    type: 'P2P_CHAT_MESSAGE',
    friendlyType: 'ChatMessage',
    data: 'hello',
    raw: { data: Buffer.from('hello'), hash: Buffer.from('aa'.repeat(32), 'hex') }
  }, { direction: 'out' }));
  log.append(summarizeMessage({
    type: 'P2P_PING',
    friendlyType: 'Ping',
    data: '',
    raw: { data: Buffer.alloc(0), hash: Buffer.from('bb'.repeat(32), 'hex') }
  }, { direction: 'in', peer: 'hub.fabric.pub:7777' }));
  log.append({
    direction: 'in',
    type: 'CONTRACT_MESSAGE',
    appType: 'PeerProfile',
    bodyPreview: '{"type":"PeerProfile"}',
    summary: '← CONTRACT_MESSAGE'
  });
  log.append({
    direction: 'out',
    type: 'P2P_PEER_ALIAS',
    bodyPreview: 'Neorion',
    summary: '→ P2P_PEER_ALIAS'
  });

  assert.equal(log.status().count, 3);
  const noKeep = log.list({ hideKeepalive: true, limit: 10 });
  assert.ok(noKeep.every((e) => e.type !== 'P2P_PING'));
  const outs = log.list({ direction: 'out', hideKeepalive: false });
  assert.ok(outs.every((e) => e.direction === 'out'));
  const q = log.list({ q: 'peerprofile', hideKeepalive: false });
  assert.equal(q.length, 1);
  assert.equal(q[0].appType, 'PeerProfile');

  log.pause();
  assert.equal(log.append({ type: 'X', direction: 'in' }), null);
  log.resume();
  assert.ok(log.append({ type: 'Y', direction: 'in' }));
  log.clear();
  assert.equal(log.status().count, 0);
});

test('createFabricMessageLog get finds by hash or seq', () => {
  const log = createFabricMessageLog({ capacity: 8 });
  const row = log.append({
    direction: 'out',
    type: 'CONTRACT_MESSAGE',
    hash: 'deadbeef',
    appType: 'GroupChange'
  });
  assert.ok(row);
  assert.equal(log.get('deadbeef').appType, 'GroupChange');
  assert.equal(log.get(row.id).hash, 'deadbeef');
  assert.equal(log.get('missing'), null);
});

test('createFabricMessageLog filters by contract', () => {
  const log = createFabricMessageLog({ capacity: 10 });
  const cid = 'aa'.repeat(32);
  log.append({
    direction: 'out',
    type: 'CONTRACT_MESSAGE',
    appType: 'GroupChat',
    contract: cid,
    bodyPreview: '{"type":"GroupChat"}',
    summary: '→ GroupChat'
  });
  log.append({
    direction: 'in',
    type: 'CONTRACT_MESSAGE',
    appType: 'GroupShare',
    contract: 'bb'.repeat(32),
    bodyPreview: '{"type":"GroupShare"}',
    summary: '← GroupShare'
  });
  log.append({
    direction: 'out',
    type: 'P2P_CHAT_MESSAGE',
    bodyPreview: 'global',
    summary: '→ chat'
  });
  const scoped = log.list({ contract: cid, hideKeepalive: false });
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].appType, 'GroupChat');
});

test('GET /fabric/messages exposes only Fabric message log API', async () => {
  const dir = tmpDir('gc-fml-');
  const svc = new LiveRelay({
    port: 0,
    listen: true,
    logfile: null,
    settingsDir: dir,
    fabric: { enable: false },
    missions: { enable: false }
  });
  await svc.start();
  const port = svc.server.address().port;
  try {
    svc._fabricMessageLog.append({
      direction: 'out',
      type: 'P2P_CHAT_MESSAGE',
      bodyPreview: 'o7',
      summary: '→ chat'
    });
    const res = await request(port, 'GET', '/services/star-citizen/fabric/messages');
    assert.equal(res.status, 200);
    assert.equal(res.body.type, 'FabricMessageLog');
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].type, 'P2P_CHAT_MESSAGE');

    const cleared = await request(port, 'POST', '/services/star-citizen/fabric/messages/clear');
    assert.equal(cleared.status, 200);
    const empty = await request(port, 'GET', '/services/star-citizen/fabric/messages');
    assert.equal(empty.body.data.length, 0);

    const cid = 'cc'.repeat(32);
    svc._fabricMessageLog.append({
      direction: 'out',
      type: 'CONTRACT_MESSAGE',
      appType: 'GroupActivityTree',
      contract: cid,
      bodyPreview: '{}',
      summary: '→ tree'
    });
    svc._fabricMessageLog.append({
      direction: 'out',
      type: 'CONTRACT_MESSAGE',
      appType: 'GroupChat',
      contract: 'dd'.repeat(32),
      bodyPreview: '{}',
      summary: '→ chat'
    });
    const filtered = await request(port, 'GET',
      `/services/star-citizen/fabric/messages?contract=${cid}`);
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.data.length, 1);
    assert.equal(filtered.body.data[0].appType, 'GroupActivityTree');

    svc._fabricMessageLog.append({
      direction: 'out',
      type: 'CONTRACT_MESSAGE',
      hash: 'cafef00d',
      appType: 'GroupChange',
      summary: '→ change'
    });
    const byHash = await request(port, 'GET', '/services/star-citizen/fabric/messages/cafef00d');
    assert.equal(byHash.status, 200);
    assert.equal(byHash.body.data.hash, 'cafef00d');
    const missing = await request(port, 'GET', '/services/star-citizen/fabric/messages/nope');
    assert.equal(missing.status, 200);
    assert.equal(missing.body.data.missing, true);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
