'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  sanitizePinnedGroupIds,
  togglePinnedGroupId,
  orderGroupsWithPins,
  MAX_PINNED_GROUPS
} = require('../../functions/groupSidebarPins');

describe('groupSidebarPins', () => {
  it('sanitizes ids and caps the list', () => {
    assert.deepStrictEqual(sanitizePinnedGroupIds(['group-1', 'group-1', 'no', '']), ['group-1']);
    const many = Array.from({ length: 50 }, (_, i) => 'group-' + String(i).padStart(2, '0'));
    assert.strictEqual(sanitizePinnedGroupIds(many).length, MAX_PINNED_GROUPS);
  });

  it('toggles pin membership', () => {
    const once = togglePinnedGroupId([], 'group-1');
    assert.deepStrictEqual(once, ['group-1']);
    assert.deepStrictEqual(togglePinnedGroupId(once, 'group-1'), []);
  });

  it('orders pinned groups first', () => {
    const groups = [
      { id: 'group-a', name: 'A' },
      { id: 'group-b', name: 'B' },
      { id: 'group-c', name: 'C' }
    ];
    const ordered = orderGroupsWithPins(groups, ['group-c', 'group-a']);
    assert.deepStrictEqual(ordered.map((g) => g.id), ['group-c', 'group-a', 'group-b']);
  });
});
