'use strict';

/**
 * E2E: Federation group join over the Fabric mesh.
 *
 * When an invitee accepts, existing members must receive a signed
 * GroupChangeProposal that names the new pubkey and embeds the invitation.
 * After validators adopt, a GroupStateJournal tip (state commitment) is
 * broadcast whose roster includes the new member.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const gcp = require('../../functions/groupChangeProposal');
const { verifyGroupStateTip } = require('../../functions/groupStateSigning');
const { fixtureIdentity } = require('./fixtures/identities');

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

async function waitFor (fn, { timeoutMs = 20000, intervalMs = 100 } = {}) {
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

function hasMember (group, pubkey) {
  if (!group || !pubkey) return false;
  const want = String(pubkey).toLowerCase();
  return (group.members || []).some((m) => String(m).toLowerCase() === want);
}

function proposalObject (ev) {
  return (ev && ev.object) || ev || null;
}

function journalObject (ev) {
  if (!ev) return null;
  return ev.object || ev;
}

function journalMembers (ev) {
  const obj = journalObject(ev);
  if (!obj) return [];
  if (obj.identity && Array.isArray(obj.identity.members)) return obj.identity.members;
  if (Array.isArray(obj.members)) return obj.members;
  return [];
}

function listenMesh (node) {
  const proposals = [];
  const journals = [];
  const net = node.fabricNetwork;
  if (net) {
    net.on('groupChangeProposal', (ev) => proposals.push(ev));
    net.on('groupStateJournal', (ev) => journals.push(ev));
  }
  node.on('group:state-tip', (ev) => journals.push(ev));
  return { proposals, journals };
}

function findJoinProposal (rows, { inviteId, member }) {
  const wantInvite = String(inviteId || '').toLowerCase();
  const wantMember = String(member || '').toLowerCase();
  return rows.map(proposalObject).find((obj) => {
    if (!obj || obj.action !== 'member.add') return false;
    const gotMember = String(obj.member || '').toLowerCase();
    if (wantMember && gotMember !== wantMember) return false;
    const gotInvite = String((obj.invite && obj.invite.inviteId) || obj.inviteId || '').toLowerCase();
    if (wantInvite && gotInvite !== wantInvite) return false;
    return true;
  }) || null;
}

function findJournalWithMember (rows, pubkey) {
  const want = String(pubkey).toLowerCase();
  return rows.find((ev) => {
    return journalMembers(ev).some((m) => String(m).toLowerCase() === want);
  }) || null;
}

async function startRelay (identity, opts = {}) {
  const dir = tmpDir(opts.prefix || 'sc-gjoin-');
  const node = new LiveRelay({
    port: 0,
    settingsDir: dir,
    peers: opts.peers || [],
    missions: { enable: true },
    fabric: {
      enable: true,
      listen: true,
      port: opts.fabricPort,
      peers: [],
      peersDb: null,
      relayAppMessages: opts.relayAppMessages === true
    }
  });
  await node.start();
  node.setIdentity(identity);
  await waitFor(() => node.fabricNetwork && node.fabricNetwork.ready);
  return { node, dir };
}

async function stopRelay (row) {
  if (!row || !row.node) return;
  try {
    if (row.node.server && typeof row.node.server.closeAllConnections === 'function') {
      row.node.server.closeAllConnections();
    }
    await row.node.stop();
  } catch (_) { /* already stopped */ }
  if (row.dir) fs.rmSync(row.dir, { recursive: true, force: true });
}

