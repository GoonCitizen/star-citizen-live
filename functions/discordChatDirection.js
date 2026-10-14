'use strict';

/**
 * Per-channel Discord bridge direction for Chat compose / POST.
 *
 * Settings key `discordChatDirections`: `{ [channelId]: 'listen' | 'bidirectional' }`.
 * Missing channel id → bidirectional (preserve today's "any channel can post" UX).
 * DMs (`discord:dm:<userId>`) are always bidirectional when the bot is ready.
 */

const DIRECTION_LISTEN = 'listen';
const DIRECTION_BIDIRECTIONAL = 'bidirectional';
// Discord snowflakes are digits; allow short alphanumeric stubs used in tests.
const CHANNEL_ID_RE = /^[0-9A-Za-z_-]{2,32}$/;
const MAX_ENTRIES = 512;

/**
 * @param {*} value
 * @returns {'listen'|'bidirectional'|null}
 */
function normalizeDirection (value) {
  if (value === DIRECTION_LISTEN || value === 'listen-only') return DIRECTION_LISTEN;
  if (value === DIRECTION_BIDIRECTIONAL || value === 'bi-directional' || value === 'bidir') {
    return DIRECTION_BIDIRECTIONAL;
  }
  return null;
}

/**
 * Sanitize the persisted directions map. Drops invalid ids / values; empty → null.
 * @param {*} value
 * @returns {Object<string, 'listen'|'bidirectional'>|null}
 */
function normalizeDirections (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  let n = 0;
  for (const [rawId, rawDir] of Object.entries(value)) {
    if (n >= MAX_ENTRIES) break;
    const id = String(rawId || '').trim();
    if (!CHANNEL_ID_RE.test(id)) continue;
    const dir = normalizeDirection(rawDir);
    if (!dir) continue;
    out[id] = dir;
    n += 1;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Resolve direction for a guild text/announce channel id.
 * @param {string|null|undefined} channelId Discord snowflake
 * @param {Object} [settings] operator settings (or `{ discordChatDirections }`)
 * @returns {'listen'|'bidirectional'}
 */
function directionForChannel (channelId, settings) {
  const id = channelId != null ? String(channelId).trim() : '';
  if (!id || !CHANNEL_ID_RE.test(id)) return DIRECTION_BIDIRECTIONAL;
  const map = normalizeDirections(
    settings && (settings.discordChatDirections != null
      ? settings.discordChatDirections
      : settings)
  ) || {};
  const dir = map[id];
  return dir === DIRECTION_LISTEN ? DIRECTION_LISTEN : DIRECTION_BIDIRECTIONAL;
}

/**
 * Whether Chat → Discord post is allowed for this guild channel.
 * DMs always allowed (caller should not use this for DM keys).
 * @param {string|null|undefined} channelId
 * @param {Object} [settings]
 * @returns {boolean}
 */
function isDiscordOutboundAllowed (channelId, settings) {
  return directionForChannel(channelId, settings) === DIRECTION_BIDIRECTIONAL;
}

/**
 * Merge one channel direction into a map (for PUT helpers / UI).
 * Setting `bidirectional` removes the entry (default).
 * @param {Object|null|undefined} current
 * @param {string} channelId
 * @param {'listen'|'bidirectional'} direction
 * @returns {Object<string, 'listen'|'bidirectional'>|null}
 */
function setChannelDirection (current, channelId, direction) {
  const id = channelId != null ? String(channelId).trim() : '';
  if (!CHANNEL_ID_RE.test(id)) {
    return normalizeDirections(current);
  }
  const next = Object.assign({}, normalizeDirections(current) || {});
  const dir = normalizeDirection(direction) || DIRECTION_BIDIRECTIONAL;
  if (dir === DIRECTION_BIDIRECTIONAL) delete next[id];
  else next[id] = DIRECTION_LISTEN;
  return normalizeDirections(next);
}

module.exports = {
  DIRECTION_LISTEN,
  DIRECTION_BIDIRECTIONAL,
  CHANNEL_ID_RE,
  MAX_ENTRIES,
  normalizeDirection,
  normalizeDirections,
  directionForChannel,
  isDiscordOutboundAllowed,
  setChannelDirection
};
