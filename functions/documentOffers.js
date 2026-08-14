'use strict';

/**
 * Peer document offers — Fabric `P2P_INVENTORY_REQUEST` / `P2P_INVENTORY_RESPONSE`
 * listings keyed by content id (sha256) + peer.
 *
 * Local catalog remains `functions/localDocuments.js`. This collection only
 * stores *remote* published inventory rows (no blobs).
 */

const COLLECTION = 'documentoffers';

function normalizeDocumentId (value) {
  const s = String(value || '').trim().toLowerCase();
  return s || null;
}

function peerKeyFromHex (value) {
  const h = String(value || '').trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(h) || /^0[23][0-9a-f]{64}$/.test(h)) return h;
  return null;
}

function peerKey (peer = {}) {
  return peerKeyFromHex(peer.peerPubkey)
    || (peer.peerAddress ? String(peer.peerAddress).trim().toLowerCase() : null)
    || 'unknown';
}

function offerRecordId (documentId, key) {
  return String(documentId) + ':' + String(key);
}

function priceSats (row) {
  if (!row || typeof row !== 'object') return Number.POSITIVE_INFINITY;
  const raw = row.purchasePriceSats != null ? row.purchasePriceSats : row.rateSats;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return Number.POSITIVE_INFINITY;
  return Math.floor(n);
}

function formatPrice (row) {
  const n = priceSats(row);
  if (!Number.isFinite(n)) return 'unset';
  if (n === 0) return 'free';
  return n.toLocaleString() + ' sats';
}

function peerLabel (row) {
  if (!row || typeof row !== 'object') return 'peer';
  if (row.local === true) return row.peerAlias || 'this node';
  if (row.peerAlias) return String(row.peerAlias);
  const pk = row.peerPubkey ? String(row.peerPubkey) : '';
  if (pk.length > 12) return pk.slice(0, 8) + '…' + pk.slice(-4);
  if (pk) return pk;
  return row.peerAddress ? String(row.peerAddress) : 'peer';
}

/**
 * Published local catalog rows → Fabric inventory `items`.
 * @param {object[]} docs
 * @returns {object[]}
 */
function inventoryItemsFromLocal (docs) {
  return (Array.isArray(docs) ? docs : [])
    .filter((d) => d && d.published === true && d.local !== false)
    .map((d) => {
      const purchasePriceSats = Math.max(0, Math.floor(Number(
        d.purchasePriceSats != null ? d.purchasePriceSats : d.rateSats
      ) || 0));
      const item = {
        id: d.id,
        sha256: d.sha256 || d.id,
        name: d.name || 'document',
        mime: d.mime || 'application/octet-stream',
        size: d.size != null ? Number(d.size) : null,
        purchasePriceSats,
        rateSats: Math.max(0, Math.floor(Number(d.rateSats != null ? d.rateSats : purchasePriceSats) || 0)),
        published: true,
        sealed: d.sealed === true
      };
      if (d.merkleRootHex) item.merkleRootHex = String(d.merkleRootHex);
      if (d.blobTotal != null) item.blobTotal = Number(d.blobTotal);
      if (d.chunkBytes != null) item.chunkBytes = Number(d.chunkBytes);
      if (d.documentBlobIndex) item.documentBlobIndex = d.documentBlobIndex;
      if (Array.isArray(d.blobs) && d.blobs.length) item.blobs = d.blobs;
      return item;
    });
}

function itemsFromInventoryMessage (message) {
  const obj = (message && (message.object || message)) || {};
  const items = obj.items || obj.documents || obj.inventory;
  return Array.isArray(items) ? items : [];
}

