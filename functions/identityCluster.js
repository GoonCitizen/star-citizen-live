'use strict';

/**
 * Re-export Hub union-find (`@fabric/hub` ≥ `2658e18`). LiveRelay and tests
 * keep this local path. Canonical gossip strings stay in `identityCrossSign.js`
 * (browser-safe; do not pull Hub Node into the dashboard bundle).
 *
 * When `@fabric/hub` is missing (Android APK before fabric deps are staged),
 * a same-pubkey stub keeps LiveRelay HTTP up. Device-link clusters need Hub.
 */

try {
  module.exports = require('@fabric/hub/functions/identityCluster');
} catch (_) {
  class IdentityCluster {
    constructor () {
      this._pending = new Map();
      this._edges = new Map();
      this._revoked = new Set();
    }

    ingestCrossSign () { return this; }

    clusterEquals (a, b) {
      const ka = String(a || '').trim().toLowerCase();
      const kb = String(b || '').trim().toLowerCase();
      return !!(ka && kb && ka === kb);
    }

    clusterFor (pubkey) {
      const k = String(pubkey || '').trim();
      return {
        canonical: k || null,
        members: k ? [k] : [],
        edges: []
      };
    }

    snapshot (pubkey) {
      return this.clusterFor(pubkey);
    }

    toJSON () {
      return { pending: [], edges: [], revoked: [] };
    }

    static fromJSON () {
      return new IdentityCluster();
    }
  }

  module.exports = IdentityCluster;
}
