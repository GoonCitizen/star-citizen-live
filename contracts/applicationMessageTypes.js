'use strict';

/**
 * Shared Fabric application-namespace type names for GoonCitizen.
 * Re-exports `@fabric/core/functions/applicationNamespaces` (no local mirror).
 *
 * @see @fabric/core docs/APPLICATION_NAMESPACES.md
 */

const core = require('@fabric/core/functions/applicationNamespaces');

module.exports = {
  OUTER: core.OUTER,
  CONTRACT_BODY_TYPES: core.CONTRACT_BODY_TYPES,
  ACTIVITY_TYPES: core.ACTIVITY_TYPES,
  LOG_TYPES: core.LOG_TYPES,
  isApplicationOuterType: core.isApplicationOuterType.bind(core),
  isKnownContractBodyType: core.isKnownContractBodyType.bind(core),
  fromCore: true
};
