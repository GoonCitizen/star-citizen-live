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
    assert.equal(a.applications['gapp-1'].status, 'accepted');
    assert.equal(
      groupStatechain.stateDigestOfContent(a),
      groupStatechain.stateDigestOfContent(b)
    );
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
});
