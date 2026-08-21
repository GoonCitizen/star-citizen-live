'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  BITCOIN_ACCOUNT_PATH,
  MAX_EXTRA_DEVICES,
  deviceAccountPath,
  generateVaultMnemonic,
  deriveMasterSeedVault,
  formatVaultSlips
} = require('../../functions/masterSeedVault');
const { restoreIdentity } = require('../../functions/identity');
const { fabricCoinTypeForNetwork } = require('@fabric/core/constants');

describe('masterSeedVault', () => {
  it('derives a Bitcoin account and per-device identity xprvs from seed + password', () => {
    const mnemonic = generateVaultMnemonic();
    const a = deriveMasterSeedVault({
      mnemonic,
      passphrase: 'vault-pass-1',
      extraDevices: 1
    });
    const b = deriveMasterSeedVault({
      mnemonic,
      passphrase: 'vault-pass-1',
      extraDevices: 1
    });
    assert.equal(a.bitcoin.path, BITCOIN_ACCOUNT_PATH);
    assert.match(a.bitcoin.xprv, /^[xt]prv/);
    assert.equal(a.devices.length, 2);
    assert.equal(a.devices[0].label, 'This device');
    assert.equal(a.devices[1].label, 'Companion device');
    assert.equal(a.devices[0].path, deviceAccountPath(0, a.network));
    assert.equal(a.devices[1].path, deviceAccountPath(1, a.network));
    assert.equal(a.devices[0].path, `m/44'/${fabricCoinTypeForNetwork(a.network)}'/0'`);
    assert.equal(deviceAccountPath(0, 'mainnet'), `m/44'/${fabricCoinTypeForNetwork('mainnet')}'/0'`);
    assert.notEqual(deviceAccountPath(0, 'mainnet'), deviceAccountPath(0, 'regtest'));
    assert.equal(a.bitcoin.xprv, b.bitcoin.xprv);
    assert.equal(a.devices[0].xprv, b.devices[0].xprv);
    assert.equal(a.devices[0].pubkey, b.devices[0].pubkey);
    assert.notEqual(a.devices[0].xprv, a.bitcoin.xprv);
    assert.notEqual(a.devices[0].xprv, a.devices[1].xprv);
    assert.notEqual(a.devices[0].pubkey, a.devices[1].pubkey);
    assert.notEqual(a.bitcoin.xprv, a.masterXpub);

    const restored = restoreIdentity({ xprv: a.devices[0].xprv });
    assert.equal(restored.pubkey, a.devices[0].pubkey);
  });

  it('changes every child when the derivation password changes', () => {
    const mnemonic = generateVaultMnemonic();
    const a = deriveMasterSeedVault({ mnemonic, passphrase: 'alpha-pass', extraDevices: 0 });
    const b = deriveMasterSeedVault({ mnemonic, passphrase: 'bravo-pass', extraDevices: 0 });
    assert.notEqual(a.bitcoin.xprv, b.bitcoin.xprv);
    assert.notEqual(a.devices[0].xprv, b.devices[0].xprv);
    assert.notEqual(a.devices[0].pubkey, b.devices[0].pubkey);
  });

  it('clamps extra devices and formats slips without the derivation password', () => {
    const mnemonic = generateVaultMnemonic();
    const vault = deriveMasterSeedVault({
      mnemonic,
      passphrase: 'vault-pass-2',
      extraDevices: 99
    });
    assert.equal(vault.devices.length, 1 + MAX_EXTRA_DEVICES);
    const slips = formatVaultSlips(vault);
    assert.match(slips, /Seed phrase:/);
    assert.match(slips, /Associated Bitcoin wallet/);
    assert.match(slips, /Companion device/);
    assert.doesNotMatch(slips, /vault-pass-2/);
    assert.match(slips, new RegExp(vault.devices[0].xprv));
  });
});
