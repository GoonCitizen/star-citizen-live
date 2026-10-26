'use strict';

/**
 * Hub Bitcoin HTTP proxy helpers for GoonCitizen LiveRelay.
 * Calls an existing Hub (/services/bitcoin, /payments). Does not import Hub UI.
 */

const crypto = require('crypto');
const accountKeys = require('@fabric/core/functions/accountKeys');
const { resolveHubAdminToken } = require('./hubAdminToken');

const DEFAULT_HUB = 'http://127.0.0.1:8080';

/**
 * Enrich bitcoin settings with a resolved Hub operator token (server-side only).
 * @param {object} [btc]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {object}
 */
function withResolvedHubAdminToken (btc = {}, env = process.env) {
  const out = Object.assign({}, btc || {});
  if (String(out.adminToken || '').trim()) return out;
  const { token, source } = resolveHubAdminToken(out, env);
  if (token) {
    out.adminToken = token;
    out.adminTokenSource = source;
  }
  return out;
}

function normalizeHubBase (hub) {
  const raw = String(hub || DEFAULT_HUB).trim().replace(/\/+$/, '');
  return raw || DEFAULT_HUB;
}

function bitcoinRuntimeForSettings (settings = {}) {
  const b = (settings && settings.bitcoin) || {};
  return {
    enable: b.enable === true,
    hub: normalizeHubBase(b.hub),
    network: String(b.network || 'regtest')
  };
}

function isBitcoinEnabled (settings = {}) {
  return bitcoinRuntimeForSettings(settings).enable === true;
}

function deriveWalletIdFromXpub (xpub = '') {
  const raw = String(xpub || '').trim();
  if (!raw) return '';
  const once = crypto.createHash('sha256').update(raw, 'utf8').digest();
  return crypto.createHash('sha256').update(once).digest('hex');
}

/**
 * Receive address `index` of a SegWit account xpub (`m/84'/B'/n'` → `/0/index`,
 * wpkh). Address HRP follows networkName (regtest → bcrt1).
 * @param {string} xpub Account xpub (`m/84'/B'/n'`).
 * @param {number} [index=0]
 * @param {string} [networkName='regtest']
 * @returns {{ address: string, index: number, path: string }|null}
 */
function deriveReceiveAddress (xpub, index = 0, networkName = 'regtest') {
  const raw = String(xpub || '').trim();
  if (!raw) return null;
  const i = Math.max(0, Math.floor(Number(index) || 0));
  try {
    const address = accountKeys.walletAddress({ xpub: raw, network: networkName, script: 'wpkh', change: 0, index: i });
    return address ? { address, index: i, path: `m/0/${i}` } : null;
  } catch (_) {
    return null;
  }
}

/**
 * Wallet xpubs of the identity's account on `network`: SegWit `m/84'/B'/n'`
 * (new addresses) and standard `m/44'/B'/n'` (watched only). Null while locked.
 * @param {object} identity Unlocked identity.
 * @param {string} network Bitcoin network.
 * @returns {{ xpub: string, standardXpub: string, segwitPath: string, standardPath: string }|null}
 */
function walletKeysFromIdentity (identity, network) {
  if (!identity || !identity.xprv) return null;
  const { accountFromIdentity } = require('./identity');
  const wallet = accountFromIdentity(identity, { network }).wallet;
  return {
    xpub: wallet.segwit.xpub,
    standardXpub: wallet.standard.xpub,
    segwitPath: wallet.segwit.path,
    standardPath: wallet.standard.path
  };
}

/** @private */
function xpubQuery (xpub, standardXpub, extra = {}) {
  const key = String(xpub || '').trim();
  if (!key) {
    const err = new Error('xpub is required');
    err.status = 400;
    throw err;
  }
  const qs = new URLSearchParams(Object.assign({ xpub: key }, extra));
  const standard = String(standardXpub || '').trim();
  if (standard) qs.set('standardXpub', standard);
  return qs.toString();
}

async function hubRequest (hubBase, pathAndQuery, opts = {}) {
  const base = normalizeHubBase(hubBase);
  const path = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  const url = `${base}${path}`;
  const method = String(opts.method || 'GET').toUpperCase();
  const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
  let body;
  if (opts.body != null) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body });
  } catch (e) {
    const err = new Error(e && e.message ? e.message : 'Hub Bitcoin unreachable');
    err.code = 'HUB_UNREACHABLE';
    err.status = 503;
    throw err;
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = (data && (data.message || data.error || data.status)) || `Hub HTTP ${res.status}`;
    const err = new Error(typeof msg === 'string' ? msg : `Hub HTTP ${res.status}`);
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.data = data;
    throw err;
  }
  return data;
}

