'use strict';

/**
 * Intelligence path: local Game.log always accumulates; mesh share is opt-in;
 * two public peers exchange analytics when both enable sharing.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
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

async function waitFor (fn, { timeoutMs = 25000, intervalMs = 100 } = {}) {
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

function loginLine (ts, handle) {
  return `<${ts}> [Notice] <Legacy login response> [CIG-net] User Login Success - Handle[${handle}] - Time[1] [Team_GameServices][Login]`;
}

function missionEndLine (ts, missionId, player, outcome) {
  return `<${ts}> [Notice] <EndMission> Ending mission for player. MissionId[${missionId}] Player[${player}] PlayerId[1] CompletionType[${outcome}] Reason[Mission Ended] [Team_MissionFeatures][Missions]`;
}

function deathLine (ts, bodyId) {
  return `<${ts}> [Notice] <Adding non kept item [CSCActorCorpseUtils::PopulateItemPortForItemRecoveryEntitlement]> Item 'body_01_noMagicPocket_${bodyId} - Class(body_01_noMagicPocket) - Context(Streamable Runtime-spawned) - Socpak()', Recorded data is: Port Name 'Body_ItemPort', Class GUID: 'dbaa8a7d-755f-4104-8b24-7b58fd1e76f6', KeptId: '${bodyId}' [Team_CoreGameplayFeatures][Unknown]`;
}

function playLines (svc, lines) {
  for (const line of lines) svc.handleLogChange(line);
}

function hasPilot (history, player) {
  return (history.missions || []).some((m) => m.player === player)
    || (history.deaths || []).some((d) => d.player === player);
}

function sourceOf (history, player) {
  const row = (history.missions || []).find((m) => m.player === player)
    || (history.deaths || []).find((d) => d.player === player);
  return row && row.source ? String(row.source).toLowerCase() : null;
}

function nodeOpts (dir, fabPort, peers) {
  const logfile = path.join(dir, 'Game.log');
  fs.writeFileSync(logfile, '');
  return {
    port: 0,
    settingsDir: dir,
    logfile,
    historyFile: path.join(dir, 'history.json'),
    cursorsFile: path.join(dir, 'log-cursors.json'),
    missions: { enable: false },
    uplink: { intervalMs: 3600000 },
    gameStatePublishIntervalMs: 3600000,
    peers,
    fabric: {
      enable: true,
      listen: true,
      port: fabPort,
      peers: [],
      peersDb: null,
      relayAppMessages: true
    }
  };
}

test('local Game.log always accumulates while sharing stays off', async () => {
  const dir = tmpDir('sc-log-local-');
  const svc = new LiveRelay(nodeOpts(dir, fabricPort(), []));
  await svc.start();
  const identity = createIdentity();
  svc.setIdentity(identity);
  try {
    playLines(svc, [
      loginLine('2026-08-21T10:00:00.000Z', 'SoloPilot'),
      missionEndLine('2026-08-21T10:05:00.000Z', 'aaaa1111-d438-4996-9755-ccc000000001', 'SoloPilot', 'Complete')
    ]);
    assert.ok(hasPilot(svc.history, 'SoloPilot'), 'local history recorded the mission');
    assert.strictEqual(sourceOf(svc.history, 'SoloPilot'), 'local');
    assert.strictEqual(svc._canShareLogs(), false);
    assert.strictEqual(svc._uplinkQueue.filter((e) => e.collection === 'missionlog').length, 0);
    assert.strictEqual(await svc.publishGameStateSnapshot(), null);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('two sharing peers acquire each other\'s Game.log analytics', { timeout: 60000 }, async () => {
  const alice = createIdentity();
  const bob = createIdentity();
  const fabA = fabricPort();
  const fabB = fabA + 11;
  const dirA = tmpDir('sc-log-a-');
  const dirB = tmpDir('sc-log-b-');

  const nodeB = new LiveRelay(nodeOpts(dirB, fabB, [
    { address: `127.0.0.1:${fabA}`, label: 'alice', enabled: true, shareLogs: false }
  ]));
  await nodeB.start();
  nodeB.setIdentity(bob);
  await waitFor(() => nodeB.fabricNetwork && nodeB.fabricNetwork.ready);

  const nodeA = new LiveRelay(nodeOpts(dirA, fabA, [
    { address: `127.0.0.1:${fabB}`, label: 'bob', enabled: true, shareLogs: false }
  ]));
  await nodeA.start();
  nodeA.setIdentity(alice);
  await waitFor(() => nodeA.fabricNetwork && nodeA.fabricNetwork.ready);
  await waitFor(() => (
    nodeA.fabricNetwork.status().fabricConnected >= 1 ||
    nodeB.fabricNetwork.status().fabricConnected >= 1
  ));

  const httpA = nodeA.server.address().port;
  const httpB = nodeB.server.address().port;

  try {
    playLines(nodeA, [
      loginLine('2026-08-21T11:00:00.000Z', 'AlphaPilot'),
      missionEndLine('2026-08-21T11:10:00.000Z', 'aaaa1111-d438-4996-9755-aaa000000001', 'AlphaPilot', 'Complete'),
      deathLine('2026-08-21T11:12:00.000Z', '200128671001')
    ]);
    assert.ok(hasPilot(nodeA.history, 'AlphaPilot'));
    assert.strictEqual(sourceOf(nodeA.history, 'AlphaPilot'), 'local');

    assert.strictEqual(await nodeA._flushUplink(), null);
    assert.strictEqual(await nodeA.publishGameStateSnapshot(), null);
    await sleep(400);
    assert.equal(hasPilot(nodeB.history, 'AlphaPilot'), false, 'peer must not acquire logs while sharing is off');

    const putA = await request(httpA, 'PUT', '/settings/shareLogsGlobal', { value: true });
    const putB = await request(httpB, 'PUT', '/settings/shareLogsGlobal', { value: true });
    assert.strictEqual(putA.status, 200, JSON.stringify(putA.body));
    assert.strictEqual(putB.status, 200, JSON.stringify(putB.body));
    assert.strictEqual(nodeA._canShareLogs(), true);
    assert.strictEqual(nodeB._canShareLogs(), true);
    nodeA._startFabricFlush();
    nodeB._startFabricFlush();

    // Enabling share must publish pre-consent history (not only future lines).
    await waitFor(() => hasPilot(nodeB.history, 'AlphaPilot'));
    assert.strictEqual(sourceOf(nodeB.history, 'AlphaPilot'), String(alice.pubkey).toLowerCase());

    playLines(nodeB, [
      loginLine('2026-08-21T12:00:00.000Z', 'BravoPilot'),
      missionEndLine('2026-08-21T12:10:00.000Z', 'bbbb2222-150d-4ec1-bd99-bbb000000002', 'BravoPilot', 'Complete'),
      deathLine('2026-08-21T12:12:00.000Z', '200128671002')
    ]);
    playLines(nodeA, [
      missionEndLine('2026-08-21T11:20:00.000Z', 'aaaa1111-d438-4996-9755-aaa000000002', 'AlphaPilot', 'Abandon')
    ]);

    await nodeA._flushUplink();
    await nodeB._flushUplink();
    assert.ok(await nodeA.publishGameStateSnapshot(), 'alice snapshot published');
    assert.ok(await nodeB.publishGameStateSnapshot(), 'bob snapshot published');

    await waitFor(() => hasPilot(nodeA.history, 'BravoPilot'));

    assert.strictEqual(sourceOf(nodeA.history, 'BravoPilot'), String(bob.pubkey).toLowerCase());
    assert.strictEqual(sourceOf(nodeA.history, 'AlphaPilot'), 'local');
    assert.strictEqual(sourceOf(nodeB.history, 'BravoPilot'), 'local');

    nodeA._analyticsCache = null;
    nodeB._analyticsCache = null;
    const azA = await request(httpA, 'GET', `${BASE}/analytics`);
    const azB = await request(httpB, 'GET', `${BASE}/analytics`);
    assert.strictEqual(azA.status, 200);
    assert.strictEqual(azB.status, 200);
    const azHasPilot = (body, player) => (body.missions || []).some((m) => m.player === player)
      || (body.deaths || []).some((d) => d.player === player)
      || (body.players || []).includes(player);
    assert.ok(azHasPilot(azA.body, 'BravoPilot'),
      'alice All-logs analytics includes bob: ' + JSON.stringify({
        players: azA.body.players,
        missions: (azA.body.missions || []).map((m) => m.player),
        deaths: (azA.body.deaths || []).map((d) => d.player)
      }));
    assert.ok(azHasPilot(azB.body, 'AlphaPilot'),
      'bob All-logs analytics includes alice: ' + JSON.stringify({
        players: azB.body.players,
        missions: (azB.body.missions || []).map((m) => m.player),
        deaths: (azB.body.deaths || []).map((d) => d.player)
      }));
    assert.ok((nodeA.history.missions || []).some((m) => m.player === 'AlphaPilot' && (m.source == null || m.source === 'local')));
    assert.ok((nodeB.history.missions || []).some((m) => m.player === 'BravoPilot' && (m.source == null || m.source === 'local')));
  } finally {
    await nodeA.stop();
    await nodeB.stop();
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});
