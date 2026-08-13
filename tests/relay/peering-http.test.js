'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const hubPeeringObserve = require('../../functions/hubPeeringObserve');
const { createIdentity } = require('../../functions/identity');

function tmpDir (prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function request (port, method, reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: reqPath,
      headers: { Accept: 'application/json' }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let body = null;
        if (buf) {
          try { body = JSON.parse(buf); } catch (_) { body = buf; }
        }
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('OPTIONS / returns Application Resource Contract with peering status', async () => {
  const dir = tmpDir('sc-arc-');
  const id = createIdentity();
  const svc = new LiveRelay({
    port: 0,
    listen: true,
    mode: 'relay',
    settingsDir: dir,
    fabric: { enable: false, listen: false, port: 0, peers: [] },
    logfile: path.join(dir, 'missing.log')
  });
  await svc.start();
  svc.setIdentity(id);
  try {
    const port = svc.server.address().port;
    const opt = await request(port, 'OPTIONS', '/');
    assert.strictEqual(opt.status, 200);
    assert.strictEqual(opt.body['@type'], 'ApplicationResourceContract');
    assert.ok(opt.body.contract && opt.body.contract.id);
    assert.ok(opt.body.services && opt.body.services.peering);
    assert.strictEqual(opt.body.services.peering.endpointBasePath, '/services/peering');
    assert.ok(opt.body.status && opt.body.status.oracleAttestation);
    assert.ok(opt.body.status.oracleAttestation.claim);
    assert.strictEqual(opt.body.status.oracleAttestation.claim.kind, 'PeeringCapability');
    assert.ok(opt.body.capabilities && opt.body.capabilities.fabric &&
      opt.body.capabilities.fabric.p2p === true);

    const peering = await request(port, 'GET', '/services/peering');
    assert.strictEqual(peering.status, 200);
    assert.strictEqual(peering.body.available, true);
    assert.ok(peering.body.oracleAttestation && peering.body.oracleAttestation.claim);
    assert.strictEqual(peering.body.claim.fabricPeerId, id.pubkey);

    const att = await request(port, 'GET', '/services/peering/attestation');
    assert.strictEqual(att.status, 200);
    assert.strictEqual(att.body['@type'], 'OracleAttestation');

    // GET / still serves the SPA
    const home = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => resolve({ status: res.statusCode, ctype: res.headers['content-type'], buf }));
      }).on('error', reject);
    });
    assert.strictEqual(home.status, 200);
    assert.match(String(home.ctype || ''), /text\/html/);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hubPeeringObserve discovers LiveRelay via OPTIONS attestation alone', async () => {
  const dir = tmpDir('sc-observe-');
  const id = createIdentity();
  const svc = new LiveRelay({
    port: 0,
    listen: true,
    mode: 'relay',
    settingsDir: dir,
    fabric: { enable: false, listen: false, port: 0, peers: [] },
    logfile: path.join(dir, 'missing.log')
  });
  await svc.start();
  svc.setIdentity(id);
  try {
    const port = svc.server.address().port;
    const origin = `http://127.0.0.1:${port}`;
    const snap = await hubPeeringObserve.observeOneHub(origin, { timeoutMs: 5000 });
    assert.strictEqual(snap.ok, true);
    assert.ok(snap.discoveredVia === 'options' || snap.discoveredVia === 'options+peering');
    assert.strictEqual(snap.fabricPeerId, id.pubkey);
    assert.ok(snap.application && snap.application.contractId);
    assert.ok(snap.application.services && snap.application.services.peering);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
