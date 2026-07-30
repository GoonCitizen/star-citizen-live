'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const PayoutManager = require('../../services/PayoutManager');
const { createIdentity, keyFromIdentity } = require('../../functions/identity');

const BASE = '/services/star-citizen';

function request (port, method, reqPath, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}

/** Minimal fake bitcoind for multisig derivation. */
function fakeRpc () {
  return async (method, params) => {
    if (method === 'createmultisig') {
      const [threshold, keys] = params;
      return { address: `bcrt1q-fake-${threshold}of${keys.length}-${keys[0].slice(0, 8)}`, redeemScript: 'aa'.repeat(20) };
    }
    if (method === 'scantxoutset') return { unspents: [], total_amount: 0 };
    throw new Error(`unexpected rpc: ${method}`);
  };
}

test('default peers: hub.fabric.pub and relay.goon.vc are seeded on first boot; removal is respected', async () => {
  const svc = new LiveRelay({ port: 0, missions: { enable: false }, fabric: { enable: false } });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const peers = (await request(port, 'GET', '/peers')).body.data;
    assert.strictEqual(peers.length, 2);
    assert.deepStrictEqual(peers.map((p) => p.address).sort(), [
      'hub.fabric.pub:7777',
      'relay.goon.vc:7777'
    ].sort());
    assert.ok(peers.every((p) => p.enabled === true && p.primary === true));
  } finally { await svc.stop(); }

  // Explicit peers override suppresses the seed (tests / custom deployments).
  const clean = new LiveRelay({ port: 0, missions: { enable: false }, peers: [], fabric: { enable: false } });
  await clean.start();
  try {
    assert.strictEqual((await request(clean.server.address().port, 'GET', '/peers')).body.data.length, 0);
  } finally { await clean.stop(); }
});

test('loopback peers are rejected; restore-seeds puts network hubs back', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-peers-heal-'));
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    missions: { enable: false },
    fabric: { enable: false }
  });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const bad = await request(port, 'POST', '/peers', { address: '127.0.0.1:7777' });
    assert.strictEqual(bad.status, 400);
    assert.match(String(bad.body.error || ''), /loopback/i);

    // Simulate a corrupted roster that only dialed self (forceHubs = UI restore).
    svc.settings.fabric = Object.assign({}, svc.settings.fabric, { port: 7777 });
    svc.peers = [
      { id: 'x', address: 'localhost:7777', enabled: true, shareLogs: false }
    ];
    const healed = svc._healPeerRoster({ persist: true, forceHubs: true });
    assert.ok(healed.removed.includes('localhost:7777'));
    assert.ok(healed.added.includes('hub.fabric.pub:7777'));
    assert.ok(healed.added.includes('relay.goon.vc:7777'));

    const restored = await request(port, 'POST', '/peers/restore-seeds', {});
    assert.strictEqual(restored.status, 200);
    const addresses = (restored.body.data.peers || []).map((p) => p.address).sort();
    assert.deepStrictEqual(addresses, ['hub.fabric.pub:7777', 'relay.goon.vc:7777'].sort());
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('shareLogs consent gates the event uplink but not chat', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const identity = createIdentity();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-wallet-'));
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    missions: { enable: false },
    peers: [{ address: '127.0.0.1:1' }],
    uplink: { intervalMs: 3600000 },
    fabric: { enable: false }
  });
  await svc.start();
  const port = svc.server.address().port;
  try {
    svc.setIdentity(identity);
    // Wire log→queue listeners without starting a real Fabric peer.
    svc._startFabricFlush();
    const KILL = "<2026-07-19T13:00:00.000Z> [Notice] <Actor Death> CActor::Kill: 'V' [1] in zone 'Z' killed by 'K' [2] using 'G' [Class R] with damage type 'B' from direction x: 0.1, y: 0.2, z: 0.3";

    // Default: sharing off → events do not queue.
    svc.handleLogChange(KILL);
    assert.strictEqual(svc._uplinkQueue.filter((e) => e.collection === 'kills').length, 0, 'no events while sharing off');

    // Turn sharing on via the settings API (no restart) — events queue.
    const put = await request(port, 'PUT', '/settings/shareLogsGlobal', { value: true });
    assert.strictEqual(put.status, 200);
    assert.strictEqual(put.body.requiresRestart, false);
    svc.handleLogChange(KILL.replace('13:00:00', '13:05:00'));
    assert.ok(svc._uplinkQueue.some((e) => e.collection === 'kills'), 'event queued while sharing on');
    svc._uplinkQueue.length = 0;

    // Per-peer grant without global: authorize the roster peer.
    await request(port, 'PUT', '/settings/shareLogsGlobal', { value: false });
    const peerId = svc.peers[0].id;
    const patch = await request(port, 'POST', `/peers/${peerId}`, { shareLogs: true });
    assert.strictEqual(patch.status, 200);
    assert.strictEqual(patch.body.data.shareLogs, true);
    svc.handleLogChange(KILL.replace('13:00:00', '13:10:00'));
    assert.ok(svc._uplinkQueue.some((e) => e.collection === 'kills'), 'event queued with per-peer shareLogs');
    assert.deepStrictEqual(svc._logShareTargets(), ['127.0.0.1:1']);

    // Chat is not gated by share consent (publishes over Fabric when enabled;
    // with fabric disabled it still posts locally without entering the log queue).
    const chat = await request(port, 'POST', `${BASE}/chat/messages`, { channel: 'global', body: 'still chatting' });
    assert.strictEqual(chat.status, 200);
    assert.strictEqual(chat.body.data.body, 'still chatting');
    assert.strictEqual(svc._uplinkQueue.filter((e) => e.collection === 'chatmessages').length, 0);

    const peers = await request(port, 'GET', '/peers');
    assert.strictEqual(peers.body.data[0].shareLogs, true);
    assert.ok(['connected', 'offline', 'disabled'].includes(peers.body.data[0].status));
  } finally {
    await svc.stop();
    require('fs').rmSync(dir, { recursive: true, force: true });
  }
});

