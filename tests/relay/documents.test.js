'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const hubDocumentExchangeProxy = require('../../functions/hubDocumentExchangeProxy');

const BASE = '/services/star-citizen';

function request (port, method, reqPath, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: reqPath,
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let body = null;
        try { body = buf ? JSON.parse(buf) : null; } catch (_) { body = { raw: buf }; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}

test('documentsRuntimeForSettings: enable defaults false; catalog is local (no Hub)', () => {
  assert.strictEqual(hubDocumentExchangeProxy.isDocumentsEnabled({}), false);
  assert.strictEqual(hubDocumentExchangeProxy.isDocumentsEnabled({ documents: { enable: false } }), false);
  assert.strictEqual(hubDocumentExchangeProxy.isDocumentsEnabled({ documents: { enable: true } }), true);
  const rt = hubDocumentExchangeProxy.documentsRuntimeForSettings({
    documents: { enable: true },
    bitcoin: { hub: 'http://hub.example:8080' }
  });
  assert.strictEqual(rt.enable, true);
  assert.strictEqual(rt.local, true);
  assert.ok(!rt.hub);
});

test('GET /documents returns 503 when settings.documents.enable is false', async () => {
  const svc = new LiveRelay({
    port: 0,
    missions: { enable: false },
    fabric: { enable: false },
    documents: { enable: false, hub: 'http://127.0.0.1:9' }
  });
  await svc.start();
  try {
    const port = svc.server.address().port;
    const res = await request(port, 'GET', `${BASE}/documents`);
    assert.strictEqual(res.status, 503);
    assert.match(String(res.body && res.body.error), /documents\.enable/i);
  } finally {
    await svc.stop();
  }
});

test('GET /settings runtime.documents is local (no Hub URL)', async () => {
  const svc = new LiveRelay({
    port: 0,
    missions: { enable: false },
    fabric: { enable: false },
    documents: { enable: true }
  });
  await svc.start();
  try {
    const port = svc.server.address().port;
    const res = await request(port, 'GET', '/settings');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.runtime.documents.enable, true);
    assert.strictEqual(res.body.runtime.documents.local, true);
    assert.ok(!res.body.runtime.documents.hub);
  } finally {
    await svc.stop();
  }
});

test('local catalog: POST /documents then GET list and GET by id', async () => {
  const svc = new LiveRelay({
    port: 0,
    missions: { enable: false },
    fabric: { enable: false },
    documents: { enable: true }
  });
  await svc.start();
  try {
    const port = svc.server.address().port;
    const created = await request(port, 'POST', `${BASE}/documents`, {
      name: 'hello.txt',
      mime: 'text/plain',
      contentBase64: Buffer.from('hello local catalog', 'utf8').toString('base64')
    });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const doc = (created.body.data && created.body.data.document) || created.body.data;
    assert.ok(doc && doc.id);
    assert.strictEqual(doc.local, true);

    const listed = await request(port, 'GET', `${BASE}/documents`);
    assert.strictEqual(listed.status, 200);
    assert.strictEqual(listed.body.local, true);
    const rows = (listed.body.data && listed.body.data.documents) || listed.body.data || [];
    assert.ok(Array.isArray(rows));
    assert.ok(rows.some((d) => d.id === doc.id));

    const got = await request(port, 'GET', `${BASE}/documents/${doc.id}`);
    assert.strictEqual(got.status, 200);
    const body = (got.body.data && got.body.data.document) || got.body.data;
    assert.ok(body.contentBase64);
    assert.strictEqual(
      Buffer.from(body.contentBase64, 'base64').toString('utf8'),
      'hello local catalog'
    );

    const synced = await request(port, 'POST', `${BASE}/files/${doc.id}/cluster-sync`, {
      clusterSync: true
    });
    assert.strictEqual(synced.status, 200, JSON.stringify(synced.body));
    assert.strictEqual(synced.body.type, 'FileClusterSync');
    assert.strictEqual(synced.body.data.clusterSync, true);
    const page = await request(port, 'GET', `${BASE}/files/${doc.id}`);
    assert.strictEqual(page.status, 200);
    assert.strictEqual(page.body.data.clusterSync, true);
  } finally {
    await svc.stop();
  }
});

