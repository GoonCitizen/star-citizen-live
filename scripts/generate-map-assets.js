'use strict';

/**
 * Write small procedural map tiles (512² PNG) under assets/map/tiles/.
 * No external deps — zlib + a minimal PNG encoder. Re-run anytime;
 * optional Screaming Brain CC0 drops can overwrite the same filenames.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets', 'map', 'tiles');
const SIZE = 512;

function crc32 (buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk (type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng (width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * stride, y * stride + stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function mulberry32 (seed) {
  let t = seed >>> 0;
  return function next () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom (name) {
  const h = crypto.createHash('sha256').update(name).digest();
  return h.readUInt32LE(0);
}

function fillBase (rgba, r, g, b) {
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  }
}

function addStars (rgba, rand, count, brightness) {
  for (let n = 0; n < count; n++) {
    const x = Math.floor(rand() * SIZE);
    const y = Math.floor(rand() * SIZE);
    const bright = Math.floor(180 + rand() * brightness);
    const i = (y * SIZE + x) * 4;
    rgba[i] = Math.min(255, rgba[i] + bright);
    rgba[i + 1] = Math.min(255, rgba[i + 1] + bright);
    rgba[i + 2] = Math.min(255, rgba[i + 2] + bright);
    if (rand() > 0.85) {
      const r = 1 + Math.floor(rand() * 2);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const xx = (x + dx + SIZE) % SIZE;
          const yy = (y + dy + SIZE) % SIZE;
          const j = (yy * SIZE + xx) * 4;
          const fall = 1 - Math.sqrt(dx * dx + dy * dy) / (r + 1);
          const add = Math.floor(bright * 0.35 * fall);
          rgba[j] = Math.min(255, rgba[j] + add);
          rgba[j + 1] = Math.min(255, rgba[j + 1] + add);
          rgba[j + 2] = Math.min(255, rgba[j + 2] + add);
        }
      }
    }
  }
}

function addNebula (rgba, rand, tint) {
  const blobs = 5 + Math.floor(rand() * 4);
  for (let b = 0; b < blobs; b++) {
    const cx = rand() * SIZE;
    const cy = rand() * SIZE;
    const rx = 60 + rand() * 140;
    const ry = 50 + rand() * 120;
    const strength = 0.12 + rand() * 0.22;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const d = dx * dx + dy * dy;
        if (d > 1.8) continue;
        const fall = Math.exp(-d * 1.6) * strength;
        const i = (y * SIZE + x) * 4;
        rgba[i] = Math.min(255, rgba[i] + Math.floor(tint[0] * fall));
        rgba[i + 1] = Math.min(255, rgba[i + 1] + Math.floor(tint[1] * fall));
        rgba[i + 2] = Math.min(255, rgba[i + 2] + Math.floor(tint[2] * fall));
      }
    }
  }
}

function makeTile (name, opts) {
  const rand = mulberry32(seedFrom(name));
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  fillBase(rgba, opts.base[0], opts.base[1], opts.base[2]);
  if (opts.nebula) addNebula(rgba, rand, opts.nebula);
  addStars(rgba, rand, opts.stars || 900, opts.starBright || 70);
  return encodePng(SIZE, SIZE, rgba);
}

function makeSurface (name, palette, size) {
  const dim = size || 256;
  const rand = mulberry32(seedFrom(name));
  const rgba = Buffer.alloc(dim * dim * 4);
  const [br, bg, bb] = palette.base;
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = br;
    rgba[i + 1] = bg;
    rgba[i + 2] = bb;
    rgba[i + 3] = 255;
  }
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const n =
        Math.sin(x * 0.04 + rand() * 0.1) * Math.cos(y * 0.05) +
        Math.sin((x + y) * 0.03) * 0.5;
      const i = (y * dim + x) * 4;
      if (n > palette.threshold) {
        rgba[i] = Math.min(255, rgba[i] + palette.hi[0]);
        rgba[i + 1] = Math.min(255, rgba[i + 1] + palette.hi[1]);
        rgba[i + 2] = Math.min(255, rgba[i + 2] + palette.hi[2]);
      } else if (n < -palette.threshold) {
        rgba[i] = Math.max(0, rgba[i] - palette.lo[0]);
        rgba[i + 1] = Math.max(0, rgba[i + 1] - palette.lo[1]);
        rgba[i + 2] = Math.max(0, rgba[i + 2] - palette.lo[2]);
      }
      const j = Math.floor((rand() - 0.5) * 14);
      rgba[i] = Math.min(255, Math.max(0, rgba[i] + j));
      rgba[i + 1] = Math.min(255, Math.max(0, rgba[i + 1] + j));
      rgba[i + 2] = Math.min(255, Math.max(0, rgba[i + 2] + j));
    }
  }
  if (palette.glow) {
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const dx = (x - dim / 2) / (dim / 2);
        const dy = (y - dim / 2) / (dim / 2);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1) continue;
        const fall = Math.pow(1 - d, 1.5) * 0.35;
        const i = (y * dim + x) * 4;
        rgba[i] = Math.min(255, rgba[i] + Math.floor(palette.glow[0] * fall));
        rgba[i + 1] = Math.min(255, rgba[i + 1] + Math.floor(palette.glow[1] * fall));
        rgba[i + 2] = Math.min(255, rgba[i + 2] + Math.floor(palette.glow[2] * fall));
      }
    }
  }
  return encodePng(dim, dim, rgba);
}

/**
 * Equirectangular body terrain (lon −180…180 × lat −90…90).
 * Distinct per-body recipes so POI browsing has readable surface context.
 */
