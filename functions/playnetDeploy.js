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
  const fromEnv = String(process.env.FABRIC_HUB_ADMIN_TOKEN || process.env.FABRIC_ADMIN_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
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
    params
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
  hubRpcBase,
  productionPlaynetTarget,
  PRODUCTION_HUB_HTTP,
  PRODUCTION_PLAYNET_PEERS,
  playnetPeers,
  hubRpc,
  waitForPeerConnections
};
