'use strict';

/**
 * GoonCitizen application-namespace types.
 * Merges `@fabric/core` generic ARC types with product-local body types
 * (missions, gameplay batches, share envelopes, activity trees).
 *
 * @see @fabric/core docs/APPLICATION_NAMESPACES.md
 */

const core = require('@fabric/core/functions/applicationNamespaces');

/** Product-only CONTRACT_MESSAGE body types (not in @fabric/core). */
const APP_CONTRACT_BODY_TYPES = Object.freeze({
  MissionCreated: 'MissionCreated',
  MissionBroadcast: 'MissionBroadcast',
  SCEventBatch: 'SCEventBatch',
  GameStateSnapshot: 'GameStateSnapshot',
  GroupShare: 'GroupShare',
  GroupActivityTree: 'GroupActivityTree',
  FleetShare: 'FleetShare',
  /** Legacy 1:1 mesh chat (migrate toward pair ARC + GroupChat). */
  DirectChat: 'DirectChat',
  /** Fallback if linked @fabric/core predates these names. */
  GroupChangeProposal: 'GroupChangeProposal',
  GroupChangeVote: 'GroupChangeVote',
  /**
   * Discord bot coordination (same Discord application, multiple operators).
   * Request → Claim (first-wins) → Response. Not frozen into gooncitizen genesis
   * messageTypes (would move the network contract id).
   */
  DiscordRequest: 'DiscordRequest',
  DiscordClaim: 'DiscordClaim',
  DiscordResponse: 'DiscordResponse'
});

const CONTRACT_BODY_TYPES = Object.freeze(Object.assign(
  {},
  core.CONTRACT_BODY_TYPES,
  APP_CONTRACT_BODY_TYPES
));

const ACTIVITY_TYPES = Object.freeze(Object.assign({}, core.ACTIVITY_TYPES, {
  GameStateSnapshot: 'GameStateSnapshot'
}));

function isKnownContractBodyType (type) {
  return Object.prototype.hasOwnProperty.call(CONTRACT_BODY_TYPES, String(type || ''));
}

module.exports = {
  OUTER: core.OUTER,
  CONTRACT_BODY_TYPES,
  APP_CONTRACT_BODY_TYPES,
  ACTIVITY_TYPES,
  LOG_TYPES: core.LOG_TYPES,
  isApplicationOuterType: core.isApplicationOuterType.bind(core),
  isKnownContractBodyType,
  fromCore: true
};