test('Fabric e2e: accept join publishes GroupChangeProposal with invitation, then state commitment', {
  timeout: 60000
}, async () => {
  const alice = fixtureIdentity('alice');
  const bob = fixtureIdentity('bob');
  const portB = fabricPort();
  const portA = portB + 11;
  const started = [];

  try {
    const b = await startRelay(bob, { fabricPort: portB, prefix: 'sc-gjoin-b-', relayAppMessages: true });
    started.push(b);
    const a = await startRelay(alice, {
      fabricPort: portA,
      prefix: 'sc-gjoin-a-',
      peers: [{ address: `127.0.0.1:${portB}`, enabled: true }]
    });
    started.push(a);

    await waitFor(() => (
      a.node.fabricNetwork.status().fabricConnected >= 1 &&
      b.node.fabricNetwork.status().fabricConnected >= 1
    ));

    const meshA = listenMesh(a.node);
    const meshB = listenMesh(b.node);
    const httpA = a.node.server.address().port;
    const httpB = b.node.server.address().port;

    const created = await request(httpA, 'POST', `${BASE}/groups`, {
      name: 'Join Flow Wing',
      members: [alice.pubkey],
      threshold: 1,
      creator: alice.pubkey
    });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const groupId = created.body.data.id;
    const contractId = created.body.data.contractId;
    assert.ok(contractId);

    const invite = await request(httpA, 'POST', `${BASE}/groups/${groupId}/invites`, {
      note: 'welcome to join flow',
      inviteePubkey: bob.pubkey,
      actor: alice.pubkey
    });
    assert.strictEqual(invite.status, 200, JSON.stringify(invite.body));
    const inviteId = invite.body.data.inviteId;
    assert.ok(inviteId);
    assert.strictEqual(invite.body.data.type, 'FederationContractInvite');

    await waitFor(() => b.node.registerStore && b.node.registerStore.get('groupinvites', inviteId));

    const accept = await request(
      httpB,
      'POST',
      `${BASE}/groups/${groupId}/invites/${inviteId}/accept`,
      { actor: bob.pubkey }
    );
    assert.strictEqual(accept.status, 200, JSON.stringify(accept.body));
    assert.ok(accept.body.data && accept.body.data.accept === true);
    assert.ok(hasMember(accept.body.data.group, bob.pubkey), 'invitee joins locally on accept');

    const inbound = await waitFor(() => findJoinProposal(meshA.proposals, {
      inviteId,
      member: bob.pubkey
    }));
    assert.ok(inbound.invite, 'proposal carries the invitation');
    assert.strictEqual(String(inbound.invite.inviteId), String(inviteId));
    assert.strictEqual(String(inbound.invite.inviteePubkey).toLowerCase(), bob.pubkey.toLowerCase());
    assert.strictEqual(String(inbound.invite.contractId).toLowerCase(), String(contractId).toLowerCase());
    assert.strictEqual(String(inbound.invite.groupId), String(groupId));
    assert.strictEqual(String(inbound.member).toLowerCase(), bob.pubkey.toLowerCase());
    assert.strictEqual(inbound.via, 'FederationContractInvite');
    assert.strictEqual(inbound.action, 'member.add');

    const storedProposal = await waitFor(() => {
      const p = a.node.groupManager.getProposal(gcp.inviteJoinProposalId(inviteId));
      return p && p.invite && p.invite.inviteId === inviteId ? p : null;
    });
    assert.strictEqual(String(storedProposal.member).toLowerCase(), bob.pubkey.toLowerCase());

    await waitFor(() => {
      const gA = a.node.groupManager.findGroup(groupId);
      const gB = b.node.groupManager.findGroup(groupId);
      return hasMember(gA, bob.pubkey) && hasMember(gA, alice.pubkey) &&
        hasMember(gB, bob.pubkey) && hasMember(gB, alice.pubkey);
    });

    const adopted = await waitFor(() => {
      const p = a.node.groupManager.getProposal(gcp.inviteJoinProposalId(inviteId));
      return p && p.status === 'adopted' ? p : null;
    });
    const aliceSig = adopted.signatures && (
      adopted.signatures[alice.pubkey] ||
      adopted.signatures[String(alice.pubkey).toLowerCase()]
    );
    assert.ok(aliceSig, 'inviter BIP340-signed the join proposal');
    assert.equal(String(aliceSig).startsWith('local:'), false);

    const tip = await waitFor(() => findJournalWithMember(meshB.journals, bob.pubkey)
      || findJournalWithMember(meshA.journals, bob.pubkey));
    const tipBody = journalObject(tip);
    assert.ok(tipBody.stateDigest);
    assert.ok(tipBody.signatures && Object.keys(tipBody.signatures).length >= 1);
    const members = journalMembers(tip);
    assert.ok(members.some((m) => String(m).toLowerCase() === alice.pubkey.toLowerCase()));
    assert.ok(members.some((m) => String(m).toLowerCase() === bob.pubkey.toLowerCase()));

    const groupForVerify = a.node.groupManager.findGroup(groupId)
      || b.node.groupManager.findGroup(groupId);
    assert.ok(verifyGroupStateTip(
      groupForVerify,
      contractId,
      tipBody.tipClock,
      tipBody.stateDigest,
      tipBody.signatures
    ), 'state commitment verifies against the roster that includes the new member');
  } finally {
    await sleep(200);
    for (const row of started.reverse()) await stopRelay(row);
  }
});

