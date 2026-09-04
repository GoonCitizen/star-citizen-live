'use strict';

/**
 * Refresh cached starmap.space object-container + POI JSON into data/starmap/.
 *
 *   node scripts/refresh-starmap-space.js
 *
 * Credits: https://starmap.space (Meridian / Eureka). Community-maintained;
 * not CIG official. Use for lat/lon / local XYZ only — not their terrain art.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '..', 'data', 'starmap');
const UA = 'GoonCitizenMap/0.1 (+https://goon.vc; starmap.space cache refresh)';

function fetchJson (url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json'
      }
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchJson(res.headers.location).then(resolve, reject);
        res.resume();
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(url + ' → HTTP ' + res.statusCode));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(90000, () => {
      req.destroy(new Error('timeout ' + url));
    });
  });
}

function sleep (ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main () {
  fs.mkdirSync(OUT, { recursive: true });
  process.stderr.write('Fetching object containers…\n');
  const oc = await fetchJson('https://starmap.space/api/v2/oc/index.php');
  if (!Array.isArray(oc)) throw new Error('oc response not an array');
  fs.writeFileSync(path.join(OUT, 'oc.json'), JSON.stringify(oc));

  const bodies = [...new Set(
    oc
      .filter((x) => x && (x.Type === 'Planet' || x.Type === 'Moon'))
      .map((x) => x.ObjectContainer)
      .filter(Boolean)
  )].sort();

  const allPois = [];
  for (let i = 0; i < bodies.length; i++) {
    const name = bodies[i];
    const url = 'https://starmap.space/api/v2/pois/index.php?planet=' +
      encodeURIComponent(name);
    process.stderr.write(`  ${i + 1}/${bodies.length} ${name}…`);
    try {
      const data = await fetchJson(url);
      if (Array.isArray(data)) {
        allPois.push(...data);
        process.stderr.write(` ${data.length}\n`);
      } else {
        process.stderr.write(' (empty)\n');
      }
    } catch (e) {
      process.stderr.write(` FAIL ${e.message}\n`);
    }
    await sleep(150);
  }

  fs.writeFileSync(path.join(OUT, 'pois.json'), JSON.stringify(allPois));
  const meta = {
    source: 'https://starmap.space',
    credit: 'StarMap / Meridian (Eureka) — community object-container + POI database',
    apis: [
      'https://starmap.space/api/v2/oc/index.php',
      'https://starmap.space/api/v2/pois/index.php'
    ],
    bodies: bodies.length,
    pois: allPois.length,
    fetchedAt: new Date().toISOString().slice(0, 10),
    coordNotes: 'Local body coords in km; BodyRadius in meters. ' +
      'lat=asin(z/r), lon=atan2(-y,-x) degrees (matches API Latitude/Longitude).'
  };
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  process.stderr.write(`Wrote ${allPois.length} POIs + ${oc.length} OC rows → ${OUT}\n`);
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack || e) + '\n');
  process.exit(1);
});
