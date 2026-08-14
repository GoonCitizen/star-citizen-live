'use strict';

/**
 * Local UI/register helpers for “who is this mission to me?”.
 * Does not replace MissionManager officer / Schnorr checks.
 */

function authorityKeys (mission) {
  const keys = mission && mission.authorities && mission.authorities.keys;
  return Array.isArray(keys) ? keys.map(String) : [];
}

function isMissionApprover (mission, pubkey) {
  const id = String(pubkey || '');
  if (!mission || !id) return false;
  const keys = authorityKeys(mission);
  if (keys.includes(id)) return true;
  if (!keys.length && mission.createdBy && String(mission.createdBy) === id) return true;
  return false;
}

function isOnMission (mission, pubkey) {
  const id = String(pubkey || '');
  if (!mission || !id) return false;
  if (mission.createdBy && String(mission.createdBy) === id) return true;
  if (mission.assigneeId && String(mission.assigneeId) === id) return true;
  const parts = Array.isArray(mission.participantIds) ? mission.participantIds : [];
  return parts.map(String).includes(id);
}

/**
 * @param {object} [extras]
 * @param {boolean} [extras.hasPendingClaim]
 * @param {boolean} [extras.hasPendingApplication]
 */
function isMyMission (mission, pubkey, extras = {}) {
  if (isOnMission(mission, pubkey)) return true;
  if (extras.hasPendingApplication) return true;
  if (extras.hasPendingClaim && isMissionApprover(mission, pubkey)) return true;
  return false;
}

module.exports = {
  authorityKeys,
  isMissionApprover,
  isOnMission,
  isMyMission
};
