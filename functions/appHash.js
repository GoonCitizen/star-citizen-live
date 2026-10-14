'use strict';

/**
 * Parse the dashboard location hash into path + query params.
 * Supports `#fleet?id=…` and `#groups?id=…&tab=fleets`.
 * @param {string} [rawHash] Defaults to `window.location.hash` in the browser.
 * @returns {{ path: string, query: Object.<string, string> }}
 */
function readAppHash (rawHash) {
  let raw = rawHash;
  if (raw == null && typeof window !== 'undefined') {
    raw = window.location.hash;
  }
  raw = String(raw || '').replace(/^#/, '');
  const qIdx = raw.indexOf('?');
  let path = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
  if (path === 'fleets') path = 'fleet'; // legacy alias from Group → Fleet Open
  /** @type {Object.<string, string>} */
  const query = {};
  if (qIdx >= 0) {
    const sp = new URLSearchParams(raw.slice(qIdx + 1));
    sp.forEach((value, key) => {
      query[key] = value;
    });
  }
  return { path, query };
}

/**
 * Set `window.location.hash` to `path` with optional query params.
 * @param {string} path Tab path (`fleet`, `groups`, …)
 * @param {Object.<string, string|number|null|undefined>} [query]
 */
function setAppHash (path, query = {}) {
  if (typeof window === 'undefined') return;
  const sp = new URLSearchParams();
  Object.keys(query || {}).forEach((key) => {
    const value = query[key];
    if (value == null || value === '') return;
    sp.set(key, String(value));
  });
  const qs = sp.toString();
  const next = qs ? `${path}?${qs}` : String(path || '');
  if (window.location.hash.replace(/^#/, '') === next) return;
  window.location.hash = next;
}

module.exports = {
  readAppHash,
  setAppHash
};
