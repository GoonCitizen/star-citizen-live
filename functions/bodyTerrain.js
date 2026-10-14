'use strict';

/**
 * Per-body terrain identity for the map browser.
 *
 * Each orbital body gets its own equirectangular tile under
 * `assets/map/tiles/bodies/<slug>.png` (generated procedurally — not RSI art).
 * Operators may overwrite those files with licensed extracts; paths stay stable.
 */

const bodySurfaceStyle = require('./bodySurfaceStyle');

/**
 * Known bodies → stable slug + terrain character.
 * Slugs match starmap.space ObjectContainer names (normalized).
 */
const BODY_TERRAINS = {
  'stanton star': { slug: 'stanton-star', style: 'star', label: 'Stanton' },
  stanton: { slug: 'stanton-star', style: 'star', label: 'Stanton' },
  hurston: { slug: 'hurston', style: 'rocky', label: 'Hurston' },
  arial: { slug: 'arial', style: 'arid', label: 'Arial' },
  aberdeen: { slug: 'aberdeen', style: 'rocky', label: 'Aberdeen' },
  magda: { slug: 'magda', style: 'rocky', label: 'Magda' },
  ita: { slug: 'ita', style: 'rocky', label: 'Ita' },
  crusader: { slug: 'crusader', style: 'gas', label: 'Crusader' },
  cellin: { slug: 'cellin', style: 'arid', label: 'Cellin' },
  daymar: { slug: 'daymar', style: 'arid', label: 'Daymar' },
  yela: { slug: 'yela', style: 'arid', label: 'Yela' },
  arccorp: { slug: 'arccorp', style: 'industrial', label: 'ArcCorp' },
  lyria: { slug: 'lyria', style: 'industrial', label: 'Lyria' },
  wala: { slug: 'wala', style: 'industrial', label: 'Wala' },
  microtech: { slug: 'microtech', style: 'ice', label: 'microTech' },
  calliope: { slug: 'calliope', style: 'ice', label: 'Calliope' },
  clio: { slug: 'clio', style: 'ice', label: 'Clio' },
  euterpe: { slug: 'euterpe', style: 'ice', label: 'Euterpe' },
  'pyro star': { slug: 'pyro-star', style: 'star', label: 'Pyro' },
  pyro: { slug: 'pyro-star', style: 'star', label: 'Pyro' },
  pyro1: { slug: 'pyro1', style: 'volcanic', label: 'Pyro I' },
  monox: { slug: 'monox', style: 'volcanic', label: 'Monox' },
  bloom: { slug: 'bloom', style: 'gas', label: 'Bloom' },
  pyro4: { slug: 'pyro4', style: 'volcanic', label: 'Pyro IV' },
  pyro5: { slug: 'pyro5', style: 'volcanic', label: 'Pyro V' },
  terminus: { slug: 'terminus', style: 'volcanic', label: 'Terminus' },
  adir: { slug: 'adir', style: 'volcanic', label: 'Adir' },
  fairo: { slug: 'fairo', style: 'volcanic', label: 'Fairo' },
  fuego: { slug: 'fuego', style: 'volcanic', label: 'Fuego' },
  ignis: { slug: 'ignis', style: 'volcanic', label: 'Ignis' },
  vatra: { slug: 'vatra', style: 'volcanic', label: 'Vatra' },
  vuur: { slug: 'vuur', style: 'volcanic', label: 'Vuur' },
  'nyx star': { slug: 'nyx-star', style: 'star', label: 'Nyx' },
  nyx: { slug: 'nyx-star', style: 'star', label: 'Nyx' },
  delamar: { slug: 'delamar', style: 'rocky', label: 'Delamar' },
  nyx1: { slug: 'nyx1', style: 'rocky', label: 'Nyx I' },
  nyx2: { slug: 'nyx2', style: 'rocky', label: 'Nyx II' },
  nyx3: { slug: 'nyx3', style: 'rocky', label: 'Nyx III' },
  earth: { slug: 'earth', style: 'ice', label: 'Earth' },
  ellis3: { slug: 'ellis3', style: 'rocky', label: 'Ellis III' }
};

const STYLE_PALETTES = {
  arid: {
    base: [148, 112, 72],
    hi: [52, 36, 18],
    lo: [38, 28, 20],
    craters: true,
    bands: false,
    iceCaps: false,
    cities: false,
    lava: false
  },
  rocky: {
    base: [110, 78, 52],
    hi: [48, 32, 20],
    lo: [36, 24, 16],
    craters: true,
    bands: false,
    iceCaps: 0.12,
    cities: false,
    lava: false
  },
  ice: {
    base: [198, 214, 228],
    hi: [36, 40, 48],
    lo: [55, 45, 35],
    craters: false,
    bands: false,
    iceCaps: 0.55,
    cities: 0.15,
    lava: false
  },
  gas: {
    base: [188, 128, 78],
    hi: [55, 32, 12],
    lo: [42, 48, 60],
    craters: false,
    bands: true,
    iceCaps: false,
    cities: false,
    lava: false,
    glow: [255, 170, 70]
  },
  volcanic: {
    base: [72, 32, 28],
    hi: [90, 28, 12],
    lo: [24, 12, 12],
    craters: true,
    bands: false,
    iceCaps: false,
    cities: false,
    lava: true,
    glow: [230, 70, 24]
  },
  industrial: {
    base: [78, 86, 96],
    hi: [48, 52, 62],
    lo: [28, 28, 34],
    craters: false,
    bands: false,
    iceCaps: false,
    cities: true,
    lava: false
  },
  star: {
    base: [255, 214, 96],
    hi: [40, 24, 0],
    lo: [24, 48, 70],
    craters: false,
    bands: true,
    iceCaps: false,
    cities: false,
    lava: false,
    glow: [255, 240, 170]
  }
};

