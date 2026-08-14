'use strict';

/**
 * Per-channel Discord access for Chat / Bot settings.
 *
 * Distinguishes **you** (operator cannot post: listen-only or locked identity)
 * from **bot** (the local Discord application cannot view or send).
 * Live bits come from discord.js `channel.permissionsFor(me)`; catalog rows
 * may carry a compact `{ view, send, readHistory, attach }` snapshot.
 */

const VIEW_NAMES = ['ViewChannel', 'VIEW_CHANNEL'];
const SEND_NAMES = ['SendMessages', 'SEND_MESSAGES'];
const HISTORY_NAMES = ['ReadMessageHistory', 'READ_MESSAGE_HISTORY'];
const ATTACH_NAMES = ['AttachFiles', 'ATTACH_FILES'];

/** Discord permission bit positions (API). */
const BIT_VIEW = 10;
const BIT_SEND = 11;
const BIT_ATTACH = 15;
const BIT_HISTORY = 16;

/**
 * @param {*} value
 * @returns {boolean|null}
 */
function flag (value) {
  if (value === true || value === false) return value;
  return null;
}

/**
 * @param {*} bits discord.js PermissionsBitField, bigint, number, or flag map
 * @param {string[]} names
 * @param {number} shift
 * @returns {boolean|null}
 */
function bitsHas (bits, names, shift) {
  if (bits == null) return null;
  if (typeof bits.has === 'function') {
    for (const name of names) {
      try {
        if (bits.has(name) === true) return true;
      } catch (_) { /* ignore */ }
    }
    try {
      if (bits.has(names) === true) return true;
    } catch (_) { /* ignore */ }
    return false;
  }
  if (typeof bits === 'bigint') {
    return (bits & (1n << BigInt(shift))) !== 0n;
  }
  if (typeof bits === 'number' && Number.isFinite(bits)) {
    return (bits & (1 << shift)) !== 0;
  }
  if (typeof bits === 'object') {
    for (const name of names) {
      if (bits[name] === true) return true;
      if (bits[name] === false) return false;
    }
  }
  return null;
}

/**
 * Compact bot permission snapshot, or null when unknown.
 * @param {*} raw
 * @returns {{ view?: boolean, send?: boolean, readHistory?: boolean, attach?: boolean }|null}
 */
function normalizeBotPermissions (raw) {
  if (!raw || typeof raw !== 'object') return null;
  const view = flag(raw.view);
  const send = flag(raw.send);
  const readHistory = flag(raw.readHistory);
  const attach = flag(raw.attach);
  if (view == null && send == null && readHistory == null && attach == null) return null;
  const out = {};
  if (view != null) out.view = view;
  if (send != null) out.send = send;
  if (readHistory != null) out.readHistory = readHistory;
  if (attach != null) out.attach = attach;
  return out;
}

/**
 * @param {*} bits
 * @returns {object|null}
 */
function botPermissionsFromBits (bits) {
  if (bits == null) return null;
  const view = bitsHas(bits, VIEW_NAMES, BIT_VIEW);
  const send = bitsHas(bits, SEND_NAMES, BIT_SEND);
  const readHistory = bitsHas(bits, HISTORY_NAMES, BIT_HISTORY);
  const attach = bitsHas(bits, ATTACH_NAMES, BIT_ATTACH);
  if (view == null && send == null && readHistory == null && attach == null) return null;
  const out = {};
  if (view != null) out.view = view;
  if (send != null) out.send = send;
  if (readHistory != null) out.readHistory = readHistory;
  if (attach != null) out.attach = attach;
  return out;
}

/**
 * discord.js GuildMember / User used with `permissionsFor`.
 * @param {object} channel
 * @returns {*}
 */
function resolveBotMember (channel) {
  if (!channel || typeof channel !== 'object') return null;
  const guild = channel.guild;
  if (guild && guild.members && guild.members.me) return guild.members.me;
  if (guild && guild.me) return guild.me;
  const user = channel.client && channel.client.user;
  if (user && guild && guild.members && typeof guild.members.resolve === 'function') {
    return guild.members.resolve(user.id) || user;
  }
  return user || null;
}

