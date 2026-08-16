'use strict';

/**
 * Known Star Citizen starmap locations — wiki + unpacked Data.p4k dump
 * (data/locations/catalog.json), with Game.log QT aliases (rs_ext_cru-leo1).
 * Refresh: `npm run refresh:locations` (optional `--unpacked=starmap.json` from unp4k).
 */

const fs = require('fs');
const path = require('path');

const CATALOG_PATH = path.join(__dirname, '..', 'data', 'locations', 'catalog.json');
const NONE_SLUG = '__none__';

/** @type {{ locations: object[], systems: object[], bySlug: Map, loadedAt: number }|null} */
let _cache = null;

function slugify (value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isClearedSlug (slug) {
  if (slug === undefined || slug === null) return false;
  const s = String(slug).trim().toLowerCase();
  return s === NONE_SLUG || s === 'none' || s === 'clear';
}

/**
 * Game.log QT tokens → lookup keys.
 * rs_ext_cru-leo1 → cru-l1 / cru_l1 / CRU-L1
 * @param {string} token
 * @returns {string[]}
 */
function aliasesFromLogToken (token) {
  const raw = String(token || '').trim();
  if (!raw) return [];
  const out = new Set();
  out.add(raw);
  out.add(raw.toLowerCase());
  out.add(slugify(raw));
  const ext = raw.match(/^rs_ext_([a-z0-9]+)-leo(\d+)$/i) ||
    raw.match(/^rs_ext_([a-z0-9]+)_leo(\d+)$/i);
  if (ext) {
    const code = ext[1].toLowerCase();
    const n = ext[2];
    out.add(`${code}-l${n}`);
    out.add(`${code}_l${n}`);
    out.add(`${code} l${n}`);
    out.add(`${code.toUpperCase()}-L${n}`);
    out.add(`${code.toUpperCase()}_L${n}`);
  }
  return [...out].filter(Boolean);
}

function aliasesFromTag (tag) {
  const raw = String(tag || '').trim();
  if (!raw) return [];
  const out = new Set();
  const compact = raw.replace(/[\s-]+/g, '_');
  out.add(raw.toLowerCase());
  out.add(slugify(raw));
  out.add(compact.toLowerCase());
  const m = compact.match(/^([A-Za-z]{2,5})_L(\d+)$/i);
  if (m) {
    const code = m[1].toLowerCase();
    const n = m[2];
    out.add(`${code}-l${n}`);
    out.add(`rs_ext_${code}-leo${n}`);
  }
  return [...out].filter(Boolean);
}

function typeRank (type) {
  const t = String(type || '');
  if (/Manmade/i.test(t)) return 4;
  if (/LandingZone|Planet|Moon|Star/i.test(t)) return 3;
  if (/Outpost|PointOfInterest/i.test(t)) return 2;
  if (/Asteroid_ValidQT/i.test(t)) return 1;
  return 0;
}

function preferLocation (a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.quantum !== b.quantum) return a.quantum ? a : b;
  if (a.hideInStarmap !== b.hideInStarmap) return a.hideInStarmap ? b : a;
  const ra = typeRank(a.type);
  const rb = typeRank(b.type);
  if (ra !== rb) return ra > rb ? a : b;
  return a;
}

function indexKey (map, key, entry) {
  const k = String(key || '').toLowerCase();
  if (!k) return;
  map.set(k, preferLocation(map.get(k), entry));
}

function loadCatalog (opts = {}) {
  if (_cache && !opts.reload) return _cache;
  let locations = [];
  let systems = [];
  try {
    const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    locations = Array.isArray(raw.locations) ? raw.locations : [];
    systems = Array.isArray(raw.systems) ? raw.systems : [];
  } catch (_) {
    locations = [];
    systems = [];
  }
  const bySlug = new Map();
  for (const loc of locations) {
    if (!loc || !loc.slug) continue;
    const entry = {
      slug: String(loc.slug),
      name: String(loc.name || loc.slug).split('\n')[0].trim(),
      type: loc.type ? String(loc.type) : null,
      classification: loc.classification ? String(loc.classification) : null,
      system: loc.system ? String(loc.system) : null,
      parent: loc.parent ? String(loc.parent) : null,
      star: loc.star ? String(loc.star) : null,
      tag: loc.tag ? String(loc.tag) : null,
      designation: loc.designation ? String(loc.designation) : null,
      quantum: loc.quantum === true,
      hotspot: loc.hotspot === true,
      hideInStarmap: loc.hideInStarmap === true,
      aliases: Array.isArray(loc.aliases) ? loc.aliases.map(String) : []
    };
    indexKey(bySlug, entry.slug, entry);
    for (const a of entry.aliases) indexKey(bySlug, a, entry);
    for (const extra of aliasesFromTag(entry.tag)) indexKey(bySlug, extra, entry);
  }
  _cache = {
    locations: [...new Map([...bySlug.values()].map((l) => [l.slug, l])).values()]
      .sort((a, b) => a.name.localeCompare(b.name)),
    systems,
    bySlug,
    loadedAt: Date.now()
  };
  return _cache;
}

