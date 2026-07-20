'use strict';

/**
 * Store — keyed-collection persistence for the mission register + groups.
 *
 * Follows the Fabric convention: the *type* lives in `types/`, the *data*
 * lives under the named store root `stores/gooncitizen/` (like the Hub's
 * `stores/hub`). The register LevelDB is `stores/gooncitizen/register`.
 *
 * Surface (sync): get / all / count / put — same as the original M5 seam so
 * MissionManager and GroupManager stay simple.
 *
 * Persistence: when `path` (or legacy `dir`) is set, collections are kept in an
 * {@link https://github.com/FabricLabs/fabric/blob/master/types/store.js
 * @fabric/core Store} (LevelDB). Memory-only when path is null (tests).
 *
 * Call `await store.start()` before reads that must see prior sessions, and
 * `await store.stop()` on shutdown so pending writes flush.
 */

const fs = require('fs');
const path = require('path');

const COLLECTIONS = [
  'missions', 'applications', 'claims', 'validations', 'audit',
  'groups', 'groupapplications', 'groupaudit',
  'settings', // operator settings records { id: key, value } (functions/settingsStore.js)
  'snapshots' // screenshot metadata { id, ts, file, bytes, width, height } (services/SnapshotManager.js)
];

class Store {
  /**
   * @param {Object} [opts]
   * @param {String|null} [opts.path] LevelDB path for `@fabric/core` Store.
   * @param {String|null} [opts.dir] Alias for `path` (legacy register API).
   */
  constructor ({ path: storePath = null, dir = null } = {}) {
    this.path = storePath || dir || null;
    this.data = {}; // { collectionName: { id: record } }
    this._fabric = null;
    this._started = false;
    this._writeChain = Promise.resolve();
  }

  get persistent () { return !!this.path; }

  /**
   * Open the Fabric Store (if configured) and load collections into memory.
   * Idempotent — safe when MissionManager and GroupManager share one instance.
   */
  async start () {
    if (!this.path || this._started) return this;

    fs.mkdirSync(this.path, { recursive: true });

    // Import legacy per-collection JSON files (pre–Fabric Store) once.
    this._migrateLegacyJson();
    // Pick up a legacy operator settings.json from the store root (merged
    // key-by-key after Level loads, so existing Store values win).
    const legacySettings = this._takeLegacySettingsJson();

    const FabricStore = require('@fabric/core/types/store');
    this._fabric = new FabricStore({
      name: '@gooncitizen/register',
      path: this.path,
      persistent: true,
      verbosity: 0
    });
    await this._fabric.start();

    for (const name of COLLECTIONS) {
      this.data[name] = await this._loadCollection(name);
    }

    if (legacySettings) {
      let changed = false;
      for (const [key, value] of Object.entries(legacySettings)) {
        if (this.data.settings[key] === undefined) {
          this.data.settings[key] = { id: key, value };
          changed = true;
        }
      }
      if (changed) this._persist('settings');
    }

    this._started = true;
    await this.flush();
    return this;
  }

  async stop () {
    await this._writeChain.catch(() => {});
    if (this._fabric) {
      try { await this._fabric.stop(); } catch (_) { /* best effort */ }
      this._fabric = null;
    }
    this._started = false;
    return this;
  }

  /** Flush pending Level writes (also called from stop). */
  async flush () {
    await this._writeChain.catch(() => {});
    return this;
  }

  _migrateLegacyJson () {
    if (!this.path) return;
    const hasLevel = fs.existsSync(path.join(this.path, 'CURRENT'));
    for (const name of COLLECTIONS) {
      const file = path.join(this.path, `${name}.json`);
      if (!fs.existsSync(file)) continue;
      try {
        if (!hasLevel) {
          const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            this.data[name] = obj;
          }
        }
        fs.renameSync(file, `${file}.migrated`);
      } catch (_) { /* leave file for a later attempt */ }
    }
  }

  /**
   * One-time pickup of the pre-Fabric-Store operator `settings.json` that
   * lived next to the register dir (e.g. `stores/gooncitizen/settings.json`).
   * Returns the raw object (or null) and retires the file; the caller merges
   * keys into the `settings` collection after Level has loaded.
   * @returns {Object|null}
   */
  _takeLegacySettingsJson () {
    if (!this.path) return null;
    const file = path.join(path.dirname(this.path), 'settings.json');
    if (!fs.existsSync(file)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.renameSync(file, `${file}.migrated`);
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        console.log(`[STORE] importing legacy settings.json into Fabric store (${file}.migrated)`);
        return raw;
      }
      return null;
    } catch (_) {
      return null; // leave the file for a later attempt
    }
  }

  async _loadCollection (name) {
    if (this.data[name] && Object.keys(this.data[name]).length) {
      // Already seeded from legacy JSON migration — persist into Level.
      await this._fabric.db.put(name, JSON.stringify(this.data[name]));
      return this.data[name];
    }
    try {
      const raw = await this._fabric.db.get(name);
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
      const parsed = JSON.parse(text);
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  _col (name) {
    if (!this.data[name]) this.data[name] = {};
    return this.data[name];
  }

  _persist (name) {
    if (!this._fabric || !this._fabric.db) return;
    const snapshot = JSON.stringify(this._col(name));
    this._writeChain = this._writeChain.then(async () => {
      if (!this._fabric || !this._fabric.db) return;
      await this._fabric.db.put(name, snapshot);
    }).catch((err) => {
      console.error('[STORE] persist failed:', name, err && err.message ? err.message : err);
    });
  }

  get (name, id) { return this._col(name)[id] || null; }
  all (name) { return Object.values(this._col(name)); }
  count (name) { return Object.keys(this._col(name)).length; }

  put (name, id, record) {
    this._col(name)[id] = record;
    this._persist(name);
    return record;
  }

  /** Remove one record from a collection. Returns true when it existed. */
  del (name, id) {
    const col = this._col(name);
    if (col[id] === undefined) return false;
    delete col[id];
    this._persist(name);
    return true;
  }
}

module.exports = { Store, COLLECTIONS };
