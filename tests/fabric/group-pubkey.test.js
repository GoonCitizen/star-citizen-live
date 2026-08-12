'use strict';

/**
 * Fabric expectations: Group pubkey matching (compressed vs x-only).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Key = require('@fabric/core/types/key');
const Group = require('../../types/Group');
const { pubkeyXOnly } = require('../../functions/identity');

describe('Fabric expectations: Group membership vs pubkey forms', () => {
  it('includes/isSigner match compressed and x-only forms', () => {
    const a = new Key();
    const b = new Key();
    const group = new Group({
      id: 'test-group',
      name: 'Test',
      members: [a.pubkey, b.pubkey],
      validators: [a.pubkey],
      threshold: 1
    });
    assert.equal(group.includes(a.pubkey), true);
    assert.equal(group.includes(pubkeyXOnly(a.pubkey)), true);
    assert.equal(group.isSigner(a.pubkey), true);
    assert.equal(group.isSigner(pubkeyXOnly(a.pubkey)), true);
    assert.equal(group.isSigner(b.pubkey), false);
  });
});
