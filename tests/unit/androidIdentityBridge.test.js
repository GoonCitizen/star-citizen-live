'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { installAndroidIdentityBridge, IDENTITY_PREF } = require('../../functions/androidIdentityBridge');
const { isAndroidCompanion } = require('../../functions/isAndroidCompanion');

describe('androidIdentityBridge', () => {
  it('does not install outside Capacitor', () => {
    assert.equal(installAndroidIdentityBridge(), false);
    assert.equal(isAndroidCompanion(), false);
  });

  it('create reports exists so the UI can offer forget', async () => {
    const store = new Map();
    const prevWindow = global.window;
    const prevCap = typeof window !== 'undefined' ? window.Capacitor : undefined;
    const prevApi = typeof window !== 'undefined' ? window.electronAPI : undefined;
    global.window = global.window || {};
    window.Capacitor = {
      Plugins: {
        Preferences: {
          async get ({ key }) { return { value: store.get(key) || null }; },
          async set ({ key, value }) { store.set(key, value); },
          async remove ({ key }) { store.delete(key); }
        }
      }
    };
    window.electronAPI = null;
    try {
      store.set(IDENTITY_PREF, JSON.stringify({ pubkey: 'aa'.repeat(32), xpub: 'xpub1' }));
      assert.equal(installAndroidIdentityBridge(), true);
      const res = await window.electronAPI.identity.create('password12');
      assert.equal(res.exists, true);
      assert.match(res.error, /already exists/);
      const forgotten = await window.electronAPI.identity.forget(true);
      assert.equal(forgotten.ok, true);
      assert.equal(store.has(IDENTITY_PREF), false);
    } finally {
      window.Capacitor = prevCap;
      window.electronAPI = prevApi;
      if (prevWindow === undefined) delete global.window;
    }
  });

  it('opens fabric://link through the local node, not the public hub', async () => {
    const prevWindow = global.window;
    const prevCap = typeof window !== 'undefined' ? window.Capacitor : undefined;
    const prevApi = typeof window !== 'undefined' ? window.electronAPI : undefined;
    const prevFetch = globalThis.fetch;
    const calls = [];
    global.window = global.window || {};
    window.Capacitor = { Plugins: { Preferences: { async get () { return { value: null }; } } } };
    window.electronAPI = null;
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          status: 'pending',
          sessionId: 'aa'.repeat(24),
          nonce: 'bb'.repeat(32),
          origin: 'https://relay.goon.vc',
          initiator: { id: 'id1peer', pubkeyHex: '02' + 'ab'.repeat(32) }
        })
      };
    };
    try {
      assert.equal(installAndroidIdentityBridge(), true);
      const sid = 'aa'.repeat(24);
      const url = `fabric://link?sessionId=${sid}&hub=${encodeURIComponent('https://relay.goon.vc')}`;
      await window.electronAPI.identity.openProtocolUrl(url);
      assert.equal(calls.length, 1);
      assert.match(calls[0], /^http:\/\/127\.0\.0\.1:3041\/services\/star-citizen\/device-links\/pending/);
      assert.doesNotMatch(calls[0], /relay\.goon\.vc\/device-links/);
      const locked = await window.electronAPI.identity.startDeviceLinkOffer({});
      assert.match(locked.error || '', /locked/i);
    } finally {
      globalThis.fetch = prevFetch;
      window.Capacitor = prevCap;
      window.electronAPI = prevApi;
      if (prevWindow === undefined) delete global.window;
    }
  });
});
