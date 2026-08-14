'use strict';

/**
 * Cross-network actor ids for profiles and search.
 *
 * Fabric compressed / x-only pubkeys stay unprefixed (existing `/profiles/:pk`
 * URLs). Bridged chat networks use `platform:nativeId` (`discord:<snowflake>`,
 * later `slack:…`, etc.). Linked Discord ↔ Fabric identities roll up onto one
 * actor page. Does not invent genesis message types.
 */

const chatPlatform = require('./chatPlatform');
const {
  parseDiscordActor,
  discordActorKey,
  linkForDiscordUser,
  linkForPubkey
} = require('./discordIdentityLink');

const FABRIC_PUBKEY_RE = /^(?:0[23][0-9a-fA-F]{64}|[0-9a-fA-F]{64})$/;
const PLATFORM_ACTOR_RE = /^([a-z][a-z0-9-]{0,31}):(.+)$/;

/**
 * @param {*} value
 * @returns {boolean}
 */
function isFabricPubkey (value) {
  return FABRIC_PUBKEY_RE.test(String(value || '').trim());
}

/**
 * @param {*} value
 * @returns {{ platform: string, nativeId: string, key: string }|null}
 */
function parseActor (value) {
  const s = String(value || '').trim();
  if (!s) return null;
  if (isFabricPubkey(s)) {
    return { platform: 'fabric', nativeId: s, key: s };
  }
  if (s.indexOf('discord:dm:') === 0) return null;
  const discordId = parseDiscordActor(s);
  if (discordId) {
    return {
      platform: chatPlatform.PLATFORM_DISCORD,
      nativeId: discordId,
      key: discordActorKey(discordId)
    };
  }
  const m = s.match(PLATFORM_ACTOR_RE);
  if (!m) return null;
  const platform = chatPlatform.normalizePlatform(m[1], null);
  if (!platform || platform === 'fabric') return null;
  const nativeId = String(m[2] || '').trim();
  if (!nativeId) return null;
  if (platform === chatPlatform.PLATFORM_DISCORD && nativeId.indexOf('dm:') === 0) {
    return null;
  }
  return { platform, nativeId, key: platform + ':' + nativeId };
}

/**
 * @param {*} id
 * @returns {string|null}
 */
function profileHref (id) {
  const actor = parseActor(id);
  if (!actor) return null;
  return '/profiles/' + encodeURIComponent(actor.key);
}

/**
 * @param {object} [catalog]
 * @param {*} discordUserId
 * @returns {{ userId: string, username: string|null, displayName: string|null, bot: boolean, guilds: object[] }}
 */
function discordUserFromCatalog (catalog, discordUserId) {
  const id = String(discordUserId || parseDiscordActor(discordUserId) || '').trim();
  const guilds = [];
  let user = null;
  if (id) {
    for (const guild of (catalog && catalog.guilds) || []) {
      if (!guild) continue;
      const member = (guild.members || []).find((row) => row && String(row.id) === id);
      if (!member) continue;
      if (!user) user = member;
      guilds.push({ id: guild.id, name: guild.name || String(guild.id) });
    }
  }
  return {
    userId: id,
    username: (user && (user.username || user.displayName)) || null,
    displayName: (user && (user.displayName || user.username)) || null,
    bot: !!(user && user.bot),
    guilds
  };
}

function pushPlatform (list, row) {
  if (!row || !row.key) return;
  if (list.some((p) => p.key === row.key && p.platform === row.platform)) return;
  list.push({
    platform: row.platform,
    nativeId: row.nativeId,
    key: row.key,
    href: '/profiles/' + encodeURIComponent(row.key),
    handle: row.handle || null
  });
}

/**
 * @param {*} id
 * @param {Object} [opts]
 * @param {Array<object>} [opts.links]
 * @param {{ canonical?: string, members?: string[] }|null} [opts.cluster]
 * @param {object} [opts.catalog]
 * @returns {object|null}
 */
function rollupActor (id, opts = {}) {
  const requested = parseActor(id);
  if (!requested) return null;
  const links = Array.isArray(opts.links) ? opts.links : [];
  const cluster = opts.cluster && typeof opts.cluster === 'object' ? opts.cluster : null;
  const catalog = opts.catalog || null;
  const platforms = [];

  let fabricKey = requested.platform === 'fabric' ? requested.key : null;
  let discordId = requested.platform === 'discord' ? requested.nativeId : null;
  let discordHandle = null;

  if (requested.platform === 'discord') {
    const link = linkForDiscordUser(links, requested.nativeId);
    if (link && link.pubkey) fabricKey = String(link.pubkey);
    if (link && link.username) discordHandle = String(link.username);
  } else if (requested.platform === 'fabric') {
    const link = linkForPubkey(links, requested.key);
    if (link && link.discordUserId) {
      discordId = String(link.discordUserId);
      discordHandle = link.username ? String(link.username) : null;
    }
  } else {
    pushPlatform(platforms, requested);
  }

  if (fabricKey) {
    pushPlatform(platforms, {
      platform: 'fabric',
      nativeId: fabricKey,
      key: fabricKey
    });
  }
  if (discordId) {
    pushPlatform(platforms, {
      platform: 'discord',
      nativeId: discordId,
      key: discordActorKey(discordId),
      handle: discordHandle
    });
  }
  if (!platforms.length) pushPlatform(platforms, requested);

  const fabricPlat = platforms.find((p) => p.platform === 'fabric');
  const canonical = (fabricPlat && fabricPlat.key) || requested.key;
  const discordPlat = platforms.find((p) => p.platform === 'discord');
  const discord = discordPlat
    ? discordUserFromCatalog(catalog, discordPlat.nativeId)
    : null;
  if (discord && discordHandle && !discord.username) discord.username = discordHandle;

  return {
    requested,
    canonical,
    href: '/profiles/' + encodeURIComponent(canonical),
    platforms,
    cluster: cluster && Array.isArray(cluster.members) && cluster.members.length > 1
      ? {
        canonical: cluster.canonical || null,
        members: cluster.members.slice()
      }
      : null,
    discord
  };
}

module.exports = {
  FABRIC_PUBKEY_RE,
  isFabricPubkey,
  parseActor,
  profileHref,
  discordUserFromCatalog,
  rollupActor
};
