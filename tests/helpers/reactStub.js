'use strict';

/**
 * Minimal React stand-in for Node UI tests (no jsdom / puppeteer).
 * createElement builds a walkable tree; class components are not auto-mounted.
 */

function flattenChildren (children) {
  const out = [];
  for (const child of children) {
    if (child == null || child === false || child === true) continue;
    if (Array.isArray(child)) {
      out.push(...flattenChildren(child));
    } else {
      out.push(child);
    }
  }
  return out;
}

function createElement (type, props, ...rest) {
  const p = props && typeof props === 'object' ? Object.assign({}, props) : {};
  const nested = p.children !== undefined ? [p.children] : [];
  delete p.children;
  return {
    $$typeof: 'element',
    type,
    props: p,
    children: flattenChildren(rest.concat(nested))
  };
}

class Component {
  constructor (props) {
    this.props = props || {};
    this.state = {};
  }

  setState (patch, cb) {
    const next = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    this.state = Object.assign({}, this.state, next || {});
    if (typeof cb === 'function') cb();
  }

  forceUpdate (cb) {
    if (typeof cb === 'function') cb();
  }
}

const Fragment = Symbol.for('react.fragment');

function createRef () {
  return { current: null };
}

const React = {
  createElement,
  Component,
  Fragment,
  createRef,
  createRoot: () => ({ render () {}, unmount () {} })
};

module.exports = React;
module.exports.default = React;
