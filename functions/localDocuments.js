'use strict';

/**
 * This node's document catalog — metadata in the Fabric Store `documents`
 * collection, bytes beside the named store root (`stores/gooncitizen/documents/`).
 * Every GoonCitizen node owns its own catalog; do not proxy hub.fabric.pub.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const COLLECTION = 'documents';
const MAX_BYTES = 8 * 1024 * 1024;
/** Disk-backed blobs (installers / APKs). In-store base64 still uses MAX_BYTES. */
const MAX_BLOB_BYTES = 512 * 1024 * 1024;

function sha256Hex (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function documentsDir (storeRoot) {
  if (!storeRoot) return null;
  return path.join(String(storeRoot), 'documents');
}

function blobPath (dir, id) {
  return path.join(dir, String(id) + '.bin');
}

function publicMeta (row, opts = {}) {
  if (!row || typeof row !== 'object') return null;
  const out = {
    id: row.id,
    sha256: row.sha256 || row.id,
    name: row.name || 'upload',
    mime: row.mime || 'application/octet-stream',
    size: row.size != null ? Number(row.size) : null,
    created: row.created || null,
    published: row.published === true,
    profilePinned: row.profilePinned === true,
    purchasePriceSats: Math.max(0, Math.floor(Number(row.purchasePriceSats) || 0)),
    local: true
  };
  if (row.author) out.author = String(row.author);
  if (row.edited) out.edited = row.edited;
  if (row.rateSats != null) out.rateSats = Math.max(0, Math.floor(Number(row.rateSats) || 0));
  if (row.satsPerByte != null && Number.isFinite(Number(row.satsPerByte))) {
    out.satsPerByte = Number(row.satsPerByte);
  }
  if (row.merkleRootHex) out.merkleRootHex = String(row.merkleRootHex);
  if (row.blobTotal != null) out.blobTotal = Number(row.blobTotal);
  if (row.chunkBytes != null) out.chunkBytes = Number(row.chunkBytes);
  if (opts.includeBlobIndex) {
    if (row.documentBlobIndex) out.documentBlobIndex = row.documentBlobIndex;
    if (Array.isArray(row.blobs)) out.blobs = row.blobs;
  }
  return out;
}

function list (store, opts = {}) {
  if (!store || typeof store.all !== 'function') return [];
  return store.all(COLLECTION)
    .map((row) => publicMeta(row, opts))
    .filter(Boolean)
    .sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
}

function readBuffer (row, dir) {
  if (dir && row && row.file) {
    const file = path.join(dir, String(row.file));
    if (fs.existsSync(file)) return fs.readFileSync(file);
  }
  if (row && row.contentBase64) {
    return Buffer.from(String(row.contentBase64), 'base64');
  }
  return null;
}

function get (store, documentId, opts = {}) {
  const id = String(documentId || '').trim();
  if (!id) {
    const err = new Error('documentId required');
    err.status = 400;
    throw err;
  }
  if (!store || typeof store.get !== 'function') {
    const err = new Error('document store unavailable');
    err.status = 503;
    throw err;
  }
  const row = store.get(COLLECTION, id);
  if (!row) {
    const err = new Error('document not found');
    err.status = 404;
    throw err;
  }
  const meta = publicMeta(row, { includeBlobIndex: true });
  if (opts.includeContent === false) return { document: meta };
  const buf = readBuffer(row, opts.dir || null);
  if (buf) meta.contentBase64 = buf.toString('base64');
  return { document: meta };
}

/**
 * @param {object} store
 * @param {object} doc
 * @param {string} [doc.name]
 * @param {string} [doc.mime]
 * @param {string} doc.contentBase64
 * @param {number} [doc.size]
 * @param {string} [doc.author]
 * @param {Object} [opts]
 * @param {string|null} [opts.dir] Blob directory (null = keep base64 in the Store)
 * @returns {object} public metadata
 */
function create (store, doc = {}, opts = {}) {
  if (!store || typeof store.put !== 'function') {
    const err = new Error('document store unavailable');
    err.status = 503;
    throw err;
  }
  const contentBase64 = String(doc.contentBase64 || '').trim();
  if (!contentBase64) {
    const err = new Error('contentBase64 required');
    err.status = 400;
    throw err;
  }
  const buffer = Buffer.from(contentBase64, 'base64');
  return createFromBuffer(store, buffer, doc, opts);
}

/**
 * @param {object} store
 * @param {Buffer} buffer
 * @param {object} [doc]
 * @param {Object} [opts]
 * @param {string|null} [opts.dir]
 * @returns {object}
 */
function createFromBuffer (store, buffer, doc = {}, opts = {}) {
  if (!store || typeof store.put !== 'function') {
    const err = new Error('document store unavailable');
    err.status = 503;
    throw err;
  }
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    const err = new Error('contentBase64 required');
    err.status = 400;
    throw err;
  }
  const dir = opts.dir || null;
  const limit = dir ? MAX_BLOB_BYTES : MAX_BYTES;
  if (buffer.length > limit) {
    const err = new Error('document exceeds ' + limit + ' bytes');
    err.status = 400;
    throw err;
  }
  const sha256 = sha256Hex(buffer);
  const id = sha256;
  const now = new Date().toISOString();
  const existing = store.get(COLLECTION, id);
  if (existing) return publicMeta(existing);

  const name = doc.name ? String(doc.name).slice(0, 256) : 'upload';
  const mime = doc.mime ? String(doc.mime).slice(0, 128) : 'application/octet-stream';
  const record = {
    id,
    sha256,
    name,
    mime,
    size: buffer.length,
    created: now,
    edited: now,
    published: false,
    purchasePriceSats: 0,
    local: true
  };
  if (doc.author) record.author = String(doc.author);

  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    const file = id + '.bin';
    fs.writeFileSync(blobPath(dir, id), buffer);
    record.file = file;
  } else {
    record.contentBase64 = buffer.toString('base64');
  }

  store.put(COLLECTION, id, record);
  return publicMeta(record);
}

