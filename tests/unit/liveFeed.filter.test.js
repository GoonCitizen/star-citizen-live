'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  filterLiveFeed,
  sourceKind,
  DEFAULT_FEED_SOURCES
} = require('../../functions/liveFeed');

describe('liveFeed filters', () => {
  const items = [
    { id: '1', category: 'chat', source: 'local', body: 'o7 from Neorion', badges: [] },
    { id: '2', category: 'combat', source: 'peer', body: 'kill laser', badges: [{ label: 'weapon', value: 'laser' }] },
    { id: '3', category: 'chat', source: 'group', body: 'form up', kind: 'ChatMessage' },
    { id: '4', category: 'note', source: 'local', body: 'Nights-only gunner', kind: 'NoteShare' }
  ];

  it('sourceKind maps group channels and peer pubkeys', () => {
    assert.strictEqual(sourceKind(null), 'local');
    assert.strictEqual(sourceKind('02aa'), 'peer');
    assert.strictEqual(sourceKind(null, { channel: 'group:abc' }), 'group');
    assert.strictEqual(sourceKind('02aa', { scope: 'group' }), 'group');
    assert.deepStrictEqual(DEFAULT_FEED_SOURCES, ['local']);
  });

  it('filterLiveFeed intersects category, source, and keywords', () => {
    const chat = filterLiveFeed(items, { categories: new Set(['chat']) });
    assert.deepStrictEqual(chat.map((i) => i.id), ['1', '3']);
    const local = filterLiveFeed(items, { sources: new Set(['local']) });
    assert.deepStrictEqual(local.map((i) => i.id), ['1', '4']);
    const laser = filterLiveFeed(items, { keywords: ['laser'] });
    assert.deepStrictEqual(laser.map((i) => i.id), ['2']);
    const none = filterLiveFeed(items, { categories: new Set(['quantum']) });
    assert.deepStrictEqual(none, []);
    assert.strictEqual(filterLiveFeed(items, {}).length, 4);
    const notes = filterLiveFeed(items, { categories: new Set(['note']) });
    assert.deepStrictEqual(notes.map((i) => i.id), ['4']);
    assert.deepStrictEqual(filterLiveFeed(null, { keywords: ['x'] }), []);
  });
});
