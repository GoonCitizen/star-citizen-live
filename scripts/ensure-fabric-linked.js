'use strict';

/**
 * Repair npm 12 git-dep layout: empty `node_modules/@fabric/{core,http,hub}`
 * next to hashed checkouts (`.core-*`, `.http-*`, `.hub-*`).
 *
 * `npm test` / `test:ui` / `test:unit` / `test:relay` run this first.
 * Override trees with FABRIC_CORE, FABRIC_HTTP, FABRIC_HUB.
 * `--force` (or `npm run link:fabric`) relinks even when resolve already works.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const fabricDir = path.join(root, 'node_modules', '@fabric');
const force = process.argv.includes('--force') || process.env.FABRIC_LINK_FORCE === '1';

const PACKAGES = [
  {
    name: 'core',
    dest: path.join(fabricDir, 'core'),
    env: 'FABRIC_CORE',
    hashed: '.core-',
    siblings: ['fabric-clean', 'fabric'],
    probe: '@fabric/core/types/key'
  },
  {
    name: 'http',
    dest: path.join(fabricDir, 'http'),
    env: 'FABRIC_HTTP',
    hashed: '.http-',
    siblings: ['fabric-http'],
    probe: '@fabric/http/functions/fabricPubkey'
  },
  {
    name: 'hub',
    dest: path.join(fabricDir, 'hub'),
    env: 'FABRIC_HUB',
    hashed: '.hub-',
    siblings: ['hub.fabric.pub'],
    probe: '@fabric/hub/functions/peerIdentity'
  }
];

function isPackage (dir) {
  try {
    return fs.existsSync(path.join(dir, 'package.json'));
  } catch (_) {
    return false;
  }
}

function probeOk (spec) {
  try {
    require.resolve(spec);
    return true;
  } catch (_) {
    return false;
  }
}

function realPackage (dir) {
  try {
    if (!fs.existsSync(dir)) return null;
    const real = fs.realpathSync(dir);
    return isPackage(real) ? real : null;
  } catch (_) {
    return null;
  }
}

function destNeedsLink (dest) {
  if (force) return true;
  try {
    const st = fs.lstatSync(dest);
    if (st.isSymbolicLink()) return !realPackage(dest);
    if (!st.isDirectory()) return true;
    return !isPackage(dest);
  } catch (e) {
    if (e && e.code === 'ENOENT') return true;
    throw e;
  }
}

function findHashed (prefix) {
  try {
    return fs.readdirSync(fabricDir)
      .filter((n) => n.indexOf(prefix) === 0)
      .map((n) => path.join(fabricDir, n))
      .filter((p) => realPackage(p));
  } catch (_) {
    return [];
  }
}

function findTarget (pkg) {
  if (process.env[pkg.env]) {
    const fromEnv = path.resolve(process.env[pkg.env]);
    if (isPackage(fromEnv)) return fromEnv;
  }
  const hashed = findHashed(pkg.hashed);
  if (hashed.length) return fs.realpathSync(hashed[0]);
  const home = os.homedir();
  const parent = path.join(root, '..');
  for (const sib of pkg.siblings) {
    for (const base of [home, parent]) {
      const candidate = path.join(base, sib);
      if (isPackage(candidate)) return candidate;
    }
  }
  return null;
}

function replaceWithSymlink (dest, target) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.rmSync(dest, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
  fs.symlinkSync(target, dest);
}

function allProbesOk () {
  return PACKAGES.every((pkg) => probeOk(pkg.probe));
}

if (!force && allProbesOk()) process.exit(0);

let repaired = false;
for (const pkg of PACKAGES) {
  if (!destNeedsLink(pkg.dest) && probeOk(pkg.probe)) continue;
  const target = findTarget(pkg);
  if (!target) {
    console.error(`[ensure-fabric-linked] cannot find @fabric/${pkg.name}`);
    console.error(`  Set ${pkg.env}, or npm i --allow-git=all, or clone ${pkg.siblings[0]} next to this repo.`);
    process.exit(1);
  }
  if (realPackage(pkg.dest) === path.resolve(target) && probeOk(pkg.probe) && !force) continue;
  replaceWithSymlink(pkg.dest, path.resolve(target));
  repaired = true;
  console.log(`[ensure-fabric-linked] linked @fabric/${pkg.name} → ${path.resolve(target)}`);
}

if (!allProbesOk()) {
  for (const pkg of PACKAGES) {
    if (!probeOk(pkg.probe)) {
      console.error(`[ensure-fabric-linked] still cannot resolve ${pkg.probe}`);
    }
  }
  process.exit(1);
}

if (repaired) console.log('[ensure-fabric-linked] Fabric packages resolve.');
process.exit(0);
