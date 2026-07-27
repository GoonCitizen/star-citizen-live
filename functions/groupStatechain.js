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
  'FederationContractInviteResponse'
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
  let members = _sortMembers(
    (definition.proposedPolicy && definition.proposedPolicy.validators) || [creator]
  );
  if (!members.includes(creator) && creator) members = _sortMembers(members.concat([creator]));

  let meta = Object.assign({}, definition.meta || {});
  let threshold = (definition.proposedPolicy && definition.proposedPolicy.threshold) || 1;
  const applications = {};
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
      if (prev.status === 'accepted' && prev.applicantId) {
        members = _sortMembers(members.concat([prev.applicantId]));
      }
    } else if (type === 'GroupChange') {
      const action = String(message.action || '');
      if (action === 'member.add') {
        const pubkey = String(message.member || '').toLowerCase();
        if (pubkey) members = _sortMembers(members.concat([pubkey]));
      } else if (action === 'member.remove') {
        const pubkey = String(message.member || '').toLowerCase();
        if (pubkey && pubkey !== creator) {
          members = members.filter((m) => m !== pubkey);
          threshold = Math.min(threshold, Math.max(1, members.length));
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
        members = _sortMembers(members.concat([String(message.responderPubkey).toLowerCase()]));
      }
    }
  }

  threshold = Math.max(1, Math.min(threshold, members.length || 1));
  const proposedPolicy = normalizeProposedPolicy({ validators: members, threshold });

  return {
    '@type': 'GoonCitizenGroupState',
    groupId,
    contractId,
    meta,
    members: members.slice(),
    applications: Object.keys(applications).sort().reduce((acc, k) => {
      acc[k] = applications[k];
      return acc;
    }, {}),
    proposedPolicy
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
  publishFoldedContent
};
