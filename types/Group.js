'use strict';

/**
 * Group — a member-created org unit backed by a k-of-n Schnorr multisig.
 *
 * Members are identified by their compressed secp256k1 public keys (the same
 * actor ids the identity onboarding produces). Threshold decisions (mission
 * acceptance, payout release) are verified with the standard Fabric
 * {@link Federation} k-of-n Schnorr verification (BIP340).
 */

const crypto = require('crypto');
const Federation = require('@fabric/core/types/federation');

const PUBKEY_RE = /^0[23][0-9a-f]{64}$/;

class Group {
  /**
   * @param {Object} data Group data.
   * @param {String} data.id Group id.
   * @param {String} data.name Display name.
   * @param {String} data.creator Creator pubkey (hex).
   * @param {Array<String>} data.members Member pubkeys (hex).
   * @param {Number} [data.threshold=1] Signatures required for group decisions.
   * @param {String} [data.createdAt] ISO timestamp.
   */
  constructor (data = {}) {
    this.id = data.id || null;
    this.name = data.name || 'Unnamed group';
    this.creator = data.creator || null;
    this.members = Array.isArray(data.members) ? [...new Set(data.members)] : [];
    this.threshold = Math.max(1, Number(data.threshold) || 1);
    this.createdAt = data.createdAt || new Date().toISOString();
    this._federation = null;
  }

  static isValidPubkey (pubkey) {
    return typeof pubkey === 'string' && PUBKEY_RE.test(pubkey);
  }

  /** @returns {Boolean} True when `pubkey` is a member of this group. */
  includes (pubkey) {
    return this.members.includes(pubkey);
  }

  /** Validate shape: pubkeys well-formed, threshold achievable. */
  validate () {
    if (!this.members.length) throw new Error('group requires at least one member');
    for (const m of this.members) {
      if (!Group.isValidPubkey(m)) throw new Error(`invalid member pubkey: ${m}`);
    }
    if (this.creator && !this.includes(this.creator)) throw new Error('creator must be a member');
    if (this.threshold > this.members.length) {
      throw new Error(`threshold ${this.threshold} exceeds member count ${this.members.length}`);
    }
    return true;
  }

  /** Deterministic commitment over the group's identity-defining fields. */
  commitment () {
    const body = JSON.stringify({
      id: this.id,
      name: this.name,
      creator: this.creator,
      members: [...this.members].sort(),
      threshold: this.threshold
    });
    return crypto.createHash('sha256').update(body).digest('hex');
  }

  /** Lazily build the Fabric Federation for this member set. */
  federation () {
    if (!this._federation) {
      const fed = new Federation({});
      for (const pubkey of this.members) fed.addMember({ public: pubkey });
      this._federation = fed;
    }
    return this._federation;
  }

  /**
   * Verify a k-of-n multisignature against this group's roster + threshold.
   * Signers sign the raw message bytes with BIP340 Schnorr (Fabric
   * `Key.signSchnorr`); non-member signatures do not count.
   * @param {Object} multiSig `{ message, signatures: { [pubkey]: sigHexOrBuffer } }`.
   * @param {Number} [threshold] Override (defaults to the group threshold).
   * @returns {Boolean} True when at least `threshold` member signatures verify.
   */
  verifyMultiSignature (multiSig, threshold = this.threshold) {
    if (!multiSig || !multiSig.signatures) return false;
    const signatures = {};
    for (const [pubkey, sig] of Object.entries(multiSig.signatures)) {
      if (!this.includes(pubkey)) continue; // ignore non-members
      signatures[pubkey] = Buffer.isBuffer(sig) ? sig : Buffer.from(String(sig), 'hex');
    }
    if (Object.keys(signatures).length < threshold) return false;
    try {
      return this.federation().verifyMultiSignature({ message: multiSig.message, signatures }, threshold) === true;
    } catch (error) {
      return false;
    }
  }

  toJSON () {
    return {
      id: this.id,
      name: this.name,
      creator: this.creator,
      members: this.members,
      threshold: this.threshold,
      createdAt: this.createdAt,
      commitment: this.commitment()
    };
  }
}

module.exports = Group;
