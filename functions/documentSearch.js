'use strict';

/**
 * Catalog search / type criteria for Hub Document Exchange (Files tab).
 * Consolidates known Fabric document MIME families into filter chips.
 */

const FABRIC_BITCOIN_BLOCK_MIME = 'application/x-fabric-bitcoin-block+json';
const FABRIC_BITCOIN_TX_MIME = 'application/x-fabric-bitcoin-transaction+json';

/** @type {ReadonlyArray<[string, string]>} */
const DOCUMENT_TYPE_FILTERS = Object.freeze([
  ['all', 'All types'],
  ['text', 'Text'],
  ['image', 'Images'],
  ['json', 'JSON'],
  ['bitcoin-block', 'BTC blocks'],
  ['bitcoin-tx', 'BTC txs'],
  ['other', 'Other']
]);

/** @type {ReadonlyArray<[string, string]>} */
const DOCUMENT_STATUS_FILTERS = Object.freeze([
  ['all', 'Any status'],
  ['published', 'Published'],
  ['local', 'Local'],
  ['peers', 'From peers'],
  ['priced', 'Priced'],
  ['free', 'Free / unset']
]);

/**
 * @param {object} doc
 * @returns {string}
 */
function documentTypeKey (doc) {
  const mime = String((doc && doc.mime) || 'application/octet-stream').toLowerCase();
  if (mime === FABRIC_BITCOIN_BLOCK_MIME) return 'bitcoin-block';
  if (mime === FABRIC_BITCOIN_TX_MIME) return 'bitcoin-tx';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('text/')) return 'text';
  if (mime === 'application/json' ||
      (mime.startsWith('application/') && mime.endsWith('+json'))) {
    return 'json';
  }
  return 'other';
}

/**
 * @param {object} doc
 * @returns {string}
 */
function documentSearchHaystack (doc) {
  if (!doc || typeof doc !== 'object') return '';
  return [
    doc.name,
    doc.id,
    doc.sha256,
    doc.mime,
    doc.document,
    documentTypeKey(doc),
    doc.published ? 'published' : 'local',
    doc.local === false || doc.source === 'peer' ? 'peer peers' : '',
    doc.peerAlias,
    doc.peerPubkey,
    doc.peerAddress,
    doc.purchasePriceSats != null ? String(doc.purchasePriceSats) : ''
  ].filter((v) => v != null && v !== '').map(String).join(' ').toLowerCase();
}

/**
 * @param {string} [query]
 * @returns {string[]}
 */
function normalizeDocumentKeywords (query) {
  return String(query || '')
    .toLowerCase()
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {object} doc
 * @param {Object} [criteria]
 * @param {string} [criteria.query]
 * @param {string} [criteria.type] DOCUMENT_TYPE_FILTERS key (`all` = any)
 * @param {string} [criteria.status] DOCUMENT_STATUS_FILTERS key (`all` = any)
 * @returns {boolean}
 */
function documentMatchesCriteria (doc, criteria = {}) {
  if (!doc || typeof doc !== 'object') return false;
  const type = criteria.type && criteria.type !== 'all' ? String(criteria.type) : null;
  if (type && documentTypeKey(doc) !== type) return false;

  const status = criteria.status && criteria.status !== 'all' ? String(criteria.status) : null;
  if (status) {
    const published = !!(doc.published);
    const price = Number(doc.purchasePriceSats || 0);
    if (status === 'published' && !published) return false;
    if (status === 'local' && published) return false;
    if (status === 'peers' && !(doc.local === false || doc.source === 'peer')) return false;
    if (status === 'priced' && !(published && price > 0)) return false;
    if (status === 'free' && price > 0) return false;
  }

  const kws = normalizeDocumentKeywords(criteria.query);
  if (!kws.length) return true;
  const hay = documentSearchHaystack(doc);
  return kws.every((k) => hay.includes(k));
}

/**
 * @param {object[]} [documents]
 * @param {Object} [criteria]
 * @returns {object[]}
 */
function filterDocuments (documents, criteria = {}) {
  const rows = Array.isArray(documents) ? documents : [];
  return rows.filter((doc) => documentMatchesCriteria(doc, criteria));
}

/**
 * Count documents per type key (for chip badges).
 * @param {object[]} [documents]
 * @returns {Object.<string, number>}
 */
function documentTypeCounts (documents) {
  /** @type {Object.<string, number>} */
  const counts = {};
  DOCUMENT_TYPE_FILTERS.forEach(([key]) => { counts[key] = 0; });
  const rows = Array.isArray(documents) ? documents : [];
  counts.all = rows.length;
  for (const doc of rows) {
    const key = documentTypeKey(doc);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

module.exports = {
  FABRIC_BITCOIN_BLOCK_MIME,
  FABRIC_BITCOIN_TX_MIME,
  DOCUMENT_TYPE_FILTERS,
  DOCUMENT_STATUS_FILTERS,
  documentTypeKey,
  documentSearchHaystack,
  normalizeDocumentKeywords,
  documentMatchesCriteria,
  filterDocuments,
  documentTypeCounts
};
