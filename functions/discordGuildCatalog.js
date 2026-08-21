'use strict';

/**
 * Serialize Discord guilds, channels, and users for the GoonCitizen Chat UI.
 * Pure helpers — pass a live discord.js Client (or a cache-shaped stub).
 */

const { botPermissionsFromChannel } = require('./discordChannelAccess');
const { discordBotAuthorizeUrl } = require('./discordBotAuthorize');

const DISCORD_CHAT_PREFIX = 'discord:';
/** Peer-addressed Discord DM thread in Chat (`discord:dm:<userId>`). */
const DISCORD_DM_PREFIX = 'discord:dm:';
const DEFAULT_MEMBER_LIMIT = 200;
const DEFAULT_MESSAGE_LIMIT = 50;

/** discord.js ChannelType values we surface for announce / chat ops. */
const CHANNEL_TYPE_NAMES = Object.freeze({
  0: 'text',
  2: 'voice',
  4: 'category',
  5: 'announcement',
  13: 'stage',
  15: 'forum',
  16: 'media'
});

/**
 * Whether the channel is a reasonable announce/post target (text or announcement).
 * @param {number|string} type
 * @returns {boolean}
 */
function channelCanAnnounce (type) {
  const t = Number(type);
  return t === 0 || t === 5;
}

/**
 * Text-bearing channels the Chat rail can open as a bridged Discord thread.
 * @param {number|string} type
 * @returns {boolean}
 */
function channelIsChatInsight (type) {
  const t = Number(type);
  return t === 0 || t === 5;
}

/**
 * @param {string} channelId
 * @returns {string}
 */
function discordChatChannelKey (channelId) {
  return DISCORD_CHAT_PREFIX + String(channelId || '').trim();
}

/**
 * Stable Chat key for a Discord user DM (not the ephemeral DM channel snowflake).
 * @param {string} userId
 * @returns {string}
 */
function discordDmChannelKey (userId) {
  return DISCORD_DM_PREFIX + String(userId || '').trim();
}

/**
 * @param {string} key
 * @returns {string|null} Discord user id
 */
function parseDiscordDmChannel (key) {
  const s = String(key || '');
  if (!s.startsWith(DISCORD_DM_PREFIX)) return null;
  const id = s.slice(DISCORD_DM_PREFIX.length).trim();
  // Real Discord snowflakes are long numerics; test stubs may use short ids.
  if (/^\d{5,32}$/.test(id)) return id;
  if (/^[a-zA-Z0-9_-]{2,64}$/.test(id) && id.indexOf(':') < 0) return id;
  return null;
}

/**
 * @param {string} key
 * @returns {string|null} Guild / announcement channel snowflake (not DM peers)
 */
function parseDiscordChatChannel (key) {
  const s = String(key || '');
  if (!s.startsWith(DISCORD_CHAT_PREFIX)) return null;
  if (s.startsWith(DISCORD_DM_PREFIX)) return null;
  const id = s.slice(DISCORD_CHAT_PREFIX.length).trim();
  if (!id || id.startsWith('dm:')) return null;
  return id;
}

/**
 * Whether a Chat channel key is any Discord-bridged thread (guild or DM).
 * @param {string} key
 * @returns {boolean}
 */
function isDiscordChatKey (key) {
  return !!(parseDiscordChatChannel(key) || parseDiscordDmChannel(key));
}

/**
 * discord.js Collection, manager `.cache`, array, or Map → array of values.
 * @param {*} maybe
 * @returns {Array}
 */
function collectionValues (maybe) {
  if (!maybe) return [];
  if (Array.isArray(maybe)) return maybe;
  if (maybe.cache) return collectionValues(maybe.cache);
  if (typeof maybe.values === 'function') return Array.from(maybe.values());
  if (typeof maybe.map === 'function' && typeof maybe.length === 'number') {
    return Array.from(maybe);
  }
  return [];
}

/**
 * @param {object} channel discord.js GuildChannel-like
 * @returns {object|null}
 */
function serializeChannel (channel) {
  if (!channel || channel.id == null) return null;
  const type = channel.type != null ? Number(channel.type) : -1;
  const row = {
    id: String(channel.id),
    name: String(channel.name || channel.id),
    type,
    typeName: CHANNEL_TYPE_NAMES[type] || `type:${type}`,
    parentId: channel.parentId != null ? String(channel.parentId) : null,
    position: Number.isFinite(Number(channel.position)) ? Number(channel.position) : 0,
    canAnnounce: channelCanAnnounce(type),
    chatInsight: channelIsChatInsight(type)
  };
  const bot = botPermissionsFromChannel(channel);
  if (bot) row.bot = bot;
  return row;
}

/**
 * @param {object} member discord.js GuildMember-like or User-like
 * @returns {object|null}
 */
