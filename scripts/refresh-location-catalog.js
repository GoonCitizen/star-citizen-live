#!/usr/bin/env node
'use strict';

/**
 * Rebuild data/locations/catalog.json from the in-game starmap.
 *
 * Primary sources (already unpacked Data.p4k / DataForge via ScDataDumper):
 *   - Star Citizen Wiki locations API (named, localized, QT aliases)
 *   - StarCitizenWiki/scunpacked-data starmap.json (full Data.p4k dump)
 *
 * Local Data.p4k (optional): if you run unp4k + ScDataDumper yourself, pass
 *   --unpacked=/path/to/starmap.json
 * We do not unpack Data.p4k in this process (Windows unp4k, ~40GB archive).
 *
 * Usage: node scripts/refresh-location-catalog.js
 *        node scripts/refresh-location-catalog.js --unpacked=./starmap.json
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '..', 'data', 'locations', 'catalog.json');
const PAGE_SIZE = 100;
const LOC_BASE = 'https://api.star-citizen.wiki/api/locations';
const SYS_BASE = 'https://api.star-citizen.wiki/api/starsystems';
const UNPACKED_STARMAP =
  'https://raw.githubusercontent.com/StarCitizenWiki/scunpacked-data/master/starmap.json';

const BODY_TYPES = new Set(['STAR', 'PLANET', 'SATELLITE', 'JUMPPOINT', 'MANMADE', 'ASTEROID_BELT']);
const PLAYABLE_SYSTEMS = new Set(['STANTON', 'PYRO', 'NYX']);
const SKIP_TYPES = new Set(['YouAreHere']);

function slugify (value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isJunkName (name) {
  const n = String(name || '').trim();
  if (!n) return true;
  if (/UNINITIALIZED/i.test(n)) return true;
  if (/^TODO\b/i.test(n)) return true;
  return false;
}

function fetchJson (url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'GoonCitizen-location-catalog/1.1' }
    }, (res) => {
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

/**
 * Game.log QT tokens look like rs_ext_cru-leo1. Wiki tags look like CRU_L1.
 * @param {string} tag
 * @returns {string[]}
 */
function aliasesFromTag (tag) {
  const raw = String(tag || '').trim();
  if (!raw) return [];
  const out = new Set();
  const compact = raw.replace(/[\s-]+/g, '_');
  out.add(raw.toLowerCase());
  out.add(slugify(raw));
  out.add(compact.toLowerCase());
  const m = compact.match(/^([A-Za-z]{2,5})_L(\d+)$/i);
  if (m) {
    const code = m[1].toLowerCase();
    const n = m[2];
    out.add(`${code}-l${n}`);
    out.add(`${code} l${n}`);
    out.add(`${code.toUpperCase()}-L${n}`);
    out.add(`rs_ext_${code}-leo${n}`);
    out.add(`rs_ext_${code}_leo${n}`);
  }
  return [...out].filter(Boolean);
}

function aliasesFromName (name) {
  const n = String(name || '').trim();
  if (!n) return [];
  const out = new Set([slugify(n), n.toLowerCase()]);
  const m = n.match(/^([A-Za-z]{2,5})[-\s]L(\d+)\b/i);
  if (m) {
    for (const a of aliasesFromTag(`${m[1].toUpperCase()}_L${m[2]}`)) out.add(a);
  }
  return [...out];
}

function systemFromHierarchy (tag, starName, systemName) {
  if (systemName) return String(systemName).replace(/\s+System$/i, '');
  if (starName) return String(starName).replace(/\s+System$/i, '');
  const t = String(tag || '').trim();
  if (!t) return null;
  if (/^stanton/i.test(t)) return 'Stanton';
  if (/^pyro/i.test(t) || /^region[a-d]$/i.test(t)) return 'Pyro';
  if (/^nyx/i.test(t)) return 'Nyx';
  return t;
}

function isHotspot (typeName, hasResources) {
  if (typeName === 'Asteroid_ValidQT') return true;
  if (hasResources === true) return true;
  return false;
}

async function fetchPaged (base, extraQuery) {
  const all = [];
  let page = 1;
  let last = 1;
  do {
    const qs = extraQuery ? `&${extraQuery}` : '';
    const url = `${base}?page%5Bsize%5D=${PAGE_SIZE}&page%5Bnumber%5D=${page}${qs}`;
    process.stderr.write(`Fetching ${base.replace(/^https:\/\/[^/]+/, '')} page ${page}…\n`);
    const json = await fetchJson(url);
    const rows = Array.isArray(json.data) ? json.data : [];
    all.push(...rows);
    last = (json.meta && json.meta.last_page) || page;
    page += 1;
  } while (page <= last);
  return all;
}

