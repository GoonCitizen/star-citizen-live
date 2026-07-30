'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const {
  groupContractDefinition,
  groupContractId,
  isGroupContractDefinition
} = require('../../contracts/gooncitizenGroup');
const {
  buildFederationContractInviteJson,
  parseFederationContractInvite
} = require('../../functions/federationContractInvite');
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

test('groupContractDefinition is deterministic and Hub invite JSON parses', () => {
  const alice = createIdentity();
  const def = groupContractDefinition({
    groupId: 'group-fixture-1',
    creator: alice.pubkey,
    validators: [alice.pubkey],
    threshold: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    meta: { name: 'Fixture', visibility: 'private' }
  });
  assert.ok(isGroupContractDefinition(def));
  const id1 = groupContractId(def);
  const id2 = groupContractId(groupContractDefinition({
    groupId: 'group-fixture-1',
    creator: alice.pubkey,
    validators: [alice.pubkey],
    threshold: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    meta: { name: 'Fixture', visibility: 'private' }
  }));
  assert.strictEqual(id1, id2);
  assert.strictEqual(id1.length, 64);

  const inviteJson = buildFederationContractInviteJson({
    inviteId: 'inv-1',
    inviterHubId: alice.pubkey,
    contractId: id1,
    proposedPolicy: def.proposedPolicy,
    note: 'join us'
  });
  const parsed = parseFederationContractInvite(inviteJson);
  assert.ok(parsed);
  assert.strictEqual(parsed.v, 2);
  assert.strictEqual(parsed.contractId, id1);
  assert.ok(parsed.proposedPolicy);

  const bob = createIdentity();
  const directJson = buildFederationContractInviteJson({
    inviteId: 'inv-direct-1',
    inviterHubId: alice.pubkey,
    contractId: id1,
    inviteePubkey: bob.pubkey,
    groupId: 'group-fixture-1',
    groupName: 'Fixture',
    note: 'you specifically'
  });
  const direct = parseFederationContractInvite(directJson);
  assert.ok(direct);
  assert.strictEqual(direct.inviteePubkey, bob.pubkey.toLowerCase());
  assert.strictEqual(direct.groupName, 'Fixture');
});

