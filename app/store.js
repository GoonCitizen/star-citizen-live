'use strict';

/**
 * Tiny keyed-collection store for the mission register (M5).
 *
 * In-memory by default (used by tests and single-process runs). If `dir` is
 * given, each collection is persisted to <dir>/<name>.json (loaded on first
 * access, rewritten on each change). Zero external dependencies.
 *
 * This is deliberately a thin seam: at deploy time (M4) it can be swapped for a
 * node:sqlite-backed store with the same get/all/put surface, without touching
 * MissionManager. See DESIGN-missions-mvp.md §4.
 */

const fs = require('fs');
const path = require('path');

class Store {
  constructor ({ dir = null } = {}) {
    this.dir = dir;
    this.data = {};   // { collectionName: { id: record } }
    if (dir) { try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* best effort */ } }
  }

  _col (name) {
    if (this.data[name]) return this.data[name];
    let obj = {};
    if (this.dir) {
      try { obj = JSON.parse(fs.readFileSync(path.join(this.dir, `${name}.json`), 'utf8')); } catch (_) { obj = {}; }
    }
    this.data[name] = obj;
    return obj;
  }

  _persist (name) {
    if (!this.dir) return;
    try { fs.writeFileSync(path.join(this.dir, `${name}.json`), JSON.stringify(this._col(name), null, 2)); } catch (_) { /* best effort */ }
  }

  get (name, id) { return this._col(name)[id] || null; }
  all (name) { return Object.values(this._col(name)); }
  count (name) { return Object.keys(this._col(name)).length; }

  put (name, id, record) {
    this._col(name)[id] = record;
    this._persist(name);
    return record;
  }
}

module.exports = { Store };
