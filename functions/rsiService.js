'use strict';

/**
 * The RSI HTTP interface shared by GoonCitizen and apps that depend on it
 * (goon.vc). Mounted at `/services/rsi`. The same routes also answer under
 * `/services/star-citizen/rsi` on a LiveRelay when that base is passed in.
 *
 *   GET /services/rsi
 *   GET /services/rsi/orgs/:sid
 *   GET /services/rsi/citizens/:handle
 *   GET /services/rsi/citizens/:handle/verify?pubkey=
 *   GET /services/rsi/claim
 *
 * Citizen and org reads are the public RSI pages. Claim and verify use a
 * Fabric pubkey (`?pubkey=`, or `options.pubkey`). Nothing here knows about
 * HTTP frameworks: `handle` writes JSON and returns whether the path was ours.
 */

const rsiLookup = require('./rsiLookup');
const rsiOwnershipClaim = require('./rsiOwnershipClaim');

const BASE = '/services/rsi';
const INSTRUCTIONS = 'Add this exact token to your public RSI citizen biography (Account → Bio), then Verify.';

const INTERFACES = [
  { method: 'GET', path: '/orgs/:sid', type: 'RsiOrganization' },
  { method: 'GET', path: '/citizens/:handle', type: 'RsiCitizen' },
  { method: 'GET', path: '/citizens/:handle/verify', type: 'RsiOwnershipVerification' },
  { method: 'GET', path: '/claim', type: 'RsiOwnershipClaim' }
];

function catalog (base) {
  return {
    service: 'rsi',
    base,
    interfaces: INTERFACES.map((entry) => Object.assign({}, entry, { path: base + entry.path }))
  };
}

function matchBase (pathname, bases) {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  for (const base of bases) {
    const root = String(base || '').replace(/\/+$/, '');
    if (!root) continue;
    if (path === root || path.startsWith(root + '/')) return { base: root, rest: path.slice(root.length) || '/' };
  }
  return null;
}

function decodeParam (value) {
  try { return decodeURIComponent(value); } catch (_) { return value; }
}

/**
 * One RSI request, independent of who is writing the HTTP response.
 * @param {string} method
 * @param {string} rest Path under the base, starting with `/`.
 * @param {URL} url
 * @param {Object} [options]
 * @param {string} [options.base]
 * @param {Function} [options.lookupOrg]
 * @param {Function} [options.lookupCitizen]
 * @param {Function} [options.pubkey] `(queryPubkey) => string`
 * @returns {Promise<{ status: number, body: Object }>}
 */
async function dispatch (method, rest, url, options = {}) {
  const base = options.base || BASE;
  const lookupOrg = options.lookupOrg || rsiLookup.lookupOrg;
  const lookupCitizen = options.lookupCitizen || rsiLookup.lookupCitizen;
  if (method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } };
  if (rest === '/') return { status: 200, body: catalog(base) };

  let match = /^\/orgs\/([^/]+)$/.exec(rest);
  if (match) {
    const out = await lookupOrg(decodeParam(match[1]));
    if (!out.ok) return { status: out.status || 502, body: { error: out.error || 'RSI org lookup failed' } };
    return { status: 200, body: { type: 'RsiOrganization', data: out.data, cached: !!out.cached } };
  }

  if (rest === '/claim') {
    const pk = pubkeyOf(url, options);
    const token = pk ? rsiOwnershipClaim.ownershipClaimToken(pk) : null;
    if (!token) return { status: 400, body: { error: 'unlocked Fabric identity required' } };
    return {
      status: 200,
      body: {
        type: 'RsiOwnershipClaim',
        data: {
          claim: token,
          pubkey: pk,
          pubkeyHash: rsiOwnershipClaim.pubkeyHashHex(pk),
          instructions: INSTRUCTIONS
        }
      }
    };
  }

  match = /^\/citizens\/([^/]+)\/verify$/.exec(rest);
  if (match) {
    const handle = decodeParam(match[1]);
    const pk = pubkeyOf(url, options);
    if (!pk) return { status: 400, body: { error: 'pubkey query required (or unlock local identity)' } };
    const result = await verify(handle, pk, { lookupCitizen });
    if (!result.ok && !result.citizen) {
      return {
        status: result.status || 502,
        body: { error: result.error, type: 'RsiOwnershipVerification', data: result.ownership }
      };
    }
    return {
      status: 200,
      body: {
        type: 'RsiOwnershipVerification',
        data: result.ownership,
        citizen: result.citizen || null,
        cached: !!result.cached
      }
    };
  }

  match = /^\/citizens\/([^/]+)$/.exec(rest);
  if (match) {
    const handle = decodeParam(match[1]);
    const out = await lookupCitizen(handle);
    if (!out.ok) return { status: out.status || 502, body: { error: out.error || 'RSI citizen lookup failed' } };
    const pk = String((url && url.searchParams.get('pubkey')) || '').trim();
    const ownership = pk
      ? rsiOwnershipClaim.verifyOwnershipFromBio({
        pubkey: pk,
        handle: (out.data && out.data.handle) || handle,
        bio: out.data && out.data.bio
      })
      : null;
    return { status: 200, body: { type: 'RsiCitizen', data: out.data, cached: !!out.cached, ownership } };
  }

  return { status: 404, body: { error: 'Not found' } };
}

