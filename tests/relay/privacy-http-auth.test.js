'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity, signEnvelope } = require('../../functions/identity');

const BASE = '/services/star-citizen';
const FILE_ID = 'ab'.repeat(32);

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-privacy-http-'));
}

function request (port, method, reqPath, payload, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let body = null;
        if (buf) {
          try { body = JSON.parse(buf); } catch (_) { body = buf; }
        }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}

async function login (port, identity) {
  const envelope = signEnvelope(identity, { intent: 'login', ts: new Date().toISOString() });
  const res = await request(port, 'POST', `${BASE}/auth`, envelope);
  assert.strictEqual(res.status, 200, `login should succeed: ${JSON.stringify(res.body)}`);
  return res.body.data.token;
}

describe('hosted relay privacy HTTP', () => {
  let svc;
  let dir;
  let port;
  let operator;
  let stranger;
  let token;
  let strangerToken;
  let noteId;
  let groupId;

  before(async () => {
    dir = tmpDir();
    operator = createIdentity();
    stranger = createIdentity();
    svc = new LiveRelay({
      port: 0,
      listen: true,
      mode: 'server',
      settingsDir: dir,
      fabric: { enable: false, listen: false, port: 0, peers: [] },
      missions: { enable: false },
      discord: { enable: false },
      documents: { enable: true }
    });
    await svc.start();
    svc.setIdentity(operator);
    port = svc.server.address().port;
    token = await login(port, operator);
    strangerToken = await login(port, stranger);

    const note = await request(port, 'POST', `${BASE}/notes`, {
      subject: 'discord:u1',
      handle: 'alice',
      body: 'Nights-only gunner — private intel'
    }, token);
    assert.strictEqual(note.status, 200, JSON.stringify(note.body));
    noteId = note.body.data.id;

    const group = await request(port, 'POST', `${BASE}/local-groups`, { name: 'Hangar' }, token);
    assert.strictEqual(group.status, 200, JSON.stringify(group.body));
    groupId = group.body.data.id;

    svc.registerStore.put('documents', FILE_ID, {
      id: FILE_ID,
      sha256: FILE_ID,
      name: 'secret.dmg',
      mime: 'application/octet-stream',
      size: 4096,
      published: true,
      purchasePriceSats: 4,
      contentBase64: Buffer.from('classified-bytes').toString('base64'),
      created: '2026-08-14T00:00:00.000Z'
    });
  });

  after(async () => {
    if (svc) await svc.stop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('GET /notes without a session is 401 (does not impersonate the operator)', async () => {
    const res = await request(port, 'GET', `${BASE}/notes`);
    assert.strictEqual(res.status, 401);
    assert.match(String(res.body && res.body.error), /Authentication required/);
  });

  it('GET /notes/:id without a session is 401', async () => {
    const res = await request(port, 'GET', `${BASE}/notes/${noteId}`);
    assert.strictEqual(res.status, 401);
  });

  it('authenticated operator can list and read their private notes', async () => {
    const listed = await request(port, 'GET', `${BASE}/notes`, null, token);
    assert.strictEqual(listed.status, 200);
    assert.ok(listed.body.data.some((n) => n.id === noteId && n.body.indexOf('private intel') !== -1));

    const one = await request(port, 'GET', `${BASE}/notes/${noteId}`, null, token);
    assert.strictEqual(one.status, 200);
    assert.strictEqual(one.body.data.id, noteId);
  });

  it('another session cannot read the operator’s private notes', async () => {
    const listed = await request(port, 'GET', `${BASE}/notes`, null, strangerToken);
    assert.strictEqual(listed.status, 200);
    assert.ok(!listed.body.data.some((n) => n.id === noteId));

    const one = await request(port, 'GET', `${BASE}/notes/${noteId}`, null, strangerToken);
    assert.strictEqual(one.status, 404);
  });

  it('GET /local-groups without a session is 401', async () => {
    const res = await request(port, 'GET', `${BASE}/local-groups`);
    assert.strictEqual(res.status, 401);
    const one = await request(port, 'GET', `${BASE}/local-groups/${groupId}`);
    assert.strictEqual(one.status, 401);
  });

  it('authenticated operator can list local tags', async () => {
    const res = await request(port, 'GET', `${BASE}/local-groups`, null, token);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data.some((g) => g.id === groupId));
  });

  it('Discord link GET/POST/DELETE without a session is 401', async () => {
    for (const res of [
      await request(port, 'GET', `${BASE}/discord/link`),
      await request(port, 'POST', `${BASE}/discord/link`, {}),
      await request(port, 'DELETE', `${BASE}/discord/link`)
    ]) {
      assert.strictEqual(res.status, 401, `status ${res.status}`);
    }
  });

  it('authenticated session can read own Discord link status', async () => {
    const res = await request(port, 'GET', `${BASE}/discord/link`, null, token);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.type, 'DiscordIdentityLink');
  });

  it('POST /files/:id/pin without a session is 401 or unmounted', async () => {
    const res = await request(port, 'POST', `${BASE}/files/${FILE_ID}/pin`, { pinned: true });
    assert.ok(res.status === 401 || res.status === 404, `status ${res.status}`);
  });

  it('POST /files/:id/cluster-sync without a session is 401 or unmounted', async () => {
    const res = await request(port, 'POST', `${BASE}/files/${FILE_ID}/cluster-sync`, { clusterSync: true });
    assert.ok(res.status === 401 || res.status === 404, `status ${res.status}`);
  });

  it('gameplay GETs without a session are 401', async () => {
    assert.strictEqual((await request(port, 'GET', `${BASE}/analytics`)).status, 401);
    assert.strictEqual((await request(port, 'GET', `${BASE}/corpus`)).status, 401);
    assert.strictEqual((await request(port, 'GET', `${BASE}/combat`)).status, 401);
    assert.strictEqual((await request(port, 'GET', `${BASE}/activity-tree`)).status, 401);
  });

  it('authenticated operator can read gameplay GETs', async () => {
    assert.strictEqual((await request(port, 'GET', `${BASE}/analytics`, null, token)).status, 200);
    assert.strictEqual((await request(port, 'GET', `${BASE}/corpus`, null, token)).status, 200);
    assert.strictEqual((await request(port, 'GET', `${BASE}/combat`, null, token)).status, 200);
    assert.strictEqual((await request(port, 'GET', `${BASE}/activity-tree`, null, token)).status, 200);
  });

  it('GET document bytes without a session is 401', async () => {
    const res = await request(port, 'GET', `${BASE}/documents/${FILE_ID}`);
    assert.strictEqual(res.status, 401);
    assert.ok(!res.body || !res.body.data || !res.body.data.document || !res.body.data.document.contentBase64);
  });

  it('GET /world-view and Discord catalog without a session is 401 or unmounted', async () => {
    for (const res of [
      await request(port, 'GET', `${BASE}/world-view`),
      await request(port, 'GET', `${BASE}/discord/guilds`),
      await request(port, 'GET', `${BASE}/discord/links`)
    ]) {
      assert.ok(res.status === 401 || res.status === 404, `status ${res.status}`);
    }
  });

  it('a hosted session still cannot read the operator Discord catalog or pin files', async () => {
    for (const res of [
      await request(port, 'GET', `${BASE}/world-view`, null, strangerToken),
      await request(port, 'GET', `${BASE}/discord/guilds`, null, strangerToken),
      await request(port, 'GET', `${BASE}/discord/links`, null, strangerToken),
      await request(port, 'POST', `${BASE}/files/${FILE_ID}/pin`, { pinned: true }, strangerToken)
    ]) {
      assert.ok(res.status === 401 || res.status === 403 || res.status === 404, `status ${res.status}`);
    }
  });

  it('_requestViewer never falls back to the operator identity when remote auth is on', () => {
    const unauth = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    assert.strictEqual(svc._requestViewer(unauth), null);
    const authed = {
      headers: { authorization: `Bearer ${token}` },
      socket: { remoteAddress: '1.2.3.4' }
    };
    assert.strictEqual(svc._requestViewer(authed), operator.pubkey);
  });

  it('lookup mesh report omits local tag names', () => {
    const out = svc._lookupLocalResults({ query: '' });
    assert.ok(Array.isArray(out.localTags));
    assert.strictEqual(out.localTags.length, 0);
  });

  it('GET /settings, snapshots, and document offers without a session are 401 or unmounted', async () => {
    for (const res of [
      await request(port, 'GET', '/settings'),
      await request(port, 'GET', `${BASE}/snapshots`),
      await request(port, 'GET', `${BASE}/documents/offers`)
    ]) {
      assert.ok(res.status === 401 || res.status === 404, `status ${res.status}`);
    }
  });

  it('GET gameplay collections, groupaudit, chat, peers, and identity cluster require a session on hosted', async () => {
    for (const path of [
      `${BASE}/kills`,
      `${BASE}/deaths`,
      `${BASE}/players`,
      `${BASE}/activities`,
      `${BASE}/missionlog`,
      `${BASE}/groupaudit`,
      `${BASE}/chat/messages?channel=global`,
      `${BASE}/chat/channels`,
      `${BASE}/identity/cluster`,
      `${BASE}/identity/cluster/sync`
    ]) {
      const res = await request(port, 'GET', path);
      assert.strictEqual(res.status, 401, `${path} → ${res.status}`);
    }
    // Peers roster is desktop-only (not mounted when mode=server) — 404 is fail-closed.
    const peers = await request(port, 'GET', `${BASE}/peers`);
    assert.ok(peers.status === 401 || peers.status === 404, `/peers → ${peers.status}`);
    const ok = await request(port, 'GET', `${BASE}/kills`, null, token);
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  });

  it('GET overlay/primary-group and missiongroups require a session on hosted', async () => {
    for (const path of [
      `${BASE}/overlay/primary-group`,
      `${BASE}/missiongroups`
    ]) {
      const res = await request(port, 'GET', path);
      assert.strictEqual(res.status, 401, `${path} → ${res.status}`);
    }
    const overlay = await request(port, 'GET', `${BASE}/overlay/primary-group`, null, token);
    assert.strictEqual(overlay.status, 200);
    const groups = await request(port, 'GET', `${BASE}/missiongroups`, null, token);
    assert.strictEqual(groups.status, 200);
  });

  it('presence roster/ship and Fabric message log require a session (or are unmounted)', async () => {
    for (const res of [
      await request(port, 'GET', `${BASE}/presence/roster`),
      await request(port, 'PUT', `${BASE}/presence/ship`, { slug: 'gladius' }),
      await request(port, 'GET', `${BASE}/fabric/messages`),
      await request(port, 'POST', `${BASE}/fabric/messages/clear`)
    ]) {
      assert.ok(res.status === 401 || res.status === 404, `status ${res.status}`);
    }
  });

  it('unauthenticated GET /groups on hosted does not dump private groups', async () => {
    const created = await request(port, 'POST', `${BASE}/groups`, {
      name: 'Private Wing',
      visibility: 'private'
    }, token);
    assert.ok(created.status === 200 || created.status === 400, `create ${created.status}`);
    const res = await request(port, 'GET', `${BASE}/groups`);
    assert.strictEqual(res.status, 200);
    const rows = Array.isArray(res.body && res.body.data) ? res.body.data : [];
    assert.ok(!rows.some((g) => g && (g.visibility === 'private' || g.name === 'Private Wing')));
  });

  it('bitcoin runtime for settings omits adminToken', () => {
    const hubBitcoinProxy = require('../../functions/hubBitcoinProxy');
    const runtime = hubBitcoinProxy.bitcoinRuntimeForSettings({
      bitcoin: {
        enable: true,
        hub: 'http://127.0.0.1:8080',
        adminToken: 'should-never-echo',
        adminTokenFile: '/tmp/secret'
      }
    });
    assert.strictEqual(runtime.enable, true);
    assert.ok(!Object.prototype.hasOwnProperty.call(runtime, 'adminToken'));
    assert.ok(!Object.prototype.hasOwnProperty.call(runtime, 'adminTokenFile'));
    assert.ok(!JSON.stringify(runtime).includes('should-never-echo'));
  });

  it('revokes Bearer sessions via DELETE /auth', async () => {
    const revoke = await request(port, 'DELETE', `${BASE}/auth`, null, token);
    assert.strictEqual(revoke.status, 200);
    assert.strictEqual(revoke.body.data.revoked, true);
    assert.strictEqual((await request(port, 'GET', `${BASE}/notes`, null, token)).status, 401);
    const again = await request(port, 'DELETE', `${BASE}/auth`, null, token);
    assert.strictEqual(again.status, 200);
    assert.strictEqual(again.body.data.revoked, false);
  });
});

