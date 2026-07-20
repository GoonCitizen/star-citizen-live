'use strict';

/**
 * Contract-namespace Statechain helpers for GoonCitizen (D-016 / Hub ADR-001).
 *
 * Prefer `@fabric/core/functions/contractSidechainLocal` (digests + parent seals
 * from `@fabric/core/types/statechain`). Local fallback keeps desktop/CI working
 * when core lags.
 */

let core = null;
try {
  core = require('@fabric/core/functions/contractSidechainLocal');
} catch (_) {
  core = null;
}

if (core) {
  module.exports = Object.assign({}, core, {
    storePathsForContract: core.storePathsForContract || core.storePathsForLocalContract,
    fromCore: true
  });
} else {
  // Minimal fallback (same shape as core contractSidechainLocal).
  const crypto = require('crypto');
  const fs = require('fs');
  const path = require('path');

  function normalizeContractId (contractId) {
    const id = String(contractId || '').trim().toLowerCase();
    if (!id || id.includes('/') || id.includes('..') || id.length > 128) {
      throw new Error('invalid contractId for contract Statechain');
    }
    return id;
  }

  function storePathsForLocalContract (contractId, storeRoot) {
    const id = normalizeContractId(contractId);
    const base = path.join(storeRoot, 'sidechains', id);
    return { contractId: id, base, state: path.join(base, 'STATE.json') };
  }

  function parentSealPath (contractId) {
    return `/namespaces/${normalizeContractId(contractId)}`;
  }

  function createInitialState () {
    return { version: 1, clock: 0, content: {} };
  }

  function canonicalStringify (value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`;
  }

  function stateDigest (state) {
    return crypto.createHash('sha256').update(canonicalStringify({
      version: state.version != null ? Number(state.version) : 1,
      clock: Number(state.clock) || 0,
      content: state.content || {}
    })).digest('hex');
  }

  function namespaceHeadFromState (contractId, state, meta = {}) {
    const id = normalizeContractId(contractId);
    return {
      contractId: id,
      clock: Number(state && state.clock) || 0,
      stateDigest: stateDigest(state || createInitialState()),
      name: meta.name != null ? String(meta.name) : null,
      parentContractId: meta.parentContractId != null ? String(meta.parentContractId) : null
    };
  }

  function patchesForNamespaceHead (existingContent, contractId, head) {
    const id = normalizeContractId(contractId);
    const ptr = parentSealPath(id);
    const namespaces = existingContent && existingContent.namespaces && typeof existingContent.namespaces === 'object'
      ? existingContent.namespaces
      : null;
    const prev = namespaces && Object.prototype.hasOwnProperty.call(namespaces, id)
      ? namespaces[id]
      : null;
    if (prev && prev.stateDigest && head && head.stateDigest &&
        prev.stateDigest === head.stateDigest && Number(prev.clock) === Number(head.clock)) {
      return [];
    }
    if (!namespaces) {
      return [{ op: 'add', path: '/namespaces', value: { [id]: head } }];
    }
    if (prev) return [{ op: 'replace', path: ptr, value: head }];
    return [{ op: 'add', path: ptr, value: head }];
  }

  function loadState (storeRoot, contractId) {
    const paths = storePathsForLocalContract(contractId, storeRoot);
    try {
      if (!fs.existsSync(paths.state)) return createInitialState();
      const parsed = JSON.parse(fs.readFileSync(paths.state, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return createInitialState();
      return {
        version: Number(parsed.version) || 1,
        clock: Number(parsed.clock) || 0,
        content: parsed.content && typeof parsed.content === 'object' ? parsed.content : {}
      };
    } catch (_) {
      return createInitialState();
    }
  }

  function persistState (storeRoot, contractId, state) {
    const paths = storePathsForLocalContract(contractId, storeRoot);
    fs.mkdirSync(paths.base, { recursive: true });
    fs.writeFileSync(paths.state, JSON.stringify({
      version: state.version != null ? Number(state.version) : 1,
      clock: Number(state.clock) || 0,
      content: state.content || {}
    }, null, 2));
    return paths;
  }

  function ensureLocalContractChain (storeRoot, contractId, meta = {}) {
    const paths = storePathsForLocalContract(contractId, storeRoot);
    const created = !fs.existsSync(paths.state);
    const state = loadState(storeRoot, contractId);
    if (created) persistState(storeRoot, contractId, state);
    return { paths, state, head: namespaceHeadFromState(contractId, state, meta), created };
  }

  function publishContent (storeRoot, contractId, content, meta = {}) {
    const prev = loadState(storeRoot, contractId);
    const next = {
      version: 1,
      clock: (Number(prev.clock) || 0) + 1,
      content: content && typeof content === 'object' ? content : {}
    };
    const paths = persistState(storeRoot, contractId, next);
    return { paths, state: next, head: namespaceHeadFromState(contractId, next, meta) };
  }

  module.exports = {
    storePathsForLocalContract,
    storePathsForContract: storePathsForLocalContract,
    loadState,
    persistState,
    ensureLocalContractChain,
    publishContent,
    normalizeContractId,
    parentSealPath,
    createInitialState,
    stateDigest,
    namespaceHeadFromState,
    patchesForNamespaceHead,
    fromCore: false
  };
}
