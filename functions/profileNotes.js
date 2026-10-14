'use strict';

/**
 * Opt-in public notes on a profile.
 *
 * Compact IdentityNote listings (no private share targets) for GroupDataShare
 * `profile.notes`. Operators pin individual notes (📌) onto a subject's
 * profile for Federation warnings / comments. Peers see the listing the same
 * way they see `profile.files` — not this node's private note list painted
 * onto someone else's handle.
 */

const identityNotes = require('./identityNotes');

const COLLECTION = 'datasync';
const PACK = 'profile.notes';
const MAX_NOTES = 48;

function isoNow (value) {
  if (value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function notesRecordId (pubkey) {
  const id = String(pubkey || '').trim();
  return id ? (PACK + ':' + id) : null;
}

function isPubkey (value) {
  const s = String(value || '').trim();
  return /^(?:0[23][0-9a-fA-F]{64}|[0-9a-fA-F]{64})$/.test(s);
}

function isPinnedRow (row) {
  return !!(row && (row.profilePinned === true || row.pinned === true));
}

/**
 * Public listing row — body + subject, never sharePeerPubkey.
 * @param {object} row
 * @param {string} [authorPubkey]
 * @returns {object|null}
 */
function compactNoteRow (row, authorPubkey) {
  const n = identityNotes.sanitizeNote(row);
  if (!n) return null;
  const author = isPubkey(authorPubkey) ? String(authorPubkey).trim() : n.author;
  return {
    id: n.id,
    subject: n.subject,
    subjectHandle: n.subjectHandle,
    body: n.body,
    author,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    revision: n.revision,
    profilePinned: true
  };
}

/**
 * Compact payload for a GroupDataShare pack. Author-keyed listing of notes
 * this operator pinned onto subject profiles.
 * @param {object} opts
 * @param {string} opts.pubkey
 * @param {Array<object>} [opts.notes]
 * @param {boolean} [opts.pinnedOnly] When true, skip rows that are not pinned.
 * @param {string} [opts.generatedAt]
 * @returns {object|null}
 */
function compactNotesPayload (opts = {}) {
  const pubkey = String(opts.pubkey || '').trim();
  if (!isPubkey(pubkey)) return null;
  const raw = Array.isArray(opts.notes) ? opts.notes : [];
  const pinnedOnly = opts.pinnedOnly === true;
  const notes = [];
  let eligible = 0;
  for (const row of raw) {
    if (pinnedOnly && !isPinnedRow(row)) continue;
    const compact = compactNoteRow(row, pubkey);
    if (!compact) continue;
    eligible += 1;
    if (notes.length < MAX_NOTES) notes.push(compact);
  }
  if (!notes.length) return null;
  return {
    pubkey,
    notes,
    truncated: eligible > notes.length,
    generatedAt: isoNow(opts.generatedAt)
  };
}

/**
 * @param {object} payload
 * @param {object} [meta]
 * @returns {object|null}
 */
function sanitizeNotesPayload (payload, meta = {}) {
  if (!payload || typeof payload !== 'object') return null;
  return compactNotesPayload({
    pubkey: payload.pubkey || meta.pubkey,
    notes: payload.notes,
    generatedAt: payload.generatedAt || meta.observedAt
  });
}

function mergeSources (prev, next) {
  const list = Array.isArray(prev) ? prev.slice() : [];
  if (!next || !next.via) return list.slice(-8);
  const via = String(next.via);
  const pubkey = next.pubkey ? String(next.pubkey) : null;
  const groupId = next.groupId ? String(next.groupId) : null;
  const observedAt = isoNow(next.observedAt);
  const idx = list.findIndex((s) => s && s.via === via &&
    String(s.pubkey || '') === String(pubkey || '') &&
    String(s.groupId || '') === String(groupId || ''));
  const row = { via, pubkey, groupId, observedAt };
  if (idx >= 0) list[idx] = row;
  else list.push(row);
  return list.slice(-8);
}

/**
 * Persist a peer's shared public-note listing.
 * @param {object} store
 * @param {object} payload
 * @param {object} [meta]
 * @returns {object|null}
 */
function foldNotes (store, payload, meta = {}) {
  if (!store) return null;
  const clean = sanitizeNotesPayload(payload, meta);
  if (!clean) return null;
  const id = notesRecordId(clean.pubkey);
  const prev = store.get(COLLECTION, id);
  const row = {
    id,
    kind: PACK,
    pack: PACK,
    pubkey: clean.pubkey,
    notes: clean.notes,
    truncated: clean.truncated === true,
    generatedAt: clean.generatedAt,
    updatedAt: isoNow(meta.observedAt || clean.generatedAt),
    groupId: meta.groupId || (prev && prev.groupId) || null,
    sources: mergeSources(prev && prev.sources, {
      via: meta.via || 'gossip',
      pubkey: meta.pubkey || null,
      groupId: meta.groupId || null,
      observedAt: meta.observedAt
    })
  };
  store.put(COLLECTION, id, row);
  return row;
}

/**
 * @param {object} store
 * @param {string} pubkey
 * @returns {object|null}
 */
function loadNotes (store, pubkey) {
  if (!store) return null;
  const id = notesRecordId(pubkey);
  return id ? (store.get(COLLECTION, id) || null) : null;
}

/**
 * @param {object} store
 * @returns {object[]}
 */
function loadAllNotes (store) {
  if (!store) return [];
  return (store.all(COLLECTION) || []).filter((row) => row && row.pack === PACK && row.pubkey);
}

/**
 * Merge local pinned notes with gossiped packs for a set of subject keys.
 * Higher revision wins.
 * @param {object} opts
 * @param {Array<object>} [opts.local]
 * @param {Array<object>} [opts.shared]
 * @param {Set<string>|string[]} [opts.subjects]
 * @returns {object[]}
 */
function notesForSubjects (opts = {}) {
  const subjects = opts.subjects instanceof Set
    ? opts.subjects
    : new Set((opts.subjects || []).filter(Boolean).map((s) => String(s)));
  const byId = new Map();
  function consider (row) {
    if (!row || !row.id) return;
    if (subjects.size && !subjects.has(String(row.subject))) return;
    const prev = byId.get(row.id);
    if (!prev || Number(row.revision || 0) >= Number(prev.revision || 0)) {
      byId.set(row.id, compactNoteRow(row) || row);
    }
  }
  for (const row of opts.local || []) consider(row);
  for (const pack of opts.shared || []) {
    for (const row of (pack && pack.notes) || []) consider(row);
  }
  return [...byId.values()].sort((a, b) =>
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

module.exports = {
  COLLECTION,
  PACK,
  MAX_NOTES,
  notesRecordId,
  isPinnedRow,
  compactNoteRow,
  compactNotesPayload,
  sanitizeNotesPayload,
  foldNotes,
  loadNotes,
  loadAllNotes,
  notesForSubjects
};
