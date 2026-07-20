'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const MissionManager = require('../../services/MissionManager');
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

test('MissionManager.ingestRemote upserts without officer allowlist', async () => {
  const mm = new MissionManager({ officers: ['boss-only'] });
  const remote = {
    id: 'mission-remote-1',
    title: 'Escort run',
    reward: 12000,
    createdBy: '02' + 'ab'.repeat(32),
    status: 'open'
  };
  // Not an officer — ingest still works (peer provenance).
  const r = mm.ingestRemote(remote);
  assert.strictEqual(r.created, true);
  assert.strictEqual(mm.getMission(remote.id).title, 'Escort run');
  const again = mm.ingestRemote(Object.assign({}, remote, { title: 'Escort run (updated)' }));
  assert.strictEqual(again.created, false);
  assert.strictEqual(mm.getMission(remote.id).title, 'Escort run (updated)');
});

test('broadcast reaches a peer hub; Accept applies and Ignore dismisses', async () => {
  const alice = createIdentity();
  const bob = createIdentity();

  const hubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-mb-hub-'));
  const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-mb-local-'));

  const hub = new LiveRelay({
    port: 0,
    mode: 'server',
    missions: { enable: true },
    settingsDir: hubDir,
    peers: []
  });
  await hub.start();
  const hubPort = hub.server.address().port;

  const local = new LiveRelay({
    port: 0,
    missions: { enable: true },
    settingsDir: localDir,
    uplink: { intervalMs: 60000 },
    peers: []
  });
  await local.start();
  const localPort = local.server.address().port;

  try {
    local.setIdentity(alice);
    await request(localPort, 'POST', '/peers', { url: `http://127.0.0.1:${hubPort}` });

    const created = await request(localPort, 'POST', `${BASE}/missions`, {
      title: 'Bounty: steal the crate',
      reward: 50000,
      createdBy: alice.pubkey
    });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const missionId = created.body.data.id;

    const broadcast = await request(localPort, 'POST', `${BASE}/missions/${missionId}/broadcast`);
    assert.strictEqual(broadcast.status, 200, JSON.stringify(broadcast.body));
    assert.strictEqual(broadcast.body.data.peers, 1);

    // Hub should have the mission + a pending broadcast (from alice, not self).
    const hubMission = hub.missionManager.getMission(missionId);
    assert.ok(hubMission, 'mission ingested on hub');
    assert.strictEqual(hubMission.title, 'Bounty: steal the crate');

    const list = await request(hubPort, 'GET', `${BASE}/missionbroadcasts?pending=1`);
    assert.strictEqual(list.status, 200);
    assert.ok(list.body.data.length >= 1);
    const offer = list.body.data.find((b) => b.missionId === missionId);
    assert.ok(offer, 'pending offer present');
    assert.strictEqual(offer.status, 'pending');
    assert.strictEqual(offer.source, alice.pubkey);

    // Bob accepts → applies to the mission.
    const bobToken = await login(hubPort, bob);
    const accepted = await request(hubPort, 'POST', `${BASE}/missionbroadcasts/${offer.id}/accept`, {}, bobToken);
    assert.strictEqual(accepted.status, 200, JSON.stringify(accepted.body));
    assert.strictEqual(accepted.body.data.status, 'accepted');
    const apps = hub.missionManager.getMissionApplications(missionId);
    assert.ok(apps.some((a) => a.applicantId === bob.pubkey && a.status === 'pending'));

    // Re-broadcast a second offer and ignore it.
    const broadcast2 = await request(localPort, 'POST', `${BASE}/missions/${missionId}/broadcast`);
    assert.strictEqual(broadcast2.status, 200);
    const list2 = await request(hubPort, 'GET', `${BASE}/missionbroadcasts?pending=1`);
    const offer2 = list2.body.data.find((b) => b.missionId === missionId && b.status === 'pending');
    assert.ok(offer2);
    const ignored = await request(hubPort, 'POST', `${BASE}/missionbroadcasts/${offer2.id}/ignore`, {}, bobToken);
    assert.strictEqual(ignored.status, 200);
    assert.strictEqual(ignored.body.data.status, 'ignored');
    assert.strictEqual(
      (await request(hubPort, 'GET', `${BASE}/missionbroadcasts?pending=1`)).body.data
        .filter((b) => b.id === offer2.id).length,
      0
    );

    // Non-creator cannot broadcast.
    const eve = createIdentity();
    local.setIdentity(eve);
    const forbidden = await request(localPort, 'POST', `${BASE}/missions/${missionId}/broadcast`);
    assert.strictEqual(forbidden.status, 403);
  } finally {
    await local.stop();
    await hub.stop();
    fs.rmSync(hubDir, { recursive: true, force: true });
    fs.rmSync(localDir, { recursive: true, force: true });
  }
});
