'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  messageTsMs,
  lastMessageAtByAuthor,
  compareChatMembers,
  sortChatMembers
} = require('../../functions/chatMemberSort');

describe('chatMemberSort', () => {
  it('parses timestamps and folds max lastMessageAt per author', () => {
    assert.ok(messageTsMs('2026-08-12T12:00:00.000Z') > 0);
    assert.strictEqual(messageTsMs(null), 0);
    const map = lastMessageAtByAuthor([
      { author: '02aa', ts: '2026-08-12T10:00:00.000Z' },
      { author: '02aa', ts: '2026-08-12T12:00:00.000Z' },
      { author: '02bb', ts: '2026-08-12T11:00:00.000Z' },
      { author: '', ts: '2026-08-12T13:00:00.000Z' }
    ]);
    assert.strictEqual(map.get('02aa'), Date.parse('2026-08-12T12:00:00.000Z'));
    assert.strictEqual(map.get('02bb'), Date.parse('2026-08-12T11:00:00.000Z'));
    assert.ok(!map.has(''));
  });

  it('sorts online first, then lastMessageAt descending, then handle', () => {
    const members = [
      { pubkey: 'a', handle: 'Zoe', online: false, lastMessageAt: 300 },
      { pubkey: 'b', handle: 'Amy', online: true, lastMessageAt: 100 },
      { pubkey: 'c', handle: 'Bob', online: true, lastMessageAt: 200 },
      { pubkey: 'd', handle: 'Cal', online: false, lastMessageAt: 0 },
      { pubkey: 'e', handle: 'Ann', online: true, lastMessageAt: 200 }
    ];
    const sorted = sortChatMembers(members);
    assert.deepStrictEqual(sorted.map((m) => m.handle), [
      'Ann', // online, ts 200, Ann < Bob
      'Bob', // online, ts 200
      'Amy', // online, ts 100
      'Zoe', // offline, ts 300
      'Cal'  // offline, missing/0
    ]);
    assert.ok(compareChatMembers(
      { online: true, lastMessageAt: 1, handle: 'a' },
      { online: false, lastMessageAt: 999, handle: 'z' }
    ) < 0);
  });
});
