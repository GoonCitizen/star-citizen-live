'use strict';

/**
 * Local Discord ↔ Fabric identity linking for the GoonCitizen chat bridge.
 *
 * Possession of both identities: the operator generates a one-time code while
 * their Fabric key is unlocked, then posts `!link <code>` from their Discord
 * account. The mapping is stored on this node (settings `discordIdentityLinks`)
 * so inbound Discord authors resolve to a Fabric pubkey in unified chat.
 */

const fabricPubkey = require('@fabric/http/functions/fabricPubkey');

const DISCORD_ACTOR_PREFIX = 'discord:';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const USERNAME_MAX = 64;
const LINKS_MAX = 256;

/**
 * Secure random bytes (Web Crypto — works in Node 19+ and the browser bundle).
 * @param {number} n
 * @returns {Uint8Array}
 */
function randomBytes (n) {
  const out = new Uint8Array(n);
  const web = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (!web || typeof web.getRandomValues !== 'function') {
    throw new Error('secure random unavailable');
  }
  web.getRandomValues(out);
  return out;
}

function canonicalChatAuthor (hex) {
  return fabricPubkey.canonicalChatAuthor(hex);
}

/**
 * @param {*} userId Discord snowflake or `discord:<id>`
 * @returns {string|null}
 */
function parseDiscordActor (userId) {
  const s = String(userId || '').trim();
  if (!s) return null;
  if (s.startsWith(DISCORD_ACTOR_PREFIX)) {
    const rest = s.slice(DISCORD_ACTOR_PREFIX.length).trim();
    return rest || null;
  }
  return null;
}

/**
 * @param {*} userId
 * @returns {string|null} `discord:<id>`
 */
function discordActorKey (userId) {
  const parsed = parseDiscordActor(userId);
  if (parsed) return DISCORD_ACTOR_PREFIX + parsed;
  const raw = String(userId || '').trim();
  return raw ? DISCORD_ACTOR_PREFIX + raw : null;
}

/**
 * Fabric pubkey or `discord:<id>` chat author. Does not run Discord ids
 * through secp256k1 canonicalization.
 * @param {*} author
 * @returns {string}
 */
function canonicalChatActor (author) {
  const discordId = parseDiscordActor(author);
  if (discordId) return DISCORD_ACTOR_PREFIX + discordId;
  return canonicalChatAuthor(author);
}

/**
 * @returns {string} 8-character Crockford-ish code
 */
function generateLinkCode () {
  const bytes = randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

/**
 * @param {string} code
 * @returns {boolean}
 */
function isLinkCode (code) {
  const s = String(code || '').trim().toUpperCase();
  if (s.length !== CODE_LENGTH) return false;
  for (let i = 0; i < s.length; i++) {
    if (CODE_ALPHABET.indexOf(s[i]) < 0) return false;
  }
  return true;
}

/**
 * @param {*} text Discord message body
 * @returns {{ action: string, code: string|null }|null}
 */
function parseLinkCommand (text) {
  const s = String(text || '').trim();
  const link = s.match(/^!link(?:\s+(\S+))?$/i);
  if (link) {
    const raw = link[1] ? String(link[1]).trim().toUpperCase() : '';
    return { action: 'link', code: raw || null };
  }
  if (/^!unlink\s*$/i.test(s)) return { action: 'unlink', code: null };
  return null;
}

/**
 * @param {string} code
 * @returns {string}
 */
function formatLinkInstruction (code) {
  const c = String(code || '').trim().toUpperCase();
  return 'Post `!link ' + c + '` in any Discord channel this bot can see. Expires in 10 minutes.';
}

/**
 * @param {Object} opts
 * @param {string} opts.pubkey
 * @param {number} [opts.now]
 * @param {string} [opts.code]
 * @returns {object}
 */
function buildChallenge (opts = {}) {
  const pubkey = canonicalChatAuthor(opts.pubkey);
  const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
  const code = opts.code ? String(opts.code).trim().toUpperCase() : generateLinkCode();
  if (!isLinkCode(code)) throw new Error('invalid link code');
  return {
    code,
    pubkey,
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL_MS
  };
}

/**
 * @param {object} challenge
 * @param {number} [now]
 * @returns {boolean}
 */
function challengeIsFresh (challenge, now) {
  if (!challenge || !challenge.code || !challenge.pubkey) return false;
  const ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  return Number(challenge.expiresAt) > ts;
}

/**
 * @param {*} value
 * @returns {object|null}
 */
function sanitizeLink (value) {
  if (!value || typeof value !== 'object') return null;
  const discordUserId = String(value.discordUserId || parseDiscordActor(value.discordUserId) || '').trim();
  if (!discordUserId) return null;
  let pubkey = null;
  try {
    pubkey = canonicalChatAuthor(value.pubkey);
  } catch (_) {
    return null;
  }
  const username = sanitizeUsername(value.username);
  const linkedAt = value.linkedAt ? String(value.linkedAt) : new Date().toISOString();
  return {
    discordUserId,
    pubkey,
    username,
    linkedAt,
    verified: value.verified !== false
  };
}

/**
 * @param {*} list
 * @returns {Array<object>}
 */
function sanitizeLinks (list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const byDiscord = new Set();
  const byPubkey = new Set();
  for (const row of list) {
    const link = sanitizeLink(row);
    if (!link) continue;
    if (byDiscord.has(link.discordUserId) || byPubkey.has(link.pubkey)) continue;
    byDiscord.add(link.discordUserId);
    byPubkey.add(link.pubkey);
    out.push(link);
    if (out.length >= LINKS_MAX) break;
  }
  return out;
}

/**
 * @param {Array<object>} links
 * @param {object} next
 * @returns {Array<object>}
 */
function upsertLink (links, next) {
  const row = sanitizeLink(next);
  if (!row) return sanitizeLinks(links);
  const rest = sanitizeLinks(links).filter((l) => {
    return l.discordUserId !== row.discordUserId && l.pubkey !== row.pubkey;
  });
  rest.push(row);
  return rest.slice(-LINKS_MAX);
}

/**
 * @param {Array<object>} links
 * @param {Object} opts
 * @param {string} [opts.discordUserId]
 * @param {string} [opts.pubkey]
 * @returns {{ links: Array<object>, removed: object|null }}
 */
function removeLink (links, opts = {}) {
  const list = sanitizeLinks(links);
  const discordUserId = opts.discordUserId != null
    ? String(opts.discordUserId || parseDiscordActor(opts.discordUserId) || '').trim()
    : '';
  let pubkey = null;
  if (opts.pubkey) {
    try { pubkey = canonicalChatAuthor(opts.pubkey); } catch (_) { pubkey = null; }
  }
  let removed = null;
  const next = list.filter((l) => {
    const hit = (discordUserId && l.discordUserId === discordUserId) ||
      (pubkey && l.pubkey === pubkey);
    if (hit && !removed) removed = l;
    return !hit;
  });
  return { links: next, removed };
}

/**
 * @param {Array<object>} links
 * @param {*} discordUserId
 * @returns {object|null}
 */
function linkForDiscordUser (links, discordUserId) {
  const id = String(discordUserId || parseDiscordActor(discordUserId) || '').trim();
  if (!id) return null;
  return sanitizeLinks(links).find((l) => l.discordUserId === id) || null;
}

/**
 * @param {Array<object>} links
 * @param {*} pubkey
 * @returns {object|null}
 */
function linkForPubkey (links, pubkey) {
  let pk = null;
  try { pk = canonicalChatAuthor(pubkey); } catch (_) { return null; }
  return sanitizeLinks(links).find((l) => l.pubkey === pk) || null;
}

/**
 * @param {object} link
 * @returns {string}
 */
function formatLinkedReply (link) {
  const user = (link && link.username) || (link && link.discordUserId) || 'user';
  const pk = link && link.pubkey ? String(link.pubkey).slice(0, 8) + '…' : 'identity';
  return 'Linked Discord **' + user + '** ↔ Fabric `' + pk + '`. Chat from this account now uses your GoonCitizen identity.';
}

/**
 * @param {object} [link]
 * @returns {string}
 */
function formatUnlinkedReply (link) {
  const user = (link && link.username) || (link && link.discordUserId) || 'this Discord account';
  return 'Unlinked **' + user + '** from Fabric on this node.';
}

/**
 * Prefix local Chat → Discord posts so guild members see the operator name.
 * @param {string|null} handle
 * @param {string} body
 * @returns {string}
 */
function formatOutboundDiscordContent (handle, body) {
  const who = String(handle || 'GoonCitizen')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32) || 'GoonCitizen';
  const text = String(body || '').trim();
  return ('**' + who + ':** ' + text).slice(0, 2000);
}