function pubkeyOf (url, options) {
  const query = String((url && url.searchParams.get('pubkey')) || '').trim();
  if (typeof options.pubkey === 'function') return String(options.pubkey(query) || '').trim();
  return query;
}

/**
 * The same check LiveRelay used before this module: fetch the citizen and
 * see whether the biography holds that Fabric key's `g00n:` token.
 * @param {string} handle
 * @param {string} pubkey
 * @param {Object} [options]
 * @param {Function} [options.lookupCitizen]
 * @returns {Promise<Object>}
 */
async function verify (handle, pubkey, options = {}) {
  const lookupCitizen = options.lookupCitizen || rsiLookup.lookupCitizen;
  const claim = rsiOwnershipClaim.ownershipClaimToken(pubkey);
  if (!claim) {
    return {
      ok: false,
      status: 400,
      error: 'invalid Fabric pubkey',
      ownership: rsiOwnershipClaim.verifyOwnershipFromBio({ pubkey, handle, bio: null })
    };
  }
  const out = await lookupCitizen(handle);
  if (!out.ok) {
    return {
      ok: false,
      status: out.status || 502,
      error: out.error || 'RSI citizen lookup failed',
      ownership: rsiOwnershipClaim.verifyOwnershipFromBio({ pubkey, handle, bio: null }),
      citizen: null
    };
  }
  return {
    ok: true,
    status: 200,
    ownership: rsiOwnershipClaim.verifyOwnershipFromBio({
      pubkey,
      handle: (out.data && out.data.handle) || handle,
      bio: out.data && out.data.bio
    }),
    citizen: out.data,
    cached: !!out.cached
  };
}

function writeJson (res, status, body) {
  if (!res || res.headersSent || res.writableEnded) return;
  res.statusCode = status;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
  }
  const json = JSON.stringify(body);
  if (typeof res.writeHead === 'function' && !res.headersSent) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(json);
    return;
  }
  res.end(json);
}

/**
 * Answer a `/services/rsi` request. Returns false when the path is not ours.
 * `options.authorize` may write its own refusal and return false; this then
 * returns true so the caller stops.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} pathname
 * @param {Object} [options]
 * @param {string[]} [options.bases]
 * @param {Function} [options.send] `(status, body) => void`
 * @param {Function} [options.authorize] `(req, res) => boolean`
 * @returns {Promise<boolean>}
 */
async function handle (req, res, pathname, options = {}) {
  const hit = matchBase(pathname, options.bases || [options.base || BASE]);
  if (!hit) return false;
  if (typeof options.authorize === 'function') {
    const allowed = await options.authorize(req, res);
    if (!allowed) return true;
  }
  const url = options.url || new URL(req.url || hit.base, 'http://localhost');
  const result = await dispatch(String(req.method || 'GET').toUpperCase(), hit.rest, url, Object.assign({}, options, { base: hit.base }));
  const send = options.send || ((status, body) => writeJson(res, status, body));
  send(result.status, result.body);
  return true;
}

module.exports = {
  BASE,
  INTERFACES,
  INSTRUCTIONS,
  catalog,
  dispatch,
  verify,
  handle
};
