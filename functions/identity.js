'use strict';

// Player identity helpers on `@fabric/core/functions/accountKeys`.
//
// One seed per install. The seed phrase and the BIP39 passphrase (the
// derivation password) make the master xprv; the lock password seals it.
// Nothing else is kept secret: the stored record is a core account vault
// (`FabricAccountVault` v2) holding the sealed master, the selected account +
// network, and the public view of every account used so far.
//
// An unlocked identity is `{ xprv (master), account, network, pubkey, id }`.
// Actor id is the account's Fabric identity key `m/44'/F'/n'/0/0` (F = 7777
// mainnet, 7778 otherwise), matching @fabric/core Peer signing — never the HD
// master. Bitcoin keys live on `m/84'/B'/n'` + `m/44'/B'/n'`, the federation
// cosigner on `m/87'/B'/n'/0/0`.

const crypto = require('crypto');
const Key = require('@fabric/core/types/key');
const accountKeys = require('@fabric/core/functions/accountKeys');
const fabricPubkey = require('@fabric/http/functions/fabricPubkey');
const { ENVELOPE: ENVELOPE_TAG } = require('./signingTags');
const { fromSeed: bip32FromSeed } = require('@fabric/core/functions/bip32');

const LEGACY_BLOB_ERROR = 'This identity file is from an older GoonCitizen. Restore from your seed phrase instead.';

/**
 * Bitcoin network label for Fabric coin-type selection (7777 mainnet / 7778 else).
 * @param {object} [opts]
 * @returns {string}
 */
function fabricIdentityNetwork (opts = {}) {
  const raw = opts.network
    || process.env.FABRIC_BITCOIN_NETWORK
    || process.env.BITCOIN_NETWORK
    || 'regtest';
  return accountKeys.normalizeAccountNetwork(String(raw).trim().toLowerCase() || 'regtest');
}

/**
 * @param {*} value
 * @returns {number}
 */
function accountIndex (value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n >= 0x80000000) throw new Error('account must be an integer from 0 to 2147483647');
  return n;
}

/**
 * Deterministic JSON stringify (recursively sorted object keys) so that
 * signatures are stable across processes.
 * @param {*} value Any JSON-serializable value.
 * @returns {String} Canonical JSON.
 */
function canonicalStringify (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') + '}';
}

/**
 * SHA-256 digest of the canonical JSON form of a payload.
 * @param {Object} payload Payload object.
 * @returns {Buffer} 32-byte digest.
 */
function payloadDigest (payload) {
  return crypto.createHash('sha256').update(canonicalStringify(payload)).digest();
}

function looksLikeRawSeedHex (value) {
  if (value == null) return false;
  const trimmed = String(value).trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (!/^(?:0x)?[0-9a-fA-F]+$/i.test(trimmed)) return false;
  const hex = trimmed.replace(/^0x/i, '');
  if (hex.length % 2 !== 0) return false;
  const bytes = hex.length / 2;
  return bytes >= 16 && bytes <= 64;
}

/**
 * Master xprv from a seed phrase (+ BIP39 passphrase), raw seed hex, or a
 * depth-0 xprv. Account-level xprvs are refused: one seed per install.
 * @param {Object|string} input
 * @returns {string}
 */
function masterFromInput (input) {
  let opts = input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (/^[xt]prv/.test(trimmed)) opts = { xprv: trimmed };
    else if (looksLikeRawSeedHex(trimmed)) opts = { seed: trimmed };
    else opts = { mnemonic: trimmed };
  }
  if (!opts || typeof opts !== 'object') throw new Error('a seed phrase, seed hex, or master xprv is required');
  if (opts.xprv) return accountKeys.normalizeMasterXprv(String(opts.xprv).trim());
  if (opts.seed && looksLikeRawSeedHex(opts.seed)) {
    const buf = Buffer.from(String(opts.seed).trim().replace(/^0x/i, ''), 'hex');
    return accountKeys.normalizeMasterXprv(bip32FromSeed(buf).toBase58());
  }
  const phrase = opts.mnemonic || opts.seed;
  if (phrase) return accountKeys.importSeed(String(phrase), opts.passphrase == null ? '' : String(opts.passphrase));
  throw new Error('a seed phrase, seed hex, or master xprv is required');
}

