'use strict';

/**
 * End-to-end identity setups used by desktop, Android, Passport, and Hub:
 * one seed → many device xprvs; many seeds → many devices; cluster + revoke.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const Identity = require('@fabric/core/types/identity');
const Key = require('@fabric/core/types/key');

const {
  generateVaultMnemonic,
  deriveMasterSeedVault,
  deviceAccountPath
} = require('../../functions/masterSeedVault');
const { createIdentity, restoreIdentity } = require('../../functions/identity');
const IdentityCluster = require('../../functions/identityCluster');
const { signCrossSign, verifyCrossSignObject } = require('../../functions/identityCrossSignVerify');
const { SIGN_TYPE, REVOKE_TYPE } = require('../../functions/identityCrossSign');
const GroupManager = require('../../services/GroupManager');
const { Store } = require('../../types/Store');

function nonce () {
  return crypto.randomBytes(32).toString('hex');
}

function identFromXprv (xprv) {
  return new Identity({ xprv, network: 'regtest' });
}

function linkBoth (cluster, a, b, n) {
  const ab = signCrossSign(a, { peerPubkey: b.pubkey, nonce: n });
  const ba = signCrossSign(b, { peerPubkey: a.pubkey, nonce: n });
  assert.equal(verifyCrossSignObject(ab).ok, true);
  assert.equal(verifyCrossSignObject(ba).ok, true);
  assert.equal(cluster.ingestCrossSign(verifyCrossSignObject(ab).record).linked, false);
  assert.equal(cluster.ingestCrossSign(verifyCrossSignObject(ba).record).linked, true);
}

describe('identity setups: one seed, many devices', () => {
  it('vault children restore as distinct identities until they cross-sign', () => {
    const mnemonic = generateVaultMnemonic();
    const vault = deriveMasterSeedVault({
      mnemonic,
      passphrase: 'one-seed-passphrase',
      extraDevices: 2
    });
    assert.equal(vault.devices.length, 3);
    const desktop = restoreIdentity({ xprv: vault.devices[0].xprv });
    const phone = restoreIdentity({ xprv: vault.devices[1].xprv });
    const passport = restoreIdentity({ xprv: vault.devices[2].xprv });
    assert.equal(desktop.pubkey, vault.devices[0].pubkey);
    assert.equal(phone.pubkey, vault.devices[1].pubkey);
    assert.notEqual(desktop.pubkey, phone.pubkey);
    assert.notEqual(phone.pubkey, passport.pubkey);

    const cluster = new IdentityCluster();
    assert.equal(cluster.clusterEquals(desktop.pubkey, phone.pubkey), false);

    const n = nonce();
    linkBoth(cluster, identFromXprv(vault.devices[0].xprv), identFromXprv(vault.devices[1].xprv), n);
    assert.equal(cluster.clusterEquals(desktop.pubkey, phone.pubkey), true);
    assert.equal(cluster.clusterEquals(desktop.pubkey, passport.pubkey), false);
  });

  it('does not treat the Bitcoin account xprv as a clustered identity sibling', () => {
    const vault = deriveMasterSeedVault({
      mnemonic: generateVaultMnemonic(),
      passphrase: 'btc-separate',
      extraDevices: 0
    });
    const device = restoreIdentity({ xprv: vault.devices[0].xprv });
    const btcAsIdent = restoreIdentity({ xprv: vault.bitcoin.xprv });
    assert.notEqual(device.pubkey, btcAsIdent.pubkey);
    const cluster = new IdentityCluster();
    assert.equal(cluster.clusterEquals(device.pubkey, btcAsIdent.pubkey), false);
  });

  it('rebuilds the same companion xprv from seed + password after the companion device is lost', () => {
    const mnemonic = generateVaultMnemonic();
    const passphrase = 'recover-companion';
    const original = deriveMasterSeedVault({ mnemonic, passphrase, extraDevices: 1 });
    const recovered = deriveMasterSeedVault({ mnemonic, passphrase, extraDevices: 1 });
    assert.equal(recovered.devices[1].xprv, original.devices[1].xprv);
    assert.equal(recovered.devices[1].pubkey, original.devices[1].pubkey);
    assert.equal(recovered.devices[1].path, deviceAccountPath(1, recovered.network));
  });
});

describe('identity setups: many seeds, many devices', () => {
  it('independent createIdentity keys stay distinct until mutually linked', () => {
    const desktop = createIdentity();
    const phone = createIdentity();
    const passport = createIdentity();
    const cluster = new IdentityCluster();
    assert.equal(cluster.clusterEquals(desktop.pubkey, phone.pubkey), false);
    linkBoth(cluster, new Identity({ xprv: desktop.xprv }), new Identity({ xprv: phone.xprv }), nonce());
    assert.equal(cluster.clusterEquals(desktop.pubkey, phone.pubkey), true);
    assert.equal(cluster.clusterEquals(desktop.pubkey, passport.pubkey), false);
    assert.equal(cluster.clusterOf(desktop.pubkey).size, 2);
  });

  it('two vaults (two seeds) never share device or Bitcoin keys', () => {
    const a = deriveMasterSeedVault({
      mnemonic: generateVaultMnemonic(),
      passphrase: 'seed-a-password',
      extraDevices: 1
    });
    const b = deriveMasterSeedVault({
      mnemonic: generateVaultMnemonic(),
      passphrase: 'seed-b-password',
      extraDevices: 1
    });
    assert.notEqual(a.devices[0].xprv, b.devices[0].xprv);
    assert.notEqual(a.devices[1].pubkey, b.devices[1].pubkey);
    assert.notEqual(a.bitcoin.xprv, b.bitcoin.xprv);
  });

  it('peer-equivalent link works when either side initiates (Passport or mobile)', () => {
    const passport = new Identity(new Key());
    const phone = new Identity(new Key());
    const cluster = new IdentityCluster();
    const n = nonce();
    // Android signs first, Passport countersigns.
    const phoneFirst = signCrossSign(phone, { peerPubkey: passport.pubkey, nonce: n });
    const passportBack = signCrossSign(passport, { peerPubkey: phone.pubkey, nonce: n });
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
    const n = nonce();
    const cluster = new IdentityCluster();
    linkBoth(cluster, desktop, phone, n);

    const gm = new GroupManager({
      store: new Store(),
      sameActor: (x, y) => cluster.clusterEquals(x, y)
    });
    await gm.start();
    const created = await gm.createGroup({ name: 'Wing', visibility: 'private' }, desktop.pubkey);
    assert.equal(gm.isMember(created.id, phone.pubkey), true);

    const rev = signCrossSign(phone, { peerPubkey: desktop.pubkey, nonce: n }, REVOKE_TYPE);
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
    linkBoth(cluster, a, b, nonce());
    linkBoth(cluster, b, c, nonce());
    assert.equal(cluster.clusterOf(a.pubkey).size, 3);

    cluster.ingestRevoke({ localPubkey: a.pubkey, peerPubkey: b.pubkey });
    assert.equal(cluster.clusterEquals(a.pubkey, b.pubkey), false);
    assert.equal(cluster.clusterEquals(b.pubkey, c.pubkey), true);
    assert.equal(cluster.clusterEquals(a.pubkey, c.pubkey), false);
  });

  it('refuses to re-link a revoked edge even with a new nonce', () => {
    const a = new Identity(new Key());
    const b = new Identity(new Key());
    const cluster = new IdentityCluster();
    const n1 = nonce();
    linkBoth(cluster, a, b, n1);
    cluster.ingestRevoke({ localPubkey: a.pubkey, peerPubkey: b.pubkey });
    const again = cluster.ingestCrossSign({
      localPubkey: a.pubkey,
      peerPubkey: b.pubkey,
      nonce: nonce()
    });
    assert.equal(again.ok, false);
    assert.equal(again.reason, 'revoked');
  });
});
