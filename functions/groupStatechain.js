'use strict';

/**
 * Group contract Statechain: append-only accepted-message journal + folded content.
 *
 * Persistence is via the GoonCitizen {@link Store} (collections), not Node `fs`,
 * so the same path works in memory (tests), LevelDB (desktop/relay), and any
 * future Store backend.
 *
 * Collection `groupsidechains` — one record per contract id:
 * `{ id, version, clock, content, journal: { entries }, name?, parentContractId? }`
 *
 * Each journal row may carry `fabricMessage: { hash, hex, type }` — the signed
 * AMP CONTRACT_MESSAGE that introduced it — so a newly connected peer can
 * request a {@link GroupJournalBatch} and replay bit-identical Fabric frames.
 *
 * Peers that apply the same genesis definition and accepted journal entries
 * converge on the same GoonCitizenGroupState (and thus stateDigest).
 */

const crypto = require('crypto');
const {
  GROUP_CONTRACT_NAME,
  normalizeProposedPolicy,
  canonicalizeValidators,
  isGroupContractDefinition,
  groupContractId
} = require('../contracts/gooncitizenGroup');
const { gooncitizenContractId } = require('../contracts/gooncitizen');

/** Store collection name for per-group Statechain documents. */
const COLLECTION = 'groupsidechains';

const JOURNAL_TYPES = Object.freeze([
  'GroupApplication',
  'GroupApplicationDecision',
  'GroupChange',
  'GroupChangeProposal',
  'GroupChangeVote',
  'FederationContractInviteResponse',
  'GroupActivityTree',
  'FleetShare'
]);

function normalizeContractId (contractId) {
  const id = String(contractId || '').trim().toLowerCase();
  if (!id || id.includes('/') || id.includes('..') || id.length > 128) {
    throw new Error('invalid contractId for group Statechain');
  }
  return id;
}

function createInitialState () {
  return { version: 1, clock: 0, content: {} };
}

