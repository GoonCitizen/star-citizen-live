'use strict';

/**
 * Passport v2 sign-in as a native client (GoonCitizen desktop / Android) to a
 * relay that mounts `@fabric/http` `passportHttp` (`relay.goon.vc`, any
 * LiveRelay, a Hub): ask `POST /sessions/challenges` with `X-Fabric-Native: 1`
 * and no `Origin`, check the challenge names the origin we asked, sign a
 * `PASSPORT_ASSERTION` (signer `gooncitizen`) with the identity key of the
 * current account on the challenge's network, and post it to `POST /sessions`
 * with the binding secret in `X-Fabric-Binding`. The relay answers with a
 * Bearer token, kept by the caller in memory only.
 *
 * A WebView `fetch` adds an `Origin` header, which makes the relay treat the
 * request as a browser's; Android passes a native HTTP `fetchImpl` instead.
 *
 * {@link signInToRelayPeer} signs in to the relay *by its key* instead
 * (Passport v3 peer session over HTTP, `POST /sessions/peer`): no pinned
 * origin and no token. The caller keeps the returned session in memory and
 * signs each request with it (`authorize` gives the `X-Fabric-Request`).
 */

const { normalizeOrigin, readChallenge, signAssertion } = require('@fabric/core/functions/passport');
const { accountFromIdentity } = require('./identity');

/** `@fabric/http` peer-session client, when the installed version has it. */
let peerClient = null;
try {
  peerClient = require('@fabric/http/functions/passportPeerClient');
} catch (_) {
  peerClient = null;
}

const NATIVE_HEADER = 'X-Fabric-Native';
const BINDING_HEADER = 'X-Fabric-Binding';

/** @private */
async function postJson (fetchImpl, url, body, headers) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        Accept: 'application/json',
        [NATIVE_HEADER]: '1'
      }, headers || {}),
      body: JSON.stringify(body || {}),
      cache: 'no-store'
    });
  } catch (e) {
    return { ok: false, status: 0, json: { error: (e && e.message) ? String(e.message) : 'fetch failed' } };
  }
  const json = await res.json().catch(() => ({}));
  return { ok: !!res.ok, status: res.status, json: json || {} };
}

/**
 * Sign in to a relay with the unlocked identity.
 * @param {object} identity Decrypted identity (xprv / mnemonic; optional `account`, `network`).
 * @param {string} relayOrigin `https://relay.goon.vc`, `http://127.0.0.1:3041`, …
 * @param {Object} [opts]
 * @param {Function} [opts.fetchImpl] Native HTTP fetch (no `Origin` header).
 * @param {string} [opts.purpose]
 * @returns {Promise<{ ok: true, token: string, session: object } | { ok: false, error: string, status?: number }>}
 */
async function signInToRelay (identity, relayOrigin, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, error: 'fetch is not available' };
  if (!identity) return { ok: false, error: 'Identity is locked — unlock before signing in.' };
  const origin = normalizeOrigin(String(relayOrigin || ''));
  if (!origin) return { ok: false, error: 'relay origin must be http(s)' };

  const issued = await postJson(fetchImpl, `${origin}/sessions/challenges`, {
    origin,
    purpose: opts.purpose
  });
  if (!issued.ok || typeof issued.json.challenge !== 'string' || typeof issued.json.binding !== 'string') {
    return { ok: false, status: issued.status, error: issued.json.error || `challenge refused (HTTP ${issued.status})` };
  }
  const read = readChallenge(issued.json.challenge);
  if (!read.ok) return { ok: false, error: read.error };
  if (read.challenge.origin !== origin) return { ok: false, error: 'the relay issued a challenge for another origin' };

  let signed;
  try {
    const network = read.challenge.network || identity.network;
    const account = accountFromIdentity(identity, { network });
    signed = signAssertion({
      challenge: issued.json.challenge,
      origin,
      signer: 'gooncitizen',
      network: account.network
    }, account.identity.key);
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message) : 'could not sign the challenge' };
  }

  const done = await postJson(fetchImpl, `${origin}/sessions`, { assertion: signed.uri }, {
    [BINDING_HEADER]: issued.json.binding
  });
  if (!done.ok || typeof done.json.token !== 'string') {
    return { ok: false, status: done.status, error: done.json.error || `sign-in refused (HTTP ${done.status})` };
  }
  return { ok: true, token: done.json.token, session: done.json.session || null };
}

/**
 * Sign in to a relay by its key with the unlocked identity (peer session over
 * HTTP). The relay's key is checked against `opts.peer` when given; otherwise
 * it is learned from the relay's signed challenge and returned as `peer` for
 * the caller to remember.
 * @param {object} identity Decrypted identity (xprv / mnemonic; optional `account`, `network`).
 * @param {string} relayOrigin `https://relay.goon.vc`, `http://127.0.0.1:3041`, …
 * @param {Object} [opts]
 * @param {Function} [opts.fetchImpl] Native HTTP fetch.
 * @param {string} [opts.peer] The relay's identity pubkey, when known.
 * @returns {Promise<{ ok: true, session: object, peer: string, view: object } | { ok: false, error: string }>}
 */
async function signInToRelayPeer (identity, relayOrigin, opts = {}) {
  if (!peerClient || typeof peerClient.httpTransport !== 'function') return { ok: false, error: 'peer sign-in needs a newer @fabric/http' };
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, error: 'fetch is not available' };
  if (!identity) return { ok: false, error: 'Identity is locked — unlock before signing in.' };
  const origin = normalizeOrigin(String(relayOrigin || ''));
  if (!origin) return { ok: false, error: 'relay origin must be http(s)' };
  try {
    const session = await peerClient.openPeerSession({
      transport: peerClient.httpTransport(origin, { fetch: fetchImpl }),
      peer: opts.peer,
      sign: async ({ challenge, read, sessionKey }) => {
        const network = read.challenge.network || identity.network;
        const account = accountFromIdentity(identity, { network });
        return signAssertion({
          challenge,
          peer: read.challenge.peer,
          sessionKey,
          signer: 'gooncitizen',
          network: account.network
        }, account.identity.key).message.toBuffer();
      }
    });
    const view = {
      sessionId: session.sessionId,
      peer: session.peer,
      identity: session.identity,
      expiresAt: session.expiresAt
    };
    return { ok: true, session, peer: session.peer, view };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message) : 'peer sign-in failed' };
  }
}

module.exports = {
  NATIVE_HEADER,
  BINDING_HEADER,
  signInToRelay,
  signInToRelayPeer
};