function serializeMember (member) {
  if (!member) return null;
  const user = member.user && typeof member.user === 'object' ? member.user : member;
  const id = member.id != null ? member.id : user.id;
  if (id == null) return null;
  const username = String(user.username || user.globalName || member.displayName || id);
  const displayName = String(
    member.displayName || user.globalName || user.displayName || username
  );
  let status = null;
  if (member.presence && member.presence.status) {
    status = String(member.presence.status);
  } else if (user.presence && user.presence.status) {
    status = String(user.presence.status);
  }
  const avatar = user.avatar != null
    ? String(user.avatar)
    : (member.avatar != null ? String(member.avatar) : null);
  return {
    id: String(id),
    username,
    displayName,
    bot: user.bot === true || member.bot === true,
    status,
    avatar
  };
}

/**
 * @param {object} message discord.js Message-like
 * @returns {object|null}
 */
function serializeMessage (message) {
  if (!message || message.id == null) return null;
  const author = message.author && typeof message.author === 'object' ? message.author : {};
  const authorId = author.id != null ? String(author.id) : null;
  const channelId = message.channelId != null
    ? String(message.channelId)
    : (message.channel && message.channel.id != null ? String(message.channel.id) : null);
  let ts = null;
  if (message.createdAt) {
    ts = new Date(message.createdAt).toISOString();
  } else if (Number.isFinite(Number(message.createdTimestamp))) {
    ts = new Date(Number(message.createdTimestamp)).toISOString();
  }
  const handle = String(
    author.globalName || author.username || author.tag || authorId || 'unknown'
  );
  return {
    id: 'discord-msg:' + String(message.id),
    discordMessageId: String(message.id),
    channel: channelId ? discordChatChannelKey(channelId) : null,
    channelId,
    author: authorId ? DISCORD_CHAT_PREFIX + authorId : null,
    authorId,
    handle,
    bot: author.bot === true,
    body: String(message.content != null ? message.content : ''),
    ts,
    kind: 'discord'
  };
}

/**
 * @param {*} collection discord.js Collection, array, or cache
 * @returns {Array<object>}
 */
function serializeMessages (collection) {
  const rows = collectionValues(collection).map(serializeMessage).filter(Boolean);
  rows.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  return rows;
}

/**
 * @param {Array<object>} members
 * @param {number} [limit]
 * @returns {Array<object>}
 */
function capMembers (members, limit) {
  const max = Number.isFinite(Number(limit))
    ? Math.max(1, Math.min(1000, Number(limit)))
    : DEFAULT_MEMBER_LIMIT;
  const list = (Array.isArray(members) ? members : []).slice();
  list.sort((a, b) => {
    const an = String((a && (a.displayName || a.username)) || '').toLowerCase();
    const bn = String((b && (b.displayName || b.username)) || '').toLowerCase();
    return an.localeCompare(bn);
  });
  return list.slice(0, max);
}

/**
 * Unique users across guild member lists (stable id order after name sort).
 * @param {Array<object>} guilds
 * @returns {Array<object>}
 */
function uniqueUsersFromGuilds (guilds) {
  const byId = new Map();
  for (const g of guilds || []) {
    for (const m of g.members || []) {
      if (!m || m.id == null || byId.has(m.id)) continue;
      byId.set(m.id, m);
    }
  }
  return capMembers(Array.from(byId.values()), 1000);
}

/**
 * @param {object} guild discord.js Guild-like
 * @param {Object} [opts]
 * @param {number} [opts.memberLimit]
 * @returns {object|null}
 */
function serializeGuild (guild, opts = {}) {
  if (!guild || guild.id == null) return null;
  const channels = collectionValues(guild.channels)
    .map(serializeChannel)
    .filter(Boolean);
  channels.sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return String(a.name).localeCompare(String(b.name));
  });
  const members = capMembers(
    collectionValues(guild.members).map(serializeMember).filter(Boolean),
    opts.memberLimit
  );
  return {
    id: String(guild.id),
    name: String(guild.name || guild.id),
    icon: guild.icon != null ? String(guild.icon) : null,
    memberCount: Number.isFinite(Number(guild.memberCount))
      ? Number(guild.memberCount)
      : members.length,
    channels,
    members
  };
}

/**
 * Pull guild / channel / member lists from Discord into the client cache.
 * Prefers bounded `members.list({ limit })` so large guilds do not chunk the
 * entire member list over the gateway.
 *
 * @param {object|null} client
 * @param {Object} [opts]
 * @param {number} [opts.memberLimit]
 * @returns {Promise<object>}
 */
