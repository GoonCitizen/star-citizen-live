'use strict';

/**
 * Who is the same person: a union-find over mutual, unrevoked `identity`
 * grants (`DELEGATION_GRANT`, `@fabric/core` docs/DELEGATION.md). Two keys
 * are one actor once each has granted the other `identity`; a revocation by
 * either grantor splits them again.
 *
 * Frames come from this app's own `Delegation` and from peers
 * (`DelegationShare` on the GoonCitizen contract). Every frame is checked
 * here, so it does not matter who relayed it.
 *
 * When `@fabric/core` has no delegation module (an Android tree before the
 * Fabric deps are staged) every key is only itself.
 */

let delegation = null;
try {
  delegation = require('@fabric/core/types/delegation');
} catch (_) {
  delegation = null;
}

const MAX_GRANTS = 4096;

/**
 * x-only lowercase hex of a compressed or x-only pubkey, else null.
 * @param {*} pubkey
 * @returns {string|null}
 */
function keyOf (pubkey) {
  const hex = String(pubkey || '').trim().toLowerCase();
  if (/^0[23][0-9a-f]{64}$/.test(hex)) return hex.slice(2);
  if (/^[0-9a-f]{64}$/.test(hex)) return hex;
  return null;
}

/** @private */
function edgeKey (a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

class IdentityCluster {
  /**
   * @param {Object} [options]
   * @param {Function} [options.now]
   */
  constructor (options = {}) {
    this._now = typeof options.now === 'function' ? options.now : () => Date.now();
    /** @type {Map<string, { grantor: string, grantee: string, hex: string, issuedAt: number }>} grant hash → identity grant */
    this._grants = new Map();
    /** @type {Map<string, Map<string, string>>} grant hash → (revoker x-only → revoke frame hex) */
    this._revokes = new Map();
    /** @type {Map<string, string>} x-only → compressed pubkey, as grants named it */
    this._compressed = new Map();
  }

  /** @private */
  _remember (pubkey) {
    const hex = String(pubkey || '').toLowerCase();
    if (/^0[23][0-9a-f]{64}$/.test(hex)) this._compressed.set(hex.slice(2), hex);
  }

  /**
   * Take in a `DELEGATION_GRANT` or `DELEGATION_REVOKE` frame.
   * Grants without the `identity` scope are refused (they say nothing about who is who).
   * @param {string|Buffer} frame `fabric:` string, hex, or bytes.
   * @returns {{ ok: boolean, type: (string|undefined), hash: (string|undefined), hex: (string|undefined), fresh: (boolean|undefined), linked: (boolean|undefined), pending: (boolean|undefined), error: (string|undefined) }}
   */
  ingest (frame) {
    if (!delegation) return { ok: false, error: 'delegation is not available in this build' };
    const input = typeof frame === 'string' && /^[0-9a-f]+$/i.test(frame) ? Buffer.from(frame, 'hex') : frame;
    const type = delegation.delegationType(input);
    if (type === 'DELEGATION_GRANT') {
      const read = delegation.readGrant(input, { now: this._now() });
      if (!read.ok) return read;
      if (!read.grant.scopes.includes('identity')) return { ok: false, error: 'not an identity grant' };
      const fresh = !this._grants.has(read.hash);
      if (fresh && this._grants.size >= MAX_GRANTS) return { ok: false, error: 'too many identity grants' };
      if (fresh) {
        this._grants.set(read.hash, {
          grantor: read.grant.grantor.slice(2),
          grantee: read.grant.grantee.slice(2),
          hex: read.buffer.toString('hex'),
          issuedAt: read.grant.issuedAt
        });
      }
      this._remember(read.grant.grantor);
      this._remember(read.grant.grantee);
      const linked = this._linked(read.grant.grantor.slice(2), read.grant.grantee.slice(2));
      return { ok: true, type, hash: read.hash, hex: read.buffer.toString('hex'), fresh, linked, pending: !linked };
    }
    if (type === 'DELEGATION_REVOKE') {
      const read = delegation.readRevoke(input, { now: this._now() });
      if (!read.ok) return read;
      const grant = read.revoke.grant;
      let by = this._revokes.get(grant);
      if (!by) {
        if (this._revokes.size >= MAX_GRANTS) return { ok: false, error: 'too many revocations' };
        by = new Map();
        this._revokes.set(grant, by);
      }
      const fresh = !by.has(read.author);
      if (fresh) by.set(read.author, read.buffer.toString('hex'));
      return { ok: true, type, hash: read.hash, hex: read.buffer.toString('hex'), grant, fresh };
    }
    return { ok: false, error: type ? `${type} says nothing about identity` : 'not a delegation frame' };
  }

  /** @private A grant counts unless its grantor revoked it. */
  _live (hash, g) {
    const by = this._revokes.get(hash);
    return !(by && by.has(g.grantor));
  }

  /** @private */
  _linked (a, b) {
    let ab = false;
    let ba = false;
    for (const [hash, g] of this._grants) {
      if (!this._live(hash, g)) continue;
      if (g.grantor === a && g.grantee === b) ab = true;
      if (g.grantor === b && g.grantee === a) ba = true;
    }
    return ab && ba;
  }

  /**
   * Mutual pairs: `edgeKey → { a, b, grants }`.
   * @private
   */
  _edges () {
    const oneWay = new Map();
    for (const [hash, g] of this._grants) {
      if (!this._live(hash, g)) continue;
      oneWay.set(`${g.grantor}>${g.grantee}`, hash);
    }
    const edges = new Map();
    for (const [dir, hash] of oneWay) {
      const [from, to] = dir.split('>');
      const back = oneWay.get(`${to}>${from}`);
      if (!back) continue;
      const ek = edgeKey(from, to);
      if (!edges.has(ek)) {
        const [a, b] = from < to ? [from, to] : [to, from];
        edges.set(ek, { a, b, grants: [hash, back].sort() });
      }
    }
    return edges;
  }

  /**
   * Identity grants one way only (waiting for the other side's grant).
   * @returns {Array<{ local: string, peer: string, grant: string }>}
   */
  pending () {
    const out = [];
    for (const [hash, g] of this._grants) {
      if (!this._live(hash, g)) continue;
      if (!this._linked(g.grantor, g.grantee)) out.push({ local: g.grantor, peer: g.grantee, grant: hash });
    }
    return out;
  }

  /**
   * @param {*} pubkey
   * @returns {Set<string>} x-only pubkeys in the cluster (includes self)
   */
  clusterOf (pubkey) {
    const start = keyOf(pubkey);
    const seen = new Set();
    if (!start) return seen;
    seen.add(start);
    const edges = Array.from(this._edges().values());
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop();
      for (const edge of edges) {
        const other = edge.a === cur ? edge.b : (edge.b === cur ? edge.a : null);
        if (other && !seen.has(other)) {
          seen.add(other);
          stack.push(other);
        }
      }
    }
    return seen;
  }

  /**
   * @param {*} a
   * @param {*} b
   * @returns {boolean}
   */
  clusterEquals (a, b) {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    return this.clusterOf(ka).has(kb);
  }

  /**
   * Compressed pubkey a grant named for this key, or null.
   * @param {*} pubkey
   * @returns {string|null}
   */
  compressedOf (pubkey) {
    const k = keyOf(pubkey);
    return (k && this._compressed.get(k)) || null;
  }

  /**
   * Deterministic display id: lexicographically smallest x-only pubkey.
   * @param {*} pubkey
   * @returns {string|null}
   */
  canonicalOf (pubkey) {
    const members = Array.from(this.clusterOf(pubkey)).sort();
    return members[0] || keyOf(pubkey);
  }

  /**
   * @param {*} pubkey
   * @returns {{ canonical: (string|null), members: string[], edges: Array<{ a: string, b: string, grants: string[] }> }}
   */
  snapshot (pubkey) {
    const members = Array.from(this.clusterOf(pubkey)).sort();
    const edges = Array.from(this._edges().values())
      .filter((e) => members.includes(e.a) || members.includes(e.b));
    return { canonical: members[0] || keyOf(pubkey), members, edges };
  }

  /**
   * Every grant and revoke frame held, hex, grants first (to persist or gossip).
   * @returns {string[]}
   */
  frames () {
    const out = Array.from(this._grants.values()).map((g) => g.hex);
    for (const by of this._revokes.values()) for (const hex of by.values()) out.push(hex);
    return out;
  }

  /**
   * Summary for `clusterDevices` (pending one-way grants) and debugging.
   * @returns {{ pending: Array<[string, object]>, edges: Array<[string, object]> }}
   */
  toJSON () {
    return {
      pending: this.pending().map((p) => [`${p.local}->${p.peer}`, p]),
      edges: Array.from(this._edges().entries())
    };
  }

  /**
   * @param {string[]} frames hex frames, as {@link IdentityCluster#frames} returns them
   * @param {Object} [options]
   * @returns {IdentityCluster}
   */
  static fromFrames (frames = [], options = {}) {
    const c = new IdentityCluster(options);
    for (const hex of frames || []) c.ingest(hex);
    return c;
  }
}

IdentityCluster.keyOf = keyOf;
IdentityCluster.edgeKey = edgeKey;
IdentityCluster.available = !!delegation;

module.exports = IdentityCluster;
