'use strict';

/**
 * Intercept `require('react')` (and react-dom) before loading dashboard components.
 */

const Module = require('node:module');
const stub = require('./reactStub');

if (!Module._load.__gcReactStub) {
  const orig = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'react' || request === 'react-dom' || request === 'react-dom/client') {
      return stub;
    }
    return orig.apply(this, arguments);
  };
  Module._load.__gcReactStub = true;
}

if (typeof global.window === 'undefined') {
  global.window = {
    location: { hash: '', href: 'http://127.0.0.1/', pathname: '/', search: '' },
    electronAPI: null,
    addEventListener () {},
    removeEventListener () {}
  };
}

if (typeof global.document === 'undefined') {
  global.document = {
    body: { classList: { toggle () {}, add () {}, remove () {} } },
    addEventListener () {},
    removeEventListener () {}
  };
}

if (typeof global.sessionStorage === 'undefined') {
  const mem = new Map();
  global.sessionStorage = {
    getItem (k) { return mem.has(k) ? mem.get(k) : null; },
    setItem (k, v) { mem.set(String(k), String(v)); },
    removeItem (k) { mem.delete(k); }
  };
}

module.exports = stub;
