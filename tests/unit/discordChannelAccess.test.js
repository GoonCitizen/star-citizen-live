'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  normalizeBotPermissions,
  botPermissionsFromBits,
  botPermissionsFromChannel,
  discordChannelIndicators,
  canBotPostToDiscord,
  canOperatorPostToDiscord
} = require('../../functions/discordChannelAccess');

describe('discordChannelAccess', () => {
  it('normalizes compact bot permission snapshots', () => {
    assert.strictEqual(normalizeBotPermissions(null), null);
    assert.strictEqual(normalizeBotPermissions({}), null);
    assert.deepStrictEqual(
      normalizeBotPermissions({ view: true, send: false, extra: 1 }),
      { view: true, send: false }
    );
  });

  it('reads discord.js-shaped bits.has flags', () => {
    const bits = {
      has (name) {
        return name === 'ViewChannel' || name === 'ReadMessageHistory';
      }
    };
    assert.deepStrictEqual(botPermissionsFromBits(bits), {
      view: true,
      send: false,
      readHistory: true,
      attach: false
    });
  });

  it('reads numeric permission bitfields', () => {
    const viewAndSend = (1 << 10) | (1 << 11);
    const perms = botPermissionsFromBits(viewAndSend);
    assert.strictEqual(perms.view, true);
    assert.strictEqual(perms.send, true);
    assert.strictEqual(perms.readHistory, false);
  });

  it('snapshots permissionsFor on a live-shaped channel', () => {
    const channel = {
      id: 'c1',
      bot: { view: false, send: false },
      guild: { members: { me: { id: 'bot' } } },
      permissionsFor () {
        return {
          has (name) {
            return name === 'ViewChannel' || name === 'SendMessages';
          }
        };
      }
    };
    assert.deepStrictEqual(botPermissionsFromChannel(channel), {
      view: true,
      send: true,
      readHistory: false,
      attach: false
    });
  });

  it('passes through serialized bot bits when permissionsFor is missing', () => {
    assert.deepStrictEqual(
      botPermissionsFromChannel({ id: 'c1', bot: { view: true, send: false } }),
      { view: true, send: false }
    );
  });

  it('separates you-cannot-chat from bot-cannot-chat', () => {
    const you = discordChannelIndicators({
      discordSurface: true,
      listenOnly: true,
      botReady: true,
      bot: { view: true, send: true }
    });
    assert.ok(you.some((i) => i.id === 'you' && i.label === 'you'));
    assert.ok(!you.some((i) => i.id === 'bot'));

    const botMuted = discordChannelIndicators({
      discordSurface: true,
      listenOnly: false,
      botReady: true,
      bot: { view: true, send: false }
    });
    assert.ok(botMuted.some((i) => i.id === 'bot' && /cannot send/i.test(i.title)));
    assert.ok(!botMuted.some((i) => i.id === 'you'));

    const botBlind = discordChannelIndicators({
      discordSurface: true,
      botReady: true,
      bot: { view: false, send: false }
    });
    assert.ok(botBlind.some((i) => /cannot see/i.test(i.title)));

    const down = discordChannelIndicators({
      discordSurface: true,
      botReady: false
    });
    assert.ok(down.some((i) => i.id === 'bot' && i.tone === 'warn'));
  });

  it('gates Chat → Discord on listen-only and bot send', () => {
    assert.strictEqual(canOperatorPostToDiscord({
      botReady: true, listenOnly: true, bot: { view: true, send: true }
    }), false);
    assert.strictEqual(canBotPostToDiscord({
      botReady: true, bot: { view: true, send: false }
    }), false);
    assert.strictEqual(canOperatorPostToDiscord({
      botReady: true, listenOnly: false, bot: { view: true, send: true }
    }), true);
    assert.strictEqual(canBotPostToDiscord({ isDm: true, botReady: true }), true);
    assert.strictEqual(canBotPostToDiscord({ isDm: true, botReady: false }), false);
  });
});
