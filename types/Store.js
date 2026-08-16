'use strict';

/**
 * Store — keyed-collection persistence for the mission register + groups.
 *
 * Composes `@fabric/core` {@link Store} (`this.fabric`). Named collections are
 * stored at Fabric paths `/collections/<name>` via `fabric.set` / `fabric.get`
 * (not raw Level key blobs). The sync façade (`get` / `put` / `all` / `count` /
 * `del`) keeps MissionManager / GroupManager simple.
 *
 * Data lives under the named store root `stores/gooncitizen/` (Hub-style);
 * the register LevelDB is `stores/gooncitizen/register`.
 *
 * Call `await store.start()` before reads that must see prior sessions, and
 * `await store.stop()` on shutdown so pending writes flush.
 *
 * Memory-only when `path` is null (tests) — no Fabric Store is constructed.
 */

const fs = require('fs');
const path = require('path');

const COLLECTIONS = [
  'missions', 'applications', 'claims', 'validations', 'audit',
  'groups', 'groupapplications', 'groupaudit',
  'groupsidechains', // per-group Statechain STATE + JOURNAL (functions/groupStatechain.js)
  'groupinvites', // FederationContractInvite rows (survive restart)
  'groupchanges', // applied GroupChange dedupe / history
  'groupchangeproposals', // pending GroupChangeProposal + votes (k-of-n adopt)
  'contractmessages', // ARC multi-origin GroupChat/GroupChange fold (@fabric/core contractMessageAccumulate)
  'contractmessagecommits', // ARC 2PC sidecar (received/receipt; does not alter tip digest)
  'settings', // operator settings records { id: key, value } (functions/settingsStore.js)
  'snapshots', // screenshot metadata { id, ts, file, bytes, width, height } (services/SnapshotManager.js)
  'chatmessages', // Hub-style ChatMessage records (services/ChatManager.js)
  'missionbroadcasts', // peer mission offers (Broadcast → Accept / Ignore)
  'inbox', // unified browseable register / gossip inbox (functions/registerInbox.js)
  'fleets', // Starjump / FleetViewer personal fleets (functions/starjumpFleet.js)
  'localgroups', // operator-local identity tags (functions/localGroups.js)
  'identitynotes', // notes on Discord / Fabric identities (functions/identityNotes.js)
  'discordcatalog', // Discord guild/channel/member/message packs + guild-events (functions/discordCatalogAccumulate.js, discordScheduledEvents.js)
  'datasync', // Federation GroupDataShare folds (profile.playtimes, profile.files, …)
  'clustersync', // last DeviceDataShare collection + sibling LAN/WebRTC dial hints
  'documents', // this node's file catalog (functions/localDocuments.js) — not hub.fabric.pub
  'documentoffers', // remote Fabric inventory listings (functions/documentOffers.js)
  'locationreports' // node-local QT / presence sightings (functions/locationReports.js)
];

function collectionPath (name) {
  return `/collections/${name}`;
}

class Store {
  /**
   * @param {Object} [opts]
   * @param {String|null} [opts.path] LevelDB path for `@fabric/core` Store.
   * @param {String|null} [opts.dir] Alias for `path` (legacy register API).
   * @param {boolean} [opts.json] Persist collections as JSON files (Android /
   *   Node-mobile — skip native Level).
   */
  constructor ({ path: storePath = null, dir = null, json = false } = {}) {
    this.path = storePath || dir || null;
    this.data = {}; // { collectionName: { id: record } }
    /** @type {Object|null} */
    this._fabric = null;
    this._json = !!json;
    this._started = false;
    this._writeChain = Promise.resolve();
  }

  get persistent () { return !!this.path; }

  /** Underlying `@fabric/core` Store (null in memory-only mode or before start). */
  get fabric () { return this._fabric; }

