'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const accountKeys = require('@fabric/core/functions/accountKeys');
const {
  generateVaultMnemonic,
  deriveMasterSeedVault
} = require('../../functions/masterSeedVault');
const { restoreIdentity } = require('../../functions/identity');

describe('masterSeedVault', () => {
  it('derives once from seed + derivation password and shows public keys only', () => {
    const mnemonic = generateVaultMnemonic();
    assert.equal(mnemonic.split(' ').length, 24);
    const vault = deriveMasterSeedVault({ mnemonic, passphrase: 'vault-pass-1', network: 'regtest' });
    assert.equal(vault.account, 0);
    assert.equal(vault.network, 'regtest');
    assert.equal(vault.identity.path, "m/7777'/7778'/0'/0/0");
    assert.equal(vault.wallet.segwit.path, "m/84'/1'/0'");
    assert.equal(vault.wallet.standard.path, "m/44'/1'/0'");
    assert.equal(vault.wallet.receive, 'segwit');
    assert.equal(vault.cosigner.path, "m/87'/1'/0'/0/0");
    assert.doesNotMatch(JSON.stringify(vault), /[xt]prv/);
    assert.doesNotMatch(JSON.stringify(vault), /vault-pass-1/);

    // What the device installs is the same identity the preview shows: one derivation, not two.
    const installed = restoreIdentity({ mnemonic, passphrase: 'vault-pass-1', network: 'regtest' });
    assert.equal(installed.pubkey, vault.identity.pubkey);
    assert.equal(installed.xprv, accountKeys.importSeed(mnemonic, 'vault-pass-1'));
  });

  it('changes every key when the derivation password changes', () => {
    const mnemonic = generateVaultMnemonic();
    const a = deriveMasterSeedVault({ mnemonic, passphrase: 'alpha-pass', network: 'regtest' });
    const b = deriveMasterSeedVault({ mnemonic, passphrase: 'bravo-pass', network: 'regtest' });
    assert.notEqual(a.identity.pubkey, b.identity.pubkey);
    assert.notEqual(a.wallet.segwit.xpub, b.wallet.segwit.xpub);
    assert.notEqual(a.cosigner.pubkey, b.cosigner.pubkey);
  });

  it('uses a different path on another network for the same account', () => {
    const mnemonic = generateVaultMnemonic();
    const test = deriveMasterSeedVault({ mnemonic, passphrase: 'net-pass', network: 'regtest' });
    const main = deriveMasterSeedVault({ mnemonic, passphrase: 'net-pass', network: 'mainnet' });
    assert.equal(main.identity.path, "m/7777'/7777'/0'/0/0");
    assert.equal(main.wallet.segwit.path, "m/84'/0'/0'");
    assert.notEqual(main.identity.pubkey, test.identity.pubkey);
  });
});
