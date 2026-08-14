'use strict';

/**
 * Pack a catalog file into Fabric AMP-sized blobs (`DocumentBlobIndex`) so
 * large installers travel as `P2P_FILE_SEND` frames, not one JSON body.
 * Per-blob `rateSats` follow {@link documentBlobPrice} (size-proportional).
 */

const documentBlobPrice = require('./documentBlobPrice');

function loadManifest () {
  return require('@fabric/core/functions/documentBlobManifest');
}

/**
 * @param {Buffer} buffer
 * @param {Object} [opts]
 * @param {string} [opts.documentId]
 * @param {number} [opts.chunkBytes]
 * @param {object} [opts.policy]
 * @returns {object} metadata stored on the catalog row (no content bytes)
 */
function packDocument (buffer, opts = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer == null ? '' : buffer);
  const manifest = loadManifest();
  const documentId = opts.documentId != null ? String(opts.documentId) : undefined;
  const split = manifest.splitBlobs(buf, opts.chunkBytes, documentId);
  const priced = documentBlobPrice.pricePackedDocument(split.blobs, buf.length, opts.policy || {});
  const itemBlobs = split.blobs.map((b, i) => {
    const row = {
      index: b.index,
      total: b.total,
      blobHashHex: b.blobHashHex,
      size: b.size,
      rateSats: priced.blobs[i]
    };
    if (documentId && typeof manifest.blobPaymentHashHex === 'function') {
      row.contentHash = manifest.blobPaymentHashHex({
        documentId,
        blobIndex: b.index,
        blobHashHex: b.blobHashHex
      });
    }
    return row;
  });
  let index = manifest.buildBlobIndex({
    documentId,
    merkleRootHex: split.merkleRootHex,
    contentSha256: split.contentSha256,
    chunkBytes: split.chunkBytes,
    blobs: itemBlobs
  });
  if (typeof manifest.compactBlobIndexForWire === 'function') {
    index = manifest.compactBlobIndexForWire(index);
  }
  const blobs = index.leavesInline === false ? itemBlobs : (index.blobs || itemBlobs);
  return {
    merkleRootHex: split.merkleRootHex,
    contentSha256: split.contentSha256,
    chunkBytes: split.chunkBytes,
    blobTotal: split.blobs.length,
    purchasePriceSats: priced.total,
    rateSats: priced.total,
    satsPerByte: priced.satsPerByte,
    documentBlobIndex: index,
    blobs
  };
}

function tryPackDocument (buffer, opts = {}) {
  try {
    return packDocument(buffer, opts);
  } catch (e) {
    const policy = opts.policy || {};
    const total = documentBlobPrice.listPriceSats(
      Buffer.isBuffer(buffer) ? buffer.length : 0,
      policy
    );
    return {
      purchasePriceSats: total,
      rateSats: total,
      packError: (e && e.message) || String(e)
    };
  }
}

module.exports = {
  packDocument,
  tryPackDocument
};
