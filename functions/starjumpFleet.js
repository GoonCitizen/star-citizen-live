'use strict';

/**
 * Starjump / FleetViewer JSON export → GoonCitizen fleet documents.
 *
 * Exports use `{ type: 'starjumpFleetviewer', version, canvasItems: [...] }`
 * with SHIP / TEXTGROUP items. We keep a compact ship roster for the UI and
 * optionally retain the original export for re-share / re-export.
 */

const crypto = require('crypto');
const path = require('path');
const shipCatalog = require('./shipCatalog');

const FLEET_SHARE_TYPE = 'FleetShare';
const STARJUMP_TYPE = 'starjumpFleetviewer';
const NAME_MAX = 80;
const OWNER_MAX = 64;
const VISIBILITIES = new Set(['private', 'peers', 'groups', 'public']);
const MAX_SHIP_LINES = 2000;
/** Aggregate / org-wide Starjump dumps — do not treat the filename as a pilot. */
const AGGREGATE_SOURCE_RE = /^(starjump-)?(permafleet-)?(all|full|merged)(-|$)|permafleet-(all|full)|starjump-all|starjump-merged/i;

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
 * Pilot / hangar owner handle for a ship line (not the fleet document's Fabric pubkey).
 * @param {*} value
 * @returns {string|null}
 */
function sanitizeOwner (value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, OWNER_MAX);
  return s || null;
}

/**
 * Derive a pilot handle from a Starjump / FleetViewer filename.
 * `starjump-kersa.json` → `kersa`; `STARJUMP_FleetViewer-crescendo.json` → `crescendo`.
 * Aggregate dumps (`starjump-permafleet-all.json`) return null.
 * @param {string|null|undefined} sourceFile
 * @returns {string|null}
 */
function ownerFromSourceFile (sourceFile) {
  if (!sourceFile) return null;
  let base = path.basename(String(sourceFile)).replace(/\.json$/i, '');
  base = base.replace(/\s*\(\d+\)\s*$/, '').trim();
  if (!base || AGGREGATE_SOURCE_RE.test(base)) return null;
  let handle = base
    .replace(/^STARJUMP_FleetViewer[-_]?/i, '')
    .replace(/^fleetviewer[-_]?/i, '')
    .replace(/^fleetview[-_]?/i, '')
    .replace(/^starjump[-_]?/i, '')
    .replace(/^STARJUMP[-_]?/i, '')
    .replace(/\s+Fleet$/i, '')
    .replace(/[-_]?only$/i, '')
    .trim();
  if (!handle || /^FleetViewer$/i.test(handle) || AGGREGATE_SOURCE_RE.test(handle)) return null;
  return sanitizeOwner(handle);
}

/**
 * Stable map key for a roster line (slug + variant + owner).
 * @param {{ slug?: string, variant?: string|null, owner?: string|null }} entry
 * @returns {string}
 */
function shipLineKey (entry = {}) {
  return String(entry.slug || '') + '\0' + (entry.variant || '') + '\0' + (entry.owner || '');
}

/**
 * Count unique hull types (slug+variant), ignoring owner splits.
 * @param {object[]} ships
 * @returns {number}
 */
function uniqueHullCount (ships) {
  const keys = new Set();
  for (const s of Array.isArray(ships) ? ships : []) {
    if (!s || !s.slug) continue;
    keys.add(String(s.slug) + '\0' + (s.variant || ''));
  }
  return keys.size;
}

/**
 * Distinct pilot handles on a roster (sorted).
 * @param {object[]} ships
 * @returns {string[]}
 */
