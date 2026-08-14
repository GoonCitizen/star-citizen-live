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
  const res = await fetch(url, init);
  const j = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, j };
}

function ident () {
  return new Identity(new Key());
}

describe('LiveRelay identity cluster HTTP', () => {
  let relay;
  let base;

  before(async () => {
    relay = new LiveRelay({
      mode: 'server',
      listen: false,
      missions: { enable: false },
      fabric: { enable: false }
    });
    await relay.start();
    base = await listen(relay);
  });

  after(async () => {
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

  it('GET /identity/cluster returns a snapshot', async () => {
    const r = await jsonFetch(`${base}/identity/cluster`);
    assert.equal(r.status, 200);
    assert.equal(r.j.type, 'IdentityCluster');
    assert.ok(r.j.data);
    assert.ok(Array.isArray(r.j.data.members));
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
    const snap = await jsonFetch(`${base}/identity/cluster?pubkey=${encodeURIComponent(a.pubkey)}`);
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
});