async function refreshDiscordCaches (client, opts = {}) {
  const memberLimit = Number.isFinite(Number(opts.memberLimit))
    ? Math.max(1, Math.min(1000, Number(opts.memberLimit)))
    : DEFAULT_MEMBER_LIMIT;
  const errors = [];
  let guildsFetched = 0;
  let channelsFetched = 0;
  let membersFetched = 0;

  if (!client) {
    return {
      ok: false,
      error: 'no_client',
      guildsFetched,
      channelsFetched,
      membersFetched,
      memberLimit,
      errors
    };
  }

  try {
    if (client.guilds && typeof client.guilds.fetch === 'function') {
      await client.guilds.fetch();
    }
  } catch (e) {
    errors.push({
      scope: 'guilds',
      message: e && e.message ? e.message : String(e)
    });
  }

  const guilds = collectionValues(client.guilds);
  guildsFetched = guilds.length;

  for (const guild of guilds) {
    const guildId = guild && guild.id != null ? String(guild.id) : null;
    try {
      if (guild.channels && typeof guild.channels.fetch === 'function') {
        await guild.channels.fetch();
      }
      channelsFetched += collectionValues(guild.channels).length;
    } catch (e) {
      errors.push({
        scope: 'channels',
        guildId,
        message: e && e.message ? e.message : String(e)
      });
    }
    try {
      const mgr = guild.members;
      if (mgr && typeof mgr.list === 'function') {
        await mgr.list({ limit: memberLimit });
      } else if (mgr && typeof mgr.fetch === 'function') {
        await mgr.fetch();
      }
      membersFetched += collectionValues(guild.members).length;
    } catch (e) {
      errors.push({
        scope: 'members',
        guildId,
        message: e && e.message ? e.message : String(e)
      });
    }
  }

  return {
    ok: errors.length === 0,
    error: errors.length ? (errors[0].message || 'sync_partial') : null,
    guildsFetched,
    channelsFetched,
    membersFetched,
    memberLimit,
    errors
  };
}

/**
 * Build a UI catalog from a discord.js Client (or stub with guilds.cache).
 *
 * @param {object|null} client
 * @param {Object} [opts]
 * @param {string|null} [opts.selectedChannelId]
 * @param {boolean} [opts.botReady]
 * @param {string|null} [opts.botUser]
 * @param {object|null} [opts.sync]
 * @param {number} [opts.memberLimit]
 * @returns {object}
 */
function buildDiscordGuildCatalog (client, opts = {}) {
  const selectedChannelId = opts.selectedChannelId != null
    ? String(opts.selectedChannelId).trim() || null
    : null;
  const botReady = opts.botReady === true;
  const botUser = opts.botUser != null ? String(opts.botUser) : null;
  const botUserId = opts.botUserId != null
    ? String(opts.botUserId).trim() || null
    : ((client && client.user && client.user.id != null)
      ? String(client.user.id)
      : null);
  const sync = opts.sync && typeof opts.sync === 'object' ? opts.sync : null;
  const appId = opts.appId != null && String(opts.appId).trim()
    ? String(opts.appId).trim()
    : null;

  if (!client || !client.guilds) {
    return {
      botReady,
      botUser,
      botUserId,
      appId,
      selectedChannelId,
      guilds: [],
      users: [],
      sync,
      error: botReady ? 'discord_client_unavailable' : 'bot_not_ready'
    };
  }

  const guilds = collectionValues(client.guilds)
    .map((g) => serializeGuild(g, { memberLimit: opts.memberLimit }))
    .filter(Boolean)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  return {
    botReady,
    botUser,
    botUserId,
    appId,
    selectedChannelId,
    guilds,
    users: uniqueUsersFromGuilds(guilds),
    sync,
    error: null
  };
}

/**
 * Chat left-rail rows for Discord text / announcement channels.
 * @param {object|null} catalog
 * @returns {Array<object>}
 */
function chatChannelsFromCatalog (catalog) {
  const rows = [];
  if (!catalog || !Array.isArray(catalog.guilds)) return rows;
  for (const g of catalog.guilds) {
    for (const ch of g.channels || []) {
      if (!ch || !ch.chatInsight) continue;
      rows.push({
        key: discordChatChannelKey(ch.id),
        label: '#' + ch.name,
        kind: 'discord',
        guildId: g.id,
        guildName: g.name,
        channelId: ch.id,
        typeName: ch.typeName,
        canAnnounce: !!ch.canAnnounce,
        bot: ch.bot || null
      });
    }
  }
  return rows;
}

/**
 * Sticky Chat rail entry for DMing the local Discord bot (loopback-capable).
 * @param {object|null} catalog
 * @returns {object|null}
 */
