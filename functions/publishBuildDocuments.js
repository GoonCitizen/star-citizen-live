'use strict';

/**
 * Discover GoonCitizen build artifacts and ingest them as this node's Files
 * catalog (Fabric Store `documents`). The running LiveRelay then answers
 * `P2P_INVENTORY_REQUEST` with published rows — not Hub JSON-RPC.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_RELAY = 'http://127.0.0.1:3041';
const DOCUMENTS_PATH = '/services/star-citizen/documents';
const SPA_NAME = 'gooncitizen-dashboard.html';

const BUILD_EXTENSIONS = new Set([
  '.html', '.dmg', '.pkg', '.exe', '.deb', '.rpm', '.appimage', '.apk', '.zip'
]);

const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.dmg': 'application/x-apple-diskimage',
  '.pkg': 'application/x-newton-compatible-pkg',
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.deb': 'application/vnd.debian.binary-package',
  '.rpm': 'application/x-rpm',
  '.appimage': 'application/vnd.appimage',
  '.apk': 'application/vnd.android.package-archive',
  '.zip': 'application/zip'
};

const SKIP_DIST_NAMES = /\.(blockmap|ya?ml)$/i;

function mimeForFilename (name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

function isBuildArtifactName (name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  return BUILD_EXTENSIONS.has(ext);
}

function skipDistName (name) {
  const n = String(name || '');
  if (!n || n.startsWith('.')) return true;
  if (SKIP_DIST_NAMES.test(n)) return true;
  if (/^latest/i.test(n) && /\.ya?ml$/i.test(n)) return true;
  return false;
}

function _walkFiles (dir, acc, depth) {
  if (depth > 6 || !fs.existsSync(dir)) return acc;
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return acc;
  }
  for (const ent of ents) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) _walkFiles(p, acc, depth + 1);
    else if (ent.isFile()) acc.push(p);
  }
  return acc;
}

/**
 * @param {string} repoRoot
 * @param {Object} [opts]
 * @param {boolean} [opts.spa]
 * @param {boolean} [opts.dist]
 * @param {boolean} [opts.apk]
 * @returns {Array<{ kind: string, path: string, name: string, mime: string }>}
 */
function listBuildArtifacts (repoRoot, opts = {}) {
  const root = path.resolve(repoRoot);
  const out = [];
  const seen = new Set();

  function add (kind, abs, name) {
    const resolved = path.resolve(abs);
    if (seen.has(resolved)) return;
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return;
    seen.add(resolved);
    out.push({
      kind,
      path: resolved,
      name: name || path.basename(resolved),
      mime: mimeForFilename(name || resolved)
    });
  }

  if (opts.spa !== false) {
    add('spa', path.join(root, 'assets', 'index.html'), SPA_NAME);
  }
  if (opts.dist !== false) {
    const dist = path.join(root, 'dist');
    if (fs.existsSync(dist)) {
      for (const name of fs.readdirSync(dist)) {
        if (skipDistName(name) || !isBuildArtifactName(name)) continue;
        add('installer', path.join(dist, name), name);
      }
    }
  }
  if (opts.apk !== false) {
    const apkRoot = path.join(root, 'android', 'app', 'build', 'outputs');
    for (const file of _walkFiles(apkRoot, [], 0)) {
      if (path.extname(file).toLowerCase() !== '.apk') continue;
      add('apk', file, path.basename(file));
    }
  }
  return out;
}

/**
 * Loopback ingest must stay inside this repo and off secret/store trees.
 * @param {string} filePath
 * @param {string} repoRoot
 * @returns {string} realpath
 */
