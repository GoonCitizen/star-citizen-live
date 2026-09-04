'use strict';

/**
 * GroupChangeProposal helpers — propose → accumulate validator votes → adopt.
 * Adopted changes still apply as {@link GroupChange} (fold / mesh).
 */

const crypto = require('crypto');
const { pubkeyXOnly, pubkeysMatch } = require('./identity');

const ACTIONS = new Set(['member.add', 'member.remove', 'update']);
const INVITE_VIA = 'FederationContractInvite';
const INVITE_JOIN_ID_PREFIX = 'gprop-join-';

/**
 * Stable id so invitee publish and inviter accept land on one proposal.
 * @param {string} inviteId
 * @returns {string}
 */
function inviteJoinProposalId (inviteId) {
  const id = String(inviteId || '').trim();
  if (!id) throw new Error('inviteId required');
  return INVITE_JOIN_ID_PREFIX + id.toLowerCase();
}

/**
 * Invitation fields carried on a join proposal (signed + on the wire).
 * Omits clipboard hex / direction so inviter and invitee snapshots match.
 * @param {object} invite
 * @returns {object|null}
 */
function canonicalInviteForProposal (invite) {
  if (!invite || typeof invite !== 'object') return null;
  const inviteId = invite.inviteId || invite.id;
  if (!inviteId) return null;
  const invitedAtRaw = Number(invite.invitedAt);
  const invitedAt = Number.isFinite(invitedAtRaw) && invitedAtRaw > 0 ? invitedAtRaw : null;
  let expiresAt = null;
  if (invite.expiresAt != null && invite.expiresAt !== '') {
    const n = Number(invite.expiresAt);
    expiresAt = Number.isFinite(n) && n > 0 ? n : invite.expiresAt;
  }
  return {
    type: INVITE_VIA,
    v: invite.v != null ? Number(invite.v) || 2 : 2,
    inviteId: String(inviteId),
    inviterHubId: invite.inviterHubId ? String(invite.inviterHubId).toLowerCase() : null,
    inviteePubkey: invite.inviteePubkey ? String(invite.inviteePubkey).toLowerCase() : null,
    contractId: invite.contractId ? String(invite.contractId).toLowerCase() : null,
    groupId: invite.groupId ? String(invite.groupId) : null,
    groupName: invite.groupName != null && String(invite.groupName).trim()
      ? String(invite.groupName).trim()
      : null,
    role: invite.role != null && String(invite.role).trim()
      ? String(invite.role).trim().toLowerCase()
      : null,
    invitedAt,
    expiresAt
  };
}

/**
 * Deterministic proposal `createdAt` from the invite clock (not Date.now()).
 * @param {object} invite
 * @returns {string}
 */
function proposalCreatedAtFromInvite (invite) {
  if (!invite || typeof invite !== 'object') return new Date().toISOString();
  const n = Number(invite.invitedAt);
  if (Number.isFinite(n) && n > 0) return new Date(n).toISOString();
  if (invite.createdAt) return String(invite.createdAt);
  return new Date().toISOString();
}

/**
 * @param {object} proposal
 * @returns {boolean}
 */
function isInviteJoinProposal (proposal) {
  if (!proposal || typeof proposal !== 'object') return false;
  if (String(proposal.via || '') === INVITE_VIA) return true;
  if (proposal.inviteId) return true;
  return String(proposal.id || '').startsWith(INVITE_JOIN_ID_PREFIX);
}

/**
 * Canonical UTF-8 string validators BIP340-sign for a proposal.
 * @param {object} proposal
 * @returns {string}
 */