/**
 * @param {object} store
 * @param {string} filePath
 * @param {object} [doc]
 * @param {Object} [opts]
 * @returns {object}
 */
function createFromFile (store, filePath, doc = {}, opts = {}) {
  const abs = path.resolve(String(filePath || ''));
  let st;
  try {
    st = fs.statSync(abs);
  } catch (_) {
    const err = new Error('file not found');
    err.status = 404;
    throw err;
  }
  if (!st.isFile()) {
    const err = new Error('filePath must be a file');
    err.status = 400;
    throw err;
  }
  const buffer = fs.readFileSync(abs);
  const name = doc.name || path.basename(abs);
  return createFromBuffer(store, buffer, Object.assign({}, doc, { name }), opts);
}

function publish (store, documentId, opts = {}) {
  const id = String(documentId || '').trim();
  if (!id) {
    const err = new Error('document id required');
    err.status = 400;
    throw err;
  }
  if (!store || typeof store.get !== 'function') {
    const err = new Error('document store unavailable');
    err.status = 503;
    throw err;
  }
  const row = store.get(COLLECTION, id);
  if (!row) {
    const err = new Error('document not found');
    err.status = 404;
    throw err;
  }
  const dir = opts.dir != null ? opts.dir : null;
  const buffer = readBuffer(row, dir);
  const documentBlobPack = require('./documentBlobPack');
  const documentBlobPrice = require('./documentBlobPrice');
  const policy = opts.policy || opts;
  let pack = null;
  if (buffer) {
    pack = documentBlobPack.tryPackDocument(buffer, { documentId: id, policy });
  }
  const purchasePriceSats = pack && pack.purchasePriceSats != null
    ? pack.purchasePriceSats
    : documentBlobPrice.listPriceSats(row.size, policy);
  const next = Object.assign({}, row, {
    published: true,
    purchasePriceSats,
    rateSats: pack && pack.rateSats != null ? pack.rateSats : purchasePriceSats,
    edited: new Date().toISOString()
  });
  if (pack && pack.merkleRootHex) {
    next.merkleRootHex = pack.merkleRootHex;
    next.contentSha256 = pack.contentSha256;
    next.chunkBytes = pack.chunkBytes;
    next.blobTotal = pack.blobTotal;
    next.satsPerByte = pack.satsPerByte;
    next.documentBlobIndex = pack.documentBlobIndex;
    next.blobs = pack.blobs;
  }
  store.put(COLLECTION, id, next);
  return publicMeta(next, { includeBlobIndex: true });
}

/**
 * Pin or unpin a catalog row on the operator profile. Pinning publishes the
 * file if needed so the listing has merkle/price metadata (still no bytes).
 * @param {object} store
 * @param {string} documentId
 * @param {boolean} pinned
 * @param {object} [opts]
 * @returns {object}
 */
function setProfilePinned (store, documentId, pinned, opts = {}) {
  const id = String(documentId || '').trim();
  if (!id) {
    const err = new Error('document id required');
    err.status = 400;
    throw err;
  }
  if (!store || typeof store.get !== 'function') {
    const err = new Error('document store unavailable');
    err.status = 503;
    throw err;
  }
  let row = store.get(COLLECTION, id);
  if (!row) {
    const err = new Error('document not found');
    err.status = 404;
    throw err;
  }
  if (pinned === true && row.published !== true) {
    publish(store, id, opts);
    row = store.get(COLLECTION, id) || row;
  }
  const next = Object.assign({}, row, {
    profilePinned: pinned === true,
    edited: new Date().toISOString()
  });
  store.put(COLLECTION, id, next);
  return publicMeta(next, { includeBlobIndex: true });
}

module.exports = {
  COLLECTION,
  MAX_BYTES,
  MAX_BLOB_BYTES,
  documentsDir,
  publicMeta,
  list,
  get,
  create,
  createFromBuffer,
  createFromFile,
  publish,
  setProfilePinned
};
