'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const { stubDiscordBot } = require('../helpers/discordBotStub');

const BASE = '/services/star-citizen';

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

async function startRelay () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-discord-int-'));
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
  return { svc, dir, port: svc.server.address().port };
}

describe('Discord catalog HTTP integration', () => {
  it('returns empty catalog when the bot is not ready', async () => {
    const { svc, dir, port } = await startRelay();
    try {
      const guilds = await request(port, 'GET', `${BASE}/discord/guilds`);
      assert.strictEqual(guilds.status, 200);
      assert.strictEqual(guilds.body.data.botReady, false);
      assert.deepStrictEqual(guilds.body.data.guilds, []);
      const insight = await request(port, 'GET', `${BASE}/discord/channels/c1`);
      assert.strictEqual(insight.status, 503);
      const missingGuild = await request(port, 'GET', `${BASE}/discord/guilds/nope/members`);
      assert.strictEqual(missingGuild.status, 404);
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('syncs once then serves TTL cache; refresh=1 fetches again', async () => {
    const { svc, dir, port } = await startRelay();
    try {
      const bot = stubDiscordBot();
      svc.discordBot = bot;
      svc._discordBotReady = true;
      svc._discordCatalogTtlMs = 60 * 1000;

      const first = await request(port, 'GET', `${BASE}/discord/guilds?refresh=1`);
      assert.strictEqual(first.status, 200);
      const fetches = bot.stats.guildsFetch;
      assert.ok(fetches >= 1);
      const second = await request(port, 'GET', `${BASE}/discord/guilds`);
      assert.strictEqual(second.status, 200);
      assert.strictEqual(bot.stats.guildsFetch, fetches);
      assert.strictEqual(second.body.data.guilds[0].id, 'g1');

      const channels = await request(port, 'GET', `${BASE}/discord/guilds/g1/channels`);
      assert.strictEqual(channels.status, 200);
      assert.ok(Array.isArray(channels.body.data.members));
      assert.ok(channels.body.data.channels.some((c) => c.id === 'c1'));

      await request(port, 'GET', `${BASE}/discord/guilds?refresh=1`);
      assert.ok(bot.stats.guildsFetch > fetches);

      const chat = await request(port, 'GET', `${BASE}/chat/messages?channel=${encodeURIComponent('discord:c1')}`);
      assert.strictEqual(chat.status, 200);
      assert.ok(Array.isArray(chat.body.data));
      assert.ok(Array.isArray(second.body.data.identityLinks));
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
