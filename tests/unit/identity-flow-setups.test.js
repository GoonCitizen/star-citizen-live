'use strict';

/**
 * End-to-end identity setups used by desktop, Android, Passport, and Hub:
 * one seed on many devices; many seeds linked by device-link; cluster + revoke.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const Identity = require('@fabric/core/types/identity');
const Key = require('@fabric/core/types/key');

const {
  generateVaultMnemonic,
  deriveMasterSeedVault
} = require('../../functions/masterSeedVault');
const { createIdentity, restoreIdentity, keyFromIdentity } = require('../../functions/identity');
const IdentityCluster = require('../../functions/identityCluster');
const { signCrossSign, verifyCrossSignObject } = require('../../functions/identityCrossSignVerify');
const { SIGN_TYPE, REVOKE_TYPE } = require('../../functions/identityCrossSign');
const GroupManager = require('../../services/GroupManager');
const { Store } = require('../../types/Store');

/** One device-link session: what both cross-signs of a pair must name. */
function session () {
  return {
    sessionId: crypto.randomBytes(24).toString('hex'),
    nonce: crypto.randomBytes(32).toString('hex'),
    origin: 'https://hub.example'
  };
}

function toward (peer, l) {
  return Object.assign({ peerPubkey: peer.pubkey }, l);
}

/** The identity leaf as a standalone xprv, for core Identity. */
function keyXprv (identity) {
  return keyFromIdentity(identity).xprv;
}

function identFromXprv (xprv) {
  return new Identity({ xprv, network: 'regtest' });
}

function linkBoth (cluster, a, b, l) {
  const ab = signCrossSign(a, toward(b, l));
  const ba = signCrossSign(b, toward(a, l));
  assert.equal(verifyCrossSignObject(ab).ok, true);
  assert.equal(verifyCrossSignObject(ba).ok, true);
  assert.equal(cluster.ingestCrossSign(verifyCrossSignObject(ab).record).linked, false);
  assert.equal(cluster.ingestCrossSign(verifyCrossSignObject(ba).record).linked, true);
}

describe('identity setups: one seed, many devices', () => {
  it('the same seed and derivation password restore the same identity on every device', () => {
    const mnemonic = generateVaultMnemonic();
    const passphrase = 'one-seed-passphrase';
    const vault = deriveMasterSeedVault({ mnemonic, passphrase, network: 'regtest' });
    const desktop = restoreIdentity({ mnemonic, passphrase, network: 'regtest' });
    const phone = restoreIdentity({ mnemonic, passphrase, network: 'regtest' });
    assert.equal(desktop.pubkey, vault.identity.pubkey);
    assert.equal(phone.pubkey, desktop.pubkey);
    assert.equal(phone.xprv, desktop.xprv);
    assert.equal(restoreIdentity({ mnemonic, network: 'regtest' }).pubkey === desktop.pubkey, false);
  });

  it('keeps the identity, wallet, and cosigner keys apart', () => {
    const vault = deriveMasterSeedVault({
      mnemonic: generateVaultMnemonic(),
      passphrase: 'btc-separate',
      network: 'regtest'
    });
    assert.notEqual(vault.identity.pubkey, vault.cosigner.pubkey);
    assert.notEqual(vault.wallet.segwit.xpub, vault.wallet.standard.xpub);
    const cluster = new IdentityCluster();
    assert.equal(cluster.clusterEquals(vault.identity.pubkey, vault.cosigner.pubkey), false);
  });

  it('a device with its own seed joins by device-link, not by a shared xprv', () => {
    const mnemonic = generateVaultMnemonic();
    const desktop = restoreIdentity({ mnemonic, passphrase: 'shared-pass', network: 'regtest' });
    const phone = createIdentity({ network: 'regtest' });
    const cluster = new IdentityCluster();
    assert.equal(cluster.clusterEquals(desktop.pubkey, phone.pubkey), false);
    linkBoth(cluster, identFromXprv(keyXprv(desktop)), identFromXprv(keyXprv(phone)), session());
    assert.equal(cluster.clusterEquals(desktop.pubkey, phone.pubkey), true);
  });
});