test('group wallet: deterministic k-of-n multisig from the group roster', async () => {
  const a = createIdentity(); const b = createIdentity(); const c = createIdentity();
  const svc = new LiveRelay({
    port: 0,
    missions: { enable: true },
    peers: [],
    payouts: { enable: true, rpc: fakeRpc(), network: 'regtest' }
  });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const group = await svc.groupManager.createGroup({ name: 'Wing', members: [b.pubkey, c.pubkey], threshold: 2 }, a.pubkey);

    const res = await request(port, 'GET', `${BASE}/groups/${group.id}/wallet`);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.threshold, 2);
    assert.strictEqual(res.body.data.keys.length, 3);
    assert.deepStrictEqual(res.body.data.keys, [...group.members].sort(), 'sorted keys → deterministic address');
    assert.ok(res.body.data.address.startsWith('bcrt1q-fake-2of3-'));

    // Wallet summary endpoint reports the backend.
    const wallet = await request(port, 'GET', `${BASE}/wallet`);
    assert.strictEqual(wallet.body.data.mode, 'bitcoin');
    assert.strictEqual(wallet.body.data.network, 'regtest');
  } finally { await svc.stop(); }
});

test('PayoutManager.multisigAddress validates keys and clamps threshold', async () => {
  const pm = new PayoutManager({ ledger: true });
  const a = createIdentity(); const b = createIdentity();
  const w = await pm.multisigAddress([a.pubkey, b.pubkey], 5);
  assert.strictEqual(w.threshold, 2, 'threshold clamped to key count');
  assert.strictEqual(w.mode, 'ledger');
  assert.strictEqual(w.address, null);
  await assert.rejects(pm.multisigAddress(['nope'], 1), /compressed secp256k1/);
});

test('mission with Bitcoin reward: submit completion → approve (Schnorr) → payout unlocks', async () => {
  const authority = createIdentity();
  const pilot = createIdentity();
  const svc = new LiveRelay({
    port: 0,
    missions: { enable: true },
    peers: [],
    payouts: { enable: true, ledger: true, network: 'regtest' }
  });
  await svc.start();
  const port = svc.server.address().port;
  try {
    // Create with a reward + authority (the approver's key), then escrow it.
    const created = await request(port, 'POST', `${BASE}/missions`, {
      title: 'Escort the Hull-C',
      reward: 50000,
      createdBy: authority.pubkey,
      authorities: { keys: [authority.pubkey], threshold: 1 }
    });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const missionId = created.body.data.id;

    const escrow = await request(port, 'POST', `${BASE}/missions/${missionId}/escrow`, { amountSats: 50000, actor: authority.pubkey });
    assert.strictEqual(escrow.status, 200, JSON.stringify(escrow.body));
    assert.strictEqual(escrow.body.data.status, 'unfunded');
    assert.strictEqual(escrow.body.data.amountSats, 50000);

    // Pilot applies; authority accepts; pilot SUBMITS COMPLETION.
    const app = await request(port, 'POST', `${BASE}/missions/${missionId}/apply`, { applicantId: pilot.pubkey });
    await request(port, 'POST', `${BASE}/applications/${app.body.data.id}/decision`, { decision: 'accept', officerId: authority.pubkey });
    const claim = await request(port, 'POST', `${BASE}/missions/${missionId}/claim`, { claimantId: pilot.pubkey });
    assert.strictEqual(claim.status, 200, JSON.stringify(claim.body));
    const claimId = claim.body.data.id;

    // Wrong signer cannot approve.
    const msg = JSON.stringify({ action: 'mission.accept', missionId, claimId, claimantId: pilot.pubkey });
    const badSig = Buffer.from(keyFromIdentity(pilot).signSchnorr(Buffer.from(msg))).toString('hex');
    const denied = await request(port, 'POST', `${BASE}/claims/${claimId}/validate`, {
      decision: 'approve', signatures: { [pilot.pubkey]: badSig }
    });
    assert.strictEqual(denied.status, 403, 'non-authority signature rejected');

    // APPROVE COMPLETION with the authority's Schnorr signature → coins unlock.
    const sig = Buffer.from(keyFromIdentity(authority).signSchnorr(Buffer.from(msg))).toString('hex');
    const approved = await request(port, 'POST', `${BASE}/claims/${claimId}/validate`, {
      decision: 'approve', signatures: { [authority.pubkey]: sig }
    });
    assert.strictEqual(approved.status, 200, JSON.stringify(approved.body));

    const mission = (await request(port, 'GET', `${BASE}/missions/${missionId}`)).body.data;
    assert.strictEqual(mission.status, 'completed');
    assert.strictEqual(mission.escrow.status, 'payable', 'escrow unlocked by the approval');
    assert.strictEqual(mission.escrow.payee, pilot.pubkey, 'payable to the claimant');
  } finally { await svc.stop(); }
});
