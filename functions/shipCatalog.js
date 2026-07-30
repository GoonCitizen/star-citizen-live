'use strict';

/**
 * Known Star Citizen ships — catalog from Star Citizen Wiki vehicles API
 * (data/ships/catalog.json), with aliases for Starjump / FleetViewer slugs.
 */

const fs = require('fs');
const path = require('path');

const CATALOG_PATH = path.join(__dirname, '..', 'data', 'ships', 'catalog.json');

/** @type {{ ships: object[], bySlug: Map<string, object>, byClass: Map<string, object>, loadedAt: number }|null} */
let _cache = null;

/**
 * @param {string} value
 * @returns {string}
 */
function slugify (value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Load (and cache) the ship catalog from disk.
 * @param {{ reload?: boolean }} [opts]
 */
function loadCatalog (opts = {}) {
  if (_cache && !opts.reload) return _cache;
  let ships = [];
  try {
    const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    ships = Array.isArray(raw.ships) ? raw.ships : [];
  } catch (_) {
    ships = [];
  }
  const bySlug = new Map();
  const byClass = new Map();
  for (const s of ships) {
    if (!s || !s.slug) continue;
    const entry = {
      slug: String(s.slug),
      name: String(s.name || s.slug).split('\n')[0].trim(),
      manufacturer: s.manufacturer ? String(s.manufacturer) : null,
      codes: Array.isArray(s.codes) ? s.codes.slice() : [],
      className: s.className ? String(s.className) : null,
      aliases: Array.isArray(s.aliases) ? s.aliases.map(String) : [],
      type: s.type || null,
      size: s.size || null,
      isSpaceship: s.isSpaceship !== false
    };
    bySlug.set(entry.slug.toLowerCase(), entry);
    for (const a of entry.aliases) {
      const key = String(a).toLowerCase();
      if (key && !bySlug.has(key)) bySlug.set(key, entry);
    }
    if (entry.className) {
      byClass.set(entry.className.toUpperCase(), entry);
      // Also index without trailing instance digits for log matching
      const bare = entry.className.replace(/_\d{6,}$/, '');
      if (bare) byClass.set(bare.toUpperCase(), entry);
    }
  }
  _cache = {
    ships: [...new Map([...bySlug.values()].map((s) => [s.slug, s])).values()]
      .sort((a, b) => a.name.localeCompare(b.name)),
    bySlug,
    byClass,
    loadedAt: Date.now()
  };
  return _cache;
}

/**
 * @returns {object[]}
 */
function listShips () {
  return loadCatalog().ships.slice();
}

/**
 * Resolve a catalog entry by slug, alias, name, or class_name.
 * @param {string} slugOrName
 * @returns {object|null}
 */
function resolveShip (slugOrName) {
  const cat = loadCatalog();
  const key = String(slugOrName || '').trim();
  if (!key) return null;
  const lower = key.toLowerCase();
  if (cat.bySlug.has(lower)) return Object.assign({}, cat.bySlug.get(lower));
  const asSlug = slugify(key);
  if (asSlug && cat.bySlug.has(asSlug)) return Object.assign({}, cat.bySlug.get(asSlug));
  const upper = key.toUpperCase().split('[')[0];
  if (cat.byClass.has(upper)) return Object.assign({}, cat.byClass.get(upper));
  const bare = upper.replace(/_\d{6,}$/, '');
  if (bare && cat.byClass.has(bare)) return Object.assign({}, cat.byClass.get(bare));
  // Longest class_name prefix match (log ids append instance digits / variants)
  let best = null;
  let bestLen = 0;
  for (const [cn, ship] of cat.byClass) {
    if (upper.startsWith(cn + '_') || upper === cn) {
      if (cn.length > bestLen) {
        best = ship;
        bestLen = cn.length;
      }
    }
  }
  if (best) return Object.assign({}, best);
  for (const s of cat.ships) {
    if (s.name.toLowerCase() === lower) return Object.assign({}, s);
  }
  return null;
}

/**
 * Search catalog by keyword (name, slug, manufacturer, hangar code, class).
 * @param {string} query
 * @param {{ limit?: number }} [opts]
 * @returns {object[]}
 */
function searchShips (query, opts = {}) {
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 40));
  const q = String(query || '').trim().toLowerCase();
  const all = loadCatalog().ships;
  if (!q) return all.slice(0, limit);
  const scored = [];
  for (const s of all) {
    const hay = [
      s.slug,
      s.name,
      s.manufacturer,
      s.className,
      ...(s.codes || []),
      ...(s.aliases || [])
    ].filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(q)) continue;
    let score = 0;
    if (s.slug === q || s.name.toLowerCase() === q) score += 100;
    else if (s.slug.startsWith(q) || s.name.toLowerCase().startsWith(q)) score += 50;
    else if (hay.includes(q)) score += 10;
    scored.push({ score, ship: s });
  }
  scored.sort((a, b) => b.score - a.score || a.ship.name.localeCompare(b.ship.name));
  return scored.slice(0, limit).map((x) => Object.assign({}, x.ship));
}

/**
 * Catalog status for APIs.
 */
function catalogStatus () {
  const cat = loadCatalog();
  return {
    type: 'GoonCitizenShipCatalog',
    count: cat.ships.length,
    path: 'data/ships/catalog.json',
    loadedAt: new Date(cat.loadedAt).toISOString()
  };
}

module.exports = {
  CATALOG_PATH,
  slugify,
  loadCatalog,
  listShips,
  resolveShip,
  searchShips,
  catalogStatus
};
