'use strict';

/**
 * Group — a member-created unit backed by a k-of-n Schnorr multisig of **signers**.
 *
 * `members` = all participants (readers + signers).
 * `validators` = signing federation (proposedPolicy.validators); tip / wallet / threshold.
 * Read-only members are in `members` but not `validators`.
 */

const crypto = require('crypto');
const Federation = require('@fabric/core/types/federation');
const { pubkeysMatch } = require('../functions/identity');

const PUBKEY_RE = /^0[23][0-9a-f]{64}$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

class Group {
  /**
   * @param {Object} data Group data.
   */
  constructor (data = {}) {
    this.id = data.id || null;
    this.name = data.name || 'Unnamed group';
    this.creator = data.creator || null;
    this.members = Array.isArray(data.members) ? [...new Set(data.members)] : [];
    // Signers: explicit validators, else proposedPolicy, else legacy (= all members).
    if (Array.isArray(data.validators) && data.validators.length) {
      this.validators = [...new Set(data.validators.map((v) => String(v).toLowerCase()))];
    } else if (data.proposedPolicy && Array.isArray(data.proposedPolicy.validators)) {
      this.validators = [...new Set(data.proposedPolicy.validators.map((v) => String(v).toLowerCase()))];
    } else {
      this.validators = this.members.slice();
    }
    // Ensure every validator is also a member.
    for (const v of this.validators) {
      if (!this.members.includes(v)) this.members.push(v);
    }
    this.threshold = Math.max(1, Number(data.threshold) || 1);
    this.visibility = data.visibility === 'public' ? 'public' : 'private';
    this.slug = data.slug || null;
    this.parentId = data.parentId || null;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.contractId = data.contractId || null;
    this.proposedPolicy = data.proposedPolicy || null;
    this.policyFingerprint = data.policyFingerprint || null;
    this.spendLadder = data.spendLadder || null;
    this.primaryColor = data.primaryColor || null;
    {
      const { sanitizePinnedChannels } = require('../functions/groupPinnedChannels');
      this.pinnedChannels = sanitizePinnedChannels(data.pinnedChannels);
    }
    {
      const { sanitizePinnedMessageIds } = require('../functions/chatMessagePins');
      this.pinnedMessages = sanitizePinnedMessageIds(data.pinnedMessages);
    }
    this._federation = null;
  }

  static isValidPubkey (pubkey) {
    return typeof pubkey === 'string' && PUBKEY_RE.test(pubkey);
  }

  static isValidSlug (slug) {
    return typeof slug === 'string' && SLUG_RE.test(slug) && !slug.startsWith('group-');
  }

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

  pathKey () { return this.slug || this.id; }

  pagePath () { return `/groups/${this.pathKey()}`; }

  /** @returns {Boolean} True when `pubkey` is a member (reader or signer). */
  includes (pubkey) {
    return this.members.some((m) => pubkeysMatch(m, pubkey));
  }

  /** @returns {Boolean} True when pubkey is a signing validator. */
  isSigner (pubkey) {
    return this.validators.some((v) => pubkeysMatch(v, pubkey));
  }

  /** Member but not a signer. */
  isReader (pubkey) {
    return this.includes(pubkey) && !this.isSigner(pubkey);
  }

  validate () {
    if (!this.members.length) throw new Error('group requires at least one member');
    if (!this.validators.length) throw new Error('group requires at least one signer (validator)');
    for (const m of this.members) {
      if (!Group.isValidPubkey(m)) throw new Error(`invalid member pubkey: ${m}`);
    }
    for (const v of this.validators) {
      if (!Group.isValidPubkey(v)) throw new Error(`invalid validator pubkey: ${v}`);
      if (!this.includes(v)) throw new Error(`validator must be a member: ${v}`);
    }
    if (this.creator && !this.includes(this.creator)) throw new Error('creator must be a member');
    if (this.creator && !this.isSigner(this.creator)) throw new Error('creator must be a signer');
    if (this.threshold > this.validators.length) {
      throw new Error(`threshold ${this.threshold} exceeds signer count ${this.validators.length}`);
    }
    if (this.slug != null && !Group.isValidSlug(this.slug)) {
      throw new Error('invalid group slug');
    }
    if (this.visibility !== 'public' && this.visibility !== 'private') {
      throw new Error('visibility must be public or private');
    }
    return true;
  }

  commitment () {
    const body = JSON.stringify({
      id: this.id,
      name: this.name,
      creator: this.creator,
      members: [...this.members].sort(),
      validators: [...this.validators].sort(),
      threshold: this.threshold,
      visibility: this.visibility,
      slug: this.slug,
      parentId: this.parentId || null
    });
    return crypto.createHash('sha256').update(body).digest('hex');
  }

  /** Lazily build the Fabric Federation for the **signer** set. */
  federation () {
    if (!this._federation) {
      const fed = new Federation({});
      for (const pubkey of this.validators) fed.addMember({ public: pubkey });
      this._federation = fed;
    }
    return this._federation;
  }

  /**
   * Verify a k-of-n multisignature against **signers** + threshold.
   */
  verifyMultiSignature (multiSig, threshold = this.threshold) {
    if (!multiSig || !multiSig.signatures) return false;
    const signatures = {};
    for (const [pubkey, sig] of Object.entries(multiSig.signatures)) {
      if (!this.isSigner(pubkey)) continue;
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
      validators: this.validators,
      threshold: this.threshold,
      visibility: this.visibility,
      slug: this.slug,
      parentId: this.parentId || null,
      path: this.pagePath(),
      createdAt: this.createdAt,
      contractId: this.contractId || null,
      proposedPolicy: this.proposedPolicy || null,
      policyFingerprint: this.policyFingerprint || null,
      spendLadder: this.spendLadder || null,
      primaryColor: this.primaryColor || null,
      pinnedChannels: Array.isArray(this.pinnedChannels) ? this.pinnedChannels.slice() : [],
      pinnedMessages: Array.isArray(this.pinnedMessages) ? this.pinnedMessages.slice() : [],
      commitment: this.commitment()
    };
  }

  toPublicJSON () {
    return {
      id: this.id,
      name: this.name,
      creator: this.creator,
      memberCount: this.members.length,
      signerCount: this.validators.length,
      validators: this.validators.slice(),
      threshold: this.threshold,
      visibility: this.visibility,
      slug: this.slug,
      parentId: this.parentId || null,
      path: this.pagePath(),
      createdAt: this.createdAt,
      contractId: this.contractId || null,
      policyFingerprint: this.policyFingerprint || null,
      primaryColor: this.primaryColor || null,
      pinnedChannels: Array.isArray(this.pinnedChannels) ? this.pinnedChannels.slice() : [],
      pinnedMessages: Array.isArray(this.pinnedMessages) ? this.pinnedMessages.slice() : []
    };
  }
}

module.exports = Group;
