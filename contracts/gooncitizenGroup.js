'use strict';

/**
 * Per-Group Federation contract — each GoonCitizen Group is a published
 * Fabric contract (CONTRACT_PUBLISH) under which GroupChat / GroupChange /
 * GroupShare / FederationContractInvite ride as CONTRACT_MESSAGE frames.
 *
 * Distinct from the frozen network-wide GoonCitizen genesis
 * (`contracts/gooncitizen.js`). Do not mutate that file's messageTypes.
 */

const crypto = require('crypto');
const Actor = require('@fabric/core/types/actor');
const { gooncitizenContractId } = require('./gooncitizen');
const { CONTRACT_BODY_TYPES, isKnownContractBodyType } = require('./applicationMessageTypes');

/** Bump only when the group genesis shape must intentionally move ids. */
const GOONCITIZEN_GROUP_CONTRACT_VERSION = 6; // +FleetShare journal / messageTypes

const GROUP_CONTRACT_NAME = 'GoonCitizenGroup';

/**
 * App `type` values under a group contract namespace.
 * Names must stay stable (Actor id); assert against the shared core catalog.
 *
 * The group's Fabric identity is {@link groupContractId} (Actor id of the
 * genesis definition). Membership mutations append CONTRACT_MESSAGE journal
 * rows; tip digests are Schnorr-attested by the member threshold.
 */
/** Journal catch-up types (core catalog may lag; keep string fallbacks). */
const GROUP_JOURNAL_TYPES = Object.freeze([
  CONTRACT_BODY_TYPES.GroupJournalRequest || 'GroupJournalRequest',
  CONTRACT_BODY_TYPES.GroupJournalBatch || 'GroupJournalBatch',
  CONTRACT_BODY_TYPES.GroupStateJournal || 'GroupStateJournal'
]);

const GROUP_CAPABILITY_TYPES = Object.freeze([
  CONTRACT_BODY_TYPES.ContractCapabilityGrant || 'ContractCapabilityGrant',
  CONTRACT_BODY_TYPES.ContractWithdrawalRequest || 'ContractWithdrawalRequest',
  CONTRACT_BODY_TYPES.ContractWithdrawalWitness || 'ContractWithdrawalWitness'
]);

const GROUP_GOVERNANCE_TYPES = Object.freeze([
  CONTRACT_BODY_TYPES.GroupChangeProposal || 'GroupChangeProposal',
  CONTRACT_BODY_TYPES.GroupChangeVote || 'GroupChangeVote'
]);

const GROUP_MESSAGE_TYPES = Object.freeze([
  CONTRACT_BODY_TYPES.GroupChat,
  CONTRACT_BODY_TYPES.GroupChange,
  ...GROUP_GOVERNANCE_TYPES,
  CONTRACT_BODY_TYPES.GroupShare,
  CONTRACT_BODY_TYPES.GroupActivityTree,
  CONTRACT_BODY_TYPES.FleetShare,
  CONTRACT_BODY_TYPES.FederationContractInvite,
  CONTRACT_BODY_TYPES.FederationContractInviteResponse,
  ...GROUP_JOURNAL_TYPES,
  ...GROUP_CAPABILITY_TYPES
]);

for (const t of GROUP_MESSAGE_TYPES) {
  if (!t) {
    throw new Error('[GOONCITIZEN] GROUP_MESSAGE_TYPES entry missing');
  }
  if (!isKnownContractBodyType(t) &&
      !GROUP_JOURNAL_TYPES.includes(t) &&
      !GROUP_CAPABILITY_TYPES.includes(t) &&
      !GROUP_GOVERNANCE_TYPES.includes(t)) {
    throw new Error(`[GOONCITIZEN] GROUP_MESSAGE_TYPES entry unknown to applicationNamespaces: ${t}`);
  }
}

/**
 * Sort and dedupe compressed secp256k1 pubkeys (hex).
 * @param {string[]} validators
 * @returns {string[]}
 */
function canonicalizeValidators (validators) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(validators) ? validators : []) {
    const v = String(raw || '').trim().toLowerCase();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  out.sort((a, b) => Buffer.from(a, 'hex').compare(Buffer.from(b, 'hex')));
  return out;
}

/**
 * Hub-aligned proposedPolicy: { validators, threshold }.
 * @param {{ validators?: string[], threshold?: number }|null} policy
 * @returns {{ validators: string[], threshold: number }|null}
 */
