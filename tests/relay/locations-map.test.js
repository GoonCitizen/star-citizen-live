'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');

function request (port, method, reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: reqPath
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let body = null;
        try { body = buf ? JSON.parse(buf) : null; } catch (_) { body = buf; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-loc-'));
}

test('GET /locations and /locations/map are public; QT updates presence places', async () => {
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
    const list = await request(port, 'GET', '/services/star-citizen/locations?q=area18&limit=5');
    assert.strictEqual(list.status, 200);
    assert.ok(Array.isArray(list.body.data));
    assert.ok(list.body.data.some((l) => /area.?18/i.test(l.name) || /area18/i.test(l.slug)));

    const map = await request(port, 'GET', '/services/star-citizen/locations/map?system=STANTON');
    assert.strictEqual(map.status, 200);
    assert.ok(map.body.data.bodies.length > 3);
    assert.ok(Array.isArray(map.body.data.hotspots));

    svc.handleLogChange('<2026-07-23T23:55:53.091Z> [Notice] <Player Selected Quantum Target - Local> [ItemNavigation][CL][416] | NOT AUTH | DRAK_Clipper_734066837132[734066837132]|CSCItemNavigation::OnPlayerSelectedQuantumTarget|Player has selected point rs_ext_cru-leo1 as their destination, routing locally [Team_CGP4][QuantumTravel]');
    svc.handleLogChange('<2026-07-23T23:55:53.091Z> [Notice] <Calculate Route> [ItemNavigation][CL][416] | NOT AUTH | DRAK_Clipper_734066837132[734066837132]|CSCItemNavigation::CalculateRoute|Projected Start Location is Daymar for route to destination rs_ext_cru-leo1 [Team_CGP4][QuantumTravel]');
    let st = svc.getPresenceStatus();
    assert.ok(st.detectedShip);
    assert.match(String(st.detectedLocation && st.detectedLocation.name), /Daymar/i);
    assert.match(String(st.detectedDestination && st.detectedDestination.name), /Ambitious Dream Station/i);
    assert.ok(st.presence.location);
    assert.ok(st.presence.destination);

    svc.handleLogChange('<2026-07-26T05:08:02.800Z> [Notice] <Quantum Drive Arrived - Arrived at Final Destination> [ItemNavigation][CL][9156] | NOT AUTH | RSI_Mantis_738839128122[738839128122]|CSCItemNavigation::OnQuantumDriveArrived|Quantum Drive has arrived at final destination [Team_CGP4][QuantumTravel]');
    st = svc.getPresenceStatus();
    assert.match(String(st.detectedLocation && st.detectedLocation.name), /Ambitious Dream Station/i);
    assert.equal(st.detectedDestination, null);
    assert.equal(st.presence.destination, null);

    const detail = await request(port, 'GET', '/services/star-citizen/locations/rs_ext_cru-leo1');
    assert.strictEqual(detail.status, 200);
    assert.match(String(detail.body.data.location && detail.body.data.location.name), /Ambitious Dream Station/i);
    assert.ok(detail.body.data.reports.playerCount >= 1);
    assert.ok(detail.body.data.reports.visitCount >= 1);

    const reports = await request(port, 'GET', '/services/star-citizen/locations/reports');
    assert.strictEqual(reports.status, 200);
    assert.ok(Array.isArray(reports.body.data));
    assert.ok(reports.body.data.some((r) => /Ambitious Dream|CRU/i.test(r.name)));
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