function _canonicalStringify (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(_canonicalStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${_canonicalStringify(value[k])}`).join(',')}}`;
}

/**
 * Digest over version/clock/content (matches Hub / core sidechainState shape).
 * @param {{ version?: number, clock?: number, content?: object }} state
 * @returns {string}
 */
function stateDigest (state) {
  return crypto.createHash('sha256').update(_canonicalStringify({
    version: state && state.version != null ? Number(state.version) : 1,
    clock: Number(state && state.clock) || 0,
    content: (state && state.content) || {}
  })).digest('hex');
}

function namespaceHeadFromState (contractId, state, meta = {}) {
  const id = normalizeContractId(contractId);
  return {
    contractId: id,
    clock: Number(state && state.clock) || 0,
    stateDigest: stateDigest(state || createInitialState()),
    name: meta.name != null ? String(meta.name) : null,
    parentContractId: meta.parentContractId != null ? String(meta.parentContractId) : null
  };
}

/**
 * @param {{ get: Function, put: Function }} store
 * @param {string} contractId
 * @returns {object}
 */
function loadDoc (store, contractId) {
  if (!store || typeof store.get !== 'function' || typeof store.put !== 'function') {
    throw new TypeError('groupStatechain requires a Store (get/put)');
  }
  const id = normalizeContractId(contractId);
  const existing = store.get(COLLECTION, id);
  if (existing && typeof existing === 'object') {
    return {
      id,
      version: Number(existing.version) || 1,
      clock: Number(existing.clock) || 0,
      content: existing.content && typeof existing.content === 'object' ? existing.content : {},
      journal: {
        entries: Array.isArray(existing.journal && existing.journal.entries)
          ? existing.journal.entries
          : (Array.isArray(existing.entries) ? existing.entries : [])
      },
      name: existing.name != null ? existing.name : null,
      parentContractId: existing.parentContractId != null ? existing.parentContractId : null
    };
  }
  return {
    id,
    version: 1,
    clock: 0,
    content: {},
    journal: { entries: [] },
    name: null,
    parentContractId: null
  };
}

function persistDoc (store, doc) {
  const id = normalizeContractId(doc.id);
  const record = {
    id,
    version: doc.version != null ? Number(doc.version) : 1,
    clock: Number(doc.clock) || 0,
    content: doc.content && typeof doc.content === 'object' ? doc.content : {},
    journal: { entries: Array.isArray(doc.journal && doc.journal.entries) ? doc.journal.entries : [] },
    name: doc.name != null ? doc.name : null,
    parentContractId: doc.parentContractId != null ? doc.parentContractId : null
  };
  store.put(COLLECTION, id, record);
  return record;
}

function loadJournal (store, contractId) {
  return { entries: loadDoc(store, contractId).journal.entries.slice() };
}

function loadState (store, contractId) {
  const doc = loadDoc(store, contractId);
  return {
    version: doc.version,
    clock: doc.clock,
    content: doc.content
  };
}

function _sortMembers (members) {
  return canonicalizeValidators(members);
}

/**
 * Deterministic fold of genesis + accepted journal entries.
 * `members` = participant roster (chat / readers entitlement).
 * `signers` = spend / authz federation (proposedPolicy.validators).
 * Application accepts widen members only; GroupChange / invite role=signer
 * widen the signer set (default role is signer, matching GroupManager).
 *
 * @param {object} definition GoonCitizenGroup genesis
 * @param {object[]} entries Journal entries
 * @returns {object} GoonCitizenGroupState
 */
function foldGroupState (definition, entries = []) {
  if (!isGroupContractDefinition(definition)) {
    throw new Error('foldGroupState requires a GoonCitizenGroup definition');
  }
  const groupId = String(definition.groupId);
  const contractId = groupContractId(definition);
  const creator = String(definition.creator || '').toLowerCase();
  let signers = _sortMembers(
    (definition.proposedPolicy && definition.proposedPolicy.validators) || [creator]
  );
  if (!signers.includes(creator) && creator) signers = _sortMembers(signers.concat([creator]));
  let members = signers.slice();

  let meta = Object.assign({}, definition.meta || {});
  let threshold = (definition.proposedPolicy && definition.proposedPolicy.threshold) || 1;
  const applications = {};
  /** Latest published activity tree root under this group namespace (compact). */
  let activityTree = null;
  /** Fleet tips shared into this group (keyed by fleetId; latest journal wins). */
  const fleets = {};
  /** Pending / adopted GroupChangeProposal rows (non-roster until GroupChange). */
  const proposals = {};
  const seen = new Set();

  const list = (Array.isArray(entries) ? entries : []).slice().sort((a, b) => {
    const ca = Number(a.clock) || 0;
    const cb = Number(b.clock) || 0;
    if (ca !== cb) return ca - cb;
    return String(a.acceptedAt || '').localeCompare(String(b.acceptedAt || ''));
  });

  for (const entry of list) {
    const eid = entry && entry.id != null ? String(entry.id) : null;
    if (eid) {
      if (seen.has(eid)) continue;
      seen.add(eid);
    }
    const type = String(entry.type || '');
    const message = entry.message && typeof entry.message === 'object' ? entry.message : {};

    if (type === 'GroupApplication') {
      const id = message.id || eid;
      if (!id) continue;
      applications[id] = {
        id,
        groupId: message.groupId || groupId,
        applicantId: String(message.applicantId || '').toLowerCase(),
        message: message.message != null ? String(message.message) : '',
        status: message.status || 'pending',
        createdAt: message.createdAt || entry.acceptedAt || null
      };
    } else if (type === 'GroupApplicationDecision') {
      const id = message.applicationId || message.id || eid;
      if (!id) continue;
      const prev = applications[id] || {
        id,
        groupId,
        applicantId: String(message.applicantId || '').toLowerCase(),
        message: '',
        status: 'pending'
      };
      prev.status = message.decision === 'accept' || message.status === 'accepted'
        ? 'accepted'
        : (message.decision === 'reject' || message.status === 'rejected' ? 'rejected' : prev.status);
      if (message.reason != null) prev.reason = message.reason;
      prev.decidedBy = message.decidedBy || message.actor || null;
      prev.decidedAt = message.decidedAt || entry.acceptedAt || null;
      applications[id] = prev;
      // Accepted applicants join the participant roster only (not the signer set).
      if (prev.status === 'accepted' && prev.applicantId) {
        members = _sortMembers(members.concat([prev.applicantId]));
      }
    } else if (type === 'GroupChangeProposal') {
      const id = String(message.id || entry.id || '');
      if (id) {
        proposals[id] = {
          id,
          action: message.action || null,
          member: message.member || null,
          role: message.role || null,
          patch: message.patch || null,
          proposedBy: message.proposedBy || message.actor || null,
          createdAt: message.createdAt || entry.acceptedAt || null,
          threshold: Number(message.threshold) || threshold,
          status: message.status || 'pending',
          signatures: (message.signatures && typeof message.signatures === 'object')
            ? Object.assign({}, message.signatures)
            : {}
        };
      }
    } else if (type === 'GroupChangeVote') {
      const pid = String(message.proposalId || '');
      const voter = String(message.voter || '').toLowerCase();
      const sig = message.signature || null;
      if (pid && voter && proposals[pid] && proposals[pid].status === 'pending' && sig) {
        proposals[pid].signatures = Object.assign({}, proposals[pid].signatures || {}, { [voter]: sig });
      }
    } else if (type === 'GroupChange') {
      const action = String(message.action || '');
      const role = String(message.role || 'signer').toLowerCase() === 'reader' ? 'reader' : 'signer';
      if (message.proposalId && proposals[message.proposalId]) {
        proposals[message.proposalId].status = 'adopted';
        proposals[message.proposalId].adoptedChangeId = message.id || null;
      }
      if (action === 'member.add') {
        const pubkey = String(message.member || '').toLowerCase();
        if (pubkey) {
          members = _sortMembers(members.concat([pubkey]));
          if (role === 'signer') signers = _sortMembers(signers.concat([pubkey]));
        }
      } else if (action === 'member.remove') {
        const pubkey = String(message.member || '').toLowerCase();
        if (pubkey && pubkey !== creator) {
          members = members.filter((m) => m !== pubkey);
          signers = signers.filter((m) => m !== pubkey);
          threshold = Math.min(threshold, Math.max(1, signers.length));
        }
      } else if (action === 'update' && message.patch && typeof message.patch === 'object') {
        const patch = message.patch;
        if (patch.name !== undefined) meta.name = String(patch.name || meta.name);
        if (patch.threshold !== undefined) threshold = Number(patch.threshold) || threshold;
        if (patch.visibility === 'public' || patch.visibility === 'private') meta.visibility = patch.visibility;
        if (patch.slug !== undefined) meta.slug = patch.slug;
      }
    } else if (type === 'FederationContractInviteResponse') {
      if (message.accept && message.responderPubkey) {
        const pubkey = String(message.responderPubkey).toLowerCase();
        const role = String(message.role || 'signer').toLowerCase() === 'reader' ? 'reader' : 'signer';
        members = _sortMembers(members.concat([pubkey]));
        if (role === 'signer') signers = _sortMembers(signers.concat([pubkey]));
      }
    } else if (type === 'GroupActivityTree') {
      // Keep the newest publish (by journal clock order) as the group namespace tip.
      activityTree = {
        root: message.root || null,
        leafCount: Number(message.leafCount) || 0,
        ownerPubkey: message.ownerPubkey || null,
        generatedAt: message.generatedAt || entry.acceptedAt || null,
        counts: message.counts && typeof message.counts === 'object' ? message.counts : null
      };
    } else if (type === 'FleetShare') {
      const fleetId = String(message.fleetId || message.id || eid || '').trim();
      if (!fleetId) continue;
      fleets[fleetId] = {
        fleetId,
        name: message.name != null ? String(message.name) : null,
        ownerPubkey: message.ownerPubkey || null,
        shipCount: Number(message.shipCount) || 0,
        uniqueShips: Number(message.uniqueShips) || 0,
        ships: Array.isArray(message.ships) ? message.ships.slice(0, 200) : [],
        sharedAt: message.sharedAt || entry.acceptedAt || null,
        source: message.source || entry.source || null,
        visibility: message.visibility || 'groups'
      };
    }
  }

  threshold = Math.max(1, Math.min(threshold, signers.length || 1));
  const proposedPolicy = normalizeProposedPolicy({ validators: signers, threshold });

  return {
    '@type': 'GoonCitizenGroupState',
    groupId,
    contractId,
    meta,
    members: members.slice(),
    signers: signers.slice(),
    threshold,
    applications: Object.keys(applications).sort().reduce((acc, k) => {
      acc[k] = applications[k];
      return acc;
    }, {}),
    proposals: Object.keys(proposals).sort().reduce((acc, k) => {
      acc[k] = proposals[k];
      return acc;
    }, {}),
    proposedPolicy,
    activityTree,
    fleets: Object.keys(fleets).sort().reduce((acc, k) => {
      acc[k] = fleets[k];
      return acc;
    }, {})
  };
}

function stateDigestOfContent (content) {
  return crypto.createHash('sha256').update(_canonicalStringify(content || {})).digest('hex');
}

/**
 * Append an accepted journal entry (idempotent by id) and republish folded STATE.
 * @param {{ get: Function, put: Function }} store
 * @returns {{ appended: boolean, entry: object|null, state: object, head: object, content: object }}
 */
function appendAccepted (store, contractId, entry, definition, meta = {}) {
  if (!entry || entry.id == null) throw new Error('journal entry requires id');
  if (!JOURNAL_TYPES.includes(String(entry.type || ''))) {
    throw new Error(`unsupported journal type: ${entry.type}`);
  }
  if (!isGroupContractDefinition(definition)) {
    throw new Error('definition required');
  }

  const doc = loadDoc(store, contractId);
  const headMeta = {
    name: meta.name || doc.name || GROUP_CONTRACT_NAME,
    parentContractId: meta.parentContractId || doc.parentContractId || gooncitizenContractId()
  };
  doc.name = headMeta.name;
  doc.parentContractId = headMeta.parentContractId;

  const id = String(entry.id);
  if (doc.journal.entries.some((e) => e && String(e.id) === id)) {
    const content = foldGroupState(definition, doc.journal.entries);
    const state = { version: doc.version, clock: doc.clock, content: doc.content };
    return {
      appended: false,
      entry: null,
      state,
      head: namespaceHeadFromState(contractId, state, headMeta),
      content
    };
  }

  const clock = doc.journal.entries.length + 1;
  const row = {
    id,
    type: String(entry.type),
    clock,
    acceptedAt: entry.acceptedAt || new Date().toISOString(),
    message: entry.message && typeof entry.message === 'object' ? entry.message : {}
  };
  if (entry.fabricMessage && typeof entry.fabricMessage === 'object') {
    row.fabricMessage = {
      hash: entry.fabricMessage.hash != null ? String(entry.fabricMessage.hash) : null,
      hex: entry.fabricMessage.hex != null ? String(entry.fabricMessage.hex) : null,
      type: entry.fabricMessage.type != null ? String(entry.fabricMessage.type) : row.type
    };
  }
  doc.journal.entries.push(row);

  const content = foldGroupState(definition, doc.journal.entries);
  doc.version = 1;
  doc.clock = (Number(doc.clock) || 0) + 1;
  doc.content = content;
  persistDoc(store, doc);

  const state = { version: doc.version, clock: doc.clock, content: doc.content };
  return {
    appended: true,
    entry: row,
    state,
    head: namespaceHeadFromState(contractId, state, headMeta),
    content
  };
}

/**
 * Ensure document + publish current fold (e.g. after create with empty journal).
 * @param {{ get: Function, put: Function }} store
 */
function publishFoldedContent (store, contractId, definition, meta = {}) {
  if (!isGroupContractDefinition(definition)) {
    throw new Error('definition required');
  }
  const doc = loadDoc(store, contractId);
  const headMeta = {
    name: meta.name || doc.name || GROUP_CONTRACT_NAME,
    parentContractId: meta.parentContractId || doc.parentContractId || gooncitizenContractId()
  };
  const content = foldGroupState(definition, doc.journal.entries);
  doc.version = 1;
  doc.clock = (Number(doc.clock) || 0) + 1;
  doc.content = content;
  doc.name = headMeta.name;
  doc.parentContractId = headMeta.parentContractId;
  persistDoc(store, doc);

  const state = { version: doc.version, clock: doc.clock, content: doc.content };
  return {
    state,
    head: namespaceHeadFromState(contractId, state, headMeta),
    content
  };
}

/**
 * Attach (or refresh) the wire Fabric Message metadata on an existing journal row.
 * @param {{ get: Function, put: Function }} store
 * @param {string} contractId
 * @param {string} entryId
 * @param {{ hash?: string, hex?: string, type?: string }} fabricMessage
 * @returns {object|null} updated row
 */
function attachFabricMessage (store, contractId, entryId, fabricMessage) {
  if (!fabricMessage || typeof fabricMessage !== 'object') return null;
  const doc = loadDoc(store, contractId);
  const id = String(entryId || '');
  const row = doc.journal.entries.find((e) => e && String(e.id) === id);
  if (!row) return null;
  row.fabricMessage = {
    hash: fabricMessage.hash != null ? String(fabricMessage.hash) : (row.fabricMessage && row.fabricMessage.hash) || null,
    hex: fabricMessage.hex != null ? String(fabricMessage.hex) : (row.fabricMessage && row.fabricMessage.hex) || null,
    type: fabricMessage.type != null
      ? String(fabricMessage.type)
      : ((row.fabricMessage && row.fabricMessage.type) || row.type)
  };
  persistDoc(store, doc);
  return row;
}

/**
 * Journal entries at or after `fromClock` (inclusive), sorted by clock.
 * @param {{ get: Function, put: Function }} store
 * @param {string} contractId
 * @param {number} [fromClock=0]
 * @returns {object[]}
 */
function entriesFromClock (store, contractId, fromClock = 0) {
  const min = Math.max(0, Number(fromClock) || 0);
  const entries = loadDoc(store, contractId).journal.entries.slice();
  return entries
    .filter((e) => (Number(e.clock) || 0) >= min)
    .sort((a, b) => (Number(a.clock) || 0) - (Number(b.clock) || 0));
}

/**
 * Merge remote journal entries into the local Statechain (idempotent by id).
 * @param {{ get: Function, put: Function }} store
 * @param {string} contractId
 * @param {object[]} remoteEntries
 * @param {object} definition
 * @param {object} [meta]
 * @returns {{ applied: number, state: object, head: object, content: object }}
 */
function mergeJournalEntries (store, contractId, remoteEntries, definition, meta = {}) {
  if (!isGroupContractDefinition(definition)) {
    throw new Error('definition required');
  }
  let applied = 0;
  let last = null;
  const list = (Array.isArray(remoteEntries) ? remoteEntries : []).slice().sort((a, b) => {
    return (Number(a.clock) || 0) - (Number(b.clock) || 0);
  });
  for (const remote of list) {
    if (!remote || remote.id == null || !remote.type) continue;
    if (!JOURNAL_TYPES.includes(String(remote.type))) continue;
    last = appendAccepted(store, contractId, {
      id: remote.id,
      type: remote.type,
      acceptedAt: remote.acceptedAt,
      message: remote.message,
      fabricMessage: remote.fabricMessage || null
    }, definition, meta);
    if (last && last.appended) applied += 1;
  }
  if (!last) {
    const published = publishFoldedContent(store, contractId, definition, meta);
    return { applied: 0, state: published.state, head: published.head, content: published.content };
  }
  return {
    applied,
    state: last.state,
    head: last.head,
    content: last.content
  };
}

/**
 * Latest ContractStateTip fields + roster for tip-bound GroupChat sealing.
 * Uses the peer's folded journal content (members entitled at this tip).
 * @param {{ get: Function, put: Function }} store
 * @param {string} contractId
 * @param {object} definition
 * @returns {{ contractId: string, clock: number, stateDigest: string, memberPubkeys: string[] }}
 */
function tipForChatSeal (store, contractId, definition) {
  if (!isGroupContractDefinition(definition)) {
    throw new Error('tipForChatSeal requires a GoonCitizenGroup definition');
  }
  const id = normalizeContractId(contractId || groupContractId(definition));
  const doc = loadDoc(store, id);
  const content = foldGroupState(definition, doc.journal.entries);
  const state = {
    version: Number(doc.version) || 1,
    clock: Number(doc.clock) || 0,
    content
  };
  const head = namespaceHeadFromState(id, state);
  let members = Array.isArray(content.members) ? content.members.slice() : [];
  if (!members.length) {
    members = canonicalizeValidators(
      (definition.proposedPolicy && definition.proposedPolicy.validators) || []
    );
  }
  let signers = Array.isArray(content.signers) ? content.signers.slice() : [];
  if (!signers.length) {
    signers = canonicalizeValidators(
      (content.proposedPolicy && content.proposedPolicy.validators)
      || (definition.proposedPolicy && definition.proposedPolicy.validators)
      || []
    );
  }
  return {
    contractId: head.contractId,
    clock: head.clock,
    stateDigest: head.stateDigest,
    memberPubkeys: members,
    signerPubkeys: signers,
    threshold: content.threshold != null
      ? Number(content.threshold)
      : ((content.proposedPolicy && content.proposedPolicy.threshold) || 1)
  };
}

/**
 * Build a GroupJournalBatch object for mesh catch-up.
 * @param {{ get: Function, put: Function }} store
 * @param {string} contractId
 * @param {object} definition
 * @param {number} [fromClock=1]
 * @param {object} [meta]
 * @returns {object}
 */
function buildJournalBatch (store, contractId, definition, fromClock = 1, meta = {}) {
  if (!isGroupContractDefinition(definition)) {
    throw new Error('definition required');
  }
  const doc = loadDoc(store, contractId);
  const content = foldGroupState(definition, doc.journal.entries);
  const state = { version: doc.version, clock: doc.clock, content };
  const digest = stateDigestOfContent(content);
  const entries = entriesFromClock(store, contractId, fromClock);
  return {
    type: 'GroupJournalBatch',
    v: 1,
    contractId: normalizeContractId(contractId),
    groupId: String(definition.groupId),
    groupName: (definition.meta && definition.meta.name) || null,
    proposedPolicy: definition.proposedPolicy || null,
    fromClock: Math.max(0, Number(fromClock) || 0),
    tipClock: Number(state.clock) || 0,
    stateDigest: digest,
    entries,
    name: meta.name || doc.name || GROUP_CONTRACT_NAME,
    parentContractId: meta.parentContractId || doc.parentContractId || gooncitizenContractId()
  };
}

module.exports = {
  COLLECTION,
  JOURNAL_TYPES,
  normalizeContractId,
  createInitialState,
  stateDigest,
  namespaceHeadFromState,
  loadDoc,
  persistDoc,
  loadJournal,
  loadState,
  foldGroupState,
  stateDigestOfContent,
  appendAccepted,
  publishFoldedContent,
  attachFabricMessage,
  entriesFromClock,
  mergeJournalEntries,
  tipForChatSeal,
  buildJournalBatch
};
