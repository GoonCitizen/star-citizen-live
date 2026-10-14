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

  it('toPublicJSON exposes publisher, contract, and validators without the member roster', () => {
    const a = new Key();
    const b = new Key();
    const group = new Group({
      id: 'pub-group',
      name: 'Public Wing',
      creator: a.pubkey,
      members: [a.pubkey, b.pubkey],
      validators: [a.pubkey],
      threshold: 1,
      visibility: 'public',
      contractId: 'ab'.repeat(32),
      policyFingerprint: 'cd'.repeat(32)
    });
    const pub = group.toPublicJSON();
    assert.equal(pub.creator, a.pubkey);
    assert.equal(pub.contractId, 'ab'.repeat(32));
    assert.equal(pub.memberCount, 2);
    assert.equal(pub.signerCount, 1);
    assert.deepEqual(pub.validators, [a.pubkey.toLowerCase()]);
    assert.equal(pub.policyFingerprint, 'cd'.repeat(32));
    assert.equal(pub.members, undefined);
  });
});