/**
 * Snapshot bot view/send bits from a live discord.js channel, or pass through
 * an already-serialized `{ bot: { view, send, … } }`.
 * @param {object} channel
 * @returns {object|null}
 */
function botPermissionsFromChannel (channel) {
  if (!channel || typeof channel !== 'object') return null;
  const passed = normalizeBotPermissions(channel.bot || channel.permissions);
  if (typeof channel.permissionsFor !== 'function') return passed;
  const me = resolveBotMember(channel);
  if (!me) return passed;
  let bits = null;
  try {
    bits = channel.permissionsFor(me);
  } catch (_) {
    return passed;
  }
  return botPermissionsFromBits(bits) || passed;
}

/**
 * Compact badges for the Chat rail / Bot settings.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.botReady]
 * @param {object|null} [opts.bot]
 * @param {boolean} [opts.listenOnly]
 * @param {boolean} [opts.identityUnlocked]
 * @param {boolean} [opts.discordSurface]
 * @param {boolean} [opts.discordOnly]
 * @param {boolean} [opts.isDm]
 * @returns {Array<{ id: string, tone: string, label: string, title: string }>}
 */
function discordChannelIndicators (opts = {}) {
  if (opts.discordSurface !== true) return [];
  const out = [];
  const listenOnly = opts.listenOnly === true;
  const botReady = opts.botReady === true;
  const bot = normalizeBotPermissions(opts.bot);
  const identityUnlocked = opts.identityUnlocked !== false;
  const isDm = opts.isDm === true;

  if (listenOnly) {
    out.push({
      id: 'you',
      tone: 'block',
      label: 'you',
      title: 'You cannot post to Discord (listen-only)'
    });
  } else if (opts.discordOnly === true && identityUnlocked === false) {
    out.push({
      id: 'you',
      tone: 'block',
      label: 'you',
      title: 'Unlock identity to chat on Discord'
    });
  }

  if (!isDm) {
    if (!botReady) {
      out.push({
        id: 'bot',
        tone: 'warn',
        label: 'bot',
        title: 'Discord bot is not ready — it cannot chat here'
      });
    } else if (bot) {
      if (bot.view === false) {
        out.push({
          id: 'bot',
          tone: 'block',
          label: 'bot',
          title: 'Bot cannot see this channel'
        });
      } else if (bot.send === false) {
        out.push({
          id: 'bot',
          tone: 'block',
          label: 'bot',
          title: 'Bot cannot send messages here'
        });
      } else if (bot.readHistory === false) {
        out.push({
          id: 'history',
          tone: 'warn',
          label: 'history',
          title: 'Bot cannot read message history'
        });
      }
    }
  }

  return out;
}

/**
 * Whether Chat → Discord outbound is possible (not listen-only, bot can send).
 * DMs skip guild permission bits.
 * @param {Object} [opts]
 * @returns {boolean}
 */
function canBotPostToDiscord (opts = {}) {
  if (opts.isDm === true) return opts.botReady === true;
  if (opts.botReady !== true) return false;
  const bot = normalizeBotPermissions(opts.bot);
  if (bot && bot.view === false) return false;
  if (bot && bot.send === false) return false;
  return true;
}

/**
 * Whether this operator can post Chat → Discord on a guild channel.
 * @param {Object} [opts]
 * @returns {boolean}
 */
function canOperatorPostToDiscord (opts = {}) {
  if (opts.listenOnly === true) return false;
  if (opts.identityUnlocked === false && opts.discordOnly === true) return false;
  return canBotPostToDiscord(opts);
}

module.exports = {
  normalizeBotPermissions,
  botPermissionsFromBits,
  botPermissionsFromChannel,
  discordChannelIndicators,
  canBotPostToDiscord,
  canOperatorPostToDiscord
};
