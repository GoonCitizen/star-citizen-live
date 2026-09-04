'use strict';

/**
 * Public RSI (robertsspaceindustries.com) org + citizen lookups.
 *
 * Fetches the same public HTML pages a browser would load for
 * `/orgs/<SID>` and `/citizens/<handle>`, then extracts basic fields.
 * RSI has no documented public API for this; community tools scrape the
 * same pages. Results are cached in-process with a short TTL.
 */

const RSI_ORIGIN = 'https://robertsspaceindustries.com';
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT =
  'Mozilla/5.0 (compatible; GoonCitizen/1.0; +https://goon.vc) AppleWebKit/537.36';

/** Org SID: letters/digits, 1–32 chars (RSI SIDs are typically uppercase). */
const ORG_SID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
/** Citizen handle: letters/digits/underscore/hyphen, 2–32 chars. */
const HANDLE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$/;

const _cache = new Map();

/**
 * @param {*} value
 * @returns {string|null} uppercase SID, or null to clear / reject
 */
function sanitizeOrgSid (value) {
  if (value === undefined || value === null || value === '') return null;
  const sid = String(value).trim().replace(/^\/+|\/+$/g, '');
  if (!ORG_SID_RE.test(sid)) return null;
  return sid.toUpperCase();
}

/**
 * @param {*} value
 * @returns {string|null}
 */
function sanitizeCitizenHandle (value) {
  if (value === undefined || value === null || value === '') return null;
  const handle = String(value).trim().replace(/^\/+|\/+$/g, '');
  if (!HANDLE_RE.test(handle)) return null;
  return handle;
}

/**
 * Group `rsiTag` — same shape as an org SID (stored uppercase).
 * @param {*} value
 * @returns {string|null}
 */
function sanitizeRsiTag (value) {
  return sanitizeOrgSid(value);
}

function orgUrl (sid) {
  const clean = sanitizeOrgSid(sid);
  if (!clean) return null;
  return `${RSI_ORIGIN}/en/orgs/${encodeURIComponent(clean)}`;
}

function citizenUrl (handle) {
  const clean = sanitizeCitizenHandle(handle);
  if (!clean) return null;
  return `${RSI_ORIGIN}/en/citizens/${encodeURIComponent(clean)}`;
}

function absoluteMediaUrl (src) {
  if (!src || typeof src !== 'string') return null;
  const s = src.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('/')) return RSI_ORIGIN + s;
  return RSI_ORIGIN + '/' + s;
}

function decodeEntities (text) {
  if (!text) return text;
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags (html) {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' '));
}

function matchOne (html, re) {
  const m = re.exec(html);
  return m ? decodeEntities(m[1]) : null;
}

/**
 * Parse an RSI organization public profile HTML page.
 * @param {string} html
 * @param {string} [sidHint]
 * @returns {object|null}
 */
function parseOrgHtml (html, sidHint) {
  if (!html || typeof html !== 'string') return null;
  if (/404\s*-\s*Roberts Space Industries/i.test(html) &&
      !/<span class="symbol">/i.test(html)) {
    return null;
  }

  const title = matchOne(html, /<title>\s*([^<]+?)\s*<\/title>/i);
  if (title && /404\s*-/i.test(title) && !/<span class="symbol">/i.test(html)) {
    return null;
  }

  let name = null;
  let sid = sanitizeOrgSid(sidHint);
  const h1 = html.match(/<h1>\s*([^/<]+?)\s*\/\s*<span class="symbol">\s*([^<]+?)\s*<\/span>\s*<\/h1>/i);
  if (h1) {
    name = decodeEntities(h1[1]);
    sid = sanitizeOrgSid(h1[2]) || sid;
  }
  if (!sid && title) {
    const tm = title.match(/\[([A-Za-z0-9_-]+)\]/);
    if (tm) sid = sanitizeOrgSid(tm[1]);
    if (!name) {
      const nm = title.match(/^\s*([^\[]+?)\s*\[/);
      if (nm) name = decodeEntities(nm[1]);
    }
  }
  if (!sid) return null;

  const memberCountRaw = matchOne(html, /<span class="count">\s*([^<]+?)\s*<\/span>/i);
  let memberCount = null;
  if (memberCountRaw) {
    const n = parseInt(String(memberCountRaw).replace(/[^\d]/g, ''), 10);
    if (Number.isFinite(n)) memberCount = n;
  }

  const tags = {};
  const tagsBlock = html.match(/<ul class="tags[^"]*"[^>]*>([\s\S]*?)<\/ul>/i);
  if (tagsBlock) {
    const re = /<li class="([^"]+)">\s*([^<]+?)\s*<\/li>/gi;
    let m;
    while ((m = re.exec(tagsBlock[1]))) {
      tags[m[1].toLowerCase()] = decodeEntities(m[2]);
    }
  }

  const logo = absoluteMediaUrl(
    matchOne(html, /<div class="logo[^"]*"[\s\S]*?<img[^>]+src="([^"]+)"/i)
  );
  const banner = absoluteMediaUrl(
    matchOne(html, /<div class="banner">\s*<img[^>]+src="([^"]+)"/i)
  );

  let description = null;
  const body = html.match(/<div class="body markitup-text">([\s\S]*?)<\/div>/i);
  if (body) {
    description = stripTags(body[1]).slice(0, 2000) || null;
  }

  return {
    kind: 'org',
    sid,
    name: name || sid,
    memberCount,
    memberCountLabel: memberCountRaw || null,
    model: tags.model || null,
    commitment: tags.commitment || null,
    roleplay: tags.roleplay || null,
    language: tags.language || null,
    focus: tags.focus || null,
    exclusive: tags.exclusive || null,
    logoUrl: logo,
    bannerUrl: banner,
    description,
    url: orgUrl(sid),
    source: 'rsi-html'
  };
}

