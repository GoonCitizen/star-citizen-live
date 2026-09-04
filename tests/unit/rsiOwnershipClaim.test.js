'use strict';

const test = require('node:test');
const assert = require('assert');
const crypto = require('crypto');

const claim = require('../../functions/rsiOwnershipClaim');

const PUB = '039822622cf330b98e52e7357135bc93e1e5606a57a9819408734598fe5677b134';
const EXPECTED_HASH = crypto.createHash('sha256')
  .update(Buffer.from(PUB, 'hex'))
  .digest('hex');
const EXPECTED_PREFIX = EXPECTED_HASH.substring(0, 7);

test('pubkeyHashHex / ownershipClaimToken are stable', () => {
  assert.strictEqual(claim.pubkeyHashHex(PUB), EXPECTED_HASH);
  assert.strictEqual(claim.pubkeyHashPrefix(PUB), EXPECTED_PREFIX);
  assert.strictEqual(claim.ownershipClaimToken(PUB), 'g00n:' + EXPECTED_PREFIX);
  assert.strictEqual(claim.ownershipClaimToken('not-a-key'), null);
});

test('extractClaimSuffixes finds g00n tokens in bio text', () => {
  const bio = 'LEADER OF THE RED ARMY\ng00n:' + EXPECTED_PREFIX + ' · fly with us';
  assert.deepStrictEqual(claim.extractClaimSuffixes(bio), [EXPECTED_PREFIX]);
  assert.deepStrictEqual(claim.extractClaimSuffixes('no claim here'), []);
  assert.deepStrictEqual(
    claim.extractClaimSuffixes('g00n:ABCDEF0 and g00n:1234567'),
    ['abcdef0', '1234567']
  );
});

test('textOwnsPubkey / verifyOwnershipFromBio', () => {
  const bio = 'Hello world g00n:' + EXPECTED_PREFIX.toUpperCase() + '!';
  assert.strictEqual(claim.textOwnsPubkey(bio, PUB), true);
  assert.strictEqual(claim.textOwnsPubkey('g00n:0000000', PUB), false);
  const ok = claim.verifyOwnershipFromBio({
    pubkey: PUB,
    bio,
    handle: 'ChairmanPoW'
  });
  assert.strictEqual(ok.verified, true);
  assert.strictEqual(ok.claim, 'g00n:' + EXPECTED_PREFIX);
  assert.strictEqual(ok.handle, 'ChairmanPoW');
  const bad = claim.verifyOwnershipFromBio({ pubkey: PUB, bio: 'nope' });
  assert.strictEqual(bad.verified, false);
});
