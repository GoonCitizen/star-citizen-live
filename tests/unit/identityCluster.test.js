'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const Identity = require('@fabric/core/types/identity');
const Key = require('@fabric/core/types/key');

const {
  CROSS_SIGN_PREFIX,
  REVOKE_PREFIX,
  SIGN_TYPE,
  REVOKE_TYPE,
  buildCrossSignMessage,
  buildRevokeMessage,
  parseCrossSignMessage,
  parseRevokeMessage,
  coerceCrossSignObject,
  isCrossSignType
} = require('../../functions/identityCrossSign');
const IdentityCluster = require('../../functions/identityCluster');
const { signCrossSign, verifyCrossSignObject } = require('../../functions/identityCrossSignVerify');
const { createIdentity, pubkeysMatch } = require('../../functions/identity');
const GroupManager = require('../../services/GroupManager');
const { Store } = require('../../types/Store');

function nonce () {
  return crypto.randomBytes(32).toString('hex');
}

describe('identityCrossSign messages', () => {
  it('round-trips the canonical cross-sign string', () => {
    const n = 'ab'.repeat(32);
    const a = '02' + 'aa'.repeat(32);
    const b = '03' + 'bb'.repeat(32);
    const msg = buildCrossSignMessage(n, a, b);
    assert.match(msg, new RegExp('^' + CROSS_SIGN_PREFIX));
    const parsed = parseCrossSignMessage(msg);
    assert.equal(parsed.nonce, n);
    assert.equal(parsed.localPubkey, a.toLowerCase());
    assert.equal(parsed.peerPubkey, b.toLowerCase());
  });

  it('round-trips revoke messages', () => {
    const n = 'cd'.repeat(32);
    const a = 'aa'.repeat(32);
    const b = 'bb'.repeat(32);
    const msg = buildRevokeMessage(n, a, b);
    assert.match(msg, new RegExp('^' + REVOKE_PREFIX));
    const parsed = parseRevokeMessage(msg);
    assert.equal(parsed.nonce, n);
    assert.equal(parsed.localPubkey, a);
    assert.equal(parsed.peerPubkey, b);
    assert.equal(buildRevokeMessage(n, 'aa:bb', b), null);
  });
});

describe('identityCluster union-find', () => {
  it('does not combine until both directions share a nonce', () => {
    const a = createIdentity();
    const b = createIdentity();
    const n = nonce();
    const c = new IdentityCluster();
    const one = c.ingestCrossSign({ localPubkey: a.pubkey, peerPubkey: b.pubkey, nonce: n });
    assert.equal(one.ok, true);
    assert.equal(one.linked, false);
    assert.equal(c.clusterEquals(a.pubkey, b.pubkey), false);
    const two = c.ingestCrossSign({ localPubkey: b.pubkey, peerPubkey: a.pubkey, nonce: n });
    assert.equal(two.linked, true);
    assert.equal(c.clusterEquals(a.pubkey, b.pubkey), true);
    assert.equal(c.clusterOf(a.pubkey).size, 2);
  });

  it('rejects colon-smashed and non-hex pubkeys', () => {
    const b = 'bb'.repeat(32);
    const n = nonce();
    const c = new IdentityCluster();
    assert.equal(c.ingestCrossSign({
      localPubkey: 'aa:bb',
      peerPubkey: b,
      nonce: n
    }).ok, false);
    assert.equal(c.ingestCrossSign({
      localPubkey: 'not-a-key',
      peerPubkey: b,
      nonce: n
    }).reason, 'invalid pubkey');
  });

  it('rejects self-links and mismatched nonces', () => {
    const a = createIdentity();
    const c = new IdentityCluster();
    assert.equal(c.ingestCrossSign({
      localPubkey: a.pubkey,
      peerPubkey: a.pubkey,
      nonce: nonce()
    }).ok, false);
    const b = createIdentity();
    const n1 = nonce();
    const n2 = nonce();
    c.ingestCrossSign({ localPubkey: a.pubkey, peerPubkey: b.pubkey, nonce: n1 });
    const r = c.ingestCrossSign({ localPubkey: b.pubkey, peerPubkey: a.pubkey, nonce: n2 });
    assert.equal(r.linked, false);
    assert.equal(c.clusterEquals(a.pubkey, b.pubkey), false);
  });

  it('revoke splits the cluster; canonical id is min pubkey', () => {
    const a = createIdentity();
    const b = createIdentity();
    const n = nonce();
    const c = new IdentityCluster();
    c.ingestCrossSign({ localPubkey: a.pubkey, peerPubkey: b.pubkey, nonce: n });
    c.ingestCrossSign({ localPubkey: b.pubkey, peerPubkey: a.pubkey, nonce: n });
    const canon = c.canonicalOf(a.pubkey);
    const members = Array.from(c.clusterOf(a.pubkey)).sort();
    assert.equal(canon, members[0]);
    c.ingestRevoke({ localPubkey: a.pubkey, peerPubkey: b.pubkey });
    assert.equal(c.clusterEquals(a.pubkey, b.pubkey), false);
    assert.equal(c.ingestCrossSign({
      localPubkey: a.pubkey,
      peerPubkey: b.pubkey,
      nonce: n
    }).reason, 'revoked');
  });

  it('transits through a third device', () => {
    const a = createIdentity();
    const b = createIdentity();
    const d = createIdentity();
    const c = new IdentityCluster();
    const n1 = nonce();
    const n2 = nonce();
    c.ingestCrossSign({ localPubkey: a.pubkey, peerPubkey: b.pubkey, nonce: n1 });
    c.ingestCrossSign({ localPubkey: b.pubkey, peerPubkey: a.pubkey, nonce: n1 });
    c.ingestCrossSign({ localPubkey: b.pubkey, peerPubkey: d.pubkey, nonce: n2 });
    c.ingestCrossSign({ localPubkey: d.pubkey, peerPubkey: b.pubkey, nonce: n2 });
    assert.equal(c.clusterEquals(a.pubkey, d.pubkey), true);
    assert.equal(c.clusterOf(a.pubkey).size, 3);
  });
});