function listLocations () {
  return loadCatalog().locations.slice();
}

function listSystems () {
  return loadCatalog().systems.slice();
}

function getSystem (codeOrName) {
  const key = String(codeOrName || '').trim().toLowerCase().replace(/\s+system$/i, '');
  if (!key) return null;
  for (const s of loadCatalog().systems) {
    if (String(s.code || '').toLowerCase() === key) return s;
    if (String(s.name || '').toLowerCase() === key) return s;
  }
  return null;
}

/**
 * Resolve a catalog entry by slug, alias, name, tag, or Game.log QT token.
 * @param {string} slugOrName
 * @returns {object|null}
 */
function resolveLocation (slugOrName) {
  const cat = loadCatalog();
  const key = String(slugOrName || '').trim();
  if (!key) return null;
  const candidates = aliasesFromLogToken(key);
  for (const c of candidates) {
    const hit = cat.bySlug.get(c.toLowerCase());
    if (hit) return Object.assign({}, hit);
  }
  const asSlug = slugify(key);
  if (asSlug && cat.bySlug.has(asSlug)) return Object.assign({}, cat.bySlug.get(asSlug));
  const lower = key.toLowerCase();
  for (const loc of cat.locations) {
    if (loc.name.toLowerCase() === lower) return Object.assign({}, loc);
  }
  return null;
}

function searchLocations (query, opts = {}) {
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 40));
  const q = String(query || '').trim().toLowerCase();
  const all = loadCatalog().locations.filter((l) => {
    if (opts.quantum === true && !l.quantum && !l.hotspot) return false;
    if (opts.hotspot === true && !l.hotspot) return false;
    if (opts.system) {
      const sys = String(opts.system).toLowerCase().replace(/\s+system$/i, '');
      if (String(l.system || '').toLowerCase() !== sys) return false;
    }
    return true;
  });
  if (!q) return all.slice(0, limit);
  const scored = [];
  for (const loc of all) {
    const hay = [
      loc.slug,
      loc.name,
      loc.system,
      loc.parent,
      loc.tag,
      loc.type,
      ...(loc.aliases || [])
    ].filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(q)) continue;
    let score = 0;
    if (loc.slug === q || loc.name.toLowerCase() === q) score += 100;
    else if (loc.slug.startsWith(q) || loc.name.toLowerCase().startsWith(q)) score += 50;
    else if (hay.includes(q)) score += 10;
    if (loc.quantum) score += 2;
    if (loc.hotspot) score += 1;
    scored.push({ score, loc });
  }
  scored.sort((a, b) => b.score - a.score || a.loc.name.localeCompare(b.loc.name));
  return scored.slice(0, limit).map((x) => Object.assign({}, x.loc));
}

function catalogStatus () {
  const cat = loadCatalog();
  return {
    type: 'GoonCitizenLocationCatalog',
    count: cat.locations.length,
    systems: cat.systems.length,
    path: 'data/locations/catalog.json',
    loadedAt: new Date(cat.loadedAt).toISOString()
  };
}

/**
 * Compact published location for PeerPresence.
 * @param {object|null} known
 */
function catalogLocationMeta (known) {
  if (!known) return {};
  return {
    type: known.type || null,
    system: known.system || null,
    parent: known.parent || null,
    hotspot: known.hotspot === true
  };
}

function displayName (slugOrName) {
  const hit = resolveLocation(slugOrName);
  if (hit) return hit.name;
  const raw = String(slugOrName || '').trim();
  return raw || null;
}

module.exports = {
  CATALOG_PATH,
  NONE_SLUG,
  slugify,
  isClearedSlug,
  aliasesFromLogToken,
  aliasesFromTag,
  loadCatalog,
  listLocations,
  listSystems,
  getSystem,
  resolveLocation,
  searchLocations,
  catalogStatus,
  catalogLocationMeta,
  displayName
};
