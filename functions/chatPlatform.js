'use strict';

/**
 * Bridged chat platforms for Federation data sync and Chat channel keys.
 *
 * Discord is the first platform (`discord:` / `discord:dm:`). Later platforms
 * register a prefix here; GroupDataShare chat packs carry `platform` so the
 * same catalog/messages envelope works for other bots and apps.
 */

const PLATFORM_DISCORD = 'discord';

const PLATFORMS = Object.freeze({
  discord: Object.freeze({
    id: PLATFORM_DISCORD,
    channelPrefix: 'discord:',
    dmPrefix: 'discord:dm:'
  })
});

const PLATFORM_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

function normalizePlatform (value, fallback) {
  const id = String(value || '').trim().toLowerCase();
  if (!id) return fallback != null ? fallback : PLATFORM_DISCORD;
  if (PLATFORMS[id]) return id;
  if (PLATFORM_ID_RE.test(id)) return id;
  return null;
}

function isRegisteredPlatform (value) {
  return !!PLATFORMS[String(value || '').trim().toLowerCase()];
}

/**
 * ChatManager channel key for a guild/server text channel.
 * @param {string} platform
 * @param {string} channelId
 * @returns {string|null}
 */
function channelKey (platform, channelId) {
  const id = String(channelId || '').trim();
  if (!id) return null;
  const p = PLATFORMS[normalizePlatform(platform) || ''] || PLATFORMS.discord;
  return p.channelPrefix + id;
}

/**
 * ChatManager channel key for a platform DM.
 * @param {string} platform
 * @param {string} userId
 * @returns {string|null}
 */
function dmChannelKey (platform, userId) {
  const id = String(userId || '').trim();
  if (!id) return null;
  const p = PLATFORMS[normalizePlatform(platform) || ''] || PLATFORMS.discord;
  return p.dmPrefix + id;
}

/**
 * @param {string} key
 * @returns {{ platform: string, kind: 'channel'|'dm', id: string }|null}
 */
function parseChannelKey (key) {
  const s = String(key || '');
  if (!s) return null;
  for (const p of Object.values(PLATFORMS)) {
    if (s.startsWith(p.dmPrefix)) {
      const id = s.slice(p.dmPrefix.length).trim();
      return id ? { platform: p.id, kind: 'dm', id } : null;
    }
    if (s.startsWith(p.channelPrefix)) {
      const id = s.slice(p.channelPrefix.length).trim();
      if (!id || id.indexOf('dm:') === 0) continue;
      return { platform: p.id, kind: 'channel', id };
    }
  }
  return null;
}

module.exports = {
  PLATFORM_DISCORD,
  PLATFORMS,
  normalizePlatform,
  isRegisteredPlatform,
  channelKey,
  dmChannelKey,
  parseChannelKey
};
