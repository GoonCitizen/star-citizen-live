'use strict';

/**
 * Online presence + current-ship documents for GoonCitizen mesh / group share.
 *
 * Default online = any parsed Game.log event within {@link ONLINE_WINDOW_MS}.
 * Operators can force Online / Offline via {@link presenceAvailability}.
 */

const shipCatalog = require('./shipCatalog');
const locationCatalog = require('./locationCatalog');
const { shipName } = require('./parser');

const ONLINE_WINDOW_MS = 10 * 60 * 1000;
const PRESENCE_TYPE = 'PeerPresence';
const STATUS_TEXT_MAX = 64;
/** Stored shipOverrideSlug meaning “publish no ship” (suppresses Game.log autodetect). */
const SHIP_NONE_SLUG = '__none__';
/** Same sentinel for location / destination overrides. */
const PLACE_NONE_SLUG = locationCatalog.NONE_SLUG;
const VISIBILITIES = new Set(['private', 'peers', 'groups', 'public']);
const AVAILABILITIES = new Set(['auto', 'online', 'offline']);

/**
 * @param {string|null|undefined} slug
 * @returns {boolean}
 */
function isShipClearedSlug (slug) {
  if (slug === undefined || slug === null) return false;
  const s = String(slug).trim().toLowerCase();
  return s === SHIP_NONE_SLUG || s === 'none' || s === 'clear';
}

function isPlaceClearedSlug (slug) {
  return locationCatalog.isClearedSlug(slug);
}

/**
 * @param {*} value
 * @returns {string|null}
 */
function sanitizePlaceSlug (value) {
  if (value === undefined || value === null || value === '') return null;
  if (isPlaceClearedSlug(value)) return PLACE_NONE_SLUG;
  const raw = String(value).trim();
  if (!raw) return null;
  const hit = locationCatalog.resolveLocation(raw);
  return hit ? hit.slug : raw.toLowerCase();
}

/**
 * @param {*} value
 * @returns {'private'|'peers'|'groups'|'public'}
 */
function sanitizeVisibility (value) {
  const v = String(value || 'private').toLowerCase();
  return VISIBILITIES.has(v) ? v : 'private';
}

/**
 * @param {*} value
 * @returns {'auto'|'online'|'offline'}
 */
function sanitizeAvailability (value) {
  const v = String(value || 'auto').toLowerCase();
  return AVAILABILITIES.has(v) ? v : 'auto';
}

/**
 * @param {*} value
 * @returns {string|null}
 */
function sanitizeStatusText (value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, STATUS_TEXT_MAX);
  return s || null;
}

/**
 * @param {*} value
 * @returns {string[]}
 */
function sanitizeGroupIds (value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => String(id).trim()).filter(Boolean))];
}

/**
 * Normalize operator presence settings (share + visibility + ship override).
 * @param {*} value partial settings object or single-field patch
 */
function sanitizePresenceShare (value) {
  const base = {
    sharePresence: false,
    presenceVisibility: 'private',
    presenceGroupIds: [],
    shipOverrideSlug: null,
    locationOverrideSlug: null,
    destinationOverrideSlug: null,
    presenceAvailability: 'auto',
    presenceStatusText: null
  };
  if (value === undefined || value === null) return base;
  const src = typeof value === 'object' ? value : {};
  if (src.sharePresence !== undefined) base.sharePresence = src.sharePresence === true;
  if (src.presenceVisibility !== undefined) {
    base.presenceVisibility = sanitizeVisibility(src.presenceVisibility);
  }
  if (src.presenceGroupIds !== undefined) {
    base.presenceGroupIds = sanitizeGroupIds(src.presenceGroupIds);
  }
  if (src.presenceAvailability !== undefined) {
    base.presenceAvailability = sanitizeAvailability(src.presenceAvailability);
  }
  if (src.presenceStatusText !== undefined) {
    base.presenceStatusText = sanitizeStatusText(src.presenceStatusText);
  }
  if (src.shipOverrideSlug !== undefined) {
    if (src.shipOverrideSlug === null || src.shipOverrideSlug === '') {
      base.shipOverrideSlug = null;
    } else if (isShipClearedSlug(src.shipOverrideSlug)) {
      base.shipOverrideSlug = SHIP_NONE_SLUG;
    } else {
      const raw = String(src.shipOverrideSlug).trim();
      if (!raw) base.shipOverrideSlug = null;
      else {
        const hit = shipCatalog.resolveShip(raw);
        base.shipOverrideSlug = hit ? hit.slug : raw.toLowerCase();
      }
    }
  }
  if (src.locationOverrideSlug !== undefined) {
    base.locationOverrideSlug = sanitizePlaceSlug(src.locationOverrideSlug);
  }
  if (src.destinationOverrideSlug !== undefined) {
    base.destinationOverrideSlug = sanitizePlaceSlug(src.destinationOverrideSlug);
  }
  return base;
}

