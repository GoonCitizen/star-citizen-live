'use strict';

/**
 * Stage the Android local-first tree:
 *   - copy the built dashboard into android-www (offline UI)
 *   - copy LiveRelay sources into android-www/nodejs/app (embedded Node)
 *   - copy data/locations + data/ships catalogs (in-game starmap / ships)
 *   - copy Fabric runtime packages into android-www/nodejs/node_modules
 *   - patch the Capacitor Android project (fabric://, loopback cleartext)
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const www = path.join(root, 'android-www');
const nodeApp = path.join(www, 'nodejs', 'app');

const COPY_DIRS = ['scripts', 'services', 'functions', 'types', 'contracts', 'assets'];
const COPY_FILES = ['package.json', 'constants.js'];
// Bundled starmap / ship JSON (not personal fleet dumps under data/fleets).
const COPY_DATA_DIRS = ['locations', 'ships'];

const SKIP_BULKY = new Set([
  '.git', '.github', '.cursor', '.vscode', '.idea', 'docs', 'test', 'tests', '__tests__', 'coverage',
  'examples', 'libraries', 'components', 'android',
  'reports', 'jsdom', 'electron', 'prebuilds',
  // Linked local @fabric/{core,hub} trees (not published tarballs).
  'stores', '_book', 'logs', 'extension'
  // Do not skip `build/` — packages such as simple-aes ship main at build/index.js.
  // Do not skip `dist/` globally — valibot and others ship from dist/.
]);

const SKIP_SUITE_JUNK = new Set([
  'dist',   // Hub electron-builder output (~GB)
  'local'   // operator identity JSON
]);

const RUNTIME_PACKAGES = [
  '@fabric/core',
  '@fabric/http',
  '@fabric/hub',
  '@fabric/discord',
  'bip32',
  'bitcoinjs-lib',
  'cross-fetch',
  'ecpair',
  'lodash.merge',
  'qrcode',
  'tail',
  'tiny-secp256k1',
  // Nested through2@2 (noise-protocol-stream) requires this; npm hoists it
  // on the host so includeNodeModules never copies it into the APK tree.
  'xtend'
];

const SKIP_DEPS = new Set([
  'electron', 'screenshot-desktop', 'jsdom', 'puppeteer', 'mocha', 'c8',
  '@noble/hashes', '@noble/curves',
  // Capacitor libnode cannot dlopen classic-level's android N-API prebuild.
  'level', 'classic-level'
]);

function copyDir (src, dest, opts = {}) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name === '.git') continue;
    if (ent.name === 'node_modules' && !opts.includeNodeModules) continue;
    if (opts.skipBulky && (SKIP_BULKY.has(ent.name) || /^coverage(-|$)/.test(ent.name))) continue;
    if (opts.skipSuiteJunk && SKIP_SUITE_JUNK.has(ent.name)) continue;
    if (opts.skipAssets && ent.name === 'assets') continue;
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    // Nested `npm link` of suite packages: already staged at destRoot.
    if (ent.isSymbolicLink() &&
      /node_modules\/@fabric\/(core|http|hub)$/.test(from.replace(/\\/g, '/'))) {
      continue;
    }
    if (ent.isSymbolicLink()) {
      let real;
      try { real = fs.realpathSync(from); } catch (_) { continue; }
      let st;
      try { st = fs.statSync(real); } catch (_) { continue; }
      if (st.isDirectory()) copyDir(real, to, opts);
      else if (st.isFile() && !/\.node$/.test(ent.name)) fs.copyFileSync(real, to);
      continue;
    }
    if (ent.isFile() && /\.node$/.test(ent.name)) continue;
    if (ent.isDirectory()) copyDir(from, to, opts);
    else if (ent.isFile()) fs.copyFileSync(from, to);
  }
}

function packageSource (name) {
  return path.join(root, 'node_modules', ...String(name).split('/'));
}

function stagePackage (name, destRoot, seen) {
  if (seen.has(name) || SKIP_DEPS.has(name)) return;
  seen.add(name);
  const src = packageSource(name);
  if (!fs.existsSync(src) || !fs.existsSync(path.join(src, 'package.json'))) {
    console.warn('[ANDROID] missing runtime package', name);
    return;
  }
  const suite = name === '@fabric/core' || name === '@fabric/http' ||
    name === '@fabric/hub' || name === '@fabric/discord';
  copyDir(src, path.join(destRoot, ...String(name).split('/')), {
    // Linked local trees have a full desktop node_modules; APK ZIP is capped at 65535 entries.
    includeNodeModules: !suite,
    skipBulky: true,
    skipSuiteJunk: suite,
    skipAssets: suite && name !== '@fabric/discord'
  });
  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
  } catch (_) { return; }
  const deps = Object.assign({}, pkg.dependencies || {});
  for (const dep of Object.keys(deps)) stagePackage(dep, destRoot, seen);
}

function stageDashboard () {
  const built = path.join(root, 'assets', 'index.html');
  if (!fs.existsSync(built)) {
    console.warn('[ANDROID] assets/index.html missing — run npm run build:browser');
    return;
  }
  fs.mkdirSync(www, { recursive: true });
  fs.copyFileSync(built, path.join(www, 'index.html'));
  console.log('[ANDROID] copied dashboard → android-www/index.html');
}

function stageNodeApp () {
  fs.rmSync(nodeApp, { recursive: true, force: true });
  fs.mkdirSync(nodeApp, { recursive: true });
  for (const dir of COPY_DIRS) {
    const src = path.join(root, dir);
    if (!fs.existsSync(src)) continue;
    copyDir(src, path.join(nodeApp, dir));
  }
  for (const file of COPY_FILES) {
    const src = path.join(root, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(nodeApp, file));
  }
  for (const dir of COPY_DATA_DIRS) {
    const src = path.join(root, 'data', dir);
    if (!fs.existsSync(src)) {
      console.warn('[ANDROID] missing data/' + dir);
      continue;
    }
    copyDir(src, path.join(nodeApp, 'data', dir));
  }
  const example = path.join(root, 'settings', 'example.js');
  if (fs.existsSync(example)) {
    fs.mkdirSync(path.join(nodeApp, 'settings'), { recursive: true });
    fs.copyFileSync(example, path.join(nodeApp, 'settings', 'example.js'));
  }
  console.log('[ANDROID] staged LiveRelay sources + data catalogs → android-www/nodejs/app');
}

function stageBuiltinModules () {
  const src = path.join(root, 'node_modules', '@choreruiz', 'capacitor-node-js',
    'android', 'src', 'main', 'assets', 'builtin_modules');
  const dest = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'builtin_modules');
  if (!fs.existsSync(src) || !fs.existsSync(path.join(root, 'android', 'app'))) return;
  copyDir(src, dest);
  console.log('[ANDROID] copied Node builtin_modules → android/app/src/main/assets');
}

function patchNobleForNode18 (destRoot) {
  const hashesCjs = path.join(root, 'node_modules', 'bip32', 'node_modules', '@noble', 'hashes');
  const hashesDest = path.join(destRoot, '@noble', 'hashes');
  if (fs.existsSync(hashesCjs)) {
    fs.rmSync(hashesDest, { recursive: true, force: true });
    copyDir(hashesCjs, hashesDest, { includeNodeModules: true });
    console.log('[ANDROID] @noble/hashes → CJS 1.x (Node 18)');
  }

  const curvesDest = path.join(destRoot, '@noble', 'curves');
  const tmp = path.join(root, '.tmp-android-noble');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    execFileSync('npm', ['pack', '@noble/curves@1.9.2', '--pack-destination', tmp], {
      cwd: root,
      stdio: 'pipe'
    });
    const tgz = fs.readdirSync(tmp).find((f) => String(f).startsWith('noble-curves-'));
    if (!tgz) throw new Error('npm pack produced no tarball');
    execFileSync('tar', ['-xzf', path.join(tmp, tgz), '-C', tmp], { stdio: 'pipe' });
    const extracted = path.join(tmp, 'package');
    fs.rmSync(curvesDest, { recursive: true, force: true });
    copyDir(extracted, curvesDest, { includeNodeModules: true });
    const orig = path.join(curvesDest, 'secp256k1.js');
    const renamed = path.join(curvesDest, 'secp256k1.cjs.js');
    if (fs.existsSync(orig)) fs.renameSync(orig, renamed);
    fs.writeFileSync(orig,
      '\'use strict\';\n' +
      'const mod = require(\'./secp256k1.cjs.js\');\n' +
      'const secp256k1 = mod.secp256k1 || mod;\n' +
      'module.exports = { secp256k1, schnorr: secp256k1.schnorr || mod.schnorr };\n');
    console.log('[ANDROID] @noble/curves → CJS 1.9.2 (Node 18)');
  } catch (e) {
    console.warn('[ANDROID] could not pack @noble/curves@1.9.2:', e && e.message ? e.message : e);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function patchMinscNoIcu (destRoot) {
  const p = path.join(destRoot, 'minsc', 'minsc.js');
  if (!fs.existsSync(p)) return;
  const s = fs.readFileSync(p, 'utf8');
  const next = s.replace(/,\s*\{\s*ignoreBOM:\s*true,\s*fatal:\s*true\s*\}/g, ', { ignoreBOM: true }')
    .replace(/new TextDecoder\(([^,]+),\s*\{\s*fatal:\s*true\s*\}\)/g, 'new TextDecoder($1)');
  if (next !== s) {
    fs.writeFileSync(p, next);
    console.log('[ANDROID] patched minsc TextDecoder for no-ICU Node');
  }
}

function rmNamedPackages (dir, names) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (!ent.isDirectory()) {
      if (/\.node$/.test(ent.name)) fs.unlinkSync(p);
      continue;
    }
    if (names.has(ent.name)) fs.rmSync(p, { recursive: true, force: true });
    else rmNamedPackages(p, names);
  }
}

function stageLevelShim (destRoot) {
  const src = path.join(root, 'functions', 'androidMemoryLevel.js');
  rmNamedPackages(destRoot, new Set(['level', 'classic-level']));
  const dir = path.join(destRoot, 'level');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, path.join(dir, 'index.js'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'level',
    version: '10.0.0-android',
    main: 'index.js'
  }, null, 2) + '\n');
  console.log('[ANDROID] JS Level shim (no classic-level native addon)');
}

function resolvesFrom (fromDir, name, destRoot) {
  const parts = String(name).split('/');
  let dir = fromDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'node_modules', ...parts, 'package.json'))) return true;
    if (dir === destRoot) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fs.existsSync(path.join(destRoot, ...parts, 'package.json'));
}

function visitStagedPackages (nm, visit) {
  if (!fs.existsSync(nm)) return;
  let ents;
  try { ents = fs.readdirSync(nm, { withFileTypes: true }); } catch (_) { return; }
  for (const ent of ents) {
    if (!ent.isDirectory()) continue;
    const p = path.join(nm, ent.name);
    if (ent.name.startsWith('@')) {
      let scoped;
      try { scoped = fs.readdirSync(p, { withFileTypes: true }); } catch (_) { continue; }
      for (const s of scoped) {
        if (s.isDirectory()) visit(path.join(p, s.name));
      }
    } else {
      visit(p);
    }
  }
}

/**
 * Nested copies (`includeNodeModules`) omit hoisted host deps. Walk staged
 * packages and copy anything `require()` would miss into destRoot so Node's
 * walk-up finds it (Pixel: through2@2 → xtend).
 */