async function fetchStatus (btc = {}) {
  return hubRequest(btc.hub, '/services/bitcoin', { method: 'GET' });
}

async function fetchWalletSummary (btc = {}, { xpub, standardXpub } = {}) {
  const qs = xpubQuery(xpub, standardXpub);
  return hubRequest(btc.hub, `/services/bitcoin/xpub?${qs}`, { method: 'GET' });
}

async function fetchUtxos (btc = {}, { xpub, standardXpub } = {}) {
  const qs = xpubQuery(xpub, standardXpub);
  return hubRequest(btc.hub, `/services/bitcoin/xpub/utxos?${qs}`, { method: 'GET' });
}

async function fetchTransactions (btc = {}, { xpub, standardXpub, limit = 50 } = {}) {
  const qs = xpubQuery(xpub, standardXpub, {
    limit: String(Math.max(1, Math.min(100, Number(limit) || 50)))
  });
  return hubRequest(btc.hub, `/services/bitcoin/xpub/transactions?${qs}`, { method: 'GET' });
}

/**
 * Watch balance for a single on-chain address (Hub scantxoutset / explorer).
 * @param {object} btc
 * @param {string} address
 * @returns {Promise<object>}
 */
async function fetchAddressBalance (btc = {}, address = '') {
  const addr = String(address || '').trim();
  if (!addr) {
    const err = new Error('address is required');
    err.status = 400;
    throw err;
  }
  return hubRequest(
    btc.hub,
    `/services/bitcoin/addresses/${encodeURIComponent(addr)}/balance`,
    { method: 'GET' }
  );
}

/**
 * Optional address info (UTXOs / history when Hub exposes it).
 * @param {object} btc
 * @param {string} address
 * @returns {Promise<object>}
 */
async function fetchAddressInfo (btc = {}, address = '') {
  const addr = String(address || '').trim();
  if (!addr) {
    const err = new Error('address is required');
    err.status = 400;
    throw err;
  }
  return hubRequest(
    btc.hub,
    `/services/bitcoin/addresses/${encodeURIComponent(addr)}`,
    { method: 'GET' }
  );
}

/**
 * Spend from the Hub bitcoind wallet via Hub HTTP.
 * Operator admin token is resolved server-side (env / adminTokenFile / playnet
 * discover) — the browser never supplies it.
 */
async function sendHubPayment (btc = {}, payment = {}) {
  const resolved = withResolvedHubAdminToken(btc);
  const token = String(resolved.adminToken || payment.adminToken || '').trim();
  if (!token) {
    const err = new Error(
      'Hub admin token required for send — set FABRIC_HUB_ADMIN_TOKEN, ' +
      'bitcoin.adminToken, or bitcoin.adminTokenFile (LiveRelay injects it; UI never holds the token)'
    );
    err.status = 403;
    throw err;
  }
  const to = String(payment.to || '').trim();
  const amountSats = Math.round(Number(payment.amountSats || 0));
  if (!to) {
    const err = new Error('Destination address is required');
    err.status = 400;
    throw err;
  }
  if (!Number.isFinite(amountSats) || amountSats <= 0) {
    const err = new Error('amountSats must be a positive integer');
    err.status = 400;
    throw err;
  }
  const xpub = String(payment.xpub || '').trim();
  const walletId = payment.walletId || (xpub ? deriveWalletIdFromXpub(xpub) : '');
  const body = {
    to,
    amountSats,
    memo: String(payment.memo || ''),
    adminToken: token
  };
  if (walletId) body.walletId = walletId;
  if (xpub) body.xpub = xpub;

  // Prefer Hub payments endpoint; fall back to JSON-RPC sendpayment on /services/bitcoin.
  try {
    return await hubRequest(resolved.hub, '/payments', { method: 'POST', body });
  } catch (e) {
    if (e && (e.status === 404 || e.status === 405)) {
      return hubRequest(resolved.hub, '/services/bitcoin', {
        method: 'POST',
        body: {
          method: 'sendpayment',
          params: {
            to,
            amountSats,
            memo: body.memo,
            adminToken: token
          }
        }
      });
    }
    throw e;
  }
}

const FAUCET_ENDPOINT = '/services/bitcoin/faucet';
const FAUCET_MAX_SATS = 1000000;

/**
 * True when Hub Bitcoin network may expose a Beacon faucet (regtest/playnet only).
 * @param {string} network
 * @returns {boolean}
 */
function isFaucetNetwork (network) {
  return String(network || '').trim().toLowerCase() === 'regtest';
}

