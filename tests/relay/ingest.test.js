'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity, signEnvelope } = require('../../functions/identity');

const BASE = '/services/star-citizen';

function request (port, method, path, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}

async function startServer (extra = {}) {
  const base = {
    port: 0,
    mode: 'server',
    missions: { enable: true },
    ingest: { httpEnable: true }
  };
  const merged = Object.assign({}, base, extra);
  merged.ingest = Object.assign({}, base.ingest, extra.ingest || {});
  const svc = new LiveRelay(merged);
  await svc.start();
  return { svc, port: svc.server.address().port };
}

test('server mode rejects unsigned batch and single-event POSTs', async () => {
  const { svc, port } = await startServer();
  try {
    const batch = await request(port, 'POST', `${BASE}/events`, { events: [] });
    assert.strictEqual(batch.status, 401);

    const single = await request(port, 'POST', `${BASE}/kills`, { killer: 'x', victim: 'y' });
    assert.strictEqual(single.status, 401);
  } finally { await svc.stop(); }
});

test('server mode accepts a signed batch, tags source, and is idempotent', async () => {
  const { svc, port } = await startServer();
  const identity = createIdentity();
  try {
    const events = [
      { collection: 'kills', data: { killer: 'Alice', victim: 'PirateNPC', timestamp: '2026-07-19T12:00:00Z' } },
      { collection: 'deaths', data: { player: 'Alice', timestamp: '2026-07-19T12:05:00Z' } },
      { collection: 'players', data: { name: 'Alice', timestamp: '2026-07-19T12:00:00Z' } }
    ];
    const envelope = signEnvelope(identity, { events, sentAt: 'x' });

    const first = await request(port, 'POST', `${BASE}/events`, envelope);
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.received, 3);
    assert.strictEqual(first.body.created, 2, 'kills + deaths created (players is a roster upsert)');

    // Same batch replayed: nothing new is created.
    const second = await request(port, 'POST', `${BASE}/events`, envelope);
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.created, 0, 'replay is idempotent');

    const kills = await request(port, 'GET', `${BASE}/kills`);
    assert.strictEqual(kills.body.data.length, 1);
    assert.strictEqual(kills.body.data[0].source, identity.pubkey, 'kill tagged with sender pubkey');

    const players = await request(port, 'GET', `${BASE}/players`);
    assert.strictEqual(players.body.data.length, 1);
    assert.strictEqual(players.body.data[0].name, 'Alice');
  } finally { await svc.stop(); }
});

test('tampered signed batch is rejected', async () => {
  const { svc, port } = await startServer();
  const identity = createIdentity();
  try {
    const envelope = signEnvelope(identity, { events: [{ collection: 'kills', data: { killer: 'a', victim: 'b' } }] });
    envelope.payload.events[0].data.killer = 'evil';
    const res = await request(port, 'POST', `${BASE}/events`, envelope);
    assert.strictEqual(res.status, 401);
  } finally { await svc.stop(); }
});

test('roster allowlist rejects unknown sender keys', async () => {
  const trusted = createIdentity();
  const stranger = createIdentity();
  const { svc, port } = await startServer({ ingest: { allowedKeys: [trusted.pubkey] } });
  try {
    const ok = await request(port, 'POST', `${BASE}/events`,
      signEnvelope(trusted, { events: [{ collection: 'kills', data: { killer: 'a', victim: 'b' } }] }));
    assert.strictEqual(ok.status, 200);

    const denied = await request(port, 'POST', `${BASE}/events`,
      signEnvelope(stranger, { events: [{ collection: 'kills', data: { killer: 'c', victim: 'd' } }] }));
    assert.strictEqual(denied.status, 403);
  } finally { await svc.stop(); }
});

test('relay mode still accepts plain unsigned POSTs (local compatibility)', async () => {
  const svc = new LiveRelay({ port: 0, missions: { enable: false } });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const res = await request(port, 'POST', `${BASE}/kills`, { killer: 'a', victim: 'b' });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data.id);
  } finally { await svc.stop(); }
});

test('apiHandler embeds into a host server and ignores foreign paths', async () => {
  const svc = new LiveRelay({ port: 0, mode: 'server', listen: false, missions: { enable: false } });
  await svc.start();
  assert.strictEqual(svc.server, null, 'no own listener in embedded mode');

  const handler = svc.apiHandler();
  const host = http.createServer(async (req, res) => {
    const handled = await handler(req, res);
    if (!handled) { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('host-page'); }
  });
  await new Promise((r) => host.listen(0, r));
  const port = host.address().port;
  try {
    const api = await request(port, 'GET', BASE);
    assert.strictEqual(api.status, 200);
    assert.strictEqual(api.body.type, 'StarCitizen');

    const other = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/somewhere-else' }, (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => resolve(buf));
      }).on('error', reject);
    });
    assert.strictEqual(other, 'host-page', 'foreign path falls through to host');
  } finally {
    await new Promise((r) => host.close(r));
    await svc.stop();
  }
});

test('server mode does not tail logs and skips seeding', async () => {
  const svc = new LiveRelay({ port: 0, mode: 'server', logfile: '/nonexistent/Game.log', seed: '/nonexistent/Game.log', missions: { enable: false } });
  await svc.start();
  try {
    assert.strictEqual(svc._pollTimer, null, 'no log poll timer in server mode');
    assert.strictEqual(svc.logs.length, 0, 'no seeded lines');
  } finally { await svc.stop(); }
});

test('hosted HTTP ingest still accepts Schnorr-signed event batches (legacy/tests)', async () => {
  const identity = createIdentity();
  const { svc: server, port } = await startServer({ ingest: { allowedKeys: [identity.pubkey] } });
  try {
    const events = [{
      collection: 'kills',
      data: {
        victim: 'Victim',
        killer: 'Killer',
        weapon: 'Gun',
        zone: 'Zone',
        timestamp: '2026-07-19T12:00:00.000Z'
      }
    }];
    const envelope = signEnvelope(identity, { events, sentAt: new Date().toISOString() });
    const posted = await request(port, 'POST', `${BASE}/events`, envelope);
    assert.strictEqual(posted.status, 200, JSON.stringify(posted.body));
    assert.ok(posted.body.created >= 1);

    const kills = await request(port, 'GET', `${BASE}/kills`);
    assert.strictEqual(kills.body.data[0].source, identity.pubkey);
  } finally {
    await server.stop();
  }
});

test('HTTP event ingest is disabled by default (Fabric-only path)', async () => {
  const identity = createIdentity();
  const svc = new LiveRelay({ port: 0, mode: 'server', missions: { enable: false } });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const envelope = signEnvelope(identity, {
      events: [{ collection: 'kills', data: { killer: 'a', victim: 'b' } }]
    });
    const res = await request(port, 'POST', `${BASE}/events`, envelope);
    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /HTTP event ingest is disabled/i);
  } finally {
    await svc.stop();
  }
});
