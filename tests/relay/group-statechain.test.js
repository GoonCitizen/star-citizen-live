'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  groupContractDefinition,
  groupContractId
} = require('../../contracts/gooncitizenGroup');
const groupStatechain = require('../../functions/groupStatechain');
const { Store } = require('../../types/Store');

describe('groupStatechain', () => {
  const creator = '02' + 'ab'.repeat(31);
  const applicant = '03' + 'cd'.repeat(31);
  const definition = groupContractDefinition({
    groupId: 'group-fold-1',
    creator,
    validators: [creator],
    threshold: 1,
    createdAt: '2026-07-24T00:00:00.000Z',
    meta: { name: 'Fold Wing', visibility: 'public' }
  });
  const contractId = groupContractId(definition);

  it('fold is stable for the same genesis + accepted entries', () => {
    const entries = [
      {
        id: 'gapp-1',
        type: 'GroupApplication',
        clock: 1,
        acceptedAt: '2026-07-24T01:00:00.000Z',
        message: {
          id: 'gapp-1',
          groupId: 'group-fold-1',
          applicantId: applicant,
          status: 'pending',
          createdAt: '2026-07-24T01:00:00.000Z'
        }
      },
      {
        id: 'gapp-1:decision',
        type: 'GroupApplicationDecision',
        clock: 2,
        acceptedAt: '2026-07-24T02:00:00.000Z',
        message: {
          applicationId: 'gapp-1',
          applicantId: applicant,
          decision: 'accept',
          status: 'accepted',
          decidedBy: creator
        }
      },
      {
        id: 'gchg-1',
        type: 'GroupChange',
        clock: 3,
        acceptedAt: '2026-07-24T02:00:01.000Z',
        message: {
          id: 'gchg-1',
          action: 'member.add',
          groupId: 'group-fold-1',
          member: applicant,
          actor: creator
        }
      }
    ];
    const a = groupStatechain.foldGroupState(definition, entries);
    const b = groupStatechain.foldGroupState(definition, entries.slice().reverse());
    assert.deepEqual(a.members, b.members);
    assert.ok(a.members.includes(creator));
    assert.ok(a.members.includes(applicant));
    assert.ok(a.signers.includes(creator));
    assert.ok(a.signers.includes(applicant));
    assert.deepEqual(a.proposedPolicy.validators, a.signers);
    assert.equal(a.applications['gapp-1'].status, 'accepted');
    assert.equal(
      groupStatechain.stateDigestOfContent(a),
      groupStatechain.stateDigestOfContent(b)
    );
  });

  it('application accept widens members but not signers until GroupChange', () => {
    const entries = [
      {
        id: 'gapp-1',
        type: 'GroupApplication',
        clock: 1,
        acceptedAt: '2026-07-24T01:00:00.000Z',
        message: {
          id: 'gapp-1',
          groupId: 'group-fold-1',
          applicantId: applicant,
          status: 'pending'
        }
      },
      {
        id: 'gapp-1:decision',
        type: 'GroupApplicationDecision',
        clock: 2,
        acceptedAt: '2026-07-24T02:00:00.000Z',
        message: {
          applicationId: 'gapp-1',
          applicantId: applicant,
          decision: 'accept',
          status: 'accepted',
          decidedBy: creator
        }
      }
    ];
    const folded = groupStatechain.foldGroupState(definition, entries);
    assert.ok(folded.members.includes(applicant));
    assert.ok(!folded.signers.includes(applicant));
    assert.deepEqual(folded.proposedPolicy.validators, folded.signers);
    assert.ok(folded.signers.includes(creator));
  });

  it('reader-role GroupChange does not widen signers', () => {
    const reader = '02' + 'ef'.repeat(31);
    const folded = groupStatechain.foldGroupState(definition, [{
      id: 'gchg-reader',
      type: 'GroupChange',
      clock: 1,
      acceptedAt: '2026-07-24T03:00:00.000Z',
      message: {
        action: 'member.add',
        member: reader,
        role: 'reader',
        actor: creator
      }
    }]);
    assert.ok(folded.members.includes(reader));
    assert.ok(!folded.signers.includes(reader));
  });

  it('appendAccepted is idempotent by id and updates STATE via Store', () => {
    const store = new Store({ path: null });
    groupStatechain.publishFoldedContent(store, contractId, definition);
    const first = groupStatechain.appendAccepted(store, contractId, {
      id: 'gchg-x',
      type: 'GroupChange',
      message: {
        id: 'gchg-x',
        action: 'member.add',
        member: applicant,
        actor: creator
      }
    }, definition);
    assert.equal(first.appended, true);
    assert.ok(first.content.members.includes(applicant));

    const second = groupStatechain.appendAccepted(store, contractId, {
      id: 'gchg-x',
      type: 'GroupChange',
      message: {
        id: 'gchg-x',
        action: 'member.add',
        member: applicant,
        actor: creator
      }
    }, definition);
    assert.equal(second.appended, false);
    assert.equal(groupStatechain.loadJournal(store, contractId).entries.length, 1);
    assert.ok(store.get(groupStatechain.COLLECTION, contractId));
  });

  it('folds FleetShare tips into content.fleets', () => {
    const fleetId = 'fleet-share-1';
    const entries = [
      {
        id: `fleet-share:${fleetId}:1`,
        type: 'FleetShare',
        clock: 1,
        acceptedAt: '2026-08-11T12:00:00.000Z',
        message: {
          kind: 'FleetShare',
          fleetId,
          name: 'Wing Alpha',
          ownerPubkey: creator,
          shipCount: 3,
          uniqueShips: 2,
          ships: [{ name: 'Cutlass Black', count: 2 }, { name: 'Gladius', count: 1 }],
          sharedAt: '2026-08-11T12:00:00.000Z'
        }
      },
      {
        id: `fleet-share:${fleetId}:2`,
        type: 'FleetShare',
        clock: 2,
        acceptedAt: '2026-08-11T13:00:00.000Z',
        message: {
          kind: 'FleetShare',
          fleetId,
          name: 'Wing Alpha II',
          ownerPubkey: creator,
          shipCount: 4,
          uniqueShips: 2,
          ships: [{ name: 'Cutlass Black', count: 3 }, { name: 'Gladius', count: 1 }],
          sharedAt: '2026-08-11T13:00:00.000Z'
        }
      }
    ];
    const folded = groupStatechain.foldGroupState(definition, entries);
    assert.ok(folded.fleets[fleetId]);
    assert.equal(folded.fleets[fleetId].name, 'Wing Alpha II');
    assert.equal(folded.fleets[fleetId].shipCount, 4);
  });
});