/**
 * Parse an RSI citizen public profile HTML page.
 * @param {string} html
 * @param {string} [handleHint]
 * @returns {object|null}
 */
function parseCitizenHtml (html, handleHint) {
  if (!html || typeof html !== 'string') return null;

  const title = matchOne(html, /<title>\s*([^<]+?)\s*<\/title>/i);
  if (title && /404\s*-/i.test(title)) return null;
  if (!/<span class="label">\s*Handle name\s*<\/span>/i.test(html) &&
      !/<span class="label">\s*UEE Citizen Record\s*<\/span>/i.test(html)) {
    return null;
  }

  function labeledValue (label) {
    const re = new RegExp(
      `<span class="label">\\s*${label}\\s*</span>\\s*<strong class="value">\\s*([\\s\\S]*?)\\s*</strong>`,
      'i'
    );
    const m = html.match(re);
    return m ? stripTags(m[1]) : null;
  }

  const handle = sanitizeCitizenHandle(labeledValue('Handle name')) ||
    sanitizeCitizenHandle(handleHint);
  if (!handle) return null;

  const recordRaw = labeledValue('UEE Citizen Record');
  let citizenRecord = null;
  if (recordRaw) {
    const n = parseInt(String(recordRaw).replace(/[^\d]/g, ''), 10);
    if (Number.isFinite(n)) citizenRecord = n;
  }

  const enlisted = labeledValue('Enlisted');
  const location = labeledValue('Location');
  const fluency = labeledValue('Fluency');

  let displayName = matchOne(
    html,
    /<div class="info">\s*<p class="entry">\s*<strong class="value">\s*([^<]+?)\s*<\/strong>/i
  );
  if (!displayName) displayName = handle;

  let badge = null;
  const badgeM = html.match(
    /<div class="info">[\s\S]*?<p class="entry">[\s\S]*?<span class="value">\s*([^<]+?)\s*<\/span>\s*<\/p>\s*<\/div>/i
  );
  if (badgeM) {
    const v = decodeEntities(badgeM[1]);
    if (v && v !== displayName && v !== handle) badge = v;
  }

  const avatar = absoluteMediaUrl(
    matchOne(html, /<div class="thumb">\s*<img[^>]+src="([^"]+)"/i)
  );

  let website = null;
  const webM = html.match(/<p class="entry website">[\s\S]*?<a[^>]+href="([^"]+)"/i);
  if (webM) website = decodeEntities(webM[1]);

  let bio = null;
  const bioM = html.match(/<div class="entry bio">[\s\S]*?<div class="value">\s*([\s\S]*?)\s*<\/div>/i);
  if (bioM) bio = stripTags(bioM[1]).slice(0, 2000) || null;

  let mainOrgSid = null;
  let mainOrgName = null;
  const orgBlock = html.match(/<div class="main-org[\s\S]*?<div class="info">([\s\S]*?)<\/div>\s*<\/div>/i);
  if (orgBlock) {
    const sidM = orgBlock[1].match(/\/orgs\/([A-Za-z0-9_-]+)/i);
    if (sidM) mainOrgSid = sanitizeOrgSid(sidM[1]);
    const nameM = orgBlock[1].match(/<strong class="value">\s*([^<]+?)\s*<\/strong>/i) ||
      orgBlock[1].match(/<span class="value">\s*([^<]+?)\s*<\/span>/i);
    if (nameM) mainOrgName = decodeEntities(nameM[1]);
  }

  return {
    kind: 'citizen',
    handle,
    displayName,
    citizenRecord,
    citizenRecordLabel: recordRaw || null,
    badge,
    enlisted,
    location,
    fluency,
    website,
    bio,
    avatarUrl: avatar,
    mainOrgSid,
    mainOrgName,
    url: citizenUrl(handle),
    source: 'rsi-html'
  };
}

