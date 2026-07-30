'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const cumulativeHistory = require('../../functions/cumulativeHistory');
const activityTree = require('../../functions/activityTree');
const LiveRelay = require('../../services/LiveRelay');

const FIXTURE = path.join(__dirname, 'fixtures', 'sample-quantum-crime.log');

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
      res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}

test('history folds quantum / incap / CrimeStat from samples fixture', async () => {
  const history = cumulativeHistory.emptyHistory();
  const cursors = {};
  const result = await cumulativeHistory.syncFiles([FIXTURE], history, cursors);
  assert.ok(result.lines > 0);
  assert.ok(history.quantum.length >= 2, 'select + arrive');
  assert.ok(history.quantum.some((q) => q.phase === 'select' && q.destination === 'rs_ext_cru-leo1'));
  assert.ok(history.incap.length >= 1);
  assert.ok(history.crimestat.length >= 1);
  assert.strictEqual(history.crimestat[0].rating, 23);

  const counts = cumulativeHistory.cumulativeCounts(history);
  assert.ok(counts.quantum >= 2);
  assert.ok(counts.incap >= 1);
  assert.ok(counts.crimestat >= 1);

  const tree = activityTree.buildActivityTree(history, { ownerPubkey: 'ab'.repeat(32) });
  assert.strictEqual(tree.type, 'GroupActivityTree');
  assert.ok(tree.leafCount >= 3);
  assert.ok(tree.root && tree.root.length === 64);
  assert.ok(tree.digests.length === tree.leafCount);
});

test('GET /activity-tree and analytics expose expanded history', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-tree-'));
  const logCopy = path.join(dir, 'Game.log');
  fs.copyFileSync(FIXTURE, logCopy);

  const svc = new LiveRelay({
    port: 0,
    logfile: logCopy,
    settingsDir: dir,
    missions: { enable: false },
    fabric: { enable: false },
    peers: [],
    reparse: { dirs: [dir] }
  });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const analytics = await request(port, 'GET', '/services/star-citizen/analytics');
    assert.strictEqual(analytics.status, 200);
    assert.ok((analytics.body.quantum || []).length >= 2);
    assert.ok((analytics.body.incap || []).length >= 1);
    assert.ok(analytics.body.counts.quantum >= 2);

    const tree = await request(port, 'GET', '/services/star-citizen/activity-tree');
    assert.strictEqual(tree.status, 200);
    assert.strictEqual(tree.body.type, 'GroupActivityTree');
    assert.ok(tree.body.leafCount >= 3);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
