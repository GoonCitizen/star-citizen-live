'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity, keyFromIdentity } = require('../../functions/identity');
const { FEDERATION_WITNESS } = require('@fabric/core/functions/signingTags');

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

/** Minimal fake bitcoind for multisig derivation + address scans. */
function fakeRpc (state = {}) {
  state.utxos = state.utxos || [];
  const rpc = async (method, params) => {
    if (method === 'createmultisig') {
      const [threshold, keys] = params;
      return { address: `bcrt1q-fake-${threshold}of${keys.length}-${keys[0].slice(0, 8)}`, redeemScript: 'aa'.repeat(20) };
    }
    if (method === 'scantxoutset') {
      return {
        unspents: state.utxos,
        total_amount: state.utxos.reduce((s, u) => s + (Number(u.amount) || 0), 0)
      };
    }
    throw new Error(`unexpected rpc: ${method}`);
  };
  rpc.state = state;
  return rpc;
}

test('default peers: the network hubs are seeded on first boot; removal is respected', async () => {
  const svc = new LiveRelay({ port: 0, missions: { enable: false }, fabric: { enable: false } });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const peers = (await request(port, 'GET', '/peers')).body.data;
    assert.strictEqual(peers.length, 3);
    assert.deepStrictEqual(peers.map((p) => p.address).sort(), [
      'hub.fabric.pub:7777',
      'hub.goon.vc:7777',
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

test('a saved roster gets a new default seed once; removing it sticks', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const settingsStore = require('../../functions/settingsStore');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-peers-offer-'));
  const boot = async (edit) => {
    const svc = new LiveRelay({ port: 0, settingsDir: dir, missions: { enable: false }, fabric: { enable: false } });
    await svc.start();
    const addresses = svc.peers.map((p) => p.address).sort();
    if (edit) edit(svc);
    await svc.stop();
    return addresses;
  };
  const save = (svc, addresses) => settingsStore.putSetting(svc.registerStore, 'peers',
    svc.peers.filter((p) => addresses.includes(p.address)).map(({ lastSeen, lastError, ...p }) => p));
  try {
    // A roster saved before hub.goon.vc was a seed.
    await boot((svc) => {
      save(svc, ['hub.fabric.pub:7777', 'relay.goon.vc:7777']);
      settingsStore.putSetting(svc.registerStore, 'seedsOffered', null);
    });
    const upgraded = await boot((svc) => save(svc, ['hub.fabric.pub:7777', 'relay.goon.vc:7777']));
    assert.deepStrictEqual(upgraded, ['hub.fabric.pub:7777', 'hub.goon.vc:7777', 'relay.goon.vc:7777']);
    assert.deepStrictEqual(await boot(), ['hub.fabric.pub:7777', 'relay.goon.vc:7777']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('self loopback peers are rejected; other-port loopback and restore-seeds work', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-peers-heal-'));
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    missions: { enable: false },
    fabric: { enable: false, port: 7778 }
  });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const selfLoop = await request(port, 'POST', '/peers', { address: '127.0.0.1:7778' });
    assert.strictEqual(selfLoop.status, 400);
    assert.match(String(selfLoop.body.error || ''), /self/i);

    const localHub = await request(port, 'POST', '/peers', {
      address: '127.0.0.1:7777',
      label: 'local-hub'
    });
    assert.strictEqual(localHub.status, 200);
    assert.strictEqual(localHub.body.data.address, '127.0.0.1:7777');

    // Simulate a corrupted roster that only dialed self (forceHubs = UI restore).
    svc.settings.fabric = Object.assign({}, svc.settings.fabric, { port: 7777 });
    svc.peers = [
      { id: 'x', address: 'localhost:7777', enabled: true, shareLogs: false }
    ];
    const healed = svc._healPeerRoster({ persist: true, forceHubs: true });
    assert.ok(healed.removed.includes('localhost:7777'));
    assert.ok(healed.added.includes('hub.fabric.pub:7777'));
    assert.ok(healed.added.includes('hub.goon.vc:7777'));
    assert.ok(healed.added.includes('relay.goon.vc:7777'));

    const restored = await request(port, 'POST', '/peers/restore-seeds', {});
    assert.strictEqual(restored.status, 200);
    const addresses = (restored.body.data.peers || []).map((p) => p.address).sort();
    assert.deepStrictEqual(addresses, ['hub.fabric.pub:7777', 'hub.goon.vc:7777', 'relay.goon.vc:7777'].sort());
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

test('group wallet: named federation vault from the group signers', async () => {
  const a = createIdentity(); const b = createIdentity(); const c = createIdentity();
  const rpc = fakeRpc();
  const svc = new LiveRelay({
    port: 0,
    missions: { enable: true },
    peers: [],
    payouts: { enable: true, rpc, network: 'regtest' },
    bitcoin: { enable: true, hub: 'http://127.0.0.1:9' }
  });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const group = await svc.groupManager.createGroup({ name: 'Wing', members: [b.pubkey, c.pubkey], threshold: 2 }, a.pubkey);

    const waiting = await request(port, 'GET', `${BASE}/groups/${group.id}/wallet`);
    assert.strictEqual(waiting.status, 200, JSON.stringify(waiting.body));
    assert.strictEqual(waiting.body.data.address, null, 'no vault until every signer has a cosigner key');
    assert.strictEqual(waiting.body.data.missingCosigners.length, 3);

    // Each signer ties their account cosigner key to their identity (cosigner.set).
    const { createGroupCosigner } = require('../../functions/groupCosigner');
    const { keyFromIdentity, cosignerKeyFromIdentity } = require('../../functions/identity');
    const { group: withContract } = svc.groupManager.ensureContract(group.id);
    const cosigners = {};
    for (const id of [a, b, c]) {
      const record = createGroupCosigner({
        identityKey: keyFromIdentity(id),
        cosignerKey: cosignerKeyFromIdentity(id, 'regtest'),
        group: withContract,
        network: 'regtest'
      });
      cosigners[id.pubkey] = record.cosigner;
      assert.strictEqual(svc.groupManager.setCosigner(group.id, record, id.pubkey).applied, true);
    }
    const forged = createGroupCosigner({
      identityKey: keyFromIdentity(b),
      cosignerKey: cosignerKeyFromIdentity(a, 'regtest'),
      group: withContract,
      network: 'regtest'
    });
    assert.strictEqual(svc.groupManager.ingestGroupChange(Object.assign({ action: 'cosigner.set', groupId: group.id, contractId: withContract.contractId }, forged), a.pubkey).skipped,
      'unauthorized', 'nobody sets another member\'s cosigner');
    const keys = [a, b, c].map((id) => cosigners[id.pubkey]);

    const res = await request(port, 'GET', `${BASE}/groups/${group.id}/wallet`);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.mode, 'federation');
    assert.strictEqual(res.body.data.threshold, 2);
    assert.strictEqual(res.body.data.keys.length, 3);
    assert.deepStrictEqual(res.body.data.keys, [...keys].sort(), 'sorted cosigner keys → deterministic address');
    const Federation = require('@fabric/core/types/federation');
    const descriptor = Federation.buildDescriptor({ validators: keys, threshold: 2, network: 'regtest', publisher: cosigners[a.pubkey] });
    assert.strictEqual(res.body.data.federationId, Federation.descriptorId(descriptor), 'same federation id Hub and Passport derive');
    assert.strictEqual(res.body.data.address, Federation.vaultForDescriptor(descriptor).address);
    assert.ok(res.body.data.address.startsWith('bcrt1p'), 'Taproot vault');
    assert.strictEqual(res.body.data.legacyP2wsh, undefined);
    assert.deepStrictEqual(res.body.data.previous, []);
    assert.strictEqual(res.body.data.bitcoinEnable, true);
    assert.strictEqual(res.body.data.balanceSats, 0);
    assert.strictEqual(res.body.data.balanceSource, 'payouts-rpc');

    rpc.state.utxos = [{ txid: 'ab'.repeat(32), vout: 0, amount: 0.00042, height: 101 }];
    const funded = await request(port, 'GET', `${BASE}/groups/${group.id}/wallet`);
    assert.strictEqual(funded.body.data.balanceSats, 42000);
    assert.strictEqual(funded.body.data.history.length, 1);
    assert.strictEqual(funded.body.data.history[0].amountSats, 42000);

    const list = await request(port, 'GET', `${BASE}/groups/${group.id}/withdrawals`);
    assert.strictEqual(list.status, 200);
    assert.deepStrictEqual(list.body.data, []);
    const locked = await request(port, 'POST', `${BASE}/groups/${group.id}/withdrawals`, { destinationAddress: 'bcrt1qx', amountSats: 1000, feeSats: 500 });
    assert.strictEqual(locked.status, 403, 'no unlocked identity → no signer');

    // Wallet summary endpoint reports the backend.
    const wallet = await request(port, 'GET', `${BASE}/wallet`);
    assert.strictEqual(wallet.body.data.mode, 'bitcoin');
    assert.strictEqual(wallet.body.data.network, 'regtest');
  } finally { await svc.stop(); }
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

    // Wrong signer cannot approve. Message must match MissionManager.acceptanceMessage
    // (includes completionGroupId) — do not hand-roll the JSON.
    const claimRow = claim.body.data;
    const msg = svc.missionManager.acceptanceMessage(
      svc.missionManager.getMission(missionId),
      claimRow
    );
    const badSig = Buffer.from(keyFromIdentity(pilot).signSchnorr(Buffer.from(msg), FEDERATION_WITNESS)).toString('hex');
    const denied = await request(port, 'POST', `${BASE}/claims/${claimId}/validate`, {
      decision: 'approve', signatures: { [pilot.pubkey]: badSig }
    });
    assert.strictEqual(denied.status, 403, 'non-authority signature rejected');

    // APPROVE COMPLETION with the authority's Schnorr signature → coins unlock.
    const sig = Buffer.from(keyFromIdentity(authority).signSchnorr(Buffer.from(msg), FEDERATION_WITNESS)).toString('hex');
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
