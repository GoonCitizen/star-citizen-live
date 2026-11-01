'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const Key = require('@fabric/core/types/key');
const delegation = require('@fabric/core/functions/delegation');

const IdentityCluster = require('../../functions/identityCluster');
const { createIdentity, protocolKeyFromIdentity } = require('../../functions/identity');
const GroupManager = require('../../services/GroupManager');
const { Store } = require('../../types/Store');

const T = 1_800_000_000_000;

function key () {
  return new Key();
}

function grant (from, to, scopes = ['identity']) {
  return delegation.createGrant({ grantee: to.pubkey, scopes, label: 'test', now: T }, from);
}

function revoke (by, hash) {
  return delegation.createRevoke({ grant: hash, now: T + 1 }, by);
}

function cluster () {
  return new IdentityCluster({ now: () => T + 2 });
}

describe('IdentityCluster (identity grants)', () => {
  it('links two keys only once each has granted the other identity', () => {
    const a = key();
    const b = key();
    const c = cluster();
    const one = c.ingest(grant(a, b).uri);
    assert.equal(one.ok, true);
    assert.equal(one.type, 'DELEGATION_GRANT');
    assert.equal(one.fresh, true);
    assert.equal(one.linked, false);
    assert.equal(c.clusterEquals(a.pubkey, b.pubkey), false);
    assert.equal(c.pending().length, 1);
    const two = c.ingest(grant(b, a).uri);
    assert.equal(two.linked, true);
    assert.equal(c.clusterEquals(a.pubkey, b.pubkey), true);
    assert.equal(c.pending().length, 0);
  });

  it('takes hex and bytes as well as fabric: strings, and dedupes', () => {
    const a = key();
    const b = key();
    const c = cluster();
    const made = grant(a, b);
    const hex = made.message.toBuffer().toString('hex');
    assert.equal(c.ingest(hex).fresh, true);
    assert.equal(c.ingest(made.message.toBuffer()).fresh, false);
    assert.equal(c.ingest(made.uri).fresh, false);
    assert.equal(c.frames().length, 1);
  });

  it('refuses grants that do not include identity', () => {
    const a = key();
    const b = key();
    const c = cluster();
    const out = c.ingest(grant(a, b, ['passport']).uri);
    assert.equal(out.ok, false);
    assert.match(out.error, /identity/);
    assert.equal(c.frames().length, 0);
  });

  it('refuses frames that are not delegation grants or revokes', () => {
    const c = cluster();
    assert.equal(c.ingest('not a frame').ok, false);
    assert.equal(c.ingest(Buffer.alloc(8)).ok, false);
  });

  it('splits when a grantor revokes, but not when someone else does', () => {
    const a = key();
    const b = key();
    const m = key();
    const c = cluster();
    const ab = grant(a, b);
    c.ingest(ab.uri);
    c.ingest(grant(b, a).uri);
    const abHash = delegation.readGrant(ab.message, { now: T + 2 }).hash;
    const forged = c.ingest(revoke(m, abHash).uri);
    assert.equal(forged.ok, true);
    assert.equal(c.clusterEquals(a.pubkey, b.pubkey), true, 'a revocation by a non-grantor changes nothing');
    const real = c.ingest(revoke(a, abHash).uri);
    assert.equal(real.ok, true);
    assert.equal(real.grant, abHash);
    assert.equal(c.clusterEquals(a.pubkey, b.pubkey), false);
  });

  it('is transitive through a third key, with the smallest key as canonical', () => {
    const [a, b, d] = [key(), key(), key()];
    const c = cluster();
    for (const [x, y] of [[a, b], [b, a], [b, d], [d, b]]) c.ingest(grant(x, y).uri);
    assert.equal(c.clusterEquals(a.pubkey, d.pubkey), true);
    const members = [a, b, d].map((k) => IdentityCluster.keyOf(k.pubkey)).sort();
    assert.equal(c.canonicalOf(d.pubkey), members[0]);
    const snap = c.snapshot(a.pubkey);
    assert.deepEqual(snap.members, members);
    assert.equal(snap.edges.length, 2);
  });

  it('rebuilds from its own frames, revocations included', () => {
    const a = key();
    const b = key();
    const c = cluster();
    const ab = grant(a, b);
    c.ingest(ab.uri);
    c.ingest(grant(b, a).uri);
    c.ingest(revoke(b, delegation.readGrant(grant(b, a).message, { now: T + 2 }).hash).uri);
    const copy = IdentityCluster.fromFrames(c.frames(), { now: () => T + 2 });
    assert.equal(copy.clusterEquals(a.pubkey, b.pubkey), c.clusterEquals(a.pubkey, b.pubkey));
    assert.equal(copy.frames().length, c.frames().length);
  });

  it('remembers the compressed key a grant named', () => {
    const a = key();
    const b = key();
    const c = cluster();
    c.ingest(grant(a, b).uri);
    assert.equal(c.compressedOf(IdentityCluster.keyOf(b.pubkey)), b.pubkey);
  });
});

describe('IdentityCluster group membership', () => {
  it('treats a key linked as the same player as a group member', async () => {
    const a = createIdentity();
    const b = createIdentity();
    const ka = protocolKeyFromIdentity(a);
    const kb = protocolKeyFromIdentity(b);
    const c = cluster();
    c.ingest(grant(ka, kb).uri);
    c.ingest(grant(kb, ka).uri);
    const gm = new GroupManager({
      store: new Store(),
      sameActor: (x, y) => c.clusterEquals(x, y)
    });
    await gm.start();
    const created = await gm.createGroup({ name: 'Wing', visibility: 'private' }, a.pubkey);
    assert.equal(gm.isMember(created.id, a.pubkey), true);
    assert.equal(gm.isMember(created.id, b.pubkey), true);
    assert.equal(gm.isInGroupTree(created.id, b.pubkey), true);
  });
});
