'use strict';

/**
 * Local filesystem listing for the Analyze log-import browser.
 * Read-only directory metadata — never returns file contents.
 * Used only by the desktop/local relay (not hosted server mode).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Normalize and resolve a browse path. Empty / missing → home directory.
 * @param {string|null|undefined} input
 * @param {{ homedir?: function|string, resolve?: function }} [opts]
 * @returns {string}
 */
function resolveBrowsePath (input, opts = {}) {
  const resolve = opts.resolve || path.resolve;
  const home = typeof opts.homedir === 'function'
    ? opts.homedir()
    : (opts.homedir || os.homedir());
  const raw = (input == null || String(input).trim() === '') ? home : String(input).trim();
  return resolve(raw);
}

/**
 * Count `*.log` files under a directory (non-recursive; for UI badges).
 * @param {string} dir
 * @param {{ readdirSync?: function }} [opts]
 * @returns {number}
 */
function countLogsHere (dir, opts = {}) {
  const readdirSync = opts.readdirSync || fs.readdirSync;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    let n = 0;
    for (const e of entries) {
      if (!e.isDirectory() && /\.log$/i.test(e.name)) n += 1;
    }
    return n;
  } catch (_) {
    return 0;
  }
}

/**
 * List one directory for the in-app file browser.
 * @param {string|null|undefined} inputPath
 * @param {{
 *   existsSync?: function,
 *   statSync?: function,
 *   readdirSync?: function,
 *   realpathSync?: function,
 *   homedir?: function|string
 * }} [opts]
 * @returns {{ type: string, path: string, parent: string|null, entries: object[], error?: string }}
 */
function listDirectory (inputPath, opts = {}) {
  const existsSync = opts.existsSync || fs.existsSync;
  const statSync = opts.statSync || fs.statSync;
  const readdirSync = opts.readdirSync || fs.readdirSync;
  const realpathSync = opts.realpathSync || fs.realpathSync;

  let abs = resolveBrowsePath(inputPath, opts);
  try {
    if (existsSync(abs)) abs = realpathSync(abs);
  } catch (_) { /* keep abs */ }

  if (!existsSync(abs)) {
    return { type: 'FsListing', path: abs, parent: path.dirname(abs), entries: [], error: 'path not found' };
  }

  let st;
  try { st = statSync(abs); } catch (e) {
    return { type: 'FsListing', path: abs, parent: path.dirname(abs), entries: [], error: e.message || 'stat failed' };
  }
  if (!st.isDirectory()) {
    return {
      type: 'FsListing',
      path: path.dirname(abs),
      parent: path.dirname(path.dirname(abs)),
      entries: [],
      error: 'not a directory',
      selectedFile: abs
    };
  }

  const parent = path.dirname(abs) === abs ? null : path.dirname(abs);
  let entries = [];
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch (e) {
    return { type: 'FsListing', path: abs, parent, entries: [], error: e.message || 'readdir failed' };
  }

  const rows = [];
  for (const e of entries) {
    // Skip dotfiles (noise) except when they are the only useful cue.
    if (e.name === '.' || e.name === '..') continue;
    if (e.name.startsWith('.')) continue;
    const child = path.join(abs, e.name);
    const isDir = e.isDirectory();
    let size = null;
    let mtime = null;
    try {
      const cst = statSync(child);
      size = cst.size;
      mtime = cst.mtimeMs != null ? new Date(cst.mtimeMs).toISOString() : null;
    } catch (_) { /* unreadable */ }
    const isLog = !isDir && /\.log$/i.test(e.name);
    rows.push({
      name: e.name,
      path: child,
      type: isDir ? 'dir' : 'file',
      size,
      mtime,
      isLog,
      logCount: isDir ? countLogsHere(child, opts) : null
    });
  }

  rows.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    if (a.isLog !== b.isLog) return a.isLog ? -1 : 1;
    return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
  });

  return {
    type: 'FsListing',
    path: abs,
    parent,
    entries: rows,
    logCount: rows.filter((r) => r.isLog).length,
    dirCount: rows.filter((r) => r.type === 'dir').length
  };
}

/**
 * Normalize a persisted list of absolute paths (dirs or files).
 * @param {*} value
 * @returns {string[]}
 */
function sanitizePathList (value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const d of value) {
    if (typeof d !== 'string') continue;
    const trimmed = d.trim();
    if (!trimmed) continue;
    let abs;
    try { abs = path.resolve(trimmed); } catch (_) { continue; }
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

/** @param {*} value @returns {string[]} */
function sanitizeCorpusDirs (value) {
  return sanitizePathList(value);
}

/**
 * Normalize a persisted list of individual log files (absolute, unique).
 * Non-.log paths are kept if they exist — operator may rename exports.
 * @param {*} value
 * @returns {string[]}
 */
function sanitizeCorpusFiles (value) {
  return sanitizePathList(value);
}

module.exports = {
  resolveBrowsePath,
  countLogsHere,
  listDirectory,
  sanitizePathList,
  sanitizeCorpusDirs,
  sanitizeCorpusFiles
};
