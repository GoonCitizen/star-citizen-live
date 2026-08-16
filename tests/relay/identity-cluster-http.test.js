'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const Identity = require('@fabric/core/types/identity');
const Key = require('@fabric/core/types/key');
const LiveRelay = require('../../services/LiveRelay');
const { signCrossSign } = require('../../functions/identityCrossSignVerify');
const IdentityCluster = require('../../functions/identityCluster');
const { createIdentity, signEnvelope } = require('../../functions/identity');

function listen (relay) {
  return new Promise((resolve) => {
    relay.server = http.createServer((req, res) => relay._handle(req, res));
    relay.server.listen(0, '127.0.0.1', () => {
      const { port } = relay.server.address();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

async function jsonFetch (url, init = {}) {
  const headers = Object.assign({ Connection: 'close' }, init.headers || {});
  const res = await fetch(url, Object.assign({}, init, { headers }));
  const j = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, j };
}

async function login (base, identity) {
  const envelope = signEnvelope(identity, { intent: 'login', ts: new Date().toISOString() });
  const r = await jsonFetch(`${base}/services/star-citizen/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(envelope)
  });
  assert.equal(r.status, 200, r.j && r.j.error);
  return r.j.data.token;
}

function authHeaders (token) {
  return { Accept: 'application/json', Authorization: `Bearer ${token}` };
}

function ident () {
  return new Identity(new Key());
}

describe('LiveRelay identity cluster HTTP', () => {
  let relay;
  let base;
  let token;

  before(async () => {
    relay = new LiveRelay({
      mode: 'server',
      listen: false,
      missions: { enable: false },
      fabric: { enable: false }
    });
    await relay.start();
    base = await listen(relay);
    token = await login(base, createIdentity());
  });

  after(async () => {
    if (relay && relay.server) {
      await new Promise((resolve) => relay.server.close(() => resolve()));
      relay.server = null;
    }
    if (relay) await relay.stop();
  });

  it('mounts POST /device-links (rejects missing origin)', async () => {
    const r = await jsonFetch(`${base}/device-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(r.status, 400);
    assert.equal(r.j.ok, false);
  });

  it('DELETE /device-links/:id is idempotent for unknown sessions', async () => {
    const r = await jsonFetch(`${base}/device-links/${'ab'.repeat(24)}`, { method: 'DELETE' });
    assert.equal(r.status, 200);
    assert.equal(r.j.ok, true);
    assert.equal(r.j.cancelled, true);
  });

  it('GET /identity/cluster without a session is 401 on hosted', async () => {
    const r = await jsonFetch(`${base}/identity/cluster`);
    assert.equal(r.status, 401);
  });

  it('GET /identity/cluster returns a snapshot', async () => {
    const r = await jsonFetch(`${base}/identity/cluster`, { headers: authHeaders(token) });
    assert.equal(r.status, 200);
    assert.equal(r.j.type, 'IdentityCluster');
    assert.ok(r.j.data);
    assert.ok(Array.isArray(r.j.data.members));
    assert.ok(Array.isArray(r.j.data.pending));
  });

  it('ingests mutual IdentityCrossSign and unions the cluster', async () => {
    const a = ident();
    const b = ident();
    const nonce = crypto.randomBytes(32).toString('hex');
    const ab = signCrossSign(a, { peerPubkey: b.pubkey, nonce });
    const ba = signCrossSign(b, { peerPubkey: a.pubkey, nonce });
    const r1 = await jsonFetch(`${base}/identity/cross-sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(ab)
    });
    const r2 = await jsonFetch(`${base}/identity/cross-sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(ba)
    });
    assert.equal(r1.status, 200, r1.j && r1.j.error);
    assert.equal(r2.status, 200, r2.j && r2.j.error);
    const snap = await jsonFetch(
      `${base}/identity/cluster?pubkey=${encodeURIComponent(a.pubkey)}`,
      { headers: authHeaders(token) }
    );
    assert.equal(snap.status, 200);
    assert.ok(snap.j.data.members.length >= 2);
    assert.equal(relay.identityCluster.clusterEquals(a.pubkey, b.pubkey), true);
  });

  it('revokes an edge and splits the cluster', async () => {
    const a = ident();
    const b = ident();
    const nonce = crypto.randomBytes(32).toString('hex');
    await jsonFetch(`${base}/identity/cross-sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signCrossSign(a, { peerPubkey: b.pubkey, nonce }))
    });
    await jsonFetch(`${base}/identity/cross-sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signCrossSign(b, { peerPubkey: a.pubkey, nonce }))
    });
    const rev = signCrossSign(a, { peerPubkey: b.pubkey, nonce }, IdentityCluster.REVOKE_TYPE);
    const r = await jsonFetch(`${base}/identity/cross-sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rev)
    });
    assert.equal(r.status, 200, r.j && r.j.error);
    assert.equal(relay.identityCluster.clusterEquals(a.pubkey, b.pubkey), false);
  });

  it('GET /identity/cluster/sync without a session is 401 on hosted', async () => {
    const r = await jsonFetch(`${base}/identity/cluster/sync`);
    assert.equal(r.status, 401);
  });

  it('GET /identity/cluster/sync returns transport order and an empty collection', async () => {
    const r = await jsonFetch(`${base}/identity/cluster/sync`, { headers: authHeaders(token) });
    assert.equal(r.status, 200);
    assert.equal(r.j.type, 'ClusterSync');
    assert.ok(Array.isArray(r.j.data.transport));
    assert.equal(r.j.data.transport[0], 'tcp-lan');
    assert.equal(r.j.data.transport[r.j.data.transport.length - 1], 'webrtc-hub');
    assert.equal(r.j.data.collection, null);
    assert.ok(r.j.data.fabric);
    assert.equal(typeof r.j.data.fabric.ready, 'boolean');
    assert.ok(r.j.data.mesh);
    assert.ok(Array.isArray(r.j.data.mesh.registered));
    assert.ok(Array.isArray(r.j.data.linkedDevices));
    assert.ok(Array.isArray(r.j.data.pending));
    assert.ok(Array.isArray(r.j.data.edges));
    assert.ok(r.j.data.inventory);
    assert.equal(typeof r.j.data.inventory.local.notes, 'number');
    assert.equal(typeof r.j.data.inventory.local.logs, 'number');
    assert.ok(Array.isArray(r.j.data.inventory.inbound));
  });

  it('POST /identity/cluster/sync?publish schedules a replay without a collection body', async () => {
    const r = await jsonFetch(`${base}/identity/cluster/sync`, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(token)),
      body: JSON.stringify({ publish: true })
    });
    assert.equal(r.status, 200, r.j && r.j.error);
    assert.equal(r.j.type, 'ClusterSync');
    assert.ok(r.j.data.fabric);
  });

  it('POST /identity/cluster/sync { mesh: true } returns the snapshot without Hub I/O when Fabric is off', async () => {
    const r = await jsonFetch(`${base}/identity/cluster/sync`, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(token)),
      body: JSON.stringify({ mesh: true })
    });
    assert.equal(r.status, 200, r.j && r.j.error);
    assert.equal(r.j.type, 'ClusterSync');
    assert.ok(r.j.data.mesh);
    assert.deepEqual(r.j.data.mesh.registered, []);
  });

  it('POST /identity/cluster/sync { dial: [] } is ignored; non-empty dial queues nothing without a Peer', async () => {
    const r = await jsonFetch(`${base}/identity/cluster/sync`, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(token)),
      body: JSON.stringify({ dial: ['10.0.0.4:7777'] })
    });
    assert.equal(r.status, 200, r.j && r.j.error);
    assert.ok(Array.isArray(r.j.data.queued));
    assert.equal(r.j.data.queued.length, 0);
  });

  it('POST /identity/cluster/sync rejects a foreign collection', async () => {
    const r = await jsonFetch(`${base}/identity/cluster/sync`, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(token)),
      body: JSON.stringify({ type: 'FabricMessageCollection', v: 1, messages: [] })
    });
    assert.equal(r.status, 400);
  });
});
