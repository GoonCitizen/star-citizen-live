'use strict';

/**
 * Which Discord channels may leave this node over Fabric.
 *
 * Public means a guild text or announcement channel, not age-restricted, that
 * @everyone can view — the same rule goon.vc's Discord → Fabric relay uses.
 * Private channels, threads, voice chat, and DMs never qualify. The answer
 * comes from the live bot only: stored or gossiped catalog rows never make a
 * channel public, so a channel that turns private stops being shared and a
 * channel learned from another group's packs is not passed on.
 */

const { parseDiscordChatChannel, parseDiscordDmChannel } = require('./discordGuildCatalog');

// discord.js PermissionFlagsBits.ViewChannel.
const VIEW_CHANNEL = 1n << 10n;
const PUBLIC_CHANNEL_TYPES = new Set([0, 5]);

/**
 * @param {object} channel discord.js GuildChannel
 * @returns {boolean}
 */
function isPublicDiscordChannel (channel) {
  if (!channel || channel.id == null || !channel.guild) return false;
  if (!PUBLIC_CHANNEL_TYPES.has(Number(channel.type)) || channel.nsfw) return false;
  const everyone = channel.guild.roles && channel.guild.roles.everyone;
  if (!everyone || typeof channel.permissionsFor !== 'function') return false;
  try {
    const permissions = channel.permissionsFor(everyone);
    return !!(permissions && permissions.has(VIEW_CHANNEL));
  } catch (_) {
    return false;
  }
}

/**
 * Ids of every public channel in the guilds a ready bot client can see.
 * @param {object|null} client discord.js Client
 * @returns {Set<string>}
 */
function publicDiscordChannelIds (client) {
  const ids = new Set();
  const guilds = client && client.guilds && client.guilds.cache;
  if (!guilds || typeof guilds.values !== 'function') return ids;
  for (const guild of guilds.values()) {
    const channels = guild && guild.channels && guild.channels.cache;
    if (!channels || typeof channels.values !== 'function') continue;
    for (const channel of channels.values()) {
      if (isPublicDiscordChannel(channel)) ids.add(String(channel.id));
    }
  }
  return ids;
}

/**
 * Catalog guilds narrowed to their public channels; guilds with none are dropped.
 * @param {Array<object>} guilds catalog guild rows
 * @param {Set<string>} publicIds
 * @returns {Array<object>}
 */
function publicCatalogGuilds (guilds, publicIds) {
  const out = [];
  for (const guild of Array.isArray(guilds) ? guilds : []) {
    if (!guild || !Array.isArray(guild.channels)) continue;
    const channels = guild.channels.filter((ch) => ch && ch.id != null && publicIds.has(String(ch.id)));
    if (channels.length) out.push(Object.assign({}, guild, { channels }));
  }
  return out;
}

/**
 * Whether a ChatMessage row may be copied off this node: Discord DMs never,
 * Discord guild channels only when public, everything else unchanged.
 * @param {object} row ChatMessage
 * @param {Set<string>} publicIds
 * @returns {boolean}
 */
function isShareableChatRow (row, publicIds) {
  if (!row) return false;
  const channel = String(row.channel || '');
  if (row.kind === 'discord-dm' || parseDiscordDmChannel(channel)) return false;
  const discordChannelId = parseDiscordChatChannel(channel);
  if (discordChannelId) return publicIds.has(discordChannelId);
  return true;
}

module.exports = {
  VIEW_CHANNEL,
  PUBLIC_CHANNEL_TYPES,
  isPublicDiscordChannel,
  publicDiscordChannelIds,
  publicCatalogGuilds,
  isShareableChatRow
};
