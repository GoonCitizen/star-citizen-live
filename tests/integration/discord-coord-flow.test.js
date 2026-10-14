'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity } = require('../../functions/identity');
const { stubDiscordBot } = require('../helpers/discordBotStub');
const discordContract = require('../../functions/discordContract');

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

function wait (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Discord Request→Claim→Response flow', () => {
  it('coordinates !ping on the announce channel and records the sequence tree', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-discord-coord-'));
    const alice = createIdentity();
    const svc = new LiveRelay({
      port: 0,
      listen: true,
      mode: 'relay',
      settingsDir: dir,
      fabric: { enable: false, listen: false, port: 0, peers: [] },
      missions: { enable: false },
      discord: { enable: false, channel: 'c1' }
    });
    await svc.start();
    const port = svc.server.address().port;
    try {
      svc.setIdentity(alice);
      const bot = stubDiscordBot();
      svc.discordBot = bot;
      svc._discordBotReady = true;
      svc._discordClaimSettleMs = 20;

      const dropped = await svc._onDiscordActivity({
        type: 'DiscordMessage',
        actor: { ref: 'u1', username: 'alice' },
        object: { id: 'msg-other', content: '!ping', created: Date.now() },
        target: { ref: 'other-channel' }
      });
      assert.ok(dropped && dropped.request);
      assert.strictEqual(dropped.coordinated, false);
      assert.ok(dropped.ingested);
      assert.strictEqual(bot.stats.posted.length, 0);

      const ping = await svc._onDiscordActivity({
        type: 'DiscordMessage',
        actor: { ref: 'u1', username: 'alice' },
        object: { id: 'msg-ping', content: '!ping', created: Date.now() },
        target: { ref: 'c1' }
      });
      assert.ok(ping && ping.request);
      assert.strictEqual(ping.request.channelId, 'c1');

      await wait(350);

      assert.ok(bot.stats.posted.length >= 1);
      assert.ok(String(bot.stats.posted[0].payload.content).startsWith('Pong!'));

      const tree = svc.discordSequenceTree(ping.request.requestId);
      assert.strictEqual(tree.type, 'DiscordSequenceTree');
      assert.ok(tree.winningClaim);
      assert.ok(tree.responses.length >= 1);

      const httpTree = await request(
        port,
        'GET',
        `${BASE}/fabric/messages/tree?requestId=${encodeURIComponent(ping.request.requestId)}`
      );
      assert.strictEqual(httpTree.status, 200);
      assert.strictEqual(httpTree.body.data.requestId, ping.request.requestId);

      const coord = await request(port, 'GET', `${BASE}/discord/coordination`);
      assert.strictEqual(coord.status, 200);
      assert.ok(coord.body.data.some((row) => row.type === discordContract.DISCORD_REQUEST));
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not auto-reply to ordinary Discord chat', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-discord-nocmd-'));
    const alice = createIdentity();
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
    try {
      svc.setIdentity(alice);
      const bot = stubDiscordBot();
      svc.discordBot = bot;
      svc._discordBotReady = true;
      svc._discordClaimSettleMs = 10;
      await svc._onDiscordActivity({
        type: 'DiscordMessage',
        actor: { ref: 'u1' },
        object: { id: 'msg-hi', content: 'hello fleet', created: Date.now() },
        target: { ref: 'c1' }
      });
      await wait(200);
      assert.strictEqual(bot.stats.posted.length, 0);
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