function normalizeProposedPolicy (policy) {
  if (!policy || typeof policy !== 'object') return null;
  const validators = canonicalizeValidators(policy.validators);
  if (!validators.length) return null;
  let threshold = Math.max(1, Number(policy.threshold) || 1);
  if (threshold > validators.length) threshold = validators.length;
  return { validators, threshold };
}

/**
 * Stable fingerprint for a policy (sorted validators + threshold).
 * @param {{ validators: string[], threshold: number }} policy
 * @returns {string|null}
 */
function policyFingerprint (policy) {
  const p = normalizeProposedPolicy(policy);
  if (!p) return null;
  return crypto.createHash('sha256')
    .update(JSON.stringify({ validators: p.validators, threshold: p.threshold }))
    .digest('hex');
}

/**
 * Canonical genesis object for CONTRACT_PUBLISH / Actor id.
 * Identity-defining fields are frozen at create time; later membership
 * updates use GroupChange — do not republish a new genesis to change
 * validators (that would mint a new contract id).
 *
 * @param {Object} opts
 * @param {string} opts.groupId
 * @param {string} opts.creator
 * @param {string[]} opts.validators
 * @param {number} [opts.threshold]
 * @param {string} [opts.createdAt]
 * @param {{ name?: string, visibility?: string, slug?: string|null, parentId?: string|null }} [opts.meta]
 * @returns {Object}
 */
function groupContractDefinition (opts = {}) {
  const groupId = String(opts.groupId || '').trim();
  const creator = String(opts.creator || '').trim().toLowerCase();
  if (!groupId) throw new Error('groupId required for group contract definition');
  if (!creator) throw new Error('creator required for group contract definition');

  const proposedPolicy = normalizeProposedPolicy({
    validators: opts.validators && opts.validators.length ? opts.validators : [creator],
    threshold: opts.threshold
  });
  if (!proposedPolicy) throw new Error('proposedPolicy requires at least one validator');

  const meta = opts.meta && typeof opts.meta === 'object' ? opts.meta : {};
  return {
    name: GROUP_CONTRACT_NAME,
    version: GOONCITIZEN_GROUP_CONTRACT_VERSION,
    parentContract: gooncitizenContractId(),
    groupId,
    creator,
    createdAt: opts.createdAt || new Date().toISOString(),
    proposedPolicy,
    meta: {
      name: meta.name != null ? String(meta.name) : 'Unnamed group',
      visibility: meta.visibility === 'public' ? 'public' : 'private',
      slug: meta.slug != null ? meta.slug : null,
      parentId: meta.parentId || null
    },
    messageTypes: GROUP_MESSAGE_TYPES.slice(),
    state: {
      members: {},
      chat: {},
      changes: {},
      shares: {},
      meta: {}
    }
  };
}

/**
 * Deterministic contract id for a group genesis definition.
 * @param {Object} definition Or the same opts as {@link groupContractDefinition}
 * @returns {string}
 */
function groupContractId (definition) {
  const def = definition && definition.name === GROUP_CONTRACT_NAME
    ? definition
    : groupContractDefinition(definition || {});
  return new Actor(def).id;
}

/**
 * True when a CONTRACT_PUBLISH / definition object is a GoonCitizen Group.
 * @param {*} object
 * @returns {boolean}
 */
function isGroupContractDefinition (object) {
  return !!(object && object.name === GROUP_CONTRACT_NAME && object.groupId && object.proposedPolicy);
}

/**
 * True when an app message type belongs under a group contract namespace.
 * @param {*} type
 * @returns {boolean}
 */
function isGroupMessageType (type) {
  return GROUP_MESSAGE_TYPES.includes(String(type || ''));
}

module.exports = {
  GOONCITIZEN_GROUP_CONTRACT_VERSION,
  GROUP_CONTRACT_NAME,
  GROUP_MESSAGE_TYPES,
  GROUP_JOURNAL_TYPES,
  GROUP_CAPABILITY_TYPES,
  GROUP_GOVERNANCE_TYPES,
  canonicalizeValidators,
  normalizeProposedPolicy,
  policyFingerprint,
  groupContractDefinition,
  groupContractId,
  isGroupContractDefinition,
  isGroupMessageType
};
