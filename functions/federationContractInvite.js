'use strict';

/**
 * Thin re-export — invite JSON parse/build lives in `@fabric/http`.
 * Hub and GoonCitizen share one FederationContractInvite shape (incl. group labels).
 *
 * @see @fabric/http/functions/federationContractInvite
 */

module.exports = require('@fabric/http/functions/federationContractInvite');
