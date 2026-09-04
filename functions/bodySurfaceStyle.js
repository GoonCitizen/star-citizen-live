'use strict';

/**
 * Procedural / CC0 surface style keys for body zoom (not RSI art).
 */

const SURFACE_BY_HINT = [
  { re: /microtech|calliope|euterpe|clio|ice|snow|frost|tundra/i, style: 'ice' },
  { re: /crusader|gas|giant|atmosphere|bloom/i, style: 'gas' },
  { re: /arccorp|lyria|wala|city|industrial|urban/i, style: 'industrial' },
  { re: /pyro|magma|lava|volcan|ember|ignis|fuego|vuur|vatra|monox|terminus/i, style: 'volcanic' },
  { re: /daymar|yela|arial|cellin|desert|arid|sand|dust/i, style: 'arid' },
  { re: /hurston|aberdeen|magda|ita|delamar|rocky|barren|nyx|earth|ellis/i, style: 'rocky' }
];

/**
 * @param {{ name?: string, type?: string, code?: string }} body
 * @returns {'star'|'ice'|'gas'|'industrial'|'volcanic'|'arid'|'rocky'}
 */
function surfaceStyleForBody (body) {
  const type = String((body && body.type) || '').toUpperCase();
  if (type === 'STAR') return 'star';
  const label = [body && body.name, body && body.code, body && body.designation]
    .filter(Boolean)
    .join(' ');
  for (const row of SURFACE_BY_HINT) {
    if (row.re.test(label)) return row.style;
  }
  if (type === 'SATELLITE' || type === 'MOON') return 'arid';
  if (type === 'PLANET') return 'rocky';
  return 'rocky';
}

/**
 * Manifest / tile path for a surface style.
 * @param {string} style
 * @param {object|null} manifest
 */
function surfaceTilePath (style, manifest) {
  const key = String(style || 'rocky');
  const surfaces = (manifest && manifest.surfaces) || {};
  if (surfaces[key]) return surfaces[key];
  return 'tiles/surface-' + key + '.png';
}

/**
 * @param {{ name?: string, type?: string, code?: string }} body
 * @returns {boolean}
 */
function isOrbitalBody (body) {
  const t = String((body && body.type) || '').toUpperCase();
  return t === 'STAR' || t === 'PLANET' || t === 'SATELLITE' || t === 'MOON';
}

module.exports = {
  SURFACE_BY_HINT,
  surfaceStyleForBody,
  surfaceTilePath,
  isOrbitalBody
};
