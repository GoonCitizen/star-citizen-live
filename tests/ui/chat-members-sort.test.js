'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const Chat = require('../../components/Chat');

describe('Chat members sort (Fabric channels)', () => {
  it('orders online then lastMessageAt when refreshing global members', async () => {
    const chat = new Chat({ identityPubkey: '02me', nickname: 'Me' });
    chat.state.channel = 'global';
    chat.state.channels = [{ key: 'global', label: 'Global', kind: 'global' }];
    const prev = global.fetch;
    global.fetch = async (url) => {
      if (String(url).includes('/presence/roster')) {
        return {
          ok: true,
          json: async () => ({
            data: {
              '02aa': { nickname: 'Alice', online: true },
              '02bb': { nickname: 'Bob', online: false },
              '02cc': { nickname: 'Cara', online: true }
            }
          })
        };
      }
      return { ok: false, json: async () => ({}) };
    };
    try {
      await chat.refreshMembers(
        [{ key: 'global', label: 'Global', kind: 'global' }],
        [
          { author: '02aa', handle: 'Alice', ts: '2026-08-12T10:00:00.000Z' },
          { author: '02cc', handle: 'Cara', ts: '2026-08-12T12:00:00.000Z' },
          { author: '02bb', handle: 'Bob', ts: '2026-08-12T13:00:00.000Z' }
        ],
        null
      );
      const handles = chat.state.members.map((m) => m.handle || m.pubkey);
      // Online Cara (newer) before online Alice; offline Bob (recent) before self if offline.
      assert.ok(handles.indexOf('Cara') < handles.indexOf('Alice'));
      assert.ok(handles.indexOf('Alice') < handles.indexOf('Bob'));
      const cara = chat.state.members.find((m) => m.handle === 'Cara');
      assert.ok(cara.lastMessageAt > 0);
      assert.strictEqual(cara.online, true);
    } finally {
      global.fetch = prev;
    }
  });
});
