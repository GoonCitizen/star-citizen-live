'use strict';

/**
 * Optional first-run vault: one BIP39 mnemonic + derivation password (BIP39
 * passphrase) → master xprv → child account xprvs.
 *
 *   m/44'/0'/0'              associated Bitcoin wallet (Hub-aligned BIP44)
 *   m/44'/{7777|7778}'/N'    device N identity HD root (restore this xprv)
 *
 * Each child can live on its own machine. A lost device does not reveal the
 * master. Emergency recovery is the seed phrase plus the derivation password.
 * Existing create / restore / import paths are unchanged.
 */

const Key = require('@fabric/core/types/key');
const { fabricIdentityNetwork, restoreIdentity } = require('./identity');

const BITCOIN_ACCOUNT_PATH = "m/44'/0'/0'";
const MAX_EXTRA_DEVICES = 7;

function fabricCoinType (network) {
  const n = String(network || '').trim().toLowerCase();
  if (n === 'main' || n === 'mainnet' || n === 'bitcoin' || n === 'livenet') return 7777;
  return 7778;
}

function deviceAccountPath (index, network) {
  const i = Math.max(0, Math.floor(Number(index) || 0));
  return `m/44'/${fabricCoinType(network)}'/${i}'`;
}

function deviceLabel (index) {
  if (index === 0) return 'This device';
  if (index === 1) return 'Companion device';
  return 'Device ' + (index + 1);
}

/**
 * @returns {string} Fresh BIP39 mnemonic (24 words).
 */
function generateVaultMnemonic () {
  const key = new Key();
  const mnemonic = String(key.mnemonic || '').trim();
  if (!mnemonic) throw new Error('could not generate a vault mnemonic');
  return mnemonic;
}

/**
 * Derive Bitcoin + device account xprvs from a mnemonic and derivation password.
 * @param {Object} opts
 * @param {string} opts.mnemonic
 * @param {string} [opts.passphrase] BIP39 passphrase (derivation password)
 * @param {number} [opts.extraDevices=0] Additional device accounts after this one (0–7)
 * @param {string} [opts.network]
 * @returns {{ mnemonic: string, network: string, bitcoin: object, devices: object[] }}
 */
function deriveMasterSeedVault (opts = {}) {
  const mnemonic = String(opts.mnemonic || '').trim().replace(/\s+/g, ' ');
  if (!mnemonic) throw new Error('mnemonic required');
  const passphrase = opts.passphrase == null ? '' : String(opts.passphrase);
  const extra = Math.max(0, Math.min(MAX_EXTRA_DEVICES,
    Math.floor(Number(opts.extraDevices != null ? opts.extraDevices : 0) || 0)));
  const network = fabricIdentityNetwork(opts);
  const master = new Key({ seed: mnemonic, passphrase });
  if (!master.xprv) throw new Error('could not derive master xprv');

  const btc = master.derive(BITCOIN_ACCOUNT_PATH);
  if (!btc || !btc.xprv) throw new Error('could not derive Bitcoin account xprv');

  const devices = [];
  const deviceCount = 1 + extra;
  for (let i = 0; i < deviceCount; i++) {
    const path = deviceAccountPath(i, network);
    const child = master.derive(path);
    if (!child || !child.xprv) throw new Error('could not derive device xprv at ' + path);
    const ident = restoreIdentity({ xprv: child.xprv, network });
    devices.push({
      role: 'device',
      index: i,
      label: deviceLabel(i),
      path,
      xprv: child.xprv,
      xpub: child.xpub,
      pubkey: ident.pubkey
    });
  }

  return {
    mnemonic,
    network,
    bitcoin: {
      role: 'bitcoin',
      label: 'Associated Bitcoin wallet',
      path: BITCOIN_ACCOUNT_PATH,
      xprv: btc.xprv,
      xpub: btc.xpub
    },
    devices,
    masterXpub: master.xpub
  };
}

/**
 * Plain-text slips for offline copy (seed + child xprvs). Does not include
 * the derivation password.
 * @param {ReturnType<typeof deriveMasterSeedVault>} vault
 * @returns {string}
 */
function formatVaultSlips (vault) {
  if (!vault || !vault.bitcoin || !Array.isArray(vault.devices)) {
    throw new Error('vault required');
  }
  const lines = [
    'GoonCitizen master-seed vault',
    'Physical backup = seed phrase + derivation password (not stored here).',
    'Restore a device with that device xprv. Do not put the seed on every machine.',
    '',
    'Seed phrase:',
    vault.mnemonic,
    '',
    vault.bitcoin.label + '  ' + vault.bitcoin.path,
    'xprv: ' + vault.bitcoin.xprv,
    'xpub: ' + vault.bitcoin.xpub
  ];
  vault.devices.forEach((d) => {
    lines.push('');
    lines.push(d.label + '  ' + d.path);
    lines.push('xprv: ' + d.xprv);
    lines.push('xpub: ' + d.xpub);
    if (d.pubkey) lines.push('pubkey: ' + d.pubkey);
  });
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  BITCOIN_ACCOUNT_PATH,
  MAX_EXTRA_DEVICES,
  fabricCoinType,
  deviceAccountPath,
  deviceLabel,
  generateVaultMnemonic,
  deriveMasterSeedVault,
  formatVaultSlips
};