describe('identity setups: many seeds, many devices', () => {
  it('independent createIdentity keys stay distinct until mutually linked', () => {
    const desktop = createIdentity();
    const phone = createIdentity();
    const passport = createIdentity();
    const cluster = new IdentityCluster();
    assert.equal(cluster.clusterEquals(desktop.pubkey, phone.pubkey), false);
    linkBoth(cluster, identFromXprv(keyXprv(desktop)), identFromXprv(keyXprv(phone)), session());
    assert.equal(cluster.clusterEquals(desktop.pubkey, phone.pubkey), true);
    assert.equal(cluster.clusterEquals(desktop.pubkey, passport.pubkey), false);
    assert.equal(cluster.clusterOf(desktop.pubkey).size, 2);
  });

  it('two vaults (two seeds) never share identity, wallet, or cosigner keys', () => {
    const a = deriveMasterSeedVault({ mnemonic: generateVaultMnemonic(), passphrase: 'seed-a-password' });
    const b = deriveMasterSeedVault({ mnemonic: generateVaultMnemonic(), passphrase: 'seed-b-password' });
    assert.notEqual(a.identity.pubkey, b.identity.pubkey);
    assert.notEqual(a.wallet.segwit.xpub, b.wallet.segwit.xpub);
    assert.notEqual(a.cosigner.pubkey, b.cosigner.pubkey);
  });

  it('peer-equivalent link works when either side initiates (Passport or mobile)', () => {
    const passport = new Identity(new Key());
    const phone = new Identity(new Key());
    const cluster = new IdentityCluster();
    const l = session();
    // Android signs first, Passport countersigns.
    const phoneFirst = signCrossSign(phone, toward(passport, l));
    const passportBack = signCrossSign(passport, toward(phone, l));
    assert.equal(phoneFirst.type, SIGN_TYPE);
    cluster.ingestCrossSign(verifyCrossSignObject(phoneFirst).record);
    cluster.ingestCrossSign(verifyCrossSignObject(passportBack).record);
    assert.equal(cluster.clusterEquals(passport.pubkey, phone.pubkey), true);
  });
});

describe('identity setups: revocation', () => {
  it('either cluster member can revoke and group membership follows', async () => {
    const desktop = new Identity(new Key());
    const phone = new Identity(new Key());
    const l = session();
    const cluster = new IdentityCluster();
    linkBoth(cluster, desktop, phone, l);

    const gm = new GroupManager({
      store: new Store(),
      sameActor: (x, y) => cluster.clusterEquals(x, y)
    });
    await gm.start();
    const created = await gm.createGroup({ name: 'Wing', visibility: 'private' }, desktop.pubkey);
    assert.equal(gm.isMember(created.id, phone.pubkey), true);

    const rev = signCrossSign(phone, toward(desktop, l), REVOKE_TYPE);
    assert.equal(rev.type, REVOKE_TYPE);
    assert.equal(verifyCrossSignObject(rev).ok, true);
    cluster.ingestRevoke(verifyCrossSignObject(rev).record);
    assert.equal(cluster.clusterEquals(desktop.pubkey, phone.pubkey), false);
    assert.equal(gm.isMember(created.id, phone.pubkey), false);
  });

  it('revoking the middle device of a three-device cluster splits the chain', () => {
    const a = new Identity(new Key());
    const b = new Identity(new Key());
    const c = new Identity(new Key());
    const cluster = new IdentityCluster();
    const ab = session();
    linkBoth(cluster, a, b, ab);
    linkBoth(cluster, b, c, session());
    assert.equal(cluster.clusterOf(a.pubkey).size, 3);

    cluster.ingestRevoke(Object.assign({ localPubkey: a.pubkey, peerPubkey: b.pubkey }, ab));
    assert.equal(cluster.clusterEquals(a.pubkey, b.pubkey), false);
    assert.equal(cluster.clusterEquals(b.pubkey, c.pubkey), true);
    assert.equal(cluster.clusterEquals(a.pubkey, c.pubkey), false);
  });

  it('refuses the revoked session again, and links only through a new one', () => {
    const a = new Identity(new Key());
    const b = new Identity(new Key());
    const cluster = new IdentityCluster();
    const l1 = session();
    linkBoth(cluster, a, b, l1);
    cluster.ingestRevoke(Object.assign({ localPubkey: a.pubkey, peerPubkey: b.pubkey }, l1));
    const again = cluster.ingestCrossSign(Object.assign({ localPubkey: a.pubkey, peerPubkey: b.pubkey }, l1));
    assert.equal(again.ok, false);
    assert.equal(again.reason, 'revoked');
    assert.equal(cluster.clusterEquals(a.pubkey, b.pubkey), false);
    linkBoth(cluster, a, b, session());
    assert.equal(cluster.clusterEquals(a.pubkey, b.pubkey), true);
  });
});
