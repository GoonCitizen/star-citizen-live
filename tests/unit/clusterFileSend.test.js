'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const Key = require('@fabric/core/types/key');
const Message = require('@fabric/core/types/message');
const FabricNetwork = require('../../services/FabricNetwork');

describe('FabricNetwork catalog file send', () => {
  it('writes P2P_FILE_SEND frames to a connected peer', () => {
    const net = new FabricNetwork({ enable: false, listen: false, peers: [] });
    const key = new Key();
    const writes = [];
    const body = Buffer.from('cluster-hello');
    const documentId = crypto.createHash('sha256').update(body).digest('hex');
    net._peer = {
      key,
      connections: {
        '10.0.0.8:7777': {
          _writeFabric: (buf) => writes.push(buf)
        }
      }
    };
    const wrote = net.sendCatalogFile('10.0.0.8:7777', body, { documentId });
    assert.ok(wrote >= 1);
    assert.strictEqual(writes.length, wrote);
    const wire = Message.fromBuffer(writes[0]);
    assert.strictEqual(wire.type, 'P2P_FILE_SEND');
    const inner = JSON.parse(wire.data);
    assert.strictEqual(inner.name, documentId);
    assert.strictEqual(inner.clusterSync, true);
    assert.ok(inner.body);
  });

  it('recordMessage prints fabric sync/peering stdout for non-keepalive frames', () => {
    const lines = [];
    const orig = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
      const net = new FabricNetwork({ enable: false, listen: false, peers: [] });
      net.recordMessage('in', {
        type: 'CONTRACT_MESSAGE',
        data: JSON.stringify({ type: 'DeviceDataShare', packs: [] })
      }, { peer: '10.0.0.8:7777' });
      net.recordMessage('in', { type: 'P2P_PING', data: '' }, { peer: '10.0.0.8:7777' });
    } finally {
      console.log = orig;
    }
    assert.ok(lines.some((l) => /fabric sync in CONTRACT_MESSAGE\/DeviceDataShare/.test(l)));
    assert.ok(!lines.some((l) => /P2P_PING/.test(l)));
  });
});
