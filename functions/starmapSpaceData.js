'use strict';

/**
 * Cached community surface coordinates from starmap.space (Meridian / Eureka).
 * Local body XYZ are km; BodyRadius is meters. Lat/lon from their API fields.
 *
 * Refresh: `npm run refresh:starmap-space`
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'data', 'starmap');

let _cache = null;

function normalizeName (name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function loadRaw () {
  if (_cache) return _cache;
  const ocPath = path.join(ROOT, 'oc.json');
  const poisPath = path.join(ROOT, 'pois.json');
  const metaPath = path.join(ROOT, 'meta.json');
  let oc = [];
  let pois = [];
  let meta = null;
  try {
    if (fs.existsSync(ocPath)) oc = JSON.parse(fs.readFileSync(ocPath, 'utf8'));
    if (fs.existsSync(poisPath)) pois = JSON.parse(fs.readFileSync(poisPath, 'utf8'));
    if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (_) {
    oc = [];
    pois = [];
    meta = null;
  }
  if (!Array.isArray(oc)) oc = [];
  if (!Array.isArray(pois)) pois = [];

  const ocByName = new Map();
  for (const row of oc) {
    const key = normalizeName(row.ObjectContainer);
    if (!key) continue;
    ocByName.set(key, row);
  }

  const poisByPlanet = new Map();
  for (const row of pois) {
    const key = normalizeName(row.Planet);
    if (!key) continue;
    if (!poisByPlanet.has(key)) poisByPlanet.set(key, []);
    poisByPlanet.get(key).push(row);
  }

  _cache = { oc, pois, meta, ocByName, poisByPlanet };
  return _cache;
}

/** @private test helper */
function _resetCacheForTests () {
  _cache = null;
}

/**
 * Object-container row for a planet/moon name (e.g. Daymar, Microtech).
 * @param {string} bodyName
 * @returns {object|null}
 */
function getObjectContainer (bodyName) {
  const key = normalizeName(bodyName);
  if (!key) return null;
  return loadRaw().ocByName.get(key) || null;
}

/**
 * Community POIs for a body, with numeric lat/lon when present.
 * @param {string} bodyName
 * @returns {Array<object>}
 */
function listPoisForBody (bodyName) {
  const key = normalizeName(bodyName);
  if (!key) return [];
  const rows = loadRaw().poisByPlanet.get(key) || [];
  return rows.map((row) => {
    const lat = Number(row.Latitude);
    const lon = Number(row.Longitude);
    const hasLl = Number.isFinite(lat) && Number.isFinite(lon);
    return {
      itemId: row.item_id,
      guid: row.GUID || null,
      name: row.PoiName || row.name || 'POI',
      type: row.Type || 'PointOfInterest',
      system: row.System || null,
      planet: row.Planet || null,
      classification: row.Classification || null,
      comment: row.Comment || null,
      quantum: Number(row.QTMarker) === 1,
      latitude: hasLl ? lat : null,
      longitude: hasLl ? lon : null,
      longitude360: Number.isFinite(Number(row.Longitude360)) ? Number(row.Longitude360) : null,
      height: Number.isFinite(Number(row.Height)) ? Number(row.Height) : null,
      x: Number.isFinite(Number(row.XCoord)) ? Number(row.XCoord) : null,
      y: Number.isFinite(Number(row.YCoord)) ? Number(row.YCoord) : null,
      z: Number.isFinite(Number(row.ZCoord)) ? Number(row.ZCoord) : null,
      source: 'starmap.space'
    };
  }).filter((p) => p.latitude != null && p.longitude != null);
}

/**
 * Body radius in meters from object-container table.
 * @param {string} bodyName
 * @returns {number|null}
 */
function bodyRadiusMeters (bodyName) {
  const oc = getObjectContainer(bodyName);
  if (!oc) return null;
  const r = Number(oc.BodyRadius);
  return Number.isFinite(r) && r > 0 ? r : null;
}

/**
 * Convert local container km coords → lat/lon (starmap convention).
 * lat = asin(z/r), lon = atan2(-y, -x) in degrees (−180…180).
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {{ latitude: number, longitude: number, radiusKm: number }|null}
 */
function localXyzToLatLon (x, y, z) {
  const xx = Number(x);
  const yy = Number(y);
  const zz = Number(z);
  if (![xx, yy, zz].every(Number.isFinite)) return null;
  const r = Math.sqrt(xx * xx + yy * yy + zz * zz);
  if (!(r > 0)) return null;
  const latitude = Math.asin(Math.max(-1, Math.min(1, zz / r))) * 180 / Math.PI;
  let longitude = Math.atan2(-yy, -xx) * 180 / Math.PI;
  if (longitude > 180) longitude -= 360;
  if (longitude <= -180) longitude += 360;
  return { latitude, longitude, radiusKm: r };
}

function meta () {
  return loadRaw().meta;
}

module.exports = {
  normalizeName,
  getObjectContainer,
  listPoisForBody,
  bodyRadiusMeters,
  localXyzToLatLon,
  meta,
  _resetCacheForTests
};