  /**
   * Open the Fabric Store (if configured) and load collections into memory.
   * Idempotent — safe when MissionManager and GroupManager share one instance.
   */
  async start () {
    if (!this.path || this._started) return this;

    // One-shot transitional imports (pre–Fabric Store files). Steady-state IO
    // goes through this.fabric set/get only.
    this._migrateLegacyJson();
    const legacySettings = this._takeLegacySettingsJson();

    if (this._json) {
      this._loadJsonCollections();
      this._started = true;
      if (legacySettings) this._applyLegacySettings(legacySettings);
      await this.flush();
      return this;
    }

    let FabricStore = null;
    try {
      FabricStore = require('@fabric/core/types/store');
    } catch (e) {
      console.warn('[STORE] Fabric Store unavailable — JSON files:', e && e.message);
      this._json = true;
      this._loadJsonCollections();
      this._started = true;
      if (legacySettings) this._applyLegacySettings(legacySettings);
      await this.flush();
      return this;
    }
    this._fabric = new FabricStore({
      name: '@gooncitizen/register',
      path: this.path,
      persistent: true,
      verbosity: 0
    });
    try {
      await this._fabric.start();
    } catch (e) {
      console.warn('[STORE] Fabric Store failed to open — JSON files:', e && e.message);
      this._fabric = null;
      this._json = true;
      this._loadJsonCollections();
      this._started = true;
      if (legacySettings) this._applyLegacySettings(legacySettings);
      await this.flush();
      return this;
    }

    for (const name of COLLECTIONS) {
      this.data[name] = await this._loadCollection(name);
    }

    if (legacySettings) this._applyLegacySettings(legacySettings);

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

  /** Flush pending Fabric writes (also called from stop). */
  async flush () {
    await this._writeChain.catch(() => {});
    return this;
  }

  /**
   * Transitional: import legacy per-collection JSON beside the register dir once.
   * Not used for steady-state persistence.
   */
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
   * One-time pickup of the pre-Fabric-Store operator `settings.json`.
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
      return null;
    }
  }

  /**
   * Load one collection map from Fabric path `/collections/<name>`.
   * Migrates legacy bare Level keys (`missions`, …) once onto that path.
   */
  async _loadCollection (name) {
    if (this.data[name] && Object.keys(this.data[name]).length) {
      await this._fabric.set(collectionPath(name), this.data[name]);
      return this.data[name];
    }

    const p = collectionPath(name);
    try {
      const value = await this._fabric.get(p);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value;
      }
    } catch (_) { /* miss */ }

    // Legacy: whole-collection blob under bare Level key (pre–path integration).
    if (this._fabric.db) {
      try {
        const raw = await this._fabric.db.get(name);
        const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          await this._fabric.set(p, parsed);
          return parsed;
        }
      } catch (_) { /* no legacy key */ }
    }

    return {};
  }

  _col (name) {
    if (!this.data[name]) this.data[name] = {};
    return this.data[name];
  }

  _jsonFile (name) {
    return path.join(this.path, `${name}.json`);
  }

  _loadJsonCollections () {
    if (!this.path) return;
    try { fs.mkdirSync(this.path, { recursive: true }); } catch (_) { /* exists */ }
    for (const name of COLLECTIONS) {
      if (this.data[name] && Object.keys(this.data[name]).length) continue;
      const file = this._jsonFile(name);
      if (!fs.existsSync(file)) {
        this.data[name] = this.data[name] || {};
        continue;
      }
      try {
        const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
        this.data[name] = (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
      } catch (_) {
        this.data[name] = {};
      }
    }
  }

  _applyLegacySettings (legacySettings) {
    if (!legacySettings) return;
    let changed = false;
    for (const [key, value] of Object.entries(legacySettings)) {
      if (this.data.settings[key] === undefined) {
        this.data.settings[key] = { id: key, value };
        changed = true;
      }
    }
    if (changed) this._persist('settings');
  }

  _persist (name) {
    if (!this.path) return;
    const snapshot = JSON.parse(JSON.stringify(this._col(name)));
    if (this._json || !this._fabric) {
      this._writeChain = this._writeChain.then(async () => {
        try { fs.mkdirSync(this.path, { recursive: true }); } catch (_) { /* exists */ }
        fs.writeFileSync(this._jsonFile(name), JSON.stringify(snapshot));
      }).catch((err) => {
        console.error('[STORE] persist failed:', name, err && err.message ? err.message : err);
      });
      return;
    }
    const p = collectionPath(name);
    this._writeChain = this._writeChain.then(async () => {
      if (!this._fabric) return;
      await this._fabric.set(p, snapshot);
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

module.exports = { Store, COLLECTIONS, collectionPath };
