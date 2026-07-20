'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const ChatManager = require('../../services/ChatManager');
const GroupManager = require('../../services/GroupManager');
const { Store } = require('../../types/Store');
const { createIdentity, signEnvelope } = require('../../functions/identity');

const BASE = '/services/star-citizen';

function request (port, method, reqPath, payload, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
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

async function login (port, identity) {
  const envelope = signEnvelope(identity, { intent: 'login', ts: new Date().toISOString() });
  const res = await request(port, 'POST', `${BASE}/auth`, envelope);
  assert.strictEqual(res.status, 200);
  return res.body.data.token;
}

// ---- ChatManager ----

test('ChatManager: global + per-group channels with membership access', async () => {
  const a = createIdentity(); const b = createIdentity(); const eve = createIdentity();
  const store = new Store({});
  const gm = new GroupManager({ store });
  const group = await gm.createGroup({ name: 'Wing', members: [b.pubkey] }, a.pubkey);
  const cm = new ChatManager({ store, groupManager: gm });

  const channels = cm.channelsFor(a.pubkey, { enforceMembership: true });
  assert.deepStrictEqual(channels.map((c) => c.key), ['global', 'group:' + group.id]);
  assert.strictEqual(channels[1].label, 'Wing');

  // Eve (non-member) sees only global under enforcement, and cannot access the group channel.
  assert.deepStrictEqual(cm.channelsFor(eve.pubkey, { enforceMembership: true }).map((c) => c.key), ['global']);
  assert.strictEqual(cm.canAccess('group:' + group.id, eve.pubkey, { enforceMembership: true }), false);
  assert.strictEqual(cm.canAccess('group:' + group.id, b.pubkey, { enforceMembership: true }), true);
  assert.strictEqual(cm.canAccess('global', null, { enforceMembership: true }), true);

  const msg = cm.post({ channel: 'global', body: 'o7', author: a.pubkey, handle: 'Alice' });
  assert.strictEqual(msg['@type'], 'ChatMessage');
  assert.strictEqual(ChatManager.WIRE_TYPE, 'P2P_CHAT_MESSAGE');

  // Idempotent: identical content converges on the same id.
  const dup = cm.post({ channel: 'global', body: 'o7', author: a.pubkey, ts: msg.ts });
  assert.strictEqual(dup.id, msg.id);
  assert.strictEqual(cm.list('global').length, 1);

  assert.throws(() => cm.post({ channel: 'group:nope', body: 'x', author: a.pubkey }), /unknown channel/);
});

test('ChatManager.ingest rejects impersonation (author must be the batch signer)', async () => {
  const a = createIdentity(); const b = createIdentity();
  const store = new Store({});
  const cm = new ChatManager({ store });
  const ts = new Date().toISOString();

  const r = cm.ingest(a.pubkey, { channel: 'global', body: 'hello org', author: a.pubkey, ts });
  assert.ok(r.created);
  const again = cm.ingest(a.pubkey, { channel: 'global', body: 'hello org', author: a.pubkey, ts });
  assert.strictEqual(again.created, false, 'replay is a no-op');

  assert.throws(() => cm.ingest(b.pubkey, { channel: 'global', body: 'as alice', author: a.pubkey, ts }), /must match/);
});

// ---- Hosted REST: signed posts + membership enforcement ----

test('hosted chat: signed envelope required, group channels members-only', async () => {
  const alice = createIdentity(); const bob = createIdentity(); const eve = createIdentity();
  const svc = new LiveRelay({ port: 0, mode: 'server', missions: { enable: false } });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const aliceToken = await login(port, alice);
    const eveToken = await login(port, eve);
    const created = await request(port, 'POST', `${BASE}/groups`, { name: 'Wing', members: [bob.pubkey] }, aliceToken);
    const groupId = created.body.data.id;
    const groupChannel = 'group:' + groupId;

    // Unsigned post is rejected in hosted mode.
    const unsigned = await request(port, 'POST', `${BASE}/chat/messages`, { channel: 'global', body: 'hi' });
    assert.strictEqual(unsigned.status, 401);

    // Signed global post lands; anyone can read global.
    const env = signEnvelope(alice, { channel: 'global', body: 'org-wide o7', ts: new Date().toISOString() });
    const posted = await request(port, 'POST', `${BASE}/chat/messages`, env);
    assert.strictEqual(posted.status, 200, JSON.stringify(posted.body));
    assert.strictEqual(posted.body.data.author, alice.pubkey);
    const anonRead = await request(port, 'GET', `${BASE}/chat/messages?channel=global`);
    assert.strictEqual(anonRead.body.data.length, 1);

    // Group channel: member post OK, non-member post + read forbidden.
    const gEnv = signEnvelope(alice, { channel: groupChannel, body: 'wing only', ts: new Date().toISOString() });
    assert.strictEqual((await request(port, 'POST', `${BASE}/chat/messages`, gEnv)).status, 200);
    const eveEnv = signEnvelope(eve, { channel: groupChannel, body: 'intruder', ts: new Date().toISOString() });
    assert.strictEqual((await request(port, 'POST', `${BASE}/chat/messages`, eveEnv)).status, 403);
    assert.strictEqual((await request(port, 'GET', `${BASE}/chat/messages?channel=${encodeURIComponent(groupChannel)}`, null, eveToken)).status, 403);

    const bobToken = await login(port, bob);
    const bobRead = await request(port, 'GET', `${BASE}/chat/messages?channel=${encodeURIComponent(groupChannel)}`, null, bobToken);
    assert.strictEqual(bobRead.status, 200);
    assert.strictEqual(bobRead.body.data.length, 1);
    assert.strictEqual(bobRead.body.data[0].body, 'wing only');

    // Channel list reflects membership.
    const eveChannels = await request(port, 'GET', `${BASE}/chat/channels`, null, eveToken);
    assert.deepStrictEqual(eveChannels.body.data.map((c) => c.key), ['global']);
    const aliceChannels = await request(port, 'GET', `${BASE}/chat/channels`, null, aliceToken);
    assert.ok(aliceChannels.body.data.some((c) => c.key === groupChannel));
  } finally { await svc.stop(); }
});

