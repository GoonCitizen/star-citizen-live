'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const mapStatic = require('../../functions/mapStaticAssets');

function request (port, method, reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: reqPath
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let body = buf;
        const ct = String(res.headers['content-type'] || '');
        if (ct.includes('json')) {
          try { body = JSON.parse(buf.toString('utf8')); } catch (_) { body = buf.toString('utf8'); }
        }
        resolve({ status: res.statusCode, headers: res.headers, body, buf });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-map-static-'));
}

test('mapStaticAssets rejects path traversal', () => {
  assert.equal(mapStatic.resolveMapStatic('/assets/map/../package.json'), null);
  assert.equal(mapStatic.resolveMapStatic('/assets/map/tiles/../../package.json'), null);
  assert.equal(mapStatic.resolveMapStatic('/assets/map/tiles/nope.png'), null);
});

test('GET /assets/map allowlist serves tiles and 404s traversal', async () => {
  const dir = tmpDir();
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    missions: { enable: false },
    peers: [],
    fabric: { enable: false }
  });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const man = await request(port, 'GET', '/assets/map/manifest.json');
    assert.strictEqual(man.status, 200);
    assert.ok(man.body.systems && man.body.systems.STANTON);

    const tile = await request(port, 'GET', '/assets/map/tiles/starfield-01.png');
    assert.strictEqual(tile.status, 200);
    assert.match(String(tile.headers['content-type']), /image\/png/);
    assert.ok(tile.buf.length > 100);

    const bad = await request(port, 'GET', '/assets/map/tiles/../../package.json');
    assert.strictEqual(bad.status, 404);

    const missing = await request(port, 'GET', '/assets/map/tiles/not-a-tile.png');
    assert.strictEqual(missing.status, 404);

    const galaxy = await request(port, 'GET', '/services/star-citizen/locations/map?view=galaxy');
    assert.strictEqual(galaxy.status, 200);
    assert.ok(Array.isArray(galaxy.body.data.systems));
    assert.ok(galaxy.body.data.systems.length >= 2);
    assert.ok(Array.isArray(galaxy.body.data.edges));
    assert.ok(galaxy.body.data.edges.some((e) =>
      (e.from === 'STANTON' && e.to === 'PYRO') || (e.from === 'PYRO' && e.to === 'STANTON')));

    const body = await request(port, 'GET',
      '/services/star-citizen/locations/map?view=body&system=STANTON&body=Daymar');
    assert.strictEqual(body.status, 200);
    assert.ok(body.body.data.body);
    assert.ok(Array.isArray(body.body.data.pois));
    assert.ok(body.body.data.surfaceTile);
    assert.match(String(body.body.data.surfaceTile), /bodies\/daymar/);

    const bodyTile = await request(port, 'GET', '/assets/map/tiles/bodies/daymar.png');
    assert.strictEqual(bodyTile.status, 200);

    const surf = await request(port, 'GET', '/assets/map/tiles/surface-arid.png');
    assert.strictEqual(surf.status, 200);
  } finally {
    await svc.stop();
  }
});
