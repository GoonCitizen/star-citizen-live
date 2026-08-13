#!/usr/bin/env node
'use strict';

/**
 * Rebuild data/ships/catalog.json from the Star Citizen Wiki vehicles API
 * (https://api.star-citizen.wiki/api/vehicles), merging short aliases so
 * Starjump / FleetViewer slugs still resolve.
 *
 * Usage: node scripts/refresh-ship-catalog.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '..', 'data', 'ships', 'catalog.json');
const PAGE_SIZE = 100;
const BASE = 'https://api.star-citizen.wiki/api/vehicles';

function slugify (value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function fetchJson (url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: 'application/json', 'User-Agent': 'GoonCitizen-ship-catalog/1.0' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function localize (field) {
  if (!field) return null;
  if (typeof field === 'string') return field;
  return field.en_EN || field.en || Object.values(field)[0] || null;
}

async function fetchAllVehicles () {
  const all = [];
  let page = 1;
  let last = 1;
  do {
    const url = `${BASE}?page%5Bsize%5D=${PAGE_SIZE}&page%5Bnumber%5D=${page}`;
    process.stderr.write(`Fetching wiki vehicles page ${page}…\n`);
    const json = await fetchJson(url);
    const rows = Array.isArray(json.data) ? json.data : [];
    all.push(...rows);
    last = (json.meta && json.meta.last_page) || page;
    page += 1;
  } while (page <= last);
  return all;
}

function loadExistingAliases () {
  try {
    const raw = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const map = new Map();
    for (const s of (raw.ships || [])) {
      if (!s || !s.slug) continue;
      map.set(s.slug, s);
    }
    return map;
  } catch (_) {
    return new Map();
  }
}

function shortSlugFromName (name) {
  // "Cutlass Black" → cutlass-black; "Avenger Stalker" → avenger-stalker
  return slugify(name);
}

async function main () {
  const vehicles = await fetchAllVehicles();
  const previous = loadExistingAliases();
  const bySlug = new Map();

  for (const v of vehicles) {
    if (!v || !v.name || !v.slug) continue;
    // Skip pure ground/power-suit noise unless it has a useful class_name for logs.
    const name = String(v.name).replace(/\s+/g, ' ').trim();
    const wikiSlug = String(v.slug).toLowerCase();
    const className = v.class_name ? String(v.class_name) : null;
    const mfg = v.manufacturer && v.manufacturer.name ? String(v.manufacturer.name) : null;
    const mfgCode = v.manufacturer && v.manufacturer.code ? String(v.manufacturer.code) : null;
    const short = shortSlugFromName(name);
    const aliases = new Set([short, wikiSlug]);
    // Preserve prior short Starjump slugs when names match.
    for (const [oldSlug, old] of previous) {
      if (!old || !old.name) continue;
      const oldName = String(old.name).split('\n')[0].trim().toLowerCase();
      if (oldName === name.toLowerCase() || slugify(oldName) === short) {
        aliases.add(oldSlug);
      }
    }

    const entry = {
      slug: wikiSlug,
      name,
      manufacturer: mfg,
      codes: mfgCode ? [mfgCode] : [],
      className,
      aliases: [...aliases].filter((a) => a && a !== wikiSlug).sort(),
      sources: ['star-citizen-wiki'],
      type: localize(v.type),
      size: localize(v.size),
      isSpaceship: v.is_spaceship === true
    };

    // Prefer spaceships when duplicate slug collisions occur.
    const prev = bySlug.get(wikiSlug);
    if (prev && prev.isSpaceship && !entry.isSpaceship) continue;
    bySlug.set(wikiSlug, entry);
  }

  // Alias index entries: short slug → same ship (for resolveShip)
  // Stored as separate lightweight rows only when short !== wiki slug and unused.
  const ships = [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
  const used = new Set(ships.map((s) => s.slug));
  for (const s of ships.slice()) {
    for (const alias of s.aliases || []) {
      if (!alias || used.has(alias)) continue;
      used.add(alias);
      // Do not duplicate full rows — resolveShip will walk aliases.
    }
  }

  const out = {
    type: 'GoonCitizenShipCatalog',
    version: 2,
    source: 'https://api.star-citizen.wiki/api/vehicles',
    generatedAt: new Date().toISOString(),
    count: ships.length,
    ships: ships.map((s) => ({
      slug: s.slug,
      name: s.name,
      manufacturer: s.manufacturer,
      codes: s.codes,
      className: s.className,
      aliases: s.aliases,
      sources: s.sources,
      type: s.type,
      size: s.size,
      isSpaceship: s.isSpaceship
    }))
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  process.stderr.write(`Wrote ${ships.length} ships → ${OUT}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
