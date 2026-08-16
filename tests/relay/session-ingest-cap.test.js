'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const LiveRelay = require('../../services/LiveRelay');
const { SESSION_LOG_CAP } = LiveRelay;

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gc-cap-'));
}

function request (port, method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('session log maps stay capped', () => {
  const svc = new LiveRelay({ discord: { enable: false }, fabric: { enable: false }, listen: false });
  for (let i = 0; i < SESSION_LOG_CAP + 250; i++) {
    svc.handleLogChange(`<2026-06-12T20:04:54.975Z> [Notice] cap-line-${i} filler`);
  }
  assert.strictEqual(svc.logs.length, SESSION_LOG_CAP);
  assert.strictEqual(svc.activities.length, SESSION_LOG_CAP);
  assert.ok(svc.recent.length <= 500);
});

test('replayLog maxBytes seeds only the file tail', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'Game.log');
  const early = [];
  const late = [];
  for (let i = 0; i < 40; i++) {
    early.push(`<2026-01-01T00:00:00.000Z> [Notice] SEEDCAP early-${i} ${'x'.repeat(180)}`);
  }
  for (let i = 0; i < 40; i++) {
    late.push(`<2026-06-12T20:04:54.975Z> [Notice] SEEDCAP late-${i} ${'x'.repeat(180)}`);
  }
  fs.writeFileSync(file, early.concat(late).join('\n') + '\n');
  const svc = new LiveRelay({ discord: { enable: false }, fabric: { enable: false }, listen: false });
  const n = await svc.replayLog(file, { maxBytes: 6000 });
  assert.ok(n > 0);
  assert.ok(n < 80, 'did not replay the whole file');
  const raw = svc.recent.map((r) => r.raw).join('\n');
  assert.ok(raw.includes('late-39'));
  assert.ok(!raw.includes('early-0'));
});

test('start emits listening and serves monitor before history sync finishes', async () => {
  const dir = tmpDir();
  const logCopy = path.join(dir, 'Game.log');
  const lines = [];
  for (let i = 0; i < 9000; i++) {
    lines.push(`<2026-06-12T20:04:54.975Z> [Notice] <bogus> yield-line-${i} ${'n'.repeat(40)}`);
  }
  fs.writeFileSync(logCopy, lines.join('\n') + '\n');

  const svc = new LiveRelay({
    port: 0,
    logfile: logCopy,
    seed: null,
    settingsDir: dir,
    historyFile: path.join(dir, 'history.json'),
    cursorsFile: path.join(dir, 'log-cursors.json'),
    missions: { enable: false },
    fabric: { enable: false },
    discord: { enable: false },
    reparse: { dirs: [dir] }
  });

  let monitorDuringSync = null;
  const fromListen = new Promise((resolve) => {
    svc.on('listening', () => {
      const port = svc.server.address().port;
      request(port, 'GET', '/services/star-citizen/monitor?limit=10')
        .then(resolve)
        .catch((e) => resolve({ status: 0, error: String(e && e.message || e) }));
    });
  });

  await svc.start();
  try {
    monitorDuringSync = await fromListen;
    assert.strictEqual(monitorDuringSync.status, 200);
    assert.ok(monitorDuringSync.body.historySync, 'monitor exposes historySync');
    assert.ok(Array.isArray(monitorDuringSync.body.missions));
    assert.ok(monitorDuringSync.body.missions.length <= 250);
    assert.ok(svc.history);
    assert.strictEqual(svc.status, 'STARTED');
  } finally {
    await svc.stop();
  }
});
