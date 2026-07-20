'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const Group = require('../../types/Group');
const GroupManager = require('../../services/GroupManager');
const { createIdentity, signEnvelope, keyFromIdentity } = require('../../functions/identity');

const BASE = '/services/star-citizen';

function request (port, method, path, payload, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
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
  assert.strictEqual(res.status, 200, `login should succeed: ${JSON.stringify(res.body)}`);
  return res.body.data.token;
}

// ---- Group type ----

test('Group validates member keys, creator membership and threshold', () => {
  const a = createIdentity(); const b = createIdentity();
  const good = new Group({ id: 'g1', name: 'Squad', creator: a.pubkey, members: [a.pubkey, b.pubkey], threshold: 2 });
  assert.ok(good.validate());
  assert.ok(good.commitment().match(/^[0-9a-f]{64}$/));

  assert.throws(() => new Group({ id: 'g2', creator: a.pubkey, members: [a.pubkey], threshold: 3 }).validate(), /threshold/);
  assert.throws(() => new Group({ id: 'g3', creator: a.pubkey, members: ['not-a-key'] }).validate(), /invalid member/);
  assert.throws(() => new Group({ id: 'g4', creator: a.pubkey, members: [b.pubkey] }).validate(), /creator must be a member/);
});

test('Group verifies k-of-n Schnorr multisignatures and ignores outsiders', () => {
  const a = createIdentity(); const b = createIdentity(); const c = createIdentity();
  const outsider = createIdentity();
  const group = new Group({ id: 'g', name: 'Fleet', creator: a.pubkey, members: [a.pubkey, b.pubkey, c.pubkey], threshold: 2 });

  const message = JSON.stringify({ action: 'validate', claimId: 'claim-1' });
  const sign = (identity) => keyFromIdentity(identity).signSchnorr(Buffer.from(message)).toString('hex');

  assert.strictEqual(group.verifyMultiSignature({ message, signatures: { [a.pubkey]: sign(a), [b.pubkey]: sign(b) } }), true, '2-of-3 passes');
  assert.strictEqual(group.verifyMultiSignature({ message, signatures: { [a.pubkey]: sign(a) } }), false, '1-of-3 fails');
  assert.strictEqual(group.verifyMultiSignature({ message, signatures: { [a.pubkey]: sign(a), [outsider.pubkey]: sign(outsider) } }), false, 'outsider does not count');
  const badSig = { message, signatures: { [a.pubkey]: sign(a), [b.pubkey]: sign(c) } };
  assert.strictEqual(group.verifyMultiSignature(badSig), false, 'wrong-key signature fails');
});

// ---- GroupManager ----

test('GroupManager lifecycle: create, add/remove member, audit chain', async () => {
  const a = createIdentity(); const b = createIdentity(); const c = createIdentity();
  const gm = new GroupManager({});

  const g = await gm.createGroup({ name: 'Wing', members: [b.pubkey], threshold: 1 }, a.pubkey);
  assert.ok(g.id);
  assert.deepStrictEqual(new Set(g.members), new Set([a.pubkey, b.pubkey]));

  await gm.addMember(g.id, c.pubkey, b.pubkey); // member adds member
  assert.strictEqual(gm.getGroup(g.id).members.length, 3);

  await assert.rejects(gm.addMember(g.id, createIdentity().pubkey, createIdentity().pubkey), /forbidden/);
  await assert.rejects(gm.removeMember(g.id, c.pubkey, b.pubkey), /only the creator/);
  await gm.removeMember(g.id, c.pubkey, a.pubkey);
  assert.strictEqual(gm.getGroup(g.id).members.length, 2);
  await assert.rejects(gm.removeMember(g.id, a.pubkey, a.pubkey), /creator cannot be removed/);

  assert.strictEqual(gm.verifyAudit(), true);
  assert.ok(gm.audit.length >= 3);
  assert.deepStrictEqual(gm.groupsFor(b.pubkey).map((x) => x.id), [g.id]);
});

// ---- REST: auth + groups + group-scoped missions ----