test('chat attach writes this node\'s catalog without documents.enable or a Hub', async () => {
  const { createIdentity } = require('../../functions/identity');
  const id = createIdentity();
  const svc = new LiveRelay({
    port: 0,
    missions: { enable: false },
    fabric: { enable: false },
    documents: { enable: false }
  });
  await svc.start();
  try {
    svc._identity = id;
    const port = svc.server.address().port;
    const res = await request(port, 'POST', `${BASE}/chat/messages`, {
      channel: 'global',
      body: 'see attached',
      file: {
        name: 'brief.txt',
        mime: 'text/plain',
        contentBase64: Buffer.from('mission brief', 'utf8').toString('base64')
      },
      purchasePriceSats: 25
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const msg = res.body.data;
    assert.ok(msg.attachment && msg.attachment.documentId);
    assert.strictEqual(msg.attachment.name, 'brief.txt');
    assert.ok(!msg.attachment.hub);
    const stored = svc.registerStore.get('documents', msg.attachment.documentId);
    assert.ok(stored);
    assert.strictEqual(stored.published, true);
    const gated = await request(port, 'GET', `${BASE}/documents`);
    assert.strictEqual(gated.status, 503);
  } finally {
    await svc.stop();
  }
});

test('POST /documents/inventory queries Fabric peers and GET lists remote offers', async () => {
  const svc = new LiveRelay({
    port: 0,
    missions: { enable: false },
    fabric: { enable: false },
    documents: { enable: true }
  });
  await svc.start();
  try {
    const port = svc.server.address().port;
    const inv = await request(port, 'POST', `${BASE}/documents/inventory`);
    assert.strictEqual(inv.status, 200, JSON.stringify(inv.body));
    assert.strictEqual(inv.body.data.requested, 0);
    assert.ok(Array.isArray(inv.body.data.offers));

    const documentOffers = require('../../functions/documentOffers');
    const fileId = 'cd'.repeat(32);
    documentOffers.replacePeerOffers(svc.registerStore, {
      peerPubkey: '02' + 'aa'.repeat(32),
      peerAlias: 'Wing'
    }, [{
      id: fileId,
      name: 'wing-brief.txt',
      mime: 'text/plain',
      purchasePriceSats: 40
    }]);
    documentOffers.replacePeerOffers(svc.registerStore, {
      peerPubkey: '02' + 'bb'.repeat(32),
      peerAlias: 'Ops'
    }, [{
      id: fileId,
      name: 'wing-brief.txt',
      mime: 'text/plain',
      purchasePriceSats: 10
    }]);

    const listed = await request(port, 'GET', `${BASE}/documents`);
    assert.strictEqual(listed.status, 200);
    const rows = (listed.body.data && listed.body.data.documents) || [];
    assert.ok(rows.some((d) => d.id === fileId && d.local === false));
    const remote = rows.find((d) => d.id === fileId);
    assert.strictEqual(remote.purchasePriceSats, 10);
    assert.match(String(remote.peerAlias || ''), /Ops/);

    const got = await request(port, 'GET', `${BASE}/documents/${fileId}`);
    assert.strictEqual(got.status, 200);
    const offers = got.body.data && got.body.data.offers;
    assert.ok(Array.isArray(offers));
    assert.strictEqual(offers.length, 2);
    assert.strictEqual(offers[0].purchasePriceSats, 10);
    assert.strictEqual(offers[0].peerAlias, 'Ops');
    assert.strictEqual(got.body.data.document.local, false);
    assert.ok(!got.body.data.document.contentBase64);
    assert.ok(got.body.data.document.costBasisSats == null);
    assert.ok(!remote.contentBase64);
    assert.ok(remote.costBasisSats == null);

    const offersList = await request(port, 'GET', `${BASE}/documents/offers?documentId=${fileId}`);
    assert.strictEqual(offersList.status, 200);
    assert.strictEqual((offersList.body.data.offers || []).length, 2);
    const allOffers = await request(port, 'GET', `${BASE}/documents/offers`);
    assert.strictEqual(allOffers.status, 200);
    assert.ok((allOffers.body.data.offers || []).length >= 2);

    const catalog = svc._documentCatalogPayload();
    const catRow = catalog.documents.find((d) => d.id === fileId);
    assert.ok(catRow && catRow.local === false);
    assert.ok(!catRow.contentBase64);
    assert.strictEqual(catRow.bestPeerPriceSats, 10);

    const file = svc._fileRecord(fileId);
    assert.ok(file);
    assert.strictEqual(file.local, false);
    assert.ok(Array.isArray(file.offers) && file.offers.length === 2);
    assert.ok(!file.record.contentBase64);
  } finally {
    await svc.stop();
  }
});

test('_onDocumentInventoryRequest replies with published local items only', async () => {
  const localDocuments = require('../../functions/localDocuments');
  const documentOffers = require('../../functions/documentOffers');
  const svc = new LiveRelay({
    port: 0,
    missions: { enable: false },
    fabric: { enable: false },
    documents: { enable: true }
  });
  await svc.start();
  try {
    const created = localDocuments.create(svc.registerStore, {
      name: 'mine.txt',
      mime: 'text/plain',
      contentBase64: Buffer.from('mine').toString('base64')
    });
    localDocuments.publish(svc.registerStore, created.id, { purchasePriceSats: 25 });
    const remoteId = 'aa'.repeat(32);
    documentOffers.replacePeerOffers(svc.registerStore, {
      peerPubkey: '02' + 'ee'.repeat(32),
      peerAlias: 'Wing'
    }, [{ id: remoteId, name: 'theirs.txt', purchasePriceSats: 10 }]);

    const sent = [];
    const peer = {
      _sendLocalInventoryDocumentsWireResponse (origin, items) {
        sent.push({ origin, items });
        return true;
      }
    };
    svc._onDocumentInventoryRequest({ origin: { name: '10.1.1.1:7777' }, peer });
    assert.strictEqual(sent.length, 1);
    const ids = (sent[0].items || []).map((row) => row.id);
    assert.ok(ids.includes(created.id));
    assert.ok(!ids.includes(remoteId), 'must not republish remote-only offers on inventory reply');
    const before = sent.length;
    svc._onDocumentInventoryRequest({ origin: null, peer });
    assert.strictEqual(sent.length, before);

    documentOffers.replacePeerOffers(svc.registerStore, {
      peerPubkey: '02' + 'aa'.repeat(32),
      peerAlias: 'Ops'
    }, [{ id: created.id, name: 'mine.txt', purchasePriceSats: 10 }]);
    const catalog = svc._documentCatalogPayload();
    const row = catalog.documents.find((d) => d.id === created.id);
    assert.ok(row);
    assert.strictEqual(row.local, true);
    assert.strictEqual(row.purchasePriceSats, 25);
    assert.strictEqual(row.bestPeerPriceSats, 10);
    assert.strictEqual(row.costBasisSats, undefined);

    const localDetail = svc._documentDetailPayload(created.id);
    assert.strictEqual(localDetail.local, true);
    assert.ok(localDetail.offers.some((o) => o.local === true));
    assert.ok(localDetail.offers.some((o) => o.peerAlias === 'Ops'));

    const remoteDetail = svc._documentDetailPayload(remoteId);
    assert.strictEqual(remoteDetail.local, false);
    assert.ok(!remoteDetail.document.contentBase64);
    assert.ok(remoteDetail.document.costBasisSats == null);
  } finally {
    await svc.stop();
  }
});

test('_onDocumentInventoryResponse accumulates a peer snapshot', async () => {
  const documentOffers = require('../../functions/documentOffers');
  const svc = new LiveRelay({
    port: 0,
    missions: { enable: false },
    fabric: { enable: false },
    documents: { enable: true }
  });
  await svc.start();
  try {
    const fileId = 'bb'.repeat(32);
    const pubkey = '02' + 'ff'.repeat(32);
    svc._onDocumentInventoryResponse({
      message: {
        object: {
          kind: 'documents',
          items: [{ id: fileId, name: 'ops.txt', purchasePriceSats: 40, mime: 'text/plain' }]
        }
      },
      origin: { name: '10.2.2.2:7777' },
      signerPubkeyHex: pubkey
    });
    const offers = documentOffers.offersForDocument({
      store: svc.registerStore,
      documentId: fileId
    });
    assert.strictEqual(offers.length, 1);
    assert.strictEqual(offers[0].purchasePriceSats, 40);
    assert.strictEqual(offers[0].peerPubkey, pubkey);
  } finally {
    await svc.stop();
  }
});

test('_queryPeerInventories reports cached offers when Fabric is down', async () => {
  const documentOffers = require('../../functions/documentOffers');
  const svc = new LiveRelay({
    port: 0,
    missions: { enable: false },
    fabric: { enable: false },
    documents: { enable: true }
  });
  await svc.start();
  try {
    const fileId = '77'.repeat(32);
    documentOffers.replacePeerOffers(svc.registerStore, {
      peerPubkey: '02' + '11'.repeat(32),
      peerAlias: 'Ops'
    }, [{ id: fileId, name: 'ops.txt', purchasePriceSats: 15 }]);
    const queried = svc._queryPeerInventories();
    assert.strictEqual(queried.requested, 0);
    assert.strictEqual(queried.ready, false);
    assert.ok(queried.offers.some((o) => o.documentId === fileId));

    svc._onDocumentInventoryResponse({
      message: { inventory: [{ id: fileId, name: 'ops.txt', purchasePriceSats: 9 }] },
      origin: '10.9.9.9:7777',
      signerPubkeyHex: '02' + '22'.repeat(32)
    });
    const offers = documentOffers.offersForDocument({
      store: svc.registerStore,
      documentId: fileId
    });
    assert.ok(offers.some((o) => o.purchasePriceSats === 9));
  } finally {
    await svc.stop();
  }
});

test('POST /documents filePath publishes a repo build artifact on loopback', async () => {
  const fs = require('fs');
  const path = require('path');
  const dist = path.join(__dirname, '../../dist');
  fs.mkdirSync(dist, { recursive: true });
  const artifact = path.join(dist, 'gooncitizen-publish-test.txt');
  fs.writeFileSync(artifact, 'final-build-bytes');
  const svc = new LiveRelay({
    port: 0,
    missions: { enable: false },
    fabric: { enable: false },
    documents: { enable: true }
  });
  await svc.start();
  try {
    const port = svc.server.address().port;
    const created = await request(port, 'POST', `${BASE}/documents`, {
      filePath: artifact,
      name: 'gooncitizen-publish-test.txt',
      mime: 'text/plain',
      publish: true,
      purchasePriceSats: 25
    });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const doc = (created.body.data && created.body.data.document) || created.body.data;
    assert.ok(doc && doc.id);
    assert.strictEqual(doc.published, true);
    assert.strictEqual(doc.purchasePriceSats, 25);
    assert.strictEqual(doc.name, 'gooncitizen-publish-test.txt');
    assert.ok(doc.merkleRootHex);
    assert.ok(doc.blobTotal >= 1);
    assert.ok(Array.isArray(doc.blobs) && doc.blobs.length >= 1);
    assert.equal(
      doc.blobs.reduce((a, b) => a + (b.rateSats || 0), 0),
      doc.purchasePriceSats
    );

    const outside = await request(port, 'POST', `${BASE}/documents`, {
      filePath: '/etc/passwd',
      publish: true
    });
    assert.strictEqual(outside.status, 403);
  } finally {
    await svc.stop();
    try { fs.unlinkSync(artifact); } catch (_) { /* ok */ }
  }
});

test('POST /documents publish prices by size when no flat purchasePriceSats', async () => {
  const fs = require('fs');
  const path = require('path');
  const dist = path.join(__dirname, '../../dist');
  fs.mkdirSync(dist, { recursive: true });
  const artifact = path.join(dist, 'gooncitizen-size-price.bin');
  fs.writeFileSync(artifact, Buffer.alloc(50 * 1024, 3));
  const svc = new LiveRelay({
    port: 0,
    missions: { enable: false },
    fabric: { enable: false },
    documents: { enable: true, defaultPriceSats: 0, satsPerKiB: 1 }
  });
  await svc.start();
  try {
    const port = svc.server.address().port;
    const created = await request(port, 'POST', `${BASE}/documents`, {
      filePath: artifact,
      name: 'gooncitizen-size-price.bin',
      publish: true
    });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const doc = (created.body.data && created.body.data.document) || created.body.data;
    assert.strictEqual(doc.purchasePriceSats, 50);
    assert.ok(doc.blobTotal >= 2);
    assert.equal(
      (doc.blobs || []).reduce((a, b) => a + (b.rateSats || 0), 0),
      50
    );
  } finally {
    await svc.stop();
    try { fs.unlinkSync(artifact); } catch (_) { /* ok */ }
  }
});
