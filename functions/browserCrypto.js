'use strict';

/**
 * Node-shaped `crypto` for the dashboard bundle.
 *
 * esbuild-plugin-polyfill-node defaults `crypto` to an empty module
 * (`polyfills.crypto ?? "empty"`). After minify that becomes
 * `PJ.randomBytes is not a function` on Android first-run create.
 * Identity generation only needs CSPRNG bytes; AES/scrypt stay on the
 * Web Crypto path in `androidIdentityBridge`.
 */

function webCrypto () {
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto) ||
    (typeof window !== 'undefined' && window.crypto) ||
    null;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('Web Crypto getRandomValues is unavailable');
  }
  return c;
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

const subtle = (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) ||
  undefined;

module.exports = {
  randomBytes,
  getRandomValues,
  subtle
};
module.exports.default = module.exports;
