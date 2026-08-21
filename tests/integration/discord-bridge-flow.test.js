'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity, canonicalChatAuthor } = require('../../functions/identity');
const { stubDiscordBot } = require('../helpers/discordBotStub');
const { request, wait } = require('../helpers/http');

const BASE = '/services/star-citizen';

async function startRelay () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-discord-bridge-'));
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

describe('Discord ↔ Fabric chat bridge', () => {
  it('ingests Discord chat, posts back through the bot, and completes !link', async () => {
    const { svc, dir, port } = await startRelay();
    const alice = createIdentity();
    try {
      svc.setIdentity(alice);
      const bot = stubDiscordBot();
      svc.discordBot = bot;
      svc._discordBotReady = true;

      const inbound = await svc._onDiscordActivity({
        type: 'DiscordMessage',
        actor: { ref: 'u1', username: 'alice' },
        object: { id: 'msg-hi', content: 'hello fleet', created: Date.parse('2026-08-12T12:00:00.000Z') },
        target: { ref: 'c1' }
      });
      assert.ok(inbound && inbound.ingested);
      assert.strictEqual(inbound.coordinated, false);

      const listed = await request(port, 'GET', `${BASE}/chat/messages?channel=${encodeURIComponent('discord:c1')}`);
      assert.strictEqual(listed.status, 200);
      assert.ok(listed.body.data.some((m) => m.body === 'hello fleet' && m.author === 'discord:u1'));

      const posted = await request(port, 'POST', `${BASE}/chat/messages`, {
        channel: 'discord:c1',
        body: 'o7 from GoonCitizen'
      });
      assert.strictEqual(posted.status, 200, posted.body && posted.body.error);
      assert.strictEqual(posted.body.data.kind, 'discord');
      assert.ok(bot.stats.posted.some((row) => String(row.payload.content).includes('o7 from GoonCitizen')));

      const challenge = await request(port, 'POST', `${BASE}/discord/link`, {});
      assert.strictEqual(challenge.status, 200, challenge.body && challenge.body.error);
      const code = challenge.body.data.code;
      assert.ok(code);

      await svc._onDiscordActivity({
        type: 'DiscordMessage',
        actor: { ref: 'u1', username: 'alice' },
        object: { id: 'msg-link', content: '!link ' + code, created: Date.now() },
        target: { ref: 'c1' }
      });
      await wait(30);

      const status = await request(port, 'GET', `${BASE}/discord/link`);
      assert.strictEqual(status.status, 200);
      assert.ok(status.body.data.linked);
      assert.strictEqual(status.body.data.linked.discordUserId, 'u1');
      assert.strictEqual(status.body.data.linked.pubkey, canonicalChatAuthor(alice.pubkey));
      assert.ok(bot.stats.posted.some((row) => /Linked Discord/.test(String(row.payload.content))));

      const remapped = await request(port, 'GET', `${BASE}/chat/messages?channel=${encodeURIComponent('discord:c1')}`);
      assert.ok(remapped.body.data.some((m) => m.body === 'hello fleet' && m.linked === true));
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects Chat → Discord posts for listen-only channels and allows bidirectional', async () => {
    const { svc, dir, port } = await startRelay();
    const alice = createIdentity();
    const settingsStore = require('../../functions/settingsStore');
    try {
      svc.setIdentity(alice);
      const bot = stubDiscordBot();
      svc.discordBot = bot;
      svc._discordBotReady = true;

      settingsStore.putSetting(svc.registerStore, 'discordChatDirections', {
        c1: 'listen'
      });
      const blocked = await request(port, 'POST', `${BASE}/chat/messages`, {
        channel: 'discord:c1',
        body: 'should be blocked'
      });
      assert.strictEqual(blocked.status, 403);
      assert.match(String(blocked.body && blocked.body.error), /listen-only/i);
      assert.strictEqual(bot.stats.posted.length, 0);

      // Inbound still works while listen-only.
      const inbound = await svc._onDiscordActivity({
        type: 'DiscordMessage',
        actor: { ref: 'u1', username: 'alice' },
        object: { id: 'msg-listen', content: 'still heard', created: Date.now() },
        target: { ref: 'c1' }
      });
      assert.ok(inbound && inbound.ingested);

      settingsStore.putSetting(svc.registerStore, 'discordChatDirections', {
        c1: 'bidirectional'
      });
      const ok = await request(port, 'POST', `${BASE}/chat/messages`, {
        channel: 'discord:c1',
        body: 'allowed again'
      });
      assert.strictEqual(ok.status, 200, ok.body && ok.body.error);
      assert.ok(bot.stats.posted.some((row) => String(row.payload.content).includes('allowed again')));

      // Missing map entry remains bidirectional (default).
      settingsStore.putSetting(svc.registerStore, 'discordChatDirections', null);
      const defaultOk = await request(port, 'POST', `${BASE}/chat/messages`, {
        channel: 'discord:c2',
        body: 'default bi'
      });
      assert.strictEqual(defaultOk.status, 200, defaultOk.body && defaultOk.body.error);
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses Discord posts when the bot is down; attachments store locally and Discord gets a caption', async () => {
    const { svc, dir, port } = await startRelay();
    const alice = createIdentity();
    try {
      svc.setIdentity(alice);
      const down = await request(port, 'POST', `${BASE}/chat/messages`, {
        channel: 'discord:c1',
        body: 'no bot'
      });
      assert.strictEqual(down.status, 503);

      const bot = stubDiscordBot();
      svc.discordBot = bot;
      svc._discordBotReady = true;
      const attach = await request(port, 'POST', `${BASE}/chat/messages`, {
        channel: 'discord:c1',
        body: 'file',
        attachment: { kind: 'document', documentId: 'abc', name: 'ops.txt' }
      });
      assert.strictEqual(attach.status, 200, JSON.stringify(attach.body));
      assert.strictEqual(attach.body.data.attachment.documentId, 'abc');
      const posted = bot.stats.posted[0];
      assert.ok(posted);
      assert.ok(String(posted.payload.content).includes('ops.txt'));
      assert.ok(!String(posted.payload.content).includes('fabric-doc:'));
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('maps Discord Missing Permissions into a clear Chat error', async () => {
    const { svc, dir, port } = await startRelay();
    const alice = createIdentity();
    try {
      svc.setIdentity(alice);
      const bot = stubDiscordBot();
      bot.postToChannel = async () => {
        const err = new Error('Missing Permissions');
        err.code = 50013;
        throw err;
      };
      svc.discordBot = bot;
      svc._discordBotReady = true;
      const posted = await request(port, 'POST', `${BASE}/chat/messages`, {
        channel: 'discord:c1',
        body: 'should fail'
      });
      assert.strictEqual(posted.status, 403);
      assert.match(String(posted.body && posted.body.error), /Send Messages/i);
      assert.ok(!posted.body.authorizeUrl);

      svc.settings.discord = Object.assign({}, svc.settings.discord, {
        app: { id: '123456789012345678' }
      });
      const withLink = await request(port, 'POST', `${BASE}/chat/messages`, {
        channel: 'discord:c1',
        body: 'should fail again'
      });
      assert.strictEqual(withLink.status, 403);
      assert.ok(withLink.body.authorizeUrl);
      assert.ok(String(withLink.body.authorizeUrl).includes('client_id=123456789012345678'));
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('supports in-app DM with the local bot (loopback) and Discord users', async () => {
    const { svc, dir, port } = await startRelay();
    const alice = createIdentity();
    try {
      svc.setIdentity(alice);
      const bot = stubDiscordBot();
      svc.discordBot = bot;
      svc._discordBotReady = true;

      const botDm = await request(port, 'POST', `${BASE}/chat/messages`, {
        channel: 'discord:dm:b1',
        body: '!ping'
      });
      assert.strictEqual(botDm.status, 200, botDm.body && botDm.body.error);
      assert.strictEqual(botDm.body.data.kind, 'discord-dm');
      const thread = await request(port, 'GET', `${BASE}/chat/messages?channel=${encodeURIComponent('discord:dm:b1')}`);
      assert.strictEqual(thread.status, 200);
      const bodies = (thread.body.data || []).map((m) => m.body);
      assert.ok(bodies.includes('!ping'));
      assert.ok(bodies.some((b) => /Pong/i.test(b)));

      const userDm = await request(port, 'POST', `${BASE}/chat/messages`, {
        channel: 'discord:dm:u1',
        body: 'o7 via DM'
      });
      assert.strictEqual(userDm.status, 200, userDm.body && userDm.body.error);
      assert.ok(bot.stats.dms.some((row) => row.userId === 'u1'));
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stores inbound Discord DMs on discord:dm:<authorId>', async () => {
    const { svc, dir } = await startRelay();
    try {
      const inbound = await svc._onDiscordActivity({
        type: 'DiscordMessage',
        actor: { ref: 'u9', username: 'pilot' },
        object: { id: 'msg-dm', content: 'hey bot', created: Date.now() },
        target: { ref: 'dmch-private', type: 'dm' }
      });
      assert.ok(inbound && inbound.ingested);
      assert.strictEqual(inbound.ingested.channel, 'discord:dm:u9');
      assert.strictEqual(inbound.ingested.kind, 'discord-dm');
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
