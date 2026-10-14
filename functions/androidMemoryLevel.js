'use strict';

/**
 * In-memory Level-compatible store for Capacitor-NodeJS (Node 18 / no matching
 * N-API). classic-level's android-arm64 prebuild dlopens a newer
 * napi_add_env_cleanup_hook than libnode exports, which otherwise crashes
 * LiveRelay before HTTP can bind.
 */

class Level {
  constructor (location) {
    this.status = 'open';
    this.location = location || '';
    this._m = new Map();
  }

  async get (key) {
    if (!this._m.has(key)) {
      const err = new Error('NotFoundError: Key not found in database [' + key + ']');
      err.code = 'LEVEL_NOT_FOUND';
      err.notFound = true;
      throw err;
    }
    return this._m.get(key);
  }

  async put (key, value) {
    this._m.set(key, value);
  }

  async del (key) {
    this._m.delete(key);
  }

  async close () {
    this.status = 'closed';
  }
}

module.exports = { Level };
