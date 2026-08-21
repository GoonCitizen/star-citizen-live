'use strict';

/**
 * Resolve Hub operator admin token for LiveRelay-internal use only.
 *
 * The dashboard never sees this token. LiveRelay injects it when calling Hub
 * wallet-spend APIs (`POST /payments`, `sendpayment`) so GoonCitizen inherits
 * Hub Bitcoin behavior over the same HTTP surface under Fabric constraints.
 *
 * Order: explicit settings → env → adminTokenFile → ~/.fabric/hub-admin-token → loopback playnet discover.
 */

const fs = require('fs');
const path = require('path');

/** Default playnet mesh base (`scripts/playnet-regtest-mesh-launch.js`). */
const DEFAULT_PLAYNET_MESH_BASE = 28200;

function isLoopbackHost (host) {
  const h = String(host || '').trim().toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
}

function readTokenFile (filePath) {
  const p = String(filePath || '').trim();
  if (!p) return '';
  try {
    if (!fs.existsSync(p)) return '';
    const line = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/)[0];
    return String(line || '').trim();
  } catch (_) {
    return '';
  }
}

/**
 * Candidate paths for playnet Hub A admin token when hub HTTP is loopback :base+180.
 * @param {string} hubBase
 * @returns {string[]}
 */
function playnetAdminTokenCandidates (hubBase) {
  let port = 0;
  try {
    const u = new URL(String(hubBase || '').trim());
    if (!isLoopbackHost(u.hostname)) return [];
    port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  } catch (_) {
    return [];
  }
  const playnetA = DEFAULT_PLAYNET_MESH_BASE + 180;
  if (port !== playnetA) return [];

  const rel = path.join('stores', 'playnet-mesh-runtime', 'admin-token-a.txt');
  const out = [];
  const fromEnvRoot = String(process.env.FABRIC_HUB_ROOT || process.env.FABRIC_PLAYNET_HUB_ROOT || '').trim();
  if (fromEnvRoot) out.push(path.join(fromEnvRoot, rel));
  // Sibling checkout: star-citizen-live/functions → ../../hub.fabric.pub
  out.push(path.resolve(__dirname, '..', '..', 'hub.fabric.pub', rel));
  out.push(path.resolve(process.cwd(), '..', 'hub.fabric.pub', rel));
  out.push(path.resolve(process.cwd(), 'stores', 'playnet-mesh-runtime', 'admin-token-a.txt'));
  return out;
}

/**
 * @param {object} [btc] settings.bitcoin bag
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ token: string, source: string|null }}
 */
function resolveHubAdminToken (btc = {}, env = process.env) {
  const direct = String(
    (btc && btc.adminToken) ||
    env.FABRIC_HUB_ADMIN_TOKEN ||
    env.FABRIC_ADMIN_TOKEN ||
    ''
  ).trim();
  if (direct) {
    return {
      token: direct,
      source: (btc && btc.adminToken) ? 'settings.bitcoin.adminToken' : 'env'
    };
  }

  const file = String(
    (btc && btc.adminTokenFile) ||
    env.FABRIC_HUB_ADMIN_TOKEN_FILE ||
    ''
  ).trim();
  if (file) {
    const fromFile = readTokenFile(file);
    if (fromFile) return { token: fromFile, source: 'adminTokenFile' };
  }

  try {
    const { readHubAdminToken } = require('@fabric/core/functions/fabricHomeEnv');
    const consultHome = env === process.env || (env && env.HOME);
    if (consultHome) {
      const fromHome = readHubAdminToken(env, env.HOME ? { home: env.HOME } : {});
      if (fromHome && fromHome.token) {
        return { token: fromHome.token, source: fromHome.source || 'home' };
      }
    }
  } catch (_) {
    const consultHome = env === process.env || (env && env.HOME);
    if (consultHome) {
      const homeToken = path.join(
        env.HOME || require('os').homedir(),
        '.fabric',
        'hub-admin-token'
      );
      const fromHome = readTokenFile(homeToken);
      if (fromHome) return { token: fromHome, source: 'home' };
    }
  }

  const hub = (btc && btc.hub) || '';
  for (const candidate of playnetAdminTokenCandidates(hub)) {
    const tok = readTokenFile(candidate);
    if (tok) return { token: tok, source: `playnet:${candidate}` };
  }

  return { token: '', source: null };
}

module.exports = {
  DEFAULT_PLAYNET_MESH_BASE,
  isLoopbackHost,
  playnetAdminTokenCandidates,
  readTokenFile,
  resolveHubAdminToken
};
