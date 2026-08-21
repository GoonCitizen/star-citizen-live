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
    const priced = documentOffers.inventoryItemsFromLocal([{
      id: 'cc',
      published: true,
      name: 'held.txt',
      mime: 'text/plain',
      purchasePriceSats: 110,
      costBasisSats: 100,
      contentBase64: 'AAAA'
    }]);
    assert.strictEqual(priced[0].purchasePriceSats, 110);
    assert.strictEqual(priced[0].costBasisSats, undefined);
    assert.strictEqual(priced[0].contentBase64, undefined);
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

  it('omits costBasisSats and remote blobs from catalog and GET rows', () => {
    const stripped = documentOffers.omitPrivateMarketFields({
      id: 'aa',
      purchasePriceSats: 110,
      costBasisSats: 100,
      local: true
    });
    assert.strictEqual(stripped.purchasePriceSats, 110);
    assert.strictEqual(stripped.costBasisSats, undefined);

    const store = new Store({ path: null });
    const fileId = '44'.repeat(32);
    documentOffers.replacePeerOffers(store, {
      peerPubkey: '02' + 'dd'.repeat(32),
      peerAlias: 'Ops'
    }, [{
      id: fileId,
      name: 'ghost.txt',
      purchasePriceSats: 10,
      contentBase64: Buffer.from('nope').toString('base64'),
      costBasisSats: 10
    }]);
    const merged = documentOffers.mergeCatalog([{
      id: fileId,
      purchasePriceSats: 110,
      costBasisSats: 100,
      published: true
    }], documentOffers.list(store));
    assert.strictEqual(merged[0].costBasisSats, undefined);
    assert.strictEqual(merged[0].purchasePriceSats, 110);
    assert.strictEqual(merged[0].bestPeerPriceSats, 10);
    const remote = documentOffers.remoteDocument(store, fileId);
    assert.ok(remote && remote.document);
    assert.strictEqual(remote.document.local, false);
    assert.strictEqual(remote.document.purchasePriceSats, 10);
    assert.strictEqual(remote.document.contentBase64, undefined);
    assert.strictEqual(remote.document.costBasisSats, undefined);
  });

  it('formatPrice and peerLabel match Hub offer book conventions', () => {
    assert.strictEqual(documentOffers.formatPrice({ purchasePriceSats: 0 }), 'free');
    assert.strictEqual(documentOffers.formatPrice({}), 'unset');
    const pk = '02' + 'ab'.repeat(32);
    const label = documentOffers.peerLabel({ peerPubkey: pk });
    assert.ok(label.length < pk.length);
    assert.strictEqual(documentOffers.peerLabel({ local: true }), 'this node');
    assert.strictEqual(documentOffers.peerLabel({ peerAddress: '10.0.0.1:9' }), '10.0.0.1:9');
    assert.strictEqual(documentOffers.peerLabel(null), 'peer');
  });

  it('replyInventory requires a peer writer and allowEmpty defaults on', () => {
    const sent = [];
    const peer = {
      _sendLocalInventoryDocumentsWireResponse (origin, items, opts) {
        sent.push({ origin, items, opts });
        return true;
      }
    };
    assert.strictEqual(documentOffers.replyInventory(peer, '10.0.0.1:7777', [{ id: 'aa' }]), true);
    assert.strictEqual(sent[0].origin, '10.0.0.1:7777');
    assert.strictEqual(sent[0].opts.allowEmpty, true);
    assert.strictEqual(documentOffers.replyInventory(null, 'x', []), false);
    assert.strictEqual(documentOffers.replyInventory(peer, '', []), false);
    assert.strictEqual(documentOffers.replacePeerOffers(null, {}, [{ id: 'aa' }]).length, 0);
    assert.strictEqual(documentOffers.list(null).length, 0);
    assert.strictEqual(documentOffers.remoteDocument(new Store({ path: null }), 'aa'.repeat(32)), null);
    assert.strictEqual(documentOffers.normalizeInventoryItem({ name: 'no-id' }), null);
  });

  it('keys a peer by address and fills aliases on offersForDocument', () => {
    const store = new Store({ path: null });
    const fileId = '66'.repeat(32);
    const pk = '02' + '77'.repeat(32);
    documentOffers.replacePeerOffers(store, { peerAddress: '10.8.8.8:7777', peerAlias: 'Lan' }, [{
      id: fileId,
      name: 'lan.txt',
      purchasePriceSats: 12
    }]);
    documentOffers.replacePeerOffers(store, { peerPubkey: pk }, [{
      id: fileId,
      name: 'lan.txt',
      purchasePriceSats: 30
    }]);
    const offers = documentOffers.offersForDocument({
      store,
      documentId: fileId,
      localDoc: { id: fileId, purchasePriceSats: 110, published: true },
      self: { peerAlias: 'this node' },
      aliases: { [pk]: 'Ops' }
    });
    assert.strictEqual(offers[0].purchasePriceSats, 12);
    assert.strictEqual(offers[0].peerAlias, 'Lan');
    assert.ok(offers.some((o) => o.local === true));
    assert.ok(offers.some((o) => o.peerAlias === 'Ops' && o.purchasePriceSats === 30));
  });

  it('requestConnectedInventories skips thrown sockets and missing writers', () => {
    assert.deepStrictEqual(documentOffers.requestConnectedInventories(null), { requested: 0, peers: [] });
    const asked = [];
    const peer = {
      connections: {
        '127.0.0.1:9': { _writeFabric: () => {} },
        '127.0.0.1:10': { _writeFabric: () => {} }
      },
      requestPeerInventory (addr) {
        asked.push(addr);
        if (addr.endsWith(':10')) throw new Error('socket dead');
        return true;
      }
    };
    const out = documentOffers.requestConnectedInventories(peer);
    assert.strictEqual(out.requested, 1);
    assert.deepStrictEqual(out.peers, ['127.0.0.1:9']);
    assert.strictEqual(asked.length, 2);
  });

  it('parses documents and inventory aliases and drops nameless items', () => {
    const id = 'ef'.repeat(32);
    const fromDocs = documentOffers.itemsFromInventoryMessage({
      documents: [{ id, rateSats: 4 }]
    });
    assert.strictEqual(fromDocs[0].rateSats, 4);
    const fromInv = documentOffers.itemsFromInventoryMessage({
      inventory: [{ id, purchasePriceSats: 6 }]
    });
    assert.strictEqual(fromInv[0].purchasePriceSats, 6);
    assert.strictEqual(documentOffers.offersForDocument({ documentId: '' }).length, 0);
    assert.strictEqual(documentOffers.omitPrivateMarketFields(null), null);
    const remote = documentOffers.omitPrivateMarketFields({
      local: false,
      costBasisSats: 1,
      contentBase64: 'AAAA',
      ciphertext: 'x',
      content: 'y',
      purchasePriceSats: 10
    });
    assert.strictEqual(remote.contentBase64, undefined);
    assert.strictEqual(remote.ciphertext, undefined);
    assert.strictEqual(remote.content, undefined);
    assert.strictEqual(remote.costBasisSats, undefined);
  });

  it('copies blob index metadata onto inventory items without file bytes', () => {
    const items = documentOffers.inventoryItemsFromLocal([{
      id: 'aa'.repeat(32),
      published: true,
      name: 'pack.bin',
      mime: 'application/octet-stream',
      purchasePriceSats: 25,
      merkleRootHex: 'bb'.repeat(32),
      blobTotal: 2,
      chunkBytes: 1024,
      documentBlobIndex: { '@type': 'DocumentBlobIndex' },
      blobs: [{ index: 0, rateSats: 12 }, { index: 1, rateSats: 13 }],
      costBasisSats: 20,
      contentBase64: 'AAAA'
    }]);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].merkleRootHex, 'bb'.repeat(32));
    assert.strictEqual(items[0].blobTotal, 2);
    assert.strictEqual(items[0].blobs.length, 2);
    assert.strictEqual(items[0].costBasisSats, undefined);
    assert.strictEqual(items[0].contentBase64, undefined);
  });
});
