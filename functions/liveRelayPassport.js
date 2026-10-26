'use strict';

/**
 * Passport v2 sign-in on LiveRelay (`@fabric/http` `passportRelyingParty` +
 * `passportHttp`): `POST /sessions/challenges`, `POST /sessions`, and
 * `GET|DELETE /sessions/current`.
 *
 * Challenges are issued only for pinned origins: loopback on the relay's HTTP
 * port, `https://<FABRIC_PUBLIC_HOST>` (the relay's advertised host), and
 * `settings.passport.origins`. Browsers get an HttpOnly `fabric.session`
 * cookie; native clients (GoonCitizen desktop / Android, `X-Fabric-Native: 1`)
 * get a Bearer token. Sessions live in memory, so a restart signs everyone out.
 *
 * A cookie session counts for a write only when the request's `Origin` is the
 * origin the session was issued for: sibling pages on the same site (another
 * loopback port, another `*.goon.vc` host) send the cookie too.
 */

const {
  createPassportRelyingParty
} = require('@fabric/http/functions/passportRelyingParty');
const {
  createPassportHttp,
  bearerToken
} = require('@fabric/http/functions/passportHttp');
const { normalizeOrigin } = require('@fabric/core/functions/passport');
const { fabricIdentityNetwork } = require('./identity');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const RELAY_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * `https://host` for an advertised host (`relay.goon.vc`, `relay.goon.vc:443`,
 * or a full URL), else null.
 * @param {string} host
 * @returns {string|null}
 */
function publicOriginOf (host) {
  const raw = String(host || '').trim();
  if (!raw) return null;
  try {
    return normalizeOrigin(raw.includes('://') ? raw : `https://${raw}`);
  } catch (_) {
    return null;
  }
}

/**
 * Origins the relay answers sign-ins for.
 * @param {object} relay LiveRelay
 * @param {number} port HTTP port
 * @returns {string[]}
 */
function relayPinnedOrigins (relay, port) {
  const out = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`
  ]);
  const advertised = publicOriginOf(relay._fabricAdvertiseHost);
  if (advertised) out.add(advertised);
  const cfg = (relay.settings && relay.settings.passport) || {};
  for (const raw of Array.isArray(cfg.origins) ? cfg.origins : []) {
    const origin = publicOriginOf(raw);
    if (origin) out.add(origin);
  }
  return [...out];
}

/**
 * Network named in the relay's challenges: `settings.passport.network`, else
 * the network the relay's own identity is derived for.
 * @param {object} relay
 * @returns {string}
 */
function relayPassportNetwork (relay) {
  const cfg = (relay.settings && relay.settings.passport) || {};
  if (cfg.network) return fabricIdentityNetwork({ network: cfg.network });
  const own = relay._identity && relay._identity.network;
  return fabricIdentityNetwork({ network: own });
}

/**
 * Build the relay's Passport routes for the port it listens on.
 * @param {object} relay LiveRelay
 * @param {object} [opts]
 * @param {number} [opts.port]
 * @param {Function} [opts.now]
 * @returns {{ relyingParty: object, http: object, pinnedOrigins: string[], network: string, handle: function(object, object, string): (Promise<boolean>), requestSession: function(object): Promise<(object|null)> }}
 */
function createLiveRelayPassport (relay, opts = {}) {
  const port = Number(opts.port || (relay.settings && relay.settings.port) || 3041);
  const pinnedOrigins = relayPinnedOrigins(relay, port);
  const network = relayPassportNetwork(relay);
  const relyingParty = createPassportRelyingParty({
    pinnedOrigins,
    production: relay.settings && relay.settings.mode === 'server',
    network,
    purpose: 'Sign in to GoonCitizen',
    sessionTtlMs: RELAY_SESSION_TTL_MS,
    now: opts.now
  });
  const http = createPassportHttp({ relyingParty });
  const routes = new Map(http.routes.map((r) => [`${r.method} ${r.path}`, r.handler]));

  /**
   * Answer a Passport route. Resolves true when it did.
   * @param {object} req
   * @param {object} res
   * @param {string} pathname
   * @returns {Promise<boolean>}
   */
  async function handle (req, res, pathname) {
    const handler = routes.get(`${String(req.method || 'GET').toUpperCase()} ${pathname}`);
    if (!handler) return false;
    await handler(req, res);
    return true;
  }

  /**
   * The session this request carries, or null. A cookie session counts for
   * a write only from the origin it was issued for.
   * @param {object} req
   * @returns {Promise<object|null>}
   */
  async function requestSession (req) {
    let session = null;
    try {
      session = await http.readRequestSession(req);
    } catch (_) {
      return null;
    }
    if (!session) return null;
    if (bearerToken(req)) return session;
    if (SAFE_METHODS.has(String(req.method || 'GET').toUpperCase())) return session;
    const origin = normalizeOrigin(String((req.headers && req.headers.origin) || ''));
    return origin && origin === session.origin ? session : null;
  }

  return { relyingParty, http, pinnedOrigins, network, handle, requestSession };
}

module.exports = {
  createLiveRelayPassport,
  publicOriginOf,
  relayPinnedOrigins,
  relayPassportNetwork
};