function resolveIngestPath (filePath, repoRoot) {
  const raw = String(filePath || '').trim();
  if (!raw) {
    const err = new Error('filePath required');
    err.status = 400;
    throw err;
  }
  let root;
  try {
    root = fs.realpathSync(path.resolve(repoRoot));
  } catch (_) {
    const err = new Error('repo root not found');
    err.status = 400;
    throw err;
  }
  const abs = path.resolve(raw);
  let st;
  try {
    st = fs.statSync(abs);
  } catch (_) {
    const err = new Error('file not found');
    err.status = 404;
    throw err;
  }
  if (!st.isFile()) {
    const err = new Error('filePath must be a file');
    err.status = 400;
    throw err;
  }
  const real = fs.realpathSync(abs);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (real !== root && !real.startsWith(prefix)) {
    const err = new Error('filePath must be inside the GoonCitizen repo');
    err.status = 403;
    throw err;
  }
  const rel = path.relative(root, real);
  const parts = rel.split(path.sep);
  const top = parts[0];
  if (top === 'stores' || top === 'node_modules' || top === '.git') {
    const err = new Error('filePath is not a publishable build artifact');
    err.status = 403;
    throw err;
  }
  if (rel === 'settings/local.js' || top === '.env' || parts.includes('.env')) {
    const err = new Error('filePath is not a publishable build artifact');
    err.status = 403;
    throw err;
  }
  return real;
}

function relayBase (opts = {}) {
  const raw = opts.host
    || process.env.SC_RELAY_URL
    || process.env.SC_HTTP_URL
    || ('http://127.0.0.1:' + (process.env.PORT || process.env.SC_HTTP_PORT || '3041'));
  return String(raw).replace(/\/+$/, '') || DEFAULT_RELAY;
}

function jsonRequest (baseUrl, method, pathname, payload) {
  const u = new URL(pathname, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  const lib = u.protocol === 'https:' ? https : http;
  const body = payload != null ? JSON.stringify(payload) : null;
  const headers = { Accept: 'application/json' };
  if (body) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  return new Promise((resolve, reject) => {
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (_) { parsed = { raw }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * @param {object} artifact { path, name, mime }
 * @param {Object} [opts]
 * @param {string} [opts.host]
 * @param {number} [opts.purchasePriceSats]
 * @returns {Promise<object>}
 */
async function publishArtifact (artifact, opts = {}) {
  const host = relayBase(opts);
  const payload = {
    filePath: artifact.path,
    name: artifact.name,
    mime: artifact.mime,
    publish: true
  };
  if (opts.purchasePriceSats != null) payload.purchasePriceSats = opts.purchasePriceSats;
  if (opts.satsPerKiB != null) payload.satsPerKiB = opts.satsPerKiB;
  if (opts.satsPerByte != null) payload.satsPerByte = opts.satsPerByte;
  if (opts.pinToProfile === true || opts.pin === true) payload.pinToProfile = true;
  const res = await jsonRequest(host, 'POST', DOCUMENTS_PATH, payload);
  if (res.status === 503) {
    const err = new Error('Document Exchange disabled (settings.documents.enable) — set enable: true and restart the local node');
    err.status = 503;
    err.response = res.body;
    throw err;
  }
  if (res.status < 200 || res.status >= 300) {
    const msg = (res.body && res.body.error) || ('HTTP ' + res.status);
    const err = new Error(String(msg));
    err.status = res.status;
    err.response = res.body;
    throw err;
  }
  return (res.body && res.body.data && res.body.data.document) || (res.body && res.body.data) || res.body;
}

async function defaultPriceSats (opts = {}) {
  const host = relayBase(opts);
  try {
    const res = await jsonRequest(host, 'GET', '/settings');
    const n = res.body && res.body.runtime && res.body.runtime.documents
      && res.body.runtime.documents.defaultPriceSats;
    if (n != null && Number.isFinite(Number(n))) return Math.max(0, Math.floor(Number(n)));
  } catch (_) { /* use chat default */ }
  return 25;
}

module.exports = {
  DEFAULT_RELAY,
  DOCUMENTS_PATH,
  SPA_NAME,
  mimeForFilename,
  isBuildArtifactName,
  skipDistName,
  listBuildArtifacts,
  resolveIngestPath,
  relayBase,
  jsonRequest,
  publishArtifact,
  defaultPriceSats
};
