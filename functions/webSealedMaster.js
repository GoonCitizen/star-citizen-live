'use strict';

/**
 * Core `sealMaster` / `unsealMaster` on Web Crypto, for the Android WebView
 * (the dashboard bundle's `crypto` shim has no PBKDF2 or AES-GCM). Writes and
 * reads the same `FabricSealedMaster` envelope, so either side opens the
 * other's vault.
 */

const { Buffer } = require('buffer');
const accountKeys = require('@fabric/core/functions/accountKeys');

const SEAL_SCHEME = 'aes-256-gcm-pbkdf2-sha256';
const ITERATIONS = 210000;
const MIN_ITERATIONS = 100000;
const MAX_ITERATIONS = 5000000;
const PASSWORD_MIN_LENGTH = 8;

function subtleCrypto () {
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
  if (!c || !c.subtle || typeof c.getRandomValues !== 'function') {
    throw new Error('Web Crypto is unavailable');
  }
  return c;
}

async function aesKey (password, salt, iterations) {
  const c = subtleCrypto();
  const base = await c.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return c.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * @param {string} master Master xprv.
 * @param {string} password Lock password.
 * @returns {Promise<object>} `FabricSealedMaster` envelope.
 */
async function sealMasterWeb (master, password) {
  const pwd = String(password == null ? '' : password);
  if (pwd.length < PASSWORD_MIN_LENGTH) throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  const xprv = accountKeys.normalizeMasterXprv(master);
  const c = subtleCrypto();
  const salt = c.getRandomValues(new Uint8Array(16));
  const iv = c.getRandomValues(new Uint8Array(12));
  const key = await aesKey(pwd, salt, ITERATIONS);
  const plain = new TextEncoder().encode(JSON.stringify({ xprv }));
  const ciphertext = new Uint8Array(await c.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, plain));
  return {
    type: 'FabricSealedMaster',
    version: accountKeys.ACCOUNT_VAULT_VERSION,
    encryption: SEAL_SCHEME,
    kdf: { name: 'pbkdf2', hash: 'sha256', iterations: ITERATIONS, salt: Buffer.from(salt).toString('base64') },
    iv: Buffer.from(iv).toString('base64'),
    ciphertext: Buffer.from(ciphertext).toString('base64')
  };
}

/**
 * @param {object} seal `FabricSealedMaster` envelope.
 * @param {string} password Lock password.
 * @returns {Promise<string>} Master xprv.
 */
async function unsealMasterWeb (seal, password) {
  if (!seal || typeof seal !== 'object' || !seal.kdf || !seal.ciphertext) throw new Error('sealed master required');
  if (String(seal.encryption || SEAL_SCHEME) !== SEAL_SCHEME) throw new Error('Unsupported seal scheme');
  const iterations = Number(seal.kdf.iterations) || ITERATIONS;
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new Error('Invalid PBKDF2 iteration count.');
  const salt = new Uint8Array(Buffer.from(String(seal.kdf.salt || ''), 'base64'));
  const iv = new Uint8Array(Buffer.from(String(seal.iv || seal.nonce || ''), 'base64'));
  const data = new Uint8Array(Buffer.from(String(seal.ciphertext), 'base64'));
  if (iv.length !== 12 || data.length <= 16) throw new Error('Invalid sealed master.');
  let inner;
  try {
    const key = await aesKey(String(password == null ? '' : password), salt, iterations);
    const plain = await subtleCrypto().subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, data);
    inner = JSON.parse(new TextDecoder().decode(plain));
  } catch (_) {
    throw new Error('Could not decrypt identity (wrong password or corrupted file)');
  }
  if (!inner || typeof inner.xprv !== 'string') throw new Error('sealed master is missing its xprv');
  return accountKeys.normalizeMasterXprv(inner.xprv);
}

module.exports = {
  sealMasterWeb,
  unsealMasterWeb
};
