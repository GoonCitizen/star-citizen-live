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
 * requests (gossip or inbound apply), wallet escrow/payout/withdrawal events,
 * and invite / join decisions (including rejections).
 */
const NOTIFICATION_KINDS = new Set([
  'MissionBroadcast',
  'MissionApplication',
  'MissionClaim',
  'MissionClaimDecision',
  'GroupApplication',
  'GroupApplicationDecision',
  'GroupOffer',
  'FederationInvite',
  'FederationInviteDecision',
  'MultisigWalletInvite',
  'GroupChangeProposal',
  'WalletEscrow',
  'WalletPayout',
  'WalletWithdrawal',
  'NoteShare'
]);

/** Actions from MissionManager / GroupManager audit that become inbox rows. */
const MISSION_AUDIT_ACTIONS = new Set([
  'application.submit',
  'application.accept',
  'application.reject',
  'claim.submit',
  'claim.validate',
  'claim.supersede',
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
  'group.change.member.remove',
  'group.change.update',
  'group.proposal.member.add',
  'group.proposal.member.remove',
  'group.proposal.update',
  'group.proposal.vote'
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
  if (!['pending', 'accepted', 'ignored', 'rejected', 'self', 'info', 'superseded'].includes(status)) {
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
    actionable = true;
    title = `Completion submitted: ${audit.summary || ''}`;
  } else if (action === 'claim.validate') {
    kind = 'MissionClaimDecision';
    status = audit.summary === 'rejected' ? 'rejected' : 'accepted';
    title = `Completion ${status}: ${audit.entityId || ''}`;
  } else if (action === 'claim.supersede') {
    kind = 'MissionClaimDecision';
    status = 'superseded';
    title = `Completion superseded: ${audit.entityId || ''}`;
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
    title = 'Join request';
  } else if (action === 'group.application.accept') {
    kind = 'GroupApplicationDecision';
    status = 'accepted';
    title = 'Join accepted';
  } else if (action === 'group.application.reject') {
    kind = 'GroupApplicationDecision';
    status = 'rejected';
    title = 'Join declined';
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
  } else if (action.indexOf('group.proposal.') === 0) {
    const sub = action.replace('group.proposal.', '');
    if (sub === 'vote') {
      kind = 'GroupChangeVote';
      status = 'pending';
      title = 'Proposal vote' + (audit.summary ? `: ${audit.summary}` : '');
    } else {
      kind = 'GroupChangeProposal';
      status = 'pending';
      actionable = true;
      title = `Proposal: ${sub}` + (audit.summary ? ` (${audit.summary})` : '');
    }
  }
  const applicationId = action.indexOf('group.application') === 0
    ? String(audit.summary || '').trim() || null
    : null;
  const stableId = (kind === 'GroupApplication' && applicationId)
    ? `inbox-gapp-${applicationId}`
    : ((kind === 'GroupApplicationDecision' && applicationId)
      ? `inbox-gad-${applicationId}`
      : `inbox-${audit.id}`);
  return normalizeEntry({
    id: stableId,
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
      applicationId,
      applicantId: action === 'group.application.submit' ? audit.actor : null,
      proposalId: action.indexOf('group.proposal.') === 0 ? audit.summary : null,
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
    title: (group && group.name) || offer.name || (offer.meta && offer.meta.name) || 'Group share',
    body: offer.note || (contractId ? `contract ${String(contractId).slice(0, 16)}…` : null),
    source: payload.source,
    refs: {
      groupId,
      contractId,
      visibility: (group && group.visibility) || (offer.meta && offer.meta.visibility) || null,
      groupName: (group && group.name) || (offer.meta && offer.meta.name) || null,
      expiresAt: offer.expiresAt || null,
      offer
    },
    dedupeKey: seed
  });
}

/**
 * Pending / adopted GroupChangeProposal for the shared group log.
 * @param {object} proposal
 */
function entryFromGroupChangeProposal (proposal) {
  if (!proposal || !proposal.id) return null;
  const sigs = proposal.signatures && typeof proposal.signatures === 'object'
    ? Object.keys(proposal.signatures).length
    : 0;
  const need = Math.max(1, Number(proposal.threshold) || 1);
  const status = proposal.status === 'adopted' ? 'accepted' : 'pending';
  return normalizeEntry({
    id: `inbox-gcp-${proposal.id}`,
    kind: 'GroupChangeProposal',
    status,
    actionable: status === 'pending',
    ts: proposal.createdAt || proposal.adoptedAt || new Date().toISOString(),
    title: `Proposal ${proposal.action || 'change'} (${sigs}/${need} votes)`,
    body: proposal.member || (proposal.patch && JSON.stringify(proposal.patch)) || null,
    source: proposal.proposedBy,
    resolvedAt: proposal.adoptedAt || null,
    refs: {
      groupId: proposal.groupId,
      contractId: proposal.contractId || null,
      proposalId: proposal.id,
      action: proposal.action
    },
    dedupeKey: proposal.id
  });
}

function entryFromFederationInvite (invite, source = null) {
  if (!invite || !invite.inviteId) return null;
  const groupName = invite.groupName || null;
  const role = String(invite.role || 'signer').toLowerCase() === 'reader' ? 'reader' : 'signer';
  const isMultisig = role === 'signer';
  const kind = isMultisig ? 'MultisigWalletInvite' : 'FederationInvite';
  const title = isMultisig
    ? (groupName ? `Multisig wallet invite · ${groupName}` : (invite.note || 'Multisig wallet invite'))
    : (groupName ? `Invite to ${groupName}` : (invite.note || 'Group invite'));
  return normalizeEntry({
    id: `inbox-fi-${invite.inviteId}`,
    kind,
    status: invite.status || 'pending',
    actionable: (invite.status || 'pending') === 'pending',
    ts: invite.createdAt || invite.receivedAt || new Date().toISOString(),
    title,
    body: invite.note || (invite.contractId ? `contract ${String(invite.contractId).slice(0, 16)}…` : null),
    source: source || invite.inviterHubId || null,
    resolvedAt: invite.resolvedAt || invite.respondedAt || null,
    resolvedBy: invite.resolvedBy || invite.responderPubkey || null,
    refs: {
      inviteId: invite.inviteId,
      groupId: invite.groupId || null,
      contractId: invite.contractId || null,
      inviteePubkey: invite.inviteePubkey || null,
      groupName,
      role,
      expiresAt: invite.expiresAt || null
    },
    dedupeKey: invite.inviteId
  });
}

/**
 * Inviter-side notice when a federation / multisig invite is accepted or declined.
 * @param {object} response
 * @param {object} [invite]
 * @param {string|null} [source]
 */
function entryFromFederationInviteDecision (response, invite = null, source = null) {
  if (!response || !response.inviteId) return null;
  const accepted = response.accept === true || response.status === 'accepted';
  const groupName = (invite && invite.groupName) || null;
  const role = invite && String(invite.role || 'signer').toLowerCase() === 'reader' ? 'reader' : 'signer';
  const who = response.responderPubkey || source || 'peer';
  return normalizeEntry({
    id: `inbox-fid-${response.inviteId}`,
    kind: 'FederationInviteDecision',
    status: accepted ? 'accepted' : 'rejected',
    actionable: false,
    ts: response.respondedAt || new Date().toISOString(),
    title: accepted
      ? (groupName ? `Invite accepted · ${groupName}` : 'Group invite accepted')
      : (groupName ? `Invite declined · ${groupName}` : 'Group invite declined'),
    body: role === 'signer'
      ? `Multisig signer response from ${String(who).slice(0, 16)}…`
      : `Response from ${String(who).slice(0, 16)}…`,
    source: who,
    resolvedAt: response.respondedAt || new Date().toISOString(),
    resolvedBy: who,
    refs: {
      inviteId: response.inviteId,
      groupId: (invite && invite.groupId) || null,
      contractId: (invite && invite.contractId) || null,
      role,
      accept: accepted
    },
    dedupeKey: `fid-${response.inviteId}`
  });
}

/**
 * Mission escrow / payout / group withdrawal events for the Notifications bell.
 * @param {object} opts
 * @param {string} opts.kind WalletEscrow | WalletPayout | WalletWithdrawal
 * @param {string} opts.title
 * @param {string} [opts.body]
 * @param {string} [opts.status] pending | info | accepted | rejected
 * @param {boolean} [opts.actionable]
 * @param {object} [opts.refs]
 * @param {string} [opts.dedupeKey]
 * @param {string} [opts.source]
 * @param {string} [opts.ts]
 */
function entryFromWalletEvent (opts = {}) {
  const kind = String(opts.kind || '').trim();
  if (!kind || !NOTIFICATION_KINDS.has(kind)) return null;
  const status = opts.status || (opts.actionable ? 'pending' : 'info');
  return normalizeEntry({
    id: opts.id || null,
    kind,
    status,
    actionable: opts.actionable === true,
    ts: opts.ts || new Date().toISOString(),
    title: opts.title || kind,
    body: opts.body != null ? String(opts.body) : null,
    source: opts.source || null,
    refs: Object.assign({}, opts.refs || {}),
    dedupeKey: opts.dedupeKey || `${kind}:${opts.title || ''}:${opts.ts || ''}`
  });
}

/**
 * Local tag create / member add / remove / delete.
 * @param {object} group
 * @param {string} action `create` | `add` | `remove` | `delete` | `rename`
 * @param {object} [member]
 * @param {string} [actor]
 * @returns {object|null}
 */
function entryFromLocalGroup (group, action, member, actor) {
  if (!group || !group.id) return null;
  let kind = 'LocalGroupCreate';
  let title = `Local tag: ${group.name}`;
  if (action === 'add') {
    kind = 'LocalGroupMemberAdd';
    title = `Added to ${group.name}`;
  } else if (action === 'remove') {
    kind = 'LocalGroupMemberRemove';
    title = `Removed from ${group.name}`;
  } else if (action === 'delete') {
    kind = 'LocalGroupDelete';
    title = `Deleted tag ${group.name}`;
  } else if (action === 'rename') {
    kind = 'LocalGroupRename';
    title = `Renamed tag ${group.name}`;
  }
  const who = member && (member.handle || member.actor);
  return normalizeEntry({
    kind,
    status: 'info',
    title,
    body: who || group.name,
    source: actor || null,
    handle: member && member.handle ? String(member.handle) : null,
    refs: {
      localGroupId: group.id,
      actor: member && member.actor ? member.actor : null
    },
    dedupeKey: `${kind}:${group.id}:${member && member.actor || ''}:${action}:${Date.now()}`
  });
}

/**
 * Local note create / update, or a share event.
 * @param {object} note
 * @param {string} action `create` | `update` | `share`
 * @param {string} [actor]
 * @returns {object|null}
 */
function entryFromIdentityNote (note, action, actor) {
  if (!note || !note.id) return null;
  let kind = 'IdentityNote';
  let title = `Note on ${note.subjectHandle || note.subject}`;
  if (action === 'update') {
    kind = 'IdentityNoteUpdate';
    title = `Updated note on ${note.subjectHandle || note.subject}`;
  } else if (action === 'share') {
    kind = 'NoteShare';
    const dest = note.visibility === 'group'
      ? (`group ${note.shareGroupId || ''}`)
      : (`peer ${String(note.sharePeerPubkey || '').slice(0, 8)}`);
    title = `Shared note (${dest})`;
  }
  return normalizeEntry({
    kind,
    status: 'info',
    actionable: action === 'share' && note.inbound === true,
    title,
    body: note.body,
    source: actor || note.author || null,
    handle: note.subjectHandle || null,
    refs: {
      noteId: note.id,
      subject: note.subject,
      scope: note.visibility,
      groupId: note.shareGroupId || null
    },
    dedupeKey: `${kind}:${note.id}:${action}:${note.revision || 1}:${note.updatedAt || ''}`
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
  if (store && refs.applicationId && String(refs.applicationId).indexOf('gapp') === 0) {
    const gapp = store.get('groupapplications', refs.applicationId);
    if (gapp) {
      if (!refs.groupId && gapp.groupId) refs.groupId = gapp.groupId;
      if (!refs.applicantId && gapp.applicantId) refs.applicantId = gapp.applicantId;
    }
  }
  if (store && refs.groupId) {
    const group = store.get('groups', refs.groupId);
    if (group) {
      if (!refs.groupName && group.name) refs.groupName = group.name;
      if (!refs.visibility && group.visibility) refs.visibility = group.visibility;
    }
  }
  entry.refs = refs;
  if (refs.groupName) {
    if (entry.kind === 'GroupApplication' &&
        (entry.title === 'Join request' || entry.title === 'Group join application')) {
      entry.title = `Join request · ${refs.groupName}`;
    } else if (entry.kind === 'GroupApplicationDecision') {
      if (entry.status === 'accepted' &&
          /^(Join accepted|Group join accepted)$/.test(entry.title || '')) {
        entry.title = `You're in · ${refs.groupName}`;
      } else if (entry.status === 'rejected' &&
          /^(Join declined|Group join rejected)$/.test(entry.title || '')) {
        entry.title = `Join declined · ${refs.groupName}`;
      }
    }
  }
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
  return rows.slice()
    .map((r) => enrichRefs(store, Object.assign({}, r, { refs: Object.assign({}, r.refs || {}) })))
    .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
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
  for (const p of store.all('groupchangeproposals') || []) {
    const e = entryFromGroupChangeProposal(p);
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
  entryFromGroupChangeProposal,
  entryFromFederationInvite,
  entryFromFederationInviteDecision,
  entryFromWalletEvent,
  entryFromLocalGroup,
  entryFromIdentityNote
};
