'use strict';

/**
 * Build a Fabric Merkle Tree over cumulative history leaves so operators can
 * publish a compact GroupActivityTree into a Group Contract namespace.
 *
 * Leaves are SHA-256 digests of canonical leaf records (id/kind/ts/player) —
 * not raw log lines. The Tree root is what peers converge on for consensus.
 */

const crypto = require('crypto');
const cumulativeHistory = require('./cumulativeHistory');

function _canonicalStringify (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(_canonicalStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${_canonicalStringify(value[k])}`).join(',')}}`;
}

function leafDigest (leaf) {
  return crypto.createHash('sha256').update(_canonicalStringify({
    id: leaf.id,
    kind: leaf.kind,
    ts: leaf.ts || null,
    player: leaf.player || null
  })).digest('hex');
}

/**
 * @param {object} history cumulative history object
 * @param {{ ownerPubkey?: string|null, Tree?: function }} [opts]
 * @returns {{
 *   type: string,
 *   leafCount: number,
 *   root: string,
 *   leaves: object[],
 *   digests: string[],
 *   ownerPubkey: string|null,
 *   generatedAt: string
 * }}
 */
function buildActivityTree (history, opts = {}) {
  const leaves = cumulativeHistory.historyLeaves(history);
  const digests = leaves.map(leafDigest);
  let root = '';
  if (digests.length) {
    let Tree = opts.Tree;
    if (!Tree) {
      try { Tree = require('@fabric/core/types/tree'); } catch (_) { Tree = null; }
    }
    if (Tree) {
      const tree = new Tree({ leaves: digests.map((d) => Buffer.from(d, 'hex')) });
      root = tree.rootHex || '';
    } else {
      // Deterministic fallback when merkletreejs / Tree is unavailable (tests).
      root = crypto.createHash('sha256').update(digests.join('')).digest('hex');
    }
  }
  return {
    type: 'GroupActivityTree',
    leafCount: leaves.length,
    root,
    leaves,
    digests,
    ownerPubkey: opts.ownerPubkey || null,
    generatedAt: new Date().toISOString(),
    counts: cumulativeHistory.cumulativeCounts(history)
  };
}

/**
 * Compact wire body for CONTRACT_MESSAGE under a Group contract.
 * @param {object} treeResult from buildActivityTree
 * @param {{ contractId: string, groupId?: string|null }} meta
 */
function toContractBody (treeResult, meta = {}) {
  return {
    type: 'GroupActivityTree',
    contractId: meta.contractId || null,
    groupId: meta.groupId || null,
    root: treeResult.root,
    leafCount: treeResult.leafCount,
    ownerPubkey: treeResult.ownerPubkey || null,
    generatedAt: treeResult.generatedAt,
    counts: treeResult.counts || null,
    // Digests only (not full leaf payloads) — peers can re-derive from local history.
    digests: treeResult.digests || []
  };
}

module.exports = {
  leafDigest,
  buildActivityTree,
  toContractBody
};