/**
 * Merge ChatManager rows with Discord insight by `discordMessageId`.
 * Stored ChatMessages win on overlapping fields.
 * @param {Array<object>} stored
 * @param {Array<object>} insight
 * @returns {Array<object>}
 */
function mergeDiscordThreadMessages (stored, insight) {
  const byKey = new Map();
  const keyOf = (m) => {
    if (!m) return null;
    if (m.discordMessageId) return 'd:' + String(m.discordMessageId);
    const id = String(m.id || '');
    if (id.indexOf('discord-msg:') === 0) return 'd:' + id.slice('discord-msg:'.length);
    return id ? 'id:' + id : null;
  };
  for (const m of insight || []) {
    const k = keyOf(m);
    if (!k) continue;
    byKey.set(k, Object.assign({}, m));
  }
  for (const m of stored || []) {
    const k = keyOf(m);
    if (!k) continue;
    const prev = byKey.get(k) || {};
    byKey.set(k, Object.assign({}, prev, m));
  }
  return Array.from(byKey.values()).sort((a, b) => {
    const ta = String(a.ts || '');
    const tb = String(b.ts || '');
    if (ta !== tb) return ta < tb ? -1 : 1;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

/**
 * Remap `discord:<id>` authors to linked Fabric pubkeys.
 * @param {Array<object>} messages
 * @param {Array<object>} links
 * @returns {Array<object>}
 */
function applyLinksToMessages (messages, links) {
  const list = sanitizeLinks(links);
  return (messages || []).map((m) => {
    if (!m) return m;
    const discordUserId = m.discordUserId || parseDiscordActor(m.author);
    if (!discordUserId) return m;
    const link = linkForDiscordUser(list, discordUserId);
    if (!link) return m;
    return Object.assign({}, m, {
      author: link.pubkey,
      discordUserId,
      linked: true,
      handle: m.handle || link.username || null
    });
  });
}

/**
 * @param {*} value
 * @returns {string|null}
 */
function sanitizeUsername (value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, USERNAME_MAX);
  return s || null;
}

module.exports = {
  DISCORD_ACTOR_PREFIX,
  CODE_LENGTH,
  CHALLENGE_TTL_MS,
  parseDiscordActor,
  discordActorKey,
  canonicalChatActor,
  generateLinkCode,
  isLinkCode,
  parseLinkCommand,
  formatLinkInstruction,
  buildChallenge,
  challengeIsFresh,
  sanitizeLink,
  sanitizeLinks,
  upsertLink,
  removeLink,
  linkForDiscordUser,
  linkForPubkey,
  formatLinkedReply,
  formatUnlinkedReply,
  formatOutboundDiscordContent,
  mergeDiscordThreadMessages,
  applyLinksToMessages
};