function fillMissingNestedDeps (destRoot) {
  if (!fs.existsSync(destRoot)) return;
  let added = 0;
  function visitPackageDir (dir) {
    const pkgPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgPath)) return;
    let pkg = {};
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch (_) { return; }
    for (const name of Object.keys(pkg.dependencies || {})) {
      if (SKIP_DEPS.has(name) || String(name).startsWith('@types/')) continue;
      if (resolvesFrom(dir, name, destRoot)) continue;
      const src = packageSource(name);
      if (!fs.existsSync(path.join(src, 'package.json'))) {
        console.warn('[ANDROID] missing nested dep', name, 'for', path.relative(destRoot, dir));
        continue;
      }
      const dest = path.join(destRoot, ...String(name).split('/'));
      if (fs.existsSync(path.join(dest, 'package.json'))) continue;
      copyDir(src, dest, { skipBulky: true });
      added += 1;
      console.log('[ANDROID] nested dep →', name);
    }
    visitStagedPackages(path.join(dir, 'node_modules'), visitPackageDir);
  }
  visitStagedPackages(destRoot, visitPackageDir);
  if (added) console.log('[ANDROID] filled', added, 'nested deps at node_modules root');
}

function applyNodeModulePatches (destRoot) {
  if (!fs.existsSync(destRoot)) {
    console.warn('[ANDROID] node_modules missing — run a full android:sync');
    return;
  }
  fillMissingNestedDeps(destRoot);
  patchNobleForNode18(destRoot);
  patchMinscNoIcu(destRoot);
  patchValibotNoIcu(destRoot);
  patchFabricLevelFallback(destRoot);
  stageLevelShim(destRoot);
}

