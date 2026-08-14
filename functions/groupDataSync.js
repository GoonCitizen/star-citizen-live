'use strict';

/**
 * Group-scoped data sync — compact "packs" on Federation contracts.
 *
 * Chat platforms (Discord first) and opt-in profile play times share the same
 * envelope so later bots, apps, and message types merge into one world view
 * without freezing new names into genesis `messageTypes`.
 *
 * Canonical packs:
 *   - `chat.catalog` / `chat.messages` with `platform` (discord, …)
 *   - `profile.playtimes` (opt-in common play times)
 *   - `profile.files` (opt-in published file listings — metadata only)
 *
 * Legacy `discord.catalog` / `discord.messages` / `DiscordCatalogShare` still
 * ingest as Discord chat packs.
 */

const discordCatalog = require('./discordCatalogAccumulate');
const chatPlatform = require('./chatPlatform');
const profilePlaytimes = require('./profilePlaytimes');
const profileFiles = require('./profileFiles');

const SHARE_TYPE = 'GroupDataShare';
const LEGACY_DISCORD_CATALOG = discordCatalog.SHARE_TYPE || 'DiscordCatalogShare';

const PACK_CHAT_CATALOG = 'chat.catalog';
const PACK_CHAT_MESSAGES = 'chat.messages';
const PACK_PROFILE_PLAYTIMES = profilePlaytimes.PACK || 'profile.playtimes';
const PACK_PROFILE_FILES = profileFiles.PACK || 'profile.files';

/** @deprecated use PACK_CHAT_CATALOG + platform discord */
const PACK_DISCORD_CATALOG = 'discord.catalog';
/** @deprecated use PACK_CHAT_MESSAGES + platform discord */
const PACK_DISCORD_MESSAGES = 'discord.messages';

const PACK_ALIASES = Object.freeze({
  [PACK_DISCORD_CATALOG]: PACK_CHAT_CATALOG,
  [PACK_DISCORD_MESSAGES]: PACK_CHAT_MESSAGES
});

const KNOWN_PACKS = Object.freeze([
  PACK_CHAT_CATALOG,
  PACK_CHAT_MESSAGES,
  PACK_PROFILE_PLAYTIMES,
  PACK_PROFILE_FILES,
  PACK_DISCORD_CATALOG,
  PACK_DISCORD_MESSAGES
]);

