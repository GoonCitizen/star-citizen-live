'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../../types/Store');
const localDocuments = require('../../functions/localDocuments');
const documentBlobPrice = require('../../functions/documentBlobPrice');
const documentBlobPack = require('../../functions/documentBlobPack');
const documentOffers = require('../../functions/documentOffers');

const MIN = documentBlobPrice.HTLC_MINIMUM_SATS;

describe('documentBlobPrice', () => {
  it('floors paid prices at the mainnet HTLC minimum and scales with KiB', () => {
    assert.equal(MIN, 716);
    assert.equal(documentBlobPrice.listPriceSats(100, { satsPerKiB: 1, minSats: 25 }), MIN);
    assert.equal(documentBlobPrice.listPriceSats(1024 * 1024, { satsPerKiB: 1, minSats: 25 }), 1024);
    assert.equal(documentBlobPrice.listPriceSats(100 * 1024, { purchasePriceSats: 7, satsPerKiB: 1 }), MIN);
    assert.equal(documentBlobPrice.listPriceSats(100 * 1024, { purchasePriceSats: 0, satsPerKiB: 1 }), 0, 'free stays free');
    assert.equal(documentBlobPrice.listPriceSats(100, { satsPerKiB: 0, minSats: 0 }), 0);
  });

  it('gives every paid blob at least the HTLC minimum and sums to the total', () => {
    const blobs = [{ size: 800 }, { size: 200 }];
    const priced = documentBlobPrice.pricePackedDocument(blobs, 1000, { satsPerKiB: 1, minSats: 0 });
    assert.equal(priced.total, 2 * MIN);
    assert.deepEqual(priced.blobs, [MIN, MIN]);
    const big = documentBlobPrice.pricePackedDocument(blobs, 1000, { purchasePriceSats: 5000 });
    assert.equal(big.total, 5000);
    assert.equal(big.blobs.reduce((a, b) => a + b, 0), 5000);
    assert.ok(big.blobs.every((r) => r >= MIN));
    assert.ok(big.blobs[0] > big.blobs[1], 'remainder follows size');
    const free = documentBlobPrice.pricePackedDocument(blobs, 1000, { purchasePriceSats: 0 });
    assert.deepEqual(free.blobs, [0, 0]);
    const even = documentBlobPrice.allocateBlobRates(
      [{ size: 50 }, { size: 50 }, { size: 50 }],
      10
    );
    assert.equal(even.reduce((a, b) => a + b, 0), 10);
    assert.throws(() => documentBlobPrice.allocateBlobRates(blobs, MIN, MIN), /cannot give/);
  });
});

describe('documentBlobPack', () => {
  it('packs bytes into a Fabric DocumentBlobIndex with per-blob rateSats', () => {
    const buf = Buffer.alloc(8000, 0x61);
    const pack = documentBlobPack.packDocument(buf, {
      documentId: 'ab'.repeat(32),
      chunkBytes: 2048,
      policy: { satsPerKiB: 1, minSats: 0 }
    });
    assert.ok(pack.merkleRootHex);
    assert.match(pack.merkleRootHex, /^[0-9a-f]{64}$/);
    assert.ok(pack.blobTotal >= 2);
    assert.equal(pack.documentBlobIndex['@type'], 'DocumentBlobIndex');
    assert.equal(pack.purchasePriceSats, pack.blobTotal * MIN, '8 sats of content floors at MIN per blob');
    assert.equal(pack.blobs.reduce((a, b) => a + (b.rateSats || 0), 0), pack.purchasePriceSats);
    assert.ok(pack.blobs.every((b) => b.rateSats >= MIN));
    assert.ok(pack.blobs.every((b) => b.blobHashHex && b.size >= 0));
  });
});

describe('localDocuments publish blob pack', () => {
  it('stores the index on publish and advertises blobs on inventory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-blobpack-'));
    const store = new Store({ path: null });
    try {
      const src = path.join(dir, 'payload.bin');
      fs.writeFileSync(src, Buffer.alloc(50 * 1024, 7));
      const created = localDocuments.createFromFile(store, src, { name: 'payload.bin' }, { dir });
      const published = localDocuments.publish(store, created.id, {
        dir,
        policy: { satsPerKiB: 1, minSats: 0 }
      });
      assert.ok(published.merkleRootHex);
      assert.ok(published.blobTotal >= 2);
      assert.ok(Array.isArray(published.blobs) && published.blobs.length >= 2);
      const items = documentOffers.inventoryItemsFromLocal(
        localDocuments.list(store, { includeBlobIndex: true })
      );
      assert.equal(items.length, 1);
      assert.ok(items[0].blobs.length >= 2);
      assert.equal(items[0].rateSats, published.purchasePriceSats);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
