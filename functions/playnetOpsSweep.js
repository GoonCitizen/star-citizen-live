'use strict';

/**
 * One-time playnet (regtest) operator sweep — testable plan + injectable runners.
 *
 * Steps:
 *   1. Wipe / realign chain tip (local invalidateblock and/or P2P_FLUSH_CHAIN)
 *   2. Acquire funds from the local Hub Beacon faucet
 *   3. Deploy GoonCitizen CONTRACT_PUBLISH (+ optional Accept on Hub)
 *
 * Live CLI:
 *   star-citizen-live: npm run playnet:deploy-gooncitizen | publish:gooncitizen
 *   hub.fabric.pub: npm run playnet:reset | playnet:flush (mesh / chain ops)
 * Deploy lives in this repo and publishes to Hub as a generic registry.
 */

const Message = require('@fabric/core/types/message');
const {
  gooncitizenContractDefinition,
  gooncitizenContractId
} = require('../contracts/gooncitizen');
const hubBitcoinProxy = require('./hubBitcoinProxy');

const SNAPSHOT_RE = /^[0-9a-f]{64}$/;
const SWEEP_STEPS = Object.freeze(['wipe', 'faucet', 'deploy']);

/**
 * @param {*} hash
 * @returns {string}
 */
function normalizeSnapshotHash (hash) {
  const s = String(hash || '').trim().toLowerCase();
  if (!SNAPSHOT_RE.test(s)) {
    throw new Error('snapshotBlockHash must be 64 hex characters');
  }
  return s;
}

/**
 * Body for Peer#sendFlushChainToTrustedPeers / P2P_FLUSH_CHAIN.
 * @param {object} opts
 * @param {string} opts.snapshotBlockHash
 * @param {string} [opts.network]
 * @param {string} [opts.label]
 * @returns {{ snapshotBlockHash: string, network: string, label: string }}
 */
function buildFlushChainBody (opts = {}) {
  return {
    snapshotBlockHash: normalizeSnapshotHash(opts.snapshotBlockHash),
    network: String(opts.network || process.env.FABRIC_FLUSH_NETWORK || 'regtest').trim() || 'regtest',
    label: String(opts.label || process.env.FABRIC_FLUSH_LABEL || 'playnet-ops-sweep').trim() || 'playnet-ops-sweep'
  };
}

/**
 * Ordered plan for a one-shot playnet realign.
 * @param {object} [opts]
 * @returns {{ steps: string[], wipe: object, faucet: object, deploy: object }}
 */
function planPlaynetSweep (opts = {}) {
  const snapshotBlockHash = opts.snapshotBlockHash
    ? normalizeSnapshotHash(opts.snapshotBlockHash)
    : null;
  return {
    steps: SWEEP_STEPS.slice(),
    wipe: {
      snapshotBlockHash,
      localInvalidate: opts.localInvalidate !== false,
      flushPeers: opts.flushPeers !== false,
      network: String(opts.network || 'regtest'),
      flushBody: snapshotBlockHash
        ? buildFlushChainBody({
          snapshotBlockHash,
          network: opts.network,
          label: opts.flushLabel
        })
        : null
    },
    faucet: {
      hub: opts.hub || process.env.FABRIC_HUB_RPC_URL || 'http://127.0.0.1:8080',
      network: 'regtest',
      amountSats: Math.max(1, Number(opts.faucetAmountSats) || 10000),
      address: opts.receiveAddress || null
    },
    deploy: {
      contractId: gooncitizenContractId(),
      definition: gooncitizenContractDefinition(),
      accept: opts.accept === true,
      hub: opts.hub || process.env.FABRIC_HUB_RPC_URL || 'http://127.0.0.1:8080'
    }
  };
}

/**
 * Simulate / run local tip wipe against an injectable bitcoin-cli.
 * @param {string} snapshotBlockHash
 * @param {object} deps
 * @param {Function} deps.getBestBlockHash
 * @param {Function} deps.invalidateBlock
 * @param {number} [deps.maxSteps]
 * @returns {Promise<{ ok: boolean, steps: number, tip: string }>}
 */
async function runLocalChainWipe (snapshotBlockHash, deps = {}) {
  const snap = normalizeSnapshotHash(snapshotBlockHash);
  const getTip = deps.getBestBlockHash;
  const invalidate = deps.invalidateBlock;
  if (typeof getTip !== 'function' || typeof invalidate !== 'function') {
    throw new Error('runLocalChainWipe requires getBestBlockHash and invalidateBlock');
  }
  const maxSteps = Math.max(1, Number(deps.maxSteps) || 100000);
  let tip = String(await getTip()).trim().toLowerCase();
  if (tip === snap) return { ok: true, steps: 0, tip };
  let steps = 0;
  while (tip !== snap && steps < maxSteps) {
    await invalidate(tip);
    tip = String(await getTip()).trim().toLowerCase();
    steps += 1;
  }
  if (tip !== snap) {
    throw new Error(`local wipe did not reach snapshot after ${steps} steps (tip=${tip})`);
  }
  return { ok: true, steps, tip };
}

