'use strict';

/**
 * Persistent register event log — mission/group applications, decisions,
 * broadcasts, offers, and invites (local + gossip-ingested).
 *
 * Complements (does not replace) hash-chained `audit` / `groupaudit` and
 * per-group Statechain journals.
 *
 * UX split:
 * - `#notifications` — inbound actionable kinds only (see NOTIFICATION_KINDS)
 * - `/missions/:id` — activity for that mission
 * - `/groups/:id` — activity for that group
 */

const crypto = require('crypto');

const INBOX_TYPE = 'RegisterInboxItem';

/**
 * Kinds that belong in the Notifications bell — triggered by received offers /
 * requests (gossip or inbound apply), not local lifecycle bookkeeping.
 */
const NOTIFICATION_KINDS = new Set([
  'MissionBroadcast',
  'MissionApplication',
  'GroupApplication',
  'GroupOffer',
  'FederationInvite'
]);

/** Actions from MissionManager / GroupManager audit that become inbox rows. */
const MISSION_AUDIT_ACTIONS = new Set([
  'application.submit',
  'application.accept',
  'application.reject',
  'claim.submit',
  'claim.validate',
  'mission.create',
  'mission.ingest',
  'mission.cancel'
]);

const GROUP_AUDIT_ACTIONS = new Set([
  'group.application.submit',
  'group.application.accept',
  'group.application.reject',
  'group.ingest',
  'group.invite-shell',
  'group.invite.accept',
  'group.create',
  'group.change.member.add',
  'group.change.member.remove'
]);