async function fetchPlayableSystems () {
  const systems = [];
  for (const code of PLAYABLE_SYSTEMS) {
    process.stderr.write(`Fetching starsystem ${code}…\n`);
    try {
      const json = await fetchJson(`${SYS_BASE}/${encodeURIComponent(code)}?include=celestialObjects`);
      const data = json.data || json;
      if (!data || !data.code) continue;
      const bodies = [];
      for (const o of (data.celestial_objects || [])) {
        if (!o) continue;
        const type = String(o.type || '').toUpperCase();
        if (!BODY_TYPES.has(type)) continue;
        bodies.push({
          code: o.code ? String(o.code) : null,
          name: o.name ? String(o.name) : (o.designation ? String(o.designation) : null),
          type,
          designation: o.designation ? String(o.designation) : null,
          distance: typeof o.distance === 'number' ? o.distance : null,
          latitude: typeof o.latitude === 'number' ? o.latitude : null,
          longitude: typeof o.longitude === 'number' ? o.longitude : null,
          parentId: o.parent_id != null ? o.parent_id : null,
          id: o.id
        });
      }
      systems.push({
        id: data.id,
        code: String(data.code),
        name: String(data.name || data.code),
        position: data.position && typeof data.position === 'object'
          ? {
            x: Number(data.position.x) || 0,
            y: Number(data.position.y) || 0,
            z: Number(data.position.z) || 0
          }
          : null,
        bodies
      });
    } catch (e) {
      process.stderr.write(`  skip ${code}: ${e.message}\n`);
    }
  }
  return systems;
}

function uniqueSlug (base, uuid, bySlug) {
  let slug = slugify(base) || (uuid ? String(uuid).slice(0, 8) : '');
  if (!slug) return null;
  if (!bySlug.has(slug)) return slug;
  const short = String(uuid || '').replace(/-/g, '').slice(0, 8);
  if (short) {
    const alt = `${slug}-${short}`;
    if (!bySlug.has(alt)) return alt;
  }
  let n = 2;
  while (bySlug.has(`${slug}-${n}`)) n += 1;
  return `${slug}-${n}`;
}

function mergeAliases (entry, extra) {
  const set = new Set(entry.aliases || []);
  for (const a of extra || []) {
    if (a && a !== entry.slug) set.add(a);
  }
  entry.aliases = [...set].sort();
}

function putEntry (bySlug, byUuid, entry) {
  if (!entry || !entry.slug) return;
  if (entry.uuid) {
    const prev = byUuid.get(entry.uuid);
    if (prev) {
      mergeAliases(prev, entry.aliases.concat([entry.slug, entry.name && entry.name.toLowerCase()]));
      if (!prev.quantum && entry.quantum) prev.quantum = true;
      if (!prev.hotspot && entry.hotspot) prev.hotspot = true;
      if (!prev.parent && entry.parent) prev.parent = entry.parent;
      if (!prev.system && entry.system) prev.system = entry.system;
      if (!prev.tag && entry.tag) prev.tag = entry.tag;
      return;
    }
    byUuid.set(entry.uuid, entry);
  }
  bySlug.set(entry.slug, entry);
}

function wikiToEntry (loc) {
  const name = String(loc.name || localize(loc.name) || '').replace(/\s+/g, ' ').trim();
  if (isJunkName(name)) return null;
  const typeName = loc.type && loc.type.name ? String(loc.type.name) : null;
  if (typeName && SKIP_TYPES.has(typeName)) return null;
  const wikiSlug = loc.slug ? String(loc.slug).toLowerCase() : slugify(name);
  if (!wikiSlug) return null;
  const tag = loc.tag && loc.tag.name ? String(loc.tag.name) : null;
  const parent = loc.parent && loc.parent.name && !isJunkName(loc.parent.name)
    ? String(loc.parent.name)
    : null;
  const star = loc.star && loc.star.name ? String(loc.star.name) : null;
  const systemName = systemFromHierarchy(tag, star, loc.system);
  const quantum = !!(loc.type && loc.type.valid_quantum_travel_destination);
  const aliases = new Set([
    ...aliasesFromName(name),
    ...aliasesFromTag(tag),
    wikiSlug
  ]);
  if (loc.designation) aliases.add(slugify(loc.designation));
  return {
    uuid: loc.uuid ? String(loc.uuid) : null,
    slug: wikiSlug,
    name,
    type: typeName,
    classification: loc.type && loc.type.classification ? String(loc.type.classification) : null,
    system: systemName,
    parent,
    star,
    tag,
    designation: loc.designation ? String(loc.designation) : null,
    quantum,
    hotspot: isHotspot(typeName, loc.has_resources),
    hideInStarmap: loc.hide_in_starmap === true,
    aliases: [...aliases].filter((a) => a && a !== wikiSlug).sort(),
    source: 'wiki'
  };
}

