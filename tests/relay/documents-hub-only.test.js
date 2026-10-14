'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const { request } = require('../helpers/http');

const BASE = '/services/star-citizen';

async function startRelay (extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-docs-hub-'));
  const svc = new LiveRelay(Object.assign({
    port: 0,
    listen: true,
    mode: 'relay',
    settingsDir: dir,
    fabric: { enable: false, listen: false, port: 0, peers: [] },
    missions: { enable: false },
    discord: { enable: false },
    documents: { enable: true }
  }, extra));
  await svc.start();
  return { svc, dir, port: svc.server.address().port };
}

describe('document purchase/claim stay Hub-only', () => {
  it('POST purchase and claim return 501; unknown document routes 404', async () => {
    const { svc, dir, port } = await startRelay();
    try {
      const purchase = await request(port, 'POST', `${BASE}/documents/aa${'bb'.repeat(15)}/purchase`, {});
      assert.equal(purchase.status, 501);
      assert.match(String(purchase.body && purchase.body.error), /Hub-only/i);

      const claim = await request(port, 'POST', `${BASE}/documents/aa${'bb'.repeat(15)}/claim`, {});
      assert.equal(claim.status, 501);
      assert.match(String(claim.body && claim.body.error), /Hub-only/i);

      const unknown = await request(port, 'GET', `${BASE}/documents/abc/nope`);
      assert.equal(unknown.status, 404);
      assert.match(String(unknown.body && unknown.body.error), /unknown documents route/i);
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