function botDmChannelFromCatalog (catalog) {
  if (!catalog || catalog.botReady !== true) return null;
  const botUserId = catalog.botUserId != null ? String(catalog.botUserId).trim() : '';
  if (!botUserId || !parseDiscordDmChannel(discordDmChannelKey(botUserId))) return null;
  const label = catalog.botUser
    ? ('DM ' + String(catalog.botUser).replace(/#\d+$/, ''))
    : 'DM Bot';
  return {
    key: discordDmChannelKey(botUserId),
    label,
    kind: 'discord-dm',
    discordUserId: botUserId,
    bot: true,
    botUser: catalog.botUser || null
  };
}

/**
 * Filter catalog guilds / channels / member previews by a free-text query.
 * Guild-name or guild-id match keeps all channels (and members) for that guild.
 *
 * @param {Array<object>} [guilds]
 * @param {string} [query]
 * @returns {Array<object>}
 */
function filterCatalogGuilds (guilds, query) {
  const list = Array.isArray(guilds) ? guilds : [];
  const q = String(query || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) {
    return list.map((g) => Object.assign({}, g, {
      channels: Array.isArray(g.channels) ? g.channels.slice() : [],
      members: Array.isArray(g.members) ? g.members.slice() : []
    }));
  }

  const out = [];
  for (const g of list) {
    if (!g) continue;
    const guildHit = String(g.name || '').toLowerCase().includes(q) ||
      String(g.id || '').toLowerCase().includes(q);
    const channels = (g.channels || []).filter((ch) => {
      if (guildHit) return true;
      if (!ch) return false;
      return [
        ch.name,
        ch.id,
        ch.typeName,
        channelIconLabel(ch)
      ].some((v) => String(v || '').toLowerCase().includes(q));
    });
    const members = (g.members || []).filter((m) => {
      if (guildHit) return true;
      if (!m) return false;
      return [
        m.displayName,
        m.username,
        m.id
      ].some((v) => String(v || '').toLowerCase().includes(q));
    });
    if (channels.length || members.length || guildHit) {
      out.push(Object.assign({}, g, {
        channels: guildHit ? (g.channels || []).slice() : channels,
        members: guildHit ? (g.members || []).slice() : members
      }));
    }
  }
  return out;
}

/** @private */
function channelIconLabel (ch) {
  if (!ch) return '';
  if (ch.type === 2 || ch.type === 13) return 'voice';
  if (ch.type === 4) return 'category';
  if (ch.type === 5) return 'announcement';
  if (ch.canAnnounce) return 'text';
  return '';
}

/**
 * Map discord.js / Discord REST errors into a Chat-facing message.
 * Code 50013 is the usual "Missing Permissions" when posting.
 * @param {*} err
 * @param {Object} [opts]
 * @param {string} [opts.appId]
 * @param {string} [opts.guildId]
 * @param {boolean} [opts.skipAuthorize]
 * @returns {{ status: number, error: string, authorizeUrl?: string }}
 */
function formatDiscordBridgeError (err, opts = {}) {
  const msg = String((err && err.message) || err || 'Discord request failed');
  const code = Number(
    (err && err.code) ||
    (err && err.rawError && err.rawError.code) ||
    (err && err.data && err.data.code) ||
    NaN
  );
  const authorizeUrl = opts.skipAuthorize === true
    ? null
    : discordBotAuthorizeUrl(opts);
  if (code === 50013 || /missing permissions/i.test(msg)) {
    const out = {
      status: 403,
      error: 'Discord: Missing Permissions — give the bot View Channel + Send Messages ' +
        '(and Read Message History) on that channel, then try again.'
    };
    if (authorizeUrl) out.authorizeUrl = authorizeUrl;
    return out;
  }
  if (code === 50001 || /missing access/i.test(msg)) {
    const out = {
      status: 403,
      error: 'Discord: Missing Access — the bot cannot see that channel. ' +
        'Check channel private permissions / role hierarchy.'
    };
    if (authorizeUrl) out.authorizeUrl = authorizeUrl;
    return out;
  }
  if (code === 10003 || /unknown channel/i.test(msg)) {
    return { status: 404, error: 'Discord: unknown channel (refresh the Chat Discord list).' };
  }
  return { status: 502, error: msg };
}

module.exports = {
  DISCORD_CHAT_PREFIX,
  DISCORD_DM_PREFIX,
  DEFAULT_MEMBER_LIMIT,
  DEFAULT_MESSAGE_LIMIT,
  CHANNEL_TYPE_NAMES,
  channelCanAnnounce,
  channelIsChatInsight,
  discordChatChannelKey,
  discordDmChannelKey,
  parseDiscordDmChannel,
  parseDiscordChatChannel,
  isDiscordChatKey,
  collectionValues,
  serializeChannel,
  serializeMember,
  serializeMessage,
  serializeMessages,
  serializeGuild,
  refreshDiscordCaches,
  buildDiscordGuildCatalog,
  uniqueUsersFromGuilds,
  chatChannelsFromCatalog,
  botDmChannelFromCatalog,
  filterCatalogGuilds,
  formatDiscordBridgeError
};