function normalizeInventoryItem (item, peer = {}) {
  if (!item || typeof item !== 'object') return null;
  const documentId = normalizeDocumentId(
    item.id || item.documentId || item.sha256 || item.contentHashHex || item.contentHash
  );
  if (!documentId) return null;
  const key = peerKey(peer);
  const raw = item.purchasePriceSats != null ? item.purchasePriceSats : item.rateSats;
  const purchasePriceSats = Number.isFinite(Number(raw))
    ? Math.max(0, Math.floor(Number(raw)))
    : 0;
  const name = item.name
    ? String(item.name).slice(0, 256)
    : (item.id ? String(item.id).slice(0, 64) : 'document');
  return {
    id: offerRecordId(documentId, key),
    documentId,
    sha256: normalizeDocumentId(item.sha256 || item.contentHashHex || item.contentHash) || documentId,
    name,
    mime: item.mime ? String(item.mime).slice(0, 128) : 'application/octet-stream',
    size: item.size != null && Number.isFinite(Number(item.size)) ? Number(item.size) : null,
    purchasePriceSats,
    peerPubkey: peerKeyFromHex(peer.peerPubkey),
    peerAddress: peer.peerAddress ? String(peer.peerAddress) : null,
    peerAlias: peer.peerAlias ? String(peer.peerAlias) : null,
    merkleRootHex: item.merkleRootHex ? String(item.merkleRootHex) : null,
    blobTotal: item.blobTotal != null ? Number(item.blobTotal) : null,
    chunkBytes: item.chunkBytes != null ? Number(item.chunkBytes) : null,
    blobs: Array.isArray(item.blobs) ? item.blobs : null,
    documentBlobIndex: item.documentBlobIndex && typeof item.documentBlobIndex === 'object'
      ? item.documentBlobIndex
      : null,
    receivedAt: new Date().toISOString(),
    local: false
  };
}

function list (store) {
  if (!store || typeof store.all !== 'function') return [];
  return store.all(COLLECTION).filter(Boolean);
}

/**
 * Replace every stored offer from one peer with a fresh inventory snapshot.
 * @param {object} store
 * @param {object} peer
 * @param {object[]} items
 * @returns {object[]}
 */
function replacePeerOffers (store, peer, items) {
  if (!store || typeof store.put !== 'function') return [];
  const key = peerKey(peer);
  for (const row of list(store)) {
    const rowKey = peerKey({
      peerPubkey: row.peerPubkey,
      peerAddress: row.peerAddress
    });
    if (rowKey === key) store.del(COLLECTION, row.id);
  }
  const saved = [];
  for (const item of (Array.isArray(items) ? items : [])) {
    const rec = normalizeInventoryItem(item, peer);
    if (!rec) continue;
    store.put(COLLECTION, rec.id, rec);
    saved.push(rec);
  }
  return saved;
}

function localOffer (doc, self = {}) {
  if (!doc) return null;
  const documentId = normalizeDocumentId(doc.id || doc.sha256);
  if (!documentId) return null;
  return {
    id: offerRecordId(documentId, 'local'),
    documentId,
    sha256: doc.sha256 || documentId,
    name: doc.name || 'document',
    mime: doc.mime || 'application/octet-stream',
    size: doc.size != null ? Number(doc.size) : null,
    purchasePriceSats: Math.max(0, Math.floor(Number(doc.purchasePriceSats) || 0)),
    peerPubkey: peerKeyFromHex(self.peerPubkey),
    peerAlias: self.peerAlias || 'this node',
    peerAddress: null,
    local: true,
    published: doc.published === true
  };
}

function sortOffersByPrice (offers) {
  return (Array.isArray(offers) ? offers.slice() : []).sort((a, b) => {
    const pa = priceSats(a);
    const pb = priceSats(b);
    if (pa !== pb) return pa - pb;
    const la = a.local === true ? 0 : 1;
    const lb = b.local === true ? 0 : 1;
    if (la !== lb) return la - lb;
    return String(a.peerPubkey || a.peerAddress || '')
      .localeCompare(String(b.peerPubkey || b.peerAddress || ''));
  });
}

function enrichAlias (offer, aliases) {
  if (!offer || offer.peerAlias || !offer.peerPubkey || !aliases) return offer;
  const alias = aliases[offer.peerPubkey] || aliases[String(offer.peerPubkey).toLowerCase()];
  if (!alias) return offer;
  return Object.assign({}, offer, { peerAlias: alias });
}

/**
 * Local listing plus remote offers for one document id, cheapest first.
 * @param {Object} opts
 * @param {object} [opts.store]
 * @param {string} opts.documentId
 * @param {object|null} [opts.localDoc]
 * @param {object} [opts.self]
 * @param {Object.<string, string>} [opts.aliases]
 * @returns {object[]}
 */
function offersForDocument (opts = {}) {
  const documentId = normalizeDocumentId(opts.documentId);
  if (!documentId) return [];
  const remotes = list(opts.store)
    .filter((o) => o.documentId === documentId || o.sha256 === documentId)
    .map((o) => enrichAlias(o, opts.aliases));
  const offers = remotes.slice();
  const local = opts.localDoc ? localOffer(opts.localDoc, opts.self || {}) : null;
  if (local) offers.push(local);
  return sortOffersByPrice(offers);
}