/**
 * Acquire funds from Hub faucet (injectable proxy for tests).
 * @param {object} opts
 * @param {string} opts.address
 * @param {number} [opts.amountSats]
 * @param {object} [opts.btc] hubBitcoinProxy settings
 * @param {object} [deps]
 * @param {Function} [deps.discoverFaucet]
 * @param {Function} [deps.requestFaucet]
 * @returns {Promise<object>}
 */
async function acquireHubFaucetFunds (opts = {}, deps = {}) {
  const address = String(opts.address || '').trim();
  if (!address) throw new Error('receive address required for faucet');
  const btc = Object.assign({
    hub: opts.hub || 'http://127.0.0.1:8080',
    network: 'regtest'
  }, opts.btc || {});
  const discover = deps.discoverFaucet || hubBitcoinProxy.discoverFaucet;
  const request = deps.requestFaucet || hubBitcoinProxy.requestFaucet;
  const discovered = await discover(btc);
  if (!discovered.available) {
    throw new Error(discovered.reason
      ? `Hub faucet unavailable (${discovered.reason})`
      : 'Hub faucet unavailable');
  }
  const amountSats = Math.max(1, Number(opts.amountSats) ||
    (discovered.faucet && discovered.faucet.defaultAmountSats) || 10000);
  const result = await request(btc, { address, amountSats });
  return {
    available: true,
    address,
    amountSats,
    hub: discovered.hub,
    faucet: discovered.faucet,
    result
  };
}

/**
 * Build a signed CONTRACT_PUBLISH Message for GoonCitizen (no network I/O).
 * @param {object} key Fabric Key (or { sign, pubkey })
 * @param {object} [definition]
 * @returns {{ contractId: string, message: object, hex: string }}
 */
function buildGoonCitizenPublishMessage (key, definition) {
  if (!key) throw new Error('key required to sign CONTRACT_PUBLISH');
  const def = definition || gooncitizenContractDefinition();
  const contractId = gooncitizenContractId();
  const msg = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(def)]);
  if (typeof msg.signWithKey === 'function') {
    msg.signWithKey(key);
  }
  const buf = typeof msg.toBuffer === 'function' ? msg.toBuffer() : null;
  return {
    contractId,
    definition: def,
    message: msg,
    hex: buf ? buf.toString('hex') : null,
    acceptParams: {
      contractId,
      adminToken: null
    }
  };
}

/**
 * Hub AcceptTrackedApplicationContract params shape.
 * @param {string} contractId
 * @param {string} adminToken
 * @returns {{ contractId: string, adminToken: string }}
 */
function buildAcceptTrackedParams (contractId, adminToken) {
  const id = String(contractId || '').trim().toLowerCase();
  const token = String(adminToken || '').trim();
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('contractId must be 64 hex');
  if (!token) throw new Error('adminToken required for AcceptTrackedApplicationContract');
  return { contractId: id, adminToken: token };
}

/**
 * Run the full sweep with injectable step runners (unit / fake Hub).
 * @param {object} plan From {@link planPlaynetSweep}
 * @param {object} runners
 * @param {Function} [runners.wipe]
 * @param {Function} [runners.faucet]
 * @param {Function} [runners.deploy]
 * @returns {Promise<{ ok: boolean, results: object }>}
 */
async function runPlaynetSweep (plan, runners = {}) {
  const results = { wipe: null, faucet: null, deploy: null };
  if (typeof runners.wipe === 'function') {
    results.wipe = await runners.wipe(plan.wipe);
  }
  if (typeof runners.faucet === 'function') {
    results.faucet = await runners.faucet(plan.faucet);
  }
  if (typeof runners.deploy === 'function') {
    results.deploy = await runners.deploy(plan.deploy);
  }
  return { ok: true, results, steps: plan.steps };
}

module.exports = {
  SNAPSHOT_RE,
  SWEEP_STEPS,
  normalizeSnapshotHash,
  buildFlushChainBody,
  planPlaynetSweep,
  runLocalChainWipe,
  acquireHubFaucetFunds,
  buildGoonCitizenPublishMessage,
  buildAcceptTrackedParams,
  runPlaynetSweep
};
