'use strict';

/**
 * Chat members rail ordering: online first, then most recent message, then
 * handle / pubkey as a stable tiebreak.
 */

/**
 * Parse a message timestamp to epoch ms. Missing / invalid → 0 (sorts oldest).
 * @param {*} ts
 * @returns {number}
 */
function messageTsMs (ts) {
  if (ts == null || ts === '') return 0;
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  const n = Date.parse(String(ts));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Max message timestamp (ms) per author pubkey from a message list.
 * @param {Array<{ author?: string, ts?: * }>} messages
 * @returns {Map<string, number>}
 */
function lastMessageAtByAuthor (messages) {
  const out = new Map();
  for (const m of messages || []) {
    const author = m && m.author != null ? String(m.author) : '';
    if (!author) continue;
    const ms = messageTsMs(m.ts);
    const prev = out.get(author) || 0;
    if (ms >= prev) out.set(author, ms);
  }
  return out;
}

/**
 * Compare two member rows for the Chat members rail.
 * @param {{ online?: boolean, lastMessageAt?: number, handle?: string, pubkey?: string }} a
 * @param {{ online?: boolean, lastMessageAt?: number, handle?: string, pubkey?: string }} b
 * @returns {number}
 */
function compareChatMembers (a, b) {
  const aOn = !!(a && a.online);
  const bOn = !!(b && b.online);
  if (aOn !== bOn) return bOn ? 1 : -1;
  const aTs = (a && Number(a.lastMessageAt)) || 0;
  const bTs = (b && Number(b.lastMessageAt)) || 0;
  if (aTs !== bTs) return bTs - aTs;
  const an = String((a && (a.handle || a.pubkey)) || '').toLowerCase();
  const bn = String((b && (b.handle || b.pubkey)) || '').toLowerCase();
  return an.localeCompare(bn);
}

/**
 * Sort a copy of members: online → lastMessageAt desc → handle/pubkey.
 * @param {object[]} members
 * @returns {object[]}
 */
function sortChatMembers (members) {
  return (members || []).slice().sort(compareChatMembers);
}

module.exports = {
  messageTsMs,
  lastMessageAtByAuthor,
  compareChatMembers,
  sortChatMembers
};