function catalogRowFromOffers (documentId, group) {
  const sorted = sortOffersByPrice(group);
  const best = sorted[0] || {};
  return {
    id: documentId,
    sha256: best.sha256 || documentId,
    name: best.name || 'document',
    mime: best.mime || 'application/octet-stream',
    size: best.size != null ? best.size : null,
    purchasePriceSats: Number.isFinite(priceSats(best)) ? priceSats(best) : 0,
    published: true,
    local: false,
    source: 'peer',
    created: best.receivedAt || null,
    offerCount: group.length,
    peerCount: group.length,
    peerPubkey: best.peerPubkey || null,
    peerAlias: best.peerAlias || null,
    peerAddress: best.peerAddress || null
  };
}

/**
 * Merge this node's catalog with remote inventory rows (one row per file id).
 * @param {object[]} localDocs
 * @param {object[]} offers
 * @param {Object} [opts]
 * @returns {object[]}
 */
function mergeCatalog (localDocs, offers, opts = {}) {
  const byId = new Map();
  for (const doc of (Array.isArray(localDocs) ? localDocs : [])) {
    if (!doc || !doc.id) continue;
    byId.set(String(doc.id).toLowerCase(), Object.assign({}, doc, {
      local: true,
      source: 'local'
    }));
  }
  const groups = new Map();
  for (const offer of (Array.isArray(offers) ? offers : [])) {
    const id = normalizeDocumentId(offer.documentId || offer.sha256);
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(enrichAlias(offer, opts.aliases));
  }
  for (const [id, group] of groups) {
    const existing = byId.get(id);
    if (existing) {
      existing.peerCount = group.length;
      existing.offerCount = group.length + 1;
      const best = sortOffersByPrice(group.concat([localOffer(existing, opts.self || {})]))[0];
      existing.bestPriceSats = Number.isFinite(priceSats(best))
        ? priceSats(best)
        : existing.purchasePriceSats;
    } else {
      byId.set(id, catalogRowFromOffers(id, group));
    }
  }
  return Array.from(byId.values()).sort((a, b) => {
    return String(b.created || '').localeCompare(String(a.created || ''));
  });
}

function remoteDocument (store, documentId, opts = {}) {
  const offers = offersForDocument({
    store,
    documentId,
    aliases: opts.aliases
  }).filter((o) => o.local !== true);
  if (!offers.length) return null;
  const best = offers[0];
  return {
    document: {
      id: best.documentId,
      sha256: best.sha256,
      name: best.name,
      mime: best.mime,
      size: best.size,
      purchasePriceSats: best.purchasePriceSats,
      published: true,
      local: false,
      peerPubkey: best.peerPubkey,
      peerAlias: best.peerAlias,
      peerAddress: best.peerAddress
    }
  };
}

function replyInventory (peer, originName, items, opts = {}) {
  if (!peer || !originName) return false;
  const rows = Array.isArray(items) ? items : [];
  if (typeof peer._sendLocalInventoryDocumentsWireResponse !== 'function') return false;
  return peer._sendLocalInventoryDocumentsWireResponse(String(originName), rows, {
    allowEmpty: opts.allowEmpty !== false
  });
}

function requestConnectedInventories (peer) {
  if (!peer || typeof peer.requestPeerInventory !== 'function') {
    return { requested: 0, peers: [] };
  }
  const addrs = Object.keys(peer.connections || {});
  const peers = [];
  for (const addr of addrs) {
    const conn = peer.connections[addr];
    if (!conn || typeof conn._writeFabric !== 'function') continue;
    try {
      if (peer.requestPeerInventory(addr, { kind: 'documents' })) peers.push(addr);
    } catch (_) { /* skip broken sockets */ }
  }
  return { requested: peers.length, peers };
}

module.exports = {
  COLLECTION,
  normalizeDocumentId,
  peerKeyFromHex,
  priceSats,
  formatPrice,
  peerLabel,
  inventoryItemsFromLocal,
  itemsFromInventoryMessage,
  normalizeInventoryItem,
  list,
  replacePeerOffers,
  localOffer,
  sortOffersByPrice,
  offersForDocument,
  mergeCatalog,
  remoteDocument,
  replyInventory,
  requestConnectedInventories
};
