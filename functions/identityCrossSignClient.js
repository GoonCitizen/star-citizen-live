'use strict';

/**
 * POST a signed IdentityCrossSign / IdentityCrossSignRevoke to Hub or LiveRelay.
 * Passport / Hub browser must send a pre-signed body; a local LiveRelay may
 * omit the signature when the node identity is unlocked.
 */

function _bases (origin) {
  const base = String(origin || '').replace(/\/$/, '');
  return [
    `${base}/identity/cross-sign`,
    `${base}/services/star-citizen/identity/cross-sign`
  ];
}

async function postIdentityCrossSign (origin, body, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!fetchImpl) return { ok: false, error: 'fetch unavailable' };
  const payload = body && typeof body === 'object' ? body : {};
  let last = { ok: false, error: 'no origin' };
  for (const url of _bases(origin)) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, status: res.status, data, url };
      last = { ok: false, error: (data && data.error) || `HTTP ${res.status}`, status: res.status, url };
    } catch (e) {
      last = { ok: false, error: e && e.message ? e.message : String(e) };
    }
  }
  return last;
}

async function fetchIdentityCluster (origin, pubkey, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!fetchImpl) return { ok: false, error: 'fetch unavailable' };
  const base = String(origin || '').replace(/\/$/, '');
  const q = pubkey ? ('?pubkey=' + encodeURIComponent(pubkey)) : '';
  const urls = [
    `${base}/identity/cluster${q}`,
    `${base}/services/star-citizen/identity/cluster${q}`
  ];
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, data: data.data || data };
    } catch (_) { /* try next */ }
  }
  return { ok: false, error: 'cluster unavailable' };
}

module.exports = { postIdentityCrossSign, fetchIdentityCluster };