function patchFabricLevelFallback (destRoot) {
  const snippet = 'let Level;\n' +
    'try {\n' +
    "  ({ Level } = require('level'));\n" +
    '} catch (_levelErr) {\n' +
    '  Level = class MemoryLevel {\n' +
    "    constructor () { this.status = 'open'; this._m = new Map(); }\n" +
    '    async get (k) {\n' +
    "      if (!this._m.has(k)) { const e = new Error('NotFound'); e.notFound = true; throw e; }\n" +
    '      return this._m.get(k);\n' +
    '    }\n' +
    '    async put (k, v) { this._m.set(k, v); }\n' +
    '    async close () {}\n' +
    '  };\n' +
    '}\n';
  for (const rel of [
    path.join('@fabric', 'core', 'types', 'peer.js'),
    path.join('@fabric', 'core', 'types', 'store.js')
  ]) {
    const p = path.join(destRoot, rel);
    if (!fs.existsSync(p)) continue;
    const s = fs.readFileSync(p, 'utf8');
    if (!s.includes("const { Level } = require('level')")) continue;
    fs.writeFileSync(p, s.replace("const { Level } = require('level');", snippet));
    console.log('[ANDROID] Level memory fallback in', rel);
  }
}

function patchValibotNoIcu (destRoot) {
  const srcDir = path.join(root, 'node_modules', 'valibot', 'dist');
  const dir = path.join(destRoot, 'valibot', 'dist');
  if (!fs.existsSync(dir)) return;
  if (fs.existsSync(srcDir)) {
    for (const name of fs.readdirSync(srcDir)) {
      if (!/\.(cjs|mjs|js)$/.test(name)) continue;
      fs.copyFileSync(path.join(srcDir, name), path.join(dir, name));
    }
  }
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(cjs|mjs|js)$/.test(name)) continue;
    const p = path.join(dir, name);
    let s = fs.readFileSync(p, 'utf8');
    // Replace only the EMOJI_REGEX assignment (not later /u; regexes). Idempotent.
    s = s.replace(/const EMOJI_REGEX = \/(?!\$\^;)(?:\\.|[^/\\])+\/[a-z]*;/g, 'const EMOJI_REGEX = /$^/;');
    s = s.replace(/\\p\{[A-Za-z_]+\}/g, '[^\\s\\S]');
    fs.writeFileSync(p, s);
    n += 1;
  }
  if (n) console.log('[ANDROID] patched valibot emoji regex for no-ICU Node (' + n + ' files)');
}

function stageNodeModules () {
  const destRoot = path.join(www, 'nodejs', 'node_modules');
  try {
    fs.rmSync(destRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  } catch (e) {
    if (e && (e.code === 'ENOTEMPTY' || e.code === 'EBUSY' || e.code === 'ENOENT')) {
      execFileSync('rm', ['-rf', destRoot]);
    } else {
      throw e;
    }
  }
  const seen = new Set();
  for (const name of RUNTIME_PACKAGES) stagePackage(name, destRoot, seen);
  applyNodeModulePatches(destRoot);
  console.log('[ANDROID] staged', seen.size, 'runtime packages → android-www/nodejs/node_modules');
}

function patchAndroidProject () {
  require('./android-patch.js').main();
}

function main () {
  const appOnly = process.argv.includes('--app-only');
  if (!appOnly) stageDashboard();
  stageNodeApp();
  if (appOnly) applyNodeModulePatches(path.join(www, 'nodejs', 'node_modules'));
  else stageNodeModules();
  stageBuiltinModules();
  patchAndroidProject();
}

main();
