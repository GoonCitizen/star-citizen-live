'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const ChatManager = require('../../services/ChatManager');
const GroupManager = require('../../services/GroupManager');
const { Store } = require('../../types/Store');
const { createIdentity, signEnvelope, pubkeyXOnly, pubkeysMatch } = require('../../functions/identity');

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

test('ChatManager.setPinned toggles the stored flag', async () => {
  const a = createIdentity();
  const store = new Store({});
  const cm = new ChatManager({ store });
  const msg = cm.post({ channel: 'global', body: 'pin me', author: a.pubkey });
  const pinned = cm.setPinned(msg.id, { pinned: true, actor: a.pubkey });
  assert.strictEqual(pinned.pinned, true);
  assert.ok(pinned.pinnedAt);
  assert.strictEqual(pinned.pinnedBy, a.pubkey);
  const off = cm.setPinned(msg.id, { pinned: false });
  assert.strictEqual(off.pinned, false);
  assert.strictEqual(off.pinnedAt, null);
  assert.throws(() => cm.setPinned('missingmsg'), /not found/);
});

test('ChatManager: discord channels accept Discord or Fabric authors and skip mesh ingest', async () => {
  const a = createIdentity();
  const store = new Store({});
  const cm = new ChatManager({ store });

  assert.strictEqual(cm.canAccess('discord:c1', null, { enforceMembership: false }), true);
  assert.strictEqual(cm.canAccess('discord:c1', null, { enforceMembership: true }), false);
  assert.strictEqual(cm.canAccess('discord:c1', a.pubkey, { enforceMembership: true }), true);

  const fromDiscord = cm.post({
    channel: 'discord:c1',
    body: 'o7 from Discord',
    author: 'discord:u1',
    handle: 'alice',
    kind: 'discord',
    discordMessageId: 'm1',
    discordUserId: 'u1'
  });
  assert.strictEqual(fromDiscord.author, 'discord:u1');
  assert.strictEqual(fromDiscord.discordMessageId, 'm1');
  const dup = cm.post({
    channel: 'discord:c1',
    body: 'different text same discord id',
    author: 'discord:u1',
    kind: 'discord',
    discordMessageId: 'm1'
  });
  assert.strictEqual(dup.id, fromDiscord.id);

  const fromLocal = cm.post({
    channel: 'discord:c1',
    body: 'hello guild',
    author: a.pubkey,
    handle: 'Neorion',
    kind: 'discord',
    discordMessageId: 'posted-1'
  });
  assert.ok(fromLocal.author);
  assert.notStrictEqual(fromLocal.author, 'discord:u1');

  assert.throws(() => cm.ingest(a.pubkey, {
    channel: 'discord:c1',
    body: 'nope',
    author: a.pubkey,
    ts: new Date().toISOString()
  }), /not mesh-ingested/);
});