describe('desktop identity-note author check', () => {
  it('refuses PUT from a non-author even when mode is not server', async () => {
    const dir = tmpDir();
    const alice = createIdentity();
    const bob = createIdentity();
    const svc = new LiveRelay({
      port: 0,
      listen: false,
      mode: 'relay',
      settingsDir: dir,
      fabric: { enable: false, listen: false, port: 0, peers: [] },
      missions: { enable: false },
      discord: { enable: false }
    });
    await svc.start();
    try {
      const identityNotes = require('../../functions/identityNotes');
      const note = identityNotes.createNote(svc.registerStore, {
        subject: 'discord:u1',
        body: 'alice wrote this',
        author: alice.pubkey
      });
      assert.throws(
        () => svc._updateIdentityNote(note.id, { body: 'bob tampered' }, bob.pubkey),
        /forbidden: not the note author/
      );
      assert.strictEqual(identityNotes.getNote(svc.registerStore, note.id).body, 'alice wrote this');
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Discord catalog gossip default', () => {
  it('defaults shareDiscordCatalog off until the operator opts in', async () => {
    const dir = tmpDir();
    const svc = new LiveRelay({
      port: 0,
      listen: true,
      settingsDir: dir,
      fabric: { enable: false, listen: false, port: 0, peers: [] },
      missions: { enable: false },
      discord: { enable: false }
    });
    await svc.start();
    try {
      const port = svc.server.address().port;
      const list = await request(port, 'GET', '/settings');
      assert.strictEqual(list.status, 200);
      assert.strictEqual(list.body.runtime.shareDiscordCatalog, false);
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('shared-mode peers / profile / presence auth', () => {
  it('rejects unauthenticated peers catalog when remote auth is enforced', async () => {
    const dir = tmpDir();
    const operator = createIdentity();
    const svc = new LiveRelay({
      port: 0,
      listen: true,
      mode: 'relay',
      settingsDir: dir,
      peers: [{ id: 'seed', address: 'relay.goon.vc:7777', enabled: true }],
      fabric: { enable: false, listen: false, port: 0, peers: [] },
      missions: { enable: false },
      discord: { enable: false }
    });
    svc._httpSharedMode = true;
    await svc.start();
    const realEnforce = svc._enforceRemoteAuth.bind(svc);
    // Simulate a LAN neighbor (remote auth on) even though the test client is loopback.
    svc._enforceRemoteAuth = () => true;
    try {
      const port = svc.server.address().port;
      assert.strictEqual((await request(port, 'GET', `${BASE}/peers`)).status, 401);
      assert.strictEqual((await request(port, 'POST', `${BASE}/peers`, {
        address: 'evil.example:7777'
      })).status, 401);
      assert.strictEqual((await request(port, 'GET', `${BASE}/profile`)).status, 401);
      assert.strictEqual((await request(port, 'GET', `${BASE}/presence`)).status, 401);
      assert.strictEqual((await request(port, 'PUT', `${BASE}/presence`, {
        visibility: 'public'
      })).status, 401);
      assert.strictEqual((await request(port, 'GET', `${BASE}/network/observe`)).status, 401);
      assert.strictEqual((await request(port, 'GET', `${BASE}/presence/roster`)).status, 401);
      assert.strictEqual((await request(port, 'PUT', `${BASE}/presence/ship`, {
        slug: 'gladius'
      })).status, 401);
      assert.strictEqual((await request(port, 'GET', `${BASE}/fabric/messages`)).status, 401);
      assert.strictEqual((await request(port, 'GET', `${BASE}/loginfo`)).status, 401);
      assert.strictEqual((await request(port, 'GET', `${BASE}/logslice`)).status, 401);
      assert.strictEqual((await request(port, 'GET', `${BASE}/fleets`)).status, 401);
      assert.strictEqual((await request(port, 'GET', `${BASE}/discord/coordination`)).status, 401);
      // Public ship catalog stays open (not operator-local).
      assert.strictEqual((await request(port, 'GET', `${BASE}/ships`)).status, 200);
      assert.strictEqual((await request(port, 'GET', `${BASE}/locations`)).status, 200);
      assert.strictEqual((await request(port, 'GET', `${BASE}/locations/map`)).status, 200);
      assert.strictEqual((await request(port, 'GET', `${BASE}/locations/area18`)).status, 401);
      assert.strictEqual((await request(port, 'GET', `${BASE}/locations/reports`)).status, 401);

      // Login on the real loopback path (shared mode does not require auth on loopback).
      svc._enforceRemoteAuth = realEnforce;
      svc.setIdentity(operator);
      const token = await login(port, operator);

      svc._enforceRemoteAuth = () => true;
      const peers = await request(port, 'GET', `${BASE}/peers`, null, token);
      assert.strictEqual(peers.status, 200);
      assert.ok(Array.isArray(peers.body.data));
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
