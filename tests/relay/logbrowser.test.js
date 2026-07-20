'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const { RULES } = require('../../functions/parser');

const BASE = '/services/star-citizen';

function request (port, method, reqPath, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}

const SAMPLE_LOG = [
  '<2026-07-19T13:00:00.000Z> [Notice] <Legacy login response> User Login Success - Handle[TestPilot]',
  '<2026-07-19T13:00:01.000Z> [Notice] plain line one',
  "<2026-07-19T13:00:02.000Z> [Notice] <Actor Death> CActor::Kill: 'V' [1] in zone 'Z' killed by 'K' [2] using 'G' [Class R] with damage type 'B' from direction x: 0.1, y: 0.2, z: 0.3",
  '<2026-07-19T13:00:03.000Z> [Notice] plain line two'
].join('\n') + '\n';

function tmpLog () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-log-'));
  const file = path.join(dir, 'Game.log');
  fs.writeFileSync(file, SAMPLE_LOG);
  return { dir, file };
}

test('rules endpoint lists the parser regexes with verified flags', async () => {
  const svc = new LiveRelay({ port: 0, missions: { enable: false } });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const res = await request(port, 'GET', `${BASE}/rules`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.length, RULES.length);
    const login = res.body.data.find((r) => r.kind === 'player:login');
    assert.ok(login, 'login rule exposed');
    assert.match(login.pattern, /User Login Success/);
    assert.strictEqual(typeof login.verified, 'boolean');
    // Every pattern must compile client-side.
    for (const r of res.body.data) assert.doesNotThrow(() => new RegExp(r.pattern, r.flags || ''));
  } finally { await svc.stop(); }
});

test('loginfo + logslice expose and browse the located Game.log', async () => {
  const { dir, file } = tmpLog();
  const svc = new LiveRelay({ port: 0, logfile: file, seed: null, missions: { enable: false } });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const info = await request(port, 'GET', `${BASE}/loginfo`);
    assert.strictEqual(info.status, 200);
    assert.strictEqual(info.body.data.path, file);
    assert.strictEqual(info.body.data.exists, true);
    assert.strictEqual(info.body.data.size, Buffer.byteLength(SAMPLE_LOG));

    // Monitor carries the same info for the dashboard poll.
    const mon = await request(port, 'GET', `${BASE}/monitor?limit=10`);
    assert.strictEqual(mon.body.loginfo.exists, true);
    assert.ok(mon.body.reparse, 'reparse status included');

    // Tail slice (default start=end window).
    const tail = await request(port, 'GET', `${BASE}/logslice?bytes=1024`);
    assert.strictEqual(tail.status, 200);
    assert.ok(tail.body.data.text.includes('plain line two'));
    assert.strictEqual(tail.body.data.end, Buffer.byteLength(SAMPLE_LOG));

    // Paged slice from the very start.
    const head = await request(port, 'GET', `${BASE}/logslice?start=0&bytes=2048`);
    assert.ok(head.body.data.text.startsWith('<2026-07-19T13:00:00.000Z>'));
    assert.strictEqual(head.body.data.start, 0);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('logslice 404s when no Game.log is visible', async () => {
  const svc = new LiveRelay({ port: 0, logfile: '/nonexistent/Game.log', seed: null, missions: { enable: false } });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const res = await request(port, 'GET', `${BASE}/logslice`);
    assert.strictEqual(res.status, 404);
    const info = await request(port, 'GET', `${BASE}/loginfo`);
    assert.strictEqual(info.body.data.exists, false);
  } finally { await svc.stop(); }
});

test('reparse walks the log oldest-first with a deterministic per-entry digest', async () => {
  const { dir, file } = tmpLog();
  // Add an OLDER backup log so ordering + multi-file counting are exercised.
  const backupDir = path.join(dir, 'logbackups');
  fs.mkdirSync(backupDir);
  const oldLog = path.join(backupDir, 'old.log');
  fs.writeFileSync(oldLog, '<2026-07-18T10:00:00.000Z> [Notice] <Legacy login response> User Login Success - Handle[OldPilot]\n');
  fs.utimesSync(oldLog, new Date('2026-07-18'), new Date('2026-07-18'));

  const svc = new LiveRelay({ port: 0, logfile: file, seed: null, missions: { enable: false }, reparse: { dirs: [backupDir] } });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const started = await request(port, 'POST', `${BASE}/reparse`);
    assert.strictEqual(started.status, 200);

    // Wait for the async job to finish.
    let job;
    for (let i = 0; i < 100; i++) {
      job = (await request(port, 'GET', `${BASE}/reparse`)).body.data;
      if (job.status === 'done' || job.status === 'error') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.strictEqual(job.status, 'done', JSON.stringify(job));
    assert.strictEqual(job.files, 2, 'backup log + live log');
    assert.strictEqual(job.lines, 5, 'counted every line across both files');
    assert.strictEqual(job.entries, 3, 'login (old) + login + kill');
    assert.strictEqual(job.byKind['player:login'], 2);
    assert.strictEqual(job.byKind.kill, 1);
    assert.match(job.digest, /^[0-9a-f]{64}$/, 'chain digest');

    // Determinism: a second run over the same corpus yields the same digest.
    await request(port, 'POST', `${BASE}/reparse`);
    let again;
    for (let i = 0; i < 100; i++) {
      again = (await request(port, 'GET', `${BASE}/reparse`)).body.data;
      if (again.status === 'done') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.strictEqual(again.digest, job.digest, 'deterministic Fabric message chain');
    assert.strictEqual(again.lines, job.lines);
    assert.strictEqual(again.entries, job.entries);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