const _derived = new Map();
const DERIVED_CACHE_LIMIT = 32;

/**
 * Keys of one (master, account, network), memoized: signing derives the
 * identity key on every message.
 * @private
 */
function _deriveCached (master, account, network) {
  const cacheKey = crypto.createHash('sha256').update(`${master}\n${network}\n${account}`).digest('hex');
  const hit = _derived.get(cacheKey);
  if (hit) return hit;
  const derived = accountKeys.deriveAccount(master, { account, network });
  if (_derived.size >= DERIVED_CACHE_LIMIT) _derived.delete(_derived.keys().next().value);
  _derived.set(cacheKey, derived);
  return derived;
}

/**
 * Unlocked identity for one account of a master.
 * @param {string} master Master xprv.
 * @param {Object} [opts]
 * @param {number} [opts.account]
 * @param {string} [opts.network]
 * @returns {{ xprv: string, account: number, network: string, pubkey: string, id: string }}
 */
function identityFromMaster (master, opts = {}) {
  const xprv = accountKeys.normalizeMasterXprv(master);
  const network = fabricIdentityNetwork(opts);
  const account = accountIndex(opts.account);
  const derived = _deriveCached(xprv, account, network);
  return {
    xprv,
    account,
    network,
    pubkey: derived.identity.pubkey,
    id: derived.identity.pubkey
  };
}

/**
 * Create a brand-new identity. The seed phrase is returned once for the user
 * to write down; nothing persists it.
 * @param {Object} [opts]
 * @param {string} [opts.network]
 * @param {number} [opts.account]
 * @param {string} [opts.passphrase] BIP39 passphrase (derivation password)
 * @returns {{ mnemonic: string, xprv: string, account: number, network: string, pubkey: string, id: string }}
 */
function createIdentity (opts = {}) {
  const mnemonic = accountKeys.generateMnemonic();
  const master = accountKeys.importSeed(mnemonic, opts.passphrase == null ? '' : String(opts.passphrase));
  return Object.assign({ mnemonic }, identityFromMaster(master, opts));
}

/**
 * Restore an identity from a seed phrase (+ passphrase), raw seed hex, or a
 * master xprv. The seed phrase is not kept.
 * @param {Object|String} input Seed phrase / seed hex / xprv string, or
 *   `{ mnemonic, passphrase }` / `{ seed }` / `{ xprv }` plus `account` / `network`.
 * @returns {{ xprv: string, account: number, network: string, pubkey: string, id: string }}
 */
function restoreIdentity (input) {
  const opts = (input && typeof input === 'object') ? input : {};
  return identityFromMaster(masterFromInput(input), { account: opts.account, network: opts.network });
}

/**
 * Keys of one account on one network: identity `m/44'/F'/n'/0/0`, wallet
 * `m/84'/B'/n'` + `m/44'/B'/n'`, cosigner `m/87'/B'/n'/0/0`.
 * @param {Object} identity Unlocked identity.
 * @param {Object} [options]
 * @param {number} [options.account] Defaults to the identity's account.
 * @param {string} [options.network] Defaults to the identity's network.
 * @returns {object} `deriveAccount` result
 */
function accountFromIdentity (identity, options = {}) {
  if (!identity || !identity.xprv) throw new Error('unlocked identity required');
  const account = accountIndex(options.account != null ? options.account : identity.account);
  const network = fabricIdentityNetwork({ network: options.network || identity.network });
  return _deriveCached(accountKeys.normalizeMasterXprv(identity.xprv), account, network);
}

/**
 * Fabric identity signing key of the identity's account (matches Peer /
 * CONTRACT_MESSAGE author).
 * @param {Object} identity
 * @returns {Key}
 */
function protocolKeyFromIdentity (identity) {
  return accountFromIdentity(identity).identity.key;
}

/**
 * @param {Object} identity
 * @returns {Key}
 */
function keyFromIdentity (identity) {
  return protocolKeyFromIdentity(identity);
}

/**
 * HD master {@link Key} for Peer construction (Peer derives the Fabric path
 * from it with the identity's account and network).
 * @param {Object} identity
 * @returns {Key}
 */
