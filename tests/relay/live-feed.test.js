'use strict';

const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const {
  buildLiveFeed, filterLiveFeed, categoryForKind, summarizeRecent
} = require('../../functions/liveFeed');
const LiveRelay = require('../../services/LiveRelay');
const { createIdentity } = require('../../functions/identity');

function tmpDir (prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function request (port, method, reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: reqPath }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('categoryForKind maps parser and social kinds', () => {
  assert.strictEqual(categoryForKind('mission:start'), 'mission');
  assert.strictEqual(categoryForKind('kill'), 'combat');
  assert.strictEqual(categoryForKind('player:death'), 'combat');
  assert.strictEqual(categoryForKind('quantum:jump'), 'quantum');
  assert.strictEqual(categoryForKind('ChatMessage'), 'chat');
  assert.strictEqual(categoryForKind('log:raw'), 'log');
});

test('summarizeRecent is user-friendly; raw stays on hasRaw items', () => {
  const q = summarizeRecent({
    kind: 'quantum:select',
    recognized: true,
    raw: '<2026-07-29T12:00:00.000Z> [Notice] <Player Selected Quantum Target - Local> Player selected \'Port Tressler\''
  });
  assert.strictEqual(q, 'Selected quantum target: Port Tressler');

  const peerPub = '03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const feed = buildLiveFeed({
    chat: [{
      id: 'c1', channel: 'global', author: '02aa', handle: 'Neorion',
      body: 'o7', ts: '2026-07-29T12:00:02.000Z'
    }],
    kills: [{
      id: 'k1', killer: 'A', victim: 'B', weapon: 'laser', involves: 'kill',
      timestamp: '2026-07-29T12:00:01.000Z', source: peerPub,
      raw: '<2026-07-29T12:00:01.000Z> [Notice] CActor::Kill full line'
    }],
    missionlog: [{
      id: 'm1', kind: 'mission:start', text: 'Delivery', generator: 'Covalex_Hauling',
      timestamp: '2026-07-29T12:00:00.000Z',
      raw: '<2026-07-29T12:00:00.000Z> [Notice] MissionStartCommsNotification Delivery'
    }],
    recent: [{
      seq: 1, kind: 'log:raw', timestamp: '2026-07-29T11:59:59.000Z',
      recognized: false,
      raw: '<2026-07-29T11:59:59.000Z> [Notice] <SomeNoise> obscure engine chatter'
    }, {
      seq: 2, kind: 'kill', timestamp: '2026-07-29T12:00:01.000Z',
      recognized: true, raw: 'duplicate kill line'
    }],
    broadcasts: [{
      id: 'b1', source: '03cc', status: 'pending',
      broadcastAt: '2026-07-29T12:00:03.000Z',
      mission: { title: 'Escort run', type: 'Escort' }
    }]
  }, {
    limit: 50,
    aliases: { [peerPub]: 'Wingmate' }
  });

  assert.ok(feed.items.length >= 4);
  assert.strictEqual(feed.items.filter((i) => i.kind === 'kill').length, 1);
  // Newest first — broadcast at 12:00:03 is the head of the stream.
  assert.strictEqual(feed.items[0].category, 'broadcast');
  assert.ok(feed.items.every((it, i, arr) => {
    if (i === 0) return true;
    return String(arr[i - 1].ts || '') >= String(it.ts || '');
  }));
  const chat = feed.items.find((i) => i.category === 'chat');
  assert.strictEqual(chat.who, 'Neorion');
  assert.strictEqual(chat.hasRaw, false);
  assert.ok(chat.badges.some((b) => b.kind === 'player' && b.value === 'Neorion'));
  const peerKill = feed.items.find((i) => i.category === 'combat');
  assert.strictEqual(peerKill.source, 'peer');
  assert.match(peerKill.body, /killed/i);
  assert.strictEqual(peerKill.hasRaw, true);
  assert.strictEqual(peerKill.provenance.origin, 'peer');
  assert.strictEqual(peerKill.provenance.peerAlias, 'Wingmate');
  assert.strictEqual(peerKill.provenance.label, 'Wingmate');
  assert.ok(peerKill.badges.some((b) => b.kind === 'weapon' && b.value === 'laser'));
  assert.ok(peerKill.badges.some((b) => b.kind === 'player' && b.label === 'killer'));
  const mission = feed.items.find((i) => i.category === 'mission');
  assert.match(mission.body, /Mission started/i);
  assert.ok(mission.badges.some((b) => b.kind === 'type'));
  assert.ok(mission.badges.some((b) => b.kind === 'faction'));
  assert.ok(mission.badges.some((b) => b.kind === 'status' && b.value === 'start'));
  assert.strictEqual(mission.provenance.origin, 'local');
  const noise = feed.items.find((i) => i.category === 'log');
  assert.ok(noise.body.indexOf('<2026') === -1);
  assert.strictEqual(noise.hasRaw, true);
  assert.ok(noise.badges.some((b) => b.kind === 'status' && b.value === 'unrecognized'));

  const onlyChat = filterLiveFeed(feed.items, { categories: new Set(['chat']) });
  assert.strictEqual(onlyChat.length, 1);
  const localOnly = filterLiveFeed(feed.items, { sources: new Set(['local']) });
  assert.ok(localOnly.every((i) => i.source === 'local'));
});

test('GET /monitor includes feed; GET /feed returns LiveFeed', async () => {
  const dir = tmpDir('sc-feed-');
  const id = createIdentity();
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    peers: [],
    fabric: { enable: false }
  });
  await svc.start();
  try {
    svc.setIdentity(id);
    svc.handleLogChange('<2026-07-29T12:00:00.000Z> [Notice] <[ActorState]> CActor::Kill: \'Bandit\' [123] killed by \'Pilot\' [456] with damage type \'Bullet\'');
    const port = svc.server.address().port;
    const mon = await request(port, 'GET', '/services/star-citizen/monitor?limit=100');
    assert.strictEqual(mon.status, 200);
    assert.ok(mon.body.feed);
    assert.ok(Array.isArray(mon.body.feed.items));
    const feed = await request(port, 'GET', '/services/star-citizen/feed?limit=100');
    assert.strictEqual(feed.status, 200);
    assert.strictEqual(feed.body.type, 'LiveFeed');
    assert.ok(feed.body.items.length >= 1);
  } finally {
    await svc.stop();
  }
});
