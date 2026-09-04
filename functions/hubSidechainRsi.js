'use strict';

/**
 * Submit GoonCitizen game-state snapshots to Hub sidechain `/services/rsi`
 * via signed SubmitSidechainStatePatch (federation witness or admin token).
 */

const gooncitizenGameState = require('./gooncitizenGameState');

function hubRpcUrl (hubOrigin) {
  const base = String(hubOrigin || process.env.FABRIC_HUB_RPC_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
  return `${base}/services/rpc`;
}

async function hubJsonRpc (hubOrigin, method, params = []) {
  const res = await fetch(hubRpcUrl(hubOrigin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  let body = {};
  try {
    body = await res.json();
  } catch (_) {}
  if (!res.ok) {
    const msg = (body && body.error && body.error.message) || res.statusText || `HTTP ${res.status}`;
    return { ok: false, error: msg };
  }
  if (body && body.error) {
    return { ok: false, error: body.error.message || 'RPC error' };
  }
  const result = body && body.result != null ? body.result : null;
  if (result && result.status === 'error') {
    return { ok: false, error: result.message || 'Hub rejected patch' };
  }
  return { ok: true, result };
}

/**
 * @param {Object} opts
 * @param {string} [opts.hubOrigin]
 * @param {Object} opts.snap GameStateSnapshot
 * @param {Object} [opts.signKey] Fabric Key with signSchnorr
 * @param {string[]} [opts.federationValidators]
 * @param {number} [opts.federationThreshold]
 * @param {string} [opts.adminToken]
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: string, result?: object }>}
 */
async function submitGameStateToHubSidechain (opts = {}) {
  const snap = opts.snap;
  if (!snap || typeof snap !== 'object') {
    return { ok: false, error: 'snap required' };
  }

  let sidechainState;
  try {
    sidechainState = require('@fabric/core/functions/sidechainState');
  } catch (_) {
    return { ok: false, error: '@fabric/core sidechainState unavailable' };
  }

  const stateOut = await hubJsonRpc(opts.hubOrigin, 'GetSidechainState', []);
  if (!stateOut.ok) return stateOut;
  const hubState = stateOut.result || {};
  const content = hubState.content && typeof hubState.content === 'object' ? hubState.content : {};
  const basisClock = Number(hubState.clock) || 0;
  const patches = gooncitizenGameState.patchesForGameState(content, snap);
  if (!patches.length) {
    return { ok: true, skipped: true, reason: 'digest unchanged' };
  }

  const basisDigest = sidechainState.stateDigest({
    version: hubState.version != null ? hubState.version : 1,
    clock: basisClock,
    content
  });
  const proposal = { basisClock, basisDigest, patches };

  const validators = Array.isArray(opts.federationValidators) ? opts.federationValidators : [];
  const threshold = Math.max(1, Number(opts.federationThreshold) || 1);
  let federationWitness = null;
  if (validators.length && opts.signKey) {
    federationWitness = sidechainState.buildFederationWitnessForSidechainPatch({
      proposal,
      signKey: opts.signKey,
      validators,
      threshold
    });
  }

  const patchParams = {
    patches,
    basisClock,
    federationWitness: federationWitness || undefined,
    adminToken: federationWitness ? undefined : opts.adminToken
  };

  return hubJsonRpc(opts.hubOrigin, 'SubmitSidechainStatePatch', [patchParams]);
}

/**
 * Build a patch proposal + signing string for tests (no HTTP).
 * @param {Object} snap
 * @param {Object} [existingContent]
 * @returns {{ proposal: object, signingString: string }|null}
 */
function buildGameStatePatchProposal (snap, existingContent = {}) {
  let sidechainState;
  try {
    sidechainState = require('@fabric/core/functions/sidechainState');
  } catch (_) {
    return null;
  }
  const content = existingContent && typeof existingContent === 'object' ? existingContent : {};
  const patches = gooncitizenGameState.patchesForGameState(content, snap);
  if (!patches.length) return null;
  const basisClock = 0;
  const basisDigest = sidechainState.stateDigest({
    version: 1,
    clock: basisClock,
    content
  });
  const proposal = { basisClock, basisDigest, patches };
  return {
    proposal,
    signingString: sidechainState.signingStringForSidechainStatePatch(proposal)
  };
}

module.exports = {
  hubRpcUrl,
  hubJsonRpc,
  submitGameStateToHubSidechain,
  buildGameStatePatchProposal
};