function makeBodyEquirect (slug, recipe, width, height) {
  const w = width || 512;
  const h = height || 256;
  const rand = mulberry32(seedFrom('body:' + slug));
  const rgba = Buffer.alloc(w * h * 4);
  const base = recipe.base || [100, 80, 60];
  const hi = recipe.hi || [40, 30, 20];
  const lo = recipe.lo || [30, 20, 15];
  const iceCaps = recipe.iceCaps === true ? 0.45 : Number(recipe.iceCaps) || 0;
  const cities = recipe.cities === true ? 0.55 : Number(recipe.cities) || 0;

  for (let y = 0; y < h; y++) {
    const lat = 90 - (y / (h - 1)) * 180;
    const latN = lat / 90;
    for (let x = 0; x < w; x++) {
      const lon = -180 + (x / (w - 1)) * 360;
      const lonR = lon * Math.PI / 180;
      const latR = lat * Math.PI / 180;
      let n =
        Math.sin(lonR * 3 + latR * 2) * 0.45 +
        Math.sin(lonR * 7 - latR * 5) * 0.25 +
        Math.sin((lon + lat * 1.7) * 0.04) * 0.3;
      if (recipe.bands) {
        n = Math.sin(latR * 8 + Math.sin(lonR * 2) * 0.4) * 0.8;
      }
      if (recipe.sand) {
        n += Math.sin(lonR * 11 + latR * 3) * 0.15;
      }
      const i = (y * w + x) * 4;
      let r = base[0];
      let g = base[1];
      let b = base[2];
      if (n > 0.2) {
        r = Math.min(255, r + hi[0]);
        g = Math.min(255, g + hi[1]);
        b = Math.min(255, b + hi[2]);
      } else if (n < -0.25) {
        r = Math.max(0, r - lo[0]);
        g = Math.max(0, g - lo[1]);
        b = Math.max(0, b - lo[2]);
      }
      if (iceCaps && Math.abs(latN) > 1 - iceCaps) {
        const t = (Math.abs(latN) - (1 - iceCaps)) / iceCaps;
        r = Math.floor(r * (1 - t) + 230 * t);
        g = Math.floor(g * (1 - t) + 238 * t);
        b = Math.floor(b * (1 - t) + 245 * t);
      }
      if (recipe.haze) {
        const haze = 0.12 + 0.08 * Math.sin(latR * 2);
        r = Math.min(255, Math.floor(r * (1 - haze) + recipe.haze[0] * haze));
        g = Math.min(255, Math.floor(g * (1 - haze) + recipe.haze[1] * haze));
        b = Math.min(255, Math.floor(b * (1 - haze) + recipe.haze[2] * haze));
      }
      const j = Math.floor((rand() - 0.5) * 12);
      rgba[i] = Math.min(255, Math.max(0, r + j));
      rgba[i + 1] = Math.min(255, Math.max(0, g + j));
      rgba[i + 2] = Math.min(255, Math.max(0, b + j));
      rgba[i + 3] = 255;
    }
  }

  if (recipe.craters) {
    const count = 18 + Math.floor(rand() * 22);
    for (let c = 0; c < count; c++) {
      const cx = rand() * w;
      const cy = rand() * h;
      const rr = 3 + rand() * 14;
      for (let y = Math.floor(cy - rr - 1); y <= cy + rr + 1; y++) {
        for (let x = Math.floor(cx - rr - 1); x <= cx + rr + 1; x++) {
          if (y < 0 || y >= h) continue;
          const xx = (x + w) % w;
          const dx = x - cx;
          const dy = y - cy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > rr) continue;
          const i = (y * w + xx) * 4;
          const rim = Math.abs(d - rr * 0.85) < 1.2;
          const floor = d < rr * 0.7;
          if (rim) {
            rgba[i] = Math.min(255, rgba[i] + 28);
            rgba[i + 1] = Math.min(255, rgba[i + 1] + 22);
            rgba[i + 2] = Math.min(255, rgba[i + 2] + 16);
          } else if (floor) {
            rgba[i] = Math.max(0, rgba[i] - 32);
            rgba[i + 1] = Math.max(0, rgba[i + 1] - 28);
            rgba[i + 2] = Math.max(0, rgba[i + 2] - 24);
          }
        }
      }
    }
  }

  if (recipe.lava) {
    for (let n = 0; n < 40; n++) {
      const cx = rand() * w;
      const cy = rand() * h;
      const rr = 2 + rand() * 8;
      for (let y = Math.floor(cy - rr); y <= cy + rr; y++) {
        for (let x = Math.floor(cx - rr); x <= cx + rr; x++) {
          if (y < 0 || y >= h) continue;
          const xx = (x + w) % w;
          const d = Math.hypot(x - cx, y - cy);
          if (d > rr) continue;
          const i = (y * w + xx) * 4;
          const t = 1 - d / rr;
          rgba[i] = Math.min(255, rgba[i] + Math.floor(180 * t));
          rgba[i + 1] = Math.min(255, rgba[i + 1] + Math.floor(40 * t));
          rgba[i + 2] = Math.max(0, rgba[i + 2] - Math.floor(20 * t));
        }
      }
    }
  }

  if (cities > 0) {
    const count = Math.floor(30 + cities * 80);
    for (let n = 0; n < count; n++) {
      const x = Math.floor(rand() * w);
      const y = Math.floor(h * (0.25 + rand() * 0.5));
      const i = (y * w + x) * 4;
      rgba[i] = Math.min(255, 180 + Math.floor(rand() * 75));
      rgba[i + 1] = Math.min(255, 160 + Math.floor(rand() * 60));
      rgba[i + 2] = Math.min(255, 90 + Math.floor(rand() * 40));
    }
  }

  if (recipe.glow) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const lat = 90 - (y / (h - 1)) * 180;
        const fall = Math.pow(1 - Math.abs(lat) / 90, 1.8) * 0.2;
        const i = (y * w + x) * 4;
        rgba[i] = Math.min(255, rgba[i] + Math.floor(recipe.glow[0] * fall));
        rgba[i + 1] = Math.min(255, rgba[i + 1] + Math.floor(recipe.glow[1] * fall));
        rgba[i + 2] = Math.min(255, rgba[i + 2] + Math.floor(recipe.glow[2] * fall));
      }
    }
  }

  return encodePng(w, h, rgba);
}

