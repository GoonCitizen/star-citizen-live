'use strict';

/**
 * Offline starfield / soft-nebula backdrop for StarMap / GalaxyMap.
 * Returns an SVG data URL so the browser never depends on PNG tiles.
 */

function mulberry32 (seed) {
  let t = (seed >>> 0) || 1;
  return function next () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed (str) {
  const s = String(str || 'space');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * @param {Object} [opts]
 * @param {string} [opts.seed]
 * @param {string} [opts.tint] CSS hex, used as SVG background
 * @param {string} [opts.nebula] soft blob colour
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 * @param {number} [opts.stars]
 * @returns {string} data:image/svg+xml URL
 */
function buildStarfieldDataUrl (opts = {}) {
  const w = Math.max(64, Math.min(1024, Number(opts.width) || 400));
  const h = Math.max(64, Math.min(1024, Number(opts.height) || 400));
  const tint = String(opts.tint || '#0b0e14');
  const nebula = String(opts.nebula || '#1a3050');
  const starCount = Math.max(40, Math.min(400, Number(opts.stars) || 160));
  const rand = mulberry32(hashSeed(opts.seed || tint + nebula));

  const blobs = [];
  for (let i = 0; i < 4; i++) {
    const cx = Math.round(rand() * w);
    const cy = Math.round(rand() * h);
    const rx = Math.round(40 + rand() * (w * 0.35));
    const ry = Math.round(30 + rand() * (h * 0.3));
    const op = (0.18 + rand() * 0.28).toFixed(2);
    blobs.push(
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${nebula}" opacity="${op}"/>`
    );
  }

  const stars = [];
  for (let i = 0; i < starCount; i++) {
    const x = (rand() * w).toFixed(1);
    const y = (rand() * h).toFixed(1);
    const r = (0.3 + rand() * 1.4).toFixed(2);
    const op = (0.35 + rand() * 0.65).toFixed(2);
    stars.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="#e8eef8" opacity="${op}"/>`);
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="100%" height="100%" fill="${tint}"/>` +
    blobs.join('') +
    stars.join('') +
    `</svg>`;

  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/**
 * Resolve tint / nebula colours for a system code from an optional manifest.
 * @param {string} systemCode
 * @param {object|null} manifest
 */
function coloursForSystem (systemCode, manifest) {
  const code = String(systemCode || 'STANTON').toUpperCase();
  const defaults = (manifest && manifest.defaults) || {};
  const sys = (manifest && manifest.systems && manifest.systems[code]) || {};
  return {
    tint: sys.tint || defaults.tint || '#0b0e14',
    nebula: sys.nebulaTint ||
      (code === 'PYRO' ? '#5a2040' : code === 'NYX' ? '#204030' : '#1a3050'),
    starfield: sys.starfield || defaults.starfield || null,
    nebulaPath: sys.nebula || defaults.nebula || null
  };
}

module.exports = {
  buildStarfieldDataUrl,
  coloursForSystem,
  hashSeed
};
