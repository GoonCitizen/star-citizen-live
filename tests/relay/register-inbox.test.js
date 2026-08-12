'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const registerInbox = require('../../functions/registerInbox');
const { createIdentity, signEnvelope } = require('../../functions/identity');

const BASE = '/services/star-citizen';

function tmpDir (prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

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
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return res.body.data.token;
}

test('registerInbox maps audits and broadcasts', () => {
  const appAudit = {
    id: 'audit-0',
    ts: '2026-01-01T00:00:00.000Z',
    actor: '02' + 'ab'.repeat(32),
    action: 'application.submit',
    entity: 'application',
    entityId: 'app-1',
    summary: 'Escort run'
  };
  const row = registerInbox.entryFromMissionAudit(appAudit);
  assert.ok(row);
  assert.strictEqual(row.kind, 'MissionApplication');
  assert.strictEqual(row.refs.applicationId, 'app-1');
  assert.ok(registerInbox.isNotification(row));

  const decision = registerInbox.entryFromMissionAudit({
    id: 'audit-1',
    ts: '2026-01-01T00:01:00.000Z',
    actor: '02' + 'cd'.repeat(32),
    action: 'application.accept',
    entity: 'application',
    entityId: 'app-1',
    summary: 'Escort run'
  });
  assert.strictEqual(decision.kind, 'MissionApplicationDecision');
  assert.ok(!registerInbox.isNotification(decision));

  const mb = registerInbox.entryFromMissionBroadcast({
    id: 'mb1',
    missionId: 'm1',
    mission: { title: 'Bounty', description: 'Hunt', reward: 1000 },
    source: 'peer',
    broadcastAt: '2026-01-01T00:00:00.000Z',
    status: 'pending'
  });
  assert.strictEqual(mb.kind, 'MissionBroadcast');
  assert.strictEqual(mb.actionable, true);
  assert.ok(registerInbox.isNotification(mb));

  const fi = registerInbox.entryFromFederationInvite({
    inviteId: 'inv-x',
    inviterHubId: '02' + 'ab'.repeat(32),
    groupId: 'g1',
    groupName: 'Wing Alpha',
    inviteePubkey: '02' + 'cd'.repeat(32),
    status: 'pending',
    note: 'come fly'
  });
  assert.strictEqual(fi.kind, 'MultisigWalletInvite');
  assert.strictEqual(fi.title, 'Multisig wallet invite · Wing Alpha');
  assert.strictEqual(fi.refs.inviteePubkey, '02' + 'cd'.repeat(32));
  assert.ok(registerInbox.isNotification(fi));

  const readerInvite = registerInbox.entryFromFederationInvite({
    inviteId: 'inv-reader',
    role: 'reader',
    groupName: 'Library',
    status: 'pending'
  });
  assert.strictEqual(readerInvite.kind, 'FederationInvite');
  assert.ok(registerInbox.isNotification(readerInvite));

  const rejectDecision = registerInbox.entryFromGroupAudit({
    id: 'gaudit-1',
    ts: '2026-01-01T00:02:00.000Z',
    actor: '02' + 'ab'.repeat(32),
    action: 'group.application.reject',
    entityId: 'g1',
    summary: 'app-9'
  });
  assert.strictEqual(rejectDecision.kind, 'GroupApplicationDecision');
  assert.strictEqual(rejectDecision.status, 'rejected');
  assert.ok(registerInbox.isNotification(rejectDecision));

  const wallet = registerInbox.entryFromWalletEvent({
    kind: 'WalletPayout',
    title: 'Mission payout unlocked',
    status: 'pending',
    actionable: true,
    refs: { missionId: 'm1' },
    dedupeKey: 'wallet-test-1'
  });
  assert.strictEqual(wallet.kind, 'WalletPayout');
  assert.ok(registerInbox.isNotification(wallet));
});

