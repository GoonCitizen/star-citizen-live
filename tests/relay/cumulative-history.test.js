'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cumulativeHistory = require('../../functions/cumulativeHistory');
const LiveRelay = require('../../services/LiveRelay');

const FIXTURE = path.join(__dirname, 'fixtures', 'sample-missions.log');

test('cumulativeHistory ingest is idempotent across re-sync', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-hist-'));
  const historyFile = path.join(dir, 'history.json');
  const cursorsFile = path.join(dir, 'log-cursors.json');
  const history = cumulativeHistory.emptyHistory();
  const cursors = {};

  const first = await cumulativeHistory.syncFiles([FIXTURE], history, cursors);
  assert.ok(first.changed || first.lines > 0);
  assert.strictEqual(history.missions.length, 3);
  assert.strictEqual(history.deaths.length, 2);
  cumulativeHistory.saveHistory(historyFile, history);
  cumulativeHistory.saveCursors(cursorsFile, cursors);

  const again = cumulativeHistory.loadHistory(historyFile);
  const cursors2 = cumulativeHistory.loadCursors(cursorsFile);
  const second = await cumulativeHistory.syncFiles([FIXTURE], again, cursors2);
  assert.strictEqual(second.lines, 0, 'cursor skips already-consumed bytes');
  assert.strictEqual(again.missions.length, 3, 'no duplicate missions');
  assert.strictEqual(again.deaths.length, 2, 'no duplicate deaths');
});

test('LiveRelay start syncs cumulative history and exposes it on monitor/analytics', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-relay-hist-'));
  const logCopy = path.join(dir, 'Game.log');
  fs.copyFileSync(FIXTURE, logCopy);

  const svc = new LiveRelay({
    port: 0,
    logfile: logCopy,
    seed: logCopy,
    settingsDir: dir,
    historyFile: path.join(dir, 'history.json'),
    cursorsFile: path.join(dir, 'log-cursors.json'),
    missions: { enable: false },
    fabric: { enable: false },
    reparse: { dirs: [dir] }
  });

  await svc.start();
  try {
    assert.ok(fs.existsSync(path.join(dir, 'history.json')), 'history persisted');
    assert.ok(svc.history.missions.length >= 3);
    assert.ok(svc.history.deaths.length >= 2);

    const analytics = svc._analyticsDataset();
    assert.strictEqual(analytics.cumulative, true);
    assert.ok(analytics.counts.missions >= 3);
    assert.ok(analytics.deaths.length >= 2);

    // Second start: cursor catch-up, history stays stable.
    await svc.stop();
    const svc2 = new LiveRelay({
      port: 0,
      logfile: logCopy,
      seed: logCopy,
      settingsDir: dir,
      historyFile: path.join(dir, 'history.json'),
      cursorsFile: path.join(dir, 'log-cursors.json'),
      missions: { enable: false },
      fabric: { enable: false },
      reparse: { dirs: [dir] }
    });
    await svc2.start();
    try {
      assert.strictEqual(svc2.history.missions.length, svc.history.missions.length);
      assert.strictEqual(svc2.history.deaths.length, svc.history.deaths.length);
      const c = require('../../functions/cumulativeHistory').cumulativeCounts(svc2.history);
      // monitor-shaped counts use cumulative for the header fields
      assert.ok(c.missions >= 3);
      assert.ok(c.deaths >= 2);
    } finally {
      await svc2.stop();
    }
  } finally {
    if (svc.status !== 'STOPPED') await svc.stop();
  }
});

test('live handleLogChange folds into cumulative history after start', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-live-hist-'));
  const logCopy = path.join(dir, 'Game.log');
  fs.writeFileSync(logCopy, '');

  const svc = new LiveRelay({
    port: 0,
    logfile: logCopy,
    seed: null,
    settingsDir: dir,
    historyFile: path.join(dir, 'history.json'),
    cursorsFile: path.join(dir, 'log-cursors.json'),
    missions: { enable: false },
    fabric: { enable: false },
    reparse: { dirs: [] }
  });
  await svc.start();
  try {
    assert.strictEqual(svc._historyApplyLive, true);
    const beforeM = svc.history.missions.length;
    const beforeD = svc.history.deaths.length;
    await svc.replayLog(FIXTURE);
    assert.ok(svc.history.missions.length > beforeM, 'live mission ends accumulate');
    assert.ok(svc.history.deaths.length > beforeD, 'live deaths accumulate');
    svc._flushHistory();
    const disk = cumulativeHistory.loadHistory(path.join(dir, 'history.json'));
    assert.ok(disk.missions.length >= svc.history.missions.length - 0);
    assert.ok(disk.deaths.length >= beforeD);
  } finally {
    await svc.stop();
  }
});