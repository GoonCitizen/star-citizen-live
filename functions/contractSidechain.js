'use strict';

/**
 * Contract-namespace Statechain helpers for GoonCitizen (D-016 / Hub ADR-001).
 * Re-exports `@fabric/core/functions/contractSidechainLocal` (no local twin).
 */

const core = require('@fabric/core/functions/contractSidechainLocal');

module.exports = Object.assign({}, core, {
  storePathsForContract: core.storePathsForContract || core.storePathsForLocalContract,
  fromCore: true
});