// ---- Two-relay sync: local → hub (uplink push) and hub → local (pull) ----

test('chat converges between a local relay and a hub: push up, pull down', async () => {
  const alice = createIdentity(); const bob = createIdentity();

  const hub = new LiveRelay({ port: 0, mode: 'server', missions: { enable: false } });
  await hub.start();
  const hubPort = hub.server.address().port;

  const local = new LiveRelay({ port: 0, missions: { enable: false }, uplink: { intervalMs: 60000 }, peers: [] });
  await local.start();
  const localPort = local.server.address().port;
  try {
    // Same group exists on both nodes (deterministic id), Alice + Bob members.
    const groupData = { id: 'group-shared-1', name: 'Shared Wing', members: [alice.pubkey, bob.pubkey], threshold: 1 };
    await hub.groupManager.createGroup(groupData, alice.pubkey);
    await local.groupManager.createGroup(groupData, alice.pubkey);
    const groupChannel = 'group:group-shared-1';

    await request(localPort, 'POST', '/peers', { url: `http://127.0.0.1:${hubPort}` });
    local.setIdentity(alice);

    // Alice posts locally (global + group) — plain POST, author = identity.
    const g1 = await request(localPort, 'POST', `${BASE}/chat/messages`, { channel: 'global', body: 'hello from the relay' });
    assert.strictEqual(g1.status, 200);
    assert.strictEqual(g1.body.data.author, alice.pubkey);
    await request(localPort, 'POST', `${BASE}/chat/messages`, { channel: groupChannel, body: 'wing check-in' });

    // Push up: the signed batch delivers both to the hub.
    await local._flushUplink();
    const hubGlobal = await request(hubPort, 'GET', `${BASE}/chat/messages?channel=global`);
    assert.strictEqual(hubGlobal.body.data.length, 1);
    assert.strictEqual(hubGlobal.body.data[0].body, 'hello from the relay');
    assert.strictEqual(hubGlobal.body.data[0].author, alice.pubkey);

    // Bob posts on the hub (signed envelope, member of the group).
    const bobEnv = signEnvelope(bob, { channel: groupChannel, body: 'reporting in', ts: new Date().toISOString() });
    assert.strictEqual((await request(hubPort, 'POST', `${BASE}/chat/messages`, bobEnv)).status, 200);
    const bobGlobalEnv = signEnvelope(bob, { channel: 'global', body: 'evening all', ts: new Date().toISOString() });
    await request(hubPort, 'POST', `${BASE}/chat/messages`, bobGlobalEnv);

    // Pull down: the local relay syncs global AND its member group channel.
    await local._syncChatFromPeers();
    const localGlobal = await request(localPort, 'GET', `${BASE}/chat/messages?channel=global`);
    assert.deepStrictEqual(localGlobal.body.data.map((m) => m.body).sort(), ['evening all', 'hello from the relay']);
    const localGroup = await request(localPort, 'GET', `${BASE}/chat/messages?channel=${encodeURIComponent(groupChannel)}`);
    assert.deepStrictEqual(localGroup.body.data.map((m) => m.body).sort(), ['reporting in', 'wing check-in']);

    // Re-sync is idempotent — no duplicates.
    await local._syncChatFromPeers();
    assert.strictEqual((await request(localPort, 'GET', `${BASE}/chat/messages?channel=global`)).body.data.length, 2);
  } finally {
    await local.stop();
    await hub.stop();
  }
});
