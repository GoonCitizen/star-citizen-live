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

const ORIGIN = 'https://hub.example';

/** One device-link session: what both cross-signs of a pair must name. */
function link (n = nonce()) {
  return { sessionId: crypto.randomBytes(24).toString('hex'), nonce: n, origin: ORIGIN };
}

function edge (local, peer, binding) {
  return Object.assign({ localPubkey: local, peerPubkey: peer }, binding);
}

describe('identityCrossSign messages', () => {
  it('round-trips the canonical cross-sign string', () => {
    const b = link('ab'.repeat(32));
    const a = '02' + 'aa'.repeat(32);
    const p = '03' + 'bb'.repeat(32);
    const msg = buildCrossSignMessage(edge(a, p, b));
    assert.match(msg, new RegExp('^' + CROSS_SIGN_PREFIX));
    assert.ok(msg.endsWith(':' + ORIGIN));
    const parsed = parseCrossSignMessage(msg);
    assert.equal(parsed.sessionId, b.sessionId);
    assert.equal(parsed.nonce, b.nonce);
    assert.equal(parsed.localPubkey, a);
    assert.equal(parsed.peerPubkey, p);
    assert.equal(parsed.origin, ORIGIN);
  });

  it('round-trips revoke messages', () => {
    const b = link('cd'.repeat(32));
    const a = '02' + 'aa'.repeat(32);
    const p = '03' + 'bb'.repeat(32);
    const msg = buildRevokeMessage(Object.assign(edge(a, p, b), { revokedAt: 1700000000000 }));
    assert.match(msg, new RegExp('^' + REVOKE_PREFIX));
    const parsed = parseRevokeMessage(msg);
    assert.equal(parsed.nonce, b.nonce);
    assert.equal(parsed.localPubkey, a);
    assert.equal(parsed.peerPubkey, p);
    assert.equal(parsed.revokedAt, 1700000000000);
    assert.equal(buildRevokeMessage(Object.assign(edge('aa:bb', p, b), { revokedAt: 1 })), null);
    assert.equal(buildRevokeMessage(edge(a, p, b)), null);
  });

  it('refuses strings without a session or origin', () => {
    const a = '02' + 'aa'.repeat(32);
    const p = '03' + 'bb'.repeat(32);
    assert.equal(buildCrossSignMessage({ localPubkey: a, peerPubkey: p, nonce: nonce() }), null);
    assert.equal(buildCrossSignMessage(edge(a, p, Object.assign(link(), { origin: 'ftp://x' }))), null);
  });
});

describe('identityCluster union-find', () => {
  it('does not combine until both directions name the same session', () => {
    const a = createIdentity();
    const b = createIdentity();
    const l = link();
    const c = new IdentityCluster();
    const one = c.ingestCrossSign(edge(a.pubkey, b.pubkey, l));
    assert.equal(one.ok, true);
    assert.equal(one.linked, false);
    assert.equal(c.clusterEquals(a.pubkey, b.pubkey), false);
    const two = c.ingestCrossSign(edge(b.pubkey, a.pubkey, l));
    assert.equal(two.linked, true);
    assert.equal(c.clusterEquals(a.pubkey, b.pubkey), true);
    assert.equal(c.clusterOf(a.pubkey).size, 2);
  });

  it('rejects colon-smashed and non-hex pubkeys', () => {
    const b = createIdentity().pubkey;
    const c = new IdentityCluster();
    assert.equal(c.ingestCrossSign(edge('aa:bb', b, link())).ok, false);
    assert.equal(c.ingestCrossSign(edge('not-a-key', b, link())).reason, 'invalid pubkey');
  });

  it('rejects self-links and mismatched sessions', () => {
    const a = createIdentity();
    const c = new IdentityCluster();
    assert.equal(c.ingestCrossSign(edge(a.pubkey, a.pubkey, link())).ok, false);
    const b = createIdentity();
    c.ingestCrossSign(edge(a.pubkey, b.pubkey, link()));
    const r = c.ingestCrossSign(edge(b.pubkey, a.pubkey, link()));
    assert.equal(r.linked, false);
    assert.equal(c.clusterEquals(a.pubkey, b.pubkey), false);
    const n = nonce();
    const other = link(n);
    c.ingestCrossSign(edge(a.pubkey, b.pubkey, other));
    const r2 = c.ingestCrossSign(edge(b.pubkey, a.pubkey, Object.assign({}, other, { origin: 'https://other.example' })));
    assert.equal(r2.linked, false);
  });

  it('rejects a cross-sign without a session or origin', () => {
    const a = createIdentity();
    const b = createIdentity();
    const c = new IdentityCluster();
    assert.equal(c.ingestCrossSign({ localPubkey: a.pubkey, peerPubkey: b.pubkey, nonce: nonce() }).ok, false);
  });

  it('revoke splits the cluster; canonical id is min pubkey', () => {
    const a = createIdentity();
    const b = createIdentity();
    const l = link();
    const c = new IdentityCluster();
    c.ingestCrossSign(edge(a.pubkey, b.pubkey, l));
    c.ingestCrossSign(edge(b.pubkey, a.pubkey, l));
    const canon = c.canonicalOf(a.pubkey);
    const members = Array.from(c.clusterOf(a.pubkey)).sort();
    assert.equal(canon, members[0]);
    c.ingestRevoke(edge(a.pubkey, b.pubkey, l));
    assert.equal(c.clusterEquals(a.pubkey, b.pubkey), false);
    assert.equal(c.ingestCrossSign(edge(a.pubkey, b.pubkey, l)).reason, 'revoked');
  });

  it('transits through a third device', () => {
    const a = createIdentity();
    const b = createIdentity();
    const d = createIdentity();
    const c = new IdentityCluster();
    const l1 = link();
    const l2 = link();
    c.ingestCrossSign(edge(a.pubkey, b.pubkey, l1));
    c.ingestCrossSign(edge(b.pubkey, a.pubkey, l1));
    c.ingestCrossSign(edge(b.pubkey, d.pubkey, l2));
    c.ingestCrossSign(edge(d.pubkey, b.pubkey, l2));
    assert.equal(c.clusterEquals(a.pubkey, d.pubkey), true);
    assert.equal(c.clusterOf(a.pubkey).size, 3);
  });
});

