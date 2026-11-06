'use strict';

/**
 * Contract-namespace Statechain helpers for GoonCitizen (D-016 / Hub ADR-001).
 * Local persistence from `@fabric/core/functions/contractSidechainLocal`, namespace
 * heads from `@fabric/core/functions/sidechainState` (no local twin).
 */

const core = require('@fabric/core/functions/contractSidechainLocal');
const Statechain = require('@fabric/core/functions/sidechainState');

module.exports = Object.assign({}, core, {
  storePathsForContract: core.storePathsForLocalContract,
  normalizeContractId: Statechain.normalizeContractId,
  stateDigest: Statechain.stateDigest,
  namespaceHeadFromState: Statechain.namespaceHeadFromState,
  patchesForNamespaceHead: Statechain.patchesForNamespaceHead,
  fromCore: true
});
