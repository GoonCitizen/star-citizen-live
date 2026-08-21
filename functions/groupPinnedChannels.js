'use strict';

/**
 * Group-pinned chat channels — curated keys members should prefer
 * (Discord bridges and/or other group Fabric channels).
 */

const { parseDiscordChatChannel, discordChatChannelKey } = require('./discordGuildCatalog');

const MAX_PINNED_CHANNELS = 20;
const GROUP_CHANNEL_RE = /^group:[a-zA-Z0-9_-]{8,128}$/;

/**
 * Normalize a single pin to a chat channel key, or null.
 * Accepts `discord:<id>`, bare Discord snowflake, or `group:<id>`.
 * @param {*} value
 * @returns {string|null}
 */
function normalizePinnedChannelKey (value) {
  if (value == null) return null;
  if (typeof value === 'object') {
    const fromObj = value.key || value.channel || value.channelId || value.id;
    return normalizePinnedChannelKey(fromObj);
  }
  const s = String(value).trim();
  if (!s) return null;
  const discordId = parseDiscordChatChannel(s);
  if (discordId) return discordChatChannelKey(discordId);
  if (/^\d{5,32}$/.test(s)) return discordChatChannelKey(s);
  if (GROUP_CHANNEL_RE.test(s)) return s;
  return null;
}

/**
 * @param {*} value
 * @returns {string[]}
 */
function sanitizePinnedChannels (value) {
  if (value === undefined || value === null || value === '') return [];
  const list = Array.isArray(value) ? value : [value];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const key = normalizePinnedChannelKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= MAX_PINNED_CHANNELS) break;
  }
  return out;
}

/**
 * Collect unique pinned channel rows from groups the viewer belongs to.
 * @param {Array<object>} [groups]
 * @param {Object} [opts]
 * @param {object[]} [opts.discordChannels] catalog rows for labels
 * @returns {object[]} `{ key, label, kind, groupId, groupName, pinned: true, … }`
 */
function pinnedChannelsFromGroups (groups, opts = {}) {
  const list = Array.isArray(groups) ? groups : [];
  const discordByKey = Object.create(null);
  for (const ch of opts.discordChannels || []) {
    if (ch && ch.key) discordByKey[ch.key] = ch;
  }
  const out = [];
  const seen = new Set();
  for (const g of list) {
    if (!g || !g.id) continue;
    const pins = sanitizePinnedChannels(g.pinnedChannels);
    for (const key of pins) {
      if (seen.has(key)) continue;
      seen.add(key);
      const discordId = parseDiscordChatChannel(key);
      if (discordId) {
        const cat = discordByKey[key];
        out.push(Object.assign({}, cat || {}, {
          key,
          label: (cat && cat.label) || ('#' + discordId),
          kind: 'discord',
          channelId: discordId,
          guildId: (cat && cat.guildId) || null,
          guildName: (cat && cat.guildName) || null,
          groupId: g.id,
          groupName: g.name || g.id,
          pinned: true
        }));
        continue;
      }
      if (key.startsWith('group:')) {
        const gid = key.slice('group:'.length);
        out.push({
          key,
          label: g.id === gid ? (g.name || gid) : gid,
          kind: 'group',
          groupId: gid,
          pinnedFromGroupId: g.id,
          groupName: g.name || g.id,
          pinned: true
        });
      }
    }
  }
  return out;
}

module.exports = {
  MAX_PINNED_CHANNELS,
  normalizePinnedChannelKey,
  sanitizePinnedChannels,
  pinnedChannelsFromGroups
};
