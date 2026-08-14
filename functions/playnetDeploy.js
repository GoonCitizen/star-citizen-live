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

/**
 * Production publisher Accept token: mint from local operator key, else env/file.
 * @param {object} [keySettings]
 * @param {object} [opts]
 * @returns {{ token: string, source: string|null, pubkeyPrefix: string|null }}
 */
function resolveAcceptAdminToken (keySettings, opts = {}) {
  const minted = mintOperatorAdminToken(keySettings, opts);
  if (minted.token) return minted;
  const token = loadAdminToken();
  return { token, source: token ? 'file-or-env' : null, pubkeyPrefix: null };
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

module.exports = {
  ROOT,
  loadPeerKeySettings,
  loadAdminToken,
  mintOperatorAdminToken,
  resolveAcceptAdminToken,
  hubRpcBase,
  productionPlaynetTarget,
  PRODUCTION_HUB_HTTP,
  PRODUCTION_PLAYNET_PEERS,
  playnetPeers,
  hubRpc,
  waitForPeerConnections
};
