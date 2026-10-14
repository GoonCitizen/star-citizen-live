'use strict';

/**
 * Discord OAuth2 bot-authorize URLs for missing guild/channel permissions.
 *
 * Channel overwrites still need a server admin; this link updates the bot
 * integration's granted permission integer (View / Send / History / Attach /
 * Embed Links) on that guild.
 */

const { normalizeBotPermissions } = require('./discordChannelAccess');

/** Discord permission bits the GoonCitizen bot needs for Chat + announce embeds. */
const PERMISSION_VIEW = 1 << 10;
const PERMISSION_SEND = 1 << 11;
const PERMISSION_EMBED_LINKS = 1 << 14;
const PERMISSION_ATTACH = 1 << 15;
const PERMISSION_HISTORY = 1 << 16;

const REQUIRED_BOT_PERMISSIONS = PERMISSION_VIEW | PERMISSION_SEND |
  PERMISSION_EMBED_LINKS | PERMISSION_ATTACH | PERMISSION_HISTORY;

const MISSING_LABELS = [
  { key: 'view', label: 'View Channel' },
  { key: 'send', label: 'Send Messages' },
  { key: 'readHistory', label: 'Read Message History' },
  { key: 'attach', label: 'Attach Files' }
];

/**
 * Discord application / guild snowflake (digits only).
 * @param {*} raw
 * @returns {string|null}
 */
function discordSnowflakeId (raw) {
  const id = String(raw == null ? '' : raw).trim();
  if (!/^\d{1,32}$/.test(id)) return null;
  return id;
}

/**
 * @param {string[]} names
 * @returns {string}
 */
function formatPermissionList (names) {
  const list = (Array.isArray(names) ? names : []).map((n) => String(n || '').trim()).filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return list[0] + ' and ' + list[1];
  return list.slice(0, -1).join(', ') + ', and ' + list[list.length - 1];
}

/**
 * Compact labels for bot bits that are explicitly false.
 * @param {*} bot
 * @returns {string[]}
 */
function missingRequiredBotPermissions (bot) {
  const bits = normalizeBotPermissions(bot);
  if (!bits) return [];
  const missing = [];
  for (const row of MISSING_LABELS) {
    if (bits[row.key] === false) missing.push(row.label);
  }
  return missing;
}

/**
 * https://discord.com/oauth2/authorize — bot scope, required permission integer.
 * Optional guild_id pre-selects the server (admin still confirms).
 *
 * @param {Object} [opts]
 * @param {string} [opts.appId]
 * @param {string} [opts.guildId]
 * @param {number} [opts.permissions]
 * @returns {string|null}
 */
function discordBotAuthorizeUrl (opts = {}) {
  const appId = discordSnowflakeId(opts.appId);
  if (!appId) return null;
  const permissions = Number.isFinite(Number(opts.permissions))
    ? Math.max(0, Math.floor(Number(opts.permissions)))
    : REQUIRED_BOT_PERMISSIONS;
  const params = new URLSearchParams({
    client_id: appId,
    permissions: String(permissions),
    scope: 'bot',
    integration_type: '0'
  });
  const guildId = discordSnowflakeId(opts.guildId);
  if (guildId) {
    params.set('guild_id', guildId);
    params.set('disable_guild_select', 'true');
  }
  return 'https://discord.com/oauth2/authorize?' + params.toString();
}

/**
 * @param {*} err
 * @returns {boolean}
 */
function looksLikeMissingPermissionError (err) {
  const msg = String((err && err.message) || err || '');
  const code = Number(
    (err && err.code) ||
    (err && err.status) ||
    NaN
  );
  if (code === 50013 || code === 50001) return true;
  return /missing permissions|missing access/i.test(msg);
}

/**
 * Operator-facing copy + authorize href when the bot lacks a required bit.
 *
 * @param {Object} [opts]
 * @param {object|null} [opts.bot]
 * @param {string} [opts.appId]
 * @param {string} [opts.guildId]
 * @param {string} [opts.authorizeUrl] already-built URL (API)
 * @returns {{ missing: string[], url: string|null, text: string, linkLabel: string }|null}
 */
function botPermissionNotice (opts = {}) {
  const missing = missingRequiredBotPermissions(opts.bot);
  if (!missing.length) return null;
  const url = (opts.authorizeUrl && String(opts.authorizeUrl).indexOf('https://discord.com/oauth2/authorize?') === 0)
    ? String(opts.authorizeUrl)
    : discordBotAuthorizeUrl(opts);
  const names = formatPermissionList(missing);
  let reason = 'The Discord bot is missing a required permission.';
  if (missing.indexOf('View Channel') >= 0) {
    reason = 'The Discord bot cannot see this channel.';
  } else if (missing.indexOf('Send Messages') >= 0) {
    reason = 'The Discord bot cannot send messages in this channel.';
  } else if (missing.indexOf('Read Message History') >= 0) {
    reason = 'The Discord bot cannot read message history.';
  } else if (missing.indexOf('Attach Files') >= 0) {
    reason = 'The Discord bot cannot attach files in this channel.';
  }
  const grant = url
    ? ('A server administrator can authorize ' + names + '.')
    : ('Ask a server administrator to grant ' + names +
      ', and set the Discord Application ID under Settings → Discord bot to get an authorize link.');
  return {
    missing,
    url,
    text: reason + ' ' + grant,
    linkLabel: missing.length === 1 ? 'Authorize permission' : 'Authorize permissions'
  };
}

/**
 * JSON body for a mapped Discord bridge error.
 * @param {{ error: string, authorizeUrl?: string|null }} mapped
 * @returns {{ error: string, authorizeUrl?: string }}
 */
function httpErrorBody (mapped) {
  const body = { error: mapped && mapped.error ? String(mapped.error) : 'Discord request failed' };
  if (mapped && mapped.authorizeUrl) body.authorizeUrl = mapped.authorizeUrl;
  return body;
}

module.exports = {
  PERMISSION_VIEW,
  PERMISSION_SEND,
  PERMISSION_EMBED_LINKS,
  PERMISSION_ATTACH,
  PERMISSION_HISTORY,
  REQUIRED_BOT_PERMISSIONS,
  discordSnowflakeId,
  formatPermissionList,
  missingRequiredBotPermissions,
  discordBotAuthorizeUrl,
  looksLikeMissingPermissionError,
  botPermissionNotice,
  httpErrorBody
};
