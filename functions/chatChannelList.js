'use strict';

/**
 * Flatten Fabric + Discord chat channels into one rail.
 *
 * A row can be Fabric-only, Discord-only, or **bridged** (a Federation group
 * that pins a Discord channel). Bridged rows keep both keys: ChatManager still
 * stores `group:<id>` and `discord:<id>` separately; the UI shows one channel
 * that is both, even when the local bot relays Discord as itself.
 */

const { parseDiscordChatChannel } = require('./discordGuildCatalog');
const { sanitizePinnedChannels } = require('./groupPinnedChannels');

/**
 * Map group pins → Discord keys (and the reverse).
 * @param {Array<object>} [groups]
 * @returns {{ byGroupId: Object<string, string[]>, byDiscordKey: Object<string, { groupId: string, groupName: string }> }}
 */
function bridgesFromGroups (groups) {
  const byGroupId = Object.create(null);
  const byDiscordKey = Object.create(null);
  for (const g of Array.isArray(groups) ? groups : []) {
    if (!g || !g.id) continue;
    const pins = sanitizePinnedChannels(g.pinnedChannels);
    const discordKeys = [];
    for (const key of pins) {
      if (!parseDiscordChatChannel(key)) continue;
      discordKeys.push(key);
      if (!byDiscordKey[key]) {
        byDiscordKey[key] = { groupId: g.id, groupName: g.name || g.id };
      }
    }
    if (discordKeys.length) byGroupId[g.id] = discordKeys;
  }
  return { byGroupId, byDiscordKey };
}

/**
 * @param {string} channel
 * @param {Array<object>} [groups]
 * @returns {{ fabricKey: string|null, discordKeys: string[], discordKey: string|null, bridged: boolean }}
 */
function bridgeForChannel (channel, groups) {
  const key = String(channel || '');
  const { byGroupId, byDiscordKey } = bridgesFromGroups(groups);
  if (key.startsWith('group:')) {
    const groupId = key.slice('group:'.length);
    const discordKeys = byGroupId[groupId] || [];
    return {
      fabricKey: key,
      discordKeys,
      discordKey: discordKeys[0] || null,
      bridged: discordKeys.length > 0
    };
  }
  const discordId = parseDiscordChatChannel(key);
  if (discordId) {
    const link = byDiscordKey[key];
    if (link) {
      return {
        fabricKey: 'group:' + link.groupId,
        discordKeys: [key],
        discordKey: key,
        bridged: true
      };
    }
    return {
      fabricKey: null,
      discordKeys: [key],
      discordKey: key,
      bridged: false
    };
  }
  return {
    fabricKey: key || null,
    discordKeys: [],
    discordKey: null,
    bridged: false
  };
}

/**
 * @param {object} ch
 * @param {string} key
 * @returns {boolean}
 */
function channelRowMatchesKey (ch, key) {
  if (!ch || !key) return false;
  if (ch.key === key || ch.fabricKey === key || ch.discordKey === key) return true;
  return Array.isArray(ch.discordKeys) && ch.discordKeys.indexOf(key) >= 0;
}

function decorateFabricRow (ch, bridges, discordByKey) {
  const row = Object.assign({}, ch);
  row.fabricKey = ch.key;
  row.platforms = ['fabric'];
  row.bridged = false;
  row.discordKey = null;
  row.discordKeys = [];
  if (ch.kind === 'group' && ch.groupId && bridges.byGroupId[ch.groupId]) {
    const discordKeys = bridges.byGroupId[ch.groupId].slice();
    const first = discordByKey[discordKeys[0]] || {};
    row.bridged = true;
    row.platforms = ['fabric', 'discord'];
    row.discordKeys = discordKeys;
    row.discordKey = discordKeys[0];
    row.guildName = first.guildName || row.guildName || null;
    row.guildId = first.guildId || row.guildId || null;
    row.discordLabel = first.label || null;
    if (first.bot) row.bot = first.bot;
  }
  return row;
}

function decorateDiscordRow (ch, bridges) {
  const row = Object.assign({}, ch);
  const link = bridges.byDiscordKey[ch.key];
  row.discordKey = ch.key;
  row.discordKeys = [ch.key];
  row.platforms = ['discord'];
  row.bridged = false;
  row.fabricKey = null;
  if (link) {
    row.bridged = true;
    row.platforms = ['fabric', 'discord'];
    row.fabricKey = 'group:' + link.groupId;
    row.groupId = link.groupId;
    row.groupName = link.groupName;
  }
  return row;
}

/**
 * One flat list: Fabric channels (with Discord merged onto pinned groups),
 * then leftover Discord channels, then the local-bot DM.
 *
 * @param {Object} [opts]
 * @param {object[]} [opts.fabricChannels]
 * @param {object[]} [opts.discordChannels]
 * @param {object[]} [opts.openDmChannels]
 * @param {object[]} [opts.groups]
 * @param {object|null} [opts.botDm]
 * @returns {object[]}
 */
function flattenChatChannels (opts = {}) {
  const fabric = Array.isArray(opts.fabricChannels) ? opts.fabricChannels : [];
  const discord = Array.isArray(opts.discordChannels) ? opts.discordChannels : [];
  const openDms = Array.isArray(opts.openDmChannels) ? opts.openDmChannels : [];
  const groups = Array.isArray(opts.groups) ? opts.groups : [];
  const botDm = opts.botDm || null;
  const bridges = bridgesFromGroups(groups);

  const discordByKey = Object.create(null);
  for (const ch of discord) {
    if (ch && ch.key) discordByKey[ch.key] = ch;
  }

  const out = [];
  const seen = new Set();
  const push = (row) => {
    if (!row || !row.key || seen.has(row.key)) return;
    seen.add(row.key);
    out.push(row);
  };

  for (const ch of fabric) push(decorateFabricRow(ch, bridges, discordByKey));
  for (const ch of openDms) {
    if (!ch || !ch.key || seen.has(ch.key)) continue;
    push(decorateFabricRow(ch, bridges, discordByKey));
  }

  const consumedDiscord = new Set();
  for (const row of out) {
    for (const k of row.discordKeys || []) consumedDiscord.add(k);
  }

  for (const ch of discord) {
    if (!ch || !ch.key || consumedDiscord.has(ch.key) || seen.has(ch.key)) continue;
    const row = decorateDiscordRow(ch, bridges);
    if (row.bridged && row.fabricKey && seen.has(row.fabricKey)) continue;
    push(row);
  }

  if (botDm && botDm.key && !seen.has(botDm.key)) {
    push(Object.assign({}, botDm, {
      platforms: ['discord'],
      fabricKey: null,
      discordKey: botDm.key,
      discordKeys: [botDm.key],
      bridged: false
    }));
  }

  return out;
}

/**
 * Canonical pick() key: bridged Discord rows open the Fabric group thread.
 * @param {object} row
 * @returns {string|null}
 */
function pickKeyForRow (row) {
  if (!row) return null;
  if (row.bridged && row.fabricKey) return row.fabricKey;
  return row.key || row.discordKey || row.fabricKey || null;
}

module.exports = {
  bridgesFromGroups,
  bridgeForChannel,
  channelRowMatchesKey,
  flattenChatChannels,
  pickKeyForRow
};
