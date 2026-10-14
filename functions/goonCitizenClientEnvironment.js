'use strict';

/**
 * Classify whether this origin is a live LiveRelay HTTP API or only static/CDN
 * assets, and whether the browser has a hosted site-login or Electron identity.
 *
 * Do **not** use GET /settings alone: on SC_MODE=server that path is unmounted
 * (404) even when LiveRelay is healthy. Prefer GET /services/peering or ships.
 */

const GC_UI_RUNTIME_LIVE = 'liveRelay';
const GC_UI_RUNTIME_STATIC = 'static';

const SITE_SESSION_KEY = 'fabric.identity.session';
const DELEGATION_KEY = 'fabric.delegation';

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
 * Bearer token from SiteLogin localStorage (delegation preferred).
 * @param {Storage|null|undefined} [storage]
 * @returns {string|null}
 */
function readStoredSiteLoginToken (storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store || typeof store.getItem !== 'function') return null;
  try {
    const delRaw = store.getItem(DELEGATION_KEY);
    if (delRaw) {
      const del = JSON.parse(delRaw);
      const t = del && (del.token || del.delegationToken);
      if (t && String(t).trim()) return String(t).trim();
    }
  } catch (_) { /* ignore */ }
  try {
    const sessRaw = store.getItem(SITE_SESSION_KEY);
    if (sessRaw) {
      const sess = JSON.parse(sessRaw);
      const t = sess && (sess.delegationToken || sess.token);
      if (t && String(t).trim()) return String(t).trim();
    }
  } catch (_) { /* ignore */ }
  return null;
}

/**
 * @param {Storage|null|undefined} [storage]
 * @returns {object|null}
 */
function readStoredSiteLoginSession (storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store || typeof store.getItem !== 'function') return null;
  try {
    const raw = store.getItem(SITE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.identity) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

/**
 * @param {{ runtime?: string, auth?: { electronUnlocked?: boolean, siteToken?: string|null, siteSession?: object|null } }} args
 * @returns {boolean} True when chrome should treat the user as an anonymous visitor on a live API.
 */
function isGoonCitizenVisitor ({ runtime, auth } = {}) {
  if (runtime === GC_UI_RUNTIME_STATIC) return false;
  const a = auth || {};
  if (a.electronUnlocked) return false;
  if (a.siteToken && String(a.siteToken).trim()) return false;
  if (a.siteSession && (a.siteSession.delegationToken || a.siteSession.identity)) return false;
  return true;
}

module.exports = {
  GC_UI_RUNTIME_LIVE,
  GC_UI_RUNTIME_STATIC,
  SITE_SESSION_KEY,
  DELEGATION_KEY,
  looksLikeHtmlDocument,
  isLiveRelayPeeringJson,
  isLiveRelayShipsJson,
  classifyLiveRelayProbe,
  readStoredSiteLoginToken,
  readStoredSiteLoginSession,
  isGoonCitizenVisitor
};
