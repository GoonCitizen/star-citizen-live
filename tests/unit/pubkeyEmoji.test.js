'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
  EMOJI,
  GLYPH_COUNT,
  sha256Bytes,
  normalizeIdentitySource,
  initiatorSource,
  emojiFingerprint
} = require('../../functions/pubkeyEmoji');

function nodeSha256 (text) {
  return Uint8Array.from(crypto.createHash('sha256').update(String(text), 'utf8').digest());
}

describe('pubkeyEmoji', () => {
  it('uses a 64-glyph alphabet and eight fingerprints', () => {
    assert.equal(EMOJI.length, 64);
    assert.equal(GLYPH_COUNT, 8);
    assert.equal(new Set(EMOJI).size, 64);
  });

  it('matches Node SHA-256', () => {
    for (const s of ['', 'abc', 'id1example', '02' + 'ab'.repeat(32)]) {
      assert.deepEqual(Array.from(sha256Bytes(s)), Array.from(nodeSha256(s)), s);
    }
  });

  it('is stable for a Fabric id and differs across keys', () => {
    const a = emojiFingerprint('id1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const b = emojiFingerprint('id1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    assert.ok(a);
    assert.equal(a.glyphs.length, 8);
    assert.match(a.emoji, / /);
    assert.notEqual(a.emoji, b.emoji);
    assert.equal(emojiFingerprint(a.source).emoji, a.emoji);
  });

  it('normalizes hex pubkeys and reads initiator.id', () => {
    const hex = '02' + 'AB'.repeat(32);
    assert.equal(normalizeIdentitySource('0x' + hex), hex.toLowerCase());
    assert.equal(normalizeIdentitySource({ id: 'id1peer' }), 'id1peer');
    assert.equal(initiatorSource({ initiator: { id: 'id1peer', pubkeyHex: hex } }), 'id1peer');
    assert.equal(initiatorSource({ initiatorId: 'id1offer' }), 'id1offer');
    assert.equal(emojiFingerprint({ id: 'id1peer' }).emoji, emojiFingerprint('id1peer').emoji);
  });

  it('returns null when empty', () => {
    assert.equal(emojiFingerprint(''), null);
    assert.equal(emojiFingerprint(null), null);
    assert.equal(initiatorSource({}), '');
  });
});