test('hosted mode: login session, group CRUD, and membership-scoped missions', async () => {
  const alice = createIdentity(); const bob = createIdentity(); const eve = createIdentity();
  const svc = new LiveRelay({ port: 0, mode: 'server', missions: { enable: true } });
  await svc.start();
  const port = svc.server.address().port;
  try {
    // Unauthenticated mutation is rejected.
    const anon = await request(port, 'POST', `${BASE}/groups`, { name: 'X' });
    assert.strictEqual(anon.status, 401);

    // Bad login: stale timestamp.
    const stale = signEnvelope(alice, { intent: 'login', ts: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
    assert.strictEqual((await request(port, 'POST', `${BASE}/auth`, stale)).status, 401);

    const aliceToken = await login(port, alice);
    const bobToken = await login(port, bob);
    const eveToken = await login(port, eve);

    // Alice creates a group with Bob.
    const created = await request(port, 'POST', `${BASE}/groups`, { name: 'Goon Wing', members: [bob.pubkey], threshold: 2 }, aliceToken);
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const groupId = created.body.data.id;
    assert.strictEqual(created.body.data.creator, alice.pubkey);

    // Members see the group; outsiders don't.
    const bobsGroups = await request(port, 'GET', `${BASE}/groups`, null, bobToken);
    assert.strictEqual(bobsGroups.body.data.length, 1);
    const evesGroups = await request(port, 'GET', `${BASE}/groups`, null, eveToken);
    assert.strictEqual(evesGroups.body.data.length, 0);
    const evesView = await request(port, 'GET', `${BASE}/groups/${groupId}`, null, eveToken);
    assert.strictEqual(evesView.status, 403);

    // Eve cannot post a mission into the group.
    const evesMission = await request(port, 'POST', `${BASE}/missions`, { title: 'Sabotage', groupId }, eveToken);
    assert.strictEqual(evesMission.status, 403);

    // Alice shares a mission with the group.
    const mission = await request(port, 'POST', `${BASE}/missions`, { title: 'Escort the Hull-C', groupId, reward: 50000 }, aliceToken);
    assert.strictEqual(mission.status, 200, JSON.stringify(mission.body));
    const missionId = mission.body.data.id;
    assert.strictEqual(mission.body.data.createdBy, alice.pubkey, 'creator is the session pubkey, not body-supplied');

    // Bob (member) sees it; Eve does not.
    const bobList = await request(port, 'GET', `${BASE}/missions`, null, bobToken);
    assert.strictEqual(bobList.body.data.length, 1);
    const eveList = await request(port, 'GET', `${BASE}/missions`, null, eveToken);
    assert.strictEqual(eveList.body.data.length, 0);
    const eveGet = await request(port, 'GET', `${BASE}/missions/${missionId}`, null, eveToken);
    assert.strictEqual(eveGet.status, 404);

    // Bob applies — the applicantId is his session pubkey even if he lies in the body.
    const applied = await request(port, 'POST', `${BASE}/missions/${missionId}/apply`, { applicantId: 'liar' }, bobToken);
    assert.strictEqual(applied.status, 200);
    assert.strictEqual(applied.body.data.applicantId, bob.pubkey);
  } finally { await svc.stop(); }
});

test('group page: public/private, custom slug, apply to join, SPA shell', async () => {
  const alice = createIdentity(); const bob = createIdentity(); const eve = createIdentity();
  const svc = new LiveRelay({ port: 0, mode: 'server', missions: { enable: true } });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const aliceToken = await login(port, alice);
    const bobToken = await login(port, bob);
    const eveToken = await login(port, eve);

    const created = await request(port, 'POST', `${BASE}/groups`, {
      name: 'Open Wing', members: [bob.pubkey], threshold: 1, visibility: 'private'
    }, aliceToken);
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const groupId = created.body.data.id;
    assert.strictEqual(created.body.data.visibility, 'private');
    assert.strictEqual(created.body.data.path, `/groups/${groupId}`);
    assert.strictEqual(created.body.data.slug, null);

    // Private: outsider cannot view or apply.
    assert.strictEqual((await request(port, 'GET', `${BASE}/groups/${groupId}`, null, eveToken)).status, 403);
    assert.strictEqual((await request(port, 'POST', `${BASE}/groups/${groupId}/applications`, { message: 'hi' }, eveToken)).status, 403);

    // Alice makes it public + sets a custom slug.
    const updated = await request(port, 'PUT', `${BASE}/groups/${groupId}`, {
      visibility: 'public', slug: 'goon-wing'
    }, aliceToken);
    assert.strictEqual(updated.status, 200, JSON.stringify(updated.body));
    assert.strictEqual(updated.body.data.visibility, 'public');
    assert.strictEqual(updated.body.data.slug, 'goon-wing');
    assert.strictEqual(updated.body.data.path, '/groups/goon-wing');

    // Resolve by slug; public summary for visitors (no full member list).
    const bySlug = await request(port, 'GET', `${BASE}/groups/goon-wing`, null, eveToken);
    assert.strictEqual(bySlug.status, 200, JSON.stringify(bySlug.body));
    assert.strictEqual(bySlug.body.data.id, groupId);
    assert.strictEqual(bySlug.body.data.role, 'visitor');
    assert.strictEqual(bySlug.body.data.canApply, true);
    assert.strictEqual(bySlug.body.data.memberCount, 2);
    assert.ok(!bySlug.body.data.members, 'public summary omits member list');

    // Unauthenticated GET of a public group is allowed.
    const anon = await request(port, 'GET', `${BASE}/groups/goon-wing`);
    assert.strictEqual(anon.status, 200);
    assert.strictEqual(anon.body.data.visibility, 'public');

    // Public groups appear in Eve's discovery list.
    const evesList = await request(port, 'GET', `${BASE}/groups`, null, eveToken);
    assert.ok(evesList.body.data.some((g) => g.id === groupId));

    // Eve applies; Bob (member, not creator) cannot decide.
    const applied = await request(port, 'POST', `${BASE}/groups/${groupId}/applications`, {
      message: 'Ready to fly'
    }, eveToken);
    assert.strictEqual(applied.status, 200, JSON.stringify(applied.body));
    assert.strictEqual(applied.body.data.applicantId, eve.pubkey);
    assert.strictEqual(applied.body.data.status, 'pending');
    const appId = applied.body.data.id;

    const bobDecide = await request(port, 'POST', `${BASE}/group-applications/${appId}/decision`, {
      decision: 'accept'
    }, bobToken);
    assert.strictEqual(bobDecide.status, 403);

    const accepted = await request(port, 'POST', `${BASE}/group-applications/${appId}/decision`, {
      decision: 'accept'
    }, aliceToken);
    assert.strictEqual(accepted.status, 200, JSON.stringify(accepted.body));
    assert.strictEqual(accepted.body.data.status, 'accepted');

    const eveMember = await request(port, 'GET', `${BASE}/groups/${groupId}`, null, eveToken);
    assert.strictEqual(eveMember.status, 200);
    assert.strictEqual(eveMember.body.data.role, 'member');
    assert.ok(eveMember.body.data.members.includes(eve.pubkey));

    // Duplicate apply rejected.
    assert.strictEqual((await request(port, 'POST', `${BASE}/groups/${groupId}/applications`, {}, eveToken)).status, 400);

    // SPA shell for the group page (HTML, not JSON).
    const spa = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: `/groups/${groupId}` }, (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: buf }));
      }).on('error', reject);
    });
    assert.strictEqual(spa.status, 200);
    assert.match(spa.type || '', /text\/html/);
    assert.ok(/root|GoonCitizen|Dashboard|GroupPage/i.test(spa.body), 'SPA shell should mention the UI');

    const spaSlug = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/groups/goon-wing' }, (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] }));
      }).on('error', reject);
    });
    assert.strictEqual(spaSlug.status, 200);
    assert.match(spaSlug.type || '', /text\/html/);
  } finally { await svc.stop(); }
});

