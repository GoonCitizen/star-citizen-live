'use strict';

/**
 * Starjump / FleetViewer JSON export → GoonCitizen fleet documents.
 *
 * Exports use `{ type: 'starjumpFleetviewer', version, canvasItems: [...] }`
 * with SHIP / TEXTGROUP items. We keep a compact ship roster for the UI and
 * optionally retain the original export for re-share / re-export.
 */

const crypto = require('crypto');
const shipCatalog = require('./shipCatalog');

const FLEET_SHARE_TYPE = 'FleetShare';
const STARJUMP_TYPE = 'starjumpFleetviewer';
const NAME_MAX = 80;
const VISIBILITIES = new Set(['private', 'peers', 'groups', 'public']);
const MAX_SHIP_LINES = 500;

/**
 * @param {*} value
 * @returns {boolean}
 */
function isStarjumpExport (value) {
  if (!value || typeof value !== 'object') return false;
  const t = String(value.type || '').toLowerCase();
  if (t === 'starjumpfleetviewer' || t === 'fleetviewer' || t === 'starjump') return true;
  return Array.isArray(value.canvasItems);
}

/**
 * Extract unique ships (by slug+variant) from a Starjump export.
 * @param {object} exportDoc
 * @returns {{ slug: string, name: string, variant: string|null, count: number }[]}
 */
