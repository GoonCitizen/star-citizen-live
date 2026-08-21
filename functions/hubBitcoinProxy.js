'use strict';

/**
 * Hub Bitcoin HTTP proxy helpers for GoonCitizen LiveRelay.
 * Calls an existing Hub (/services/bitcoin, /payments). Does not import Hub UI.
 */

const crypto = require('crypto');
const { BIP32Factory } = require('bip32');
const ecc = require('tiny-secp256k1');
const bitcoin = require('bitcoinjs-lib');
const { resolveHubAdminToken } = require('./hubAdminToken');

const bip32 = BIP32Factory(ecc);

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

function networkFromXpubPrefix (xpub = '') {
  const raw = String(xpub || '').trim();
  const isTest = raw.startsWith('tpub') || raw.startsWith('upub') || raw.startsWith('vpub');
  return isTest
    ? {
      bech32: 'tb',
      bip32: { public: 0x043587cf, private: 0x04358394 },
      pubKeyHash: 0x6f,
      scriptHash: 0xc4,
      wif: 0xef
    }
    : {
      bech32: 'bc',
      bip32: { public: 0x0488b21e, private: 0x0488ade4 },
      pubKeyHash: 0x00,
      scriptHash: 0x05,
      wif: 0x80
    };
}

function addressNetworkForName (name) {
  const n = String(name || 'regtest').toLowerCase();
  if (n === 'mainnet' || n === 'bitcoin' || n === 'livenet' || n === 'main') {
    return {
      bech32: 'bc',
      bip32: { public: 0x0488b21e, private: 0x0488ade4 },
      pubKeyHash: 0x00,
      scriptHash: 0x05,
      wif: 0x80
    };
  }
  if (n === 'testnet' || n === 'signet' || n === 'testnet3') {
    return {
      bech32: 'tb',
      bip32: { public: 0x043587cf, private: 0x04358394 },
      pubKeyHash: 0x6f,
      scriptHash: 0xc4,
      wif: 0xef
    };
  }
  return {
    bech32: 'bcrt',
    bip32: { public: 0x043587cf, private: 0x04358394 },
    pubKeyHash: 0x6f,
    scriptHash: 0xc4,
    wif: 0xef
  };
}

/**
 * Derive a BIP32 receive address from an account/master xpub at m/0/index (wpkh).
 * Fabric identities use mainnet xpub version bytes; address HRP follows networkName (regtest → bcrt1).
 *
 * When `opts.xprv` (Fabric HD master) is provided, derives the Hub-aligned BIP44 payment
 * account first (`m/44'/0'/account'/0/index`) so GoonCitizen sees the same coins as
 * Hub desktop faucet → local key.
 *
 * @param {string} xpub
 * @param {number} [index=0]
 * @param {string} [networkName='regtest']
 * @param {object} [opts]
 * @param {string} [opts.xprv] Fabric master xprv
 * @param {number} [opts.bip44Account=0]
 * @returns {{ address: string, index: number, path: string, accountXpub?: string }|null}
 */
function deriveReceiveAddress (xpub, index = 0, networkName = 'regtest', opts = {}) {
  const i = Math.max(0, Math.floor(Number(index) || 0));
  const accountIndex = Math.max(0, Math.floor(Number(opts.bip44Account != null ? opts.bip44Account : 0) || 0));
  const masterXprv = String(opts.xprv || '').trim();
  try {
    if (masterXprv.startsWith('xprv') || masterXprv.startsWith('tprv')) {
      const decodeNetwork = networkFromXpubPrefix(masterXprv);
      const root = bip32.fromBase58(masterXprv, decodeNetwork);
      // Hub bitcoinClient uses m/44'/0'/n' for Fabric master keys (mainnet purpose on all nets).
      const acct = root.derivePath(`m/44'/0'/${accountIndex}'`);
      const child = acct.derive(0).derive(i);
      const addressNetwork = addressNetworkForName(networkName);
      const pubkey = Buffer.from(child.publicKey);
      const { address } = bitcoin.payments.p2wpkh({ pubkey, network: addressNetwork });
      if (!address) return null;
      return {
        address,
        index: i,
        path: `m/44'/0'/${accountIndex}'/0/${i}`,
        accountXpub: acct.neutered().toBase58()
      };
    }
    const raw = String(xpub || '').trim();
    if (!raw) return null;
    const decodeNetwork = networkFromXpubPrefix(raw);
    const account = bip32.fromBase58(raw, decodeNetwork);
    const child = account.derive(0).derive(i);
    const addressNetwork = addressNetworkForName(networkName);
    const pubkey = Buffer.from(child.publicKey);
    const { address } = bitcoin.payments.p2wpkh({ pubkey, network: addressNetwork });
    if (!address) return null;
    return { address, index: i, path: `m/0/${i}` };
  } catch (_) {
    return null;
  }
}

/**
 * BIP44 payment-account xpub matching Hub desktop faucet / local-key watch.
 * @param {object} identity { xprv?, xpub? }
 * @param {number} [bip44Account=0]
 * @returns {string}
 */
function bitcoinWatchXpubFromIdentity (identity = {}, bip44Account = 0) {
  const xprv = String(identity.xprv || '').trim();
  const xpub = String(identity.xpub || '').trim();
  if (xprv.startsWith('xprv') || xprv.startsWith('tprv')) {
    const derived = deriveReceiveAddress(xpub, 0, 'regtest', { xprv, bip44Account });
    if (derived && derived.accountXpub) return derived.accountXpub;
  }
  return xpub;
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

async function fetchWalletSummary (btc = {}, { xpub } = {}) {
  const key = String(xpub || '').trim();
  if (!key) {
    const err = new Error('xpub is required');
    err.status = 400;
    throw err;
  }
  const qs = new URLSearchParams({ xpub: key });
  return hubRequest(btc.hub, `/services/bitcoin/xpub?${qs.toString()}`, { method: 'GET' });
}

async function fetchUtxos (btc = {}, { xpub } = {}) {
  const key = String(xpub || '').trim();
  if (!key) {
    const err = new Error('xpub is required');
    err.status = 400;
    throw err;
  }
  const qs = new URLSearchParams({ xpub: key });
  return hubRequest(btc.hub, `/services/bitcoin/xpub/utxos?${qs.toString()}`, { method: 'GET' });
}

async function fetchTransactions (btc = {}, { xpub, limit = 50 } = {}) {
  const key = String(xpub || '').trim();
  if (!key) {
    const err = new Error('xpub is required');
    err.status = 400;
    throw err;
  }
  const qs = new URLSearchParams({
    xpub: key,
    limit: String(Math.max(1, Math.min(100, Number(limit) || 50)))
  });
  return hubRequest(btc.hub, `/services/bitcoin/xpub/transactions?${qs.toString()}`, { method: 'GET' });
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
  bitcoinWatchXpubFromIdentity,
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
