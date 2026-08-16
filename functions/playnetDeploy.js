'use strict';

/**
 * Playnet deploy helpers for GoonCitizen (canonical in this repo).
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');

const {
  loadFabricEnvIdentity
} = require('./fabricEnvIdentity');

const ROOT = path.resolve(__dirname, '..');

/**
 * @param {object} [opts]
 * @param {boolean} [opts.allowLocalIdentityFallback=true]
 * @returns {{ xprv: string }|{ mnemonic: string }|null}
 */
function loadPeerKeySettings (opts = {}) {
  const allowLocal = opts.allowLocalIdentityFallback !== false;
  const identity = loadFabricEnvIdentity(process.env, {
    allowLocalIdentityFallback: allowLocal
  });
  if (!identity) return null;
  if (identity.xprv) return { xprv: identity.xprv };
  if (identity.mnemonic) return { mnemonic: identity.mnemonic };
  return null;
}

function loadAdminToken () {
  const { resolveHubAdminToken } = require('./hubAdminToken');
  const resolved = resolveHubAdminToken({}, process.env);
  if (resolved && resolved.token) return resolved.token;
  const meshTokenPath = path.resolve(
    ROOT,
    '..',
    'hub.fabric.pub',
    'stores',
    'playnet-mesh-runtime',
    'admin-token-a.txt'
  );
  try {
    const fromMesh = String(fs.readFileSync(meshTokenPath, 'utf8') || '').trim();
    if (fromMesh) return fromMesh;
  } catch (_) {}
  return '';
}

/**
 * Mint a Hub admin token from the local operator key (production publisher).
 * Prefers HD master (`FABRIC_XPRV`) so Hub `SetupService._rootKey` verifies it;
 * optionally also mint from a derived Peer key.
 *
 * Does not log the token.
 *
 * @param {object} keySettings `{ xprv }` / `{ mnemonic }` / `{ seed }`
 * @param {object} [opts]
 * @param {object} [opts.derivedKey] Fabric Key (Peer identity) to try second
 * @param {boolean} [opts.persist=true] Write `~/.fabric/hub-admin-token`
 * @returns {{ token: string, source: string|null, pubkeyPrefix: string|null }}
 */
function mintOperatorAdminToken (keySettings, opts = {}) {
  if (!keySettings || typeof keySettings !== 'object') {
    return { token: '', source: null, pubkeyPrefix: null };
  }
  const Key = require('@fabric/core/types/key');
  let mint;
  let writeToken = null;
  try {
    const home = require('@fabric/core/functions/fabricHomeEnv');
    mint = home.mintHubAdminToken;
    writeToken = typeof home.writeHubAdminToken === 'function' ? home.writeHubAdminToken : null;
  } catch (_) {
    mint = null;
  }
  if (typeof mint !== 'function') {
    const Token = require('@fabric/core/types/token');
    mint = (issuer) => new Token({
      capability: 'OP_IDENTITY',
      issuer,
      subject: 'admin'
    }).toSignedString();
  }

  const persist = opts.persist !== false;
  const candidates = [];
  try {
    candidates.push({ key: new Key(keySettings), source: 'operator-master' });
  } catch (_) { /* invalid settings */ }
  if (opts.derivedKey) {
    candidates.push({ key: opts.derivedKey, source: 'operator-derived' });
  }

  for (const row of candidates) {
    if (!row.key) continue;
    try {
      const token = String(mint(row.key) || '').trim();
      if (!token) continue;
      if (persist && writeToken) {
        try { writeToken(token); } catch (_) { /* home dir not writable */ }
      }
      let pubkeyPrefix = null;
      try {
        const hex = row.key.pubkey ? String(row.key.pubkey) : '';
        pubkeyPrefix = hex ? hex.slice(0, 12) + '…' : null;
      } catch (_) { /* ignore */ }
      return { token, source: row.source, pubkeyPrefix };
    } catch (_) { /* try next candidate */ }
  }
  return { token: '', source: null, pubkeyPrefix: null };
}

function hubRpcBase () {
  return String(process.env.FABRIC_HUB_RPC_URL || process.env.FABRIC_HUB_URL || 'http://127.0.0.1:8080')
    .trim()
    .replace(/\/$/, '');
}

const PRODUCTION_HUB_HTTP = 'https://hub.fabric.pub';
const PRODUCTION_PLAYNET_PEERS = 'hub.fabric.pub:7777,relay.goon.vc:7777';