test('Fabric: group create publishes Federation contract; membership + share converge', async () => {
  const alice = createIdentity();
  const bob = createIdentity();
  const portA = fabricPort();
  const portB = portA + 11;
  const dirA = tmpDir('sc-gfed-a-');
  const dirB = tmpDir('sc-gfed-b-');

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
    peers: [{ address: `127.0.0.1:${portB}`, enabled: true }],
    missions: { enable: true },
    fabric: { enable: true, listen: true, port: portA, peers: [], peersDb: null }
  });
  await nodeA.start();
  const httpA = nodeA.server.address().port;
  nodeA.setIdentity(alice);
  await waitFor(() => nodeA.fabricNetwork && nodeA.fabricNetwork.ready);
  // Both sides must be up before CONTRACT_PUBLISH / GroupChange — under full
  // suite load, waiting on only one side races NOISE session readiness.
  await waitFor(() => (
    nodeA.fabricNetwork.status().fabricConnected >= 1 &&
    nodeB.fabricNetwork.status().fabricConnected >= 1
  ));

  try {
    const created = await request(httpA, 'POST', `${BASE}/groups`, {
      name: 'Federation Wing',
      members: [alice.pubkey],
      threshold: 1,
      creator: alice.pubkey
    });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const groupId = created.body.data.id;
    const contractId = created.body.data.contractId;
    assert.ok(contractId);

    await waitFor(() => nodeB.groupManager.getGroupByContractId(contractId)
      || nodeB.groupManager.getGroup(groupId));

    // Membership change fans out as GroupChange.
    await request(httpA, 'POST', `${BASE}/groups/${groupId}/members`, {
      pubkey: bob.pubkey,
      actor: alice.pubkey
    });
    await waitFor(() => {
      const g = nodeB.groupManager.getGroup(groupId) || nodeB.groupManager.getGroupByContractId(contractId);
      return g && g.members.includes(bob.pubkey);
    });

    // Group-scoped mission share via GroupShare.
    const mission = await request(httpA, 'POST', `${BASE}/missions`, {
      title: 'Group share bounty',
      createdBy: alice.pubkey,
      groupId
    });
    assert.strictEqual(mission.status, 200, JSON.stringify(mission.body));
    const missionId = mission.body.data.id;
    const broadcast = await request(httpA, 'POST', `${BASE}/missions/${missionId}/broadcast`, {
      scope: 'group',
      groupId
    });
    assert.strictEqual(broadcast.status, 200, JSON.stringify(broadcast.body));

    await waitFor(() => nodeB._listMissionBroadcasts({ pendingOnly: true })
      .some((o) => o.missionId === missionId));

    // Hub-shaped invite publish.
    const invite = await request(httpA, 'POST', `${BASE}/groups/${groupId}/invites`, {
      note: 'welcome',
      actor: alice.pubkey
    });
    assert.strictEqual(invite.status, 200, JSON.stringify(invite.body));
    assert.strictEqual(invite.body.data.type, 'FederationContractInvite');
    await waitFor(() => nodeB.registerStore
      && nodeB.registerStore.get('groupinvites', invite.body.data.inviteId));
  } finally {
    await nodeA.stop();
    await nodeB.stop();
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

test('Fabric: direct group invite (inviteePubkey) persists inbox only on invitee', async () => {
  const alice = createIdentity();
  const bob = createIdentity();
  const carol = createIdentity();
  const portA = fabricPort();
  const portB = portA + 13;
  const portC = portA + 17;
  const dirA = tmpDir('sc-ginv-a-');
  const dirB = tmpDir('sc-ginv-b-');
  const dirC = tmpDir('sc-ginv-c-');

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

  const nodeC = new LiveRelay({
    port: 0,
    settingsDir: dirC,
    peers: [{ address: `127.0.0.1:${portB}`, enabled: true }],
    missions: { enable: true },
    fabric: { enable: true, listen: true, port: portC, peers: [], peersDb: null, relayAppMessages: true }
  });
  await nodeC.start();
  nodeC.setIdentity(carol);
  await waitFor(() => nodeC.fabricNetwork && nodeC.fabricNetwork.ready);

  const nodeA = new LiveRelay({
    port: 0,
    settingsDir: dirA,
    peers: [{ address: `127.0.0.1:${portB}`, enabled: true }],
    missions: { enable: true },
    fabric: { enable: true, listen: true, port: portA, peers: [], peersDb: null }
  });
  await nodeA.start();
  const httpA = nodeA.server.address().port;
  nodeA.setIdentity(alice);
  await waitFor(() => nodeA.fabricNetwork && nodeA.fabricNetwork.ready);
  await waitFor(() => (
    nodeA.fabricNetwork.status().fabricConnected >= 1 &&
    nodeB.fabricNetwork.status().fabricConnected >= 1
  ));

  try {
    const created = await request(httpA, 'POST', `${BASE}/groups`, {
      name: 'Invite Wing',
      members: [alice.pubkey],
      threshold: 1,
      creator: alice.pubkey
    });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const groupId = created.body.data.id;

    const invite = await request(httpA, 'POST', `${BASE}/groups/${groupId}/invites`, {
      note: 'join Invite Wing',
      inviteePubkey: bob.pubkey,
      actor: alice.pubkey
    });
    assert.strictEqual(invite.status, 200, JSON.stringify(invite.body));
    assert.strictEqual(invite.body.data.type, 'FederationContractInvite');
    assert.strictEqual(String(invite.body.data.inviteePubkey).toLowerCase(), bob.pubkey.toLowerCase());
    assert.ok(invite.body.data.relayed);

    await waitFor(() => nodeB.registerStore
      && nodeB.registerStore.get('groupinvites', invite.body.data.inviteId));
    const stored = nodeB.registerStore.get('groupinvites', invite.body.data.inviteId);
    assert.strictEqual(stored.direction, 'inbound');
    assert.strictEqual(String(stored.inviteePubkey).toLowerCase(), bob.pubkey.toLowerCase());

    const inboxId = `inbox-fi-${invite.body.data.inviteId}`;
    await waitFor(() => nodeB.registerStore.get('inbox', inboxId));
    const inbox = nodeB.registerStore.get('inbox', inboxId);
    assert.strictEqual(inbox.kind, 'FederationInvite');
    assert.strictEqual(inbox.actionable, true);
    assert.ok(/Invite Wing/i.test(inbox.title));

    // Carol (not the invitee) must not persist the targeted invite.
    await sleep(800);
    assert.equal(nodeC.registerStore.get('groupinvites', invite.body.data.inviteId), null);
    assert.equal(nodeC.registerStore.get('inbox', inboxId), null);
  } finally {
    await nodeA.stop();
    await nodeB.stop();
    await nodeC.stop();
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
    fs.rmSync(dirC, { recursive: true, force: true });
  }
});
