'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const FabricNetwork = require('../../services/FabricNetwork');
const { createIdentity } = require('../../functions/identity');

const BASE = '/services/star-citizen';

function tmpDir (prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

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

function sleep (ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor (fn, { timeoutMs = 15000, intervalMs = 100 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await sleep(intervalMs);
  }
  throw new Error('waitFor timeout');
}

function fabricPort () {
  return 19000 + Math.floor(Math.random() * 4000);
}

test('FabricNetwork.normalizeFabricAddress validates host:port and migrates https', () => {
  assert.strictEqual(FabricNetwork.isFabricAddress('relay.goon.vc:7777'), true);
  assert.strictEqual(FabricNetwork.isFabricAddress('https://relay.goon.vc'), false);
  assert.strictEqual(FabricNetwork.normalizeFabricAddress('relay.goon.vc:7777'), 'relay.goon.vc:7777');
  assert.strictEqual(FabricNetwork.normalizeFabricAddress('https://relay.goon.vc/', { migrate: true }), 'relay.goon.vc:7777');
  assert.strictEqual(FabricNetwork.normalizeFabricAddress('https://relay.goon.vc/', { migrate: false }), null);
});

test('group-scoped mission broadcast is filtered for non-members', async () => {
  const alice = createIdentity();
  const bob = createIdentity();
  const eve = createIdentity();
  const dir = tmpDir('sc-fab-scope-');
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    peers: [],
    fabric: { enable: false },
    missions: { enable: true }
  });
  await svc.start();
  try {
    const group = await svc.groupManager.createGroup({ name: 'Wing', members: [bob.pubkey] }, alice.pubkey);
    const mission = {
      id: 'm-scope-1',
      title: 'Wing only',
      createdBy: alice.pubkey,
      groupId: group.id,
      status: 'open'
    };
    const payload = {
      mission,
      broadcastAt: new Date().toISOString(),
      scope: 'group',
      groupId: group.id,
      handle: 'Alice'
    };

    svc.setIdentity(bob);
    const forBob = svc._ingestMissionBroadcast(alice.pubkey, payload);
    assert.strictEqual(forBob.created, true);
    assert.strictEqual(svc._listMissionBroadcasts({ pendingOnly: true }).length, 1);

    svc.setIdentity(eve);
    const forEve = svc._ingestMissionBroadcast(alice.pubkey, Object.assign({}, payload, {
      broadcastAt: new Date().toISOString()
    }));
    assert.strictEqual(forEve.filtered, true);
    assert.strictEqual(forEve.created, false);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Fabric peer: MissionBroadcast and chat converge between two relays', async () => {
  const alice = createIdentity();
  const bob = createIdentity();
  const portA = fabricPort();
  const portB = portA + 11;
  const dirA = tmpDir('sc-fab-a-');
  const dirB = tmpDir('sc-fab-b-');

  const nodeB = new LiveRelay({
    port: 0,
    settingsDir: dirB,
    peers: [],
    missions: { enable: true },
    fabric: { enable: true, listen: true, port: portB, peers: [], peersDb: null, relayAppMessages: true }
  });
  await nodeB.start();
  nodeB.setIdentity(bob);
  await waitFor(() => nodeB.fabricNetwork && nodeB.fabricNetwork.ready);

  const nodeA = new LiveRelay({
    port: 0,
    settingsDir: dirA,
    peers: [{ address: `127.0.0.1:${portB}`, label: 'peer-b', enabled: true }],
    missions: { enable: true },
    fabric: { enable: true, listen: true, port: portA, peers: [], peersDb: null }
  });
  await nodeA.start();
  const httpA = nodeA.server.address().port;
  nodeA.setIdentity(alice);
  await waitFor(() => nodeA.fabricNetwork && nodeA.fabricNetwork.ready);
  await waitFor(() => (
    nodeA.fabricNetwork.status().fabricConnected >= 1 ||
    nodeB.fabricNetwork.status().fabricConnected >= 1
  ));

  try {
    const created = await request(httpA, 'POST', `${BASE}/missions`, {
      title: 'Fabric bounty',
      reward: 1000,
      createdBy: alice.pubkey
    });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const missionId = created.body.data.id;

    const broadcast = await request(httpA, 'POST', `${BASE}/missions/${missionId}/broadcast`, { scope: 'global' });
    assert.strictEqual(broadcast.status, 200, JSON.stringify(broadcast.body));
    assert.strictEqual(broadcast.body.data.scope, 'global');

    await waitFor(() => nodeB.missionManager.getMission(missionId));
    const offers = nodeB._listMissionBroadcasts({ pendingOnly: true });
    assert.ok(offers.some((o) => o.missionId === missionId && o.status === 'pending'));

    // Chat A → B
    const chat = await request(httpA, 'POST', `${BASE}/chat/messages`, {
      channel: 'global',
      body: 'o7 from fabric'
    });
    assert.strictEqual(chat.status, 200, JSON.stringify(chat.body));
    await waitFor(() => nodeB.chatManager.list('global').some((m) => m.body === 'o7 from fabric'));
  } finally {
    await nodeA.stop();
    await nodeB.stop();
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

test('Fabric peer: group-scoped broadcast drops for non-member receiver', async () => {
  const alice = createIdentity();
  const bob = createIdentity();
  const eve = createIdentity();
  const portA = fabricPort();
  const portB = portA + 11;
  const dirA = tmpDir('sc-fab-ga-');
  const dirB = tmpDir('sc-fab-gb-');

  const nodeB = new LiveRelay({
    port: 0,
    settingsDir: dirB,
    peers: [],
    missions: { enable: true },
    fabric: { enable: true, listen: true, port: portB, peers: [], peersDb: null }
  });
  await nodeB.start();

  const nodeA = new LiveRelay({
    port: 0,
    settingsDir: dirA,
    peers: [{ address: `127.0.0.1:${portB}`, enabled: true }],
    missions: { enable: true },
    fabric: { enable: true, listen: true, port: portA, peers: [], peersDb: null }
  });
  await nodeA.start();
  const httpA = nodeA.server.address().port;

  try {
    // Same group id on both nodes; only bob is a member (eve is receiver identity).
    const groupData = { id: 'group-fab-1', name: 'Wing', members: [bob.pubkey], threshold: 1 };
    await nodeA.groupManager.createGroup(groupData, alice.pubkey);
    await nodeB.groupManager.createGroup(groupData, alice.pubkey);

    nodeB.setIdentity(eve);
    nodeA.setIdentity(alice);
    await waitFor(() => nodeA.fabricNetwork && nodeA.fabricNetwork.ready);
    await waitFor(() => nodeB.fabricNetwork && nodeB.fabricNetwork.ready);
    await waitFor(() => (
      nodeA.fabricNetwork.status().fabricConnected >= 1 ||
      nodeB.fabricNetwork.status().fabricConnected >= 1
    ));

    const created = await request(httpA, 'POST', `${BASE}/missions`, {
      title: 'Members only',
      createdBy: alice.pubkey,
      groupId: 'group-fab-1'
    });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const missionId = created.body.data.id;

    const broadcast = await request(httpA, 'POST', `${BASE}/missions/${missionId}/broadcast`, {
      scope: 'group',
      groupId: 'group-fab-1'
    });
    assert.strictEqual(broadcast.status, 200, JSON.stringify(broadcast.body));

    // Give the wire a moment; Eve must not get a pending offer.
    // (Member receive path is covered by the unit filter test above.)
    await sleep(800);
    assert.strictEqual(
      nodeB._listMissionBroadcasts({ pendingOnly: true }).filter((o) => o.missionId === missionId).length,
      0,
      'non-member must not receive group-scoped offer'
    );
    // Mission register may still upsert via ingest before the membership filter —
    // only the pending offer must be absent for non-members.
    assert.ok(bob.pubkey, 'bob fixture retained for membership setup');
  } finally {
    await nodeA.stop();
    await nodeB.stop();
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});
