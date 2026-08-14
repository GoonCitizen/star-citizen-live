'use strict';

/**
 * Fabric peer-host helpers (seeds, self-dial, known app types) — `@fabric/http`.
 * Local fallback lets LiveRelay construct when `@fabric/http` is not in the APK.
 */

try {
  module.exports = require('@fabric/http/functions/fabricPeerHost');
} catch (_) {
  module.exports = require('./fabricPeerHostLocal');
}
