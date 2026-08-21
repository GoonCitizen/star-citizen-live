'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const DeliverySync = require('../../components/DeliverySync');

const HASH = 'ab'.repeat(32);

describe('DeliverySync Fabric-first transport', () => {
  afterEach(() => {
    if (typeof global.window !== 'undefined') delete global.window;
    delete globalThis.fetch;
  });

  it('uses electronAPI.fabric.deliveryReceipt and skips HTTP', async () => {
    const httpCalls = [];
    global.window = {
      electronAPI: {
        fabric: {
          async deliveryReceipt (opts) {
            return { data: { wireHash: opts.wireHash, local: { receipt: true } } };
          }
        }
      }
    };
    globalThis.fetch = async (url) => {
      httpCalls.push(url);
      throw new Error('HTTP should not run');
    };
    const out = await DeliverySync.postDeliveryReceipt(HASH, { contractId: 'c1' });
    assert.equal(out.transport, 'ipc');
    assert.equal(out.local.receipt, true);
    assert.equal(httpCalls.length, 0);
  });

  it('prefers IPC over a signed Bridge wire', async () => {
    let ipc = 0;
    let mesh = 0;
    global.window = {
      electronAPI: {
        fabric: {
          async deliveryReceipt () {
            ipc += 1;
            return { data: { via: 'ipc' } };
          }
        }
      },
      FabricBridge: {
        relaySignedFabricWire () {
          mesh += 1;
          return { relayedToHub: true, meshRecipients: ['p1'] };
        }
      }
    };
    globalThis.fetch = async () => {
      throw new Error('HTTP should not run');
    };
    const out = await DeliverySync.postDeliveryReceipt(HASH, { messageHex: 'deadbeef' });
    assert.equal(out.transport, 'ipc');
    assert.equal(ipc, 1);
    assert.equal(mesh, 0);
  });

  it('relays a signed Bridge wire when IPC is absent', async () => {
    global.window = {
      FabricBridge: {
        relaySignedFabricWire (wire, opts) {
          assert.equal(wire, 'aabb');
          assert.equal(opts.originalType, 'CONTRACT_MESSAGE');
          return { relayedToHub: true, meshRecipients: [] };
        }
      }
    };
    const httpCalls = [];
    globalThis.fetch = async (url) => {
      httpCalls.push(url);
      throw new Error('HTTP should not run');
    };
    const out = await DeliverySync.postDeliveryReceipt(HASH, { messageHex: 'aabb' });
    assert.equal(out.transport, 'webrtc');
    assert.equal(out.relayedToHub, true);
    assert.equal(httpCalls.length, 0);
  });

  it('falls back to HTTP POST /delivery/:hash/receipt', async () => {
    global.window = {};
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({ data: { local: { receipt: true } } })
      };
    };
    const out = await DeliverySync.postDeliveryReceipt(HASH, {
      contractId: 'c1',
      chatMessageId: 'm1',
      authToken: 'tok'
    });
    assert.equal(out.local.receipt, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/services\/star-citizen\/delivery\/[a-f0-9]+\/receipt$/);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.contractId, 'c1');
    assert.equal(body.chatMessageId, 'm1');
  });

  it('throws IPC errors instead of falling through to HTTP', async () => {
    const httpCalls = [];
    global.window = {
      electronAPI: {
        fabric: {
          async deliveryReceipt () {
            return { error: 'Unlock your identity to send a receipt' };
          }
        }
      }
    };
    globalThis.fetch = async (url) => {
      httpCalls.push(url);
      throw new Error('HTTP should not run');
    };
    await assert.rejects(
      () => DeliverySync.postDeliveryReceipt(HASH),
      /Unlock your identity/
    );
    assert.equal(httpCalls.length, 0);
  });

  it('rejects an empty wire hash before any transport', async () => {
    await assert.rejects(() => DeliverySync.postDeliveryReceipt(''), /wireHash required/);
  });
});
