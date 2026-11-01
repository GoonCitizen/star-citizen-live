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

const LiveRelay = require('../../services/LiveRelay');
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

  it('the unlocked identity gets a delegation participant (linked signers) in process', async () => {
    const d = relay.delegation;
    assert.ok(d, 'unlocked relay has a delegation participant');
    const view = await d.signers();
    assert.ok(Array.isArray(view.signers));
    assert.equal(view.signers.length, 0);
    assert.deepEqual(await d.pending(), []);
  });

  it('a locked relay links no signers', async () => {
    const lockedDir = tmpDir();
    const locked = new LiveRelay({
      mode: 'relay',
      listen: false,
      settingsDir: lockedDir,
      missions: { enable: false },
      fabric: { enable: false, listen: false, port: 0, peers: [] }
    });
    await locked.start();
    try {
      assert.equal(locked.delegation || null, null);
    } finally {
      await stopRelay(locked, lockedDir);
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
  it('loopback GET /delegation lists the linked signers of the unlocked player', async () => {
    const dir = tmpDir();
    const relay = new LiveRelay({
      mode: 'relay',
      listen: false,
      settingsDir: dir,
      missions: { enable: false },
      fabric: { enable: false, listen: false, port: 0, peers: [] }
    });
    await relay.start();
    relay.setIdentity(createIdentity());
    const base = await listen(relay);
    try {
      const r = await jsonFetch(`${base}/services/star-citizen/delegation`, { headers: { Accept: 'application/json' } });
      assert.equal(r.status, 200, r.j && r.j.error);
      assert.equal(r.j.type, 'LinkedSigners');
      assert.deepEqual(r.j.data.signers, []);
      assert.deepEqual(r.j.data.pending, []);
      const foreign = await jsonFetch(`${base}/services/star-citizen/delegation/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
        body: '{}'
      });
      assert.equal(foreign.status, 403);
      assert.equal(foreign.j.code, 'FOREIGN_ORIGIN');
    } finally {
      await stopRelay(relay, dir);
    }
  });

  it('hosted GET /delegation without a session is 401, and the relay links no signers of its own', async () => {
    const dir = tmpDir();
    const relay = new LiveRelay({
      mode: 'server',
      listen: false,
      settingsDir: dir,
      missions: { enable: false },
      fabric: { enable: false }
    });
    await relay.start();
    relay.setIdentity(createIdentity());
    const base = await listen(relay);
    try {
      const r = await jsonFetch(`${base}/services/star-citizen/delegation`, { headers: { Accept: 'application/json' } });
      assert.equal(r.status, 401);
      assert.equal(relay.delegation || null, null);
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