/**
 * @param {string|null|undefined} lastEventAt ISO timestamp
 * @param {number} [now]
 * @returns {boolean}
 */
function isOnline (lastEventAt, now = Date.now()) {
  if (!lastEventAt) return false;
  const t = Date.parse(lastEventAt);
  if (!Number.isFinite(t)) return false;
  return (now - t) <= ONLINE_WINDOW_MS;
}

/**
 * Resolve published online flag from availability + log activity.
 * @param {'auto'|'online'|'offline'} availability
 * @param {string|null|undefined} lastEventAt
 * @param {number} [now]
 */
function resolveOnline (availability, lastEventAt, now = Date.now()) {
  const mode = sanitizeAvailability(availability);
  if (mode === 'online') return true;
  if (mode === 'offline') return false;
  return isOnline(lastEventAt, now);
}

/**
 * Strip bracket suffix from quantum-style vehicle tokens.
 * @param {string} vehicle e.g. DRAK_Clipper_734066837132[734066837132]
 * @returns {string|null} class id including trailing numeric instance id
 */
function classIdFromVehicle (vehicle) {
  if (!vehicle) return null;
  const head = String(vehicle).trim().split('[')[0];
  if (!head) return null;
  return head;
}

/**
 * Fallback display name when {@link shipName} does not know the manufacturer prefix.
 * @param {string} classId
 * @returns {string|null}
 */
function genericNameFromClassId (classId) {
  if (!classId) return null;
  const m = String(classId).match(/^[A-Z]{2,5}_([A-Za-z0-9_]+?)_\d{6,}$/);
  if (!m) return null;
  return m[1].replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim() || null;
}

/**
 * @param {string} classId
 * @returns {string|null}
 */
function displayNameFromClassId (classId) {
  return shipName(classId) || genericNameFromClassId(classId);
}

/**
 * Map a vehicle class id to a catalog slug when possible.
 * @param {string} classId
 * @returns {string|null}
 */
function slugFromClassId (classId) {
  const id = classIdFromVehicle(classId);
  if (!id) return null;
  const byClass = shipCatalog.resolveShip(id);
  if (byClass) return byClass.slug;
  const name = displayNameFromClassId(id);
  if (name) {
    const byName = shipCatalog.resolveShip(name);
    if (byName) return byName.slug;
    const slug = shipCatalog.slugify(name);
    if (shipCatalog.resolveShip(slug)) return slug;
  }
  return null;
}

/**
 * @param {string} classId
 * @param {string|null|undefined} vehicleId
 * @param {string|null|undefined} at ISO timestamp
 */
function catalogShipMeta (known) {
  if (!known) return {};
  return {
    type: known.type || null,
    size: known.size || null,
    manufacturer: known.manufacturer || null
  };
}

function catalogPlaceMeta (known) {
  return locationCatalog.catalogLocationMeta(known);
}

function buildDetectedShip (classId, vehicleId, at) {
  const cid = classIdFromVehicle(classId) || String(classId || '').trim() || null;
  const known = cid ? shipCatalog.resolveShip(cid) : null;
  const name = (known && known.name) || displayNameFromClassId(cid);
  const slug = (known && known.slug) || slugFromClassId(cid);
  return Object.assign({
    classId: cid,
    vehicleId: vehicleId != null ? String(vehicleId) : null,
    name,
    slug,
    at: at || new Date().toISOString()
  }, catalogShipMeta(known));
}

/**
 * Resolve a Game.log origin / destination token to a catalog place.
 * @param {string} token
 * @param {string|null|undefined} at
 */
function buildDetectedPlace (token, at) {
  const raw = String(token || '').trim();
  if (!raw) return null;
  const known = locationCatalog.resolveLocation(raw);
  return Object.assign({
    token: raw,
    slug: (known && known.slug) || locationCatalog.slugify(raw) || null,
    name: (known && known.name) || raw,
    at: at || new Date().toISOString(),
    source: 'detected'
  }, catalogPlaceMeta(known));
}

/**
 * Resolve manual ship override from a catalog slug.
 * @param {string|null} slug null → autodetect; {@link SHIP_NONE_SLUG} → force no ship
 */
