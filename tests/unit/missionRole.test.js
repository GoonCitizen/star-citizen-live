'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isMissionApprover,
  isOnMission,
  isMyMission
} = require('../../functions/missionRole');

describe('missionRole', () => {
  const creator = '02aa'.padEnd(66, 'a');
  const pilot = '03bb'.padEnd(66, 'b');
  const mission = {
    id: 'm1',
    createdBy: creator,
    participantIds: [pilot],
    authorities: { keys: [creator], threshold: 1 },
    status: 'assigned'
  };

  it('treats creator as approver when they are the 1-of-1 authority', () => {
    assert.equal(isMissionApprover(mission, creator), true);
    assert.equal(isMissionApprover(mission, pilot), false);
  });

  it('treats creator as on-mission even before they apply', () => {
    assert.equal(isOnMission(mission, creator), true);
    assert.equal(isOnMission(mission, pilot), true);
    assert.equal(isOnMission(mission, 'zz'), false);
  });

  it('counts pending review claims as my missions for a group authority', () => {
    const authority = '02cc'.padEnd(66, 'c');
    const other = { id: 'm2', createdBy: 'xx', participantIds: [], status: 'open' };
    const groupMission = {
      id: 'm3',
      createdBy: creator,
      participantIds: [pilot],
      authorities: { keys: [creator, authority], threshold: 1 },
      status: 'assigned'
    };
    assert.equal(isMyMission(other, creator), false);
    assert.equal(isMyMission(groupMission, authority), false);
    assert.equal(isMyMission(groupMission, authority, { hasPendingClaim: true }), true);
    assert.equal(isMyMission(other, creator, { hasPendingApplication: true }), true);
  });
});
