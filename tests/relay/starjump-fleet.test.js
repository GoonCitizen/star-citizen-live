'use strict';

const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const starjumpFleet = require('../../functions/starjumpFleet');
const shipCatalog = require('../../functions/shipCatalog');
const LiveRelay = require('../../services/LiveRelay');

const SAMPLE = path.join(__dirname, '..', '..', 'data', 'fleets', 'fleetviewer-thejohnram.json');

function tmpDir (prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function request (port, method, reqPath, body) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: reqPath,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = buf ? JSON.parse(buf) : null; } catch (_) { parsed = buf; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('ownerFromSourceFile + owner-tagged extract/filter', () => {
  assert.equal(starjumpFleet.ownerFromSourceFile('starjump-kersa.json'), 'kersa');
  assert.equal(starjumpFleet.ownerFromSourceFile('STARJUMP_FleetViewer-crescendo.json'), 'crescendo');
  assert.equal(starjumpFleet.ownerFromSourceFile('starjump-crescendo-only.json'), 'crescendo');
  assert.equal(starjumpFleet.ownerFromSourceFile('Leonheart23 Fleet.json'), 'Leonheart23');
  assert.equal(starjumpFleet.ownerFromSourceFile('fleetviewer-thejohnram.json'), 'thejohnram');
  assert.equal(starjumpFleet.ownerFromSourceFile('starjump-permafleet-all.json'), null);
  assert.equal(starjumpFleet.ownerFromSourceFile('starjump-all.json'), null);

  assert.ok(fs.existsSync(SAMPLE), 'sample fleet JSON should exist');
  const raw = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  const fleet = starjumpFleet.parseStarjumpExport(raw, {
    name: 'John',
    sourceFile: 'fleetviewer-thejohnram.json'
  });
  assert.ok(fleet.ships.every((s) => s.owner === 'thejohnram'));
  assert.equal(fleet.ownerCount, 1);
  assert.deepEqual(fleet.owners || starjumpFleet.listOwners(fleet.ships), ['thejohnram']);

  const merged = starjumpFleet.normalizeShips([
    ...fleet.ships,
    { slug: 'rsi-polaris', name: 'Polaris', owner: 'kersa', count: 2 },
    { slug: 'rsi-polaris', name: 'Polaris', owner: 'kersa', count: 1 },
    { slug: 'rsi-polaris', name: 'Polaris', owner: 'gelly', count: 1 }
  ]);
  const polarisLines = merged.filter((s) => s.slug === 'rsi-polaris' || /polaris/i.test(s.slug));
  assert.ok(polarisLines.length >= 2, 'same hull under different owners stays separate');
  const kersaPolaris = polarisLines.find((s) => s.owner === 'kersa');
  assert.ok(kersaPolaris);
  assert.equal(kersaPolaris.count, 3);

  const byOwner = starjumpFleet.filterSortShips(merged, { owner: 'kersa', sort: 'count' });
  assert.ok(byOwner.length >= 1);
  assert.ok(byOwner.every((s) => s.owner === 'kersa'));
  const byQty = starjumpFleet.filterSortShips(merged, { minCount: 2, sort: 'count' });
  assert.ok(byQty.every((s) => (s.count || 1) >= 2));
  const search = starjumpFleet.filterSortShips(merged, { q: 'thejohnram' });
  assert.ok(search.every((s) => /thejohnram/i.test(s.owner || '')));

  const byHull = starjumpFleet.filterSortShips(merged, { consolidate: 'hull', sort: 'count' });
  const polarisHull = byHull.find((s) => /polaris/i.test(s.slug) || /polaris/i.test(s.name || ''));
  assert.ok(polarisHull, 'hull consolidate should include polaris');
  assert.equal(polarisHull.consolidated, 'hull');
  assert.ok(polarisHull.count >= 4, 'polaris counts from kersa+gelly should sum');
  assert.ok(Array.isArray(polarisHull.owners) && polarisHull.owners.length >= 2);

  const byClass = starjumpFleet.consolidateShips([
    { slug: 'a', name: 'A', type: 'Fighter', owner: 'kersa', count: 2 },
    { slug: 'b', name: 'B', type: 'Fighter', owner: 'gelly', count: 3 },
    { slug: 'c', name: 'C', type: 'Capital', owner: 'kersa', count: 1 }
  ], 'type');
  assert.equal(byClass.length, 2);
  const fighters = byClass.find((s) => s.name === 'Fighter');
  assert.ok(fighters);
  assert.equal(fighters.count, 5);
  assert.equal(fighters.uniqueHulls, 2);
});

test('parseStarjumpExport extracts ships from sample', () => {
  assert.ok(fs.existsSync(SAMPLE), 'sample fleet JSON should exist');
  const raw = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  assert.equal(starjumpFleet.isStarjumpExport(raw), true);
  const fleet = starjumpFleet.parseStarjumpExport(raw, {
    name: 'John',
    ownerPubkey: '03aa',
    sourceFile: 'fleetviewer-thejohnram.json'
  });
  assert.equal(fleet.type, 'GoonCitizenFleet');
  assert.equal(fleet.uniqueShips, 2);
  assert.equal(fleet.shipCount, 2);
  assert.ok(fleet.ships.some((s) => /ironclad-assault/.test(s.slug)));
  assert.ok(fleet.export && fleet.export.canvasItems.length >= 2);

  const share = starjumpFleet.buildFleetShareObject(fleet);
  assert.equal(share.type, 'FleetShare');
  assert.equal(share.uniqueShips, 2);

  const remote = starjumpFleet.fleetFromShareObject(share, '03bb');
  assert.equal(remote.remote, true);
  assert.equal(remote.ownerPubkey, '03bb');
  assert.equal(remote.uniqueShips, 2);
});

test('ship catalog loads and searches', () => {
  const status = shipCatalog.catalogStatus();
  assert.ok(status.count >= 50, 'catalog should have many known ships');
  const polaris = shipCatalog.searchShips('polaris', { limit: 5 });
  assert.ok(polaris.some((s) => /polaris/i.test(s.slug) || /polaris/i.test(s.name)));
  const resolved = shipCatalog.resolveShip('cutlass-black') || shipCatalog.resolveShip('Cutlass Black');
  assert.ok(resolved, 'cutlass should resolve');
});

test('custom fleet create + add/remove ships', async () => {
  const dir = tmpDir('gc-fleet-custom-');
  const svc = new LiveRelay({
    port: 0,
    listen: true,
    logfile: null,
    settingsDir: dir,
    fabric: { enable: false },
    missions: { enable: false }
  });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const created = await request(port, 'POST', '/services/star-citizen/fleets', {
      custom: true,
      name: 'Wing One',
      ships: []
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.data.source, 'custom');
    const id = created.body.data.id;

    const ships = await request(port, 'GET', '/services/star-citizen/ships?q=polaris&limit=5');
    assert.equal(ships.status, 200);
    assert.ok(ships.body.data.length >= 1);
    const slug = ships.body.data[0].slug;

    const added = await request(port, 'POST', `/services/star-citizen/fleets/${id}/ships`, {
      slug,
      count: 2
    });
    assert.equal(added.status, 200);
    assert.equal(added.body.data.shipCount, 2);

    const removed = await request(port, 'DELETE', `/services/star-citizen/fleets/${id}/ships/${encodeURIComponent(slug)}`);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.data.shipCount, 0);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fleet REST import sample + list + delete', async () => {
  const dir = tmpDir('gc-fleet-');
  const svc = new LiveRelay({
    port: 0,
    listen: true,
    logfile: null,
    settingsDir: dir,
    fabric: { enable: false },
    missions: { enable: false }
  });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const samples = await request(port, 'GET', '/services/star-citizen/fleets/samples');
    assert.equal(samples.status, 200);
    assert.ok(samples.body.data.some((s) => s.name === 'starjump-kersa.json'));

    const imported = await request(port, 'POST', '/services/star-citizen/fleets', {
      sample: 'starjump-codywastaken.json',
      name: 'Cody'
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.data.name, 'Cody');
    assert.ok(imported.body.data.shipCount >= 1);

    const list = await request(port, 'GET', '/services/star-citizen/fleets');
    assert.equal(list.status, 200);
    assert.ok(list.body.data.length >= 1);

    const id = imported.body.data.id;
    const one = await request(port, 'GET', `/services/star-citizen/fleets/${id}`);
    assert.equal(one.status, 200);
    assert.equal(one.body.data.id, id);

    const del = await request(port, 'DELETE', `/services/star-citizen/fleets/${id}`);
    assert.equal(del.status, 200);
    const empty = await request(port, 'GET', '/services/star-citizen/fleets');
    assert.equal(empty.body.data.find((f) => f.id === id), undefined);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
