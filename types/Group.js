'use strict';

/**
 * Group — a member-created unit backed by a k-of-n Schnorr multisig.
 *
 * Many installations share over the Fabric mesh; Groups (and nested
 * subgroups via `parentId`) are the sharing / authority boundary — not a
 * single hard-coded "org".
 *
 * Members are identified by their compressed secp256k1 public keys (the same
 * actor ids the identity onboarding produces). Threshold decisions (mission
 * acceptance, payout release) are verified with the standard Fabric
 * {@link Federation} k-of-n Schnorr verification (BIP340).
 *
 * Pages: `/groups/:id` by default, or `/groups/:slug` when a custom slug is set.
 * Visibility: `private` (members only) or `public` (shareable join page).
 */

const crypto = require('crypto');
const Federation = require('@fabric/core/types/federation');

const PUBKEY_RE = /^0[23][0-9a-f]{64}$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

class Group {
  /**
   * @param {Object} data Group data.
   * @param {String} data.id Group id.
   * @param {String} data.name Display name.
   * @param {String} data.creator Creator pubkey (hex).
   * @param {Array<String>} data.members Member pubkeys (hex).
   * @param {Number} [data.threshold=1] Signatures required for group decisions.
   * @param {String} [data.visibility=private] `public` | `private`.
   * @param {String|null} [data.slug] Optional custom URL slug (else use id).
   * @param {String|null} [data.parentId] Parent group id when this is a subgroup.
   * @param {String} [data.createdAt] ISO timestamp.
   */
  constructor (data = {}) {
    this.id = data.id || null;
    this.name = data.name || 'Unnamed group';
    this.creator = data.creator || null;
    this.members = Array.isArray(data.members) ? [...new Set(data.members)] : [];
    this.threshold = Math.max(1, Number(data.threshold) || 1);
    this.visibility = data.visibility === 'public' ? 'public' : 'private';
    this.slug = data.slug || null;
    this.parentId = data.parentId || null;
    this.createdAt = data.createdAt || new Date().toISOString();
    this._federation = null;
  }

  static isValidPubkey (pubkey) {
    return typeof pubkey === 'string' && PUBKEY_RE.test(pubkey);
  }

  static isValidSlug (slug) {
    return typeof slug === 'string' && SLUG_RE.test(slug) && !slug.startsWith('group-');
  }

  /** Normalize a custom URL slug (lowercase, hyphenated) or return null. */
  static normalizeSlug (input) {
    if (input == null || input === '') return null;
    const slug = String(input).trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    if (!slug) return null;
    if (!Group.isValidSlug(slug)) throw new Error('slug must be 2–48 chars, lowercase letters/digits/hyphens (not starting with "group-")');
    return slug;
  }

  isPublic () { return this.visibility === 'public'; }

  /** Path segment for the group page: custom slug or id. */
  pathKey () { return this.slug || this.id; }

  /** Absolute path for the group page (`/groups/...`). */
  pagePath () { return `/groups/${this.pathKey()}`; }

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
    if (this.slug != null && !Group.isValidSlug(this.slug)) {
      throw new Error('invalid group slug');
    }
    if (this.visibility !== 'public' && this.visibility !== 'private') {
      throw new Error('visibility must be public or private');
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
      threshold: this.threshold,
      visibility: this.visibility,
      slug: this.slug,
      parentId: this.parentId || null
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

  /** Full JSON for members / authenticated managers. */
  toJSON () {
    return {
      id: this.id,
      name: this.name,
      creator: this.creator,
      members: this.members,
      threshold: this.threshold,
      visibility: this.visibility,
      slug: this.slug,
      parentId: this.parentId || null,
      path: this.pagePath(),
      createdAt: this.createdAt,
      commitment: this.commitment()
    };
  }

  /**
   * Public summary for share pages (no full member list — only count).
   * Safe for unauthenticated GET when visibility is public.
   */
  toPublicJSON () {
    return {
      id: this.id,
      name: this.name,
      creator: this.creator,
      memberCount: this.members.length,
      threshold: this.threshold,
      visibility: this.visibility,
      slug: this.slug,
      parentId: this.parentId || null,
      path: this.pagePath(),
      createdAt: this.createdAt
    };
  }
}

module.exports = Group;
