'use strict';

/**
 * Linked signers HTTP client (`/services/star-citizen/delegation`).
 * Browsers send their Passport session cookie; a native client passes its
 * Bearer token as `authToken`.
 */

const BASE = '/services/star-citizen/delegation';

function _origin (origin) {
  const href = origin || (typeof window !== 'undefined' && window.location && window.location.origin) || '';
  return String(href).replace(/\/$/, '');
}

async function _call (origin, path, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!fetchImpl) return { ok: false, error: 'fetch unavailable' };
  const headers = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.authToken) headers.Authorization = 'Bearer ' + opts.authToken;
  try {
    const res = await fetchImpl(_origin(origin) + BASE + path, {
      method: opts.body !== undefined ? 'POST' : 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body || {}) : undefined,
      cache: 'no-store'
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        unauthorized: res.status === 401,
        locked: !!(json && json.locked),
        error: (json && json.error) || ('HTTP ' + res.status)
      };
    }
    return { ok: true, status: res.status, data: json && json.data !== undefined ? json.data : json };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

const enc = encodeURIComponent;

module.exports = {
  fetchLinkedSigners: (origin, opts) => _call(origin, '', opts),
  inviteSigner: (origin, hub, opts = {}) => _call(origin, '/invitations', Object.assign({}, opts, { body: { hub } })),
  acceptInvitation: (origin, invitation, opts = {}) => _call(origin, '/invitations/accept', Object.assign({}, opts, { body: { invitation } })),
  confirmPairing: (origin, scopes, opts = {}) => _call(origin, '/pairing/confirm', Object.assign({}, opts, { body: { scopes } })),
  cancelPairing: (origin, opts = {}) => _call(origin, '/pairing/cancel', Object.assign({}, opts, { body: {} })),
  answerRequest: (origin, hash, action, opts = {}) => _call(origin, `/requests/${enc(hash)}/${action === 'sign' ? 'sign' : 'decline'}`, Object.assign({}, opts, { body: {} })),
  revokeGrant: (origin, hash, opts = {}) => _call(origin, `/grants/${enc(hash)}/revoke`, Object.assign({}, opts, { body: {} })),
  unlinkSigner: (origin, pubkey, opts = {}) => _call(origin, `/signers/${enc(pubkey)}/unlink`, Object.assign({}, opts, { body: {} }))
};
