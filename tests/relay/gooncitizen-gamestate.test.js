'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gooncitizenGameState = require('../../functions/gooncitizenGameState');
const cumulativeHistory = require('../../functions/cumulativeHistory');
const LiveRelay = require('../../services/LiveRelay');

const FIXTURE = path.join(__dirname, 'fixtures', 'sample-missions.log');

test('buildGameStateSnapshot is deterministic for same history', async () => {
  const history = cumulativeHistory.emptyHistory();
  const cursors = {};
  await cumulativeHistory.syncFiles([FIXTURE], history, cursors);
  const a = gooncitizenGameState.buildGameStateSnapshot(history);
  const b = gooncitizenGameState.buildGameStateSnapshot(history);
  assert.strictEqual(a['@type'], 'GoonCitizenGameState');
  assert.strictEqual(a.schemaVersion, 1);
  assert.ok(a.contractId);
  assert.strictEqual(a.counts.missions, 3);
  assert.strictEqual(a.counts.deaths, 2);
  assert.strictEqual(a.digest, b.digest);
  const patches = gooncitizenGameState.patchesForGameState({}, a);
  assert.strictEqual(patches[0].op, 'add');
  assert.strictEqual(patches[0].path, '/services');
  assert.strictEqual(patches[0].value.rsi, a);
  assert.ok(patches.some((p) => p.path === '/namespaces'), 'D-016 parent seal');
  const ns = patches.find((p) => p.path === '/namespaces');
  assert.deepStrictEqual(
    gooncitizenGameState.patchesForGameState({ services: { rsi: a }, namespaces: ns.value }, a),
    [],
    'identical digest is a no-op patch'
  );
});

test('LiveRelay server mode aggregates GameStateSnapshot into durable history', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-gs-'));
  const svc = new LiveRelay({
    port: 0,
    mode: 'server',
    listen: false,
    settingsDir: dir,
    historyFile: path.join(dir, 'history.json'),
    cursorsFile: path.join(dir, 'log-cursors.json'),
    missions: { enable: false },
    fabric: { enable: false }
  });
  await svc.start();
  try {
    const history = cumulativeHistory.emptyHistory();
    const cursors = {};
    await cumulativeHistory.syncFiles([FIXTURE], history, cursors);
    const snap = gooncitizenGameState.buildGameStateSnapshot(history, { source: '02abc' });
    const r = svc.ingestGameStateSnapshot('02abc', snap);
    assert.strictEqual(r.changed, true);
    assert.ok(svc.history.missions.length >= 3);
    const built = svc.buildGameStateSnapshot();
    assert.ok(built.digest);
    assert.ok(built.counts.missions >= 3);
  } finally {
    await svc.stop();
  }
});
