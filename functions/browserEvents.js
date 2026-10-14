'use strict';

/**
 * Browser EventEmitter constructor. esbuild-plugin-polyfill-node often
 * exports `{ EventEmitter }` as a module object; `@fabric/core` Identity
 * does `class Identity extends require('events')` and throws in WebView.
 */

class EventEmitter {
  constructor () {
    this._e = Object.create(null);
  }

  on (type, fn) {
    if (typeof fn !== 'function') return this;
    const key = String(type);
    (this._e[key] || (this._e[key] = [])).push(fn);
    return this;
  }

  addListener (type, fn) {
    return this.on(type, fn);
  }

  once (type, fn) {
    const wrap = (...args) => {
      this.off(type, wrap);
      fn.apply(this, args);
    };
    wrap._orig = fn;
    return this.on(type, wrap);
  }

  off (type, fn) {
    const key = String(type);
    const list = this._e[key];
    if (!list) return this;
    this._e[key] = list.filter((f) => f !== fn && f._orig !== fn);
    return this;
  }

  removeListener (type, fn) {
    return this.off(type, fn);
  }

  emit (type, ...args) {
    const list = (this._e[String(type)] || []).slice();
    for (const fn of list) {
      try { fn.apply(this, args); } catch (_) { /* isolate listener errors */ }
    }
    return list.length > 0;
  }

  removeAllListeners (type) {
    if (type == null) this._e = Object.create(null);
    else delete this._e[String(type)];
    return this;
  }

  listenerCount (type) {
    const list = this._e[String(type)];
    return list ? list.length : 0;
  }

  setMaxListeners () {
    return this;
  }
}

module.exports = EventEmitter;
module.exports.EventEmitter = EventEmitter;
module.exports.default = EventEmitter;
