'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { groupContractDefinition, groupContractId } = require('../../contracts/gooncitizenGroup');
const groupStatechain = require('../../functions/groupStatechain');
const { createGroupCosigner, verifyGroupCosigner, cosignerScope } = require('../../functions/groupCosigner');
const { fixtureKey, fixtureCosignerKey } = require('./fixtures/identities');

const alice = fixtureKey('alice');
const bob = fixtureKey('bob');

describe('group wallet cosigners', () => {
  const definition = groupContractDefinition({
    groupId: 'group-cosigners',
    creator: alice.pubkey,
    validators: [alice.pubkey, bob.pubkey],
    threshold: 2,
    createdAt: '2026-10-01T00:00:00.000Z',
    meta: { name: 'Cosigners', visibility: 'private' }
  });
  const contractId = groupContractId(definition);
  const record = (identityKey, name, network = 'regtest') => createGroupCosigner({
    identityKey,
    cosignerKey: fixtureCosignerKey(name, network),
    group: contractId,
    network
  });
  const entry = (id, clock, message) => ({
    id,
    type: 'GroupChange',
    clock,
    acceptedAt: `2026-10-01T00:00:0${clock}.000Z`,
    message: Object.assign({ id, action: 'cosigner.set' }, message)
  });

  it('proof and endorsement are bound to the group, the identity, and the key', () => {
    const r = record(alice, 'alice');
    assert.equal(cosignerScope(contractId), `group:${contractId}`);
    assert.equal(verifyGroupCosigner(r, contractId), true);
    assert.equal(verifyGroupCosigner(r, 'another-group'), false, 'not replayable into another group');
    assert.equal(verifyGroupCosigner(Object.assign({}, r, { member: bob.pubkey }), contractId), false);
    assert.equal(verifyGroupCosigner(Object.assign({}, r, { cosigner: fixtureCosignerKey('bob').pubkey }), contractId), false);
    assert.equal(verifyGroupCosigner(Object.assign({}, r, { endorsement: r.proof }), contractId), false);
    assert.equal(verifyGroupCosigner(Object.assign({}, r, { network: 'dogecoin' }), contractId), false);
    assert.notEqual(r.cosigner, alice.pubkey, 'the wallet key is not the identity key');
  });

  it('fold keeps verified cosigners per network and drops forged ones', () => {
    const forged = Object.assign(record(bob, 'bob'), { cosigner: fixtureCosignerKey('alice').pubkey });
    const state = groupStatechain.foldGroupState(definition, [
      entry('c1', 1, record(alice, 'alice')),
      entry('c2', 2, record(alice, 'alice', 'mainnet')),
      entry('c3', 3, forged),
      entry('c4', 4, record(fixtureKey('carol'), 'carol'))
    ]);
    const x = alice.pubkey.slice(-64);
    assert.deepEqual(Object.keys(state.cosigners), [x], 'forged and non-member records are dropped');
    assert.equal(state.cosigners[x].regtest.cosigner, fixtureCosignerKey('alice').pubkey);
    assert.equal(state.cosigners[x].mainnet.cosigner, fixtureCosignerKey('alice', 'mainnet').pubkey);
  });

  it('states without cosigners keep their digest', () => {
    const state = groupStatechain.foldGroupState(definition, []);
    assert.equal(Object.prototype.hasOwnProperty.call(state, 'cosigners'), false);
  });

  it('a removed member loses their cosigner', () => {
    const state = groupStatechain.foldGroupState(definition, [
      entry('c1', 1, record(bob, 'bob')),
      { id: 'rm', type: 'GroupChange', clock: 2, acceptedAt: '2026-10-01T00:00:02.000Z', message: { id: 'rm', action: 'member.remove', member: bob.pubkey } }
    ]);
    assert.equal(state.cosigners, undefined);
  });
});
