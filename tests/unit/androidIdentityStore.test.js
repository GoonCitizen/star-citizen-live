'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  IDENTITY_PREF,
  AUTOLOCK_PREF,
  readIdentityBlob,
  persistIdentityBlob,
  clearIdentityBlob
} = require('../../functions/androidIdentityStore');

function memoryStorage () {
  const map = new Map();
  return {
    getItem (key) { return map.has(key) ? map.get(key) : null; },
    setItem (key, value) { map.set(key, String(value)); },
    removeItem (key) { map.delete(key); },
    has (key) { return map.has(key); }
  };
}

function mockKeyStore () {
  let json = null;
  return {
    async status () {
      return { available: true, hasWrappedIdentity: !!json, backend: 'tee' };
    },
    async readIdentity () { return { json }; },
    async writeIdentity (opts) {
      json = opts && opts.json != null ? String(opts.json) : null;
      return { ok: true, backend: 'tee' };
    },
    async clearIdentity () { json = null; return { ok: true }; },
    peek () { return json; }
  };
}

describe('androidIdentityStore', () => {
  let prevWindow;
  let prevLocalStorage;
  let prefs;
  let keyStore;
  let local;

  beforeEach(() => {
    prevWindow = global.window;
    prevLocalStorage = global.localStorage;
    prefs = new Map();
    keyStore = mockKeyStore();
    local = memoryStorage();
    global.window = {
      Capacitor: {
        Plugins: {
          Preferences: {
            async get ({ key }) { return { value: prefs.get(key) || null }; },
            async set ({ key, value }) { prefs.set(key, value); },
            async remove ({ key }) { prefs.delete(key); }
          },
          FabricKeyStore: keyStore
        }
      }
    };
    global.localStorage = local;
  });

  afterEach(() => {
    if (prevWindow === undefined) delete global.window;
    else global.window = prevWindow;
    if (prevLocalStorage === undefined) delete global.localStorage;
    else global.localStorage = prevLocalStorage;
  });

  it('writes the password blob through Keystore and never localStorage', async () => {
    const blob = { pubkey: 'aa'.repeat(32), version: 1 };
    const result = await persistIdentityBlob(blob);
    assert.equal(result.backend, 'tee');
    assert.ok(keyStore.peek());
    assert.equal(JSON.parse(keyStore.peek()).pubkey, blob.pubkey);
    assert.equal(prefs.has(IDENTITY_PREF), false);
    assert.equal(local.has(IDENTITY_PREF), false);
    const read = await readIdentityBlob();
    assert.deepEqual(read, blob);
  });

  it('migrates Preferences into Keystore and drops the pref copy', async () => {
    const blob = { pubkey: 'bb'.repeat(32), xpub: 'xpub1' };
    prefs.set(IDENTITY_PREF, JSON.stringify(blob));
    const read = await readIdentityBlob();
    assert.deepEqual(read, blob);
    assert.ok(keyStore.peek());
    assert.equal(prefs.has(IDENTITY_PREF), false);
    assert.equal(local.has(IDENTITY_PREF), false);
  });

  it('migrates localStorage once then scrubs it', async () => {
    const blob = { pubkey: 'cc'.repeat(32) };
    local.setItem(IDENTITY_PREF, JSON.stringify(blob));
    const read = await readIdentityBlob();
    assert.deepEqual(read, blob);
    assert.ok(keyStore.peek());
    assert.equal(local.has(IDENTITY_PREF), false);
    assert.equal(prefs.has(IDENTITY_PREF), false);
  });

  it('falls back to Preferences without localStorage when Keystore write fails', async () => {
    window.Capacitor.Plugins.FabricKeyStore = {
      async writeIdentity () { throw new Error('StrongBox unavailable'); },
      async readIdentity () { return { json: null }; },
      async clearIdentity () { return { ok: true }; }
    };
    const blob = { pubkey: 'dd'.repeat(32) };
    const result = await persistIdentityBlob(blob);
    assert.equal(result.backend, 'preferences');
    assert.equal(JSON.parse(prefs.get(IDENTITY_PREF)).pubkey, blob.pubkey);
    assert.equal(local.has(IDENTITY_PREF), false);
  });

  it('forget clears wrap, Preferences, and localStorage', async () => {
    local.setItem(IDENTITY_PREF, '{"stale":true}');
    local.setItem(AUTOLOCK_PREF, '15');
    prefs.set(IDENTITY_PREF, JSON.stringify({ pubkey: 'ee'.repeat(32) }));
    await persistIdentityBlob({ pubkey: 'ff'.repeat(32) });
    await clearIdentityBlob();
    assert.equal(keyStore.peek(), null);
    assert.equal(prefs.has(IDENTITY_PREF), false);
    assert.equal(local.has(IDENTITY_PREF), false);
    assert.equal(local.has(AUTOLOCK_PREF), false);
    assert.equal(await readIdentityBlob(), null);
  });
});
