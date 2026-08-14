'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const chatPlatform = require('../../functions/chatPlatform');

describe('chatPlatform', () => {
  it('parses Discord guild and DM channel keys', () => {
    assert.strictEqual(chatPlatform.channelKey('discord', 'c1'), 'discord:c1');
    assert.strictEqual(chatPlatform.dmChannelKey('discord', 'u1'), 'discord:dm:u1');
    assert.deepStrictEqual(chatPlatform.parseChannelKey('discord:c1'), {
      platform: 'discord',
      kind: 'channel',
      id: 'c1'
    });
    assert.deepStrictEqual(chatPlatform.parseChannelKey('discord:dm:u1'), {
      platform: 'discord',
      kind: 'dm',
      id: 'u1'
    });
    assert.strictEqual(chatPlatform.parseChannelKey('group:abc'), null);
  });

  it('normalizes platform ids and keeps room for later apps', () => {
    assert.strictEqual(chatPlatform.normalizePlatform(''), 'discord');
    assert.strictEqual(chatPlatform.normalizePlatform('Discord'), 'discord');
    assert.strictEqual(chatPlatform.normalizePlatform('matrix'), 'matrix');
    assert.strictEqual(chatPlatform.normalizePlatform('!!!'), null);
    assert.strictEqual(chatPlatform.isRegisteredPlatform('discord'), true);
    assert.strictEqual(chatPlatform.isRegisteredPlatform('matrix'), false);
  });
});
