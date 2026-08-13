'use strict';

/**
 * GoonCitizen genesis + Group Federation CONTRACT_PUBLISH / re-publish stability.
 * Ensures Actor ids stay fixed across clone/re-publish (playnet mesh join).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Actor = require('@fabric/core/types/actor');
const Key = require('@fabric/core/types/key');
const {
  gooncitizenContractDefinition,
  gooncitizenContractId
} = require('../../contracts/gooncitizen');
const {
  groupContractDefinition,
  groupContractId
} = require('../../contracts/gooncitizenGroup');

describe('playnet GoonCitizen contract publish + re-publish', () => {
  it('network genesis id is stable across definition clones (re-publish)', () => {
    const a = gooncitizenContractId();
    const b = new Actor(gooncitizenContractDefinition()).id;
    const c = new Actor(JSON.parse(JSON.stringify(gooncitizenContractDefinition()))).id;
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.equal(a, b);
    assert.equal(a, c);
  });

  it('group genesis id is stable for identical validators (re-publish same body)', () => {
    const creator = String(new Key().pubkey).toLowerCase();
    const opts = {
      groupId: 'playnet-group-1',
      creator,
      validators: [creator],
      threshold: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      meta: { name: 'Playnet Wing', visibility: 'public' }
    };
    const def1 = groupContractDefinition(opts);
    const def2 = groupContractDefinition(opts);
    const id1 = groupContractId(def1);
    const id2 = groupContractId(def2);
    assert.equal(id1, id2);
    assert.equal(id1, new Actor(JSON.parse(JSON.stringify(def1))).id);
    assert.equal(def1.parentContract, gooncitizenContractId());
    assert.ok(Array.isArray(def1.messageTypes));
    assert.ok(def1.messageTypes.includes('GroupChangeProposal'));
  });

  it('changing validators forbids accidental re-publish as same contract id', () => {
    const a = String(new Key().pubkey).toLowerCase();
    const b = String(new Key().pubkey).toLowerCase();
    const base = {
      groupId: 'playnet-group-2',
      creator: a,
      createdAt: '2026-01-01T00:00:00.000Z',
      meta: { name: 'Wing' }
    };
    const id1 = groupContractId(groupContractDefinition({
      ...base,
      validators: [a],
      threshold: 1
    }));
    const id2 = groupContractId(groupContractDefinition({
      ...base,
      validators: [a, b],
      threshold: 2
    }));
    assert.notEqual(id1, id2, 'membership changes must mint a new genesis id if re-published');
  });
});