test('ChatManager: DM channels are participant-only and publishable', async () => {
  const a = createIdentity(); const b = createIdentity(); const eve = createIdentity();
  const store = new Store({});
  const cm = new ChatManager({ store });

  const key = ChatManager.dmChannelKey(a.pubkey, b.pubkey);
  assert.ok(key && key.startsWith('dm:'));
  assert.strictEqual(ChatManager.dmChannelKey(b.pubkey, a.pubkey), key);
  assert.strictEqual(cm.canAccess(key, a.pubkey, { enforceMembership: true }), true);
  assert.strictEqual(cm.canAccess(key, b.pubkey, { enforceMembership: true }), true);
  assert.strictEqual(cm.canAccess(key, eve.pubkey, { enforceMembership: true }), false);

  const msg = cm.post({ channel: key, body: 'ping', author: a.pubkey, handle: 'Alice' });
  assert.strictEqual(msg.channel, key);
  assert.throws(() => cm.post({ channel: key, body: 'nope', author: eve.pubkey }), /participant/);

  const chans = cm.channelsFor(b.pubkey, { enforceMembership: true });
  assert.ok(chans.some((c) => c.kind === 'dm' && c.key === key));
  assert.ok(!cm.channelsFor(eve.pubkey, { enforceMembership: true }).some((c) => c.key === key));

  const opened = cm.openDm(a.pubkey, b.pubkey);
  assert.strictEqual(opened.key, key);
  assert.strictEqual(opened.peerPubkey, b.pubkey);
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
    const env = signEnvelope(alice, { channel: 'global', body: 'network o7', ts: new Date().toISOString() });
    const posted = await request(port, 'POST', `${BASE}/chat/messages`, env);
    assert.strictEqual(posted.status, 200, JSON.stringify(posted.body));
    assert.strictEqual(posted.body.data.author, pubkeyXOnly(alice.pubkey));
    assert.ok(pubkeysMatch(posted.body.data.author, alice.pubkey));
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

// ---- Two-relay sync: global = P2P_CHAT_MESSAGE; group = GroupChat CONTRACT_MESSAGE ----

function sleep (ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitFor (fn, { timeoutMs = 15000, intervalMs = 100 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await sleep(intervalMs);
  }
  throw new Error('waitFor timeout');
}

test('chat converges between two Fabric peers (bidirectional)', async () => {
  const alice = createIdentity(); const bob = createIdentity();
  const portA = 21000 + Math.floor(Math.random() * 3000);
  const portB = portA + 11;
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-chat-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-chat-b-'));

  const hub = new LiveRelay({
    port: 0,
    missions: { enable: false },
    settingsDir: dirB,
    peers: [],
    fabric: { enable: true, listen: true, port: portB, peers: [], peersDb: null, relayAppMessages: true }
  });
  await hub.start();
  const hubPort = hub.server.address().port;
  hub.setIdentity(bob);
  await waitFor(() => hub.fabricNetwork && hub.fabricNetwork.ready);

  const local = new LiveRelay({
    port: 0,
    missions: { enable: false },
    settingsDir: dirA,
    peers: [{ address: `127.0.0.1:${portB}`, enabled: true }],
    fabric: { enable: true, listen: true, port: portA, peers: [], peersDb: null }
  });
  await local.start();
  const localPort = local.server.address().port;
  try {
    local.setIdentity(alice);
    await waitFor(() => local.fabricNetwork && local.fabricNetwork.ready);
    await waitFor(() => (
      local.fabricNetwork.status().fabricConnected >= 1 ||
      hub.fabricNetwork.status().fabricConnected >= 1
    ));

    // Alice creates the Federation group; hub ingests CONTRACT_PUBLISH.
    const created = await request(localPort, 'POST', `${BASE}/groups`, {
      id: 'group-shared-1',
      name: 'Shared Wing',
      members: [alice.pubkey, bob.pubkey],
      threshold: 1,
      creator: alice.pubkey
    });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    assert.ok(created.body.data.contractId, 'group must have a Federation contractId');
    await waitFor(() => hub.groupManager.getGroup('group-shared-1'));
    const groupChannel = 'group:group-shared-1';

    const g1 = await request(localPort, 'POST', `${BASE}/chat/messages`, { channel: 'global', body: 'hello from the relay' });
    assert.strictEqual(g1.status, 200);
    assert.strictEqual(g1.body.data.author, pubkeyXOnly(alice.pubkey));
    assert.ok(pubkeysMatch(g1.body.data.author, alice.pubkey));
    await request(localPort, 'POST', `${BASE}/chat/messages`, { channel: groupChannel, body: 'wing check-in' });

    await waitFor(() => hub.chatManager.list('global').some((m) => m.body === 'hello from the relay'));
    await waitFor(() => hub.chatManager.list(groupChannel).some((m) => m.body === 'wing check-in'));

    // Bob posts on the hub; Alice's peer receives over Fabric.
    await request(hubPort, 'POST', '/peers', { address: `127.0.0.1:${portA}` });
    await waitFor(() => hub.fabricNetwork.status().fabricConnected >= 1);

    const bobPost = await request(hubPort, 'POST', `${BASE}/chat/messages`, {
      channel: groupChannel,
      body: 'reporting in'
    });
    assert.strictEqual(bobPost.status, 200, JSON.stringify(bobPost.body));
    await request(hubPort, 'POST', `${BASE}/chat/messages`, { channel: 'global', body: 'evening all' });

    await waitFor(() => local.chatManager.list('global').some((m) => m.body === 'evening all'));
    await waitFor(() => local.chatManager.list(groupChannel).some((m) => m.body === 'reporting in'));

    const localGlobal = await request(localPort, 'GET', `${BASE}/chat/messages?channel=global`);
    assert.deepStrictEqual(localGlobal.body.data.map((m) => m.body).sort(), ['evening all', 'hello from the relay']);
    const localGroup = await request(localPort, 'GET', `${BASE}/chat/messages?channel=${encodeURIComponent(groupChannel)}`);
    assert.deepStrictEqual(localGroup.body.data.map((m) => m.body).sort(), ['reporting in', 'wing check-in']);
  } finally {
    await local.stop();
    await hub.stop();
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

test('local chat posts use the operator nickname; author remains the pubkey', async () => {
  const alice = createIdentity();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-nick-'));
  const svc = new LiveRelay({
    port: 0,
    missions: { enable: false },
    settingsDir: dir,
    peers: []
  });
  await svc.start();
  const port = svc.server.address().port;
  try {
    svc.setIdentity(alice);
    const put = await request(port, 'PUT', '/settings/nickname', { value: '  Neorion  ' });
    assert.strictEqual(put.status, 200, JSON.stringify(put.body));
    assert.strictEqual(put.body.settings.nickname, 'Neorion');
    assert.strictEqual(svc._nickname, 'Neorion');

    const posted = await request(port, 'POST', `${BASE}/chat/messages`, { channel: 'global', body: 'o7 citizens' });
    assert.strictEqual(posted.status, 200, JSON.stringify(posted.body));
    assert.strictEqual(posted.body.data.handle, 'Neorion');
    assert.strictEqual(posted.body.data.author, pubkeyXOnly(alice.pubkey));
    assert.ok(pubkeysMatch(posted.body.data.author, alice.pubkey));

    await request(port, 'PUT', '/settings/nickname', { value: null });
    const cleared = await request(port, 'POST', `${BASE}/chat/messages`, { channel: 'global', body: 'anon style' });
    assert.strictEqual(cleared.body.data.handle, null);
    assert.strictEqual(cleared.body.data.author, pubkeyXOnly(alice.pubkey));
    assert.ok(pubkeysMatch(cleared.body.data.author, alice.pubkey));
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('group chat receipt API marks local 2PC receipt when wireHash is present', async () => {
  const alice = createIdentity();
  const bob = createIdentity();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-receipt-'));
  const fabricPort = 22000 + Math.floor(Math.random() * 4000);
  const svc = new LiveRelay({
    port: 0,
    missions: { enable: false },
    settingsDir: dir,
    peers: [],
    // Explicitly enable Fabric under NODE_ENV=test (disabled by default).
    fabric: { enable: true, listen: true, port: fabricPort, peers: [], peersDb: null }
  });
  await svc.start();
  const port = svc.server.address().port;
  try {
    svc.setIdentity(alice);
    await waitFor(() => svc.fabricNetwork && svc.fabricNetwork.ready, { timeoutMs: 8000 });
    const created = await request(port, 'POST', `${BASE}/groups`, {
      id: 'wing-rx',
      name: 'Wing RX',
      members: [alice.pubkey, bob.pubkey],
      threshold: 1,
      creator: alice.pubkey
    });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const channel = 'group:wing-rx';
    const posted = await request(port, 'POST', `${BASE}/chat/messages`, {
      channel,
      body: 'check receipts'
    });
    assert.strictEqual(posted.status, 200, JSON.stringify(posted.body));
    const msgId = posted.body.data.id;
    // Prefer AMP wireHash from local GroupChat publish; inject only if peer offline.
    let row = null;
    try {
      await waitFor(() => {
        row = svc.registerStore.get('chatmessages', msgId);
        return row && row.wireHash;
      }, { timeoutMs: 3000 });
    } catch (_) {
      row = svc.registerStore.get('chatmessages', msgId);
      assert.ok(row);
      row.wireHash = 'ab'.repeat(32);
      row.contractId = created.body.data.contractId;
      svc.registerStore.put('chatmessages', msgId, row);
    }

    const receipt = await request(port, 'POST', `${BASE}/chat/messages/${encodeURIComponent(msgId)}/receipt`, {});
    assert.strictEqual(receipt.status, 200, JSON.stringify(receipt.body));
    assert.ok(receipt.body.data.delivery);
    assert.equal(receipt.body.data.delivery.local.receipt, true);
    assert.ok(receipt.body.data.messageHex, 'receipt returns AMP hex for Fabric storage/relay');

    // Unified wireHash path is equivalent (already receipted locally → still 200 with same flags).
    const byHash = await request(port, 'POST', `${BASE}/delivery/${encodeURIComponent(row.wireHash)}/receipt`, {
      chatMessageId: msgId,
      contractId: created.body.data.contractId
    });
    assert.strictEqual(byHash.status, 200, JSON.stringify(byHash.body));
    assert.equal(byHash.body.data.delivery.local.receipt, true);
    assert.ok(byHash.body.data.messageHex);

    const status = await request(port, 'GET', `${BASE}/delivery/${encodeURIComponent(row.wireHash)}`);
    assert.strictEqual(status.status, 200);
    assert.equal(status.body.type, 'DeliverySync');
    assert.ok(status.body.data.delivery);
    assert.equal(status.body.data.delivery.local.receipt, true);

    // Receipt frame is stored in contractmessages (like GroupChat) without bumping tip clock alone.
    const contractId = created.body.data.contractId;
    const doc = svc.registerStore.get('contractmessages', String(contractId).toLowerCase());
    assert.ok(doc && Array.isArray(doc.entries));
    assert.ok(doc.entries.some((e) => e && e.type === 'MessageReceipt' && e.hex));

    const listed = await request(port, 'GET', `${BASE}/chat/messages?channel=${encodeURIComponent(channel)}`);
    assert.strictEqual(listed.status, 200);
    const enriched = listed.body.data.find((m) => m.id === msgId);
    assert.ok(enriched);
    assert.ok(enriched.delivery);
    assert.equal(enriched.delivery.local.receipt, true);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('group chat receipt signs locally when fabric peer is disabled (NODE_ENV=test default)', async () => {
  const alice = createIdentity();
  const bob = createIdentity();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-receipt-nofabric-'));
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
      id: 'wing-rx-local',
      name: 'Wing RX Local',
      members: [alice.pubkey, bob.pubkey],
      threshold: 1,
      creator: alice.pubkey
    });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const posted = await request(port, 'POST', `${BASE}/chat/messages`, {
      channel: 'group:wing-rx-local',
      body: 'local receipt only'
    });
    assert.strictEqual(posted.status, 200, JSON.stringify(posted.body));
    const msgId = posted.body.data.id;
    const row = svc.registerStore.get('chatmessages', msgId);
    assert.ok(row);
    row.wireHash = 'cd'.repeat(32);
    row.contractId = created.body.data.contractId;
    svc.registerStore.put('chatmessages', msgId, row);

    const receipt = await request(port, 'POST', `${BASE}/chat/messages/${encodeURIComponent(msgId)}/receipt`, {});
    assert.strictEqual(receipt.status, 200, JSON.stringify(receipt.body));
    assert.equal(receipt.body.data.delivery.local.receipt, true);
    assert.ok(receipt.body.data.messageHex);
    assert.equal(svc.settings.fabric.enable, false);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
