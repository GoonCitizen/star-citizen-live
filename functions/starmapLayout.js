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
  const code = String(systemCode || 'STANTON').replace(/\s+system$/i, '');
  const system = locationCatalog.getSystem(code) || locationCatalog.getSystem('STANTON');
  const projected = projectBodies(system && system.bodies);
  const bodies = projected.points;
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

module.exports = {
  KIND_RADIUS,
  projectBodies,
  attachLocation,
  layoutSystem
};
