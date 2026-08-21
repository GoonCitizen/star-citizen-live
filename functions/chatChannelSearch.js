'use strict';

/**
 * Filter helpers for the Chat left-rail channel list (Global, groups, DMs, Discord).
 */

const { channelRowMatchesKey } = require('./chatChannelList');

/** @type {ReadonlyArray<[string, string]>} */
const CHANNEL_KIND_FILTERS = Object.freeze([
  ['all', 'All'],
  ['global', 'Global'],
  ['group', 'Groups'],
  ['dm', 'DMs'],
  ['discord', 'Discord']
]);

/**
 * @param {string} [query]
 * @returns {string}
 */
function normalizeChannelQuery (query) {
  return String(query || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * @param {object} ch Channel row from Chat / Discord catalog
 * @returns {string}
 */
function channelSearchHaystack (ch) {
  if (!ch || typeof ch !== 'object') return '';
  return [
    ch.label,
    ch.key,
    ch.kind,
    ch.guildName,
    ch.guildId,
    ch.name,
    ch.peerPubkey,
    ch.groupId,
    ch.channelId,
    ch.typeName,
    ch.discordLabel,
    ch.groupName,
    ch.fabricKey,
    ch.discordKey,
    Array.isArray(ch.platforms) ? ch.platforms.join(' ') : ''
  ].filter((v) => v != null && v !== '').map(String).join(' ').toLowerCase();
}

/**
 * @param {object} ch
 * @param {string} [query]
 * @returns {boolean}
 */
function channelMatchesQuery (ch, query) {
  const q = normalizeChannelQuery(query);
  if (!q) return true;
  return channelSearchHaystack(ch).includes(q);
}

/**
 * @param {object} ch
 * @param {string} [kind] `all` or a CHANNEL_KIND_FILTERS key
 * @returns {boolean}
 */
function channelMatchesKind (ch, kind) {
  if (!kind || kind === 'all') return true;
  if (!ch) return false;
  if (ch.kind === kind) return true;
  if (ch.kind === 'discord-dm' && (kind === 'discord' || kind === 'dm')) return true;
  // Bridged Fabric+Discord rows match both Group and Discord chips.
  if (ch.bridged && (kind === 'group' || kind === 'discord')) return true;
  if (kind === 'discord' && Array.isArray(ch.platforms) && ch.platforms.indexOf('discord') >= 0) {
    return true;
  }
  return false;
}

/**
 * @param {object} ch
 * @param {Object} [criteria]
 * @param {string} [criteria.query]
 * @param {string} [criteria.kind]
 * @returns {boolean}
 */
function channelMatchesCriteria (ch, criteria = {}) {
  if (!ch) return false;
  if (!channelMatchesKind(ch, criteria.kind)) return false;
  return channelMatchesQuery(ch, criteria.query);
}

/**
 * @param {object[]} [list]
 * @param {string|Object} [queryOrCriteria] Legacy string query, or `{ query, kind }`
 * @param {Object} [opts]
 * @param {string} [opts.keepKey] Always include this channel key (active selection)
 * @param {string} [opts.kind]
 * @returns {object[]}
 */
function filterChannels (list, queryOrCriteria, opts = {}) {
  const rows = Array.isArray(list) ? list : [];
  const criteria = (queryOrCriteria && typeof queryOrCriteria === 'object')
    ? queryOrCriteria
    : { query: queryOrCriteria, kind: opts.kind };
  const keepKey = opts.keepKey || null;
  const active = !!(normalizeChannelQuery(criteria.query) ||
    (criteria.kind && criteria.kind !== 'all'));
  if (!active) return rows.slice();
  return rows.filter((ch) => {
    if (keepKey && channelRowMatchesKey(ch, keepKey)) return true;
    return channelMatchesCriteria(ch, criteria);
  });
}

/**
 * Filter Discord guild groups; guild-name match keeps all of that guild's channels.
 * @param {Array<{ id: string, name: string, channels: object[] }>} [groups]
 * @param {string|Object} [queryOrCriteria]
 * @param {Object} [opts]
 * @param {string} [opts.keepKey]
 * @param {string} [opts.kind]
 * @returns {Array<{ id: string, name: string, channels: object[] }>}
 */
function filterDiscordGuildGroups (groups, queryOrCriteria, opts = {}) {
  const list = Array.isArray(groups) ? groups : [];
  const criteria = (queryOrCriteria && typeof queryOrCriteria === 'object')
    ? queryOrCriteria
    : { query: queryOrCriteria, kind: opts.kind };
  const kind = criteria.kind || 'all';
  if (kind !== 'all' && kind !== 'discord') return [];

  const q = normalizeChannelQuery(criteria.query);
  const keepKey = opts.keepKey || null;
  if (!q) {
    return list.map((g) => Object.assign({}, g, { channels: (g.channels || []).slice() }));
  }
  const out = [];
  for (const g of list) {
    const guildHit = String(g.name || '').toLowerCase().includes(q) ||
      String(g.id || '').toLowerCase().includes(q);
    const channels = (g.channels || []).filter((ch) => {
      if (keepKey && ch && ch.key === keepKey) return true;
      if (guildHit) return true;
      return channelMatchesQuery(ch, q);
    });
    if (channels.length) out.push(Object.assign({}, g, { channels }));
  }
  return out;
}

module.exports = {
  CHANNEL_KIND_FILTERS,
  normalizeChannelQuery,
  channelSearchHaystack,
  channelMatchesQuery,
  channelMatchesKind,
  channelMatchesCriteria,
  filterChannels,
  filterDiscordGuildGroups
};
