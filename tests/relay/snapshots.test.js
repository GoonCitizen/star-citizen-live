'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const SnapshotManager = require('../../services/SnapshotManager');
const { Store } = require('../../types/Store');

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-snaps-'));
}

/** Fake platform capture: returns a buffer of the requested size. */
function fakeCapture (bytes = 1000) {
  return async () => ({ buffer: Buffer.alloc(bytes, 7), width: 640, height: 360 });
}

function request (port, method, reqPath, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers: { 'Content-Type': 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        type: res.headers['content-type'],
        raw: Buffer.concat(chunks),
        get body () { return this.raw.length ? JSON.parse(this.raw.toString()) : null; }
      }));
    });
    req.on('error', reject);
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}

test('SnapshotManager: snap writes a reduced image + metadata record', async () => {
  const dir = tmpDir();
  const store = new Store({});
  const sm = new SnapshotManager({ store, dir: path.join(dir, 'snapshots'), capture: fakeCapture(2048) });
  sm.configure({ enabled: true, intervalMs: 10000 });

  const record = await sm.snap();
  assert.ok(record, 'snap returns the record');
  assert.strictEqual(record.bytes, 2048);
  assert.strictEqual(record.width, 640);
  assert.ok(fs.existsSync(path.join(dir, 'snapshots', record.file)), 'image written');
  assert.strictEqual(store.all('snapshots').length, 1, 'metadata in the Fabric Store');
  assert.strictEqual(sm.imagePath(record.id), path.join(dir, 'snapshots', record.file));

  const stats = sm.stats();
  assert.strictEqual(stats.count, 1);
  assert.strictEqual(stats.bytes, 2048);
  sm.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SnapshotManager: auto-purge deletes oldest snapshots beyond the disk cap', async () => {
  const dir = tmpDir();
  const store = new Store({});
  const sm = new SnapshotManager({ store, dir: path.join(dir, 'snapshots'), capture: fakeCapture(1000) });
  // Cap fits three 1000-byte snapshots.
  sm.configure({ enabled: true, autoPurge: true, maxBytes: 3000 });

  const records = [];
  for (let i = 0; i < 5; i++) {
    records.push(await sm.snap());
    await new Promise((r) => setTimeout(r, 2)); // distinct timestamps
  }

  const kept = sm.list();
  assert.strictEqual(kept.length, 3, 'purged down to the cap');
  assert.ok(!kept.some((s) => s.id === records[0].id), 'oldest removed');
  assert.ok(!fs.existsSync(path.join(dir, 'snapshots', records[0].file)), 'oldest file deleted');
  assert.ok(kept.some((s) => s.id === records[4].id), 'newest kept');

  // purgeAll clears everything.
  assert.strictEqual(sm.purgeAll(), 3);
  assert.strictEqual(sm.stats().count, 0);
  sm.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SnapshotManager: disabled without capture fn; interval clamps to minimum', () => {
  const sm = new SnapshotManager({ store: new Store({}), dir: null });
  sm.configure({ enabled: true, intervalMs: 1 });
  assert.strictEqual(sm.active, false, 'no capture fn + no dir → idle');
  assert.strictEqual(sm.config.intervalMs, SnapshotManager.MIN_INTERVAL_MS, 'interval clamped');
  const stats = sm.stats();
  assert.strictEqual(stats.available, false);
  sm.stop();
});

test('REST: snapshot settings apply live; list, image and purge endpoints work', async () => {
  const dir = tmpDir();
  const svc = new LiveRelay({ port: 0, settingsDir: dir, missions: { enable: false } });
  await svc.start();
  svc.setSnapshotCapture(fakeCapture(1500));
  const port = svc.server.address().port;
  try {
    // Off by default (opt-in).
    assert.strictEqual(svc.snapshotManager.config.enabled, false);

    // Enable + tune via the settings API — applies live, no restart flag.
    const en = await request(port, 'PUT', '/settings/snapshotsEnabled', { value: true });
    assert.strictEqual(en.status, 200);
    assert.strictEqual(en.body.requiresRestart, false);
    await request(port, 'PUT', '/settings/snapshotIntervalSeconds', { value: 5 });
    await request(port, 'PUT', '/settings/snapshotMaxMB', { value: 64 });
    assert.strictEqual(svc.snapshotManager.config.enabled, true);
    assert.strictEqual(svc.snapshotManager.config.intervalMs, 5000);
    assert.strictEqual(svc.snapshotManager.config.maxBytes, 64 * 1024 * 1024);
    assert.strictEqual(svc.snapshotManager.active, true, 'timer armed once enabled + capture available');

    // Capture two snapshots (directly — no waiting on timers).
    const a = await svc.snapshotManager.snap();
    await new Promise((r) => setTimeout(r, 2));
    const b = await svc.snapshotManager.snap();

    const list = await request(port, 'GET', '/services/star-citizen/snapshots');
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.data.length, 2);
    assert.strictEqual(list.body.data[0].id, b.id, 'newest first');
    assert.strictEqual(list.body.stats.count, 2);

    const img = await request(port, 'GET', `/services/star-citizen/snapshots/${a.id}/image`);
    assert.strictEqual(img.status, 200);
    assert.match(img.type, /image\/jpeg/);
    assert.strictEqual(img.raw.length, 1500, 'serves the stored image bytes');

    const missing = await request(port, 'GET', '/services/star-citizen/snapshots/nope/image');
    assert.strictEqual(missing.status, 404);

    // Purge all via REST.
    const purge = await request(port, 'DELETE', '/services/star-citizen/snapshots');
    assert.strictEqual(purge.body.removed, 2);
    assert.strictEqual((await request(port, 'GET', '/services/star-citizen/snapshots')).body.data.length, 0);

    // Settings runtime exposes snapshot stats for the UI.
    const settings = await request(port, 'GET', '/settings');
    assert.ok(settings.body.runtime.snapshots);
    assert.strictEqual(settings.body.runtime.snapshots.enabled, true);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('snapshot metadata persists across relay restarts (Fabric Store)', async () => {
  const dir = tmpDir();
  const boot = async () => {
    const svc = new LiveRelay({ port: 0, settingsDir: dir, missions: { enable: false } });
    await svc.start();
    svc.setSnapshotCapture(fakeCapture(800));
    return svc;
  };

  const first = await boot();
  let id;
  try {
    first.snapshotManager.configure({ enabled: true });
    id = (await first.snapshotManager.snap()).id;
  } finally { await first.stop(); }

  const second = await boot();
  try {
    const list = second.snapshotManager.list();
    assert.strictEqual(list.length, 1, 'metadata reloaded from the Fabric Store');
    assert.strictEqual(list[0].id, id);
    assert.ok(second.snapshotManager.imagePath(id), 'image still on disk');
  } finally {
    await second.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
