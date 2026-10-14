'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolveDiscordConfig,
  writeSecretsFile,
  discordRuntimeSummary
} = require('../../functions/discordConfig');

describe('discordConfig edges', () => {
  it('whitespace token is treated as missing; enable needs token or webhook', () => {
    const cfg = resolveDiscordConfig({
      localDiscord: { enable: true, token: '   ', webhook: '' },
      persisted: {},
      env: {}
    });
    assert.equal(cfg.token, null);
    assert.equal(cfg.enable, false);
  });

  it('persisted discordBotEnable false disables even with a token', () => {
    const cfg = resolveDiscordConfig({
      localDiscord: { enable: true, token: 'tok' },
      persisted: { discordBotEnable: false },
      env: {}
    });
    assert.equal(cfg.enable, false);
    assert.equal(cfg.token, 'tok');
  });

  it('writeSecretsFile empty string clears a field', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-discord-cfg-'));
    writeSecretsFile(dir, { token: 'keep', webhook: 'https://discord.com/api/webhooks/a/b' });
    writeSecretsFile(dir, { webhook: '' });
    const cfg = resolveDiscordConfig({
      localDiscord: { enable: true },
      persisted: { discordBotEnable: true },
      settingsDir: dir,
      env: {}
    });
    assert.equal(cfg.token, 'keep');
    assert.equal(cfg.webhook, null);
    const summary = discordRuntimeSummary(cfg);
    const blob = JSON.stringify(summary);
    assert.ok(!blob.includes('keep'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
