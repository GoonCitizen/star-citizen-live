'use strict';

/**
 * Master-seed wizard helpers: one BIP39 mnemonic + derivation password (the
 * BIP39 passphrase) → master xprv. The install keeps only that master,
 * sealed with the lock password; every account's keys come from it:
 *
 *   m/44'/F'/n'/0/0   Fabric identity (F = 7777 mainnet, 7778 otherwise)
 *   m/84'/B'/n'       wallet, SegWit (new addresses)
 *   m/44'/B'/n'       wallet, standard (watched)
 *   m/87'/B'/n'/0/0   multisig cosigner (group wallets, escrow)
 *
 * No per-device xprvs are exported. A second device imports the same seed
 * and derivation password, or keeps its own seed and links with device-link.
 */

const accountKeys = require('@fabric/core/functions/accountKeys');
const { accountFromIdentity, fabricIdentityNetwork, restoreIdentity } = require('./identity');

/**
 * @returns {string} Fresh BIP39 mnemonic (24 words).
 */
function generateVaultMnemonic () {
  return accountKeys.generateMnemonic(256);
}

/**
 * Public view of an account derived from a mnemonic and derivation password,
 * to show before installing. Holds no private key material.
 * @param {Object} opts
 * @param {string} opts.mnemonic
 * @param {string} [opts.passphrase] BIP39 passphrase (derivation password)
 * @param {string} [opts.network]
 * @param {number} [opts.account=0]
 * @returns {{ mnemonic: string, network: string, account: number, identity: Object, wallet: Object, cosigner: Object }}
 */
function deriveMasterSeedVault (opts = {}) {
  const mnemonic = String(opts.mnemonic || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!mnemonic) throw new Error('mnemonic required');
  const passphrase = opts.passphrase == null ? '' : String(opts.passphrase);
  const network = fabricIdentityNetwork(opts);
  const identity = restoreIdentity({ mnemonic, passphrase, network, account: opts.account || 0 });
  const derived = accountFromIdentity(identity);
  const view = accountKeys.accountPublicView(derived);
  return {
    mnemonic,
    network: view.network,
    account: view.account,
    identity: Object.assign({ path: derived.identity.path }, view.identity),
    wallet: view.wallet,
    cosigner: Object.assign({ path: derived.cosigner.path }, view.cosigner)
  };
}

module.exports = {
  generateVaultMnemonic,
  deriveMasterSeedVault
};