/**
 * Parse `services.faucet` from an OPTIONS Application Resource Contract.
 * Returns null when absent, unavailable, or not regtest (signet/mainnet must stay invisible).
 * @param {object|null} arc
 * @returns {object|null}
 */
function faucetFromOptionsDocument (arc) {
  if (!arc || typeof arc !== 'object') return null;
  const raw = arc.services && arc.services.faucet;
  if (!raw || typeof raw !== 'object') return null;
  if (raw.available === false) return null;
  const network = String(raw.network || '').toLowerCase();
  if (network && !isFaucetNetwork(network)) return null;
  const endpointBasePath = String(raw.endpointBasePath || FAUCET_ENDPOINT).trim() || FAUCET_ENDPOINT;
  return Object.assign({}, raw, {
    available: true,
    network: network || 'regtest',
    endpointBasePath,
    maxAmountSats: Number(raw.maxAmountSats) > 0 ? Number(raw.maxAmountSats) : FAUCET_MAX_SATS,
    defaultAmountSats: Number(raw.defaultAmountSats) > 0 ? Number(raw.defaultAmountSats) : 10000
  });
}

/**
 * Discover Beacon faucet via Hub `OPTIONS /` (no assumption when missing).
 * @param {object} [btc]
 * @returns {Promise<{ available: boolean, faucet: object|null, hub: string, network?: string }>}
 */
async function discoverFaucet (btc = {}) {
  const hub = normalizeHubBase(btc.hub);
  const configuredNetwork = String(btc.network || '').toLowerCase();
  if (configuredNetwork && !isFaucetNetwork(configuredNetwork)) {
    return { available: false, faucet: null, hub, network: configuredNetwork, reason: 'network_not_regtest' };
  }
  let arc = null;
  try {
    arc = await hubRequest(hub, '/', { method: 'OPTIONS' });
  } catch (e) {
    return {
      available: false,
      faucet: null,
      hub,
      network: configuredNetwork || null,
      reason: 'options_unreachable',
      error: e && e.message ? e.message : String(e)
    };
  }
  const faucet = faucetFromOptionsDocument(arc);
  if (!faucet) {
    return {
      available: false,
      faucet: null,
      hub,
      network: configuredNetwork || (arc && arc.services && arc.services.faucet && arc.services.faucet.network) || null,
      reason: 'faucet_not_advertised'
    };
  }
  return {
    available: true,
    faucet,
    hub,
    network: faucet.network,
    application: {
      name: arc.name || null,
      contractId: (arc.contract && arc.contract.id) || null
    }
  };
}

/**
 * Request sats from Hub Beacon faucet (regtest). Fails if OPTIONS does not advertise faucet.
 * @param {object} [btc]
 * @param {{ address: string, amountSats?: number }} payment
 */
async function requestFaucet (btc = {}, payment = {}) {
  const discovered = await discoverFaucet(btc);
  if (!discovered.available || !discovered.faucet) {
    const err = new Error(
      discovered.reason === 'network_not_regtest'
        ? 'Faucet is only available on regtest (not advertised on signet/mainnet).'
        : 'Hub faucet is not available (OPTIONS did not advertise services.faucet).'
    );
    err.status = 404;
    err.data = discovered;
    throw err;
  }
  const to = String(payment.address || payment.to || '').trim();
  if (!to) {
    const err = new Error('Destination address is required');
    err.status = 400;
    throw err;
  }
  let amountSats = Math.round(Number(payment.amountSats != null
    ? payment.amountSats
    : discovered.faucet.defaultAmountSats || 10000));
  if (!Number.isFinite(amountSats) || amountSats <= 0) amountSats = 10000;
  const max = Number(discovered.faucet.maxAmountSats) || FAUCET_MAX_SATS;
  amountSats = Math.min(amountSats, max);
  const path = discovered.faucet.endpointBasePath || FAUCET_ENDPOINT;
  return hubRequest(btc.hub, path, {
    method: 'POST',
    body: { address: to, amountSats }
  });
}

module.exports = {
  DEFAULT_HUB,
  normalizeHubBase,
  withResolvedHubAdminToken,
  isBitcoinEnabled,
  bitcoinRuntimeForSettings,
  deriveWalletIdFromXpub,
  deriveReceiveAddress,
  walletKeysFromIdentity,
  hubRequest,
  fetchStatus,
  fetchWalletSummary,
  fetchUtxos,
  fetchTransactions,
  fetchAddressBalance,
  fetchAddressInfo,
  sendHubPayment,
  FAUCET_ENDPOINT,
  FAUCET_MAX_SATS,
  isFaucetNetwork,
  faucetFromOptionsDocument,
  discoverFaucet,
  requestFaucet
};
