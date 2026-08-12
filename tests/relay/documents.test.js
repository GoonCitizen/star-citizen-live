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

test('documentsRuntimeForSettings: enable defaults false; hub falls back to bitcoin hub', () => {
  assert.strictEqual(hubDocumentExchangeProxy.isDocumentsEnabled({}), false);
  assert.strictEqual(hubDocumentExchangeProxy.isDocumentsEnabled({ documents: { enable: false } }), false);
  assert.strictEqual(hubDocumentExchangeProxy.isDocumentsEnabled({ documents: { enable: true } }), true);
  const rt = hubDocumentExchangeProxy.documentsRuntimeForSettings({
    documents: { enable: true },
    bitcoin: { hub: 'http://hub.example:8080' }
  });
  assert.strictEqual(rt.enable, true);
  assert.strictEqual(rt.hub, 'http://hub.example:8080');
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

test('GET /settings runtime.documents reflects enable flag', async () => {
  const svc = new LiveRelay({
    port: 0,
    missions: { enable: false },
    fabric: { enable: false },
    documents: { enable: true, hub: 'http://docs.example:8080' }
  });
  await svc.start();
  try {
    const port = svc.server.address().port;
    const res = await request(port, 'GET', '/settings');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.runtime.documents.enable, true);
    assert.strictEqual(res.body.runtime.documents.hub, 'http://docs.example:8080');
  } finally {
    await svc.stop();
  }
});
