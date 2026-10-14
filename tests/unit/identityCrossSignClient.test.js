'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  postIdentityCrossSign,
  fetchIdentityCluster,
  tryFabricPublishCrossSign,
  tryFabricIdentityCluster
} = require('../../functions/identityCrossSignClient');

describe('identityCrossSignClient Fabric-first', () => {
  afterEach(() => {
    if (typeof global.window !== 'undefined') delete global.window;
  });

  it('publishCrossSign skips HTTP when electronAPI.fabric is present', async () => {
    const calls = [];
    global.window = {
      electronAPI: {
        fabric: {
          async publishCrossSign (opts) {
            return { data: { type: 'IdentityCrossSignRevoke', ...opts }, transport: 'fabric' };
          }
        }
      }
    };
    const posted = await postIdentityCrossSign('https://example.invalid', {
      type: 'IdentityCrossSignRevoke',
      peerPubkey: 'ab'.repeat(32),
      nonce: 'cd'.repeat(32)
    }, {
      fetchImpl: async (url) => {
        calls.push(url);
        throw new Error('HTTP should not run');
      }
    });
    assert.equal(posted.ok, true);
    assert.equal(posted.transport, 'fabric');
    assert.equal(calls.length, 0);
  });

  it('pre-signed Passport bodies still use HTTP', async () => {
    const calls = [];
    global.window = {
      electronAPI: {
        fabric: {
          async publishCrossSign () {
            throw new Error('must not sign again');
          }
        }
      }
    };
    const posted = await postIdentityCrossSign('https://hub.example', {
      type: 'IdentityCrossSign',
      signature: 'aa'.repeat(32),
      identity: { id: 'x' },
      peerPubkey: 'ab'.repeat(32),
      nonce: 'cd'.repeat(32)
    }, {
      fetchImpl: async (url) => {
        calls.push(url);
        return { ok: true, status: 200, json: async () => ({ data: { ok: true } }) };
      }
    });
    assert.equal(posted.ok, true);
    assert.equal(posted.transport, 'http');
    assert.ok(calls[0].includes('/identity/cross-sign'));
  });

  it('identityCluster skips HTTP when electronAPI.fabric is present', async () => {
    const calls = [];
    global.window = {
      electronAPI: {
        fabric: {
          async identityCluster ({ pubkey }) {
            return { data: { canonical: pubkey || 'me', members: ['me'], edges: [] } };
          }
        }
      }
    };
    const snap = await fetchIdentityCluster('https://example.invalid', 'pk1', {
      fetchImpl: async (url) => {
        calls.push(url);
        throw new Error('HTTP should not run');
      }
    });
    assert.equal(snap.ok, true);
    assert.equal(snap.transport, 'fabric');
    assert.equal(snap.data.canonical, 'pk1');
    assert.equal(calls.length, 0);
  });

  it('falls back to HTTP when fabric helpers are absent', async () => {
    global.window = {};
    const posted = await postIdentityCrossSign('https://hub.example', {
      type: 'IdentityCrossSign',
      peerPubkey: 'ab'.repeat(32),
      nonce: 'cd'.repeat(32)
    }, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: { via: 'http' } })
      })
    });
    assert.equal(posted.ok, true);
    assert.equal(posted.transport, 'http');
    assert.equal(posted.data.data.via, 'http');
  });

  it('forceHttp skips Fabric even when electronAPI.fabric is present', async () => {
    const fabricCalls = [];
    const httpCalls = [];
    global.window = {
      electronAPI: {
        fabric: {
          async publishCrossSign (opts) {
            fabricCalls.push(opts);
            return { data: { via: 'fabric' }, transport: 'fabric' };
          }
        }
      }
    };
    const posted = await postIdentityCrossSign('https://hub.example', {
      type: 'IdentityCrossSign',
      peerPubkey: 'ab'.repeat(32),
      nonce: 'cd'.repeat(32)
    }, {
      forceHttp: true,
      fetchImpl: async (url) => {
        httpCalls.push(url);
        return { ok: true, status: 200, json: async () => ({ data: { via: 'http' } }) };
      }
    });
    assert.equal(posted.transport, 'http');
    assert.equal(fabricCalls.length, 0);
    assert.ok(httpCalls[0].includes('/identity/cross-sign'));
  });

  it('fabric errors do not fall through to HTTP', async () => {
    const httpCalls = [];
    global.window = {
      electronAPI: {
        fabric: {
          async publishCrossSign () {
            return { error: 'Identity is locked' };
          }
        }
      }
    };
    const posted = await postIdentityCrossSign('https://example.invalid', {
      peerPubkey: 'ab'.repeat(32),
      nonce: 'cd'.repeat(32)
    }, {
      fetchImpl: async (url) => {
        httpCalls.push(url);
        throw new Error('HTTP should not run');
      }
    });
    assert.equal(posted.ok, false);
    assert.equal(posted.transport, 'fabric');
    assert.match(posted.error, /locked/i);
    assert.equal(httpCalls.length, 0);
  });

  it('incomplete fabric API (no publishCrossSign) falls back to HTTP', async () => {
    global.window = { electronAPI: { fabric: { identityCluster: async () => ({}) } } };
    const posted = await postIdentityCrossSign('https://hub.example', {
      peerPubkey: 'ab'.repeat(32),
      nonce: 'cd'.repeat(32)
    }, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true })
      })
    });
    assert.equal(posted.transport, 'http');
  });

  it('maps body.peer onto publishCrossSign peerPubkey', async () => {
    let seen = null;
    global.window = {
      electronAPI: {
        fabric: {
          async publishCrossSign (opts) {
            seen = opts;
            return { data: { ok: true }, transport: 'fabric' };
          }
        }
      }
    };
    await tryFabricPublishCrossSign({
      peer: 'ab'.repeat(32),
      nonce: 'cd'.repeat(32),
      '@type': 'IdentityCrossSignRevoke'
    });
    assert.equal(seen.peerPubkey, 'ab'.repeat(32));
    assert.equal(seen.type, 'IdentityCrossSignRevoke');
  });

  it('tryFabricPublishCrossSign returns null for pre-signed Passport bodies', async () => {
    global.window = {
      electronAPI: {
        fabric: {
          async publishCrossSign () {
            throw new Error('must not sign again');
          }
        }
      }
    };
    const out = await tryFabricPublishCrossSign({
      signature: 'aa'.repeat(32),
      pubkeyHex: '02' + 'ab'.repeat(32),
      peerPubkey: 'cd'.repeat(32),
      nonce: 'ef'.repeat(32)
    });
    assert.equal(out, null);
  });

  it('identityCluster HTTP fallback unwraps data and tries both paths', async () => {
    global.window = {};
    const urls = [];
    const snap = await fetchIdentityCluster('https://hub.example/', 'pk1', {
      fetchImpl: async (url) => {
        urls.push(url);
        if (url.includes('/services/star-citizen/')) {
          return { ok: true, json: async () => ({ data: { canonical: 'pk1', members: ['pk1'] } }) };
        }
        return { ok: false, json: async () => ({ error: 'nope' }) };
      }
    });
    assert.equal(snap.ok, true);
    assert.equal(snap.transport, 'http');
    assert.equal(snap.data.canonical, 'pk1');
    assert.deepEqual(urls, [
      'https://hub.example/identity/cluster?pubkey=pk1',
      'https://hub.example/services/star-citizen/identity/cluster?pubkey=pk1'
    ]);
  });

  it('forceHttp cluster snapshot skips Fabric', async () => {
    const fabricCalls = [];
    global.window = {
      electronAPI: {
        fabric: {
          async identityCluster (opts) {
            fabricCalls.push(opts);
            return { data: { canonical: 'fabric' } };
          }
        }
      }
    };
    const snap = await fetchIdentityCluster('https://hub.example', 'pk1', {
      forceHttp: true,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ data: { canonical: 'http' } })
      })
    });
    assert.equal(snap.transport, 'http');
    assert.equal(snap.data.canonical, 'http');
    assert.equal(fabricCalls.length, 0);
  });

  it('tryFabricIdentityCluster returns fabric errors without throwing', async () => {
    global.window = {
      electronAPI: {
        fabric: {
          async identityCluster () {
            return { error: 'relay not ready' };
          }
        }
      }
    };
    const out = await tryFabricIdentityCluster('pk1');
    assert.equal(out.ok, false);
    assert.equal(out.transport, 'fabric');
    assert.equal(out.error, 'relay not ready');
  });
});
