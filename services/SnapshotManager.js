'use strict';

/**
 * SnapshotManager — periodic screen snapshots of player activity.
 *
 * Captures a reduced-size JPEG on a configurable interval (default 10 s,
 * opt-in) so a future image analyzer can parse gameplay the log does not
 * cover. Image files live under the named Fabric store root
 * (`stores/gooncitizen/snapshots/`); metadata records live in the shared
 * Fabric Store `snapshots` collection ({ id, ts, file, bytes, width,
 * height }). Auto-purge deletes the oldest snapshots once the library
 * exceeds a disk cap, keeping requirements low.
 *
 * The capture function is injected by the host (Electron main uses
 * `screenshot-desktop` + `nativeImage` downscaling); without one — pure
 * browser/server sessions — the manager stays idle.
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const DEFAULTS = {
  enabled: false,
  intervalMs: 10000,     // 10 s
  autoPurge: true,
  maxBytes: 256 * 1024 * 1024 // 256 MB
};

const MIN_INTERVAL_MS = 2000;

class SnapshotManager extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {Object} opts.store Shared Fabric Store.
   * @param {String|null} opts.dir Directory for image files (null = disabled).
   * @param {Function} [opts.capture] async () => { buffer, width, height }.
   */
  constructor ({ store, dir = null, capture = null } = {}) {
    super();
    this.store = store;
    this.dir = dir;
    this.capture = capture;
    this.config = Object.assign({}, DEFAULTS);
    this.lastError = null;
    this._timer = null;
    this._snapping = false;
    this._counter = 0;
  }

  /** True when snapshots can actually be taken right now. */
  get active () {
    return !!(this.config.enabled && this.capture && this.dir && this._timer);
  }

  /** Provide (or clear) the platform capture function; re-evaluates the timer. */
  setCapture (fn) {
    this.capture = fn || null;
    this._reschedule();
  }

  /**
   * Apply configuration (from operator settings). Values are clamped;
   * missing keys keep their current value.
   */
  configure (next = {}) {
    if (next.enabled !== undefined) this.config.enabled = !!next.enabled;
    if (next.intervalMs !== undefined) {
      const n = Math.floor(Number(next.intervalMs));
      if (Number.isFinite(n) && n > 0) this.config.intervalMs = Math.max(MIN_INTERVAL_MS, n);
    }
    if (next.autoPurge !== undefined) this.config.autoPurge = !!next.autoPurge;
    if (next.maxBytes !== undefined) {
      const n = Math.floor(Number(next.maxBytes));
      if (Number.isFinite(n) && n > 0) this.config.maxBytes = n;
    }
    this._reschedule();
    return this.config;
  }

  _reschedule () {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (!this.config.enabled || !this.capture || !this.dir) return;
    this._timer = setInterval(() => { this.snap().catch(() => {}); }, this.config.intervalMs);
    if (this._timer.unref) this._timer.unref();
  }

  /** Take one snapshot now: capture → write JPEG → record metadata → purge. */
  async snap () {
    if (!this.capture || !this.dir || this._snapping) return null;
    this._snapping = true;
    try {
      const shot = await this.capture();
      if (!shot || !shot.buffer || !shot.buffer.length) throw new Error('capture returned no image');
      fs.mkdirSync(this.dir, { recursive: true });
      this._counter += 1;
      const id = `snap-${Date.now().toString(36)}-${this._counter}`;
      const file = `${id}.jpg`;
      fs.writeFileSync(path.join(this.dir, file), shot.buffer);
      const record = {
        id,
        ts: new Date().toISOString(),
        file,
        bytes: shot.buffer.length,
        width: shot.width || null,
        height: shot.height || null
      };
      this.store.put('snapshots', id, record);
      this.lastError = null;
      this.emit('snapshot', record);
      if (this.config.autoPurge) this.purge();
      return record;
    } catch (error) {
      this.lastError = error.message || String(error);
      this.emit('error', error);
      return null;
    } finally {
      this._snapping = false;
    }
  }

  /** Snapshot metadata, newest first. */
  list ({ limit = 200, before = null } = {}) {
    let all = this.store.all('snapshots').sort((a, b) => (a.ts < b.ts ? 1 : -1));
    if (before) all = all.filter((s) => s.ts < before);
    return all.slice(0, Math.max(1, Math.min(limit, 1000)));
  }

  /** Aggregate stats for the settings/library UI. */
  stats () {
    const all = this.store.all('snapshots');
    return {
      enabled: this.config.enabled,
      available: !!(this.capture && this.dir),
      intervalMs: this.config.intervalMs,
      autoPurge: this.config.autoPurge,
      maxBytes: this.config.maxBytes,
      count: all.length,
      bytes: all.reduce((sum, s) => sum + (s.bytes || 0), 0),
      lastError: this.lastError
    };
  }

  /** Absolute path for a snapshot's image file, or null. */
  imagePath (id) {
    const record = this.store.get('snapshots', id);
    if (!record || !this.dir) return null;
    const file = path.join(this.dir, record.file);
    return fs.existsSync(file) ? file : null;
  }

  _remove (record) {
    if (this.dir && record.file) {
      try { fs.unlinkSync(path.join(this.dir, record.file)); } catch (_) { /* already gone */ }
    }
    this.store.del('snapshots', record.id);
  }

  /**
   * Auto-purge: delete oldest snapshots until total size fits the disk cap.
   * @returns {Number} How many snapshots were removed.
   */
  purge () {
    const oldestFirst = this.store.all('snapshots').sort((a, b) => (a.ts < b.ts ? -1 : 1));
    let total = oldestFirst.reduce((sum, s) => sum + (s.bytes || 0), 0);
    let removed = 0;
    for (const record of oldestFirst) {
      if (total <= this.config.maxBytes) break;
      this._remove(record);
      total -= (record.bytes || 0);
      removed += 1;
    }
    if (removed) this.emit('purged', { removed });
    return removed;
  }

  /** Delete every snapshot (Library "Clear all"). */
  purgeAll () {
    const all = this.store.all('snapshots');
    for (const record of all) this._remove(record);
    if (all.length) this.emit('purged', { removed: all.length });
    return all.length;
  }

  stop () {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }
}

SnapshotManager.DEFAULTS = DEFAULTS;
SnapshotManager.MIN_INTERVAL_MS = MIN_INTERVAL_MS;

module.exports = SnapshotManager;
