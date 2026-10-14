'use strict';

/**
 * In-process Fabric commands the desktop IPC helpers call, plus HTTP fallbacks
 * for thin clients. Does not add IPC REST for chat/groups/missions.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const LiveRelay = require('../../services/LiveRelay');
const IdentityCluster = require('../../functions/identityCluster');
const { createIdentity } = require('../../functions/identity');

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-fabric-cmd-'));
}

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

async function stopRelay (relay, dir) {
  if (relay && relay._accountReplayTimer) {
    clearTimeout(relay._accountReplayTimer);
    relay._accountReplayTimer = null;
  }
  if (relay) await relay.stop();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}

describe('LiveRelay in-process Fabric commands (IPC targets)', () => {
  let relay;
  let dir;
  let local;
  let peer;

  before(async () => {
    dir = tmpDir();
    local = createIdentity();
    peer = createIdentity();
    relay = new LiveRelay({
      mode: 'relay',
      listen: false,
      settingsDir: dir,
      missions: { enable: false },
      fabric: { enable: false, listen: false, port: 0, peers: [] }
    });
    await relay.start();
    relay.setIdentity(local);
  });

  after(async () => {
    if (relay && relay._accountReplayTimer) {
      clearTimeout(relay._accountReplayTimer);
      relay._accountReplayTimer = null;
    }
    if (relay) await relay.stop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('publishLocalIdentityCrossSign signs and unions the cluster without HTTP', async () => {
    const nonce = crypto.randomBytes(32).toString('hex');
    const obj = await relay.publishLocalIdentityCrossSign({
      peerPubkey: peer.pubkey,
      nonce
    });
    assert.ok(obj.signature);
    assert.ok(obj.peerPubkey);
    const snap = relay.identityCluster.snapshot(local.pubkey);
    assert.ok(snap);
    assert.ok(Array.isArray(snap.members));
    assert.ok(snap.members.length >= 1, 'cluster snapshot includes the local device');
    assert.ok(snap.canonical);
  });

  it('publishLocalIdentityCrossSign throws when identity is locked', async () => {
    const locked = new LiveRelay({
      mode: 'relay',
      listen: false,
      missions: { enable: false },
      fabric: { enable: false }
    });
    await locked.start();
    try {
      await assert.rejects(
        () => locked.publishLocalIdentityCrossSign({
          peerPubkey: peer.pubkey,
          nonce: crypto.randomBytes(32).toString('hex')
        }),
        /locked/i
      );
    } finally {
      await stopRelay(locked, null);
    }
  });

  it('_markDeliveryReceipt throws UNAUTHORIZED when locked', () => {
    const prev = relay._identity;
    relay._identity = null;
    try {
      assert.throws(
        () => relay._markDeliveryReceipt('ab'.repeat(32)),
        (e) => e && e.code === 'UNAUTHORIZED'
      );
    } finally {
      relay._identity = prev;
    }
  });

  it('identityCluster.snapshot is the IPC fabric:identity-cluster payload', () => {
    const snap = relay.identityCluster.snapshot(local.pubkey);
    assert.ok(snap);
    assert.ok('canonical' in snap || 'members' in snap);
    assert.ok(Array.isArray(snap.members));
  });
});

describe('LiveRelay HTTP fallbacks for the same jobs', () => {
  it('loopback unsigned POST /identity/cross-sign uses the unlocked identity', async () => {
    const dir = tmpDir();
    const local = createIdentity();
    const peer = createIdentity();
    const relay = new LiveRelay({
      mode: 'relay',
      listen: false,
      settingsDir: dir,
      missions: { enable: false },
      fabric: { enable: false, listen: false, port: 0, peers: [] }
    });
    await relay.start();
    relay.setIdentity(local);
    const base = await listen(relay);
    try {
      const nonce = crypto.randomBytes(32).toString('hex');
      const r = await jsonFetch(`${base}/identity/cross-sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          type: IdentityCluster.SIGN_TYPE,
          peerPubkey: peer.pubkey,
          nonce
        })
      });
      assert.equal(r.status, 200, r.j && r.j.error);
      assert.ok(r.j.data && r.j.data.signature);
    } finally {
      await stopRelay(relay, dir);
    }
  });

  it('hosted unsigned POST /identity/cross-sign without Bearer is 401 even when unlocked', async () => {
    const dir = tmpDir();
    const local = createIdentity();
    const relay = new LiveRelay({
      mode: 'server',
      listen: false,
      settingsDir: dir,
      missions: { enable: false },
      fabric: { enable: false }
    });
    await relay.start();
    relay.setIdentity(local);
    const base = await listen(relay);
    try {
      const r = await jsonFetch(`${base}/identity/cross-sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          type: IdentityCluster.SIGN_TYPE,
          peerPubkey: createIdentity().pubkey,
          nonce: crypto.randomBytes(32).toString('hex')
        })
      });
      assert.equal(r.status, 401);
      assert.match(String(r.j.error || ''), /Authentication required|Unlock/i);
    } finally {
      await stopRelay(relay, dir);
    }
  });

  it('GET /presence and GET /peers stay session-gated on shared LAN (thin-client HTTP)', async () => {
    const dir = tmpDir();
    const identity = createIdentity();
    const relay = new LiveRelay({
      mode: 'relay',
      listen: false,
      settingsDir: dir,
      missions: { enable: false },
      fabric: { enable: false, listen: false, port: 0, peers: [] }
    });
    await relay.start();
    relay.setIdentity(identity);
    relay._enforceRemoteAuth = () => true;
    const base = await listen(relay);
    try {
      const presence = await jsonFetch(`${base}/services/star-citizen/presence`);
      const peers = await jsonFetch(`${base}/services/star-citizen/peers`);
      assert.equal(presence.status, 401);
      assert.equal(peers.status, 401);
    } finally {
      await stopRelay(relay, dir);
    }
  });
});
