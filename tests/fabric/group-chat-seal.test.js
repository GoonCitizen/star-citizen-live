'use strict';

/**
 * Fabric expectations: GroupChat seal (v1 tip-HKDF + v2 participant ECDH).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  SEAL_SCHEME,
  SEAL_SCHEME_PARTICIPANT,
  sealGroupChatBody,
  openGroupChatBody,
  isSealedGroupChat,
  isParticipantSealedGroupChat
} = require('../../functions/groupChatSeal');
const GroupManager = require('../../services/GroupManager');
const { createIdentity, keyFromIdentity } = require('../../functions/identity');

describe('Fabric expectations: GroupChat tip seal (v1)', () => {
  it('GroupManager tip seals and opens GroupChat body', async () => {
    const a = createIdentity();
    const b = createIdentity();
    const gm = new GroupManager({});
    const g = await gm.createGroup({ name: 'SealWing', members: [b.pubkey], threshold: 1 }, a.pubkey);
    const tip = gm.getChatSealTip(g.id);
    assert.ok(tip.contractId);
    assert.ok(tip.clock >= 1);
    assert.match(tip.stateDigest, /^[0-9a-f]{64}$/);
    assert.ok(tip.memberPubkeys.length >= 2);

    const seal = sealGroupChatBody({
      body: 'ops in pyrotechnic',
      contractId: tip.contractId,
      clock: tip.clock,
      stateDigest: tip.stateDigest,
      memberPubkeys: tip.memberPubkeys
    });
    assert.equal(seal.scheme, SEAL_SCHEME);
    assert.equal(isSealedGroupChat({ seal }), true);
    assert.equal(openGroupChatBody(seal, tip), 'ops in pyrotechnic');

    const tip2 = gm.getChatSealTip(g.id);
    assert.equal(tip2.clock, tip.clock);
    assert.equal(tip2.stateDigest, tip.stateDigest);
  });

  it('seal omits recoverable plaintext without matching tip roster', async () => {
    const a = createIdentity();
    const outsider = createIdentity();
    const gm = new GroupManager({});
    const g = await gm.createGroup({ name: 'Private', members: [], threshold: 1 }, a.pubkey);
    const tip = gm.getChatSealTip(g.id);
    const seal = sealGroupChatBody({ body: 'secret', ...tip });
    assert.throws(() => openGroupChatBody(seal, {
      ...tip,
      memberPubkeys: [outsider.pubkey]
    }));
  });
});

describe('Fabric expectations: GroupChat participant seal (v2 hub-blind)', () => {
  it('members open with private keys; tip alone is insufficient', async () => {
    const a = createIdentity();
    const b = createIdentity();
    const outsider = createIdentity();
    const gm = new GroupManager({});
    const g = await gm.createGroup({ name: 'BlindWing', members: [b.pubkey], threshold: 1 }, a.pubkey);
    const tip = gm.getChatSealTip(g.id);

    const seal = sealGroupChatBody({
      mode: 'participant',
      body: 'hub cannot read this',
      contractId: tip.contractId,
      clock: tip.clock,
      stateDigest: tip.stateDigest,
      memberPubkeys: tip.memberPubkeys
    });
    assert.equal(seal.scheme, SEAL_SCHEME_PARTICIPANT);
    assert.equal(isParticipantSealedGroupChat(seal), true);
    assert.equal(isSealedGroupChat({ seal }), true);

    assert.equal(
      openGroupChatBody(seal, { keyOrPrivate: keyFromIdentity(a), pubkey: a.pubkey }),
      'hub cannot read this'
    );
    assert.equal(
      openGroupChatBody(seal, { keyOrPrivate: keyFromIdentity(b), pubkey: b.pubkey }),
      'hub cannot read this'
    );
    assert.throws(
      () => openGroupChatBody(seal, { keyOrPrivate: keyFromIdentity(outsider), pubkey: outsider.pubkey }),
      /no wrap/
    );
    // Tip-only open path must not unlock v2.
    assert.throws(() => openGroupChatBody(seal, tip));
  });
});
