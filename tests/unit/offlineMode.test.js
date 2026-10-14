'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const offline = require('../../functions/offlineMode');

describe('offlineMode', () => {
  const prev = global.localStorage;

  beforeEach(() => {
    const mem = new Map();
    global.localStorage = {
      getItem (k) { return mem.has(k) ? mem.get(k) : null; },
      setItem (k, v) { mem.set(String(k), String(v)); },
      removeItem (k) { mem.delete(k); }
    };
  });

  afterEach(() => {
    global.localStorage = prev;
  });

  it('hides mesh tabs and keeps local play', () => {
    assert.equal(offline.tabHidden('chat'), true);
    assert.equal(offline.tabHidden('groups'), true);
    assert.equal(offline.tabHidden('network'), true);
    assert.equal(offline.tabHidden('wallet'), true);
    assert.equal(offline.tabHidden('documents'), true);
    assert.equal(offline.tabHidden('devices'), true);
    assert.equal(offline.tabHidden('live'), true);
    assert.equal(offline.tabHidden('home'), false);
    assert.equal(offline.tabHidden('missions'), false);
    assert.equal(offline.tabHidden('map'), false);
    assert.equal(offline.tabHidden('fleet'), false);
    assert.equal(offline.tabHidden('library'), false);
    assert.equal(offline.isOfflineMode(true), true);
    assert.equal(offline.isOfflineMode(false), false);
    assert.equal(offline.isOfflineMode('true'), false);
  });

  it('stores the first-paint hint as 1 and clears it when off', () => {
    assert.equal(offline.readOfflinePref(), false);
    offline.writeOfflinePref(true);
    assert.equal(offline.readOfflinePref(), true);
    assert.equal(global.localStorage.getItem(offline.PREF_KEY), '1');
    offline.writeOfflinePref(false);
    assert.equal(offline.readOfflinePref(), false);
    assert.equal(global.localStorage.getItem(offline.PREF_KEY), null);
  });

  it('reads the relay setting and writes the hint', async () => {
    const on = await offline.readOfflineMode(async () => ({
      ok: true,
      json: async () => ({ runtime: { offlineMode: true }, settings: {} })
    }));
    assert.equal(on, true);
    assert.equal(offline.readOfflinePref(), true);
    const off = await offline.readOfflineMode(async () => ({
      ok: true,
      json: async () => ({ settings: { offlineMode: false }, runtime: { offlineMode: false } })
    }));
    assert.equal(off, false);
    assert.equal(offline.readOfflinePref(), false);
  });
});
