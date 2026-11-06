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
 *
 * Peer sessions (Passport v3, `@fabric/http` `passportPeer`): with an unlocked
 * identity the relay also signs users in by its own key, from any origin, on
 * `GET|POST /sessions/peer`. Each request then carries an `X-Fabric-Request`
 * signed by the session key, bound to its method, path, body, and a one-time
 * nonce, so it needs no cookie and no origin check. An `@fabric/http` without
 * `passportPeer` leaves this off.
 */

const {
  createPassportRelyingParty
} = require('@fabric/http/functions/passportRelyingParty');
const {
  createPassportHttp,
  bearerToken
} = require('@fabric/http/functions/passportHttp');
const { normalizeOrigin } = require('@fabric/core/functions/passport');
const { fabricIdentityNetwork, accountFromIdentity } = require('./identity');

/** `@fabric/http` peer sessions, when the installed version has them. */
let passportPeerModule = null;
try {
  passportPeerModule = require('@fabric/http/functions/passportPeer');
} catch (_) {
  passportPeerModule = null;
}

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
  const loopback = [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`
  ];
  const published = new Set();
  const advertised = publicOriginOf(relay._fabricAdvertiseHost);
  if (advertised) published.add(advertised);
  const cfg = (relay.settings && relay.settings.passport) || {};
  for (const raw of Array.isArray(cfg.origins) ? cfg.origins : []) {
    const origin = publicOriginOf(raw);
    if (origin) published.add(origin);
  }
  // A public relay signs in only on its public origins: a native client may name any pinned
  // origin, and a sign-in a player approved for a page on their own machine must not open
  // a session here.
  const serverMode = relay.settings && relay.settings.mode === 'server';
  if (serverMode && published.size) return [...published];
  return [...new Set([...loopback, ...published])];
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
  const peer = createRelayPassportPeer(relay, { network, homes: pinnedOrigins, now: opts.now });
  if (peer) for (const r of peer.http.routes) routes.set(`${r.method} ${r.path}`, r.handler);

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
    if (peer && req && req.headers && req.headers[passportPeerModule.PASSPORT_REQUEST_HEADER]) {
      try {
        const view = await peer.http.readRequestSession(req);
        return view ? Object.assign({}, view, { pubkey: view.identity.pubkey, identityId: view.identity.id }) : null;
      } catch (_) {
        return null;
      }
    }
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

  return { relyingParty, http, pinnedOrigins, network, handle, requestSession, peer: peer ? peer.passportPeer : null };
}

/**
 * Peer sign-in by the relay's own identity key, or null when the identity is
 * locked or `@fabric/http` has no `passportPeer`.
 * @param {object} relay
 * @param {{ network: string, homes: string[], now: (Function|undefined) }} opts
 * @returns {{ passportPeer: object, http: object }|null}
 */
function createRelayPassportPeer (relay, opts) {
  if (!passportPeerModule || !relay || !relay._identity) return null;
  let key = null;
  try {
    key = accountFromIdentity(relay._identity, { network: opts.network }).identity.key;
  } catch (_) {
    return null;
  }
  const passportPeer = passportPeerModule.createPassportPeer({
    key,
    network: opts.network,
    purpose: 'Sign in to GoonCitizen',
    homes: opts.homes.slice(0, 16),
    sessionTtlMs: RELAY_SESSION_TTL_MS,
    now: opts.now
  });
  return { passportPeer, http: passportPeerModule.createPassportPeerHttp(passportPeer) };
}

/**
 * Pubkey the relay's peer sign-in answers as (its identity), for cache keys.
 * @param {object} relay
 * @returns {string}
 */
function relayPeerKeyId (relay) {
  try {
    return relay && relay._identity ? String(accountFromIdentity(relay._identity).identity.key.pubkey) : '';
  } catch (_) {
    return '';
  }
}

module.exports = {
  createLiveRelayPassport,
  relayPeerKeyId,
  publicOriginOf,
  relayPinnedOrigins,
  relayPassportNetwork
};
