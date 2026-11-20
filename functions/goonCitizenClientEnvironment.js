'use strict';

/**
 * Classify whether this origin is a live LiveRelay HTTP API or only static/CDN
 * assets, and whether the browser is signed in (Passport session cookie) or
 * runs inside the unlocked Electron app.
 *
 * Do **not** use GET /settings alone: on SC_MODE=server that path is unmounted
 * (404) even when LiveRelay is healthy. Prefer GET /services/peering or ships.
 */

const GC_UI_RUNTIME_LIVE = 'liveRelay';
const GC_UI_RUNTIME_STATIC = 'static';

/**
 * @param {string} [text]
 * @returns {boolean}
 */
function looksLikeHtmlDocument (text) {
  const s = String(text || '').trim();
  if (!s) return false;
  return s.charAt(0) === '<' || /^<!doctype/i.test(s);
}

/**
 * True for LiveRelay / Hub-shaped peering JSON.
 * @param {object|null|undefined} value
 * @returns {boolean}
 */
function isLiveRelayPeeringJson (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.kind === 'PeeringCapability' || value['@type'] === 'OracleAttestation') return true;
  if (value.claim && typeof value.claim === 'object' && value.claim.kind === 'PeeringCapability') return true;
  if (value.endpoints && typeof value.endpoints === 'object') {
    if (value.endpoints.starCitizen || value.endpoints.sessions) return true;
  }
  if (value.hub && typeof value.hub === 'object') return true;
  return false;
}

/**
 * Public ships catalog (unauthenticated on hosted).
 * @param {object|null|undefined} value
 * @returns {boolean}
 */
function isLiveRelayShipsJson (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Array.isArray(value.data) || Array.isArray(value.ships)) return true;
  if (value.success === true && (value.data != null || value.type === 'Collection')) return true;
  return false;
}

/**
 * @param {object} [probe]
 * @param {number} [probe.status]
 * @param {string} [probe.contentType]
 * @param {string} [probe.bodyText]
 * @param {object|null} [probe.json]
 * @param {string} [probe.error]
 * @returns {{ runtime: string, reason: string }}
 */
function classifyLiveRelayProbe (probe = {}) {
  const status = Number(probe.status) || 0;
  const contentType = String(probe.contentType || '').toLowerCase();
  const bodyText = probe.bodyText != null ? String(probe.bodyText) : '';
  let json = probe.json && typeof probe.json === 'object' && !Array.isArray(probe.json) ? probe.json : null;

  if (!json && bodyText && !looksLikeHtmlDocument(bodyText)) {
    try {
      const parsed = JSON.parse(bodyText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) json = parsed;
    } catch (_) { /* not JSON */ }
  }

  if (looksLikeHtmlDocument(bodyText) || contentType.includes('text/html')) {
    return { runtime: GC_UI_RUNTIME_STATIC, reason: 'html' };
  }

  if (json && json.protection && json.error) {
    return { runtime: GC_UI_RUNTIME_STATIC, reason: 'cdn-protection' };
  }

  if (json && (json.error === 'hub-unreachable' || json.error === 'Not found')) {
    // /settings Not found on hosted is not decisive; peering/ships use other paths.
    if (status === 404 && !isLiveRelayPeeringJson(json) && !isLiveRelayShipsJson(json)) {
      return { runtime: GC_UI_RUNTIME_STATIC, reason: 'http-404' };
    }
  }

  if (status === 502 || status === 503 || status === 504) {
    return { runtime: GC_UI_RUNTIME_STATIC, reason: 'unreachable' };
  }

  if (json && (isLiveRelayPeeringJson(json) || isLiveRelayShipsJson(json))) {
    return { runtime: GC_UI_RUNTIME_LIVE, reason: 'api-json' };
  }

  if (!status && probe.error) {
    return { runtime: GC_UI_RUNTIME_STATIC, reason: 'unreachable' };
  }

  if (status === 401) {
    // Session-gated JSON still means LiveRelay is present.
    return { runtime: GC_UI_RUNTIME_LIVE, reason: 'http-401' };
  }

  if (status === 404) {
    return { runtime: GC_UI_RUNTIME_STATIC, reason: 'http-404' };
  }

  if (status >= 200 && status < 300 && json) {
    return { runtime: GC_UI_RUNTIME_LIVE, reason: 'json-ok' };
  }

  if (status >= 200 && status < 300) {
    return { runtime: GC_UI_RUNTIME_STATIC, reason: 'not-relay-json' };
  }

  return { runtime: GC_UI_RUNTIME_STATIC, reason: status ? `http-${status}` : 'unknown' };
}

/**
 * The Passport session this browser holds on `base` (`GET /sessions/current`,
 * sent with the HttpOnly `fabric.session` cookie), or null.
 * @param {Function} [fetchImpl]
 * @param {string} [base] Origin prefix (default same origin).
 * @returns {Promise<object|null>} `{ identity: { id, pubkey }, network, signer, origin, expiresAt, … }`
 */
async function fetchSiteSession (fetchImpl, base = '') {
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) return null;
  try {
    const res = await f(String(base || '').replace(/\/$/, '') + '/sessions/current', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin'
    });
    if (!res || !res.ok) return null;
    const json = await res.json();
    const session = json && json.session;
    return session && session.identity && typeof session.identity.pubkey === 'string' ? session : null;
  } catch (_) {
    return null;
  }
}

/**
 * End this browser's Passport session (`DELETE /sessions/current`).
 * @param {Function} [fetchImpl]
 * @param {string} [base]
 * @returns {Promise<boolean>}
 */
async function endSiteSession (fetchImpl, base = '') {
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) return false;
  try {
    const res = await f(String(base || '').replace(/\/$/, '') + '/sessions/current', {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin'
    });
    return !!(res && res.ok);
  } catch (_) {
    return false;
  }
}

/**
 * Who this page acts as: the app's unlocked identity (desktop / Android, where
 * loopback requests need no session), else this browser's Passport session.
 * @param {Function} [fetchImpl]
 * @returns {Promise<{ pubkey: string, source: 'app'|'passport', session?: object }|null>}
 */
async function currentViewer (fetchImpl) {
  const bridge = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.identity;
  if (bridge && typeof bridge.get === 'function') {
    try {
      const info = await bridge.get();
      return info && info.unlocked && info.pubkey ? { pubkey: info.pubkey, source: 'app' } : null;
    } catch (_) {
      return null;
    }
  }
  const session = await fetchSiteSession(fetchImpl);
  return session ? { pubkey: session.identity.pubkey, source: 'passport', session } : null;
}

/**
 * @param {{ runtime?: string, auth?: { electronUnlocked?: boolean, siteSession?: object|null } }} args
 * @returns {boolean} True when chrome should treat the user as an anonymous visitor on a live API.
 */
function isGoonCitizenVisitor ({ runtime, auth } = {}) {
  if (runtime === GC_UI_RUNTIME_STATIC) return false;
  const a = auth || {};
  if (a.electronUnlocked) return false;
  if (a.siteSession && a.siteSession.identity && a.siteSession.identity.pubkey) return false;
  return true;
}

module.exports = {
  GC_UI_RUNTIME_LIVE,
  GC_UI_RUNTIME_STATIC,
  looksLikeHtmlDocument,
  isLiveRelayPeeringJson,
  isLiveRelayShipsJson,
  classifyLiveRelayProbe,
  fetchSiteSession,
  endSiteSession,
  currentViewer,
  isGoonCitizenVisitor
};
