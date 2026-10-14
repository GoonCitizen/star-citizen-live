'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');

const BASE = '/services/star-citizen';

function makeCache (items) {
  return {
    values () { return items[Symbol.iterator](); },
    map (fn) { return items.map(fn); }
  };
}

function request (port, method, reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: reqPath,
      headers: { Accept: 'application/json' }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let body = null;
        if (buf) {
          try { body = JSON.parse(buf); } catch (_) { body = buf; }
        }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function stubDiscordBot () {
  const members = [
    { id: 'u1', displayName: 'Alice', user: { id: 'u1', username: 'alice', bot: false } },
    { id: 'b1', displayName: 'GoonBot', user: { id: 'b1', username: 'GoonBot', bot: true } }
  ];
  const channels = [
    { id: 'c1', name: 'general', type: 0, position: 0, parentId: null },
    { id: 'v1', name: 'voice', type: 2, position: 1, parentId: null }
  ];
  const guild = {
    id: 'g1',
    name: 'Fleet Ops',
    icon: null,
    memberCount: 2,
    channels: {
      cache: makeCache(channels),
      async fetch () { return makeCache(channels); }
    },
    members: {
      cache: makeCache(members),
      async list () { return makeCache(members); }
    }
  };
  const messages = [
    {
      id: 'm1',
      content: 'o7 from Discord',
      channelId: 'c1',
      createdTimestamp: Date.parse('2026-08-12T12:00:00.000Z'),
      author: { id: 'u1', username: 'alice', bot: false }
    }
  ];
  const client = {
    isReady () { return true; },
    user: { tag: 'GoonBot#0001', username: 'GoonBot' },
    guilds: {
      cache: makeCache([guild]),
      async fetch () { return makeCache([guild]); }
    },
    channels: {
      async fetch (id) {
        if (String(id) !== 'c1') throw new Error('unknown channel');
        return {
          id: 'c1',
          name: 'general',
          type: 0,
          guildId: 'g1',
          messages: {
            async fetch () { return makeCache(messages); }
          }
        };
      }
    }
  };
  return {
    client,
    async syncGuilds () { this._synced = true; }
  };
}

test('Discord catalog HTTP syncs guilds, channels, users, and channel insight', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-discord-insight-'));
  const svc = new LiveRelay({
    port: 0,
    listen: true,
    mode: 'relay',
    settingsDir: dir,
    fabric: { enable: false, listen: false, port: 0, peers: [] },
    missions: { enable: false },
    discord: { enable: false }
  });
  await svc.start();
  const port = svc.server.address().port;
  try {
    svc.discordBot = stubDiscordBot();
    svc._discordBotReady = true;
    svc._discordCatalogTtlMs = 0;

    const guilds = await request(port, 'GET', `${BASE}/discord/guilds?refresh=1`);
    assert.strictEqual(guilds.status, 200, JSON.stringify(guilds.body));
    const cat = guilds.body.data;
    assert.strictEqual(cat.botReady, true);
    assert.strictEqual(cat.botUser, 'GoonBot#0001');
    assert.strictEqual(cat.guilds.length, 1);
    assert.strictEqual(cat.guilds[0].name, 'Fleet Ops');
    assert.ok(cat.guilds[0].channels.some((c) => c.id === 'c1' && c.chatInsight));
    assert.strictEqual(cat.users.length, 2);
    assert.ok(cat.users.some((u) => u.username === 'alice'));
    assert.ok(svc.discordBot._synced);

    const members = await request(port, 'GET', `${BASE}/discord/guilds/g1/members`);
    assert.strictEqual(members.status, 200);
    assert.strictEqual(members.body.data.members.length, 2);

    const insight = await request(port, 'GET', `${BASE}/discord/channels/c1?refresh=1`);
    assert.strictEqual(insight.status, 200, JSON.stringify(insight.body));
    assert.strictEqual(insight.body.data.channel.id, 'c1');
    assert.strictEqual(insight.body.data.messages.length, 1);
    assert.strictEqual(insight.body.data.messages[0].body, 'o7 from Discord');
    assert.strictEqual(insight.body.data.messages[0].kind, 'discord');
    assert.strictEqual(insight.body.data.members.length, 2);

    const missing = await request(port, 'GET', `${BASE}/discord/channels/nope`);
    assert.strictEqual(missing.status, 404);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