const TILES = [
  {
    file: 'starfield-01.png',
    opts: { base: [8, 10, 18], stars: 1400, starBright: 80 }
  },
  {
    file: 'starfield-02.png',
    opts: { base: [6, 8, 14], stars: 1100, starBright: 75 }
  },
  {
    file: 'nebula-blue-01.png',
    opts: { base: [6, 10, 22], nebula: [40, 90, 200], stars: 700, starBright: 55 }
  },
  {
    file: 'nebula-purple-01.png',
    opts: { base: [18, 6, 14], nebula: [160, 40, 120], stars: 650, starBright: 50 }
  },
  {
    file: 'nebula-green-01.png',
    opts: { base: [6, 16, 12], nebula: [40, 140, 90], stars: 680, starBright: 55 }
  }
];

const SURFACES = [
  {
    file: 'surface-rocky.png',
    palette: {
      base: [92, 68, 48],
      hi: [40, 28, 18],
      lo: [30, 22, 16],
      threshold: 0.25
    }
  },
  {
    file: 'surface-ice.png',
    palette: {
      base: [180, 200, 220],
      hi: [40, 40, 50],
      lo: [50, 40, 30],
      threshold: 0.2
    }
  },
  {
    file: 'surface-gas.png',
    palette: {
      base: [180, 120, 70],
      hi: [50, 30, 10],
      lo: [40, 40, 50],
      threshold: 0.15,
      glow: [255, 180, 80]
    }
  },
  {
    file: 'surface-arid.png',
    palette: {
      base: [140, 110, 80],
      hi: [35, 25, 15],
      lo: [40, 30, 25],
      threshold: 0.22
    }
  },
  {
    file: 'surface-volcanic.png',
    palette: {
      base: [60, 28, 24],
      hi: [80, 20, 10],
      lo: [20, 10, 10],
      threshold: 0.18,
      glow: [220, 60, 20]
    }
  },
  {
    file: 'surface-industrial.png',
    palette: {
      base: [70, 78, 88],
      hi: [40, 45, 55],
      lo: [25, 25, 30],
      threshold: 0.3
    }
  },
  {
    file: 'surface-star.png',
    palette: {
      base: [255, 210, 90],
      hi: [40, 20, 0],
      lo: [20, 40, 60],
      threshold: 0.12,
      glow: [255, 240, 160]
    }
  }
];