function unpackedToEntry (row, uuidNames, bySlug) {
  const name = String(row.Name || '').replace(/\s+/g, ' ').trim();
  if (isJunkName(name)) return null;
  const type = row.Type || {};
  const typeName = type.Name ? String(type.Name) : null;
  if (typeName && SKIP_TYPES.has(typeName)) return null;
  const uuid = row.UUID ? String(row.UUID) : null;
  const slug = uniqueSlug(name, uuid, bySlug);
  if (!slug) return null;
  const tag = row.LocationHierarchyTag && row.LocationHierarchyTag.Name
    ? String(row.LocationHierarchyTag.Name)
    : null;
  const parentUuid = row.ParentUUID ? String(row.ParentUUID) : null;
  const parent = parentUuid && uuidNames.get(parentUuid) && !isJunkName(uuidNames.get(parentUuid))
    ? uuidNames.get(parentUuid)
    : null;
  const quantum = type.ValidQuantumTravelDestination === true;
  const aliases = new Set([
    ...aliasesFromName(name),
    ...aliasesFromTag(tag)
  ]);
  return {
    uuid,
    slug,
    name,
    type: typeName,
    classification: type.Classification && !isJunkName(type.Classification)
      ? String(type.Classification)
      : null,
    system: systemFromHierarchy(tag, null, null),
    parent,
    star: null,
    tag,
    designation: null,
    quantum,
    hotspot: isHotspot(typeName, false),
    hideInStarmap: row.HideInStarmap === true,
    aliases: [...aliases].filter((a) => a && a !== slug).sort(),
    source: 'unpacked'
  };
}

function parseArgs (argv) {
  const out = { unpacked: null, skipUnpacked: false };
  for (const a of argv.slice(2)) {
    if (a === '--skip-unpacked') out.skipUnpacked = true;
    else if (a.startsWith('--unpacked=')) out.unpacked = a.slice('--unpacked='.length);
  }
  return out;
}

async function loadUnpackedRows (opts) {
  if (opts.skipUnpacked) return [];
  if (opts.unpacked) {
    const p = path.resolve(opts.unpacked);
    process.stderr.write(`Reading local unpacked starmap ${p}…\n`);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  process.stderr.write('Fetching scunpacked-data starmap.json (Data.p4k dump)…\n');
  const rows = await fetchJson(UNPACKED_STARMAP);
  return Array.isArray(rows) ? rows : [];
}

async function main () {
  const opts = parseArgs(process.argv);
  const [rawLocations, systems, unpackedRows] = await Promise.all([
    fetchPaged(LOC_BASE, ''),
    fetchPlayableSystems(),
    loadUnpackedRows(opts).catch((e) => {
      process.stderr.write(`  unpacked starmap skipped: ${e.message}\n`);
      return [];
    })
  ]);

  const bySlug = new Map();
  const byUuid = new Map();
  const versions = new Map();
  for (const loc of rawLocations) {
    if (loc && loc.version) {
      versions.set(loc.version, (versions.get(loc.version) || 0) + 1);
    }
    const entry = wikiToEntry(loc);
    if (!entry) continue;
    putEntry(bySlug, byUuid, entry);
  }

  const uuidNames = new Map();
  for (const row of unpackedRows || []) {
    if (row && row.UUID && row.Name && !isJunkName(row.Name)) {
      uuidNames.set(String(row.UUID), String(row.Name).replace(/\s+/g, ' ').trim());
    }
  }
  let unpackedAdded = 0;
  for (const row of unpackedRows || []) {
    const uuid = row && row.UUID ? String(row.UUID) : '';
    const known = uuid && byUuid.has(uuid);
    const entry = unpackedToEntry(row, uuidNames, bySlug);
    if (!entry) continue;
    putEntry(bySlug, byUuid, entry);
    if (!known) unpackedAdded += 1;
  }

  const locations = [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
  let gameVersion = null;
  let best = 0;
  for (const [v, n] of versions) {
    if (n > best) {
      best = n;
      gameVersion = v;
    }
  }

  const sources = ['https://api.star-citizen.wiki/api/locations'];
  if ((unpackedRows || []).length) sources.push(UNPACKED_STARMAP);

  const out = {
    type: 'GoonCitizenLocationCatalog',
    version: 2,
    source: sources,
    gameVersion,
    generatedAt: new Date().toISOString(),
    count: locations.length,
    systems,
    locations
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  process.stderr.write(
    `Wrote ${locations.length} locations / ${systems.length} systems` +
    (unpackedAdded ? ` (+${unpackedAdded} unpacked-only)` : '') +
    (gameVersion ? ` [${gameVersion}]` : '') +
    ` → ${OUT}\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
