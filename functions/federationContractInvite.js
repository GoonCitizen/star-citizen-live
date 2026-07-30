'use strict';

/**
 * Hub-compatible Federation contract invite helpers.
 * Shape matches hub.fabric.pub/functions/federationContractInvite.js so SCL
 * Groups and Hub Federations can exchange the same invite JSON.
 */

const FEDERATION_CONTRACT_INVITE = 'FederationContractInvite';
const FEDERATION_CONTRACT_INVITE_RESPONSE = 'FederationContractInviteResponse';

/**
 * @param {unknown} raw
 * @returns {{ mode: 'percent'|'sats', value: number }|null}
 */
function normalizeSpendingTerms (raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mode = String(raw.mode || '').toLowerCase();
  if (mode !== 'percent' && mode !== 'sats') return null;
  const value = Number(raw.value);
  if (!Number.isFinite(value) || value < 0) return null;
  if (mode === 'percent' && value > 100) return null;
  return { mode, value };
}

/**
 * @param {unknown} raw
 * @returns {{ validators: string[], threshold: number }|null}
 */
function normalizeProposedPolicy (raw) {
  if (!raw || typeof raw !== 'object') return null;
  const validators = Array.isArray(raw.validators)
    ? raw.validators.map((v) => String(v || '').trim()).filter(Boolean)
    : [];
  if (validators.length === 0) return null;
  let threshold = Math.max(1, Number(raw.threshold) || 1);
  if (threshold > validators.length) threshold = validators.length;
  return { validators, threshold };
}

function parseFederationContractInvite (content) {
  if (!content || typeof content !== 'string') return null;
  try {
    const p = JSON.parse(content);
    if (!p || p.type !== FEDERATION_CONTRACT_INVITE) return null;
    const ver = Number(p.v);
    if (ver !== 1 && ver !== 2) return null;
    if (!p.inviteId || typeof p.inviteId !== 'string') return null;
    return p;
  } catch (_) {
    return null;
  }
}

/** Parse invite from a string or already-parsed object. */
function parseFederationContractInviteLoose (value) {
  if (value && typeof value === 'object' && value.type === FEDERATION_CONTRACT_INVITE) {
    const ver = Number(value.v);
    if (ver !== 1 && ver !== 2) return null;
    if (!value.inviteId || typeof value.inviteId !== 'string') return null;
    return value;
  }
  return parseFederationContractInvite(value);
}

function parseFederationContractInviteResponse (content) {
  if (!content || typeof content !== 'string') return null;
  try {
    const p = JSON.parse(content);
    if (!p || p.type !== FEDERATION_CONTRACT_INVITE_RESPONSE) return null;
    if (Number(p.v) !== 1) return null;
    if (!p.inviteId || typeof p.inviteId !== 'string') return null;
    if (typeof p.accept !== 'boolean') return null;
    return p;
  } catch (_) {
    return null;
  }
}

function parseFederationContractInviteResponseLoose (value) {
  if (value && typeof value === 'object' && value.type === FEDERATION_CONTRACT_INVITE_RESPONSE) {
    if (Number(value.v) !== 1) return null;
    if (!value.inviteId || typeof value.inviteId !== 'string') return null;
    if (typeof value.accept !== 'boolean') return null;
    return value;
  }
  return parseFederationContractInviteResponse(value);
}

function buildFederationContractInviteJson (fields) {
  const spendingTerms = fields && fields.spendingTerms != null
    ? normalizeSpendingTerms(fields.spendingTerms)
    : null;
  const proposedPolicy = fields && fields.proposedPolicy != null
    ? normalizeProposedPolicy(fields.proposedPolicy)
    : null;
  const termsSummary = fields && fields.termsSummary != null && String(fields.termsSummary).trim()
    ? String(fields.termsSummary).trim().slice(0, 2000)
    : null;
  const publishSessionId = fields && fields.publishSessionId != null && String(fields.publishSessionId).trim()
    ? String(fields.publishSessionId).trim().slice(0, 128)
    : null;
  // Direct (1:1) invite target + group labels — GoonCitizen extension on v2.
  const inviteePubkey = fields && fields.inviteePubkey != null && String(fields.inviteePubkey).trim()
    ? String(fields.inviteePubkey).trim().toLowerCase()
    : null;
  const groupId = fields && fields.groupId != null && String(fields.groupId).trim()
    ? String(fields.groupId).trim().slice(0, 128)
    : null;
  const groupName = fields && fields.groupName != null && String(fields.groupName).trim()
    ? String(fields.groupName).trim().slice(0, 80)
    : null;
  const extended = !!(spendingTerms || proposedPolicy || termsSummary || publishSessionId
    || inviteePubkey || groupId || groupName);
  const doc = {
    type: FEDERATION_CONTRACT_INVITE,
    v: extended ? 2 : 1,
    inviteId: fields.inviteId,
    inviterHubId: fields.inviterHubId != null ? String(fields.inviterHubId) : null,
    contractId: fields.contractId != null && String(fields.contractId).trim()
      ? String(fields.contractId).trim()
      : null,
    note: fields.note != null && String(fields.note).trim() ? String(fields.note).trim().slice(0, 2000) : null,
    invitedAt: fields.invitedAt != null ? Number(fields.invitedAt) : Date.now()
  };
  if (spendingTerms) doc.spendingTerms = spendingTerms;
  if (proposedPolicy) doc.proposedPolicy = proposedPolicy;
  if (termsSummary) doc.termsSummary = termsSummary;
  if (publishSessionId) doc.publishSessionId = publishSessionId;
  if (inviteePubkey) doc.inviteePubkey = inviteePubkey;
  if (groupId) doc.groupId = groupId;
  if (groupName) doc.groupName = groupName;
  return JSON.stringify(doc);
}

function buildFederationContractInvite (fields) {
  return JSON.parse(buildFederationContractInviteJson(fields));
}

function buildFederationContractInviteResponseJson (fields) {
  return JSON.stringify({
    type: FEDERATION_CONTRACT_INVITE_RESPONSE,
    v: 1,
    inviteId: String(fields.inviteId || ''),
    accept: !!fields.accept,
    responderPubkey: fields.responderPubkey != null && String(fields.responderPubkey).trim()
      ? String(fields.responderPubkey).trim()
      : null,
    respondedAt: fields.respondedAt != null ? Number(fields.respondedAt) : Date.now()
  });
}

function buildFederationContractInviteResponse (fields) {
  return JSON.parse(buildFederationContractInviteResponseJson(fields));
}

/**
 * @param {object} invite - parsed invite
 * @returns {string}
 */
function formatFederationInviteSpendingSummary (invite) {
  const st = invite && normalizeSpendingTerms(invite.spendingTerms);
  if (!st) return '';
  if (st.mode === 'percent') return `Spending cap: ${st.value}% of treasury per agreement`;
  return `Spending cap: ${st.value} sats per agreement`;
}

module.exports = {
  FEDERATION_CONTRACT_INVITE,
  FEDERATION_CONTRACT_INVITE_RESPONSE,
  normalizeSpendingTerms,
  normalizeProposedPolicy,
  formatFederationInviteSpendingSummary,
  parseFederationContractInvite,
  parseFederationContractInviteLoose,
  parseFederationContractInviteResponse,
  parseFederationContractInviteResponseLoose,
  buildFederationContractInviteJson,
  buildFederationContractInvite,
  buildFederationContractInviteResponseJson,
  buildFederationContractInviteResponse
};
