'use strict';

/**
 * Online presence + current-ship documents for GoonCitizen mesh / group share.
 *
 * Default online = any parsed Game.log event within {@link ONLINE_WINDOW_MS}.
 * Operators can force Online / Offline via {@link presenceAvailability}.
 */

const shipCatalog = require('./shipCatalog');
const { shipName } = require('./parser');

const ONLINE_WINDOW_MS = 10 * 60 * 1000;
const PRESENCE_TYPE = 'PeerPresence';
const STATUS_TEXT_MAX = 64;
const VISIBILITIES = new Set(['private', 'peers', 'groups', 'public']);
const AVAILABILITIES = new Set(['auto', 'online', 'offline']);

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
    } else {
      const raw = String(src.shipOverrideSlug).trim();
      if (!raw) base.shipOverrideSlug = null;
      else {
        const hit = shipCatalog.resolveShip(raw);
        base.shipOverrideSlug = hit ? hit.slug : raw.toLowerCase();
      }
    }
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
 * Resolve manual ship override from a catalog slug.
 * @param {string|null} slug null clears override (autodetect)
 */
function buildShipOverride (slug) {
  if (slug === undefined || slug === null || slug === '') return null;
  const hit = shipCatalog.resolveShip(slug);
  const resolved = hit ? hit.slug : String(slug).trim().toLowerCase();
  return Object.assign({
    slug: resolved,
    name: (hit && hit.name) || resolved,
    at: new Date().toISOString()
  }, catalogShipMeta(hit));
}

/**
 * Build the local / published presence document.
 */
function buildPresenceDocument (opts = {}) {
  const availability = sanitizeAvailability(opts.availability);
  const online = resolveOnline(availability, opts.lastEventAt);
  let ship = null;
  if (opts.shipOverride && opts.shipOverride.slug) {
    const known = shipCatalog.resolveShip(opts.shipOverride.slug);
    ship = Object.assign({
      slug: opts.shipOverride.slug,
      name: opts.shipOverride.name || (known && known.name) || opts.shipOverride.slug,
      source: 'override'
    }, catalogShipMeta(known), {
      type: opts.shipOverride.type || (known && known.type) || null,
      size: opts.shipOverride.size || (known && known.size) || null,
      manufacturer: opts.shipOverride.manufacturer || (known && known.manufacturer) || null
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
  if (patch.nickname != null) base.nickname = String(patch.nickname).trim().slice(0, 64) || null;
  if (patch.pubkey) base.pubkey = String(patch.pubkey);
  if (patch.ownerPubkey && !base.pubkey) base.pubkey = String(patch.ownerPubkey);
  if (patch.visibility !== undefined) base.visibility = sanitizeVisibility(patch.visibility);
  if (patch.groupIds !== undefined) base.groupIds = sanitizeGroupIds(patch.groupIds);
  base.updatedAt = patch.updatedAt || patch.sharedAt || new Date().toISOString();
  base.lastSeen = new Date().toISOString();
  return base;
}

module.exports = {
  ONLINE_WINDOW_MS,
  PRESENCE_TYPE,
  STATUS_TEXT_MAX,
  VISIBILITIES,
  AVAILABILITIES,
  sanitizeVisibility,
  sanitizeAvailability,
  sanitizeStatusText,
  sanitizeGroupIds,
  sanitizePresenceShare,
  isOnline,
  resolveOnline,
  classIdFromVehicle,
  displayNameFromClassId,
  slugFromClassId,
  buildDetectedShip,
  buildShipOverride,
  buildPresenceDocument,
  buildPresenceShareObject,
  mergeRemotePresence
};