function listOwners (ships) {
  const set = new Set();
  for (const s of Array.isArray(ships) ? ships : []) {
    const o = sanitizeOwner(s && s.owner);
    if (o) set.add(o);
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * Roll up roster lines by hull (slug+variant) or catalog class (`type`).
 * Preserves an `owners` breakdown `[{ owner, count }]` on each row.
 * @param {object[]} ships
 * @param {'hull'|'type'|false|null|string} [mode]
 * @returns {object[]}
 */
function consolidateShips (ships, mode = 'hull') {
  const m = String(mode || '').toLowerCase();
  if (!m || m === 'none' || m === 'owner' || m === 'false') {
    return Array.isArray(ships) ? ships.slice() : [];
  }
  const byKey = new Map();
  for (const raw of Array.isArray(ships) ? ships : []) {
    if (!raw || !raw.slug) continue;
    const slug = String(raw.slug);
    const variant = raw.variant || null;
    const shipType = raw.type ? String(raw.type) : null;
    const key = m === 'type' || m === 'class'
      ? (shipType || '\0unknown')
      : (slug + '\0' + (variant || ''));
    const count = Math.max(1, Math.floor(Number(raw.count) || 1));
    const owner = sanitizeOwner(raw.owner);
    let row = byKey.get(key);
    if (!row) {
      row = {
        slug: m === 'type' || m === 'class' ? (shipType ? shipCatalog.slugify(shipType) : 'unknown') : slug,
        name: m === 'type' || m === 'class'
          ? (shipType || 'Unclassified')
          : String(raw.name || slug),
        variant: m === 'type' || m === 'class' ? null : variant,
        owner: null,
        manufacturer: raw.manufacturer || null,
        type: shipType,
        size: raw.size || null,
        count: 0,
        owners: [],
        consolidated: m === 'type' || m === 'class' ? 'type' : 'hull'
      };
      byKey.set(key, row);
    }
    row.count = Math.min(9999, row.count + count);
    if (raw.name && String(raw.name).length >= String(row.name).length && row.consolidated === 'hull') {
      row.name = String(raw.name);
    }
    if (raw.manufacturer && !row.manufacturer) row.manufacturer = raw.manufacturer;
    if (raw.type && !row.type) row.type = raw.type;
    if (raw.size && !row.size) row.size = raw.size;
    if (m === 'type' || m === 'class') {
      // Track distinct hulls under this class.
      if (!row._hulls) row._hulls = new Set();
      row._hulls.add(slug + '\0' + (variant || ''));
    }
    if (owner) {
      const prev = row.owners.find((o) => o.owner === owner);
      if (prev) prev.count = Math.min(9999, prev.count + count);
      else row.owners.push({ owner, count });
    } else {
      const prev = row.owners.find((o) => o.owner === null);
      if (prev) prev.count = Math.min(9999, prev.count + count);
      else row.owners.push({ owner: null, count });
    }
  }
  const out = [];
  for (const row of byKey.values()) {
    if (row._hulls) {
      row.uniqueHulls = row._hulls.size;
      delete row._hulls;
    }
    row.owners.sort((a, b) => {
      const ao = a.owner || '\uffff';
      const bo = b.owner || '\uffff';
      return String(ao).localeCompare(String(bo), undefined, { sensitivity: 'base' });
    });
    const named = row.owners.filter((o) => o.owner).map((o) => o.owner);
    row.ownerCount = named.length;
    // Compact label for search / display when consolidated.
    row.ownerSummary = named.length
      ? (named.length <= 3 ? named.join(', ') : named.slice(0, 2).join(', ') + ` +${named.length - 2}`)
      : null;
    out.push(row);
  }
  return out;
}

/**
 * Filter + sort a roster for UI (search, owner, quantity bounds, optional consolidate).
 * @param {object[]} ships
 * @param {Object} [opts]
 * @param {string} [opts.q] Free-text over name / slug / variant / owner / manufacturer
 * @param {string} [opts.owner] Exact owner handle (case-insensitive); `__none__` = unowned lines
 * @param {number} [opts.minCount]
 * @param {number} [opts.maxCount]
 * @param {string} [opts.sort] `name` | `count` | `count-asc` | `owner` | `owner-desc`
 * @param {string} [opts.consolidate] `none` | `hull` | `type` — roll up after owner filter
 * @returns {object[]}
 */
function filterSortShips (ships, opts = {}) {
  let rows = Array.isArray(ships) ? ships.slice() : [];
  const q = String(opts.q || '').trim().toLowerCase();
  const ownerFilter = opts.owner != null && opts.owner !== '' ? String(opts.owner) : null;
  if (ownerFilter === '__none__') {
    rows = rows.filter((s) => !sanitizeOwner(s.owner));
  } else if (ownerFilter) {
    const want = ownerFilter.toLowerCase();
    rows = rows.filter((s) => String(s.owner || '').toLowerCase() === want);
  }
  // Consolidate after owner filter so "kersa's hull totals" still works.
  const consolidate = opts.consolidate != null ? opts.consolidate : 'none';
  if (consolidate && consolidate !== 'none' && consolidate !== false) {
    rows = consolidateShips(rows, consolidate);
  }
  if (q) {
    rows = rows.filter((s) => {
      const ownerBits = Array.isArray(s.owners)
        ? s.owners.map((o) => o && o.owner).filter(Boolean).join(' ')
        : '';
      const hay = [
        s.name, s.slug, s.variant, s.owner, s.ownerSummary, s.manufacturer, s.type, s.size, ownerBits
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  const minCount = opts.minCount != null ? Number(opts.minCount) : null;
  const maxCount = opts.maxCount != null ? Number(opts.maxCount) : null;
  if (Number.isFinite(minCount)) {
    rows = rows.filter((s) => (s.count || 1) >= minCount);
  }
  if (Number.isFinite(maxCount)) {
    rows = rows.filter((s) => (s.count || 1) <= maxCount);
  }
  const sort = String(opts.sort || 'name').toLowerCase();
  rows.sort((a, b) => {
    if (sort === 'count' || sort === 'count-desc') {
      const d = (b.count || 1) - (a.count || 1);
      if (d) return d;
    } else if (sort === 'count-asc') {
      const d = (a.count || 1) - (b.count || 1);
      if (d) return d;
    } else if (sort === 'owner' || sort === 'owner-asc') {
      const ao = a.ownerSummary || a.owner || '\uffff';
      const bo = b.ownerSummary || b.owner || '\uffff';
      const d = String(ao).localeCompare(String(bo), undefined, { sensitivity: 'base' });
      if (d) return d;
    } else if (sort === 'owner-desc') {
      const ao = a.ownerSummary || a.owner || '';
      const bo = b.ownerSummary || b.owner || '';
      const d = String(bo).localeCompare(String(ao), undefined, { sensitivity: 'base' });
      if (d) return d;
    } else if (sort === 'type') {
      const d = String(a.type || '\uffff').localeCompare(String(b.type || '\uffff'), undefined, { sensitivity: 'base' });
      if (d) return d;
    }
    const byName = String(a.name || a.slug || '').localeCompare(String(b.name || b.slug || ''), undefined, { sensitivity: 'base' });
    if (byName) return byName;
    return String(a.owner || '').localeCompare(String(b.owner || ''), undefined, { sensitivity: 'base' });
  });
  return rows;
}

/**
 * Extract ships from a Starjump export, optionally tagged with a pilot owner.
 * Lines are unique by slug + variant + owner.
 * @param {object} exportDoc
 * @param {{ owner?: string|null }} [opts]
 * @returns {{ slug: string, name: string, variant: string|null, owner: string|null, count: number }[]}
 */
function extractShips (exportDoc, opts = {}) {
  const owner = sanitizeOwner(opts.owner);
  const items = Array.isArray(exportDoc && exportDoc.canvasItems) ? exportDoc.canvasItems : [];
  const byKey = new Map();
  for (const item of items) {
    if (!item || item.itemType !== 'SHIP') continue;
    const slug = String(item.shipSlug || '').trim();
    if (!slug) continue;
    const variant = String(item.variantSlug || '').trim() || null;
    const name = String(item.defaultText || slug).trim().split(/\n/)[0].trim() || slug;
    const key = shipLineKey({ slug, variant, owner });
    const prev = byKey.get(key);
    if (prev) prev.count += 1;
    else {
      const known = shipCatalog.resolveShip(slug);
      byKey.set(key, {
        slug: (known && known.slug) || slug,
        name: name || (known && known.name) || slug,
        variant,
        owner,
        manufacturer: (known && known.manufacturer) || null,
        type: (known && known.type) || null,
        size: (known && known.size) || null,
        count: 1
      });
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName) return byName;
    return String(a.owner || '').localeCompare(String(b.owner || ''));
  });
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
      owner: s.owner || null,
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
 * @returns {{ slug: string, name: string, variant: string|null, owner: string|null, manufacturer: string|null, type: string|null, size: string|null, count: number }|null}
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
  const owner = sanitizeOwner(entry.owner);
  const count = Math.max(0, Math.min(9999, Math.floor(Number(entry.count) || 0)));
  if (count <= 0) return null;
  const nameRaw = String(entry.name || (known && known.name) || slug).trim() || slug;
  return {
    slug,
    name: nameRaw.split(/\n/)[0].trim() || slug,
    variant,
    owner,
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
 * Merge/normalize a ships array (aggregate counts by slug+variant+owner).
 * @param {*} list
 * @returns {{ slug: string, name: string, variant: string|null, owner: string|null, manufacturer: string|null, count: number }[]}
 */
function normalizeShips (list) {
  const byKey = new Map();
  for (const raw of Array.isArray(list) ? list : []) {
    const s = normalizeShipEntry(raw);
    if (!s) continue;
    const key = shipLineKey(s);
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
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name);
      if (byName) return byName;
      return String(a.owner || '').localeCompare(String(b.owner || ''));
    })
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
    uniqueShips: uniqueHullCount(ships),
    ownerCount: listOwners(ships).length,
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
  fleet.uniqueShips = uniqueHullCount(fleet.ships);
  fleet.ownerCount = listOwners(fleet.ships).length;
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
 * @param {{ slug?: string, name?: string, variant?: string|null, owner?: string|null, count?: number, remove?: boolean }} op
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
  const owner = sanitizeOwner(op.owner);
  const idx = ships.findIndex((s) => s.slug === slug
    && (s.variant || null) === variant
    && (sanitizeOwner(s.owner) || null) === owner);
  if (op.remove === true || Number(op.count) === 0) {
    if (idx >= 0) ships.splice(idx, 1);
  } else {
    const count = Math.max(1, Math.min(9999, Math.floor(Number(op.count) || 1)));
    const entry = normalizeShipEntry({
      slug,
      name: op.name || (known && known.name) || (idx >= 0 ? ships[idx].name : slug),
      variant,
      owner,
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
 * @param {{ name?: string, ownerPubkey?: string|null, owner?: string|null, sourceFile?: string|null, visibility?: string, keepExport?: boolean, id?: string }} [opts]
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
  const owner = sanitizeOwner(opts.owner) || ownerFromSourceFile(opts.sourceFile);
  const ships = extractShips(exportDoc, { owner });
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
    uniqueShips: uniqueHullCount(ships),
    ownerCount: listOwners(ships).length,
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
  const ships = Array.isArray(fleet.ships) ? fleet.ships : [];
  return {
    id: fleet.id,
    type: fleet.type || 'GoonCitizenFleet',
    name: fleet.name,
    ownerPubkey: fleet.ownerPubkey || null,
    source: fleet.source || 'starjump',
    sourceFile: fleet.sourceFile || null,
    visibility: sanitizeVisibility(fleet.visibility),
    groupIds: Array.isArray(fleet.groupIds) ? fleet.groupIds.slice() : [],
    ships,
    shipCount: fleet.shipCount != null ? fleet.shipCount : ships.reduce((n, s) => n + (s.count || 1), 0),
    uniqueShips: fleet.uniqueShips != null ? fleet.uniqueShips : uniqueHullCount(ships),
    ownerCount: fleet.ownerCount != null ? fleet.ownerCount : listOwners(ships).length,
    owners: listOwners(ships),
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
    uniqueShips: uniqueHullCount(ships),
    ownerCount: listOwners(ships).length,
    importedAt: object.sharedAt || now,
    updatedAt: now,
    sharedAt: object.sharedAt || now,
    remote: true
  };
  if (!fleet.id) fleet.id = fleetIdFor(fleet);
  return fleet;
}

/**
 * Compact FleetShare tip for group Statechain journal (no canvas export).
 * @param {object} shareObject From {@link buildFleetShareObject}
 * @param {{ groupId?: string, source?: string }} [meta]
 * @returns {object}
 */
function fleetShareJournalMessage (shareObject, meta = {}) {
  const ships = Array.isArray(shareObject && shareObject.ships)
    ? shareObject.ships.slice(0, 200)
    : [];
  return {
    kind: FLEET_SHARE_TYPE,
    type: FLEET_SHARE_TYPE,
    fleetId: shareObject.fleetId || shareObject.id || null,
    name: shareObject.name || null,
    ownerPubkey: shareObject.ownerPubkey || null,
    shipCount: Number(shareObject.shipCount) || ships.reduce((n, s) => n + (s.count || 1), 0),
    uniqueShips: Number(shareObject.uniqueShips) || ships.length,
    ships,
    sharedAt: shareObject.sharedAt || new Date().toISOString(),
    visibility: shareObject.visibility || 'groups',
    groupId: meta.groupId || null,
    source: meta.source || null
  };
}

module.exports = {
  FLEET_SHARE_TYPE,
  STARJUMP_TYPE,
  VISIBILITIES,
  isStarjumpExport,
  extractShips,
  sanitizeExport,
  sanitizeName,
  sanitizeOwner,
  sanitizeVisibility,
  ownerFromSourceFile,
  shipLineKey,
  uniqueHullCount,
  listOwners,
  consolidateShips,
  filterSortShips,
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
  fleetFromShareObject,
  fleetShareJournalMessage
};
