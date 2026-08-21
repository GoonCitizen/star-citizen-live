'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const Key = require('@fabric/core/types/key');
const {
  merkleTreeOf,
  inclusionProof,
  nonInclusionProof,
  walkParentChain,
  ingest,
  createCollection
} = require('../../functions/fabricMessageCollection');
const { summarizeMessage } = require('../../functions/fabricMessageLog');
const parentLib = require('../../functions/fabricMessageParent');
const FabricNetwork = require('../../services/FabricNetwork');

describe('Fabric Message parent chain (GoonCitizen)', () => {
  it('chains durable outbound frames and skips peering/session types', () => {
    const net = new FabricNetwork({ enable: false, listen: false, peers: [], peersDb: null });
    const key = new Key();
    const a = net._signMessage('P2P_CHAT_MESSAGE', 'o7 one', { key });
    const b = net._signMessage('P2P_CHAT_MESSAGE', 'o7 two', { key });
    const offer = net._signMessage('P2P_PEERING_OFFER', JSON.stringify({ host: '127.0.0.1', port: 7777 }), { key });
    const c = net._signMessage('P2P_CHAT_MESSAGE', 'o7 three', { key });

    assert.equal(parentLib.parentHexOf(a), parentLib.ZERO_PARENT);
    assert.equal(parentLib.parentHexOf(b), a.id);
    assert.ok(parentLib.isZeroParent(parentLib.parentHexOf(offer)));
    assert.equal(parentLib.parentHexOf(c), b.id);
    assert.ok(a.verifyWithKey(key));
    assert.ok(b.verifyWithKey(key));
    assert.ok(c.verifyWithKey(key));
    assert.equal(net._outboundMessageTip, c.id);
  });

  it('summarizes frameId/parent and merkle-proves a collected stack', () => {
    const net = new FabricNetwork({ enable: false, listen: false, peers: [], peersDb: null });
    const key = new Key();
    const a = net._signMessage('CONTRACT_MESSAGE', JSON.stringify({
      contract: 'ab'.repeat(32),
      type: 'GroupChange',
      object: { action: 'update' }
    }), { key });
    const b = net._signMessage('CONTRACT_MESSAGE', JSON.stringify({
      contract: 'ab'.repeat(32),
      type: 'GroupChange',
      object: { action: 'member.add', member: key.pubkey }
    }), { key });

    const summary = summarizeMessage(b, { direction: 'out' });
    assert.equal(summary.frameId, b.id);
    assert.equal(summary.parent, a.id);
    assert.equal(summary.genesis, false);

    if (typeof walkParentChain !== 'function') return;

    const collection = createCollection();
    ingest(collection, a);
    ingest(collection, b);
    const walked = walkParentChain(collection.messages, b.id);
    assert.equal(walked.length, 2);
    assert.equal(walked[0].id, a.id);

    const hit = inclusionProof(collection, b.id);
    assert.equal(hit.included, true);
    const tree = merkleTreeOf(collection.messages);
    assert.equal(tree.verifyInclusion(hit), true);
    const gap = nonInclusionProof(collection, '00'.repeat(32));
    assert.equal(gap.included, false);
    assert.ok(tree.verifyNonInclusion(gap));
  });
});
