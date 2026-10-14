'use strict';

/**
 * RSI biography ownership claim for GoonCitizen.
 *
 * Operators paste `g00n:<7 hex chars>` into their public RSI citizen bio.
 * The hex is `sha256(compressed_pubkey_bytes).hex.substring(0, 7)`.
 * Anyone who can fetch the RSI page can check that the claimed handle
 * is controlled by the Fabric pubkey that advertised `scHandle`.
 */

const crypto = require('crypto');

const CLAIM_PREFIX = 'g00n:';
const CLAIM_HEX_LEN = 7;
/** Match `g00n:` plus 7 hex digits; allow surrounding punctuation/whitespace. */
const CLAIM_IN_TEXT_RE = /\bg00n:([0-9a-fA-F]{7})\b/g;

/**
 * SHA-256 of the compressed secp256k1 pubkey bytes, lowercase hex.
 * @param {string} pubkey compressed pubkey hex (`02`/`03` + 64 hex)
 * @returns {string|null} 64-char hex digest, or null if pubkey invalid
 */
function pubkeyHashHex (pubkey) {
  const hex = String(pubkey || '').trim().toLowerCase().replace(/^0x/, '');
  if (!/^0[23][0-9a-f]{64}$/.test(hex)) return null;
  return crypto.createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
}

/**
 * Short claim suffix: first 7 hex chars of the pubkey hash.
 * @param {string} pubkey
 * @returns {string|null}
 */
function pubkeyHashPrefix (pubkey) {
  const full = pubkeyHashHex(pubkey);
  if (!full) return null;
  return full.substring(0, CLAIM_HEX_LEN);
}

/**
 * Full token to paste into the RSI biography, e.g. `g00n:2b8b13c`.
 * @param {string} pubkey
 * @returns {string|null}
 */
function ownershipClaimToken (pubkey) {
  const prefix = pubkeyHashPrefix(pubkey);
  if (!prefix) return null;
  return CLAIM_PREFIX + prefix;
}

/**
 * Extract all `g00n:*******` tokens from free text (RSI bio).
 * @param {string} text
 * @returns {string[]} lowercase hex suffixes (7 chars each)
 */
function extractClaimSuffixes (text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  const re = new RegExp(CLAIM_IN_TEXT_RE.source, 'g');
  let m;
  while ((m = re.exec(text))) {
    out.push(m[1].toLowerCase());
  }
  return out;
}

/**
 * True when `text` contains the ownership claim for `pubkey`.
 * @param {string} text RSI bio (or any public text)
 * @param {string} pubkey Fabric compressed pubkey hex
 * @returns {boolean}
 */
function textOwnsPubkey (text, pubkey) {
  const expected = pubkeyHashPrefix(pubkey);
  if (!expected) return false;
  return extractClaimSuffixes(text).includes(expected);
}

/**
 * Build a verification result object for API / UI.
 * @param {Object} opts
 * @param {string} opts.pubkey
 * @param {string|null} [opts.bio] RSI citizen bio text
 * @param {string|null} [opts.handle]
 * @returns {{
 *   claim: string|null,
 *   pubkeyHash: string|null,
 *   verified: boolean,
 *   handle: string|null,
 *   matchedSuffix: string|null
 * }}
 */
function verifyOwnershipFromBio (opts = {}) {
  const claim = ownershipClaimToken(opts.pubkey);
  const pubkeyHash = pubkeyHashHex(opts.pubkey);
  const suffixes = extractClaimSuffixes(opts.bio || '');
  const expected = pubkeyHashPrefix(opts.pubkey);
  const verified = !!(expected && suffixes.includes(expected));
  return {
    claim,
    pubkeyHash,
    verified,
    handle: opts.handle ? String(opts.handle) : null,
    matchedSuffix: verified ? expected : null
  };
}

module.exports = {
  CLAIM_PREFIX,
  CLAIM_HEX_LEN,
  pubkeyHashHex,
  pubkeyHashPrefix,
  ownershipClaimToken,
  extractClaimSuffixes,
  textOwnsPubkey,
  verifyOwnershipFromBio
};
