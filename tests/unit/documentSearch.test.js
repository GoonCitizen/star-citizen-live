'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  FABRIC_BITCOIN_BLOCK_MIME,
  FABRIC_BITCOIN_TX_MIME,
  documentTypeKey,
  filterDocuments,
  documentTypeCounts,
  documentMatchesCriteria
} = require('../../functions/documentSearch');

describe('documentSearch', () => {
  const docs = [
    { id: 'a1', name: 'ops.txt', mime: 'text/plain', published: true, purchasePriceSats: 25 },
    { id: 'a2', name: 'shot.png', mime: 'image/png', published: false },
    { id: 'a3', name: 'block-100', mime: FABRIC_BITCOIN_BLOCK_MIME, published: true, purchasePriceSats: 10 },
    { id: 'a4', name: 'tx-abc', mime: FABRIC_BITCOIN_TX_MIME, published: true, purchasePriceSats: 0 },
    { id: 'a5', name: 'manifest.json', mime: 'application/json', published: true, purchasePriceSats: 0 }
  ];

  it('classifies Fabric and common MIME families', () => {
    assert.strictEqual(documentTypeKey(docs[0]), 'text');
    assert.strictEqual(documentTypeKey(docs[1]), 'image');
    assert.strictEqual(documentTypeKey(docs[2]), 'bitcoin-block');
    assert.strictEqual(documentTypeKey(docs[3]), 'bitcoin-tx');
    assert.strictEqual(documentTypeKey(docs[4]), 'json');
  });

  it('filters by type, status, and multi-keyword query', () => {
    assert.strictEqual(filterDocuments(docs, { type: 'bitcoin-block' }).length, 1);
    assert.strictEqual(filterDocuments(docs, { status: 'local' }).length, 1);
    assert.strictEqual(filterDocuments(docs, { status: 'priced' }).length, 2);
    assert.strictEqual(filterDocuments(docs, { query: 'ops text' }).length, 1);
    assert.ok(documentMatchesCriteria(docs[2], { query: 'block', type: 'bitcoin-block', status: 'published' }));
    assert.ok(!documentMatchesCriteria(docs[2], { type: 'text' }));
    const peerDoc = { id: 'p1', name: 'brief.txt', mime: 'text/plain', published: true, local: false, source: 'peer', peerAlias: 'Wing' };
    assert.strictEqual(filterDocuments(docs.concat([peerDoc]), { status: 'peers' }).length, 1);
    assert.ok(documentMatchesCriteria(peerDoc, { query: 'wing' }));
  });

  it('counts types for chip badges', () => {
    const counts = documentTypeCounts(docs);
    assert.strictEqual(counts.all, 5);
    assert.strictEqual(counts.text, 1);
    assert.strictEqual(counts['bitcoin-block'], 1);
    assert.strictEqual(counts.json, 1);
  });
});