function main () {
  const bodyTerrain = require('../functions/bodyTerrain');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const bodiesDir = path.join(OUT_DIR, 'bodies');
  fs.mkdirSync(bodiesDir, { recursive: true });

  for (const tile of TILES) {
    const buf = makeTile(tile.file, tile.opts);
    const dest = path.join(OUT_DIR, tile.file);
    fs.writeFileSync(dest, buf);
    process.stdout.write(`Wrote ${path.relative(ROOT, dest)} (${buf.length} bytes)\n`);
  }
  for (const surf of SURFACES) {
    const buf = makeSurface(surf.file, surf.palette, 256);
    const dest = path.join(OUT_DIR, surf.file);
    fs.writeFileSync(dest, buf);
    process.stdout.write(`Wrote ${path.relative(ROOT, dest)} (${buf.length} bytes)\n`);
  }

  const bodyManifest = {};
  for (const slug of bodyTerrain.listKnownBodySlugs()) {
    const recipe = bodyTerrain.recipeForSlug(slug);
    const buf = makeBodyEquirect(slug, recipe, 512, 256);
    const dest = path.join(bodiesDir, slug + '.png');
    fs.writeFileSync(dest, buf);
    bodyManifest[slug] = 'tiles/bodies/' + slug + '.png';
    process.stdout.write(`Wrote ${path.relative(ROOT, dest)} (${buf.length} bytes)\n`);
  }

  const manifestPath = path.join(ROOT, 'assets', 'map', 'manifest.json');
  let manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (_) {
    manifest = { version: 3 };
  }
  manifest.version = Math.max(3, Number(manifest.version) || 3);
  manifest.bodies = bodyManifest;
  manifest.surfaces = manifest.surfaces || {
    rocky: 'tiles/surface-rocky.png',
    ice: 'tiles/surface-ice.png',
    gas: 'tiles/surface-gas.png',
    arid: 'tiles/surface-arid.png',
    volcanic: 'tiles/surface-volcanic.png',
    industrial: 'tiles/surface-industrial.png',
    star: 'tiles/surface-star.png'
  };
  manifest.projection = 'equirectangular';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  process.stdout.write(`Updated ${path.relative(ROOT, manifestPath)} (${Object.keys(bodyManifest).length} bodies)\n`);
}

main();
