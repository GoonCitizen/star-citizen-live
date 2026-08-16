'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchPresence,
  fetchPresenceRoster,
  putPresence,
  putPresenceShip,
  tryFabricSetPresence
} = require('../../functions/presenceClient');

describe('presenceClient Fabric-first', () => {
  afterEach(() => {
    if (typeof global.window !== 'undefined') delete global.window;
  });

  it('fetchPresence skips HTTP when electronAPI.fabric is present', async () => {
    const calls = [];
    global.window = {
      electronAPI: {
        fabric: {
          async presenceStatus () {
            return { data: { online: true, settings: { sharePresence: true } }, transport: 'fabric' };
          }
        }
      }
    };
    const got = await fetchPresence({
      fetchImpl: async (url) => {
        calls.push(url);
        throw new Error('HTTP should not run');
      }
    });
    assert.equal(got.ok, true);
    assert.equal(got.transport, 'fabric');
    assert.equal(got.data.online, true);
    assert.equal(calls.length, 0);
  });

  it('fetchPresenceRoster skips HTTP when electronAPI.fabric is present', async () => {
    const calls = [];
    global.window = {
      electronAPI: {
        fabric: {
          async presenceRoster () {
            return { data: { '02aa': { online: true } }, transport: 'fabric' };
          }
        }
      }
    };
    const got = await fetchPresenceRoster({
      fetchImpl: async (url) => {
        calls.push(url);
        throw new Error('HTTP should not run');
      }
    });
    assert.equal(got.ok, true);
    assert.equal(got.transport, 'fabric');
    assert.equal(got.data['02aa'].online, true);
    assert.equal(calls.length, 0);
  });

  it('putPresence and putPresenceShip skip HTTP when fabric helpers exist', async () => {
    const calls = [];
    global.window = {
      electronAPI: {
        fabric: {
          async setPresence (patch) {
            return { data: { settings: patch }, transport: 'fabric' };
          },
          async setPresenceShip (body) {
            return { data: { ship: body }, transport: 'fabric' };
          }
        }
      }
    };
    const status = await putPresence({ visibility: 'peers' }, {
      fetchImpl: async (url) => {
        calls.push(url);
        throw new Error('HTTP should not run');
      }
    });
    const ship = await putPresenceShip({ slug: 'gladius' }, {
      fetchImpl: async (url) => {
        calls.push(url);
        throw new Error('HTTP should not run');
      }
    });
    assert.equal(status.transport, 'fabric');
    assert.equal(status.data.settings.visibility, 'peers');
    assert.equal(ship.transport, 'fabric');
    assert.equal(ship.data.ship.slug, 'gladius');
    assert.equal(calls.length, 0);
  });

  it('falls back to HTTP when fabric helpers are absent', async () => {
    global.window = {};
    const urls = [];
    const got = await fetchPresence({
      fetchImpl: async (url) => {
        urls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { online: false } })
        };
      }
    });
    assert.equal(got.ok, true);
    assert.equal(got.transport, 'http');
    assert.equal(got.data.online, false);
    assert.ok(urls[0].includes('/presence'));
  });

  it('forceHttp skips Fabric even when electronAPI.fabric is present', async () => {
    const fabricCalls = [];
    const httpCalls = [];
    global.window = {
      electronAPI: {
        fabric: {
          async presenceStatus () {
            fabricCalls.push('status');
            return { data: { via: 'fabric' }, transport: 'fabric' };
          }
        }
      }
    };
    const got = await fetchPresence({
      forceHttp: true,
      fetchImpl: async (url) => {
        httpCalls.push(url);
        return { ok: true, status: 200, json: async () => ({ data: { via: 'http' } }) };
      }
    });
    assert.equal(got.transport, 'http');
    assert.equal(got.data.via, 'http');
    assert.equal(fabricCalls.length, 0);
    assert.ok(httpCalls[0].includes('/presence'));
  });

  it('fabric errors do not fall through to HTTP', async () => {
    const httpCalls = [];
    global.window = {
      electronAPI: {
        fabric: {
          async setPresence () {
            return { error: 'relay not ready' };
          }
        }
      }
    };
    const posted = await putPresence({ visibility: 'public' }, {
      fetchImpl: async (url) => {
        httpCalls.push(url);
        throw new Error('HTTP should not run');
      }
    });
    assert.equal(posted.ok, false);
    assert.equal(posted.transport, 'fabric');
    assert.match(posted.error, /ready/i);
    assert.equal(httpCalls.length, 0);
  });

  it('incomplete fabric API (no presenceStatus) falls back to HTTP', async () => {
    global.window = { electronAPI: { fabric: { identityCluster: async () => ({}) } } };
    const got = await fetchPresence({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: { via: 'http' } })
      })
    });
    assert.equal(got.transport, 'http');
    assert.equal(got.data.via, 'http');
  });

  it('tryFabricSetPresence returns fabric errors without throwing', async () => {
    global.window = {
      electronAPI: {
        fabric: {
          async setPresence () {
            return { error: 'Identity is locked' };
          }
        }
      }
    };
    const out = await tryFabricSetPresence({ visibility: 'peers' });
    assert.equal(out.ok, false);
    assert.equal(out.transport, 'fabric');
    assert.match(out.error, /locked/i);
  });

  it('HTTP PUT unwraps data and falls back to the short path', async () => {
    global.window = {};
    const urls = [];
    const posted = await putPresence({ visibility: 'peers' }, {
      fetchImpl: async (url) => {
        urls.push(url);
        if (url.includes('/services/star-citizen/')) {
          return { ok: false, status: 404, json: async () => ({ error: 'nope' }) };
        }
        return { ok: true, status: 200, json: async () => ({ data: { settings: { visibility: 'peers' } } }) };
      }
    });
    assert.equal(posted.ok, true);
    assert.equal(posted.transport, 'http');
    assert.equal(posted.data.settings.visibility, 'peers');
    assert.deepEqual(urls, [
      '/services/star-citizen/presence',
      '/presence'
    ]);
  });
});
