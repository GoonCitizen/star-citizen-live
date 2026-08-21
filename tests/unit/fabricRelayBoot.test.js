'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  fabricListenPort,
  fabricPeerSeeds,
  fabricBootBlock
} = require('../../functions/fabricRelayBoot');

describe('fabricRelayBoot', () => {
  it('prefers FABRIC_PORT over settings/local.js', () => {
    assert.equal(fabricListenPort({
      env: { FABRIC_PORT: '7777' },
      localSettings: { fabric: { port: 7778 } }
    }), 7777);
  });

  it('falls back to settings/local.js fabric.port', () => {
    assert.equal(fabricListenPort({
      env: {},
      localSettings: { fabric: { port: 7777 } }
    }), 7777);
    assert.equal(fabricListenPort({ env: {}, localSettings: {} }), 7777);
  });

  it('maps fabric.peers strings to constructor seeds (Hub-only on the relay)', () => {
    const seeds = fabricPeerSeeds({
      localSettings: { fabric: { peers: ['hub.fabric.pub:7777'] } }
    });
    assert.deepEqual(seeds, [{ address: 'hub.fabric.pub:7777', enabled: true }]);
    assert.equal(fabricPeerSeeds({ localSettings: {} }), undefined);
    assert.deepEqual(fabricPeerSeeds({
      localSettings: { fabric: { peers: [] } }
    }), []);
  });

  it('builds a server-mode fabric block with listen on unless SC_FABRIC=0', () => {
    const on = fabricBootBlock({
      env: {},
      localSettings: {
        fabric: { port: 7777, peers: ['hub.fabric.pub:7777'] }
      },
      listen: true,
      resolveInterface: () => '65.21.231.149'
    });
    assert.equal(on.enable, true);
    assert.equal(on.listen, true);
    assert.equal(on.port, 7777);
    assert.equal(on.interface, '65.21.231.149');
    assert.equal(on.peers.length, 1);
    const off = fabricBootBlock({
      env: { SC_FABRIC: '0' },
      localSettings: {},
      listen: true
    });
    assert.equal(off.enable, false);
  });

  it('omits peers on the fabric block when local.js has no fabric.peers', () => {
    const block = fabricBootBlock({ env: {}, localSettings: {} });
    assert.equal(Object.prototype.hasOwnProperty.call(block, 'peers'), false);
  });
});
