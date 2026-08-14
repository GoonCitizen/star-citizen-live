'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const browserCrypto = require('../../functions/browserCrypto');
const { createIdentity } = require('../../functions/identity');
const { generateVaultMnemonic } = require('../../functions/masterSeedVault');

describe('browserCrypto (Android dashboard shim)', () => {
  it('exposes randomBytes like Node crypto (empty polyfill does not)', () => {
    const empty = {};
    assert.equal(typeof empty.randomBytes, 'undefined');
    assert.equal(typeof browserCrypto.randomBytes, 'function');
    const a = browserCrypto.randomBytes(32);
    const b = browserCrypto.randomBytes(32);
    assert.equal(a.length, 32);
    assert.equal(b.length, 32);
    assert.notEqual(a.toString('hex'), b.toString('hex'));
  });

  it('createIdentity and vault mnemonic still generate keys', () => {
    const ident = createIdentity();
    assert.match(ident.mnemonic, /\S+/);
    assert.equal(ident.mnemonic.trim().split(/\s+/).length, 12);
    assert.match(ident.pubkey, /^0[23][0-9a-f]{64}$/i);
    const vault = generateVaultMnemonic();
    assert.ok(vault.split(/\s+/).length >= 12);
  });
});