function extractShips (exportDoc) {
  const items = Array.isArray(exportDoc && exportDoc.canvasItems) ? exportDoc.canvasItems : [];
  const byKey = new Map();
  for (const item of items) {
    if (!item || item.itemType !== 'SHIP') continue;
    const slug = String(item.shipSlug || '').trim();
    if (!slug) continue;
    const variant = String(item.variantSlug || '').trim() || null;
    const name = String(item.defaultText || slug).trim() || slug;
    const key = slug + '\0' + (variant || '');
    const prev = byKey.get(key);
    if (prev) prev.count += 1;
    else {
      const known = shipCatalog.resolveShip(slug);
      byKey.set(key, {
        slug: (known && known.slug) || slug,
        name: name || (known && known.name) || slug,
        variant,
        manufacturer: (known && known.manufacturer) || null,
        type: (known && known.type) || null,
        size: (known && known.size) || null,
        count: 1
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Strip heavy / non-portable fields before persisting an export blob.
 * @param {object} exportDoc
 * @returns {object}
 */
function sanitizeExport (exportDoc) {
  const out = Object.assign({}, exportDoc);
  if (out.backgroundImageBase64) out.backgroundImageBase64 = '';
  if (!Array.isArray(out.canvasItems)) out.canvasItems = [];
  // Cap absurdly large canvases (keep ships + labels only).
  if (out.canvasItems.length > 5000) {
    out.canvasItems = out.canvasItems.filter((i) => i && (i.itemType === 'SHIP' || i.itemType === 'TEXTGROUP')).slice(0, 5000);
  }
  return out;
}

/**
 * @param {*} value
 * @returns {string|null}
 */
function sanitizeName (value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, NAME_MAX);
  return s || null;
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
 * Content id for a fleet document (stable for the same owner + ship set + name).
 * @param {{ ownerPubkey?: string|null, name?: string|null, ships?: object[] }} doc
 */
function fleetIdFor (doc = {}) {
  const basis = {
    owner: doc.ownerPubkey || null,
    name: doc.name || null,
    ships: (doc.ships || []).map((s) => ({
      slug: s.slug,
      variant: s.variant || null,
      count: s.count || 1
    }))
  };
  return crypto.createHash('sha256').update(JSON.stringify(basis)).digest('hex').slice(0, 32);
}

/** Random id for editable custom fleets (ships change without rewriting id). */
function newFleetId () {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Normalize a ship roster entry; fill name/manufacturer/type from the catalog when known.
 * @param {*} entry
 * @returns {{ slug: string, name: string, variant: string|null, manufacturer: string|null, type: string|null, size: string|null, count: number }|null}
 */
function normalizeShipEntry (entry) {
  if (!entry || typeof entry !== 'object') return null;
  let slug = String(entry.slug || '').trim();
  if (!slug && entry.name) slug = shipCatalog.slugify(entry.name);
  if (!slug) return null;
  const known = shipCatalog.resolveShip(slug) || shipCatalog.resolveShip(entry.name);
  if (known) slug = known.slug;
  const variant = entry.variant != null && String(entry.variant).trim()
    ? String(entry.variant).trim()
    : null;
  const count = Math.max(0, Math.min(9999, Math.floor(Number(entry.count) || 0)));
  if (count <= 0) return null;
  return {
    slug,
    name: String(entry.name || (known && known.name) || slug).trim() || slug,
    variant,
    manufacturer: entry.manufacturer
      ? String(entry.manufacturer)
      : ((known && known.manufacturer) || null),
    type: entry.type
      ? String(entry.type)
      : ((known && known.type) || null),
    size: entry.size
      ? String(entry.size)
      : ((known && known.size) || null),
    count
  };
}

/**
 * Merge/normalize a ships array (aggregate counts by slug+variant).
 * @param {*} list
 * @returns {{ slug: string, name: string, variant: string|null, manufacturer: string|null, count: number }[]}
 */
function normalizeShips (list) {
  const byKey = new Map();
  for (const raw of Array.isArray(list) ? list : []) {
    const s = normalizeShipEntry(raw);
    if (!s) continue;
    const key = s.slug + '\0' + (s.variant || '');
    const prev = byKey.get(key);
    if (prev) {
      prev.count = Math.min(9999, prev.count + s.count);
      if (s.name && s.name.length >= prev.name.length) prev.name = s.name;
      if (s.manufacturer && !prev.manufacturer) prev.manufacturer = s.manufacturer;
      if (s.type && !prev.type) prev.type = s.type;
      if (s.size && !prev.size) prev.size = s.size;
    } else {
      byKey.set(key, s);
    }
  }
  return [...byKey.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_SHIP_LINES);
}

/**
 * Create an editable custom fleet (not from a Starjump canvas).
 * @param {{ name?: string, ships?: object[], ownerPubkey?: string|null, visibility?: string, groupIds?: string[], id?: string }} opts
 */
function createCustomFleet (opts = {}) {
  const ships = normalizeShips(opts.ships || []);
  const name = sanitizeName(opts.name) || (ships.length ? `${ships.length} ship fleet` : 'New fleet');
  const now = new Date().toISOString();
  return {
    id: opts.id || newFleetId(),
    type: 'GoonCitizenFleet',
    name,
    ownerPubkey: opts.ownerPubkey ? String(opts.ownerPubkey) : null,
    source: 'custom',
    sourceType: 'custom',
    sourceVersion: 1,
    sourceFile: null,
    visibility: sanitizeVisibility(opts.visibility),
    groupIds: Array.isArray(opts.groupIds) ? opts.groupIds.map(String).filter(Boolean) : [],
    ships,
    shipCount: ships.reduce((n, s) => n + (s.count || 1), 0),
    uniqueShips: ships.length,
    importedAt: now,
    updatedAt: now,
    sharedAt: null,
    remote: false
  };
}

/**
 * Replace or merge ships on an existing fleet record (mutates + returns it).
 * @param {object} fleet
 * @param {object[]} ships
 * @param {{ replace?: boolean }} [opts] replace=true (default) sets roster; false merges counts
 */
function setFleetShips (fleet, ships, opts = {}) {
  if (!fleet || typeof fleet !== 'object') throw new Error('fleet required');
  const next = normalizeShips(ships);
  if (opts.replace === false) {
    fleet.ships = normalizeShips([...(fleet.ships || []), ...next]);
  } else {
    fleet.ships = next;
  }
  fleet.shipCount = fleet.ships.reduce((n, s) => n + (s.count || 1), 0);
  fleet.uniqueShips = fleet.ships.length;
  fleet.updatedAt = new Date().toISOString();
  // Custom edits diverge from the original canvas layout.
  if (fleet.source === 'starjump' && opts.replace !== false) {
    fleet.source = 'custom';
    delete fleet.export;
  }
  return fleet;
}

/**
 * Add / set count / remove one ship line.
 * @param {object} fleet
 * @param {{ slug?: string, name?: string, variant?: string|null, count?: number, remove?: boolean }} op
 */
function applyShipOp (fleet, op = {}) {
  if (!fleet) throw new Error('fleet required');
  const ships = Array.isArray(fleet.ships) ? fleet.ships.map((s) => Object.assign({}, s)) : [];
  const slugHint = op.slug || op.name;
  const known = shipCatalog.resolveShip(slugHint);
  const slug = (known && known.slug) || shipCatalog.slugify(slugHint || '');
  if (!slug) {
    const err = new Error('ship slug or name required');
    err.code = 'INVALID_SHIP';
    throw err;
  }
  const variant = op.variant != null && String(op.variant).trim() ? String(op.variant).trim() : null;
  const idx = ships.findIndex((s) => s.slug === slug && (s.variant || null) === variant);
  if (op.remove === true || Number(op.count) === 0) {
    if (idx >= 0) ships.splice(idx, 1);
  } else {
    const count = Math.max(1, Math.min(9999, Math.floor(Number(op.count) || 1)));
    const entry = normalizeShipEntry({
      slug,
      name: op.name || (known && known.name) || (idx >= 0 ? ships[idx].name : slug),
      variant,
      manufacturer: op.manufacturer || (known && known.manufacturer) || null,
      type: op.type || (known && known.type) || null,
      size: op.size || (known && known.size) || null,
      count
    });
    if (!entry) {
      const err = new Error('invalid ship');
      err.code = 'INVALID_SHIP';
      throw err;
    }
    if (idx >= 0) ships[idx] = entry;
    else ships.push(entry);
  }
  return setFleetShips(fleet, ships, { replace: true });
}

/**
 * Parse a Starjump / FleetViewer JSON export into a fleet record.
 * @param {object|string} raw JSON object or string
 * @param {{ name?: string, ownerPubkey?: string|null, sourceFile?: string|null, visibility?: string, keepExport?: boolean, id?: string }} [opts]
 */
function parseStarjumpExport (raw, opts = {}) {
  let doc = raw;
  if (typeof raw === 'string') {
    try { doc = JSON.parse(raw); } catch (e) {
      const err = new Error('invalid JSON: ' + (e.message || e));
      err.code = 'INVALID_JSON';
      throw err;
    }
  }
  if (!isStarjumpExport(doc)) {
    const err = new Error('not a Starjump / FleetViewer export (expected type starjumpFleetviewer + canvasItems)');
    err.code = 'INVALID_EXPORT';
    throw err;
  }
  const exportDoc = sanitizeExport(doc);
  const ships = extractShips(exportDoc);
  if (!ships.length) {
    const err = new Error('export contains no SHIP items');
    err.code = 'EMPTY_FLEET';
    throw err;
  }
  const name = sanitizeName(opts.name) ||
    sanitizeName(exportDoc.name) ||
    sanitizeName(opts.sourceFile && String(opts.sourceFile).replace(/\.[^.]+$/, '')) ||
    `${ships.length} ship fleet`;
  const now = new Date().toISOString();
  const fleet = {
    id: opts.id || null,
    type: 'GoonCitizenFleet',
    name,
    ownerPubkey: opts.ownerPubkey ? String(opts.ownerPubkey) : null,
    source: 'starjump',
    sourceType: String(exportDoc.type || STARJUMP_TYPE),
    sourceVersion: exportDoc.version != null ? Number(exportDoc.version) || 1 : 1,
    sourceFile: opts.sourceFile ? String(opts.sourceFile).slice(0, 240) : null,
    visibility: sanitizeVisibility(opts.visibility),
    groupIds: Array.isArray(opts.groupIds) ? opts.groupIds.map(String).filter(Boolean) : [],
    ships,
    shipCount: ships.reduce((n, s) => n + (s.count || 1), 0),
    uniqueShips: ships.length,
    importedAt: opts.importedAt || now,
    updatedAt: now,
    sharedAt: null,
    remote: !!opts.remote
  };
  if (opts.keepExport !== false) {
    fleet.export = exportDoc;
  }
  if (!fleet.id) fleet.id = fleetIdFor(fleet);
  return fleet;
}

/**
 * Public/list-safe summary (no full canvas export).
 * @param {object} fleet
 */
function summarizeFleet (fleet) {
  if (!fleet || typeof fleet !== 'object') return null;
  return {
    id: fleet.id,
    type: fleet.type || 'GoonCitizenFleet',
    name: fleet.name,
    ownerPubkey: fleet.ownerPubkey || null,
    source: fleet.source || 'starjump',
    sourceFile: fleet.sourceFile || null,
    visibility: sanitizeVisibility(fleet.visibility),
    groupIds: Array.isArray(fleet.groupIds) ? fleet.groupIds.slice() : [],
    ships: Array.isArray(fleet.ships) ? fleet.ships : [],
    shipCount: fleet.shipCount != null ? fleet.shipCount : (fleet.ships || []).reduce((n, s) => n + (s.count || 1), 0),
    uniqueShips: fleet.uniqueShips != null ? fleet.uniqueShips : (fleet.ships || []).length,
    importedAt: fleet.importedAt || null,
    updatedAt: fleet.updatedAt || null,
    sharedAt: fleet.sharedAt || null,
    remote: !!fleet.remote,
    hasExport: !!(fleet.export && Array.isArray(fleet.export.canvasItems))
  };
}

/**
 * Wire payload for FleetShare CONTRACT_MESSAGE / GroupShare.
 * Includes ships + optional compact export (no base64).
 * @param {object} fleet
 * @param {{ includeExport?: boolean }} [opts]
 */
function buildFleetShareObject (fleet, opts = {}) {
  const summary = summarizeFleet(fleet);
  if (!summary) throw new Error('fleet required');
  const object = {
    kind: FLEET_SHARE_TYPE,
    type: FLEET_SHARE_TYPE,
    fleetId: summary.id,
    name: summary.name,
    visibility: summary.visibility,
    groupIds: summary.groupIds,
    ships: summary.ships,
    shipCount: summary.shipCount,
    uniqueShips: summary.uniqueShips,
    ownerPubkey: summary.ownerPubkey,
    sharedAt: new Date().toISOString()
  };
  if (opts.includeExport !== false && fleet.export) {
    object.export = sanitizeExport(fleet.export);
  }
  return object;
}

/**
 * Ingest a remote FleetShare object into a local fleet record.
 * @param {object} object
 * @param {string|null} sourcePubkey
 */
function fleetFromShareObject (object, sourcePubkey = null) {
  if (!object || typeof object !== 'object') {
    const err = new Error('FleetShare object required');
    err.code = 'INVALID_SHARE';
    throw err;
  }
  if (object.export && isStarjumpExport(object.export)) {
    return parseStarjumpExport(object.export, {
      id: object.fleetId || null,
      name: object.name,
      ownerPubkey: sourcePubkey || object.ownerPubkey || null,
      visibility: object.visibility || 'peers',
      groupIds: object.groupIds,
      remote: true,
      keepExport: true,
      importedAt: object.sharedAt || undefined
    });
  }
  const ships = normalizeShips(object.ships || []);
  if (!ships.length) {
    const err = new Error('FleetShare has no ships');
    err.code = 'EMPTY_FLEET';
    throw err;
  }
  const now = new Date().toISOString();
  const fleet = {
    id: object.fleetId || null,
    type: 'GoonCitizenFleet',
    name: sanitizeName(object.name) || `${ships.length} ship fleet`,
    ownerPubkey: sourcePubkey || object.ownerPubkey || null,
    source: object.source === 'custom' ? 'custom' : 'starjump',
    sourceType: object.source === 'custom' ? 'custom' : STARJUMP_TYPE,
    sourceVersion: 1,
    sourceFile: null,
    visibility: sanitizeVisibility(object.visibility || 'peers'),
    groupIds: Array.isArray(object.groupIds) ? object.groupIds.map(String).filter(Boolean) : [],
    ships,
    shipCount: ships.reduce((n, s) => n + (s.count || 1), 0),
    uniqueShips: ships.length,
    importedAt: object.sharedAt || now,
    updatedAt: now,
    sharedAt: object.sharedAt || now,
    remote: true
  };
  if (!fleet.id) fleet.id = fleetIdFor(fleet);
  return fleet;
}

module.exports = {
  FLEET_SHARE_TYPE,
  STARJUMP_TYPE,
  VISIBILITIES,
  isStarjumpExport,
  extractShips,
  sanitizeExport,
  sanitizeName,
  sanitizeVisibility,
  fleetIdFor,
  newFleetId,
  normalizeShipEntry,
  normalizeShips,
  createCustomFleet,
  setFleetShips,
  applyShipOp,
  parseStarjumpExport,
  summarizeFleet,
  buildFleetShareObject,
  fleetFromShareObject
};
