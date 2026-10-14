'use strict';

/**
 * Node-local location sightings — QT hops, own presence, and peer PeerPresence.
 * Accumulates under the register Store (`locationreports`). Not gossiped.
 */

const locationCatalog = require('./locationCatalog');
const { isFabricPubkey, profileHref } = require('./identityActor');

const TYPE = 'LocationReport';
const COLLECTION = 'locationreports';
const SIGHTINGS_MAX = 80;
const DEDUP_MS = 10 * 60 * 1000;
const HANDLE_MAX = 80;
const ACTOR_MAX = 200;

function nowIso (value) {
  if (value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function compactShip (ship) {
  if (!ship || typeof ship !== 'object') return null;
  if (ship.cleared === true) return null;
  const slug = ship.slug != null ? String(ship.slug).trim() : '';
  const name = ship.name != null ? String(ship.name).trim() : '';
  if (!slug && !name) return null;
  if (locationCatalog.isClearedSlug(slug)) return null;
  return {
    slug: slug || null,
    name: name || slug || null
  };
}

function sanitizeHandle (value) {
  const s = String(value == null ? '' : value).trim().slice(0, HANDLE_MAX);
  return s || null;
}

function sanitizeActor (value) {
  const s = String(value == null ? '' : value).trim().slice(0, ACTOR_MAX);
  return s || null;
}

/**
 * Resolve a place token / presence object onto a catalog slug.
 * @param {*} place
 * @returns {object|null}
 */
function compactPlace (place) {
  if (place == null || place === '') return null;
  if (typeof place === 'object' && place.cleared === true) return null;
  const token = typeof place === 'string'
    ? place
    : (place.slug || place.token || place.name || '');
  const raw = String(token || '').trim();
  if (!raw) return null;
  if (locationCatalog.isClearedSlug(raw)) return null;
  const known = locationCatalog.resolveLocation(raw);
  if (known && known.slug) {
    return {
      slug: known.slug,
      name: known.name,
      system: known.system || null,
      type: known.type || null,
      token: raw
    };
  }
  const slug = locationCatalog.slugify(raw);
  if (!slug || locationCatalog.isClearedSlug(slug)) return null;
  return {
    slug,
    name: (typeof place === 'object' && place.name) ? String(place.name) : raw,
    system: (typeof place === 'object' && place.system) ? String(place.system) : null,
    type: (typeof place === 'object' && place.type) ? String(place.type) : null,
    token: raw
  };
}

function locationHref (slug) {
  const hit = locationCatalog.resolveLocation(slug);
  const id = (hit && hit.slug) || locationCatalog.slugify(slug);
  if (!id) return null;
  return '/locations/' + encodeURIComponent(id);
}

function playerHref (sighting) {
  const actor = sighting && sighting.actor;
  if (!actor) return null;
  if (isFabricPubkey(actor)) return profileHref(actor);
  if (/^discord:/i.test(String(actor))) return profileHref(actor);
  return null;
}

function sanitizeSighting (row) {
  if (!row || typeof row !== 'object') return null;
  const actor = sanitizeActor(row.actor);
  const nickname = sanitizeHandle(row.nickname);
  const handle = sanitizeHandle(row.handle);
  const at = nowIso(row.at);
  const kind = row.kind === 'visit' || row.kind === 'self' || row.kind === 'presence'
    ? row.kind
    : 'presence';
  const role = row.role === 'destination' ? 'destination' : 'location';
  if (!actor && !nickname && !handle) return null;
  return {
    actor,
    nickname,
    handle,
    kind,
    role,
    ship: compactShip(row.ship),
    at,
    href: playerHref({ actor })
  };
}

function uniquePlayerKey (sighting) {
  if (!sighting) return null;
  if (sighting.actor) return String(sighting.actor).toLowerCase();
  if (sighting.handle) return 'handle:' + String(sighting.handle).toLowerCase();
  if (sighting.nickname) return 'nick:' + String(sighting.nickname).toLowerCase();
  return null;
}

function sanitizeRecord (row) {
  if (!row || typeof row !== 'object') return null;
  const slug = String(row.slug || row.id || '').trim();
  if (!slug || locationCatalog.isClearedSlug(slug)) return null;
  const sightings = Array.isArray(row.sightings)
    ? row.sightings.map(sanitizeSighting).filter(Boolean).slice(-SIGHTINGS_MAX)
    : [];
  return {
    '@type': TYPE,
    id: slug,
    slug,
    name: row.name ? String(row.name) : slug,
    system: row.system ? String(row.system) : null,
    type: row.type ? String(row.type) : null,
    updatedAt: row.updatedAt || null,
    sightings
  };
}

function getRecord (store, slug) {
  if (!store || !slug) return null;
  const key = String(slug);
  try {
    return sanitizeRecord(store.get(COLLECTION, key));
  } catch (_) {
    return null;
  }
}

/**
 * Record one sighting (QT / presence) against a catalog location.
 * Dedupes the same actor + slug + role within {@link DEDUP_MS}.
 * @param {object} store
 * @param {object} input
 * @returns {object|null}
 */
function recordSighting (store, input = {}) {
  if (!store) return null;
  const place = compactPlace(input.place || input.slug || input.token || input.name);
  if (!place) return null;
  const sighting = sanitizeSighting({
    actor: input.actor,
    nickname: input.nickname,
    handle: input.handle,
    kind: input.kind,
    role: input.role,
    ship: input.ship,
    at: input.at
  });
  if (!sighting) return null;
  const prev = getRecord(store, place.slug) || {
    '@type': TYPE,
    id: place.slug,
    slug: place.slug,
    name: place.name,
    system: place.system,
    type: place.type,
    updatedAt: null,
    sightings: []
  };
  const playerKey = uniquePlayerKey(sighting);
  const atMs = Date.parse(sighting.at) || Date.now();
  let replaced = false;
  const nextSightings = (prev.sightings || []).map((row) => {
    if (replaced || uniquePlayerKey(row) !== playerKey || row.role !== sighting.role) return row;
    const prevMs = Date.parse(row.at) || 0;
    if (Math.abs(atMs - prevMs) > DEDUP_MS) return row;
    replaced = true;
    return Object.assign({}, row, {
      kind: sighting.kind,
      ship: sighting.ship || row.ship,
      nickname: sighting.nickname || row.nickname,
      handle: sighting.handle || row.handle,
      actor: sighting.actor || row.actor,
      at: sighting.at,
      href: sighting.href || row.href
    });
  });
  if (!replaced) nextSightings.push(sighting);
  const trimmed = nextSightings.slice(-SIGHTINGS_MAX);
  const record = {
    '@type': TYPE,
    id: place.slug,
    slug: place.slug,
    name: place.name || prev.name,
    system: place.system || prev.system,
    type: place.type || prev.type,
    updatedAt: sighting.at,
    sightings: trimmed
  };
  store.put(COLLECTION, place.slug, record);
  return record;
}

/**
 * Fold a PeerPresence document's location + destination into the local store.
 * @param {object} store
 * @param {string} pubkey
 * @param {object} doc
 */
function foldPresence (store, pubkey, doc) {
  if (!store || !doc) return;
  const actor = sanitizeActor(pubkey);
  const nickname = sanitizeHandle(doc.nickname);
  const handle = sanitizeHandle(doc.handle);
  const ship = compactShip(doc.ship);
  const at = doc.updatedAt || doc.lastEventAt || nowIso();
  if (doc.location) {
    recordSighting(store, {
      place: doc.location,
      actor,
      nickname,
      handle,
      ship,
      kind: 'presence',
      role: 'location',
      at: (doc.location && doc.location.at) || at
    });
  }
  if (doc.destination) {
    recordSighting(store, {
      place: doc.destination,
      actor,
      nickname,
      handle,
      ship,
      kind: 'presence',
      role: 'destination',
      at: (doc.destination && doc.destination.at) || at
    });
  }
}

function playerCount (sightings) {
  const keys = new Set();
  for (const row of sightings || []) {
    const k = uniquePlayerKey(row);
    if (k) keys.add(k);
  }
  return keys.size;
}

/**
 * Compact report for one location (recent unique players).
 * @param {object} store
 * @param {string} slug
 * @param {object} [opts]
 * @returns {object}
 */
function summarize (store, slug, opts = {}) {
  const limit = Math.min(80, Math.max(1, Number(opts.limit) || 24));
  const place = compactPlace(slug);
  const rec = place ? getRecord(store, place.slug) : null;
  const sightings = rec ? rec.sightings : [];
  const latest = new Map();
  for (const row of sightings) {
    const key = uniquePlayerKey(row);
    if (!key) continue;
    const prev = latest.get(key);
    if (!prev || String(row.at) > String(prev.at)) latest.set(key, row);
  }
  const recent = Array.from(latest.values())
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, limit);
  const visits = sightings.filter((s) => s.kind === 'visit' || (s.kind === 'self' && s.role === 'location'));
  return {
    slug: (place && place.slug) || String(slug || ''),
    name: (rec && rec.name) || (place && place.name) || slug,
    system: (rec && rec.system) || (place && place.system) || null,
    type: (rec && rec.type) || (place && place.type) || null,
    sightingCount: sightings.length,
    visitCount: visits.length,
    playerCount: latest.size,
    lastSeen: rec && rec.updatedAt ? rec.updatedAt : null,
    recent
  };
}

/**
 * Recently active locations on this node (newest first).
 * @param {object} store
 * @param {object} [opts]
 * @returns {object[]}
 */
function listRecent (store, opts = {}) {
  if (!store) return [];
  const limit = Math.min(80, Math.max(1, Number(opts.limit) || 40));
  let rows = [];
  try {
    rows = (store.all(COLLECTION) || []).map(sanitizeRecord).filter(Boolean);
  } catch (_) {
    rows = [];
  }
  rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return rows.slice(0, limit).map((row) => ({
    slug: row.slug,
    name: row.name,
    system: row.system,
    type: row.type,
    lastSeen: row.updatedAt,
    playerCount: playerCount(row.sightings),
    sightingCount: (row.sightings || []).length,
    href: locationHref(row.slug)
  }));
}

function placeMatchesSlug (place, slug) {
  const compact = compactPlace(place);
  if (!compact || !slug) return false;
  return String(compact.slug).toLowerCase() === String(slug).toLowerCase();
}

/**
 * Who is online here (or en route) from the live presence roster.
 * @param {object} roster pubkey → presence row
 * @param {string} slug
 * @returns {object[]}
 */
function onlineAt (roster, slug) {
  const place = compactPlace(slug);
  const key = place ? place.slug : locationCatalog.slugify(slug);
  if (!key) return [];
  const out = [];
  for (const [pubkey, doc] of Object.entries(roster || {})) {
    if (!doc || doc.online !== true) continue;
    const here = placeMatchesSlug(doc.location, key);
    const enroute = placeMatchesSlug(doc.destination, key);
    if (!here && !enroute) continue;
    out.push({
      pubkey: String(pubkey),
      nickname: sanitizeHandle(doc.nickname),
      ship: compactShip(doc.ship),
      here,
      enroute: enroute && !here,
      updatedAt: doc.updatedAt || doc.lastEventAt || null,
      href: isFabricPubkey(pubkey) ? profileHref(pubkey) : null
    });
  }
  return out;
}

module.exports = {
  TYPE,
  COLLECTION,
  SIGHTINGS_MAX,
  DEDUP_MS,
  compactPlace,
  compactShip,
  locationHref,
  recordSighting,
  foldPresence,
  summarize,
  listRecent,
  onlineAt,
  getRecord
};
