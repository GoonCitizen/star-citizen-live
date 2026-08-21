'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const LiveRelay = require('../../services/LiveRelay');
const settingsStore = require('../../functions/settingsStore');

class FakeDiscord extends EventEmitter {
  constructor (settings) {
    super();
    this.settings = settings;
    FakeDiscord.instances.push(this);
  }

  async start () {
    FakeDiscord.starts += 1;
    if (FakeDiscord.failStart) throw new Error('login failed');
    this.started = true;
  }

  async stop () {
    FakeDiscord.stops += 1;
    this.stopped = true;
    if (FakeDiscord.failStop) throw new Error('already closed');
  }
}

function resetFake () {
  FakeDiscord.instances = [];
  FakeDiscord.starts = 0;
  FakeDiscord.stops = 0;
  FakeDiscord.failStart = false;
  FakeDiscord.failStop = false;
}

async function startRelay () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-discord-bot-'));
  const svc = new LiveRelay({
    port: 0,
    listen: false,
    mode: 'relay',
    settingsDir: dir,
    fabric: { enable: false, listen: false, port: 0, peers: [] },
    missions: { enable: false },
    discord: { enable: false }
  });
  await svc.start();
  return { svc, dir };
}

function enableBot (svc, token) {
  settingsStore.putSetting(svc.registerStore, 'discordBotEnable', true);
  svc.settings.discord = Object.assign({}, svc.settings.discord, {
    enable: true,
    token: token || 'test-bot-token',
    channel: 'c1'
  });
}

function disableBot (svc) {
  settingsStore.putSetting(svc.registerStore, 'discordBotEnable', false);
  svc.settings.discord = Object.assign({}, svc.settings.discord, {
    enable: false,
    token: '',
    channel: null
  });
}

describe('LiveRelay _startDiscordBot (fake @fabric/discord)', () => {
  let origLoad;
  let savedDiscord;

  before(() => {
    resetFake();
    origLoad = Module._load;
    try {
      savedDiscord = require.cache[require.resolve('@fabric/discord')];
    } catch (_) {
      savedDiscord = undefined;
    }
    try { delete require.cache[require.resolve('@fabric/discord')]; } catch (_) { /* not loaded */ }
    Module._load = function (request, parent, isMain) {
      if (request === '@fabric/discord') return FakeDiscord;
      return origLoad.apply(this, arguments);
    };
  });

  after(() => {
    Module._load = origLoad;
    try {
      const id = require.resolve('@fabric/discord');
      if (savedDiscord) require.cache[id] = savedDiscord;
      else delete require.cache[id];
    } catch (_) { /* ignore */ }
  });

  it('constructs and starts a bot when enable + token are set', async () => {
    resetFake();
    const { svc, dir } = await startRelay();
    try {
      enableBot(svc);
      const bot = await svc._startDiscordBot();
      assert.ok(bot instanceof FakeDiscord);
      assert.equal(svc.discordBot, bot);
      assert.equal(FakeDiscord.starts, 1);
      assert.equal(bot.settings.token, 'test-bot-token');
      assert.equal(bot.settings.channel, 'c1');
      assert.equal(bot.settings.autoCommands, false);

      const errors = [];
      svc.on('error', (e) => errors.push(e));
      bot.emit('log', 'gateway hello');
      bot.emit('error', new Error('ws drop'));
      assert.equal(errors.length, 1);
      assert.match(String(errors[0] && errors[0].message), /ws drop/);

      bot.emit('activity', { type: 'NotAMessage' });
      bot.emit('ready');
      assert.equal(svc._discordBotReady, true);
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('clears the bot when start() throws', async () => {
    resetFake();
    FakeDiscord.failStart = true;
    const { svc, dir } = await startRelay();
    try {
      enableBot(svc);
      const errors = [];
      svc.on('error', (e) => errors.push(e));
      const bot = await svc._startDiscordBot();
      assert.equal(bot, null);
      assert.equal(svc.discordBot, null);
      assert.equal(svc._discordBotReady, false);
      assert.ok(errors.some((e) => /login failed/.test(String(e && e.message))));
    } finally {
      FakeDiscord.failStart = false;
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stops an existing stub when Discord is disabled or tokenless', async () => {
    resetFake();
    const { svc, dir } = await startRelay();
    try {
      let stops = 0;
      svc.discordBot = {
        async stop () {
          stops += 1;
          throw new Error('already closed');
        }
      };
      svc._discordBotReady = true;
      disableBot(svc);
      const result = await svc._startDiscordBot();
      assert.equal(result, null);
      assert.equal(svc.discordBot, null);
      assert.equal(svc._discordBotReady, false);
      assert.equal(stops, 1);
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('restarts by stopping the previous bot first', async () => {
    resetFake();
    const { svc, dir } = await startRelay();
    try {
      enableBot(svc);
      const first = await svc._startDiscordBot();
      assert.ok(first.started);
      const second = await svc._startDiscordBot();
      assert.ok(first.stopped);
      assert.ok(second !== first);
      assert.equal(svc.discordBot, second);
      assert.equal(FakeDiscord.starts, 2);
      assert.equal(FakeDiscord.stops, 1);
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