function signingStringForGroupChangeProposal (proposal) {
  const p = proposal && typeof proposal === 'object' ? proposal : {};
  const body = {
    type: 'GroupChangeProposal',
    v: 1,
    id: String(p.id || ''),
    contractId: String(p.contractId || '').toLowerCase(),
    groupId: String(p.groupId || ''),
    action: String(p.action || ''),
    member: p.member != null ? String(p.member).toLowerCase() : null,
    role: p.role != null ? String(p.role) : null,
    patch: p.patch && typeof p.patch === 'object' ? p.patch : null,
    proposedBy: String(p.proposedBy || '').toLowerCase(),
    createdAt: String(p.createdAt || ''),
    via: p.via ? String(p.via) : null,
    inviteId: p.inviteId ? String(p.inviteId) : null,
    invite: canonicalInviteForProposal(p.invite)
  };
  return JSON.stringify(body);
}

/**
 * @param {object} opts
 * @returns {object}
 */
function createProposalRecord (opts = {}) {
  const action = String(opts.action || '');
  if (!ACTIONS.has(action)) throw new Error(`unsupported proposal action: ${action}`);
  const id = String(opts.id || crypto.randomBytes(16).toString('hex'));
  const proposedBy = String(opts.proposedBy || opts.actor || '').toLowerCase();
  if (!proposedBy) throw new Error('proposedBy required');
  const record = {
    id,
    type: 'GroupChangeProposal',
    status: 'pending',
    groupId: String(opts.groupId || ''),
    contractId: opts.contractId ? String(opts.contractId).toLowerCase() : null,
    action,
    member: opts.member != null ? String(opts.member).toLowerCase() : null,
    role: opts.role != null ? String(opts.role) : null,
    patch: opts.patch && typeof opts.patch === 'object' ? opts.patch : null,
    proposedBy,
    createdAt: opts.createdAt || new Date().toISOString(),
    threshold: Math.max(1, Number(opts.threshold) || 1),
    via: opts.via ? String(opts.via) : null,
    inviteId: opts.inviteId ? String(opts.inviteId) : null,
    invite: canonicalInviteForProposal(opts.invite),
    signatures: {},
    adoptedChangeId: null,
    adoptedAt: null
  };
  if (!record.groupId) throw new Error('groupId required');
  if (record.invite && !record.inviteId) record.inviteId = record.invite.inviteId;
  if (record.inviteId && !record.via) record.via = INVITE_VIA;
  return record;
}

/**
 * @param {object} record
 * @param {string} pubkey
 * @param {string} signatureHex
 * @returns {object}
 */
function addVote (record, pubkey, signatureHex) {
  if (!record || record.status !== 'pending') throw new Error('proposal not pending');
  const pk = String(pubkey || '').toLowerCase();
  const sig = String(signatureHex || '').trim().toLowerCase();
  if (!pk || !sig) throw new Error('pubkey and signature required');
  record.signatures = Object.assign({}, record.signatures || {}, { [pk]: sig });
  return record;
}

/**
 * Count votes from current signer set.
 * @param {object} record
 * @param {Iterable<string>} signers
 * @returns {number}
 */
function voteCount (record, signers) {
  const sigs = (record && record.signatures) || {};
  let n = 0;
  for (const s of signers || []) {
    const pk = String(s || '').toLowerCase();
    if (pk && sigs[pk]) n += 1;
  }
  return n;
}

/**
 * @param {object} record
 * @param {object} group Group JSON / instance with validators + threshold
 * @returns {boolean}
 */
function hasThresholdVotes (record, group) {
  const signers = (group && (group.validators || group.members)) || [];
  const need = Math.max(1, Number((group && group.threshold) || record.threshold) || 1);
  return voteCount(record, signers) >= need;
}

/**
 * Map proposal → GroupChange payload for adopt / ingest.
 * @param {object} record
 * @returns {object}
 */
function changeFromProposal (record) {
  return {
    id: record.adoptedChangeId || ('chg:' + record.id),
    action: record.action,
    groupId: record.groupId,
    contractId: record.contractId,
    actor: record.proposedBy,
    member: record.member || undefined,
    role: record.role || undefined,
    patch: record.patch || undefined,
    proposalId: record.id,
    via: record.via || undefined,
    inviteId: record.inviteId || undefined,
    invite: record.invite || undefined,
    ts: record.adoptedAt || new Date().toISOString(),
    type: 'GroupChange'
  };
}

