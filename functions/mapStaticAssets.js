'use strict';

/**
 * Narrow allowlist for Map tab static files (tiles + universe explorer bundle).
 * Path-traversal safe — exact names under assets/map and assets/scripts,
 * plus per-body terrain tiles under tiles/bodies/<slug>.png.
 */

const fs = require('fs');
const path = require('path');

const ASSETS_ROOT = path.join(__dirname, '..', 'assets');

const MAP_FILES = new Set([
  'manifest.json',
  'tiles/starfield-01.png',
  'tiles/starfield-02.png',
  'tiles/nebula-blue-01.png',
  'tiles/nebula-purple-01.png',
  'tiles/nebula-green-01.png',
  'tiles/surface-rocky.png',
  'tiles/surface-ice.png',
  'tiles/surface-gas.png',
  'tiles/surface-arid.png',
  'tiles/surface-volcanic.png',
  'tiles/surface-industrial.png',
  'tiles/surface-star.png'
]);

const BODY_TILE_RE = /^tiles\/bodies\/[a-z0-9][a-z0-9-]*\.png$/;

const SCRIPT_FILES = new Set([
  'universe-explorer.js'
]);

const MIME = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.js': 'application/javascript; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function isAllowedMapRel (rest) {
  if (MAP_FILES.has(rest)) return true;
  return BODY_TILE_RE.test(rest);
}

/**
 * @param {string} pathname URL pathname
 * @returns {{ abs: string, mime: string }|null}
 */
function resolveMapStatic (pathname) {
  const raw = String(pathname || '');
  let rel = null;
  let kind = null;

  if (raw === '/assets/map/manifest.json' || raw.startsWith('/assets/map/tiles/')) {
    const rest = raw.slice('/assets/map/'.length);
    if (!rest || rest.includes('..') || rest.includes('\\') || path.isAbsolute(rest)) {
      return null;
    }
    if (!isAllowedMapRel(rest)) return null;
    rel = path.join('map', rest);
    kind = 'map';
  } else if (raw === '/assets/scripts/universe-explorer.js') {
    rel = path.join('scripts', 'universe-explorer.js');
    kind = 'script';
  } else {
    return null;
  }

  if (kind === 'script' && !SCRIPT_FILES.has('universe-explorer.js')) return null;

  const abs = path.resolve(ASSETS_ROOT, rel);
  const rootResolved = path.resolve(ASSETS_ROOT);
  if (!abs.startsWith(rootResolved + path.sep) && abs !== rootResolved) return null;
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;

  const ext = path.extname(abs).toLowerCase();
  return { abs, mime: MIME[ext] || 'application/octet-stream' };
}

/**
 * Try to serve an allowlisted map/script asset. Returns true if handled.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 */
function tryServeMapStatic (req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const hit = resolveMapStatic(pathname);
  if (!hit) {
    if (/^\/assets\/map\//.test(pathname) || pathname === '/assets/scripts/universe-explorer.js') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return true;
    }
    return false;
  }
  try {
    const buf = fs.readFileSync(hit.abs);
    res.writeHead(200, {
      'Content-Type': hit.mime,
      'Content-Length': buf.length,
      'Cache-Control': 'public, max-age=86400'
    });
    if (req.method === 'HEAD') return res.end(), true;
    res.end(buf);
    return true;
  } catch (_) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return true;
  }
}

module.exports = {
  MAP_FILES,
  BODY_TILE_RE,
  SCRIPT_FILES,
  ASSETS_ROOT,
  isAllowedMapRel,
  resolveMapStatic,
  tryServeMapStatic
};
