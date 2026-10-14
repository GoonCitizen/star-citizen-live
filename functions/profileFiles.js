'use strict';

/**
 * Opt-in published-file listing on a profile.
 *
 * Compact catalog metadata (no blob bytes) for GroupDataShare `profile.files`.
 * Operators pin individual files to their profile (📌); only those rows gossip.
 * Peers see the listing the same way they see `profile.playtimes` — not this
 * node's Files tab painted onto someone else's handle.
 */

const COLLECTION = 'datasync';
const PACK = 'profile.files';
const MAX_FILES = 48;
const NAME_MAX = 128;

function isoNow (value) {
  if (value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function filesRecordId (pubkey) {
  const id = String(pubkey || '').trim();
  return id ? (PACK + ':' + id) : null;
}

function isPubkey (value) {
  const s = String(value || '').trim();
  return /^(?:0[23][0-9a-fA-F]{64}|[0-9a-fA-F]{64})$/.test(s);
}

function sanitizeName (value) {
  const s = String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, NAME_MAX);
  return s || 'file';
}

function fileHref (id) {
  const s = String(id || '').trim();
  return s ? ('/files/' + encodeURIComponent(s)) : null;
}

function isPinnedRow (row) {
  return !!(row && (row.profilePinned === true || row.pinned === true));
}

const APPLICATION_EXT = /\.(dmg|pkg|exe|msi|appimage|deb|rpm|apk|aab)$/i;
const APPLICATION_ZIP = /(setup|installer|desktop|gooncitizen|win64|macos|linux|arm64).*\.zip$/i;

/**
 * Classify a profile listing as a desktop/mobile application vs a generic file.
 * Used so publisher profiles can list org-leader desktops without a second catalog.
 * @param {object|string} [row]
 * @returns {'application'|'file'}
 */
function classifyProfileFileKind (row) {
  const name = sanitizeName(typeof row === 'string' ? row : (row && row.name));
  if (APPLICATION_EXT.test(name) || APPLICATION_ZIP.test(name)) return 'application';
  if (row && typeof row === 'object') {
    const existing = String(row.kind || '').trim().toLowerCase();
    if (existing === 'application' || existing === 'file') return existing;
  }
  return 'file';
}

function compactFileRow (row) {
  if (!row || typeof row !== 'object') return null;
  if (row.published === false) return null;
  const id = String(row.id || row.sha256 || '').trim().toLowerCase();
  if (!/^[0-9a-f]{16,128}$/.test(id)) return null;
  const size = row.size != null ? Math.max(0, Math.floor(Number(row.size) || 0)) : null;
  const out = {
    id,
    sha256: String(row.sha256 || id).trim().toLowerCase(),
    name: sanitizeName(row.name),
    mime: String(row.mime || 'application/octet-stream').slice(0, 128),
    size,
    href: fileHref(id),
    kind: classifyProfileFileKind(row),
    purchasePriceSats: Math.max(0, Math.floor(Number(row.purchasePriceSats) || 0))
  };
  if (row.rateSats != null) out.rateSats = Math.max(0, Math.floor(Number(row.rateSats) || 0));
  if (row.satsPerByte != null && Number.isFinite(Number(row.satsPerByte))) {
    out.satsPerByte = Number(row.satsPerByte);
  }
  if (row.merkleRootHex) out.merkleRootHex = String(row.merkleRootHex).toLowerCase();
  if (row.blobTotal != null) out.blobTotal = Math.max(0, Math.floor(Number(row.blobTotal) || 0));
  if (row.chunkBytes != null) out.chunkBytes = Math.max(0, Math.floor(Number(row.chunkBytes) || 0));
  if (row.created) out.created = isoNow(row.created);
  if (isPubkey(row.publisher)) out.publisher = String(row.publisher).trim();
  return out;
}

/**
 * Compact payload for a GroupDataShare pack. Listing metadata only — never
 * documentBlobIndex, blobs[], or content bytes.
 * @param {object} opts
 * @param {string} opts.pubkey
 * @param {Array<object>} [opts.files]
 * @param {boolean} [opts.pinnedOnly] When true, skip rows that are not pinned.
 * @param {string} [opts.generatedAt]
 * @returns {object|null}
 */
function compactFilesPayload (opts = {}) {
  const pubkey = String(opts.pubkey || '').trim();
  if (!isPubkey(pubkey)) return null;
  const raw = Array.isArray(opts.files) ? opts.files : [];
  const pinnedOnly = opts.pinnedOnly === true;
  const files = [];
  let eligible = 0;
  for (const row of raw) {
    if (pinnedOnly && !isPinnedRow(row)) continue;
    const compact = compactFileRow(row);
    if (!compact) continue;
    compact.publisher = pubkey;
    eligible += 1;
    if (files.length < MAX_FILES) files.push(compact);
  }
  if (!files.length) return null;
  return {
    pubkey,
    files,
    truncated: eligible > files.length,
    generatedAt: isoNow(opts.generatedAt)
  };
}

/**
 * @param {object} payload
 * @param {object} [meta]
 * @returns {object|null}
 */
function sanitizeFilesPayload (payload, meta = {}) {
  if (!payload || typeof payload !== 'object') return null;
  return compactFilesPayload({
    pubkey: payload.pubkey || meta.pubkey,
    files: payload.files || payload.documents,
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
 * Persist a peer's shared file listing.
 * @param {object} store
 * @param {object} payload
 * @param {object} [meta]
 * @returns {object|null}
 */
function foldFiles (store, payload, meta = {}) {
  if (!store) return null;
  const clean = sanitizeFilesPayload(payload, meta);
  if (!clean) return null;
  const id = filesRecordId(clean.pubkey);
  const prev = store.get(COLLECTION, id);
  const row = {
    id,
    kind: PACK,
    pack: PACK,
    pubkey: clean.pubkey,
    files: clean.files,
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
function loadFiles (store, pubkey) {
  if (!store) return null;
  const id = filesRecordId(pubkey);
  return id ? (store.get(COLLECTION, id) || null) : null;
}

/**
 * @param {object} store
 * @returns {object[]}
 */
function loadAllFiles (store) {
  if (!store) return [];
  return (store.all(COLLECTION) || []).filter((row) => row && row.pack === PACK && row.pubkey);
}

/**
 * Find a file listing by id across local catalog + gossiped profile packs.
 * @param {object} opts
 * @param {object} [opts.local]
 * @param {Array<object>} [opts.shared]
 * @param {string} documentId
 * @returns {object|null}
 */
function findListedFile (opts, documentId) {
  const id = String(documentId || '').trim().toLowerCase();
  if (!id) return null;
  const local = opts && opts.local;
  if (local && (String(local.id || '').toLowerCase() === id ||
      String(local.sha256 || '').toLowerCase() === id)) {
    return { file: compactFileRow(local) || local, local: true, publisher: null };
  }
  for (const pack of (opts && opts.shared) || []) {
    if (!pack || !Array.isArray(pack.files)) continue;
    const hit = pack.files.find((f) => f && (
      String(f.id || '').toLowerCase() === id ||
      String(f.sha256 || '').toLowerCase() === id
    ));
    if (hit) {
      return {
        file: compactFileRow(hit) || hit,
        local: false,
        publisher: pack.pubkey || null
      };
    }
  }
  return null;
}

module.exports = {
  COLLECTION,
  PACK,
  MAX_FILES,
  filesRecordId,
  fileHref,
  isPinnedRow,
  classifyProfileFileKind,
  compactFileRow,
  compactFilesPayload,
  sanitizeFilesPayload,
  foldFiles,
  loadFiles,
  loadAllFiles,
  findListedFile
};