function masterKeyFromIdentity (identity) {
  if (!identity || !identity.xprv) throw new Error('unlocked identity required');
  return new Key({ xprv: identity.xprv });
}

/**
 * Federation cosigner key of the identity's account on `network`.
 * @param {Object} identity
 * @param {string} [network]
 * @returns {Key}
 */
function cosignerKeyFromIdentity (identity, network) {
  return accountFromIdentity(identity, { network }).cosigner.key;
}

/**
 * @param {*} blob
 * @returns {boolean}
 */
function isIdentityVault (blob) {
  return !!(blob && blob.type === accountKeys.ACCOUNT_VAULT_TYPE &&
    blob.v === accountKeys.ACCOUNT_VAULT_VERSION && blob.seal && blob.current && blob.accounts);
}

/**
 * @param {*} blob
 * @returns {object}
 */
function assertIdentityVault (blob) {
  if (isIdentityVault(blob)) return blob;
  if (blob && (blob.ciphertext || blob.version != null)) throw new Error(LEGACY_BLOB_ERROR);
  throw new Error('identity vault required');
}

/**
 * Stored record around an already-sealed master (core `sealMaster`, or the
 * same envelope sealed with WebCrypto on Android).
 * @param {object} seal
 * @param {Object} identity Unlocked identity (its account + network become current).
 * @param {Object} [opts]
 * @param {string} [opts.label]
 * @returns {object}
 */
function identityVaultFromSeal (seal, identity, opts = {}) {
  const derived = accountFromIdentity(identity);
  return {
    type: accountKeys.ACCOUNT_VAULT_TYPE,
    v: accountKeys.ACCOUNT_VAULT_VERSION,
    seal,
    current: { account: derived.account, network: derived.network },
    accounts: {
      [accountKeys.vaultAccountKey(derived.account, derived.network)]: accountKeys.accountPublicView(derived, opts.label)
    },
    createdAt: new Date().toISOString()
  };
}

/**
 * Seal an identity for storage: the master xprv under the lock password.
 * @param {Object} identity
 * @param {string} password Lock password.
 * @param {Object} [opts]
 * @param {string} [opts.label]
 * @returns {object} Account vault (no plaintext secrets).
 */
function encryptIdentity (identity, password, opts = {}) {
  if (!identity || !identity.xprv) throw new Error('identity with xprv required');
  if (!password || typeof password !== 'string') throw new Error('password required');
  return identityVaultFromSeal(accountKeys.sealMaster(identity.xprv, password), identity, opts);
}

/**
 * Unlocked identity of a vault's current account, given its master.
 * @param {object} blob
 * @param {string} master
 * @returns {object}
 */
function openIdentityVault (blob, master) {
  const vault = assertIdentityVault(blob);
  return identityFromMaster(master, vault.current);
}

/**
 * Unseal a vault and open its current account.
 * @param {object} blob
 * @param {string} password Lock password.
 * @returns {object}
 */
function decryptIdentity (blob, password) {
  const vault = assertIdentityVault(blob);
  if (!password || typeof password !== 'string') throw new Error('password required');
  let master;
  try {
    master = accountKeys.unsealMaster(vault.seal, password);
  } catch (_) {
    throw new Error('Could not decrypt identity (wrong password or corrupted file)');
  }
  return openIdentityVault(vault, master);
}

/**
 * Switch a vault to another account / network. Without the unlocked identity
 * only pairs already in the vault can be picked (`FABRIC_ACCOUNT_LOCKED`).
 * @param {object} blob
 * @param {{ account: number, network: string, label: (string|undefined) }} pair
 * @param {Object} [identity] Unlocked identity (any account of the same master).
 * @returns {{ blob: object, identity: (object|null) }}
 */
function selectIdentityAccount (blob, pair = {}, identity = null) {
  const vault = assertIdentityVault(blob);
  const network = fabricIdentityNetwork({ network: pair.network || vault.current.network });
  const account = accountIndex(pair.account != null ? pair.account : vault.current.account);
  const next = accountKeys.selectVaultAccount(vault, {
    account,
    network,
    master: identity && identity.xprv ? identity.xprv : undefined,
    label: pair.label
  });
  return {
    blob: next,
    identity: identity && identity.xprv ? identityFromMaster(identity.xprv, next.current) : null
  };
}

