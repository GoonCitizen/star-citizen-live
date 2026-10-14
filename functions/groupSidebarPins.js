'use strict';

/**
 * Operator-local Groups sidebar pins (this node only — not Federation).
 * Federation-wide chat pins stay on `GroupChange` `pinnedChannels`.
 */

const STORAGE_KEY = 'gooncitizen.groups.pinnedIds';
const MAX_PINNED_GROUPS = 40;
const GROUP_ID_RE = /^[a-zA-Z0-9_-]{4,128}$/;

/**
 * @param {*} value
 * @returns {string[]}
 */
function sanitizePinnedGroupIds (value) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const id = String(raw || '').trim();
    if (!GROUP_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_PINNED_GROUPS) break;
  }
  return out;
}

/**
 * @returns {string[]}
 */
function readPinnedGroupIds () {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return sanitizePinnedGroupIds(JSON.parse(raw));
  } catch (_) {
    return [];
  }
}

/**
 * @param {string[]} ids
 * @returns {string[]}
 */
function writePinnedGroupIds (ids) {
  const next = sanitizePinnedGroupIds(ids);
  try {
    if (typeof localStorage !== 'undefined') {
      if (next.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      else localStorage.removeItem(STORAGE_KEY);
    }
  } catch (_) { /* ignore */ }
  return next;
}

/**
 * @param {string[]} ids
 * @param {string} groupId
 * @returns {string[]}
 */
function togglePinnedGroupId (ids, groupId) {
  const id = String(groupId || '').trim();
  if (!GROUP_ID_RE.test(id)) return sanitizePinnedGroupIds(ids);
  const current = sanitizePinnedGroupIds(ids);
  if (current.includes(id)) return current.filter((x) => x !== id);
  return current.concat([id]).slice(0, MAX_PINNED_GROUPS);
}

/**
 * Pinned groups first (pin order), then the remaining list order.
 * @param {Array<object>} groups
 * @param {string[]} pinnedIds
 * @returns {Array<object>}
 */
function orderGroupsWithPins (groups, pinnedIds) {
  const list = Array.isArray(groups) ? groups.slice() : [];
  const pins = sanitizePinnedGroupIds(pinnedIds);
  if (!pins.length || !list.length) return list;
  const byId = new Map();
  for (const g of list) {
    if (g && g.id) byId.set(g.id, g);
  }
  const out = [];
  const seen = new Set();
  for (const id of pins) {
    const g = byId.get(id);
    if (!g) continue;
    out.push(g);
    seen.add(id);
  }
  for (const g of list) {
    if (!g || !g.id || seen.has(g.id)) continue;
    out.push(g);
  }
  return out;
}

module.exports = {
  STORAGE_KEY,
  MAX_PINNED_GROUPS,
  sanitizePinnedGroupIds,
  readPinnedGroupIds,
  writePinnedGroupIds,
  togglePinnedGroupId,
  orderGroupsWithPins
};