describe('identityCrossSign Schnorr', () => {
  it('signs and verifies with Fabric Identity.fabricKey', () => {
    const ident = new Identity(new Key());
    const peer = createIdentity();
    const n = nonce();
    const obj = signCrossSign(ident, { peerPubkey: peer.pubkey, nonce: n });
    assert.equal(obj.type, SIGN_TYPE);
    const v = verifyCrossSignObject(obj, ident.fabricKey.pubkey);
    assert.equal(v.ok, true);
    assert.equal(v.kind, SIGN_TYPE);
    assert.ok(pubkeysMatch(v.record.peerPubkey, peer.pubkey));
  });

  it('rejects a tampered peer pubkey', () => {
    const ident = new Identity(new Key());
    const peer = createIdentity();
    const obj = signCrossSign(ident, { peerPubkey: peer.pubkey, nonce: nonce() });
    obj.peerPubkey = createIdentity().pubkey;
    const v = verifyCrossSignObject(obj);
    assert.equal(v.ok, false);
  });

  it('signs revoke bodies', () => {
    const ident = new Identity(new Key());
    const peer = createIdentity();
    const obj = signCrossSign(ident, { peerPubkey: peer.pubkey, nonce: nonce() }, REVOKE_TYPE);
    assert.equal(obj.type, REVOKE_TYPE);
    const v = verifyCrossSignObject(obj);
    assert.equal(v.ok, true);
    assert.equal(v.kind, REVOKE_TYPE);
  });

  it('verifies a CONTRACT_MESSAGE-wrapped IdentityCrossSign', () => {
    const ident = createIdentity();
    const peer = createIdentity();
    const obj = signCrossSign(ident, { peerPubkey: peer.pubkey, nonce: nonce() });
    const wrapped = { contract: 'goon', type: SIGN_TYPE, actor: { publicKey: ident.pubkey }, object: obj };
    const coerced = coerceCrossSignObject(wrapped);
    assert.equal(coerced.localPubkey, obj.localPubkey);
    assert.equal(isCrossSignType(coerced.type), true);
    const v = verifyCrossSignObject(wrapped);
    assert.equal(v.ok, true);
    assert.equal(v.kind, SIGN_TYPE);
  });

  it('verifies a wrapper whose inner payload omitted type', () => {
    const ident = createIdentity();
    const peer = createIdentity();
    const obj = signCrossSign(ident, { peerPubkey: peer.pubkey, nonce: nonce() });
    const inner = Object.assign({}, obj);
    delete inner.type;
    delete inner['@type'];
    const v = verifyCrossSignObject({ type: SIGN_TYPE, object: inner });
    assert.equal(v.ok, true);
  });

  it('rejects unknown kind and missing fields', () => {
    const ident = new Identity(new Key());
    assert.throws(() => signCrossSign(ident, { peerPubkey: 'aa', nonce: nonce() }, 'ChatMessage'), /unknown cross-sign type/);
    assert.throws(() => signCrossSign(ident, null), /fields required/);
  });

  it('signs a raw HD Key with fabricKey pubkey, not the master', () => {
    const master = new Key();
    const ident = new Identity(master);
    const peer = createIdentity();
    const obj = signCrossSign(master, { peerPubkey: peer.pubkey, nonce: nonce() });
    assert.equal(obj.localPubkey.toLowerCase(), ident.fabricKey.pubkey.toLowerCase());
    assert.notEqual(obj.localPubkey.toLowerCase(), String(master.pubkey).toLowerCase());
    const v = verifyCrossSignObject(obj);
    assert.equal(v.ok, true);
  });

  it('accepts a BIP340 body even when the AMP envelope author differs', () => {
    const ident = new Identity(new Key());
    const peer = createIdentity();
    const obj = signCrossSign(ident, { peerPubkey: peer.pubkey, nonce: nonce() });
    const v = verifyCrossSignObject(obj, createIdentity().pubkey);
    assert.equal(v.ok, true);
  });
});

describe('identityCluster group membership', () => {
  it('treats a clustered device as a group member', async () => {
    const a = createIdentity();
    const b = createIdentity();
    const n = nonce();
    const cluster = new IdentityCluster();
    cluster.ingestCrossSign({ localPubkey: a.pubkey, peerPubkey: b.pubkey, nonce: n });
    cluster.ingestCrossSign({ localPubkey: b.pubkey, peerPubkey: a.pubkey, nonce: n });
    const gm = new GroupManager({
      store: new Store(),
      sameActor: (x, y) => cluster.clusterEquals(x, y)
    });
    await gm.start();
    const created = await gm.createGroup({ name: 'Wing', visibility: 'private' }, a.pubkey);
    assert.equal(gm.isMember(created.id, a.pubkey), true);
    assert.equal(gm.isMember(created.id, b.pubkey), true);
    assert.equal(gm.isInGroupTree(created.id, b.pubkey), true);
  });
});
