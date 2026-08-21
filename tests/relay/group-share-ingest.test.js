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
const {
  groupContractDefinition,
  groupContractId
} = require('../../contracts/gooncitizenGroup');
const {
  buildFederationContractInviteJson,
  parseFederationContractInvite
} = require('../../functions/federationContractInvite');
const { buildGroupOfferBody } = require('../../functions/groupShareMessage');

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

async function startRelay (identity) {
  const dir = tmpDir('gc-share-ingest-');
  const port = 21000 + Math.floor(Math.random() * 2000);
  const service = new LiveRelay({
    port,
    mode: 'relay',
    logfile: path.join(dir, 'missing.log'),
    settingsDir: dir,
    missions: { enable: true, dir: path.join(dir, 'register') },
    fabric: { enable: false, listen: false, peers: [] },
    discord: { enable: false },
    uplink: { enable: false }
  });
  await service.start();
  if (identity) service.setIdentity(identity);
  return { service, port, dir };
}

function opaqueInviteUrl (alice, invite, contractId) {
  const net = new FabricNetwork({ enable: false, listen: false, peers: [], peersDb: null });
  net.setIdentity(alice);
  const msg = net.signContractMessage(contractId, 'FederationContractInvite', invite, { relay: false });
  return net.encodeOpaqueMessage(msg).protocolUrl;
}

function opaqueOfferUrl (alice, offer, contractId) {
  const net = new FabricNetwork({ enable: false, listen: false, peers: [], peersDb: null });
  net.setIdentity(alice);
  const msg = net.signContractMessage(contractId, 'GroupShare', offer, { relay: false });
  return net.encodeOpaqueMessage(msg).protocolUrl;
}