/** Body-specific palette tweaks (procedural — not game art). */
const BODY_TINTS = {
  daymar: { base: [168, 126, 78], sand: true },
  yela: { base: [150, 150, 158], iceCaps: 0.35 },
  cellin: { base: [132, 108, 88] },
  arial: { base: [176, 132, 88] },
  hurston: { base: [150, 118, 58], haze: [180, 140, 40] },
  aberdeen: { base: [96, 72, 56] },
  magda: { base: [120, 84, 52] },
  ita: { base: [108, 88, 72] },
  crusader: { base: [210, 140, 70], bands: true },
  arccorp: { base: [70, 78, 92], cities: true },
  lyria: { base: [120, 128, 140], cities: 0.4 },
  wala: { base: [100, 92, 84] },
  microtech: { base: [210, 224, 236], iceCaps: 0.7, cities: 0.25 },
  calliope: { base: [200, 210, 220], iceCaps: 0.6 },
  clio: { base: [190, 205, 220], iceCaps: 0.65 },
  euterpe: { base: [205, 218, 230], iceCaps: 0.55 },
  monox: { base: [88, 48, 36], lava: true },
  bloom: { base: [160, 90, 50], bands: true },
  terminus: { base: [64, 28, 24], lava: true },
  delamar: { base: [90, 90, 98] }
};

function normalizeKey (name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+system$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function slugifyName (name) {
  return String(name || 'body')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'body';
}

/**
 * @param {{ name?: string, code?: string, designation?: string, type?: string, label?: string }} body
 * @returns {{ slug: string, style: string, label: string }}
 */
function resolveBodyTerrain (body) {
  if (!body) return { slug: 'body', style: 'rocky', label: 'body' };
  const candidates = [body.name, body.label, body.designation, body.code]
    .filter(Boolean)
    .map((v) => normalizeKey(v));
  for (const key of candidates) {
    if (BODY_TERRAINS[key]) return Object.assign({}, BODY_TERRAINS[key]);
    const parts = key.split(/[\s.]+/).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (BODY_TERRAINS[parts[i]]) return Object.assign({}, BODY_TERRAINS[parts[i]]);
    }
  }
  return {
    slug: slugifyName(body.name || body.code),
    style: bodySurfaceStyle.surfaceStyleForBody(body),
    label: body.name || body.code || 'body'
  };
}

/**
 * Relative path under assets/map/ for this body's terrain tile.
 * @param {{ name?: string, code?: string, type?: string }} body
 * @param {object|null} [manifest]
 */
function surfaceTileForBody (body, manifest) {
  const hit = resolveBodyTerrain(body);
  const bodies = (manifest && manifest.bodies) || {};
  if (bodies[hit.slug]) return bodies[hit.slug];
  return 'tiles/bodies/' + hit.slug + '.png';
}

/**
 * @param {{ name?: string, code?: string, type?: string }} body
 */
function surfaceStyleForBody (body) {
  return resolveBodyTerrain(body).style;
}

/**
 * Recipe used by the tile generator.
 * @param {string} slug
 */
function recipeForSlug (slug) {
  const key = String(slug || '').toLowerCase();
  let meta = null;
  for (const row of Object.values(BODY_TERRAINS)) {
    if (row.slug === key) {
      meta = row;
      break;
    }
  }
  const style = (meta && meta.style) || 'rocky';
  const basePal = Object.assign({}, STYLE_PALETTES[style] || STYLE_PALETTES.rocky);
  const tintKey = key.replace(/-/g, '');
  const tint = BODY_TINTS[key] || BODY_TINTS[tintKey] || {};
  return Object.assign({}, basePal, tint, {
    slug: key,
    style,
    label: (meta && meta.label) || key
  });
}

function listKnownBodySlugs () {
  const seen = new Set();
  const out = [];
  for (const row of Object.values(BODY_TERRAINS)) {
    if (seen.has(row.slug)) continue;
    seen.add(row.slug);
    out.push(row.slug);
  }
  return out.sort();
}

module.exports = {
  BODY_TERRAINS,
  STYLE_PALETTES,
  BODY_TINTS,
  normalizeKey,
  resolveBodyTerrain,
  surfaceTileForBody,
  surfaceStyleForBody,
  recipeForSlug,
  listKnownBodySlugs
};
