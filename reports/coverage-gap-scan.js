'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIRS = ['functions', 'services', 'types', 'components', 'contracts', 'scripts'];
const SRC_FILES = ['main.js', 'preload.js', 'constants.js'];
const TEST_GLOBS = [
  'tests',
];

function walk (dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (['node_modules', 'coverage', 'stores', 'reports', 'assets', 'dist', 'android', 'android-www'].includes(ent.name)) continue;
      walk(p, acc);
    } else if (/\.(js|cjs|mjs)$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

function rel (p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

function lineCount (p) {
  try {
    return fs.readFileSync(p, 'utf8').split(/\n/).length;
  } catch {
    return 0;
  }
}

const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const IMPORT_RE = /(?:from|import)\s+['"]([^'"]+)['"]/g;

function resolveLocal (fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    base + '.js',
    path.join(base, 'index.js')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return path.resolve(c);
  }
  return null;
}

function extractRequires (file) {
  const src = fs.readFileSync(file, 'utf8');
  const specs = [];
  for (const re of [REQUIRE_RE, IMPORT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) specs.push(m[1]);
  }
  return specs;
}

const srcFiles = [];
for (const d of SRC_DIRS) walk(path.join(ROOT, d), srcFiles);
for (const f of SRC_FILES) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) srcFiles.push(p);
}

const srcSet = new Set(srcFiles.map((p) => path.resolve(p)));
const testFiles = walk(path.join(ROOT, 'tests')).filter((p) => /\.(js|cjs)$/.test(p));
const exampleFiles = walk(path.join(ROOT, 'examples'));

const requiredByTests = new Map(); // src -> [test files]
const requiredByProd = new Map(); // src -> [prod files]
const requiredByExamples = new Map();

function addRef (map, src, from) {
  const k = path.resolve(src);
  if (!srcSet.has(k)) return;
  if (!map.has(k)) map.set(k, []);
  map.get(k).push(rel(from));
}

function scan (files, map) {
  for (const f of files) {
    let specs;
    try { specs = extractRequires(f); } catch { continue; }
    for (const spec of specs) {
      const resolved = resolveLocal(f, spec);
      if (resolved) addRef(map, resolved, f);
    }
  }
}

scan(testFiles, requiredByTests);
scan(srcFiles, requiredByProd);
scan(exampleFiles, requiredByExamples);

function exportsOf (file) {
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();
  const m = src.match(/module\.exports\s*=\s*\{([^}]+)\}/s);
  if (m) {
    for (const part of m[1].split(',')) {
      const n = part.replace(/\/\/.*$/, '').trim().split(':')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n);
    }
  }
  const assign = [...src.matchAll(/module\.exports\.([A-Za-z_$][\w$]*)/g)];
  for (const a of assign) names.add(a[1]);
  const namedFn = [...src.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)];
  const namedClass = [...src.matchAll(/^class\s+([A-Za-z_$][\w$]*)/gm)];
  return {
    objectExports: [...names],
    topFunctions: namedFn.map((x) => x[1]),
    classes: namedClass.map((x) => x[1])
  };
}

function methodsOfClass (file) {
  const src = fs.readFileSync(file, 'utf8');
  const methods = [];
  const re = /^\s+(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm;
  let m;
  while ((m = re.exec(src))) {
    if (['if', 'for', 'while', 'switch', 'catch', 'function'].includes(m[1])) continue;
    methods.push(m[1]);
  }
  return [...new Set(methods)];
}

const rows = srcFiles.map((p) => {
  const r = rel(p);
  const tests = requiredByTests.get(path.resolve(p)) || [];
  const prod = requiredByProd.get(path.resolve(p)) || [];
  const examples = requiredByExamples.get(path.resolve(p)) || [];
  const mentionedInTests = tests.length > 0;
  // also string-mention of basename in tests
  const base = path.basename(p, '.js');
  return {
    file: r,
    dir: r.split('/')[0],
    lines: lineCount(p),
    testRefs: tests.length,
    prodRefs: prod.length,
    exampleRefs: examples.length,
    tests: [...new Set(tests)].sort(),
    prod: [...new Set(prod)].sort(),
    mentioned: mentionedInTests
  };
}).sort((a, b) => b.lines - a.lines);

const untested = rows.filter((r) => r.testRefs === 0);
const unused = rows.filter((r) => r.prodRefs === 0 && r.testRefs === 0 && r.exampleRefs === 0);
const prodUntested = rows.filter((r) => r.prodRefs > 0 && r.testRefs === 0);
const testOnly = rows.filter((r) => r.testRefs > 0 && r.prodRefs === 0);

function byDir (list) {
  const m = {};
  for (const r of list) {
    m[r.dir] = m[r.dir] || { files: 0, lines: 0 };
    m[r.dir].files++;
    m[r.dir].lines += r.lines;
  }
  return m;
}

const liveRelayMethods = methodsOfClass(path.join(ROOT, 'services/LiveRelay.js'));
const allTestSrc = testFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const liveRelayUntestedMethods = liveRelayMethods.filter((name) => {
  if (name === 'constructor') return false;
  const re = new RegExp('\\b' + name + '\\b');
  return !re.test(allTestSrc);
});

const dashSrc = fs.readFileSync(path.join(ROOT, 'components/Dashboard.js'), 'utf8');
const componentRows = rows.filter((r) => r.dir === 'components');
const componentsNotInDashboard = componentRows.filter((r) => {
  const base = path.basename(r.file, '.js');
  return !dashSrc.includes(base) && r.file !== 'components/Dashboard.js';
});

const out = {
  generatedAt: new Date().toISOString(),
  commit: '5e10da874016ec27edc2888d5ef37520f21c9ee2',
  branch: 'feature/rsi',
  totals: {
    srcFiles: rows.length,
    srcLines: rows.reduce((s, r) => s + r.lines, 0),
    testFiles: testFiles.length,
    untestedFiles: untested.length,
    untestedLines: untested.reduce((s, r) => s + r.lines, 0),
    unusedFiles: unused.length,
    unusedLines: unused.reduce((s, r) => s + r.lines, 0),
    prodUntestedFiles: prodUntested.length,
    prodUntestedLines: prodUntested.reduce((s, r) => s + r.lines, 0)
  },
  byDir: {
    all: byDir(rows),
    untested: byDir(untested),
    prodUntested: byDir(prodUntested),
    unused: byDir(unused)
  },
  unused: unused.map((r) => ({ file: r.file, lines: r.lines })),
  prodUntested: prodUntested.map((r) => ({ file: r.file, lines: r.lines, prod: r.prod.slice(0, 8) })),
  testOnly: testOnly.map((r) => ({ file: r.file, lines: r.lines, tests: r.tests.slice(0, 6) })),
  largestUntested: untested.slice(0, 40).map((r) => ({ file: r.file, lines: r.lines, prodRefs: r.prodRefs, testRefs: r.testRefs })),
  liveRelay: {
    methods: liveRelayMethods.length,
    unmentionedInTests: liveRelayUntestedMethods.length,
    sample: liveRelayUntestedMethods.slice(0, 80)
  },
  componentsNotInDashboard: componentsNotInDashboard.map((r) => ({ file: r.file, lines: r.lines, testRefs: r.testRefs, prodRefs: r.prodRefs }))
};

fs.writeFileSync(path.join(__dirname, 'coverage-gap-scan.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.totals, null, 2));
console.log('unused', unused.length, unused.map((r) => r.file).join(', '));
console.log('prodUntested files', prodUntested.length);
console.log('liveRelay methods', liveRelayMethods.length, 'unmentioned', liveRelayUntestedMethods.length);
