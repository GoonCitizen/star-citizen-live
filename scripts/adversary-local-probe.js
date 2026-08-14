'use strict';

/**
 * Adversarial mesh probe — dials Fabric peers and hammers an HTTP surface.
 *
 * Default is loopback. Public playnet (crash logs / recovery reports):
 *   node scripts/adversary-local-probe.js --production
 *   ADV_HTTP=https://relay.goon.vc ADV_FABRIC=hub.fabric.pub:7777,relay.goon.vc:7777
 *
 * Does not ingest or send OpenSSF / GHSA advisory dumps.
 * `--production` dials Hub/RSI with `@fabric/core` Peer (no local LiveRelay).
 *
 * Usage: node scripts/adversary-local-probe.js [--production]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');

const LiveRelay = require('../services/LiveRelay');
const { createIdentity } = require('../functions/identity');

const PRODUCTION = process.argv.includes('--production') ||
  process.env.ADV_PRODUCTION === '1' ||
  process.env.ADV_PRODUCTION === 'true';

const TARGET_HTTP = process.env.ADV_HTTP ||
  (PRODUCTION ? 'https://relay.goon.vc' : 'http://127.0.0.1:3041');
const TARGET_FABRIC = (process.env.ADV_FABRIC ||
  (PRODUCTION ? 'hub.fabric.pub:7777,relay.goon.vc:7777' : '127.0.0.1:7778,127.0.0.1:7777'))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const findings = [];

function note (severity, title, detail) {
  const row = { severity, title, detail, at: new Date().toISOString() };
  findings.push(row);
  console.log(`[${severity}] ${title}${detail ? ' — ' + detail : ''}`);
}

function request (baseUrl, method, reqPath, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl);
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    const body = payload != null ? JSON.stringify(payload) : null;
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      host: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      method,
      path: reqPath,
      headers,
      timeout: 12000
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = buf ? JSON.parse(buf) : null; } catch (_) { parsed = buf; }
        resolve({ status: res.statusCode, body: parsed, raw: buf });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function probeHttp () {
  console.log('\n=== HTTP surface @', TARGET_HTTP, '===\n');
  const base = '/services/star-citizen';

  const status = await request(TARGET_HTTP, 'GET', base);
  note(status.status === 200 ? 'info' : 'warn', 'GET status', String(status.status));

  // Unauthenticated chat post — should not speak as operator on shared bind.
  const chat = await request(TARGET_HTTP, 'POST', `${base}/chat/messages`, {
    channel: 'global',
    body: 'adv-probe ' + Date.now()
  });
  if (chat.status === 200 && chat.body && chat.body.data) {
    note('blocker', 'Unauthenticated POST /chat/messages succeeds',
      'author=' + (chat.body.data.author || '').slice(0, 16) +
      ' handle=' + (chat.body.data.handle || '') +
      ' — LAN clients on shared HTTP bind as the unlocked identity');
  } else {
    note('ok', 'Chat POST without auth rejected', String(chat.status) + ' ' + (chat.body && chat.body.error));
  }

  // Group channel write as outsider
  const channels = await request(TARGET_HTTP, 'GET', `${base}/chat/channels`);
  const group = ((channels.body && channels.body.data) || []).find((c) => c.kind === 'group');
  if (group) {
    const gPost = await request(TARGET_HTTP, 'POST', `${base}/chat/messages`, {
      channel: group.key,
      body: 'adv-group-intrusion ' + Date.now()
    });
    if (gPost.status === 200) {
      note('important', 'Group chat POST without membership check (local mode)',
        group.key + ' accepted body from unauthenticated HTTP');
    } else {
      note('ok', 'Group chat POST blocked', String(gPost.status) + ' ' + (gPost.body && gPost.body.error));
    }
  }

  // Settings / secrets scrape
  for (const p of [
    '/settings',
    `${base}/discord/guilds`,
    `${base}/groups`,
    `${base}/missions`,
    `${base}/peers`,
    `${base}/presence/roster`
  ]) {
    const r = await request(TARGET_HTTP, 'GET', p);
    const leak = r.status === 200 ? summarizeLeak(p, r.body) : null;
    if (leak) note('important', 'Readable without auth: ' + p, leak);
    else note('info', 'GET ' + p, String(r.status));
  }

  // Officer / mutate probes
  const mission = await request(TARGET_HTTP, 'POST', `${base}/missions`, {
    title: 'adv-fake-mission',
    description: 'should fail without officer'
  });
  note(mission.status >= 400 ? 'ok' : 'important', 'POST /missions',
    String(mission.status) + ' ' + ((mission.body && mission.body.error) || 'accepted'));
}

function summarizeLeak (p, body) {
  if (!body) return 'empty';
  if (p.includes('discord')) {
    const d = body.data || body;
    return 'botReady=' + d.botReady + ' guilds=' + ((d.guilds && d.guilds.length) || 0);
  }
  if (p.includes('groups')) {
    const list = body.data || [];
    return 'groups=' + list.length + (list[0] ? (' first=' + list[0].name) : '');
  }
  if (p.includes('peers')) {
    return 'peers=' + ((body.data && body.data.length) || 0);
  }
  if (p === '/settings') {
    const s = body.settings || body;
    const keys = Object.keys(s || {}).slice(0, 12).join(',');
    return 'keys=' + keys;
  }
  return 'ok';
}

async function spawnFabricNeighbors (n = 2) {
  const Peer = require('@fabric/core/types/peer');
  const Message = require('@fabric/core/types/message');
  const Key = require('@fabric/core/types/key');

  console.log('\n=== Fabric neighbors dialing', TARGET_FABRIC.join(', '), '===\n');
  const peers = [];
  const stormTypes = ['P2P_PING', 'P2P_CHAT_MESSAGE', 'P2P_PEER_GOSSIP', 'P2P_PEERING_OFFER'];

  for (let i = 0; i < n; i++) {
    const key = new Key();
    const client = new Peer({
      listen: false,
      networking: true,
      peers: TARGET_FABRIC,
      key: { xprv: key.xprv },
      peersDb: null,
      reconnectToKnownPeers: false
    });
    const hard = [];
    client.on('error', (err) => {
      const msg = err && (err.message || String(err));
      if (msg && /Attempted to write to a closed|ECONNRESET|EPIPE/i.test(msg)) return;
      hard.push(msg);
    });
    await client.start();
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && Object.keys(client.connections || {}).length < 1) {
      await new Promise((r) => setTimeout(r, 250));
    }
    const conns = Object.keys(client.connections || {});
    note(conns.length ? 'info' : 'warn', 'Neighbor ' + i + ' mesh',
      'pubkey=' + String(key.pubkey || '').slice(0, 16) + '… connected=' + conns.length +
      (conns[0] ? (' first=' + conns[0]) : ''));

    let writes = 0;
    for (let k = 0; k < 8 && conns.length; k++) {
      const t = stormTypes[k % stormTypes.length];
      const body = t === 'P2P_CHAT_MESSAGE'
        ? ('adv-neighbor-' + i + '-' + k)
        : JSON.stringify({ type: t, nonce: 'adv-' + i + '-' + k, created: new Date().toISOString() });
      try {
        const msg = Message.fromVector([t, body]).signWithKey(client.key);
        const conn = client.connections[conns[0]];
        if (conn && typeof conn._writeFabric === 'function') {
          conn._writeFabric(msg.toBuffer());
          writes += 1;
        }
      } catch (e) {
        note('warn', 'Neighbor write failed', e.message || String(e));
      }
    }
    note('info', 'Neighbor ' + i + ' signed writes', String(writes));
    if (hard.length) note('warn', 'Neighbor ' + i + ' hard errors', hard.slice(0, 3).join('; '));
    peers.push({ client, key });
  }
  return peers;
}

async function spawnAdversaryPeers (n = 3) {
  console.log('\n=== Fabric adversaries dialing', TARGET_FABRIC.join(', '), '===\n');
  const peers = [];
  // Top-level `peers` (not fabric.peers) drives the operator roster; empty
  // array would still re-seed hubs — pass explicit loopback targets only.
  const roster = TARGET_FABRIC.map((address) => ({
    address,
    label: 'adv-target',
    enabled: true,
    shareLogs: false
  }));
  for (let i = 0; i < n; i++) {
    const id = createIdentity();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-adv-' + i + '-'));
    const fabricPort = 18000 + i;
    const httpPort = 0;
    const svc = new LiveRelay({
      port: httpPort,
      listen: true,
      mode: 'relay',
      settingsDir: dir,
      peers: roster,
      fabric: {
        enable: true,
        listen: true,
        port: fabricPort,
        interface: '127.0.0.1'
      },
      missions: { enable: false },
      discord: { enable: false }
    });
    await svc.start();
    svc.setIdentity(id);
    peers.push({ svc, dir, id, fabricPort });
    note('info', 'Adversary peer up',
      'fabric=127.0.0.1:' + fabricPort +
      ' dial=' + svc._fabricPeerAddresses().join(',') +
      ' pubkey=' + id.pubkey.slice(0, 16) + '…');
  }

  // Wait for dial / NOISE handshake
  await new Promise((r) => setTimeout(r, 8000));

  for (const p of peers) {
    const net = p.svc.fabricNetwork;
    const connected = net && typeof net.listPeers === 'function'
      ? (net.listPeers() || []).filter((x) => x && x.connected)
      : [];
    const ready = !!(net && net.ready);
    note(connected.length ? 'info' : 'warn',
      'Adversary mesh state ' + p.fabricPort,
      'ready=' + ready + ' connected=' + connected.length +
      (connected[0] ? (' first=' + (connected[0].address || connected[0].id || '')) : ''));

    // Flood signed global chat from adversary identity via its own HTTP
    const port = p.svc.server && p.svc.server.address() && p.svc.server.address().port;
    if (port) {
      for (let k = 0; k < 5; k++) {
        await request('http://127.0.0.1:' + port, 'POST',
          '/services/star-citizen/chat/messages',
          { channel: 'global', body: 'adv-flood-' + p.fabricPort + '-' + k });
      }
      note('info', 'Flooded 5 global msgs from adversary HTTP', String(p.fabricPort));
    }
  }

  // Did adversary flood land on the desktop chat surface?
  try {
    const desk = await request(TARGET_HTTP, 'GET',
      '/services/star-citizen/chat/messages?channel=global&limit=50');
    const rows = (desk.body && desk.body.data) || [];
    const hit = rows.filter((m) => String(m.body || '').indexOf('adv-flood-') === 0);
    if (hit.length) {
      note('important', 'Adversary mesh chat visible on desktop',
        hit.length + ' adv-flood msgs in desktop global channel');
    } else {
      note('info', 'No adv-flood on desktop yet',
        'desktop global rows=' + rows.length + ' (peers may not have dialed)');
    }
  } catch (e) {
    note('warn', 'Desktop chat poll failed', e.message || String(e));
  }

  return peers;
}

async function main () {
  try {
    await probeHttp();
  } catch (e) {
    note('warn', 'HTTP probe failed', e.message || String(e));
  }
  if (PRODUCTION) {
    try {
      const hub = await request('https://hub.fabric.pub', 'GET', '/services/peering');
      note(hub.status === 200 ? 'info' : 'warn', 'hub.fabric.pub GET /services/peering', String(hub.status));
      const epoch = await request('https://hub.fabric.pub', 'GET', '/services/distributed/epoch');
      note(epoch.status === 200 ? 'info' : 'warn', 'hub.fabric.pub GET /services/distributed/epoch',
        String(epoch.status) + (epoch.body && epoch.body.clock != null ? ' clock=' + epoch.body.clock : ''));
    } catch (e) {
      note('warn', 'Hub HTTP probe failed', e.message || String(e));
    }
  }
  let peers = [];
  try {
    if (PRODUCTION) {
      peers = await spawnFabricNeighbors(Number(process.env.ADV_PEERS) || 2);
    } else {
      peers = await spawnAdversaryPeers(Number(process.env.ADV_PEERS) || 3);
    }
  } catch (e) {
    note('warn', 'Peer spawn failed', e.message || String(e));
  }

  const outDir = path.join(__dirname, '..', 'reports');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) { /* ignore */ }
  const reportName = process.env.ADV_REPORT ||
    (PRODUCTION || /goon\.vc|fabric\.pub/i.test(TARGET_HTTP)
      ? 'adversary-public-probe.json'
      : 'adversary-local-probe.json');
  const out = path.join(outDir, reportName);
  fs.writeFileSync(out, JSON.stringify({
    findings,
    targets: { http: TARGET_HTTP, fabric: TARGET_FABRIC, production: PRODUCTION },
    at: new Date().toISOString()
  }, null, 2));
  console.log('\nWrote', out);

  const holdMs = Number(process.env.ADV_HOLD_MS) || (PRODUCTION ? 15000 : 8000);
  await new Promise((r) => setTimeout(r, holdMs));
  for (const p of peers) {
    try {
      if (p.client && typeof p.client.stop === 'function') await p.client.stop();
      else if (p.svc && typeof p.svc.stop === 'function') await p.svc.stop();
    } catch (_) { /* ignore */ }
    try { if (p.dir) fs.rmSync(p.dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }

  const blockers = findings.filter((f) => f.severity === 'blocker');
  const important = findings.filter((f) => f.severity === 'important');
  console.log('\nSummary: blockers=%d important=%d total=%d',
    blockers.length, important.length, findings.length);
  process.exitCode = blockers.length ? 2 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
