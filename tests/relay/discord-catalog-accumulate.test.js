'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity } = require('../../functions/identity');
const { buildShareObject } = require('../../functions/discordCatalogAccumulate');
const groupDataSync = require('../../functions/groupDataSync');
const { stubDiscordBot } = require('../helpers/discordBotStub');

const BASE = '/services/star-citizen';

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-dc-acc-'));
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

describe('Discord catalog accumulate + group gossip', () => {
  it('serves gossiped guilds when the local bot is not ready', async () => {
    const alice = createIdentity();
    const bob = createIdentity();
    const dir = tmpDir();
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
    svc.setIdentity(bob);
    const port = svc.server.address().port;
    try {
      const group = await svc.groupManager.createGroup({
        name: 'Wing',
        members: [alice.pubkey],
        visibility: 'public'
      }, bob.pubkey);
      const share = buildShareObject({
        groupId: group.id,
        guilds: [{
          id: 'g-peer',
          name: 'Peer Guild',
          memberCount: 9000,
          channels: [{ id: 'c-ops', name: 'ops', type: 0, position: 0 }],
          members: [
            { id: 'u-alice', username: 'alice', displayName: 'Alice', bot: false }
          ]
        }]
      });
      const folded = svc._ingestDiscordCatalogShare(share, alice.pubkey, {
        contract: group.contractId
      });
      assert.ok(folded && folded.length >= 1);

      const outsider = createIdentity();
      const rejected = svc._ingestDiscordCatalogShare(share, outsider.pubkey, {
        contract: group.contractId
      });
      assert.strictEqual(rejected, null);

      svc._discordCatalogCache = { at: 0, data: null, inflight: null };
      const res = await request(port, 'GET', `${BASE}/discord/guilds`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.botReady, false);
      const guild = (res.body.data.guilds || []).find((g) => g.id === 'g-peer');
      assert.ok(guild, 'gossiped guild is visible without a local bot');
      assert.strictEqual(guild.name, 'Peer Guild');
      assert.strictEqual(guild.memberCount, 9000);
      assert.ok(guild.truncated);
      assert.ok((guild.channels || []).some((c) => c.id === 'c-ops'));
      assert.ok(res.body.data.accumulated);
      assert.ok(res.body.data.worldView);
      assert.strictEqual(res.body.data.worldView['@type'], 'WorldView');
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps channel insight after Discord goes down', async () => {
    const dir = tmpDir();
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
      svc._discordInsightTtlMs = 0;

      const live = await request(port, 'GET', `${BASE}/discord/channels/c1?refresh=1`);
      assert.strictEqual(live.status, 200, JSON.stringify(live.body));
      assert.strictEqual(live.body.data.botReady, true);
      assert.strictEqual(live.body.data.messages[0].body, 'o7 from Discord');

      svc.discordBot = null;
      svc._discordBotReady = false;
      svc._discordCatalogCache = { at: 0, data: null, inflight: null };
      if (svc._discordChannelInsightCache) svc._discordChannelInsightCache.clear();

      const offline = await request(port, 'GET', `${BASE}/discord/channels/c1`);
      assert.strictEqual(offline.status, 200, JSON.stringify(offline.body));
      assert.strictEqual(offline.body.data.botReady, false);
      assert.strictEqual(offline.body.data.offline, true);
      assert.ok((offline.body.data.messages || []).some((m) => m.body === 'o7 from Discord'));

      const view = await request(port, 'GET', `${BASE}/world-view`);
      assert.strictEqual(view.status, 200, JSON.stringify(view.body));
      assert.strictEqual(view.body.type, 'WorldView');
      const msgPack = (view.body.data.packs || []).find((p) =>
        p.pack === 'chat.messages' || p.pack === 'discord.messages');
      assert.ok(msgPack);
      assert.ok(msgPack.messageCount >= 1);
      assert.strictEqual(view.body.data.offline, true);
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges GroupDataShare message packs from group members', async () => {
    const alice = createIdentity();
    const bob = createIdentity();
    const dir = tmpDir();
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
    svc.setIdentity(bob);
    const port = svc.server.address().port;
    try {
      const group = await svc.groupManager.createGroup({
        name: 'Wing',
        members: [alice.pubkey],
        visibility: 'public'
      }, bob.pubkey);
      const share = groupDataSync.buildShare({
        groupId: group.id,
        sourceAppId: 'app-peer',
        packs: [
          {
            pack: groupDataSync.PACK_DISCORD_CATALOG,
            payload: {
              guilds: [{
                id: 'g-msg',
                name: 'Msg Guild',
                memberCount: 12,
                channels: [{ id: 'c-msg', name: 'ops', type: 0, position: 0 }],
                members: [{ id: 'u-alice', username: 'alice', displayName: 'Alice', bot: false }]
              }]
            }
          },
          {
            pack: groupDataSync.PACK_DISCORD_MESSAGES,
            payload: {
              channels: [{
                channelId: 'c-msg',
                guildId: 'g-msg',
                messages: [{
                  discordMessageId: 'm-peer',
                  channelId: 'c-msg',
                  authorId: 'u-alice',
                  handle: 'alice',
                  body: 'from another bot',
                  ts: '2026-08-12T13:00:00.000Z'
                }]
              }]
            }
          }
        ]
      });
      const folded = svc._ingestGroupDataShare(share, alice.pubkey, {
        contract: group.contractId
      });
      assert.ok(folded && folded.length >= 1);

      svc._discordCatalogCache = { at: 0, data: null, inflight: null };
      if (svc._discordChannelInsightCache) svc._discordChannelInsightCache.clear();
      const insight = await request(port, 'GET', `${BASE}/discord/channels/c-msg`);
      assert.strictEqual(insight.status, 200, JSON.stringify(insight.body));
      assert.strictEqual(insight.body.data.botReady, false);
      assert.ok((insight.body.data.messages || []).some((m) => m.body === 'from another bot'));
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