test('GroupManager: slug uniqueness and private apply blocked', async () => {
  const a = createIdentity(); const b = createIdentity();
  const gm = new GroupManager({});
  const g1 = await gm.createGroup({ name: 'A', visibility: 'public', slug: 'alpha-squad' }, a.pubkey);
  assert.strictEqual(gm.findGroup('alpha-squad').id, g1.id);

  await assert.rejects(
    gm.createGroup({ name: 'B', slug: 'alpha-squad' }, a.pubkey),
    /slug already in use/
  );

  const privateG = await gm.createGroup({ name: 'Secret', visibility: 'private' }, a.pubkey);
  await assert.rejects(gm.applyToGroup(privateG.id, b.pubkey, 'please'), /only public groups/);

  await gm.updateGroup(privateG.id, { visibility: 'public' }, a.pubkey);
  const app = await gm.applyToGroup(privateG.id, b.pubkey, 'hello');
  assert.strictEqual(app.status, 'pending');
  await gm.decideApplication({ applicationId: app.id, actor: a.pubkey, decision: 'accept' });
  assert.ok(gm.isMember(privateG.id, b.pubkey));
});

test('groups persist across sessions via Fabric Store', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-register-'));
  const alice = createIdentity();
  const registerDir = path.join(dir, 'register');

  const boot = async () => {
    const svc = new LiveRelay({
      port: 0,
      mode: 'server',
      settingsDir: dir,
      missions: { enable: true, dir: registerDir }
    });
    await svc.start();
    return svc;
  };

  const svc1 = await boot();
  try {
    const port1 = svc1.server.address().port;
    const aliceToken = await login(port1, alice);
    const created = await request(port1, 'POST', `${BASE}/groups`, {
      name: 'Persistent Wing', visibility: 'public', slug: 'persist-wing'
    }, aliceToken);
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    var groupId = created.body.data.id;
  } finally {
    await svc1.stop();
  }

  const svc2 = await boot();
  try {
    const port2 = svc2.server.address().port;
    const aliceToken2 = await login(port2, alice);
    const listed = await request(port2, 'GET', `${BASE}/groups`, null, aliceToken2);
    assert.strictEqual(listed.status, 200);
    assert.ok(listed.body.data.some((g) => g.id === groupId), 'group should reload from Fabric Store');
    const bySlug = await request(port2, 'GET', `${BASE}/groups/persist-wing`, null, aliceToken2);
    assert.strictEqual(bySlug.status, 200);
    assert.strictEqual(bySlug.body.data.id, groupId);
    assert.strictEqual(bySlug.body.data.name, 'Persistent Wing');
  } finally {
    await svc2.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