/**
 * Public summary of a vault: the current account and every cached one.
 * @param {object} blob
 * @returns {object|null}
 */
function identityBlobSummary (blob) {
  if (!isIdentityVault(blob)) return null;
  const current = accountKeys.currentVaultAccount(blob);
  const accounts = Object.values(blob.accounts || {})
    .filter((a) => a && a.identity)
    .map((a) => ({
      account: a.account,
      network: a.network,
      label: a.label,
      pubkey: a.identity.pubkey,
      current: !!(current && a.account === current.account && a.network === current.network)
    }))
    .sort((a, b) => (a.network === b.network ? a.account - b.account : a.network.localeCompare(b.network)));
  return {
    account: current ? current.account : blob.current.account,
    network: current ? current.network : blob.current.network,
    label: current ? current.label : null,
    pubkey: current && current.identity ? current.identity.pubkey : null,
    wallet: current ? current.wallet : null,
    cosigner: current && current.cosigner ? current.cosigner.pubkey : null,
    accounts,
    createdAt: blob.createdAt || null
  };
}

/**
 * Create a Schnorr-signed envelope around a payload.
 * @param {Object} identity Unlocked identity (or a Key).
 * @param {Object} payload JSON payload to sign.
 * @returns {{ pubkey: String, payload: Object, signature: String, digest: String }}
 */
function signEnvelope (identity, payload) {
  const key = (identity instanceof Key) ? identity : protocolKeyFromIdentity(identity);
  const digest = payloadDigest(payload);
  const signature = key.signSchnorr(digest, ENVELOPE_TAG);
  return {
    pubkey: key.pubkey,
    payload,
    signature: Buffer.from(signature).toString('hex'),
    digest: digest.toString('hex')
  };
}

/**
 * Verify a Schnorr-signed envelope. Recomputes the payload digest, so a
 * tampered payload fails even with a valid signature over the old digest.
 * @param {{ pubkey: String, payload: Object, signature: String }} envelope Envelope.
 * @returns {Boolean} True when the signature matches the payload and pubkey.
 */
function verifyEnvelope (envelope) {
  if (!envelope || !envelope.pubkey || !envelope.signature || envelope.payload === undefined) return false;
  try {
    const digest = payloadDigest(envelope.payload);
    const key = new Key({ public: envelope.pubkey });
    return key.verifySchnorr(digest, Buffer.from(envelope.signature, 'hex'), ENVELOPE_TAG) === true;
  } catch (error) {
    return false;
  }
}

/**
 * X-only (32-byte) hex form of a secp256k1 pubkey. Accepts compressed (33-byte
 * 02/03…) or already-x-only hex — Fabric wire authors are often x-only while
 * GoonCitizen identities use compressed `Key.pubkey`.
 * @param {*} hex
 * @returns {string|null}
 */
function pubkeyXOnly (hex) {
  return fabricPubkey.pubkeyXOnly(hex);
}

/**
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function pubkeysMatch (a, b) {
  return fabricPubkey.pubkeysMatch(a, b);
}

/**
 * @param {*} signerHex
 * @param {*} actor
 * @returns {string|null}
 */
function resolveSignerPubkey (signerHex, actor) {
  return fabricPubkey.resolveSignerPubkey(signerHex, actor);
}

/**
 * @param {*} hex
 * @returns {string}
 */
function canonicalChatAuthor (hex) {
  return fabricPubkey.canonicalChatAuthor(hex);
}

module.exports = {
  LEGACY_BLOB_ERROR,
  accountFromIdentity,
  accountIndex,
  canonicalStringify,
  payloadDigest,
  createIdentity,
  restoreIdentity,
  identityFromMaster,
  masterFromInput,
  keyFromIdentity,
  protocolKeyFromIdentity,
  masterKeyFromIdentity,
  cosignerKeyFromIdentity,
  fabricIdentityNetwork,
  isIdentityVault,
  identityVaultFromSeal,
  encryptIdentity,
  decryptIdentity,
  openIdentityVault,
  selectIdentityAccount,
  identityBlobSummary,
  signEnvelope,
  verifyEnvelope,
  pubkeyXOnly,
  pubkeysMatch,
  resolveSignerPubkey,
  canonicalChatAuthor
};
