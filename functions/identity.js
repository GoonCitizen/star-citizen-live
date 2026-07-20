'use strict';

// Player identity helpers — BIP39 mnemonic keypairs via @fabric/core Key,
// password-encrypted storage (scrypt + AES-256-GCM, Node built-ins only),
// and Schnorr-signed event envelopes for the goon.vc uplink.
//
// The player's actor id is the compressed secp256k1 public key (hex).

const crypto = require('crypto');
const Key = require('@fabric/core/types/key');

const ENCRYPTION_VERSION = 1;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 32;

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

/**
 * Create a brand-new identity (BIP39 mnemonic + secp256k1 keypair).
 * @returns {{ mnemonic: String, xprv: String, xpub: String, pubkey: String, id: String }}
 */
function createIdentity () {
  const key = new Key();
  return {
    mnemonic: key.mnemonic,
    xprv: key.xprv,
    xpub: key.xpub,
    pubkey: key.pubkey,
    id: key.pubkey
  };
}

/**
 * Restore an identity from a BIP39 mnemonic (or an xprv).
 * @param {Object|String} input Mnemonic string, or `{ mnemonic }` / `{ xprv }`.
 * @returns {{ mnemonic: String|null, xprv: String, xpub: String, pubkey: String, id: String }}
 */
function restoreIdentity (input) {
  let opts = input;
  if (typeof input === 'string') {
    opts = input.trim().startsWith('xprv') ? { xprv: input.trim() } : { mnemonic: input.trim() };
  }
  if (!opts || (!opts.mnemonic && !opts.xprv)) {
    throw new Error('restoreIdentity requires a mnemonic or xprv');
  }
  const key = new Key(opts);
  return {
    mnemonic: opts.mnemonic || key.mnemonic || null,
    xprv: key.xprv,
    xpub: key.xpub,
    pubkey: key.pubkey,
    id: key.pubkey
  };
}

/**
 * Load a signing {@link Key} from a decrypted identity object.
 * @param {Object} identity Identity with `xprv` (or `mnemonic`).
 * @returns {Key} Fabric key capable of Schnorr signing.
 */
function keyFromIdentity (identity) {
  if (!identity) throw new Error('identity required');
  if (identity.xprv) return new Key({ xprv: identity.xprv });
  if (identity.mnemonic) return new Key({ mnemonic: identity.mnemonic });
  throw new Error('identity has no private material (xprv or mnemonic)');
}

/**
 * Encrypt an identity for storage at rest. Only public fields remain
 * readable; mnemonic + xprv are sealed with scrypt + AES-256-GCM.
 * @param {Object} identity Result of {@link createIdentity} / {@link restoreIdentity}.
 * @param {String} password User password.
 * @returns {Object} JSON-safe blob (no plaintext secrets).
 */
function encryptIdentity (identity, password) {
  if (!identity || !identity.xprv) throw new Error('identity with xprv required');
  if (!password || typeof password !== 'string') throw new Error('password required');

  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derived, iv);
  const secret = JSON.stringify({ mnemonic: identity.mnemonic || null, xprv: identity.xprv });
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: ENCRYPTION_VERSION,
    kdf: Object.assign({ algorithm: 'scrypt', salt: salt.toString('hex') }, SCRYPT_PARAMS),
    cipher: 'aes-256-gcm',
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
    pubkey: identity.pubkey,
    xpub: identity.xpub,
    id: identity.pubkey,
    createdAt: new Date().toISOString()
  };
}

/**
 * Decrypt an identity blob produced by {@link encryptIdentity}.
 * @param {Object} blob Encrypted blob.
 * @param {String} password User password.
 * @returns {Object} Full identity (mnemonic, xprv, xpub, pubkey, id).
 */
function decryptIdentity (blob, password) {
  if (!blob || !blob.ciphertext) throw new Error('encrypted identity blob required');
  if (!password || typeof password !== 'string') throw new Error('password required');

  const salt = Buffer.from(blob.kdf.salt, 'hex');
  const params = { N: blob.kdf.N, r: blob.kdf.r, p: blob.kdf.p };
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH, params);
  const decipher = crypto.createDecipheriv('aes-256-gcm', derived, Buffer.from(blob.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'hex'));

  let secret = null;
  try {
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(blob.ciphertext, 'hex')),
      decipher.final()
    ]);
    secret = JSON.parse(plaintext.toString('utf8'));
  } catch (error) {
    throw new Error('Could not decrypt identity (wrong password or corrupted file)');
  }

  const key = new Key({ xprv: secret.xprv });
  return {
    mnemonic: secret.mnemonic || null,
    xprv: secret.xprv,
    xpub: key.xpub,
    pubkey: key.pubkey,
    id: key.pubkey
  };
}

/**
 * Create a Schnorr-signed envelope around a payload.
 * @param {Object} identity Decrypted identity (or object with `xprv`).
 * @param {Object} payload JSON payload to sign.
 * @returns {{ pubkey: String, payload: Object, signature: String, digest: String }}
 */
function signEnvelope (identity, payload) {
  const key = (identity instanceof Key) ? identity : keyFromIdentity(identity);
  const digest = payloadDigest(payload);
  const signature = key.signSchnorr(digest);
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
    return key.verifySchnorr(digest, Buffer.from(envelope.signature, 'hex')) === true;
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
  const s = String(hex || '').toLowerCase().replace(/^0x/, '');
  if (/^0[23][0-9a-f]{64}$/.test(s)) return s.slice(2);
  if (/^[0-9a-f]{64}$/.test(s)) return s;
  return null;
}

/**
 * True when two pubkey hex strings refer to the same key (compressed or x-only).
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function pubkeysMatch (a, b) {
  const xa = pubkeyXOnly(a);
  const xb = pubkeyXOnly(b);
  return !!(xa && xb && xa === xb);
}

/**
 * Prefer a compressed actor pubkey when it matches the wire signer (x-only).
 * @param {string|null} signerHex Wire signer from Message verification
 * @param {Object|null} actor Message actor { publicKey|pubkey|id }
 * @returns {string|null}
 */
function resolveSignerPubkey (signerHex, actor) {
  const candidate = actor && (actor.publicKey || actor.pubkey || actor.id);
  if (candidate && (!signerHex || pubkeysMatch(candidate, signerHex))) return String(candidate);
  return signerHex ? String(signerHex) : (candidate ? String(candidate) : null);
}

module.exports = {
  canonicalStringify,
  payloadDigest,
  createIdentity,
  restoreIdentity,
  keyFromIdentity,
  encryptIdentity,
  decryptIdentity,
  signEnvelope,
  verifyEnvelope,
  pubkeyXOnly,
  pubkeysMatch,
  resolveSignerPubkey
};