test('opaque Federation invite ingest materializes group; accept joins local identity', async () => {
  const alice = createIdentity();
  const bob = createIdentity();
  const def = groupContractDefinition({
    groupId: 'group-share-ingest-1',
    creator: alice.pubkey,
    validators: [alice.pubkey],
    threshold: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    meta: { name: 'Share Me', visibility: 'private' }
  });
  const contractId = groupContractId(def);
  const invite = parseFederationContractInvite(buildFederationContractInviteJson({
    inviteId: 'inv-paste-1',
    inviterHubId: alice.pubkey,
    contractId,
    proposedPolicy: def.proposedPolicy,
    note: 'welcome note should not become the group name',
    groupId: def.groupId,
    groupName: 'Share Me'
  }));
  assert.ok(invite);

  const { service, port, dir } = await startRelay(bob);
  try {
    const protocolUrl = opaqueInviteUrl(alice, invite, contractId);
    assert.ok(protocolUrl.startsWith('fabric:'), protocolUrl.slice(0, 24));
    assert.equal(/^fabric:(?:base64|b64)[,:]/i.test(protocolUrl), false);
    const ingest = await request(port, 'POST', `${BASE}/groups/share/ingest`, { protocolUrl });
    assert.strictEqual(ingest.status, 200, ingest.body && ingest.body.error);
    assert.strictEqual(ingest.body.data.kind, 'FederationContractInvite');
    assert.ok(ingest.body.data.group, 'group shell materialized');
    assert.strictEqual(ingest.body.data.group.contractId, contractId);
    assert.strictEqual(ingest.body.data.group.id, def.groupId, 'shell keeps inviter groupId');
    assert.strictEqual(ingest.body.data.group.name, 'Share Me', 'shell keeps inviter groupName');
    assert.ok(ingest.body.data.inbox, 'import creates a notification row');
    assert.strictEqual(ingest.body.data.inbox.status, 'pending');
    assert.strictEqual(ingest.body.data.pending, true);

    const inbox = await request(port, 'GET', `${BASE}/inbox?scope=notifications&pending=1`);
    assert.strictEqual(inbox.status, 200);
    const pendingJoin = (inbox.body.data || []).filter((r) => r.status === 'pending' &&
      (r.kind === 'FederationInvite' || r.kind === 'MultisigWalletInvite'));
    assert.ok(pendingJoin.length >= 1, 'pending invite is listed in Notifications');

    const groupId = ingest.body.data.group.id;
    const accept = await request(port, 'POST',
      `${BASE}/groups/${encodeURIComponent(groupId)}/invites/${encodeURIComponent(invite.inviteId)}/accept`,
      {});
    assert.strictEqual(accept.status, 200, accept.body && accept.body.error);
    assert.ok(accept.body.data.group);
    assert.ok(accept.body.data.group.members.includes(bob.pubkey), 'bob joined locally');
  } finally {
    await service.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('opaque public GroupOffer ingest + apply uses local publishing identity', async () => {
  const alice = createIdentity();
  const bob = createIdentity();
  const def = groupContractDefinition({
    groupId: 'group-public-offer-1',
    creator: alice.pubkey,
    validators: [alice.pubkey],
    threshold: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    meta: { name: 'Public Ops', visibility: 'public' }
  });
  const contractId = groupContractId(def);
  const offer = buildGroupOfferBody({
    group: { id: def.groupId, name: 'Public Ops', visibility: 'public', contractId },
    definition: def,
    actor: alice.pubkey,
    note: 'come fly'
  });

  const { service, port, dir } = await startRelay(bob);
  try {
    const protocolUrl = opaqueOfferUrl(alice, offer, contractId);
    assert.ok(protocolUrl.startsWith('fabric:'), protocolUrl.slice(0, 24));
    assert.equal(/^fabric:(?:base64|b64)[,:]/i.test(protocolUrl), false);
    const ingest = await request(port, 'POST', `${BASE}/groups/share/ingest`, { protocolUrl });
    assert.strictEqual(ingest.status, 200, ingest.body && ingest.body.error);
    assert.strictEqual(ingest.body.data.kind, 'GroupOffer');
    assert.ok(ingest.body.data.group);
    assert.strictEqual(ingest.body.data.group.visibility, 'public');
    assert.ok(ingest.body.data.inbox);
    assert.strictEqual(ingest.body.data.inbox.kind, 'GroupOffer');
    assert.strictEqual(ingest.body.data.inbox.status, 'pending');

    const apply = await request(port, 'POST',
      `${BASE}/groups/${encodeURIComponent(ingest.body.data.group.id)}/applications`,
      { message: 'hi' });
    assert.strictEqual(apply.status, 200, apply.body && apply.body.error);
    assert.strictEqual(apply.body.data.applicantId, bob.pubkey);
  } finally {
    await service.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('opaque hex fabric: url still ingests a GroupOffer', async () => {
  const alice = createIdentity();
  const bob = createIdentity();
  const def = groupContractDefinition({
    groupId: 'group-hex-offer-1',
    creator: alice.pubkey,
    validators: [alice.pubkey],
    threshold: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    meta: { name: 'Hex Ops', visibility: 'public' }
  });
  const contractId = groupContractId(def);
  const offer = buildGroupOfferBody({
    group: { id: def.groupId, name: 'Hex Ops', visibility: 'public', contractId },
    definition: def,
    actor: alice.pubkey
  });
  const { service, port, dir } = await startRelay(bob);
  try {
    const net = new FabricNetwork({ enable: false, listen: false, peers: [], peersDb: null });
    net.setIdentity(alice);
    const msg = net.signContractMessage(contractId, 'GroupShare', offer, { relay: false });
    const protocolUrl = net.encodeOpaqueMessage(msg, { encoding: 'hex' }).protocolUrl;
    assert.ok(protocolUrl.startsWith('fabric:'));
    assert.ok(!protocolUrl.startsWith('fabric:base64'));
    const ingest = await request(port, 'POST', `${BASE}/groups/share/ingest`, { protocolUrl });
    assert.strictEqual(ingest.status, 200, ingest.body && ingest.body.error);
    assert.strictEqual(ingest.body.data.kind, 'GroupOffer');
    assert.ok(ingest.body.data.inbox);
    assert.strictEqual(ingest.body.data.inbox.status, 'pending');
  } finally {
    await service.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('expired GroupOffer and Federation invite clips return 410', async () => {
  const alice = createIdentity();
  const bob = createIdentity();
  const def = groupContractDefinition({
    groupId: 'group-expired-offer-1',
    creator: alice.pubkey,
    validators: [alice.pubkey],
    threshold: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    meta: { name: 'Stale Ops', visibility: 'public' }
  });
  const contractId = groupContractId(def);
  const offer = buildGroupOfferBody({
    group: { id: def.groupId, name: 'Stale Ops', visibility: 'public', contractId },
    definition: def,
    actor: alice.pubkey,
    expiresAt: Date.now() - 1000
  });
  const invite = parseFederationContractInvite(buildFederationContractInviteJson({
    inviteId: 'inv-expired-1',
    inviterHubId: alice.pubkey,
    contractId,
    proposedPolicy: def.proposedPolicy,
    groupId: def.groupId,
    groupName: 'Stale Ops',
    expiresAt: Date.now() - 1000
  }));
  const { service, port, dir } = await startRelay(bob);
  try {
    const offerIngest = await request(port, 'POST', `${BASE}/groups/share/ingest`, {
      protocolUrl: opaqueOfferUrl(alice, offer, contractId)
    });
    assert.strictEqual(offerIngest.status, 410, JSON.stringify(offerIngest.body));
    assert.strictEqual(offerIngest.body.expired, true);

    const inviteIngest = await request(port, 'POST', `${BASE}/groups/share/ingest`, {
      protocolUrl: opaqueInviteUrl(alice, invite, contractId)
    });
    assert.strictEqual(inviteIngest.status, 410, JSON.stringify(inviteIngest.body));
    assert.strictEqual(inviteIngest.body.expired, true);
  } finally {
    await service.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('accept refuses a stored invite after expiresAt', async () => {
  const alice = createIdentity();
  const bob = createIdentity();
  const def = groupContractDefinition({
    groupId: 'group-expire-accept-1',
    creator: alice.pubkey,
    validators: [alice.pubkey],
    threshold: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    meta: { name: 'Expire Accept', visibility: 'private' }
  });
  const contractId = groupContractId(def);
  const invite = parseFederationContractInvite(buildFederationContractInviteJson({
    inviteId: 'inv-expire-accept-1',
    inviterHubId: alice.pubkey,
    contractId,
    proposedPolicy: def.proposedPolicy,
    groupId: def.groupId,
    groupName: 'Expire Accept',
    expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000)
  }));
  const { service, port, dir } = await startRelay(bob);
  try {
    const ingest = await request(port, 'POST', `${BASE}/groups/share/ingest`, {
      protocolUrl: opaqueInviteUrl(alice, invite, contractId)
    });
    assert.strictEqual(ingest.status, 200, ingest.body && ingest.body.error);
    const stored = service.registerStore.get('groupinvites', invite.inviteId);
    assert.ok(stored);
    stored.expiresAt = Date.now() - 1;
    service.registerStore.put('groupinvites', invite.inviteId, stored);

    const accept = await request(port, 'POST',
      `${BASE}/groups/${encodeURIComponent(def.groupId)}/invites/${encodeURIComponent(invite.inviteId)}/accept`,
      {});
    assert.strictEqual(accept.status, 410, JSON.stringify(accept.body));
    assert.strictEqual(accept.body.expired, true);
  } finally {
    await service.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('targeted invite clip is refused by a different identity; invitee accept joins', async () => {
  const alice = createIdentity();
  const bob = createIdentity();
  const carol = createIdentity();
  const def = groupContractDefinition({
    groupId: 'group-targeted-1',
    creator: alice.pubkey,
    validators: [alice.pubkey],
    threshold: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    meta: { name: 'Targeted Wing', visibility: 'private' }
  });
  const contractId = groupContractId(def);
  const invite = parseFederationContractInvite(buildFederationContractInviteJson({
    inviteId: 'inv-targeted-1',
    inviterHubId: alice.pubkey,
    contractId,
    proposedPolicy: def.proposedPolicy,
    groupId: def.groupId,
    groupName: 'Targeted Wing',
    inviteePubkey: bob.pubkey
  }));
  const protocolUrl = opaqueInviteUrl(alice, invite, contractId);

  const carolNode = await startRelay(carol);
  try {
    const denied = await request(carolNode.port, 'POST', `${BASE}/groups/share/ingest`, { protocolUrl });
    assert.strictEqual(denied.status, 403, JSON.stringify(denied.body));
  } finally {
    await carolNode.service.stop();
    fs.rmSync(carolNode.dir, { recursive: true, force: true });
  }

  const { service, port, dir } = await startRelay(bob);
  try {
    const ingest = await request(port, 'POST', `${BASE}/groups/share/ingest`, { protocolUrl });
    assert.strictEqual(ingest.status, 200, ingest.body && ingest.body.error);
    assert.strictEqual(ingest.body.data.kind, 'FederationContractInvite');
    assert.ok(ingest.body.data.inbox);

    const accept = await request(port, 'POST',
      `${BASE}/groups/${encodeURIComponent(def.groupId)}/invites/${encodeURIComponent(invite.inviteId)}/accept`,
      {});
    assert.strictEqual(accept.status, 200, accept.body && accept.body.error);
    assert.ok(accept.body.data.group);
    assert.ok(
      (accept.body.data.group.members || []).some(
        (m) => String(m).toLowerCase() === String(bob.pubkey).toLowerCase()
      ),
      'bob joined locally'
    );
  } finally {
    await service.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