function isoNow (value) {
  if (value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function canonicalPack (pack) {
  const id = String(pack || '').trim();
  return PACK_ALIASES[id] || id;
}

function isKnownPack (pack) {
  const id = String(pack || '');
  return KNOWN_PACKS.indexOf(id) >= 0 || KNOWN_PACKS.indexOf(canonicalPack(id)) >= 0;
}

function packPlatform (entry, payload, fallback) {
  const raw = (entry && entry.platform) || (payload && payload.platform) || fallback;
  const legacy = canonicalPack(entry && entry.pack) === PACK_CHAT_CATALOG ||
    canonicalPack(entry && entry.pack) === PACK_CHAT_MESSAGES
    ? chatPlatform.PLATFORM_DISCORD
    : null;
  return chatPlatform.normalizePlatform(raw, legacy || fallback || chatPlatform.PLATFORM_DISCORD);
}

/**
 * Unknown packs are dropped (forward-compatible) rather than rejecting the
 * whole share — peers may publish packs this node does not implement yet.
 * @param {object} entry
 * @returns {object|null}
 */
function sanitizePack (entry) {
  if (!entry || typeof entry !== 'object') return null;
  const rawPack = String(entry.pack || '').trim();
  if (!isKnownPack(rawPack)) return null;
  const pack = canonicalPack(rawPack);
  const payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : {};

  if (pack === PACK_CHAT_CATALOG) {
    const platform = packPlatform(entry, payload, chatPlatform.PLATFORM_DISCORD);
    if (!platform) return null;
    const guilds = payload.guilds || payload.spaces || entry.guilds || entry.spaces || [];
    if (platform === chatPlatform.PLATFORM_DISCORD) {
      const packed = discordCatalog.compactGuildsForShare(guilds);
      if (!packed.guilds.length) return null;
      return {
        pack,
        platform,
        truncated: packed.truncated === true || entry.truncated === true,
        payload: { platform, guilds: packed.guilds }
      };
    }
    const list = Array.isArray(guilds) ? guilds.filter((g) => g && g.id != null).slice(0, 25) : [];
    if (!list.length) return null;
    return {
      pack,
      platform,
      truncated: guilds.length > list.length || entry.truncated === true,
      payload: { platform, guilds: list }
    };
  }

  if (pack === PACK_CHAT_MESSAGES) {
    const platform = packPlatform(entry, payload, chatPlatform.PLATFORM_DISCORD);
    if (!platform) return null;
    const channels = payload.channels || entry.channels || [];
    if (platform === chatPlatform.PLATFORM_DISCORD) {
      const packed = discordCatalog.compactMessageShare(channels);
      if (!packed.channels.length) return null;
      return {
        pack,
        platform,
        truncated: packed.truncated === true || entry.truncated === true,
        payload: { platform, channels: packed.channels }
      };
    }
    const list = Array.isArray(channels) ? channels.filter((ch) => ch && ch.channelId).slice(0, 12) : [];
    if (!list.length) return null;
    return {
      pack,
      platform,
      truncated: channels.length > list.length || entry.truncated === true,
      payload: { platform, channels: list }
    };
  }

  if (pack === PACK_PROFILE_PLAYTIMES) {
    const compact = profilePlaytimes.sanitizePlaytimesPayload(payload, {
      pubkey: payload.pubkey || entry.pubkey
    });
    if (!compact) return null;
    return {
      pack,
      truncated: false,
      payload: compact
    };
  }

  if (pack === PACK_PROFILE_FILES) {
    const compact = profileFiles.sanitizeFilesPayload(payload, {
      pubkey: payload.pubkey || entry.pubkey
    });
    if (!compact) return null;
    return {
      pack,
      truncated: compact.truncated === true || entry.truncated === true,
      payload: compact
    };
  }

  return null;
}

/**
 * @param {object} opts
 * @param {string} opts.groupId
 * @param {Array<object>} opts.packs
 * @param {string} [opts.sourceAppId]
 * @param {string} [opts.observedAt]
 * @returns {object|null}
 */
function buildShare (opts = {}) {
  const groupId = String(opts.groupId || '').trim();
  if (!groupId) return null;
  const packs = (opts.packs || []).map(sanitizePack).filter(Boolean);
  if (!packs.length) return null;
  return {
    type: SHARE_TYPE,
    '@type': SHARE_TYPE,
    groupId,
    sourceAppId: opts.sourceAppId != null && String(opts.sourceAppId).trim()
      ? String(opts.sourceAppId).trim()
      : null,
    observedAt: isoNow(opts.observedAt),
    truncated: packs.some((p) => p.truncated === true) || opts.truncated === true,
    packs
  };
}

/**
 * Accept GroupDataShare or legacy DiscordCatalogShare.
 * @param {object} object
 * @returns {object|null}
 */
function sanitizeShare (object) {
  const raw = object && object.object != null ? object.object : object;
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || raw['@type'] || '').trim();
  const groupId = String(raw.groupId || '').trim();
  if (!groupId) return null;

  if (type === LEGACY_DISCORD_CATALOG ||
      ((!type || type === SHARE_TYPE) && Array.isArray(raw.guilds) && !Array.isArray(raw.packs))) {
    return buildShare({
      groupId,
      sourceAppId: raw.sourceAppId,
      observedAt: raw.observedAt,
      truncated: raw.truncated,
      packs: [{
        pack: PACK_CHAT_CATALOG,
        platform: chatPlatform.PLATFORM_DISCORD,
        truncated: raw.truncated,
        payload: { platform: chatPlatform.PLATFORM_DISCORD, guilds: raw.guilds }
      }]
    });
  }

  if (type && type !== SHARE_TYPE) return null;
  return buildShare({
    groupId,
    sourceAppId: raw.sourceAppId,
    observedAt: raw.observedAt,
    truncated: raw.truncated,
    packs: raw.packs
  });
}

/**
 * Membership gate for ingesting a group data share.
 * @param {object} opts
 * @param {object} [opts.groupManager]
 * @param {object} [opts.group]
 * @param {string} [opts.viewer]
 * @param {string} [opts.signer]
 * @param {string} [opts.mode]
 * @returns {boolean}
 */
function allowIngest (opts = {}) {
  const gm = opts.groupManager;
  const group = opts.group;
  if (!group || !gm) return false;
  const mode = opts.mode;
  const viewer = opts.viewer ? String(opts.viewer) : '';
  const signer = opts.signer ? String(opts.signer) : '';
  if (viewer && !gm.isInGroupTree(group.id, viewer) && mode !== 'server') return false;
  if (signer && !gm.isInGroupTree(group.id, signer) && mode !== 'server') return false;
  return true;
}

function collectSources (guilds) {
  const sources = [];
  const seen = new Set();
  for (const g of guilds || []) {
    for (const s of g.sources || []) {
      const key = [s.via, s.pubkey || '', s.appId || '', s.groupId || ''].join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({
        via: s.via || null,
        pubkey: s.pubkey || null,
        appId: s.appId || null,
        groupId: s.groupId || null,
        observedAt: s.observedAt || null
      });
    }
  }
  return sources.slice(0, 24);
}

/**
 * Compact world-view summary for UI / GET …/world-view.
 * @param {object} opts
 * @param {object} [opts.catalog]
 * @param {Array<object>} [opts.messageStats]
 * @param {Array<object>} [opts.playtimes]
 * @param {Array<object>} [opts.files]
 * @param {string} [opts.sourceAppId]
 * @param {boolean} [opts.botReady]
 * @returns {object}
 */
function composeWorldView (opts = {}) {
  const catalog = opts.catalog && typeof opts.catalog === 'object' ? opts.catalog : {};
  const guilds = Array.isArray(catalog.guilds) ? catalog.guilds : [];
  const users = Array.isArray(catalog.users) ? catalog.users : [];
  const stats = Array.isArray(opts.messageStats) ? opts.messageStats : [];
  const playtimes = Array.isArray(opts.playtimes) ? opts.playtimes : [];
  const files = Array.isArray(opts.files) ? opts.files : [];
  const sources = collectSources(guilds);
  let latestAt = null;
  let messageCount = 0;
  for (const row of stats) {
    messageCount += Number(row.count) || 0;
    if (row.lastMessageAt && (!latestAt || String(row.lastMessageAt) > latestAt)) {
      latestAt = row.lastMessageAt;
    }
  }
  const hasChat = guilds.length > 0 || stats.length > 0;
  return {
    '@type': 'WorldView',
    observedAt: isoNow(opts.observedAt),
    sourceAppId: opts.sourceAppId != null ? String(opts.sourceAppId) : null,
    botReady: opts.botReady === true,
    offline: opts.botReady !== true && hasChat,
    packs: [
      {
        pack: PACK_CHAT_CATALOG,
        platform: chatPlatform.PLATFORM_DISCORD,
        guildCount: guilds.length,
        userCount: users.length,
        truncated: catalog.truncated === true || guilds.some((g) => g.truncated === true)
      },
      {
        pack: PACK_CHAT_MESSAGES,
        platform: chatPlatform.PLATFORM_DISCORD,
        channelCount: stats.length,
        messageCount,
        latestAt
      },
      {
        pack: PACK_PROFILE_PLAYTIMES,
        profileCount: playtimes.length
      },
      {
        pack: PACK_PROFILE_FILES,
        profileCount: files.length
      }
    ],
    sources
  };
}

module.exports = {
  SHARE_TYPE,
  LEGACY_DISCORD_CATALOG,
  PACK_CHAT_CATALOG,
  PACK_CHAT_MESSAGES,
  PACK_PROFILE_PLAYTIMES,
  PACK_PROFILE_FILES,
  PACK_DISCORD_CATALOG,
  PACK_DISCORD_MESSAGES,
  KNOWN_PACKS,
  canonicalPack,
  isKnownPack,
  sanitizePack,
  buildShare,
  sanitizeShare,
  allowIngest,
  composeWorldView
};
