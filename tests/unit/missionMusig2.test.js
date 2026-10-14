'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const Key = require('@fabric/core/types/key');
const musig2 = require('@fabric/core/functions/musig2');
const MissionManager = require('../../services/MissionManager');

function twoOfTwo (message) {
  const k1 = new Key();
  const k2 = new Key();
  const sk1 = Buffer.from(k1.private);
  const sk2 = Buffer.from(k2.private);
  const pk1 = musig2.individualPk(sk1);
  const pk2 = musig2.individualPk(sk2);
  const pubkeys = musig2.keySort([pk1, pk2]);
  const aggpk = musig2.aggregateXonly(pubkeys);
  const n1 = musig2.nonceGen(sk1, pk1, aggpk, message, null);
  const n2 = musig2.nonceGen(sk2, pk2, aggpk, message, null);
  const aggnonce = musig2.nonceAgg([n1.pubnonce, n2.pubnonce]);
  const ctx = musig2.sessionContext(aggnonce, pubkeys, [], [], message);
  const s1 = musig2.sign(n1.secnonce, sk1, ctx);
  const s2 = musig2.sign(n2.secnonce, sk2, ctx);
  return {
    pubkeys: pubkeys.map((b) => b.toString('hex')),
    aggregatedKey: Buffer.concat([Buffer.from([0x02]), aggpk]).toString('hex'),
    signature: musig2.partialSigAgg([s1, s2], ctx).toString('hex')
  };
}

describe('MissionManager BIP-327 MuSig2 verify', () => {
  it('accepts a real 2-of-2 aggregate and rejects a rogue aggregatedKey', async () => {
    const manager = new MissionManager({ enableMusig2: true });
    const message = crypto.createHash('sha256').update('goon-mission').digest();
    const signed = twoOfTwo(message);

    const ok = await manager.verifyMusig2Signature(message, signed.signature, {
      participantKeys: signed.pubkeys,
      aggregatedKey: signed.aggregatedKey
    });
    assert.equal(ok, true);

    const rogue = await manager.verifyMusig2Signature(message, signed.signature, {
      participantKeys: signed.pubkeys,
      aggregatedKey: '02' + '11'.repeat(32)
    });
    assert.equal(rogue, false);
  });
});