function cacheGet (key) {
  const hit = _cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    _cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet (key, value, ttlMs) {
  _cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function clearCache () {
  _cache.clear();
}

/**
 * @param {string} url
 * @param {Object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ ok: boolean, status: number, html?: string, error?: string }>}
 */
async function fetchHtml (url, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, status: 0, error: 'fetch unavailable' };
  }
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : FETCH_TIMEOUT_MS;
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': USER_AGENT
      },
      signal: ac ? ac.signal : undefined
    });
    const html = await res.text();
    return { ok: res.ok, status: res.status, html };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: (err && err.name === 'AbortError') ? 'timeout' : ((err && err.message) || 'fetch failed')
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * @param {string} sid
 * @param {Object} [opts]
 * @returns {Promise<{ ok: boolean, status?: number, data?: object, error?: string, cached?: boolean }>}
 */
async function lookupOrg (sid, opts = {}) {
  const clean = sanitizeOrgSid(sid);
  if (!clean) return { ok: false, status: 400, error: 'invalid org SID' };
  const ttlMs = Number(opts.ttlMs) > 0 ? Number(opts.ttlMs) : DEFAULT_TTL_MS;
  const cacheKey = `org:${clean}`;
  if (!opts.bypassCache) {
    const cached = cacheGet(cacheKey);
    if (cached) return { ok: true, status: 200, data: cached, cached: true };
  }
  const url = orgUrl(clean);
  const fetched = await fetchHtml(url, opts);
  if (!fetched.ok) {
    return {
      ok: false,
      status: fetched.status || 502,
      error: fetched.error || `RSI org fetch failed (${fetched.status})`
    };
  }
  const data = parseOrgHtml(fetched.html, clean);
  if (!data) {
    return { ok: false, status: 404, error: 'organization not found' };
  }
  cacheSet(cacheKey, data, ttlMs);
  return { ok: true, status: 200, data, cached: false };
}

/**
 * @param {string} handle
 * @param {Object} [opts]
 * @returns {Promise<{ ok: boolean, status?: number, data?: object, error?: string, cached?: boolean }>}
 */
async function lookupCitizen (handle, opts = {}) {
  const clean = sanitizeCitizenHandle(handle);
  if (!clean) return { ok: false, status: 400, error: 'invalid citizen handle' };
  const ttlMs = Number(opts.ttlMs) > 0 ? Number(opts.ttlMs) : DEFAULT_TTL_MS;
  const cacheKey = `citizen:${clean.toLowerCase()}`;
  if (!opts.bypassCache) {
    const cached = cacheGet(cacheKey);
    if (cached) return { ok: true, status: 200, data: cached, cached: true };
  }
  const url = citizenUrl(clean);
  const fetched = await fetchHtml(url, opts);
  if (!fetched.ok) {
    return {
      ok: false,
      status: fetched.status || 502,
      error: fetched.error || `RSI citizen fetch failed (${fetched.status})`
    };
  }
  const data = parseCitizenHtml(fetched.html, clean);
  if (!data) {
    return { ok: false, status: 404, error: 'citizen not found' };
  }
  cacheSet(cacheKey, data, ttlMs);
  return { ok: true, status: 200, data, cached: false };
}

module.exports = {
  RSI_ORIGIN,
  DEFAULT_TTL_MS,
  sanitizeOrgSid,
  sanitizeCitizenHandle,
  sanitizeRsiTag,
  orgUrl,
  citizenUrl,
  absoluteMediaUrl,
  parseOrgHtml,
  parseCitizenHtml,
  lookupOrg,
  lookupCitizen,
  clearCache
};