/**
 * Wire body for CONTRACT_MESSAGE publish.
 * @param {object} record
 * @returns {object}
 */
function proposalWireObject (record) {
  return {
    type: 'GroupChangeProposal',
    id: record.id,
    contractId: record.contractId,
    groupId: record.groupId,
    action: record.action,
    member: record.member,
    role: record.role,
    patch: record.patch,
    proposedBy: record.proposedBy,
    createdAt: record.createdAt,
    threshold: record.threshold,
    status: record.status,
    via: record.via || null,
    inviteId: record.inviteId || null,
    invite: record.invite || null
  };
}

/**
 * @param {object} record
 * @param {string} voter
 * @param {string} signature
 * @returns {object}
 */
function voteWireObject (record, voter, signature) {
  return {
    type: 'GroupChangeVote',
    proposalId: record.id,
    contractId: record.contractId,
    groupId: record.groupId,
    voter: String(voter || '').toLowerCase(),
    signature: String(signature || '').toLowerCase(),
    votedAt: new Date().toISOString()
  };
}

function isProposalType (type) {
  return String(type || '') === 'GroupChangeProposal';
}

function isVoteType (type) {
  return String(type || '') === 'GroupChangeVote';
}

/**
 * BIP340 verify a vote over {@link signingStringForGroupChangeProposal}.
 * @param {object} proposal Canonical proposal fields (pre-signature record)
 * @param {string} pubkey Compressed hex
 * @param {string} signatureHex
 * @returns {boolean}
 */
function verifyProposalVote (proposal, pubkey, signatureHex) {
  try {
    const Key = require('@fabric/core/types/key');
    const pk = String(pubkey || '').trim();
    const sig = String(signatureHex || '').trim();
    if (!pk || !sig) return false;
    if (sig.startsWith('local:')) return false;
    const key = new Key({ pubkey: pk });
    const message = signingStringForGroupChangeProposal(proposal);
    return key.verify(Buffer.from(message, 'utf8'), Buffer.from(sig, 'hex')) === true;
  } catch (_) {
    return false;
  }
}

/**
 * Sign a proposal with a Fabric Key / identity material.
 * @param {object} keyOrIdentity Key or { xprv|mnemonic }
 * @param {object} proposal
 * @returns {{ pubkey: string, signature: string, message: string }}
 */
function signProposalVote (keyOrIdentity, proposal) {
  const Key = require('@fabric/core/types/key');
  const { keyFromIdentity } = require('./identity');
  const key = keyOrIdentity && typeof keyOrIdentity.signSchnorr === 'function'
    ? keyOrIdentity
    : (keyOrIdentity && (keyOrIdentity.xprv || keyOrIdentity.mnemonic)
      ? keyFromIdentity(keyOrIdentity)
      : new Key(keyOrIdentity || {}));
  const message = signingStringForGroupChangeProposal(proposal);
  const signature = Buffer.from(key.signSchnorr(Buffer.from(message, 'utf8'))).toString('hex');
  return { pubkey: String(key.pubkey).toLowerCase(), signature, message };
}

module.exports = {
  ACTIONS,
  INVITE_VIA,
  INVITE_JOIN_ID_PREFIX,
  inviteJoinProposalId,
  canonicalInviteForProposal,
  proposalCreatedAtFromInvite,
  isInviteJoinProposal,
  signingStringForGroupChangeProposal,
  createProposalRecord,
  addVote,
  voteCount,
  hasThresholdVotes,
  changeFromProposal,
  proposalWireObject,
  voteWireObject,
  isProposalType,
  isVoteType,
  verifyProposalVote,
  signProposalVote,
  pubkeyXOnly,
  pubkeysMatch
};
