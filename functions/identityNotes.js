'use strict';

/**
 * Operator notes on an arbitrary identity (`discord:<id>` or Fabric pubkey).
 * Private on this node until shared with a Federation group or a peer.
 */

const crypto = require('crypto');
const { canonicalActor, sanitizeHandle } = require('./localGroups');

const TYPE = 'IdentityNote';
const SHARE_TYPE = 'NoteShare';
const UPDATE_TYPE = 'NoteUpdate';
const COLLECTION = 'identitynotes';
const BODY_MAX = 2000;
const NOTES_MAX = 2000;

function sha256Hex (s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function fail (message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function sanitizeBody (value) {
  return String(value == null ? '' : value).trim().slice(0, BODY_MAX);
}

/**
 * @param {object} row
 * @returns {object|null}
 */
function sanitizeNote (row) {
  if (!row || typeof row !== 'object') return null;
  const id = String(row.id || '').trim();
  const subject = canonicalActor(row.subject);
  const body = sanitizeBody(row.body);
  if (!id || !subject || !body) return null;
  const visibility = row.visibility === 'group' || row.visibility === 'peer'
    ? row.visibility
    : 'private';
  return {
    '@type': TYPE,
    id,
    subject,
    subjectHandle: sanitizeHandle(row.subjectHandle),
    body,
    author: row.author != null ? String(row.author) : 'local',
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || row.createdAt || null,
    revision: Math.max(1, Number(row.revision) || 1),
    visibility,
    shareGroupId: row.shareGroupId ? String(row.shareGroupId) : null,
    sharePeerPubkey: row.sharePeerPubkey ? String(row.sharePeerPubkey) : null,
    sharedAt: row.sharedAt || null,
    inbound: row.inbound === true,
    profilePinned: row.profilePinned === true || row.pinned === true
  };
}

/**
 * @param {object} store
 * @param {object} [opts]
 * @param {*} [opts.subject]
 * @param {string} [opts.viewer]
 * @param {boolean} [opts.enforcePrivacy]
 * @param {string} [opts.author]
 * @param {boolean} [opts.includeLocal]
 * @param {boolean} [opts.profilePinned]
 * @param {string[]} [opts.groupIds]
 * @returns {object[]}
 */
function listNotes (store, opts = {}) {
  if (!store) return [];
  const subject = opts.subject ? canonicalActor(opts.subject) : null;
  let rows = (store.all(COLLECTION) || []).map(sanitizeNote).filter(Boolean);
  if (subject) rows = rows.filter((n) => n.subject === subject);
  if (opts.author) {
    const author = canonicalActor(opts.author) || String(opts.author);
    rows = rows.filter((n) => n.author === author ||
      (opts.includeLocal === true && n.author === 'local'));
  }
  if (opts.profilePinned === true) {
    rows = rows.filter((n) => n.profilePinned === true);
  }
  if (opts.enforcePrivacy) {
    if (!opts.viewer) return [];
    rows = rows.filter((n) => noteVisibleTo(n, opts.viewer, opts.groupIds));
  }
  return rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

/**
 * Whether a viewer may read this identity note.
 * @param {object|null} note
 * @param {string|null} viewer
 * @param {string[]|Set<string>} [groupIds]
 * @returns {boolean}
 */
function noteVisibleTo (note, viewer, groupIds) {
  if (!note || typeof note !== 'object') return false;
  const who = canonicalActor(viewer) || (viewer != null ? String(viewer).trim() : '');
  if (!who) return false;
  const author = canonicalActor(note.author) || String(note.author || '');
  if (author === who) return true;
  const groups = groupIds instanceof Set ? groupIds : new Set(groupIds || []);
  if (note.visibility === 'group' && note.shareGroupId && groups.has(note.shareGroupId)) {
    return true;
  }
  if (note.visibility === 'peer' && note.sharePeerPubkey) {
    const peer = canonicalActor(note.sharePeerPubkey) || String(note.sharePeerPubkey);
    if (peer === who) return true;
  }
  return false;
}

/**
 * @param {object} store
 * @param {string} id
 * @returns {object|null}
 */
function getNote (store, id) {
  if (!store || !id) return null;
  return sanitizeNote(store.get(COLLECTION, String(id)));
}

/**
 * @param {object} store
 * @param {object} opts
 * @param {*} opts.subject
 * @param {string} opts.body
 * @param {string} [opts.author]
 * @param {string} [opts.handle]
 * @returns {object}
 */
function createNote (store, opts = {}) {
  if (!store) throw fail('Store required', 'UNAVAILABLE');
  if (listNotes(store).length >= NOTES_MAX) throw fail('Too many notes', 'LIMIT');
  const subject = canonicalActor(opts.subject);
  if (!subject) throw fail('subject required (discord:<id> or Fabric pubkey)', 'BAD_REQUEST');
  const body = sanitizeBody(opts.body);
  if (!body) throw fail('body required', 'BAD_REQUEST');
  const now = new Date().toISOString();
  const author = canonicalActor(opts.author) || (opts.author ? String(opts.author) : 'local');
  const id = 'note-' + sha256Hex(author + ':' + subject + ':' + now + ':' + crypto.randomBytes(8).toString('hex')).slice(0, 16);
  const note = {
    '@type': TYPE,
    id,
    subject,
    subjectHandle: sanitizeHandle(opts.handle || opts.subjectHandle),
    body,
    author,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    visibility: 'private',
    shareGroupId: null,
    sharePeerPubkey: null,
    sharedAt: null,
    inbound: false,
    profilePinned: false
  };
  store.put(COLLECTION, id, note);
  return note;
}

/**
 * @param {object} store
 * @param {string} id
 * @param {object} opts
 * @param {string} [opts.body]
 * @param {string} [opts.handle]
 * @returns {object}
 */
function updateNote (store, id, opts = {}) {
  const note = getNote(store, id);
  if (!note) throw fail('Note not found', 'NOT_FOUND');
  const body = opts.body != null ? sanitizeBody(opts.body) : note.body;
  if (!body) throw fail('body required', 'BAD_REQUEST');
  note.body = body;
  if (opts.handle != null) note.subjectHandle = sanitizeHandle(opts.handle);
  note.updatedAt = new Date().toISOString();
  note.revision = (Number(note.revision) || 1) + 1;
  store.put(COLLECTION, note.id, note);
  return note;
}

/**
 * @param {object} store
 * @param {string} id
 * @param {object} opts
 * @param {string} opts.scope `group` or `peer`
 * @param {string} [opts.groupId]
 * @param {string} [opts.peerPubkey]
 * @returns {object}
 */
function markShared (store, id, opts = {}) {
  const note = getNote(store, id);
  if (!note) throw fail('Note not found', 'NOT_FOUND');
  const scope = opts.scope === 'group' || opts.scope === 'peer' ? opts.scope : null;
  if (!scope) throw fail('scope must be group or peer', 'BAD_REQUEST');
  if (scope === 'group') {
    const groupId = String(opts.groupId || '').trim();
    if (!groupId) throw fail('groupId required', 'BAD_REQUEST');
    note.visibility = 'group';
    note.shareGroupId = groupId;
    note.sharePeerPubkey = null;
  } else {
    const peer = canonicalActor(opts.peerPubkey);
    if (!peer || String(peer).indexOf('discord:') === 0) {
      throw fail('peerPubkey required (Fabric pubkey)', 'BAD_REQUEST');
    }
    note.visibility = 'peer';
    note.sharePeerPubkey = peer;
    note.shareGroupId = null;
  }
  note.sharedAt = new Date().toISOString();
  note.updatedAt = note.sharedAt;
  store.put(COLLECTION, note.id, note);
  return note;
}

/**
 * Pin (or unpin) a note onto the subject's public profile wall.
 * Does not change visibility — GroupDataShare `profile.notes` carries pins.
 * @param {object} store
 * @param {string} id
 * @param {boolean} pinned
 * @returns {object}
 */
function setProfilePinned (store, id, pinned) {
  const note = getNote(store, id);
  if (!note) throw fail('Note not found', 'NOT_FOUND');
  note.profilePinned = pinned === true;
  note.updatedAt = new Date().toISOString();
  note.revision = (Number(note.revision) || 1) + 1;
  store.put(COLLECTION, note.id, note);
  return note;
}

/**
 * Wire payload for NoteShare / NoteUpdate (not frozen into genesis messageTypes).
 * @param {object} note
 * @param {object} [opts]
 * @param {boolean} [opts.update]
 * @param {string} [opts.scope]
 * @param {string} [opts.groupId]
 * @param {string} [opts.peerPubkey]
 * @param {string} [opts.author]
 * @returns {object}
 */
function buildSharePayload (note, opts = {}) {
  const scope = opts.scope || note.visibility;
  const update = opts.update === true || (Number(note.revision) || 1) > 1;
  const type = update ? UPDATE_TYPE : SHARE_TYPE;
  const payload = {
    type,
    '@type': type,
    noteId: note.id,
    subject: note.subject,
    subjectHandle: note.subjectHandle,
    body: note.body,
    author: opts.author || note.author,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    revision: note.revision,
    scope
  };
  if (scope === 'group') payload.groupId = opts.groupId || note.shareGroupId;
  if (scope === 'peer') {
    payload.peerA = canonicalActor(opts.author || note.author) || opts.author || note.author;
    payload.peerB = canonicalActor(opts.peerPubkey || note.sharePeerPubkey) ||
      opts.peerPubkey || note.sharePeerPubkey;
  }
  return payload;
}

/**
 * Upsert a note received from a peer or group share. Higher revision wins.
 * @param {object} store
 * @param {object} object
 * @param {string} [source]
 * @returns {object|null}
 */
function ingestShare (store, object, source) {
  if (!store) return null;
  const raw = object && object.object != null ? object.object : object;
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.noteId || raw.id || '').trim();
  const subject = canonicalActor(raw.subject);
  const body = sanitizeBody(raw.body);
  if (!id || !subject || !body) return null;
  const revision = Math.max(1, Number(raw.revision) || 1);
  const prev = getNote(store, id);
  if (prev && Number(prev.revision || 0) > revision) return prev;
  if (prev && Number(prev.revision || 0) === revision && prev.body === body) return prev;
  const now = new Date().toISOString();
  const scope = raw.scope === 'group' || raw.scope === 'peer' ? raw.scope : 'peer';
  const author = canonicalActor(raw.author) || canonicalActor(source) ||
    String(raw.author || source || 'peer');
  const note = {
    '@type': TYPE,
    id,
    subject,
    subjectHandle: sanitizeHandle(raw.subjectHandle),
    body,
    author,
    createdAt: raw.createdAt || (prev && prev.createdAt) || now,
    updatedAt: raw.updatedAt || now,
    revision,
    visibility: scope,
    shareGroupId: raw.groupId ? String(raw.groupId) : (prev && prev.shareGroupId) || null,
    sharePeerPubkey: raw.peerB || raw.peerPubkey || (prev && prev.sharePeerPubkey) || null,
    sharedAt: now,
    inbound: true,
    profilePinned: prev && prev.profilePinned === true
  };
  store.put(COLLECTION, id, note);
  return note;
}

module.exports = {
  TYPE,
  SHARE_TYPE,
  UPDATE_TYPE,
  COLLECTION,
  BODY_MAX,
  sanitizeNote,
  noteVisibleTo,
  listNotes,
  getNote,
  createNote,
  updateNote,
  markShared,
  setProfilePinned,
  buildSharePayload,
  ingestShare
};
