'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity, canonicalChatAuthor } = require('../../functions/identity');
const discordIdentityLink = require('../../functions/discordIdentityLink');
const { stubDiscordBot } = require('../helpers/discordBotStub');
const { request } = require('../helpers/http');

const BASE = '/services/star-citizen';

async function startRelay () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-discord-unlink-'));
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

function linkAlice (svc, alice) {
  svc._discordIdentityLinks = discordIdentityLink.upsertLink([], {
    discordUserId: 'u1',
    pubkey: alice.pubkey,
    username: 'alice'
  });
  svc._persistDiscordIdentityLinks();
}

describe('Discord !unlink, challenge prune, HTTP DELETE', () => {
  it('replies on !unlink and stays silent when the Discord user is not linked', async () => {
    const alice = createIdentity();
    const { svc, dir } = await startRelay();
    try {
      svc.setIdentity(alice);
      const bot = stubDiscordBot();
      svc.discordBot = bot;
      svc._discordBotReady = true;
      linkAlice(svc, alice);

      const unlinked = await svc._onDiscordActivity({
        type: 'DiscordMessage',
        actor: { ref: 'u1', username: 'alice' },
        object: { id: 'msg-un', content: '!unlink', created: Date.now() },
        target: { ref: 'c1' }
      });
      assert.equal(unlinked.link.ok, true);
      assert.equal(unlinked.link.action, 'unlink');
      assert.equal(svc._discordIdentityLinks.length, 0);
      assert.ok(bot.stats.posted.some((row) => /Unlinked/.test(String(row.payload.content))));

      const silent = await svc._onDiscordActivity({
        type: 'DiscordMessage',
        actor: { ref: 'u9', username: 'eve' },
        object: { id: 'msg-un2', content: '!unlink', created: Date.now() },
        target: { ref: 'c1' }
      });
      assert.equal(silent.link.ok, false);
      assert.equal(silent.link.reason, 'not_linked');
      assert.equal(bot.stats.posted.filter((row) => /Unlinked/.test(String(row.payload.content))).length, 1);
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prunes expired challenges and replaces a pending code for the same pubkey', async () => {
    const alice = createIdentity();
    const { svc, dir } = await startRelay();
    try {
      svc.setIdentity(alice);
      svc._discordLinkChallenges.set('EXPIRED1', {
        code: 'EXPIRED1',
        pubkey: canonicalChatAuthor(alice.pubkey),
        expiresAt: Date.now() - 1
      });
      svc._pruneDiscordLinkChallenges(Date.now());
      assert.equal(svc._discordLinkChallenges.has('EXPIRED1'), false);

      const first = svc._createDiscordLinkChallenge(alice.pubkey);
      const second = svc._createDiscordLinkChallenge(alice.pubkey);
      assert.notEqual(first.code, second.code);
      assert.equal(svc._discordLinkChallenges.has(first.code), false);
      assert.equal(svc._discordLinkChallenges.has(second.code), true);
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('DELETE /discord/link unlinks the session identity', async () => {
    const alice = createIdentity();
    const { svc, dir, port } = await startRelay();
    try {
      svc.setIdentity(alice);
      linkAlice(svc, alice);

      const listed = await request(port, 'GET', `${BASE}/discord/link`);
      assert.equal(listed.status, 200);
      assert.ok(listed.body.data.linked);
      assert.equal(listed.body.data.linked.discordUserId, 'u1');

      const deleted = await request(port, 'DELETE', `${BASE}/discord/link`);
      assert.equal(deleted.status, 200, deleted.body && deleted.body.error);
      assert.equal(deleted.body.data.unlinked, true);
      assert.equal(deleted.body.data.removed.discordUserId, 'u1');

      const after = await request(port, 'GET', `${BASE}/discord/link`);
      assert.equal(after.body.data.linked, null);

      const again = await request(port, 'DELETE', `${BASE}/discord/link`);
      assert.equal(again.status, 200);
      assert.equal(again.body.data.unlinked, false);
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('DELETE /discord/link is 401 without an unlocked identity', async () => {
    const { svc, dir, port } = await startRelay();
    try {
      const res = await request(port, 'DELETE', `${BASE}/discord/link`);
      assert.equal(res.status, 401);
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores link commands without an author and missing !link codes', async () => {
    const { svc, dir } = await startRelay();
    try {
      assert.equal(await svc._handleDiscordLinkCommand({ authorId: '' }, { action: 'unlink' }), null);
      assert.equal(await svc._handleDiscordLinkCommand({ authorId: 'u1' }, { action: 'other' }), null);
      const missing = await svc._handleDiscordLinkCommand(
        { authorId: 'u1', channelId: 'c1' },
        { action: 'link', code: null }
      );
      assert.equal(missing.ok, false);
      assert.equal(missing.reason, 'missing_code');
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
