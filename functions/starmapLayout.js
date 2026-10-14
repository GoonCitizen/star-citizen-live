'use strict';

/**
 * 2D system map layout from the wiki celestial-object catalog.
 * Polar projection: distance (AU) × longitude → x/y, then normalized.
 */

const locationCatalog = require('./locationCatalog');

const KIND_RADIUS = {
  STAR: 10,
  PLANET: 7,
  SATELLITE: 4,
  JUMPPOINT: 3,
  MANMADE: 3,
  ASTEROID_BELT: 5
};

function hashOffset (slug) {
  const s = String(slug || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  const a = (Math.abs(h) % 628) / 100;
  const r = 0.035 + (Math.abs(h >> 8) % 20) / 800;
  return { dx: Math.cos(a) * r, dy: Math.sin(a) * r };
}

function projectBodies (bodies) {
  const raw = [];
  for (const b of bodies || []) {
    const dist = Number(b.distance);
    const lon = Number(b.longitude);
    if (!Number.isFinite(dist)) continue;
    const rad = (Number.isFinite(lon) ? lon : 0) * Math.PI / 180;
    raw.push({
      code: b.code || null,
      name: b.name || b.designation || b.code || 'body',
      type: b.type || null,
      designation: b.designation || null,
      x: dist * Math.cos(rad),
      y: dist * Math.sin(rad),
      r: KIND_RADIUS[b.type] || 3
    });
  }
  if (!raw.length) return { points: [], bounds: null };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of raw) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = 0.12;
  const spanX = Math.max(0.2, maxX - minX);
  const spanY = Math.max(0.2, maxY - minY);
  const span = Math.max(spanX, spanY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const points = raw.map((p) => ({
    code: p.code,
    name: p.name,
    type: p.type,
    designation: p.designation,
    kind: 'body',
    nx: 0.5 + (p.x - cx) / span * (1 - pad * 2),
    ny: 0.5 + (p.y - cy) / span * (1 - pad * 2),
    r: p.r
  }));
  return {
    points,
    bounds: { cx, cy, span, pad }
  };
}

function attachLocation (layout, loc) {
  if (!layout || !loc) return null;
  const name = String(loc.name || '').toLowerCase();
  const parent = String(loc.parent || '').toLowerCase();
  const bodies = layout.points.filter((p) => p.kind === 'body');
  let host = bodies.find((p) => p.name && p.name.toLowerCase() === name);
  if (!host && parent) {
    host = bodies.find((p) => p.name && p.name.toLowerCase() === parent);
  }
  if (!host && loc.system) {
    const star = bodies.find((p) => p.type === 'STAR');
    host = star || bodies[0] || null;
  }
  if (!host) return null;
  const off = hashOffset(loc.slug || loc.name);
  return {
    slug: loc.slug,
    name: loc.name,
    type: loc.type,
    system: loc.system,
    parent: loc.parent,
    hotspot: loc.hotspot === true,
    quantum: loc.quantum === true,
    aliases: Array.isArray(loc.aliases) ? loc.aliases.slice() : [],
    kind: loc.hotspot ? 'hotspot' : 'location',
    nx: Math.min(0.96, Math.max(0.04, host.nx + off.dx)),
    ny: Math.min(0.96, Math.max(0.04, host.ny + off.dy)),
    r: loc.hotspot ? 4 : 3
  };
}

/**
 * Plottable system map: bodies + optional location/hotspot/member overlays.
 * @param {string} [systemCode] default Stanton
 * @param {object} [opts]
 * @param {Array<{ slug?: string, name?: string, count?: number }>} [opts.destinations]
 * @param {Array<{ slug?: string, name?: string, label?: string }>} [opts.members]
 * @param {boolean} [opts.includeHotspots]
 */
function layoutSystem (systemCode, opts = {}) {
  const bodyTerrain = require('./bodyTerrain');
  const code = String(systemCode || 'STANTON').replace(/\s+system$/i, '');
  const system = locationCatalog.getSystem(code) || locationCatalog.getSystem('STANTON');
  const projected = projectBodies(system && system.bodies);
  const bodies = projected.points.map((b) => {
    const style = bodyTerrain.surfaceStyleForBody(b);
    const terrain = bodyTerrain.resolveBodyTerrain(b);
    return Object.assign({}, b, {
      surfaceStyle: style,
      surfaceTile: bodyTerrain.surfaceTileForBody(b),
      terrainSlug: terrain.slug
    });
  });
  const includeHotspots = opts.includeHotspots !== false;
  const locations = [];
  const hotspots = [];
  const sysName = system ? String(system.name || system.code) : 'Stanton';
  for (const loc of locationCatalog.listLocations()) {
    const locSys = String(loc.system || '').toLowerCase();
    if (locSys && locSys !== sysName.toLowerCase() && locSys !== String(system && system.code || '').toLowerCase()) {
      continue;
    }
    if (loc.hideInStarmap && !loc.hotspot && !loc.quantum) continue;
    const pt = attachLocation(projected, loc);
    if (!pt) continue;
    if (pt.hotspot) hotspots.push(pt);
    else if ([
      'Planet', 'Moon', 'Star', 'LandingZone', 'Manmade', 'Manmade_VisibleOnInteraction',
      'JumpPoint', 'NavPoint', 'Outpost', 'PointOfInterest'
    ].includes(loc.type)) {
      locations.push(pt);
    }
  }

  const destinations = [];
  for (const row of opts.destinations || []) {
    const token = row.slug || row.name || row.n;
    const hit = locationCatalog.resolveLocation(token);
    const base = hit
      ? attachLocation(projected, hit)
      : attachLocation(projected, { slug: locationCatalog.slugify(token), name: String(token), parent: null, system: sysName });
    if (!base) continue;
    destinations.push(Object.assign({}, base, {
      kind: 'destination',
      count: Number(row.count != null ? row.count : row.c) || 1,
      token: String(token),
      label: (hit && hit.name) || String(token)
    }));
  }

  const members = [];
  for (const m of opts.members || []) {
    const token = (m.location && (m.location.slug || m.location.name)) || m.slug || m.locationSlug;
    if (!token) continue;
    const hit = locationCatalog.resolveLocation(token);
    const base = hit ? attachLocation(projected, hit) : null;
    if (!base) continue;
    members.push(Object.assign({}, base, {
      kind: 'member',
      label: m.label || m.nickname || m.name || null,
      ship: m.ship || null,
      destination: m.destination || null
    }));
  }

  return {
    system: system
      ? { code: system.code, name: system.name }
      : { code: 'STANTON', name: 'Stanton' },
    bodies,
    locations,
    hotspots: includeHotspots ? hotspots : [],
    destinations,
    members
  };
}

/**
 * Parse "Stanton - Pyro" style jump names into endpoint system codes.
 * @param {string} name
 * @param {Map<string, object>} byName
 * @returns {[string, string]|null}
 */
function jumpEndpoints (name, byName) {
  const raw = String(name || '');
  const parts = raw.split(/\s*[-–—]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const a = byName.get(parts[0].toLowerCase());
  const b = byName.get(parts[1].toLowerCase());
  if (!a || !b) return null;
  const ca = String(a.code || a.name).toUpperCase();
  const cb = String(b.code || b.name).toUpperCase();
  if (ca === cb) return null;
  return [ca, cb];
}

/**
 * Multi-system jump graph from catalog positions + JUMPPOINT names.
 * @returns {{ systems: object[], edges: object[] }}
 */
function layoutGalaxy () {
  const systems = locationCatalog.listSystems() || [];
  const byName = new Map();
  for (const s of systems) {
    if (s.code) byName.set(String(s.code).toLowerCase(), s);
    if (s.name) byName.set(String(s.name).toLowerCase(), s);
  }

  const raw = [];
  for (const s of systems) {
    const pos = s.position || {};
    const x = Number(pos.x);
    const y = Number(pos.z != null ? pos.z : pos.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    raw.push({
      code: String(s.code || s.name || '').toUpperCase(),
      name: s.name || s.code,
      x,
      y
    });
  }
  if (!raw.length) {
    return { systems: [], edges: [] };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of raw) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = 0.14;
  const spanX = Math.max(0.2, maxX - minX);
  const spanY = Math.max(0.2, maxY - minY);
  const span = Math.max(spanX, spanY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const nodes = raw.map((p) => ({
    code: p.code,
    name: p.name,
    kind: 'system',
    nx: 0.5 + (p.x - cx) / span * (1 - pad * 2),
    ny: 0.5 + (p.y - cy) / span * (1 - pad * 2)
  }));
  const byCode = new Map(nodes.map((n) => [n.code, n]));

  const edgeKeys = new Set();
  const edges = [];
  for (const s of systems) {
    for (const body of s.bodies || []) {
      if (String(body.type || '').toUpperCase() !== 'JUMPPOINT') continue;
      const ends = jumpEndpoints(body.name || body.designation, byName);
      if (!ends) continue;
      const [a, b] = ends;
      if (!byCode.has(a) || !byCode.has(b)) continue;
      const key = [a, b].sort().join('|');
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      const na = byCode.get(a);
      const nb = byCode.get(b);
      edges.push({
        from: a,
        to: b,
        label: body.name || (a + ' – ' + b),
        x1: na.nx,
        y1: na.ny,
        x2: nb.nx,
        y2: nb.ny
      });
    }
  }

  return {
    systems: nodes,
    edges,
    bounds: { cx, cy, span, pad }
  };
}

function hashUnit (slug, salt) {
  const s = String(slug || '') + ':' + String(salt || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Deterministic lat/lon for a POI without catalog surface coords.
 * @param {string} slug
 * @returns {{ latitude: number, longitude: number }}
 */
function syntheticLatLon (slug) {
  const u1 = hashUnit(slug, 'lat');
  const u2 = hashUnit(slug, 'lon');
  return {
    latitude: -70 + u1 * 140,
    longitude: u2 * 360
  };
}

/**
 * Orthographic-ish disk projection of lat/lon → normalized 0–1.
 * @param {number} lat
 * @param {number} lon
 * @param {number} [viewLongitude=0] camera / rotation offset in degrees
 * @returns {{ nx: number, ny: number, visible: boolean }}
 */
function projectSurface (lat, lon, viewLongitude) {
  const latR = (Number(lat) || 0) * Math.PI / 180;
  const lonR = ((Number(lon) || 0) - (Number(viewLongitude) || 0)) * Math.PI / 180;
  const x = Math.cos(latR) * Math.sin(lonR);
  const y = Math.sin(latR);
  const z = Math.cos(latR) * Math.cos(lonR);
  const visible = z >= -0.05;
  const scale = 0.42;
  return {
    nx: 0.5 + x * scale,
    ny: 0.5 - y * scale,
    visible
  };
}

function findSystemBody (system, token) {
  const want = String(token || '').trim().toLowerCase();
  if (!want || !system) return null;
  const bodies = system.bodies || [];
  return bodies.find((b) => {
    const keys = [b.code, b.name, b.designation]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase());
    return keys.includes(want) || keys.some((k) => k.endsWith('.' + want) || k.includes(want));
  }) || null;
}

const POI_TYPES = new Set([
  'LandingZone', 'Outpost', 'PointOfInterest', 'Manmade', 'Manmade_VisibleOnInteraction',
  'NavPoint', 'City', 'Settlement', 'Station'
]);

/**
 * Body surface layout: textured disk coords + POIs + child moons.
 * @param {string} systemCode
 * @param {string} bodyToken name or code
 * @param {object} [opts]
 * @param {boolean} [opts.includeHidden]
 */
function pushProjectedPoi (list, base, viewLongitude) {
  let proj = projectSurface(base.latitude, base.longitude, viewLongitude);
  let farSide = false;
  if (!proj.visible) {
    farSide = true;
    proj = projectSurface(base.latitude, base.longitude + 180, viewLongitude);
  }
  list.push(Object.assign({}, base, {
    farSide,
    nx: Math.min(0.94, Math.max(0.06, proj.nx)),
    ny: Math.min(0.94, Math.max(0.06, proj.ny))
  }));
}

function layoutBody (systemCode, bodyToken, opts = {}) {
  const bodyTerrain = require('./bodyTerrain');
  const starmapSpaceData = require('./starmapSpaceData');
  const code = String(systemCode || 'STANTON').replace(/\s+system$/i, '');
  const system = locationCatalog.getSystem(code) || locationCatalog.getSystem('STANTON');
  const body = findSystemBody(system, bodyToken);
  if (!body) {
    return {
      system: system
        ? { code: system.code, name: system.name }
        : { code: 'STANTON', name: 'Stanton' },
      body: null,
      pois: [],
      satellites: [],
      surfaceStyle: 'rocky'
    };
  }

  const bodyName = String(body.name || body.code || '');
  const bodyNameLc = bodyName.toLowerCase();
  const terrain = bodyTerrain.resolveBodyTerrain(body);
  const surfaceStyle = terrain.style;
  const surfaceTile = bodyTerrain.surfaceTileForBody(body);
  const includeHidden = opts.includeHidden === true;
  const viewLongitude = Number(opts.viewLongitude) || 0;
  const community = starmapSpaceData.listPoisForBody(bodyName);
  const radiusMeters = starmapSpaceData.bodyRadiusMeters(bodyName);
  const oc = starmapSpaceData.getObjectContainer(bodyName);

  const pois = [];
  const seenName = new Set();

  for (const row of community) {
    const nameKey = starmapSpaceData.normalizeName(row.name);
    if (nameKey) seenName.add(nameKey);
    pushProjectedPoi(pois, {
      slug: 'starmap:' + (row.guid || row.itemId || nameKey),
      name: row.name,
      type: row.type,
      system: row.system || system.name,
      parent: bodyName,
      hotspot: false,
      quantum: row.quantum === true,
      kind: 'poi',
      latitude: row.latitude,
      longitude: row.longitude,
      height: row.height,
      coordsSource: 'starmap.space',
      x: row.x,
      y: row.y,
      z: row.z
    }, viewLongitude);
  }

  for (const loc of locationCatalog.listLocations()) {
    const locSys = String(loc.system || '').toLowerCase();
    const sysName = String(system.name || system.code || '').toLowerCase();
    const sysCode = String(system.code || '').toLowerCase();
    if (locSys && locSys !== sysName && locSys !== sysCode) continue;
    const parent = String(loc.parent || '').toLowerCase();
    const name = String(loc.name || '').toLowerCase();
    const onBody = parent === bodyNameLc || name === bodyNameLc;
    if (!onBody) continue;
    if (name === bodyNameLc && /Planet|Moon|Star/i.test(loc.type || '')) continue;
    if (!POI_TYPES.has(loc.type) && !loc.hotspot && !loc.quantum) continue;
    if (loc.hideInStarmap && !includeHidden && !loc.hotspot) continue;
    const nameKey = starmapSpaceData.normalizeName(loc.name);
    if (nameKey && seenName.has(nameKey)) continue;
    // Prefer matching a community row by substring (e.g. "Kudre Ore" ↔ catalog)
    const communityHit = community.find((c) => {
      const ck = starmapSpaceData.normalizeName(c.name);
      return ck && nameKey && (ck.includes(nameKey) || nameKey.includes(ck));
    });
    if (communityHit) {
      if (nameKey) seenName.add(nameKey);
      continue;
    }
    if (nameKey) seenName.add(nameKey);
    const ll = syntheticLatLon(loc.slug || loc.name);
    pushProjectedPoi(pois, {
      slug: loc.slug,
      name: loc.name,
      type: loc.type,
      system: loc.system,
      parent: loc.parent,
      hotspot: loc.hotspot === true,
      quantum: loc.quantum === true,
      kind: 'poi',
      latitude: ll.latitude,
      longitude: ll.longitude,
      coordsSource: 'synthetic',
      height: null
    }, viewLongitude);
  }

  const satellites = [];
  const seenMoon = new Set();
  for (const loc of locationCatalog.listLocations()) {
    if (!/Moon/i.test(loc.type || '')) continue;
    if (String(loc.parent || '').toLowerCase() !== bodyNameLc) continue;
    const key = String(loc.slug || loc.name).toLowerCase();
    if (seenMoon.has(key)) continue;
    seenMoon.add(key);
    const hit = findSystemBody(system, loc.name);
    const ll = syntheticLatLon('moon:' + (loc.slug || loc.name));
    const proj = projectSurface(ll.latitude, ll.longitude, viewLongitude);
    satellites.push({
      code: (hit && hit.code) || loc.slug,
      name: (hit && hit.name) || loc.name,
      type: 'SATELLITE',
      designation: (hit && hit.designation) || loc.designation || null,
      kind: 'satellite',
      slug: loc.slug,
      nx: Math.min(0.96, Math.max(0.04, proj.nx)),
      ny: Math.min(0.96, Math.max(0.04, proj.ny)),
      r: 2.5
    });
  }

  return {
    system: { code: system.code, name: system.name },
    body: {
      code: body.code,
      name: body.name,
      type: body.type,
      designation: body.designation || null,
      distance: body.distance,
      latitude: body.latitude,
      longitude: body.longitude,
      radiusMeters: radiusMeters,
      internalName: oc && oc.InternalName ? oc.InternalName : null,
      orbitalMarkerRadius: oc && Number.isFinite(Number(oc.OrbitalMarkerRadius))
        ? Number(oc.OrbitalMarkerRadius)
        : null
    },
    surfaceStyle,
    surfaceTile,
    terrainSlug: terrain.slug,
    projection: 'equirectangular',
    coordsCredit: community.length
      ? 'Surface coordinates: starmap.space (Meridian / Eureka)'
      : null,
    viewLongitude,
    pois,
    satellites
  };
}

module.exports = {
  KIND_RADIUS,
  projectBodies,
  attachLocation,
  layoutSystem,
  layoutGalaxy,
  layoutBody,
  jumpEndpoints,
  syntheticLatLon,
  projectSurface,
  findSystemBody
};
