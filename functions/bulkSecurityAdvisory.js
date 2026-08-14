'use strict';

/**
 * Re-export Hub GHSA / OpenSSF bulk-advisory detector (`@fabric/hub` ≥ `361a750`).
 * Local catalog ingest uses this so malware-advisory dumps are not stored.
 * When `@fabric/hub` is missing (Android APK before fabric deps are staged),
 * the stub never matches (fail open).
 */

try {
  module.exports = require('@fabric/hub/functions/bulkSecurityAdvisory');
} catch (_) {
  module.exports = {
    looksLikeBulkSecurityAdvisory: function looksLikeBulkSecurityAdvisory () {
      return false;
    }
  };
}
