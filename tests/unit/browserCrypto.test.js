'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const browserCrypto = require('../../functions/browserCrypto');

const SHIM = path.join(__dirname, '../../functions/browserCrypto.js');

/** Require `file` fresh with `crypto` resolved to the shim, as the dashboard bundle does. */
function requireWithShim (file) {
  const resolve = Module._resolveFilename;
  const fresh = new Set();
  Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'crypto' || request === 'node:crypto') return SHIM;
    const resolved = resolve.call(this, request, parent, ...rest);
    if (resolved.startsWith(path.join(__dirname, '../..', 'functions'))) fresh.add(resolved);
    return resolved;
  };
  const saved = new Map();
  const target = require.resolve(file);
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(path.join(__dirname, '../..', 'functions')) && key !== SHIM) {
      saved.set(key, require.cache[key]);
      delete require.cache[key];
    }
  }
  try {
    return require(target);
  } finally {
    Module._resolveFilename = resolve;
    for (const key of fresh) delete require.cache[key];
    for (const [key, mod] of saved) require.cache[key] = mod;
  }
}

describe('browserCrypto (Android dashboard shim)', () => {
  it('exposes randomBytes like Node crypto (empty polyfill does not)', () => {
    const a = browserCrypto.randomBytes(32);
    const b = browserCrypto.randomBytes(32);
    assert.equal(a.length, 32);
    assert.equal(b.length, 32);
    assert.notEqual(a.toString('hex'), b.toString('hex'));
  });

  it('hashes like Node crypto', () => {
    const data = Buffer.from('fabric delegation', 'utf8');
    for (const alg of ['sha256', 'sha512']) {
      assert.equal(
        browserCrypto.createHash(alg).update('fabric ').update(data.subarray(7)).digest('hex'),
        nodeCrypto.createHash(alg).update(data).digest('hex')
      );
    }
    assert.deepEqual(
      browserCrypto.createHash('sha256').update('ab', 'hex').digest(),
      nodeCrypto.createHash('sha256').update('ab', 'hex').digest()
    );
    assert.equal(
      browserCrypto.createHmac('sha256', 'key').update('msg').digest('base64'),
      nodeCrypto.createHmac('sha256', 'key').update('msg').digest('base64')
    );
    assert.throws(() => browserCrypto.createHash('md5'), /not supported/);
  });

  it('derives keys like Node crypto', () => {
    assert.deepEqual(
      browserCrypto.pbkdf2Sync('pw', 'salt', 1000, 32, 'sha256'),
      nodeCrypto.pbkdf2Sync('pw', 'salt', 1000, 32, 'sha256')
    );
    assert.deepEqual(
      Buffer.from(browserCrypto.hkdfSync('sha256', 'ikm', 'salt', 'info', 32)),
      Buffer.from(nodeCrypto.hkdfSync('sha256', 'ikm', 'salt', 'info', 32))
    );
    assert.equal(browserCrypto.timingSafeEqual(Buffer.from('aa'), Buffer.from('aa')), true);
    assert.equal(browserCrypto.timingSafeEqual(Buffer.from('aa'), Buffer.from('ab')), false);
  });

  it('seals and opens AES-256-GCM interchangeably with Node crypto', () => {
    const key = nodeCrypto.randomBytes(32);
    const iv = nodeCrypto.randomBytes(12);
    const plain = Buffer.from('{"xprv":"secret"}', 'utf8');

    const shim = browserCrypto.createCipheriv('aes-256-gcm', key, iv);
    shim.setAAD(Buffer.from('aad'));
    const shimCt = Buffer.concat([shim.update(plain), shim.final()]);
    const node = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
    node.setAAD(Buffer.from('aad'));
    const nodeCt = Buffer.concat([node.update(plain), node.final()]);
    assert.deepEqual(shimCt, nodeCt);
    assert.deepEqual(shim.getAuthTag(), node.getAuthTag());

    const open = browserCrypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    open.setAAD(Buffer.from('aad'));
    open.setAuthTag(node.getAuthTag());
    assert.deepEqual(Buffer.concat([open.update(nodeCt), open.final()]), plain);

    const bad = browserCrypto.createDecipheriv('aes-256-gcm', key, iv);
    bad.setAuthTag(Buffer.alloc(16));
    bad.update(nodeCt);
    assert.throws(() => bad.final(), /authenticate/);
  });

  it('creates an identity with crypto resolved to the shim', () => {
    const { createIdentity } = requireWithShim('../../functions/identity');
    const ident = createIdentity();
    assert.equal(ident.mnemonic.trim().split(/\s+/).length, 24);
    assert.match(ident.pubkey, /^0[23][0-9a-f]{64}$/i);
    const { generateVaultMnemonic } = requireWithShim('../../functions/masterSeedVault');
    assert.ok(generateVaultMnemonic().split(/\s+/).length >= 12);
  });
});