function sha256Hex (s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function idFor (seed) {
  return sha256Hex(seed).slice(0, 24);
}

/**
 * @param {object} partial
 * @returns {object|null}
 */
function normalizeEntry (partial = {}) {
  const kind = String(partial.kind || '').trim();
  if (!kind) return null;
  const ts = partial.ts || new Date().toISOString();
  const id = partial.id || idFor(`${kind}:${partial.dedupeKey || ts}:${partial.source || ''}:${partial.title || ''}`);
  let status = partial.status || 'info';
  if (!['pending', 'accepted', 'ignored', 'rejected', 'self', 'info'].includes(status)) {
    status = 'info';
  }
  return {
    '@type': INBOX_TYPE,
    id,
    kind,
    status,
    ts,
    title: String(partial.title || kind).slice(0, 200),
    body: partial.body != null ? String(partial.body).slice(0, 500) : null,
    source: partial.source != null ? String(partial.source) : null,
    handle: partial.handle != null ? String(partial.handle).slice(0, 64) : null,
    reward: partial.reward != null ? Number(partial.reward) || null : null,
    refs: Object.assign({}, partial.refs || {}),
    resolvedAt: partial.resolvedAt || null,
    resolvedBy: partial.resolvedBy || null,
    actionable: partial.actionable === true
  };
}

/**
 * @param {import('../types/Store').Store|null} store
 * @param {object} partial
 * @returns {{ entry: object|null, created: boolean }}
 */
function append (store, partial) {
  const entry = normalizeEntry(partial);
  if (!entry || !store) return { entry, created: false };
  const prev = store.get('inbox', entry.id);
  if (prev) return { entry: prev, created: false };
  store.put('inbox', entry.id, entry);
  return { entry, created: true };
}

/**
 * Update status / resolution fields on an existing inbox row.
 * @param {import('../types/Store').Store|null} store
 * @param {string} id
 * @param {object} patch
 * @returns {object|null}
 */
function patch (store, id, patchObj = {}) {
  if (!store || !id) return null;
  const prev = store.get('inbox', id);
  if (!prev) return null;
  const next = Object.assign({}, prev, patchObj, { id: prev.id, kind: prev.kind });
  store.put('inbox', id, next);
  return next;
}

function entryFromMissionAudit (audit) {
  if (!audit || !MISSION_AUDIT_ACTIONS.has(audit.action)) return null;
  const action = audit.action;
  let kind = 'MissionEvent';
  let status = 'info';
  let actionable = false;
  let title = audit.summary || action;
  if (action === 'application.submit') {
    kind = 'MissionApplication';
    status = 'pending';
    actionable = true;
    title = `Applied: ${audit.summary || 'mission'}`;
  } else if (action === 'application.accept') {
    kind = 'MissionApplicationDecision';
    status = 'accepted';
    title = `Application accepted: ${audit.summary || ''}`;
  } else if (action === 'application.reject') {
    kind = 'MissionApplicationDecision';
    status = 'rejected';
    title = `Application rejected: ${audit.summary || ''}`;
  } else if (action === 'claim.submit') {
    kind = 'MissionClaim';
    status = 'pending';
    title = `Completion submitted: ${audit.summary || ''}`;
  } else if (action === 'claim.validate') {
    kind = 'MissionClaimDecision';
    status = audit.summary === 'rejected' ? 'rejected' : 'accepted';
    title = `Completion ${status}: ${audit.entityId || ''}`;
  } else if (action === 'mission.create' || action === 'mission.ingest') {
    kind = 'MissionCreated';
    title = action === 'mission.ingest'
      ? `Mission received: ${audit.summary || ''}`
      : `Mission created: ${audit.summary || ''}`;
  } else if (action === 'mission.cancel') {
    kind = 'MissionCancelled';
    status = 'ignored';
    title = `Mission cancelled: ${audit.summary || ''}`;
  }
  return normalizeEntry({
    id: `inbox-${audit.id}`,
    kind,
    status,
    actionable,
    ts: audit.ts,
    title,
    body: action,
    source: audit.actor,
    refs: {
      auditId: audit.id,
      missionId: audit.entity === 'mission' ? audit.entityId : null,
      applicationId: audit.entity === 'application' ? audit.entityId : null,
      claimId: audit.entity === 'claim' ? audit.entityId : null,
      action
    },
    dedupeKey: audit.id
  });
}

function entryFromGroupAudit (audit) {
  if (!audit || !GROUP_AUDIT_ACTIONS.has(audit.action)) return null;
  const action = audit.action;
  let kind = 'GroupEvent';
  let status = 'info';
  let actionable = false;
  let title = audit.summary || action;
  if (action === 'group.application.submit') {
    kind = 'GroupApplication';
    status = 'pending';
    actionable = true;
    title = 'Group join application';
  } else if (action === 'group.application.accept') {
    kind = 'GroupApplicationDecision';
    status = 'accepted';
    title = 'Group join accepted';
  } else if (action === 'group.application.reject') {
    kind = 'GroupApplicationDecision';
    status = 'rejected';
    title = 'Group join rejected';
  } else if (action === 'group.ingest' || action === 'group.invite-shell') {
    kind = 'GroupIngest';
    title = `Group received: ${audit.summary || ''}`;
  } else if (action === 'group.invite.accept') {
    kind = 'FederationInviteDecision';
    status = 'accepted';
    title = 'Federation invite accepted';
  } else if (action === 'group.create') {
    kind = 'GroupCreated';
    title = `Group created: ${audit.summary || ''}`;
  } else if (action.indexOf('group.change.') === 0) {
    kind = 'GroupChange';
    title = action.replace('group.change.', 'Member ') + (audit.summary ? `: ${audit.summary}` : '');
  }
  return normalizeEntry({
    id: `inbox-${audit.id}`,
    kind,
    status,
    actionable,
    ts: audit.ts,
    title,
    body: action,
    source: audit.actor,
    refs: {
      auditId: audit.id,
      groupId: audit.entityId,
      applicationId: action.indexOf('group.application') === 0 ? audit.summary : null,
      action
    },
    dedupeKey: audit.id
  });
}

function entryFromMissionBroadcast (rec) {
  if (!rec || !rec.id) return null;
  return normalizeEntry({
    id: `inbox-mb-${rec.id}`,
    kind: 'MissionBroadcast',
    status: rec.status || 'pending',
    actionable: (rec.status || 'pending') === 'pending',
    ts: rec.broadcastAt || rec.receivedAt || new Date().toISOString(),
    title: (rec.mission && rec.mission.title) || 'Mission offer',
    body: (rec.mission && rec.mission.description) || null,
    source: rec.source,
    handle: rec.handle,
    reward: rec.mission && rec.mission.reward,
    resolvedAt: rec.resolvedAt || null,
    resolvedBy: rec.resolvedBy || null,
    refs: {
      broadcastId: rec.id,
      missionId: rec.missionId,
      groupId: rec.groupId || null,
      scope: rec.scope || 'global',
      applicationId: rec.applicationId || null
    },
    dedupeKey: rec.id
  });
}

function entryFromGroupOffer (payload) {
  if (!payload || !payload.offer) return null;
  const offer = payload.offer;
  const group = payload.group;
  const contractId = offer.contractId || payload.contractId || null;
  const groupId = (group && group.id) || offer.groupId || null;
  const seed = offer.offerId || offer.id || `${contractId || ''}:${groupId || ''}:${payload.source || ''}`;
  return normalizeEntry({
    id: `inbox-go-${idFor(seed)}`,
    kind: 'GroupOffer',
    status: 'pending',
    actionable: true,
    ts: new Date().toISOString(),
    title: (group && group.name) || offer.name || 'Group offer',
    body: offer.note || (contractId ? `contract ${String(contractId).slice(0, 16)}…` : null),
    source: payload.source,
    refs: {
      groupId,
      contractId,
      offer
    },
    dedupeKey: seed
  });
}

function entryFromFederationInvite (invite, source = null) {
  if (!invite || !invite.inviteId) return null;
  return normalizeEntry({
    id: `inbox-fi-${invite.inviteId}`,
    kind: 'FederationInvite',
    status: invite.status || 'pending',
    actionable: (invite.status || 'pending') === 'pending',
    ts: invite.createdAt || invite.receivedAt || new Date().toISOString(),
    title: invite.note || 'Federation invite',
    body: invite.contractId ? `contract ${String(invite.contractId).slice(0, 16)}…` : null,
    source: source || invite.inviterHubId || null,
    resolvedAt: invite.resolvedAt || null,
    resolvedBy: invite.resolvedBy || null,
    refs: {
      inviteId: invite.inviteId,
      groupId: invite.groupId || null,
      contractId: invite.contractId || null
    },
    dedupeKey: invite.inviteId
  });
}

function isNotification (row) {
  return !!(row && NOTIFICATION_KINDS.has(row.kind) && row.status !== 'self');
}

/**
 * Resolve missionId on application/claim rows so entity pages can filter.
 * @param {import('../types/Store').Store|null} store
 * @param {object} entry
 * @returns {object}
 */
function enrichRefs (store, entry) {
  if (!entry || !entry.refs) return entry;
  const refs = Object.assign({}, entry.refs);
  if (!refs.missionId && refs.applicationId && store) {
    const app = store.get('applications', refs.applicationId);
    if (app && app.missionId) refs.missionId = app.missionId;
  }
  if (!refs.missionId && refs.claimId && store) {
    const claim = store.get('claims', refs.claimId);
    if (claim && claim.missionId) refs.missionId = claim.missionId;
  }
  if (!refs.groupId && refs.applicationId && store && String(refs.applicationId).indexOf('gapp') === 0) {
    const gapp = store.get('groupapplications', refs.applicationId);
    if (gapp && gapp.groupId) refs.groupId = gapp.groupId;
  }
  entry.refs = refs;
  return entry;
}

/**
 * List inbox rows newest-first. Optionally backfill from legacy collections
 * when the inbox is empty (upgrade path).
 * @param {import('../types/Store').Store|null} store
 * @param {{
 *   pendingOnly?: boolean,
 *   kind?: string,
 *   backfill?: boolean,
 *   notificationsOnly?: boolean,
 *   missionId?: string,
 *   groupId?: string
 * }} [opts]
 */
function list (store, opts = {}) {
  if (!store) return [];
  if (opts.backfill !== false) backfillFromLegacy(store);

  let rows = store.all('inbox') || [];
  if (opts.kind) {
    const k = String(opts.kind);
    rows = rows.filter((r) => r.kind === k);
  }
  if (opts.notificationsOnly) {
    rows = rows.filter(isNotification);
  }
  if (opts.missionId) {
    const mid = String(opts.missionId);
    rows = rows.filter((r) => r.refs && r.refs.missionId === mid);
  }
  if (opts.groupId) {
    const gid = String(opts.groupId);
    rows = rows.filter((r) => r.refs && r.refs.groupId === gid);
  }
  if (opts.pendingOnly) {
    rows = rows.filter((r) => r.status === 'pending');
  }
  return rows.slice().sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
}

/**
 * Seed inbox from existing audit / broadcast / invite collections (idempotent).
 * @param {import('../types/Store').Store} store
 */
function backfillFromLegacy (store) {
  if (!store) return 0;
  let n = 0;
  for (const b of store.all('missionbroadcasts') || []) {
    const e = entryFromMissionBroadcast(b);
    if (e && append(store, enrichRefs(store, e)).created) n += 1;
  }
  for (const a of store.all('audit') || []) {
    const e = entryFromMissionAudit(a);
    if (e && append(store, enrichRefs(store, e)).created) n += 1;
  }
  for (const a of store.all('groupaudit') || []) {
    const e = entryFromGroupAudit(a);
    if (e && append(store, enrichRefs(store, e)).created) n += 1;
  }
  for (const inv of store.all('groupinvites') || []) {
    const e = entryFromFederationInvite(inv, inv.source || inv.inviterHubId);
    if (e && append(store, enrichRefs(store, e)).created) n += 1;
  }
  // Re-enrich already-stored rows missing mission/group refs (upgrade path).
  for (const row of store.all('inbox') || []) {
    const before = JSON.stringify(row.refs || {});
    enrichRefs(store, row);
    if (JSON.stringify(row.refs || {}) !== before) store.put('inbox', row.id, row);
  }
  return n;
}

/** Pending actionable items for the Notifications bell. */
function pendingCount (store) {
  return list(store, { pendingOnly: true, notificationsOnly: true, backfill: true })
    .filter((r) => r.actionable === true && r.status === 'pending').length;
}

module.exports = {
  INBOX_TYPE,
  NOTIFICATION_KINDS,
  MISSION_AUDIT_ACTIONS,
  GROUP_AUDIT_ACTIONS,
  idFor,
  normalizeEntry,
  append,
  patch,
  list,
  backfillFromLegacy,
  pendingCount,
  isNotification,
  enrichRefs,
  entryFromMissionAudit,
  entryFromGroupAudit,
  entryFromMissionBroadcast,
  entryFromGroupOffer,
  entryFromFederationInvite
};