/**
 * Public playnet targets (`--production` / `FABRIC_PLAYNET_PRODUCTION=1`).
 * Env still wins when already set.
 * @returns {{ hubUrl: string, peers: string[] }}
 */
function productionPlaynetTarget () {
  const hubUrl = String(
    process.env.FABRIC_HUB_RPC_URL || process.env.FABRIC_HUB_URL || PRODUCTION_HUB_HTTP
  ).trim().replace(/\/$/, '');
  const peers = String(process.env.FABRIC_PLAYNET_PEERS || process.env.FABRIC_FLUSH_PEERS ||
    PRODUCTION_PLAYNET_PEERS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { hubUrl, peers };
}

function playnetPeers (extraArgv = []) {
  if (Array.isArray(extraArgv) && extraArgv.length) {
    return extraArgv.map((s) => String(s).trim()).filter(Boolean);
  }
  return String(process.env.FABRIC_PLAYNET_PEERS || process.env.FABRIC_FLUSH_PEERS ||
    'relay.goon.vc:7777,hub.fabric.pub:7777')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function hubRpc (method, params = {}, opts = {}) {
  const base = String(opts.baseUrl || hubRpcBase()).replace(/\/$/, '');
  const url = new URL(`${base}/services/rpc`);
  const lib = url.protocol === 'https:' ? https : http;
  const timeoutMs = Number(opts.timeoutMs || 60000);
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method,
    params: (params !== null && typeof params === 'object' && !Array.isArray(params))
      ? [params]
      : params
  });

  return new Promise((resolve, reject) => {
    const req = lib.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
            return;
          }
          resolve(parsed.result !== undefined ? parsed.result : parsed);
        } catch (e) {
          reject(new Error(`RPC parse failed (${res.statusCode}): ${data.slice(0, 400)}`));
        }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`RPC timeout after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function waitForPeerConnections (peer, { timeoutMs = 20000, min = 1 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = Object.keys(peer.connections || {}).length;
    if (n >= min) return Object.keys(peer.connections || {});
    await new Promise((r) => setTimeout(r, 250));
  }
  return Object.keys(peer.connections || {});
}

const PRODUCTION_HOST_RE = /(?:^|[./])(?:hub\.fabric\.pub|relay\.goon\.vc)(?::|\s|$)/i;

/**
 * Classify whether this process is an operator publish, an adversary probe, or
 * ambiguous (production hosts / flags without a clear intent).
 *
 * Local machine + production hosts defaults to **operator** for deploy scripts
 * (same FABRIC_XPRV config as Hub). Adversary scripts must opt in explicitly.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.argv]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.script] 'deploy' | 'adversary' | 'status' | 'unknown'
 * @param {string[]} [opts.peers]
 * @param {string} [opts.httpTarget]
 * @returns {{
 *   posture: 'operator'|'adversary'|'local'|'ambiguous',
 *   productionTargets: boolean,
 *   reasons: string[],
 *   treatAsOperatorPublish: boolean,
 *   treatAsAdversary: boolean
 * }}
 */
function classifyPlaynetPosture (opts = {}) {
  const env = opts.env || process.env;
  const argv = Array.isArray(opts.argv) ? opts.argv : [];
  const script = String(opts.script || 'unknown');
  const reasons = [];

  const advFlag = argv.includes('--adversary') ||
    env.ADV_PRODUCTION === '1' || env.ADV_PRODUCTION === 'true' ||
    env.FABRIC_PLAYNET_ADVERSARY === '1' || env.FABRIC_PLAYNET_ADVERSARY === 'true';
  const opFlag = argv.includes('--production') ||
    env.FABRIC_PLAYNET_PRODUCTION === '1' || env.FABRIC_PLAYNET_PRODUCTION === 'true';
  const peers = Array.isArray(opts.peers) ? opts.peers : [];
  const httpTarget = String(opts.httpTarget || env.ADV_HTTP || env.FABRIC_HUB_RPC_URL || '');
  const peerBlob = peers.join(',') + ',' + String(env.FABRIC_PLAYNET_PEERS || '') + ',' +
    String(env.ADV_FABRIC || '');
  const productionTargets = PRODUCTION_HOST_RE.test(httpTarget) ||
    PRODUCTION_HOST_RE.test(peerBlob) ||
    peers.some((p) => PRODUCTION_HOST_RE.test(String(p)));

  if (advFlag) reasons.push('adversary flag/env set');
  if (opFlag) reasons.push('production/operator flag/env set');
  if (productionTargets) reasons.push('targets public playnet hosts');
  if (script === 'adversary') reasons.push('adversary probe script');
  if (script === 'deploy') reasons.push('operator deploy script');

  let posture = 'local';
  if (script === 'adversary' || (advFlag && !opFlag)) {
    posture = 'adversary';
  } else if (opFlag && !advFlag) {
    posture = productionTargets || script === 'deploy' ? 'operator' : 'operator';
  } else if (advFlag && opFlag) {
    posture = 'ambiguous';
    reasons.push('both adversary and production/operator signals present');
  } else if (productionTargets && script === 'deploy') {
    posture = 'operator';
    reasons.push('deploy against public hosts → operator publish');
  } else if (productionTargets && script === 'adversary') {
    posture = 'adversary';
  } else if (productionTargets) {
    posture = 'ambiguous';
    reasons.push('public hosts without clear operator/adversary intent');
  }

  // Deploy never inherits adversary by accident — local config is the publisher.
  const treatAsAdversary = posture === 'adversary' ||
    (posture === 'ambiguous' && script === 'adversary');
  const treatAsOperatorPublish = posture === 'operator' ||
    (posture === 'ambiguous' && script === 'deploy') ||
    (script === 'deploy' && opFlag);

  return {
    posture,
    productionTargets,
    reasons,
    treatAsOperatorPublish: !!treatAsOperatorPublish,
    treatAsAdversary: !!treatAsAdversary
  };
}

/**
 * Ordered Accept token candidates for local→production publish.
 * Env/file first (Hub-issued), then mint from the same FABRIC_XPRV as Hub `_rootKey`.
 *
 * @param {object} [keySettings]
 * @param {object} [opts]
 * @returns {Array<{ token: string, source: string, pubkeyPrefix: string|null }>}
 */
function listAcceptAdminTokenCandidates (keySettings, opts = {}) {
  const out = [];
  const seen = new Set();
  const push = (row) => {
    const token = row && String(row.token || '').trim();
    if (!token || seen.has(token)) return;
    seen.add(token);
    out.push({
      token,
      source: row.source || 'unknown',
      pubkeyPrefix: row.pubkeyPrefix || null
    });
  };

  // Explicit env / Hub-issued file before mint so a Hub first-time-setup token
  // still works when local mint key ≠ production Hub `_rootKey`.
  const stored = loadAdminToken();
  if (stored) {
    const fromEnv = String(
      process.env.FABRIC_HUB_ADMIN_TOKEN || process.env.FABRIC_ADMIN_TOKEN || ''
    ).trim();
    push({
      token: stored,
      source: fromEnv && fromEnv === stored ? 'env' : 'file-or-env',
      pubkeyPrefix: null
    });
  }

  const mintedMaster = mintOperatorAdminToken(keySettings, Object.assign({}, opts, {
    derivedKey: null,
    persist: false
  }));
  push(mintedMaster);

  if (opts.derivedKey) {
    try {
      let mint;
      try {
        mint = require('@fabric/core/functions/fabricHomeEnv').mintHubAdminToken;
      } catch (_) {
        const Token = require('@fabric/core/types/token');
        mint = (issuer) => new Token({
          capability: 'OP_IDENTITY',
          issuer,
          subject: 'admin'
        }).toSignedString();
      }
      const token = String(mint(opts.derivedKey) || '').trim();
      let pubkeyPrefix = null;
      try {
        const hex = opts.derivedKey.pubkey ? String(opts.derivedKey.pubkey) : '';
        pubkeyPrefix = hex ? hex.slice(0, 12) + '…' : null;
      } catch (_) { /* ignore */ }
      push({ token, source: 'operator-derived', pubkeyPrefix });
    } catch (_) { /* ignore */ }
  }

  return out;
}

/**
 * Prefer stored Hub token, else first mint — same cascade head as Accept retries.
 * @param {object} [keySettings]
 * @param {object} [opts]
 * @returns {{ token: string, source: string|null, pubkeyPrefix: string|null }}
 */
function resolveAcceptAdminToken (keySettings, opts = {}) {
  const list = listAcceptAdminTokenCandidates(keySettings, opts);
  if (!list.length) return { token: '', source: null, pubkeyPrefix: null };
  const first = list[0];
  // Persist a mint when that is what we selected and persist≠false
  if (opts.persist !== false && first.source === 'operator-master' && keySettings) {
    mintOperatorAdminToken(keySettings, opts);
  }
  return first;
}

/**
 * Extract Hub identity pubkey hex from GetNetworkStatus / peering payloads.
 * @param {object} status
 * @returns {string|null}
 */
function extractHubPubkey (status) {
  if (!status || typeof status !== 'object') return null;
  const candidates = [
    status.pubkey,
    status.publicKey,
    status.networkAddress,
    status.id,
    status.peerId,
    status.identity && status.identity.pubkey,
    status.identity && status.identity.id,
    status.node && status.node.pubkey,
    status.agent && status.agent.pubkey
  ];
  for (const c of candidates) {
    const s = String(c || '').trim().toLowerCase();
    if (/^0[23][0-9a-f]{64}$/.test(s)) return s;
    if (/^[0-9a-f]{64}$/.test(s)) return s;
  }
  return null;
}

/**
 * Compare local operator key to Hub network identity (same-config preflight).
 * @param {object} [keySettings]
 * @param {object} [opts]
 * @returns {Promise<object>}
 */
async function preflightOperatorAlignment (keySettings, opts = {}) {
  const Key = require('@fabric/core/types/key');
  let localPubkey = null;
  try {
    if (keySettings) localPubkey = String(new Key(keySettings).pubkey || '').toLowerCase();
  } catch (_) { /* ignore */ }

  const baseUrl = opts.baseUrl || hubRpcBase();
  let hubStatus = null;
  let hubPubkey = null;
  let error = null;
  try {
    hubStatus = await hubRpc('GetNetworkStatus', {}, { baseUrl, timeoutMs: opts.timeoutMs || 20000 });
    hubPubkey = extractHubPubkey(hubStatus);
  } catch (e) {
    error = e && e.message ? e.message : String(e);
  }

  const aligned = !!(localPubkey && hubPubkey && (
    localPubkey === hubPubkey ||
    localPubkey.slice(-64) === hubPubkey.slice(-64)
  ));

  return {
    baseUrl,
    localPubkeyPrefix: localPubkey ? localPubkey.slice(0, 12) + '…' : null,
    hubPubkeyPrefix: hubPubkey ? hubPubkey.slice(0, 12) + '…' : null,
    aligned,
    known: !!(localPubkey && hubPubkey),
    error,
    sameConfigExpected: aligned || (!hubPubkey && !!localPubkey)
  };
}

/**
 * Try AcceptTrackedApplicationContract with each admin token candidate.
 * @param {object} opts
 * @returns {Promise<object>}
 */
async function acceptTrackedWithTokenCascade (opts = {}) {
  const contractId = String(opts.contractId || '').trim();
  const baseUrl = opts.baseUrl || hubRpcBase();
  const candidates = Array.isArray(opts.candidates) ? opts.candidates : [];
  const rpc = typeof opts.rpc === 'function' ? opts.rpc : hubRpc;
  const attempts = [];
  if (!contractId) {
    return { ok: false, accept: null, attempts, error: 'contractId required' };
  }
  if (!candidates.length) {
    return { ok: false, accept: null, attempts, error: 'no admin token candidates' };
  }

  for (const row of candidates) {
    try {
      const accept = await rpc('AcceptTrackedApplicationContract', {
        contractId,
        adminToken: row.token
      }, { baseUrl, timeoutMs: opts.timeoutMs });
      const ok = !!(accept && accept.status !== 'error');
      attempts.push({
        source: row.source,
        ok,
        message: accept && accept.message ? String(accept.message) : null
      });
      if (ok) {
        return { ok: true, accept, source: row.source, attempts };
      }
    } catch (e) {
      attempts.push({
        source: row.source,
        ok: false,
        message: e && e.message ? e.message : String(e)
      });
    }
  }
  return {
    ok: false,
    accept: null,
    attempts,
    error: 'all admin token candidates rejected (Hub _rootKey may not match local FABRIC_XPRV; set FABRIC_HUB_ADMIN_TOKEN from Hub setup or align keys)'
  };
}

module.exports = {
  ROOT,
  loadPeerKeySettings,
  loadAdminToken,
  mintOperatorAdminToken,
  resolveAcceptAdminToken,
  listAcceptAdminTokenCandidates,
  classifyPlaynetPosture,
  extractHubPubkey,
  preflightOperatorAlignment,
  acceptTrackedWithTokenCascade,
  hubRpcBase,
  productionPlaynetTarget,
  PRODUCTION_HUB_HTTP,
  PRODUCTION_PLAYNET_PEERS,
  playnetPeers,
  hubRpc,
  waitForPeerConnections
};