function buildShipOverride (slug) {
  if (slug === undefined || slug === null || slug === '') return null;
  if (isShipClearedSlug(slug)) {
    return {
      slug: SHIP_NONE_SLUG,
      name: null,
      cleared: true,
      at: new Date().toISOString()
    };
  }
  const hit = shipCatalog.resolveShip(slug);
  const resolved = hit ? hit.slug : String(slug).trim().toLowerCase();
  return Object.assign({
    slug: resolved,
    name: (hit && hit.name) || resolved,
    at: new Date().toISOString()
  }, catalogShipMeta(hit));
}

/**
 * Resolve manual location / destination override.
 * @param {string|null} slug
 */
function buildPlaceOverride (slug) {
  if (slug === undefined || slug === null || slug === '') return null;
  if (isPlaceClearedSlug(slug)) {
    return {
      slug: PLACE_NONE_SLUG,
      name: null,
      cleared: true,
      at: new Date().toISOString()
    };
  }
  const hit = locationCatalog.resolveLocation(slug);
  const resolved = hit ? hit.slug : String(slug).trim().toLowerCase();
  return Object.assign({
    slug: resolved,
    name: (hit && hit.name) || resolved,
    at: new Date().toISOString(),
    source: 'override'
  }, catalogPlaceMeta(hit));
}

function resolvePublishedPlace (override, detected) {
  if (override && (override.cleared === true || isPlaceClearedSlug(override.slug))) return null;
  if (override && override.slug) {
    const known = locationCatalog.resolveLocation(override.slug);
    return Object.assign({
      slug: override.slug,
      name: override.name || (known && known.name) || override.slug,
      source: 'override'
    }, catalogPlaceMeta(known), catalogPlaceMeta(override));
  }
  if (detected && (detected.slug || detected.name || detected.token)) {
    const known = locationCatalog.resolveLocation(
      detected.slug || detected.token || detected.name
    );
    return Object.assign({
      slug: detected.slug || (known && known.slug) || null,
      name: detected.name || (known && known.name) || detected.token || null,
      token: detected.token || null,
      source: 'detected'
    }, catalogPlaceMeta(known), catalogPlaceMeta(detected));
  }
  return null;
}

/**
 * Build the local / published presence document.
 */
