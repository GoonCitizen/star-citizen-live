'use strict';

/**
 * End-to-end identity setups used by desktop, Android, Passport, and Hub:
 * one seed on many apps; many seeds linked as signers (mutual `identity`
 * grants); cluster + revoke.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const Key = require('@fabric/core/types/key');
const delegation = require('@fabric/core/functions/delegation');

const {
  generateVaultMnemonic,
  deriveMasterSeedVault
} = require('../../functions/masterSeedVault');
const { createIdentity, restoreIdentity, protocolKeyFromIdentity } = require('../../functions/identity');
const IdentityCluster = require('../../functions/identityCluster');
const GroupManager = require('../../services/GroupManager');
const { Store } = require('../../types/Store');

let clock = 1_800_000_000_000;
const tick = () => ++clock;

function grant (from, to) {
  return delegation.createGrant({ grantee: to.pubkey, scopes: ['identity'], label: 'test', now: tick() }, from);
}

function cluster () {
  return new IdentityCluster({ now: () => clock + 1 });
}

/** Both sides grant `identity`; the second grant links them. */
function linkBoth (c, a, b) {
  const ab = grant(a, b);
  const ba = grant(b, a);
  assert.equal(c.ingest(ab.uri).linked, false);
  assert.equal(c.ingest(ba.uri).linked, true);
  return { ab, ba };
}

describe('identity setups: one seed, many apps', () => {
  it('the same seed and derivation password restore the same identity everywhere', () => {
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
    assert.equal(cluster().clusterEquals(vault.identity.pubkey, vault.cosigner.pubkey), false);
  });

  it('an app with its own seed joins as a linked signer, not by a shared xprv', () => {
    const mnemonic = generateVaultMnemonic();
    const desktop = restoreIdentity({ mnemonic, passphrase: 'shared-pass', network: 'regtest' });
    const phone = createIdentity({ network: 'regtest' });
    const c = cluster();
    assert.equal(c.clusterEquals(desktop.pubkey, phone.pubkey), false);
    linkBoth(c, protocolKeyFromIdentity(desktop), protocolKeyFromIdentity(phone));
    assert.equal(c.clusterEquals(desktop.pubkey, phone.pubkey), true);
  });
});

describe('identity setups: many seeds, many apps', () => {
  it('independent identities stay distinct until mutually linked', () => {
    const desktop = createIdentity();
    const phone = createIdentity();
    const passport = createIdentity();
    const c = cluster();
    assert.equal(c.clusterEquals(desktop.pubkey, phone.pubkey), false);
    linkBoth(c, protocolKeyFromIdentity(desktop), protocolKeyFromIdentity(phone));
    assert.equal(c.clusterEquals(desktop.pubkey, phone.pubkey), true);
    assert.equal(c.clusterEquals(desktop.pubkey, passport.pubkey), false);
    assert.equal(c.clusterOf(desktop.pubkey).size, 2);
  });

  it('two vaults (two seeds) never share identity, wallet, or cosigner keys', () => {
    const a = deriveMasterSeedVault({ mnemonic: generateVaultMnemonic(), passphrase: 'seed-a-password' });
    const b = deriveMasterSeedVault({ mnemonic: generateVaultMnemonic(), passphrase: 'seed-b-password' });
    assert.notEqual(a.identity.pubkey, b.identity.pubkey);
    assert.notEqual(a.wallet.segwit.xpub, b.wallet.segwit.xpub);
    assert.notEqual(a.cosigner.pubkey, b.cosigner.pubkey);
  });

  it('links the same whichever side grants first (Passport or mobile)', () => {
    const passport = new Key();
    const phone = new Key();
    const c = cluster();
    assert.equal(c.ingest(grant(phone, passport).uri).linked, false);
    assert.equal(c.ingest(grant(passport, phone).uri).linked, true);
    assert.equal(c.clusterEquals(passport.pubkey, phone.pubkey), true);
  });

  it('a grant of other scopes alone never makes two keys one player', () => {
    const passport = new Key();
    const hub = new Key();
    const c = cluster();
    const message = delegation.createGrant({ grantee: hub.pubkey, scopes: ['message'], now: tick() }, passport);
    assert.equal(c.ingest(message.uri).ok, false);
    c.ingest(grant(hub, passport).uri);
    assert.equal(c.clusterEquals(passport.pubkey, hub.pubkey), false);
  });
});

describe('identity setups: revocation', () => {
  it('either side can revoke and group membership follows', async () => {
    const desktop = new Key();
    const phone = new Key();
    const c = cluster();
    const { ba } = linkBoth(c, desktop, phone);

    const gm = new GroupManager({
      store: new Store(),
      sameActor: (x, y) => c.clusterEquals(x, y)
    });
    await gm.start();
    const created = await gm.createGroup({ name: 'Wing', visibility: 'private' }, desktop.pubkey);
    assert.equal(gm.isMember(created.id, phone.pubkey), true);

    const rev = delegation.createRevoke({ grant: ba.hash, now: tick() }, phone);
    assert.equal(c.ingest(rev.uri).ok, true);
    assert.equal(c.clusterEquals(desktop.pubkey, phone.pubkey), false);
    assert.equal(gm.isMember(created.id, phone.pubkey), false);
  });

  it('revoking one link of a three-app chain splits it there', () => {
    const a = new Key();
    const b = new Key();
    const d = new Key();
    const c = cluster();
    const { ab } = linkBoth(c, a, b);
    linkBoth(c, b, d);
    assert.equal(c.clusterOf(a.pubkey).size, 3);

    c.ingest(delegation.createRevoke({ grant: ab.hash, now: tick() }, a).uri);
    assert.equal(c.clusterEquals(a.pubkey, b.pubkey), false);
    assert.equal(c.clusterEquals(b.pubkey, d.pubkey), true);
    assert.equal(c.clusterEquals(a.pubkey, d.pubkey), false);
  });

  it('a revoked grant stays revoked when replayed; only a new grant links again', () => {
    const a = new Key();
    const b = new Key();
    const c = cluster();
    const { ab } = linkBoth(c, a, b);
    c.ingest(delegation.createRevoke({ grant: ab.hash, now: tick() }, a).uri);
    c.ingest(ab.uri);
    assert.equal(c.clusterEquals(a.pubkey, b.pubkey), false);
    assert.equal(c.ingest(grant(a, b).uri).linked, true);
    assert.equal(c.clusterEquals(a.pubkey, b.pubkey), true);
  });

  it('a revoke signed by anyone but the grantor changes nothing', () => {
    const a = new Key();
    const b = new Key();
    const c = cluster();
    const { ab } = linkBoth(c, a, b);
    c.ingest(delegation.createRevoke({ grant: ab.hash, now: tick() }, new Key()).uri);
    assert.equal(c.clusterEquals(a.pubkey, b.pubkey), true);
  });
});
