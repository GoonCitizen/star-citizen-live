'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { Store } = require('../../types/Store');
const documentOffers = require('../../functions/documentOffers');

describe('documentOffers', () => {
  it('sorts offers by price (free first) then local', () => {
    const sorted = documentOffers.sortOffersByPrice([
      { purchasePriceSats: 40, peerPubkey: '02bb' },
      { purchasePriceSats: 0, peerPubkey: '02aa', local: true },
      { purchasePriceSats: 10, peerPubkey: '02cc' },
      { rateSats: 10, peerPubkey: '02dd' }
    ]);
    assert.strictEqual(sorted[0].peerPubkey, '02aa');
    assert.strictEqual(sorted[1].peerPubkey, '02cc');
    assert.strictEqual(sorted[2].peerPubkey, '02dd');
    assert.strictEqual(sorted[3].peerPubkey, '02bb');
  });

  it('replaces a peer snapshot and merges catalog with cheapest remote', () => {
    const store = new Store({ path: null });
    const peerA = { peerPubkey: '02' + 'aa'.repeat(32), peerAlias: 'Wing' };
    const peerB = { peerPubkey: '02' + 'bb'.repeat(32), peerAlias: 'Ops' };
    const fileId = 'ab'.repeat(32);
    documentOffers.replacePeerOffers(store, peerA, [{
      id: fileId,
      name: 'brief.txt',
      mime: 'text/plain',
      purchasePriceSats: 25,
      size: 12
    }]);
    documentOffers.replacePeerOffers(store, peerB, [{
      id: fileId,
      name: 'brief.txt',
      mime: 'text/plain',
      rateSats: 10,
      size: 12
    }]);
    documentOffers.replacePeerOffers(store, peerA, []);
    const offers = documentOffers.offersForDocument({ store, documentId: fileId });
    assert.strictEqual(offers.length, 1);
    assert.strictEqual(offers[0].peerAlias, 'Ops');
    assert.strictEqual(offers[0].purchasePriceSats, 10);

    const catalog = documentOffers.mergeCatalog([], documentOffers.list(store));
    assert.strictEqual(catalog.length, 1);
    assert.strictEqual(catalog[0].local, false);
    assert.strictEqual(catalog[0].purchasePriceSats, 10);
    assert.ok(catalog[0].peerAlias === 'Ops');
  });

  it('builds inventory items from published local docs only', () => {
    const items = documentOffers.inventoryItemsFromLocal([
      { id: 'aa', published: true, name: 'a.txt', mime: 'text/plain', purchasePriceSats: 5 },
      { id: 'bb', published: false, name: 'b.txt', mime: 'text/plain' }
    ]);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].id, 'aa');
    assert.strictEqual(items[0].purchasePriceSats, 5);
  });

  it('requestConnectedInventories calls requestPeerInventory per live socket', () => {
    const asked = [];
    const peer = {
      connections: {
        '127.0.0.1:9': { _writeFabric: () => {} },
        dead: {}
      },
      requestPeerInventory (addr, opts) {
        asked.push({ addr, opts });
        return true;
      }
    };
    const out = documentOffers.requestConnectedInventories(peer);
    assert.strictEqual(out.requested, 1);
    assert.deepStrictEqual(out.peers, ['127.0.0.1:9']);
    assert.strictEqual(asked[0].opts.kind, 'documents');
  });

  it('parses inventory GenericMessage items and ignores empty snapshots', () => {
    const id = 'ef'.repeat(32);
    const items = documentOffers.itemsFromInventoryMessage({
      object: { kind: 'documents', items: [{ id, name: 'a.txt', purchasePriceSats: 9 }] }
    });
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].id, id);
    assert.deepStrictEqual(documentOffers.itemsFromInventoryMessage(null), []);
  });

  it('does not advertise remote-only catalog rows as local inventory items', () => {
    const store = new Store({ path: null });
    const fileId = '11'.repeat(32);
    documentOffers.replacePeerOffers(store, {
      peerPubkey: '02' + 'cc'.repeat(32),
      peerAlias: 'Relay'
    }, [{ id: fileId, name: 'ghost.txt', purchasePriceSats: 8 }]);
    const local = [
      { id: 'aa', published: true, name: 'mine.txt', mime: 'text/plain', purchasePriceSats: 5 },
      { id: fileId, published: true, local: false, name: 'ghost.txt', purchasePriceSats: 8 }
    ];
    const items = documentOffers.inventoryItemsFromLocal(local);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].id, 'aa');
    const merged = documentOffers.mergeCatalog(
      local.filter((d) => d.published === true && d.local !== false),
      documentOffers.list(store)
    );
    assert.ok(merged.some((row) => row.id === fileId && row.local === false));
    assert.ok(merged.some((row) => row.id === 'aa' && row.local === true));
  });

  it('formatPrice and peerLabel match Hub offer book conventions', () => {
    assert.strictEqual(documentOffers.formatPrice({ purchasePriceSats: 0 }), 'free');
    assert.strictEqual(documentOffers.formatPrice({}), 'unset');
    const pk = '02' + 'ab'.repeat(32);
    const label = documentOffers.peerLabel({ peerPubkey: pk });
    assert.ok(label.length < pk.length);
  });
});
