'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  resolveDiscordConfig,
  writeSecretsFile,
  readSecretsFile,
  discordRuntimeSummary
} = require('../../functions/discordConfig');

test('resolveDiscordConfig prefers env bot token over local webhook-only', () => {
  const cfg = resolveDiscordConfig({
    localDiscord: { enable: true, webhook: 'https://discord.com/api/webhooks/1/x', channel: '99' },
    persisted: {},
    env: { DISCORD_BOT_TOKEN: 'bot-tok', DISCORD_APP_ID: 'app-1' }
  });
  assert.equal(cfg.token, 'bot-tok');
  assert.equal(cfg.app.id, 'app-1');
  assert.equal(cfg.channel, '99');
  assert.equal(cfg.enable, true);
  assert.equal(cfg.mode || discordRuntimeSummary(cfg).mode, 'bot');
});

test('writeSecretsFile stores token under settingsDir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-discord-'));
  const summary = writeSecretsFile(dir, { token: 'sekrit', webhook: 'https://discord.com/api/webhooks/a/b' });
  assert.equal(summary.tokenConfigured, true);
  assert.equal(summary.webhookConfigured, true);
  const raw = readSecretsFile(dir);
  assert.equal(raw.token, 'sekrit');
  const cfg = resolveDiscordConfig({
    localDiscord: { enable: true },
    persisted: { discordBotEnable: true, discordChannel: 'chan' },
    settingsDir: dir,
    env: {}
  });
  assert.equal(cfg.token, 'sekrit');
  assert.equal(cfg.channel, 'chan');
  assert.equal(cfg.webhook, 'https://discord.com/api/webhooks/a/b');
});

test('discordRuntimeSummary never leaks secrets', () => {
  const summary = discordRuntimeSummary({
    enable: true,
    token: 'tok-UNIQUE-SECRET-99',
    webhook: 'https://discord.com/api/webhooks/z/y-UNIQUE',
    app: { id: '1', secret: 'app-secret-UNIQUE-77' },
    channel: 'c'
  });
  const blob = JSON.stringify(summary);
  assert.ok(!blob.includes('tok-UNIQUE-SECRET-99'));
  assert.ok(!blob.includes('app-secret-UNIQUE-77'));
  assert.ok(!blob.includes('webhooks/z'));
});