test('Fabric e2e: existing member (not inviter) receives join proposal through the hub', {
  timeout: 90000
}, async () => {
  const alice = fixtureIdentity('alice');
  const bob = fixtureIdentity('bob');
  const carol = fixtureIdentity('carol');
  const hubId = fixtureIdentity('hub');
  const portHub = fabricPort();
  const portA = portHub + 21;
  const portB = portHub + 23;
  const portC = portHub + 25;
  const started = [];

  try {
    const hub = await startRelay(hubId, {
      fabricPort: portHub,
      prefix: 'sc-gjoin-hub-',
      relayAppMessages: true
    });
    started.push(hub);
    const c = await startRelay(carol, {
      fabricPort: portC,
      prefix: 'sc-gjoin-c-',
      peers: [{ address: `127.0.0.1:${portHub}`, enabled: true }]
    });
    started.push(c);
    const b = await startRelay(bob, {
      fabricPort: portB,
      prefix: 'sc-gjoin-spoke-b-',
      peers: [{ address: `127.0.0.1:${portHub}`, enabled: true }]
    });
    started.push(b);
    const a = await startRelay(alice, {
      fabricPort: portA,
      prefix: 'sc-gjoin-spoke-a-',
      peers: [{ address: `127.0.0.1:${portHub}`, enabled: true }]
    });
    started.push(a);

    await waitFor(() => (
      hub.node.fabricNetwork.status().fabricConnected >= 3 &&
      a.node.fabricNetwork.status().fabricConnected >= 1 &&
      b.node.fabricNetwork.status().fabricConnected >= 1 &&
      c.node.fabricNetwork.status().fabricConnected >= 1
    ));

    const meshC = listenMesh(c.node);
    const httpA = a.node.server.address().port;
    const httpB = b.node.server.address().port;

    const created = await request(httpA, 'POST', `${BASE}/groups`, {
      name: 'Hub Join Wing',
      members: [alice.pubkey, carol.pubkey],
      validators: [alice.pubkey, carol.pubkey],
      threshold: 1,
      creator: alice.pubkey
    });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const groupId = created.body.data.id;
    const contractId = created.body.data.contractId;
    assert.ok(contractId);

    await waitFor(() => c.node.groupManager && (
      c.node.groupManager.getGroupByContractId(contractId)
      || c.node.groupManager.findGroup(groupId)
    ));
    assert.ok(hasMember(c.node.groupManager.findGroup(groupId)
      || c.node.groupManager.getGroupByContractId(contractId), carol.pubkey));

    const invite = await request(httpA, 'POST', `${BASE}/groups/${groupId}/invites`, {
      note: 'via hub for carol to see',
      inviteePubkey: bob.pubkey,
      actor: alice.pubkey
    });
    assert.strictEqual(invite.status, 200, JSON.stringify(invite.body));
    const inviteId = invite.body.data.inviteId;

    await waitFor(() => b.node.registerStore && b.node.registerStore.get('groupinvites', inviteId));

    const accept = await request(
      httpB,
      'POST',
      `${BASE}/groups/${groupId}/invites/${inviteId}/accept`,
      { actor: bob.pubkey }
    );
    assert.strictEqual(accept.status, 200, JSON.stringify(accept.body));

    const inbound = await waitFor(() => findJoinProposal(meshC.proposals, {
      inviteId,
      member: bob.pubkey
    }), { timeoutMs: 25000 });
    assert.ok(inbound.invite, 'existing member sees the invitation on the proposal');
    assert.strictEqual(String(inbound.invite.inviteId), String(inviteId));
    assert.strictEqual(String(inbound.invite.inviteePubkey).toLowerCase(), bob.pubkey.toLowerCase());
    assert.strictEqual(String(inbound.member).toLowerCase(), bob.pubkey.toLowerCase());
    assert.strictEqual(String(inbound.invite.contractId).toLowerCase(), String(contractId).toLowerCase());

    await waitFor(() => {
      const gA = a.node.groupManager.findGroup(groupId);
      const gB = b.node.groupManager.findGroup(groupId);
      const gC = c.node.groupManager.findGroup(groupId)
        || c.node.groupManager.getGroupByContractId(contractId);
      return hasMember(gA, bob.pubkey) && hasMember(gB, bob.pubkey) && hasMember(gC, bob.pubkey);
    }, { timeoutMs: 25000 });

    const tip = await waitFor(() => findJournalWithMember(meshC.journals, bob.pubkey), {
      timeoutMs: 25000
    });
    const tipBody = journalObject(tip);
    assert.ok(tipBody.stateDigest);
    assert.ok(tipBody.signatures && Object.keys(tipBody.signatures).length >= 1);
    const groupC = c.node.groupManager.findGroup(groupId)
      || c.node.groupManager.getGroupByContractId(contractId);
    assert.ok(verifyGroupStateTip(
      groupC,
      contractId,
      tipBody.tipClock,
      tipBody.stateDigest,
      tipBody.signatures
    ));
    assert.ok(hasMember(groupC, alice.pubkey));
    assert.ok(hasMember(groupC, carol.pubkey));
    assert.ok(hasMember(groupC, bob.pubkey));
  } finally {
    await sleep(200);
    for (const row of started.reverse()) await stopRelay(row);
  }
});
