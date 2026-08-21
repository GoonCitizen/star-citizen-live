'use strict';

/**
 * Chat message pins — per-message 📌 state (not channel shortcuts).
 *
 * Local truth lives on the ChatMessage record (`pinned`). Group channels
 * also overlay ids on `Group.pinnedMessages` via GroupChange `update` so
 * members converge without a new genesis message type.
 */

const MAX_PINNED_MESSAGES = 50;
const MESSAGE_ID_RE = /^[a-zA-Z0-9_-]{8,128}$/;

/**
 * @param {*} value
 * @returns {string|null}
 */
function normalizePinnedMessageId (value) {
  if (value == null) return null;
  if (typeof value === 'object') {
    return normalizePinnedMessageId(value.id || value.messageId || value.hash);
  }
  const id = String(value).trim();
  if (!MESSAGE_ID_RE.test(id)) return null;
  return id;
}

/**
 * @param {*} value
 * @returns {string[]}
 */
function sanitizePinnedMessageIds (value) {
  if (value === undefined || value === null || value === '') return [];
  const list = Array.isArray(value) ? value : [value];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const id = normalizePinnedMessageId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_PINNED_MESSAGES) break;
  }
  return out;
}

/**
 * @param {*} list
 * @param {*} id
 * @param {boolean} pinned
 * @returns {string[]}
 */
function togglePinnedMessageId (list, id, pinned) {
  const key = normalizePinnedMessageId(id);
  const cur = sanitizePinnedMessageIds(list);
  if (!key) return cur;
  if (pinned) {
    if (cur.includes(key)) return cur;
    return sanitizePinnedMessageIds(cur.concat([key]));
  }
  return cur.filter((x) => x !== key);
}

/**
 * Treat a row as pinned when the record flag is set or its id is in the
 * group's overlay list.
 * @param {object[]} rows
 * @param {*} pinnedIds
 * @returns {object[]}
 */
function overlayPinnedMessages (rows, pinnedIds) {
  const list = Array.isArray(rows) ? rows : [];
  const set = new Set(sanitizePinnedMessageIds(pinnedIds));
  if (!set.size) return list;
  return list.map((m) => {
    if (!m || !m.id) return m;
    const pinned = m.pinned === true || set.has(m.id);
    if (pinned === (m.pinned === true)) return m;
    return Object.assign({}, m, { pinned });
  });
}

/**
 * `{ pinnedMessages }` and nothing else — members may propose this without
 * being the group creator.
 * @param {*} patch
 * @returns {boolean}
 */
function isPinnedMessagesOnlyPatch (patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
  const keys = Object.keys(patch);
  return keys.length === 1 && keys[0] === 'pinnedMessages';
}

/**
 * @param {object} [body]
 * @param {boolean} [currentPinned]
 * @returns {boolean}
 */
function parsePinRequest (body, currentPinned) {
  if (body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'pinned')) {
    const v = body.pinned;
    if (v === false || v === 0 || v === 'false' || v === '0' || v === null) return false;
    return true;
  }
  return !currentPinned;
}

module.exports = {
  MAX_PINNED_MESSAGES,
  normalizePinnedMessageId,
  sanitizePinnedMessageIds,
  togglePinnedMessageId,
  overlayPinnedMessages,
  isPinnedMessagesOnlyPatch,
  parsePinRequest
};
