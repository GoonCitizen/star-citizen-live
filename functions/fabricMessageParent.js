'use strict';

/**
 * AMP header `parent` helpers. Prefer `@fabric/core/functions/fabricMessageParent`
 * when the pin exports it; otherwise write `raw.parent` locally so GoonCitizen
 * can chain frames before the next core bump.
 */

try {
  const core = require('@fabric/core/functions/fabricMessageParent');
  if (core && typeof core.setMessageParent === 'function') {
    module.exports = core;
    return;
  }
} catch (err) {
  if (!err || err.code !== 'MODULE_NOT_FOUND') throw err;
}

const Hash256 = require('@fabric/core/types/hash256');

const ZERO_PARENT = '00'.repeat(32);

function isZeroParent (value) {
  try {
    return normalizeParentHex(value) === ZERO_PARENT;
  } catch (_) {
    return false;
  }
}

function normalizeParentHex (value) {
  if (value == null || value === '') return ZERO_PARENT;
  if (typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    if (typeof value.id === 'string' && /^[0-9a-f]{64}$/i.test(value.id)) {
      return String(value.id).toLowerCase();
    }
    if (value.raw && Buffer.isBuffer(value.raw.parent) && value.raw.parent.length === 32) {
      return value.raw.parent.toString('hex');
    }
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    if (value.length !== 32) throw new Error('Message parent must be 32 bytes');
    return Buffer.from(value).toString('hex');
  }
  const s = String(value).trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(s)) throw new Error('Message parent must be 32-byte hex');
  return s;
}

function parentHexOf (message) {
  if (!message) return ZERO_PARENT;
  if (typeof message.parent === 'string' && /^[0-9a-f]{64}$/i.test(message.parent)) {
    return String(message.parent).toLowerCase();
  }
  const raw = message.raw && message.raw.parent;
  if (Buffer.isBuffer(raw) && raw.length === 32) return raw.toString('hex');
  return ZERO_PARENT;
}

function frameIdOf (messageOrBuffer) {
  if (!messageOrBuffer) return null;
  if (Buffer.isBuffer(messageOrBuffer)) return Hash256.digest(messageOrBuffer);
  if (typeof messageOrBuffer.toBuffer === 'function') {
    try {
      return Hash256.digest(messageOrBuffer.toBuffer());
    } catch (_) {
      return null;
    }
  }
  if (typeof messageOrBuffer.id === 'string' && /^[0-9a-f]{64}$/i.test(messageOrBuffer.id)) {
    return String(messageOrBuffer.id).toLowerCase();
  }
  return null;
}

function setMessageParent (message, parent) {
  if (!message || !message.raw) throw new Error('Message required');
  const hex = normalizeParentHex(parent);
  if (!Buffer.isBuffer(message.raw.parent) || message.raw.parent.length !== 32) {
    message.raw.parent = Buffer.alloc(32);
  }
  Buffer.from(hex, 'hex').copy(message.raw.parent);
  return message;
}

module.exports = {
  ZERO_PARENT,
  isZeroParent,
  normalizeParentHex,
  parentHexOf,
  frameIdOf,
  setMessageParent
};
