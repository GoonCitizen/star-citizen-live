'use strict';

/**
 * GoonCitizen contract definition — the shared namespace for all GoonCitizen
 * app traffic on the Fabric mesh.
 *
 * The GoonCitizen application is effectively a distributed contract: many orgs
 * install it and share missions / events / chat across a common mesh. We
 * publish a canonical genesis definition via `CONTRACT_PUBLISH`; its
 * deterministic `@fabric/core` Actor id becomes the **contract id** that
 * namespaces every `CONTRACT_MESSAGE` (MissionBroadcast / SCEventBatch) and
 * `ContractProposal` (escrow / payout) frame.
 *
 * The id MUST be computed the same way the core Peer registers it
 * (`new Actor(definition).id`), so senders and the peer agree on the namespace.
 */

const Actor = require('@fabric/core/types/actor');

/** Bump when the wire-visible contract shape changes (new id on purpose). */
const GOONCITIZEN_CONTRACT_VERSION = 1;

/**
 * Canonical, deterministic genesis object. Keep this stable — any change moves
 * the contract id (and therefore the namespace) for the whole network.
 */
const GOONCITIZEN_CONTRACT_DEFINITION = Object.freeze({
  name: 'GoonCitizen',
  version: GOONCITIZEN_CONTRACT_VERSION,
  // Message `type` values carried inside CONTRACT_MESSAGE for this namespace.
  messageTypes: Object.freeze(['MissionBroadcast', 'SCEventBatch']),
  // ContractProposal purposes (escrow / payout acceptance) carried for this contract.
  proposalTypes: Object.freeze(['MissionEscrow', 'MissionPayout']),
  // Empty initial contract state (peer stores this under the contract id).
  state: {}
});

let _cachedId = null;

/**
 * Deterministic GoonCitizen contract id (hex64). Matches core
 * `Peer._registerContract` (`new Actor(object).id`).
 * @returns {string}
 */
function gooncitizenContractId () {
  if (_cachedId) return _cachedId;
  _cachedId = new Actor(gooncitizenContractDefinition()).id;
  return _cachedId;
}

/**
 * A fresh (deeply-cloned) copy of the genesis definition suitable for
 * `CONTRACT_PUBLISH` (the frozen constant is not mutated on the wire path).
 * @returns {Object}
 */
function gooncitizenContractDefinition () {
  return {
    name: GOONCITIZEN_CONTRACT_DEFINITION.name,
    version: GOONCITIZEN_CONTRACT_DEFINITION.version,
    messageTypes: GOONCITIZEN_CONTRACT_DEFINITION.messageTypes.slice(),
    proposalTypes: GOONCITIZEN_CONTRACT_DEFINITION.proposalTypes.slice(),
    state: {}
  };
}

module.exports = {
  GOONCITIZEN_CONTRACT_VERSION,
  GOONCITIZEN_CONTRACT_DEFINITION,
  gooncitizenContractDefinition,
  gooncitizenContractId
};
