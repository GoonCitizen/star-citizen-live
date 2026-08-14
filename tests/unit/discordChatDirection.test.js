'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const settingsStore = require('../../functions/settingsStore');
const { Store } = require('../../types/Store');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DIRECTION_LISTEN,
  DIRECTION_BIDIRECTIONAL,
  normalizeDirections,
  directionForChannel,
  isDiscordOutboundAllowed,
  setChannelDirection
} = require('../../functions/discordChatDirection');

describe('discordChatDirection', () => {
  it('defaults missing channel ids to bidirectional outbound', () => {
    assert.strictEqual(directionForChannel('1234567890', {}), DIRECTION_BIDIRECTIONAL);
    assert.strictEqual(isDiscordOutboundAllowed('1234567890', {}), true);
    assert.strictEqual(
      isDiscordOutboundAllowed('1234567890', { discordChatDirections: { '1234567890': 'listen' } }),
      false
    );
    assert.strictEqual(
      directionForChannel('1234567890', { discordChatDirections: { '1234567890': 'listen' } }),
      DIRECTION_LISTEN
    );
  });

  it('sanitizes maps and setChannelDirection clears bidirectional entries', () => {
    assert.strictEqual(normalizeDirections(null), null);
    assert.strictEqual(normalizeDirections({ '': 'listen' }), null);
    const cleaned = normalizeDirections({
      '1111111111': 'listen',
      '2222222222': 'bidirectional',
      c1: 'listen',
      x: 'listen',
      '3333333333': 'nope'
    });
    assert.deepStrictEqual(cleaned, {
      '1111111111': 'listen',
      '2222222222': 'bidirectional',
      c1: 'listen'
    });
    const afterListen = setChannelDirection({}, '1111111111', DIRECTION_LISTEN);
    assert.deepStrictEqual(afterListen, { '1111111111': 'listen' });
    assert.strictEqual(
      setChannelDirection(afterListen, '1111111111', DIRECTION_BIDIRECTIONAL),
      null
    );
  });

  it('round-trips on the Fabric settings store', async () => {
    assert.ok(settingsStore.ALLOWED_KEYS.includes('discordChatDirections'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-discord-dir-'));
    const store = new Store({ path: path.join(dir, 'register') });
    await store.start();
    try {
      settingsStore.putSetting(store, 'discordChatDirections', {
        '999888777666': 'listen',
        '!!!': 'listen',
        x: 'listen'
      });
      const loaded = settingsStore.loadSettings(store);
      assert.deepStrictEqual(loaded.discordChatDirections, { '999888777666': 'listen' });
      settingsStore.putSetting(store, 'discordChatDirections', {});
      assert.strictEqual(settingsStore.loadSettings(store).discordChatDirections, undefined);
    } finally {
      await store.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