describe('identityCrossSign Schnorr', () => {
  function fields (peer, l = link()) {
    return Object.assign({ peerPubkey: peer.pubkey }, l);
  }

  it('signs and verifies with Fabric Identity.fabricKey', () => {
    const ident = new Identity(new Key());
    const peer = createIdentity();
    const obj = signCrossSign(ident, fields(peer));
    assert.equal(obj.type, SIGN_TYPE);
    const v = verifyCrossSignObject(obj);
    assert.equal(v.ok, true);
    assert.equal(v.kind, SIGN_TYPE);
    assert.equal(v.record.origin, ORIGIN);
    assert.ok(pubkeysMatch(v.record.peerPubkey, peer.pubkey));
  });

  it('rejects a tampered peer pubkey, session, or origin', () => {
    const ident = new Identity(new Key());
    const peer = createIdentity();
    const obj = signCrossSign(ident, fields(peer));
    assert.equal(verifyCrossSignObject(Object.assign({}, obj, { peerPubkey: createIdentity().pubkey })).ok, false);
    assert.equal(verifyCrossSignObject(Object.assign({}, obj, { sessionId: link().sessionId })).ok, false);
    assert.equal(verifyCrossSignObject(Object.assign({}, obj, { origin: 'https://evil.example' })).ok, false);
  });

  it('signs revoke bodies', () => {
    const ident = new Identity(new Key());
    const peer = createIdentity();
    const obj = signCrossSign(ident, fields(peer), REVOKE_TYPE);
    assert.equal(obj.type, REVOKE_TYPE);
    const v = verifyCrossSignObject(obj);
    assert.equal(v.ok, true);
    assert.equal(v.kind, REVOKE_TYPE);
    assert.ok(v.record.revokedAt > 0);
  });

  it('does not verify a cross-sign as a revoke', () => {
    const ident = new Identity(new Key());
    const peer = createIdentity();
    const obj = signCrossSign(ident, fields(peer));
    assert.equal(verifyCrossSignObject(Object.assign({}, obj, { type: REVOKE_TYPE, revokedAt: Date.now() })).ok, false);
  });

  it('verifies a CONTRACT_MESSAGE-wrapped IdentityCrossSign', () => {
    const ident = createIdentity();
    const peer = createIdentity();
    const obj = signCrossSign(ident, fields(peer));
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
    const obj = signCrossSign(ident, fields(peer));
    const inner = Object.assign({}, obj);
    delete inner.type;
    delete inner['@type'];
    const v = verifyCrossSignObject({ type: SIGN_TYPE, object: inner });
    assert.equal(v.ok, true);
  });

  it('rejects unknown kind and missing fields', () => {
    const ident = new Identity(new Key());
    assert.throws(() => signCrossSign(ident, fields(createIdentity()), 'ChatMessage'), /unknown cross-sign type/);
    assert.throws(() => signCrossSign(ident, null), /fields required/);
    assert.throws(() => signCrossSign(ident, { peerPubkey: createIdentity().pubkey, nonce: nonce() }), /invalid cross-sign fields/);
  });

  it('signs a raw HD Key with fabricKey pubkey, not the master', () => {
    const master = new Key();
    const ident = new Identity(master);
    const peer = createIdentity();
    const obj = signCrossSign(master, fields(peer));
    assert.equal(obj.localPubkey.toLowerCase(), ident.fabricKey.pubkey.toLowerCase());
    assert.notEqual(obj.localPubkey.toLowerCase(), String(master.pubkey).toLowerCase());
    const v = verifyCrossSignObject(obj);
    assert.equal(v.ok, true);
  });

  it('accepts a BIP340 body even when the AMP envelope author differs', () => {
    const ident = new Identity(new Key());
    const peer = createIdentity();
    const obj = signCrossSign(ident, fields(peer));
    const v = verifyCrossSignObject(obj, createIdentity().pubkey);
    assert.equal(v.ok, true);
  });
});

describe('identityCluster group membership', () => {
  it('treats a clustered device as a group member', async () => {
    const a = createIdentity();
    const b = createIdentity();
    const l = link();
    const cluster = new IdentityCluster();
    cluster.ingestCrossSign(edge(a.pubkey, b.pubkey, l));
    cluster.ingestCrossSign(edge(b.pubkey, a.pubkey, l));
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
