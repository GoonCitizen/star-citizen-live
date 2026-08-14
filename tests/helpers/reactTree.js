'use strict';

function walk (node, visit) {
  if (node == null) return;
  visit(node);
  if (node && node.$$typeof === 'element') {
    for (const child of node.children || []) walk(child, visit);
  }
}

function collect (node, pred) {
  const out = [];
  walk(node, (n) => {
    if (pred(n)) out.push(n);
  });
  return out;
}

const TEXT_PROPS = ['value', 'placeholder', 'title', 'alt', 'aria-label'];

function textOf (node) {
  const parts = [];
  walk(node, (n) => {
    if (typeof n === 'string' || typeof n === 'number') parts.push(String(n));
    if (n && n.$$typeof === 'element' && n.props) {
      for (const key of TEXT_PROPS) {
        if (n.props[key] != null && n.props[key] !== false) {
          parts.push(String(n.props[key]));
        }
      }
    }
  });
  return parts.join(' ');
}

function classList (node) {
  if (!node || node.$$typeof !== 'element') return [];
  return String((node.props && node.props.className) || '').split(/\s+/).filter(Boolean);
}

function hasClass (node, cls) {
  return collect(node, (n) => classList(n).includes(cls)).length > 0;
}

function findByClass (node, cls) {
  return collect(node, (n) => classList(n).includes(cls));
}

function findType (node, type) {
  return collect(node, (n) => n && n.$$typeof === 'element' && n.type === type);
}

function findText (node, snippet) {
  const needle = String(snippet);
  return collect(node, (n) => {
    if (typeof n === 'string' || typeof n === 'number') {
      return String(n).includes(needle);
    }
    if (n && n.$$typeof === 'element') return textOf(n).includes(needle);
    return false;
  });
}

module.exports = {
  walk,
  collect,
  textOf,
  classList,
  hasClass,
  findByClass,
  findType,
  findText
};