test('notifications vs mission/group activity scopes', async () => {
  const dir = tmpDir('sc-inbox-');
  const officer = createIdentity();
  const pilot = createIdentity();
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    fabric: { enable: false },
    missions: { enable: true, officers: [officer.pubkey] }
  });
  await svc.start();
  try {
    svc.setIdentity(officer);
    const port = svc.server.address().port;
    const officerToken = await login(port, officer);
    const pilotToken = await login(port, pilot);

    const created = await request(port, 'POST', `${BASE}/missions`, {
      title: 'Inbox escort',
      description: 'Test mission for inbox',
      reward: 5000
    }, officerToken);
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const missionId = created.body.data.id;

    const applied = await request(port, 'POST', `${BASE}/missions/${missionId}/apply`, {
      applicantId: pilot.pubkey,
      message: 'ready'
    }, pilotToken);
    assert.strictEqual(applied.status, 200, JSON.stringify(applied.body));

    const decided = await request(port, 'POST', `${BASE}/applications/${applied.body.data.id}/decision`, {
      decision: 'accept'
    }, officerToken);
    assert.strictEqual(decided.status, 200, JSON.stringify(decided.body));

    const remote = createIdentity();
    const ingested = svc._ingestMissionBroadcast(remote.pubkey, {
      mission: {
        id: 'remote-mission-1',
        title: 'Remote bounty',
        description: 'From the mesh',
        createdBy: remote.pubkey,
        status: 'open',
        reward: 12000
      },
      broadcastAt: new Date().toISOString(),
      handle: 'RemotePilot'
    });
    assert.ok(ingested.created);

    const all = await request(port, 'GET', `${BASE}/inbox`);
    assert.strictEqual(all.status, 200, JSON.stringify(all.body));
    const allKinds = (all.body.data || []).map((r) => r.kind);
    assert.ok(allKinds.includes('MissionApplication'), allKinds.join(','));
    assert.ok(allKinds.includes('MissionApplicationDecision'), allKinds.join(','));
    assert.ok(allKinds.includes('MissionBroadcast'), allKinds.join(','));
    assert.ok(allKinds.includes('MissionCreated'), allKinds.join(','));

    const notices = await request(port, 'GET', `${BASE}/inbox?scope=notifications`);
    assert.strictEqual(notices.status, 200);
    const noticeKinds = new Set((notices.body.data || []).map((r) => r.kind));
    assert.ok(noticeKinds.has('MissionBroadcast'));
    assert.ok(noticeKinds.has('MissionApplication'));
    assert.ok(!noticeKinds.has('MissionApplicationDecision'), 'decisions are activity, not notifications');
    assert.ok(!noticeKinds.has('MissionCreated'), 'creates are activity, not notifications');

    const missionLog = await request(port, 'GET', `${BASE}/inbox?missionId=${encodeURIComponent(missionId)}`);
    assert.strictEqual(missionLog.status, 200);
    const missionKinds = (missionLog.body.data || []).map((r) => r.kind);
    assert.ok(missionKinds.includes('MissionCreated'), missionKinds.join(','));
    assert.ok(missionKinds.includes('MissionApplication'), missionKinds.join(','));
    assert.ok(missionKinds.includes('MissionApplicationDecision'), missionKinds.join(','));
    assert.ok(!(missionLog.body.data || []).some((r) => r.refs && r.refs.missionId === 'remote-mission-1'));

    const group = await request(port, 'POST', `${BASE}/groups`, {
      name: 'Inbox Squad',
      visibility: 'public',
      members: [officer.pubkey]
    }, officerToken);
    assert.strictEqual(group.status, 200, JSON.stringify(group.body));
    const groupId = group.body.data.id;
    const gapp = await request(port, 'POST', `${BASE}/groups/${groupId}/applications`, {
      message: 'let me in'
    }, pilotToken);
    assert.strictEqual(gapp.status, 200, JSON.stringify(gapp.body));

    const notices2 = await request(port, 'GET', `${BASE}/inbox?scope=notifications`);
    assert.ok(
      (notices2.body.data || []).some((r) => r.kind === 'GroupApplication'),
      'group applications are notifications'
    );

    const decide = await request(port, 'POST', `${BASE}/group-applications/${gapp.body.data.id}/decision`, {
      decision: 'reject'
    }, officerToken);
    assert.strictEqual(decide.status, 200, JSON.stringify(decide.body));

    const notices3 = await request(port, 'GET', `${BASE}/inbox?scope=notifications`);
    assert.ok(
      (notices3.body.data || []).some((r) => r.kind === 'GroupApplicationDecision' && r.status === 'rejected'),
      'group join rejections appear in notifications'
    );

    const groupLog = await request(port, 'GET', `${BASE}/inbox?groupId=${encodeURIComponent(groupId)}`);
    assert.strictEqual(groupLog.status, 200);
    const groupKinds = (groupLog.body.data || []).map((r) => r.kind);
    assert.ok(groupKinds.includes('GroupApplication'), groupKinds.join(','));
    assert.ok(groupKinds.includes('GroupCreated'), groupKinds.join(','));
  } finally {
    await svc.stop();
  }
});
