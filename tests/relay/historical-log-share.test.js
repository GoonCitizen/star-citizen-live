'use strict';

/**
 * First-time corpus sync reads all logs; enabling share afterwards publishes
 * that accumulated history (not only future live lines).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity } = require('../../functions/identity');

const BASE = '/services/star-citizen';
const FIXTURE = path.join(__dirname, 'fixtures', 'sample-missions.log');

function request (port, method, reqPath, payload) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}

function sleep (ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor (fn, { timeoutMs = 10000, intervalMs = 50 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await sleep(intervalMs);
  }
  throw new Error('waitFor timeout');
}

test('first-time start reads the full Game.log into cumulative history', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-first-hist-'));
  const logfile = path.join(dir, 'Game.log');
  fs.copyFileSync(FIXTURE, logfile);

  const svc = new LiveRelay({
    port: 0,
    logfile,
    seed: null,
    settingsDir: dir,
    historyFile: path.join(dir, 'history.json'),
    cursorsFile: path.join(dir, 'log-cursors.json'),
    missions: { enable: false },
    fabric: { enable: false },
    discord: { enable: false },
    reparse: { dirs: [dir] }
  });
  await svc.start();
  try {
    assert.strictEqual(svc._historySync.status, 'done');
    assert.ok((svc.history.missions || []).length >= 3, 'missions from full file');
    assert.ok((svc.history.deaths || []).length >= 2, 'deaths from full file');
    const st = fs.statSync(logfile);
    const key = fs.realpathSync(logfile);
    const cur = svc._logCursors[key];
    assert.ok(cur, 'cursor recorded');
    assert.strictEqual(cur.size, st.size, 'cursor consumed entire file');
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('enabling shareLogsGlobal after history load queues historical events', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-hist-share-'));
  const logfile = path.join(dir, 'Game.log');
  fs.copyFileSync(FIXTURE, logfile);
  const identity = createIdentity();

  const svc = new LiveRelay({
    port: 0,
    logfile,
    seed: null,
    settingsDir: dir,
    historyFile: path.join(dir, 'history.json'),
    cursorsFile: path.join(dir, 'log-cursors.json'),
    missions: { enable: false },
    peers: [{ address: '127.0.0.1:1' }],
    uplink: { intervalMs: 3600000 },
    fabric: { enable: false },
    discord: { enable: false },
    reparse: { dirs: [dir] }
  });
  await svc.start();
  const port = svc.server.address().port;
  try {
    assert.ok((svc.history.missions || []).length >= 3);
    assert.strictEqual(svc._uplinkQueue.length, 0, 'nothing queued before share');

    svc.setIdentity(identity);
    const put = await request(port, 'PUT', '/settings/shareLogsGlobal', { value: true });
    assert.strictEqual(put.status, 200, JSON.stringify(put.body));
    assert.strictEqual(svc._shareLogsGlobal, true);

    await waitFor(() => svc._uplinkQueue.some((e) => e.collection === 'missionlog'));
    assert.ok(
      svc._uplinkQueue.filter((e) => e.collection === 'missionlog').length >= 3,
      'historical missions queued: ' + svc._uplinkQueue.length
    );
    assert.ok(svc._uplinkQueue.some((e) => e.collection === 'deaths'));
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('share enabled during corpus sync flushes history after sync completes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-share-pending-'));
  const logfile = path.join(dir, 'Game.log');
  fs.copyFileSync(FIXTURE, logfile);

  const svc = new LiveRelay({
    port: 0,
    logfile,
    seed: null,
    settingsDir: dir,
    historyFile: path.join(dir, 'history.json'),
    cursorsFile: path.join(dir, 'log-cursors.json'),
    missions: { enable: false },
    peers: [{ address: '127.0.0.1:1' }],
    uplink: { intervalMs: 3600000 },
    fabric: { enable: false },
    discord: { enable: false },
    reparse: { dirs: [dir] }
  });

  const identity = createIdentity();
  let sawRunningOrIdle = false;
  svc.on('listening', () => {
    // Consent + identity while first corpus sync has not finished yet.
    svc._shareLogsGlobal = true;
    sawRunningOrIdle = svc._historySync.status !== 'done';
    svc.setIdentity(identity);
    svc._requestHistoricalLogShare();
    assert.strictEqual(svc._pendingHistoricalShare, true,
      'historical share waits until corpus sync status is done');
  });

  await svc.start();
  try {
    assert.ok(sawRunningOrIdle, 'listening fired before sync marked done');
    assert.strictEqual(svc._historySync.status, 'done');
    await waitFor(() => svc._uplinkQueue.some((e) => e.collection === 'missionlog'));
    assert.ok(
      (svc.history.missions || []).length >= 3,
      'full fixture folded into history before share flush'
    );
    assert.strictEqual(svc._pendingHistoricalShare, false);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
