'use strict';

/**
 * Per-reader MessageReceived / MessageReceipt 2PC — canonical in `@fabric/core`.
 * Sidecar to {@link ./contractMessageAccumulate}; does not alter tip digest.
 */
module.exports = require('@fabric/core/functions/contractMessageCommit');
