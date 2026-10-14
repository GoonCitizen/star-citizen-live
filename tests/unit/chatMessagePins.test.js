'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  MAX_PINNED_MESSAGES,
  normalizePinnedMessageId,
  sanitizePinnedMessageIds,
  togglePinnedMessageId,
  overlayPinnedMessages,
  isPinnedMessagesOnlyPatch,
  parsePinRequest
} = require('../../functions/chatMessagePins');

test('sanitizePinnedMessageIds dedupes, caps, and drops junk', () => {
  assert.strictEqual(normalizePinnedMessageId('abc'), null);
  assert.strictEqual(normalizePinnedMessageId('deadbeefcafebabe'), 'deadbeefcafebabe');
  const many = Array.from({ length: 80 }, (_, i) => 'msg' + String(i).padStart(8, '0'));
  const pins = sanitizePinnedMessageIds([
    'deadbeefcafebabe',
    'deadbeefcafebabe',
    { id: 'cafebabedeadbeef' },
    'nope',
    '',
    ...many
  ]);
  assert.strictEqual(pins[0], 'deadbeefcafebabe');
  assert.strictEqual(pins[1], 'cafebabedeadbeef');
  assert.ok(pins.length <= MAX_PINNED_MESSAGES);
  assert.ok(!pins.includes('nope'));
});

test('togglePinnedMessageId add/remove', () => {
  const id = 'deadbeefcafebabe';
  const added = togglePinnedMessageId([], id, true);
  assert.deepStrictEqual(added, [id]);
  assert.deepStrictEqual(togglePinnedMessageId(added, id, true), [id]);
  assert.deepStrictEqual(togglePinnedMessageId(added, id, false), []);
});

test('overlayPinnedMessages sets pinned from the group list', () => {
  const rows = [
    { id: 'deadbeefcafebabe', body: 'a' },
    { id: 'cafebabedeadbeef', body: 'b', pinned: true }
  ];
  const out = overlayPinnedMessages(rows, ['deadbeefcafebabe']);
  assert.strictEqual(out[0].pinned, true);
  assert.strictEqual(out[1].pinned, true);
  assert.strictEqual(overlayPinnedMessages(rows, []).length, 2);
});

test('isPinnedMessagesOnlyPatch and parsePinRequest', () => {
  assert.strictEqual(isPinnedMessagesOnlyPatch({ pinnedMessages: [] }), true);
  assert.strictEqual(isPinnedMessagesOnlyPatch({ pinnedMessages: [], name: 'x' }), false);
  assert.strictEqual(isPinnedMessagesOnlyPatch({ pinnedChannels: [] }), false);
  assert.strictEqual(parsePinRequest({ pinned: false }, true), false);
  assert.strictEqual(parsePinRequest({ pinned: true }, false), true);
  assert.strictEqual(parsePinRequest({}, true), false);
  assert.strictEqual(parsePinRequest({}, false), true);
});
