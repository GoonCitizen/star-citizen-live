'use strict';

/**
 * Node-shaped `crypto` for the dashboard bundle.
 *
 * esbuild-plugin-polyfill-node defaults `crypto` to an empty module
 * (`polyfills.crypto ?? "empty"`). After minify that becomes
 * `PJ.randomBytes is not a function` (or `….createHash is not a function`)
 * on Android first-run create. Everything here is synchronous like Node's
 * API: random bytes from Web Crypto, hashes and AES-GCM from the `@noble`
 * packages `@fabric/core` and `@fabric/http` already depend on. Only the
 * algorithms the bundle uses are offered; anything else throws.
 */

const { sha256, sha512 } = require('@noble/hashes/sha2.js');
const { hmac } = require('@noble/hashes/hmac.js');
const { pbkdf2 } = require('@noble/hashes/pbkdf2.js');
const { hkdf } = require('@noble/hashes/hkdf.js');
const { gcm } = require('@noble/ciphers/aes.js');

const HASHES = { sha256, sha512 };

function webCrypto () {
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto) ||
    (typeof window !== 'undefined' && window.crypto) ||
    null;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('Web Crypto getRandomValues is unavailable');
  }
  return c;
}

function hashFor (algorithm) {
  const fn = HASHES[String(algorithm || '').toLowerCase().replace(/-/g, '')];
  if (!fn) throw new Error(`Digest method not supported: ${algorithm}`);
  return fn;
}

function toBytes (data, encoding) {
  if (typeof data === 'string') return Buffer.from(data, encoding || 'utf8');
  if (Buffer.isBuffer(data)) return data;
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  throw new TypeError('The "data" argument must be a string, Buffer, TypedArray, or DataView');
}

function output (bytes, encoding) {
  const buf = Buffer.from(bytes);
  return encoding ? buf.toString(encoding) : buf;
}

function randomBytes (size, cb) {
  const n = Number(size);
  if (!Number.isFinite(n) || n < 0 || n > 4294967295) {
    throw new RangeError('requested too many random bytes');
  }
  const out = Buffer.alloc(n >>> 0);
  if (n > 0) webCrypto().getRandomValues(out);
  if (typeof cb === 'function') {
    queueMicrotask(() => cb(null, out));
    return;
  }
  return out;
}

function getRandomValues (typedArray) {
  return webCrypto().getRandomValues(typedArray);
}

class Hash {
  constructor (state) {
    this._state = state;
  }

  update (data, encoding) {
    this._state.update(toBytes(data, encoding));
    return this;
  }

  digest (encoding) {
    return output(this._state.digest(), encoding);
  }

  copy () {
    return new Hash(this._state.clone());
  }
}

function createHash (algorithm) {
  return new Hash(hashFor(algorithm).create());
}

function createHmac (algorithm, key) {
  return new Hash(hmac.create(hashFor(algorithm), toBytes(key)));
}

function timingSafeEqual (a, b) {
  const x = toBytes(a);
  const y = toBytes(b);
  if (x.length !== y.length) throw new RangeError('Input buffers must have the same byte length');
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function pbkdf2Sync (password, salt, iterations, keylen, digest) {
  return Buffer.from(pbkdf2(hashFor(digest), toBytes(password), toBytes(salt), { c: iterations, dkLen: keylen }));
}

function hkdfSync (digest, ikm, salt, info, keylen) {
  const out = hkdf(hashFor(digest), toBytes(ikm), toBytes(salt), toBytes(info), keylen);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

/**
 * AES-256-GCM with Node's cipher shape. The whole message is buffered and
 * sealed in `final()`, so `update()` returns an empty Buffer; callers that
 * `Buffer.concat([update(…), final()])` get Node's exact bytes.
 */
class GcmCipher {
  constructor (decrypt, algorithm, key, iv, options) {
    options = options || {};
    if (String(algorithm).toLowerCase() !== 'aes-256-gcm') {
      throw new Error(`Cipher not supported: ${algorithm}`);
    }
    this._key = toBytes(key);
    if (this._key.length !== 32) throw new RangeError('Invalid key length');
    this._iv = toBytes(iv);
    this._decrypt = decrypt;
    if (options.authTagLength !== undefined && Number(options.authTagLength) !== 16) {
      throw new Error('Only 16-byte GCM auth tags are supported');
    }
    this._aad = undefined;
    this._chunks = [];
    this._tag = null;
    this._done = false;
  }

  setAAD (aad) {
    this._aad = toBytes(aad);
    return this;
  }

  setAuthTag (tag) {
    if (!this._decrypt) throw new Error('setAuthTag is only for deciphers');
    this._tag = toBytes(tag);
    return this;
  }

  getAuthTag () {
    if (this._decrypt || !this._tag) throw new Error('Auth tag is available after final()');
    return Buffer.from(this._tag);
  }

  update (data, inputEncoding, outputEncoding) {
    if (this._done) throw new Error('Cipher already finalized');
    this._chunks.push(toBytes(data, inputEncoding));
    return outputEncoding ? '' : Buffer.alloc(0);
  }

  final (outputEncoding) {
    if (this._done) throw new Error('Cipher already finalized');
    this._done = true;
    const input = Buffer.concat(this._chunks);
    const aead = gcm(this._key, this._iv, this._aad);
    if (this._decrypt) {
      if (!this._tag || this._tag.length !== 16) {
        throw new Error('Unsupported state or unable to authenticate data');
      }
      let plain;
      try {
        plain = aead.decrypt(Buffer.concat([input, this._tag]));
      } catch (_) {
        throw new Error('Unsupported state or unable to authenticate data');
      }
      return output(plain, outputEncoding);
    }
    const sealed = aead.encrypt(input);
    this._tag = sealed.subarray(sealed.length - 16);
    return output(sealed.subarray(0, sealed.length - 16), outputEncoding);
  }
}

function createCipheriv (algorithm, key, iv, options) {
  return new GcmCipher(false, algorithm, key, iv, options);
}

function createDecipheriv (algorithm, key, iv, options) {
  return new GcmCipher(true, algorithm, key, iv, options);
}

const subtle = (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) ||
  undefined;

module.exports = {
  randomBytes,
  getRandomValues,
  createHash,
  createHmac,
  timingSafeEqual,
  pbkdf2Sync,
  hkdfSync,
  createCipheriv,
  createDecipheriv,
  subtle
};
module.exports.default = module.exports;
