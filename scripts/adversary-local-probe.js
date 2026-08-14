'use strict';

/**
 * Local adversarial mesh probe — dials loopback Fabric peers and hammers
 * the desktop HTTP surface. Does not target public hubs with floods.
 *
 * Usage: node scripts/adversary-local-probe.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const LiveRelay = require('../services/LiveRelay');
const { createIdentity } = require('../functions/identity');

const TARGET_HTTP = process.env.ADV_HTTP || 'http://127.0.0.1:3041';
const TARGET_FABRIC = (process.env.ADV_FABRIC || '127.0.0.1:7778,127.0.0.1:7777')
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
    const req = http.request({
      host: u.hostname,
      port: u.port || 80,
      method,
      path: reqPath,
      headers,
      timeout: 8000
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
  await probeHttp();
  let peers = [];
  try {
    peers = await spawnAdversaryPeers(3);
  } catch (e) {
    note('warn', 'Peer spawn failed', e.message || String(e));
  }

  const outDir = path.join(__dirname, '..', 'reports');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) { /* ignore */ }
  const out = path.join(outDir, 'adversary-local-probe.json');
  fs.writeFileSync(out, JSON.stringify({ findings, targets: { http: TARGET_HTTP, fabric: TARGET_FABRIC } }, null, 2));
  console.log('\nWrote', out);

  // Keep peers briefly so UI can observe them, then tear down
  await new Promise((r) => setTimeout(r, 8000));
  for (const p of peers) {
    try { await p.svc.stop(); } catch (_) { /* ignore */ }
    try { fs.rmSync(p.dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
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