function buildPresenceDocument (opts = {}) {
  const availability = sanitizeAvailability(opts.availability);
  const online = resolveOnline(availability, opts.lastEventAt);
  let ship = null;
  const override = opts.shipOverride;
  if (override && (override.cleared === true || isShipClearedSlug(override.slug))) {
    ship = null;
  } else if (override && override.slug) {
    const known = shipCatalog.resolveShip(override.slug);
    ship = Object.assign({
      slug: override.slug,
      name: override.name || (known && known.name) || override.slug,
      source: 'override'
    }, catalogShipMeta(known), {
      type: override.type || (known && known.type) || null,
      size: override.size || (known && known.size) || null,
      manufacturer: override.manufacturer || (known && known.manufacturer) || null
    });
  } else if (opts.detectedShip && (opts.detectedShip.slug || opts.detectedShip.name || opts.detectedShip.classId)) {
    const known = shipCatalog.resolveShip(
      opts.detectedShip.slug || opts.detectedShip.classId || opts.detectedShip.name
    );
    ship = Object.assign({
      slug: opts.detectedShip.slug || null,
      name: opts.detectedShip.name || null,
      classId: opts.detectedShip.classId || null,
      source: 'detected'
    }, catalogShipMeta(known), {
      type: opts.detectedShip.type || (known && known.type) || null,
      size: opts.detectedShip.size || (known && known.size) || null,
      manufacturer: opts.detectedShip.manufacturer || (known && known.manufacturer) || null
    });
  }
  return {
    type: PRESENCE_TYPE,
    online,
    availability,
    statusText: sanitizeStatusText(opts.statusText),
    lastEventAt: opts.lastEventAt || null,
    ship,
    location: resolvePublishedPlace(opts.locationOverride, opts.detectedLocation),
    destination: resolvePublishedPlace(opts.destinationOverride, opts.detectedDestination),
    nickname: opts.nickname || null,
    pubkey: opts.pubkey ? String(opts.pubkey) : null,
    visibility: sanitizeVisibility(opts.visibility),
    groupIds: sanitizeGroupIds(opts.groupIds),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Wire payload for PeerPresence CONTRACT_MESSAGE / GroupShare.
 * @param {object} doc from {@link buildPresenceDocument}
 */
function buildPresenceShareObject (doc) {
  if (!doc || typeof doc !== 'object') throw new Error('presence document required');
  return {
    kind: PRESENCE_TYPE,
    type: PRESENCE_TYPE,
    online: doc.online === true,
    availability: sanitizeAvailability(doc.availability),
    statusText: sanitizeStatusText(doc.statusText),
    lastEventAt: doc.lastEventAt || null,
    ship: doc.ship || null,
    location: doc.location || null,
    destination: doc.destination || null,
    nickname: doc.nickname || null,
    ownerPubkey: doc.pubkey || null,
    visibility: sanitizeVisibility(doc.visibility),
    groupIds: sanitizeGroupIds(doc.groupIds),
    sharedAt: new Date().toISOString()
  };
}

/**
 * Merge inbound PeerPresence into a cache entry.
 * @param {object|null} prev
 * @param {object} patch
 */
function mergeRemotePresence (prev, patch = {}) {
  const base = prev && typeof prev === 'object' ? Object.assign({}, prev) : {};
  if (patch.online !== undefined) base.online = patch.online === true;
  if (patch.availability !== undefined) base.availability = sanitizeAvailability(patch.availability);
  if (patch.statusText !== undefined) base.statusText = sanitizeStatusText(patch.statusText);
  if (patch.lastEventAt !== undefined) base.lastEventAt = patch.lastEventAt || null;
  if (patch.ship !== undefined) base.ship = patch.ship && typeof patch.ship === 'object' ? Object.assign({}, patch.ship) : null;
  if (patch.location !== undefined) {
    base.location = patch.location && typeof patch.location === 'object' ? Object.assign({}, patch.location) : null;
  }
  if (patch.destination !== undefined) {
    base.destination = patch.destination && typeof patch.destination === 'object' ? Object.assign({}, patch.destination) : null;
  }
  if (patch.nickname != null) base.nickname = String(patch.nickname).trim().slice(0, 64) || null;
  if (patch.pubkey) base.pubkey = String(patch.pubkey);
  if (patch.ownerPubkey && !base.pubkey) base.pubkey = String(patch.ownerPubkey);
  if (patch.visibility !== undefined) base.visibility = sanitizeVisibility(patch.visibility);
  if (patch.groupIds !== undefined) base.groupIds = sanitizeGroupIds(patch.groupIds);
  base.updatedAt = patch.updatedAt || patch.sharedAt || new Date().toISOString();
  base.lastSeen = new Date().toISOString();
  return base;
}

/**
 * Ensure ship objects carry catalog type / size / manufacturer when missing.
 * @param {object|null} ship
 * @returns {object|null}
 */
function enrichShipMeta (ship) {
  if (!ship || typeof ship !== 'object') return null;
  const out = Object.assign({}, ship);
  if (out.type && out.size != null && out.manufacturer) return out;
  const known = shipCatalog.resolveShip(out.slug || out.classId || out.name);
  if (!known) return out;
  if (!out.name && known.name) out.name = known.name;
  if (!out.slug && known.slug) out.slug = known.slug;
  if (!out.type && known.type) out.type = known.type;
  if (out.size == null && known.size != null) out.size = known.size;
  if (!out.manufacturer && known.manufacturer) out.manufacturer = known.manufacturer;
  return out;
}

/**
 * Ensure location objects carry catalog name / system when missing.
 * @param {object|null} place
 * @returns {object|null}
 */
function enrichPlaceMeta (place) {
  if (!place || typeof place !== 'object') return null;
  const out = Object.assign({}, place);
  const known = locationCatalog.resolveLocation(out.slug || out.token || out.name);
  if (!known) return out;
  if (!out.name && known.name) out.name = known.name;
  if (!out.slug && known.slug) out.slug = known.slug;
  if (!out.type && known.type) out.type = known.type;
  if (!out.system && known.system) out.system = known.system;
  if (!out.parent && known.parent) out.parent = known.parent;
  if (out.hotspot == null && known.hotspot) out.hotspot = true;
  return out;
}

module.exports = {
  ONLINE_WINDOW_MS,
  PRESENCE_TYPE,
  STATUS_TEXT_MAX,
  SHIP_NONE_SLUG,
  PLACE_NONE_SLUG,
  VISIBILITIES,
  AVAILABILITIES,
  sanitizeVisibility,
  sanitizeAvailability,
  sanitizeStatusText,
  sanitizeGroupIds,
  sanitizePresenceShare,
  sanitizePlaceSlug,
  isShipClearedSlug,
  isPlaceClearedSlug,
  isOnline,
  resolveOnline,
  classIdFromVehicle,
  displayNameFromClassId,
  slugFromClassId,
  buildDetectedShip,
  buildDetectedPlace,
  buildShipOverride,
  buildPlaceOverride,
  buildPresenceDocument,
  buildPresenceShareObject,
  mergeRemotePresence,
  enrichShipMeta,
  enrichPlaceMeta
};
