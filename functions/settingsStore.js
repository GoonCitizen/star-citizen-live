'use strict';

// Operator settings on the Fabric Store — the desktop/relay counterpart of the
// Hub's settings under `stores/hub`. Settings are records in the `settings`
// collection of the shared register Store (`types/Store.js` → `@fabric/core`
// LevelDB at `stores/gooncitizen/register`). The application never writes a
// settings JSON file; a legacy `settings.json` is imported once by the Store
// on start and then retired (renamed `.migrated`).
//
// Only allowlisted keys are persisted, so the collection stays a small,
// auditable operator config (never secrets like the identity key).

const { sanitizeCorpusDirs, sanitizeCorpusFiles } = require('./fsBrowser');
const { sanitizeProfile } = require('./peerProfile');
const { sanitizePresenceShare } = require('./presence');
const { sanitizeLinks } = require('./discordIdentityLink');
const { normalizeDirections } = require('./discordChatDirection');
const { sanitizeVoiceSettings } = require('./groupVoiceSettings');

// Operator-editable keys (mirrors the Hub's allowlisted-settings approach).
const ALLOWED_KEYS = [
  'logfile',    // explicit Game.log path (null = auto-detect)
  'channel',    // forced SC channel (LIVE/PTU/EPTU/HOTFIX/TECH-PREVIEW)
  'corpusDirs', // extra directories of *.log to fold into cumulative history (Feed import)
  'corpusFiles', // individually selected log files (Feed import)
  'peers',      // [{ id, address, label, enabled }] — Fabric host:port peers
  'fabricPort', // local Fabric Peer listen port (default 7777)
  'fabricAdvertiseHost', // public host for dial pin + P2P_PEERING_OFFER; null = no dial endpoint
  'broadcastPeering',    // opt-in: publish P2P_PEERING_OFFER on the mesh (default false)
  'uplinkIntervalMs',
  'openAtLogin',
  'identityAutoLockMinutes', // 0 = off; default 30 (mirrors Hub identity lock prefs)
  'shareLogsGlobal',         // broadcast parsed log events to all connected peers (default false; prefer per-peer shareLogs)
  'groupChatSeal',           // seal outbound GroupChat with tip-bound AES-GCM (default false)
  'requireSealedGroupChat',  // drop inbound GroupChat without a decryptable seal (default false)
  'httpSharedMode',          // LAN opt-in: bind dashboard HTTP on 0.0.0.0 (default false → 127.0.0.1)
  'snapshotsEnabled',        // periodic screen snapshots (opt-in; desktop only)
  'snapshotIntervalSeconds', // capture cadence (default 10, min 2)
  'snapshotAutoPurge',       // delete oldest snapshots beyond the disk cap (default true)
  'snapshotMaxMB',           // disk cap for the snapshot library (default 256 MB)
  'notifyDesktop',           // master toggle for desktop/OS notifications (default true)
  'notifyChatGlobal',        // notify on new global chat messages (default true)
  'notifyChatGroups',        // notify on new group chat messages (default true)
  'notifyWhenFocused',       // also notify while the app window is focused (default false)
  'nickname',                // operator display name for chat (pubkey remains the actor id)
  'profile',                 // local social profile { bio, scHandle } (nickname is separate)
  'notifyMissionBroadcasts', // desktop notify when a peer broadcasts a mission (default true)
  'linkedDevices',           // mutual device-link attestations [{ peerFabricId, label, … }]
  'pendingDeviceLinkOffer',  // in-flight initiator QR (sessionId, hub, nonce — no secrets)
  'sharePresence',           // publish PeerPresence on Fabric (default false)
  'shareDiscordCatalog',     // gossip chat catalog/message packs (Discord first) to Federation groups (default false)
  'sharePlaytimes',          // gossip profile.playtimes pack to Federation groups (default false)
  'shareFiles',              // legacy bulk pin/unpin; gossip uses per-file profilePinned
  'presenceVisibility',      // private|peers|groups|public
  'presenceGroupIds',        // group ids when visibility is groups/public
  'shipOverrideSlug',        // manual current ship slug; null = autodetect from log
  'locationOverrideSlug',    // manual location slug; null = autodetect from QT
  'destinationOverrideSlug', // manual QT destination slug; null = autodetect
  'presenceAvailability',    // auto|online|offline (force online/offline vs Game.log)
  'presenceStatusText',      // short custom status line (max 64)
  'primaryGroupId',          // preferred group for overlay / defaults (local HUD; membership soft-checked)
  'groupOverlay',            // desktop: show primary-group member/ship overlay (Windows)
  'fabricShareEncoding',     // opaque Share clipboard: 'base64' (default) or 'hex'
  // Discord bot (non-secrets). Token / app secret / webhook → discord.secrets.json or env.
  'discordBotEnable',
  'discordAppId',
  'discordChannel',
  'discordAnnounceKills',
  'discordAnnouncePlayerJoins',
  'discordAnnounceActivities',
  'discordAnnounceMissions',
  'discordAnnounceCombat',
  'discordAnnounceIncaps',
  'discordIdentityLinks',    // [{ discordUserId, pubkey, username, linkedAt, verified }]
  'discordChatDirections',  // { [channelId]: 'listen' | 'bidirectional' } — missing → bidirectional
  'voice'                   // { mode, pttKey, vadSensitivity, muted, deafened, devices }
];

const NICKNAME_MAX = 32;
const PRIMARY_GROUP_ID_RE = /^[a-zA-Z0-9_-]{8,128}$/;

/**
 * Normalize primary group id. Empty clears it.
 * @param {*} value
 * @returns {string|null}
 */
function sanitizePrimaryGroupId (value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  return PRIMARY_GROUP_ID_RE.test(s) ? s : null;
}

/**
 * Opaque Fabric share clipboard encoding. Unset → default base64 at runtime.
 * @param {*} value
 * @returns {'hex'|'base64'|null}
 */
function sanitizeFabricShareEncoding (value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim().toLowerCase();
  if (s === 'hex') return 'hex';
  if (s === 'base64' || s === 'b64') return 'base64';
  return null;
}

/**
 * Normalize a display nickname. Empty clears it. Strips control chars;
 * does not replace the cryptographic identity (pubkey stays authoritative).
 * @param {*} value
 * @returns {string|null}
 */
function sanitizeNickname (value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, NICKNAME_MAX);
  return s || null;
}

/**
 * Load persisted settings from the Fabric Store (unknown keys dropped).
 * Synchronous after `store.start()` — the Store keeps collections in memory.
 * @param {import('../types/Store').Store} store Shared register Store.
 * @returns {Object} Settings object ({} when store absent or empty).
 */
function loadSettings (store) {
  const out = {};
  if (!store) return out;
  for (const key of ALLOWED_KEYS) {
    const record = store.get('settings', key);
    if (record && record.value !== undefined && record.value !== null) out[key] = record.value;
  }
  return out;
}

/**
 * Remove legacy secrets that must not live in the Fabric Store (e.g. Discord
 * webhook URLs). Safe to call on every start; no-op when absent.
 * @param {import('../types/Store').Store} store
 */
function scrubLegacySecrets (store) {
  if (!store || typeof store.del !== 'function') return;
  try {
    if (store.get('settings', 'discordWebhook')) store.del('settings', 'discordWebhook');
  } catch (_) { /* best effort */ }
}

/**
 * Persist one setting into the Fabric Store. Returns the full updated
 * settings object. `null`/`undefined` clears the setting.
 * @param {import('../types/Store').Store} store Shared register Store.
 * @param {String} key Allowlisted setting name.
 * @param {*} value JSON-serializable value (undefined/null removes it).
 */
function putSetting (store, key, value) {
  if (!ALLOWED_KEYS.includes(key)) throw new Error(`unknown setting: ${key}`);
  if (!store) throw new Error('settings store required');
  let next = value === undefined ? null : value;
  if (key === 'nickname') next = sanitizeNickname(next);
  if (key === 'profile') next = sanitizeProfile(next);
  if (key === 'fabricAdvertiseHost') {
    if (next === undefined || next === null || next === '') next = null;
    else {
      const host = String(next).trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
      next = host && /^[a-z0-9._-]+$/i.test(host) && host !== 'localhost' && host !== '127.0.0.1'
        ? host
        : null;
    }
  }
  if (key === 'corpusDirs') {
    next = sanitizeCorpusDirs(next);
    if (!next.length) next = null;
  }
  if (key === 'corpusFiles') {
    next = sanitizeCorpusFiles(next);
    if (!next.length) next = null;
  }
  if (key === 'broadcastPeering') next = next === true;
  if (key === 'httpSharedMode') next = next === true;
  if (key === 'shareLogsGlobal') next = next === true;
  if (key === 'shareDiscordCatalog') next = next === true;
  if (key === 'sharePlaytimes') next = next === true;
  if (key === 'shareFiles') next = next === true;
  if (key === 'groupChatSeal') next = next === true;
  if (key === 'requireSealedGroupChat') next = next === true;
  if (key === 'sharePresence') next = next === true;
  if (key === 'presenceVisibility') next = sanitizePresenceShare({ presenceVisibility: next }).presenceVisibility;
  if (key === 'presenceGroupIds') {
    next = sanitizePresenceShare({ presenceGroupIds: next }).presenceGroupIds;
    if (!next.length) next = null;
  }
  if (key === 'shipOverrideSlug') {
    next = sanitizePresenceShare({ shipOverrideSlug: next }).shipOverrideSlug;
  }
  if (key === 'locationOverrideSlug') {
    next = sanitizePresenceShare({ locationOverrideSlug: next }).locationOverrideSlug;
  }
  if (key === 'destinationOverrideSlug') {
    next = sanitizePresenceShare({ destinationOverrideSlug: next }).destinationOverrideSlug;
  }
  if (key === 'presenceAvailability') {
    next = sanitizePresenceShare({ presenceAvailability: next }).presenceAvailability;
  }
  if (key === 'presenceStatusText') {
    next = sanitizePresenceShare({ presenceStatusText: next }).presenceStatusText;
  }
  if (key === 'primaryGroupId') next = sanitizePrimaryGroupId(next);
  if (key === 'groupOverlay') next = next === true;
  if (key === 'fabricShareEncoding') next = sanitizeFabricShareEncoding(next);
  if (key === 'discordBotEnable' ||
      key === 'discordAnnounceKills' ||
      key === 'discordAnnouncePlayerJoins' ||
      key === 'discordAnnounceActivities' ||
      key === 'discordAnnounceMissions' ||
      key === 'discordAnnounceCombat' ||
      key === 'discordAnnounceIncaps') {
    next = next === true;
  }
  if (key === 'discordAppId' || key === 'discordChannel') {
    if (next === undefined || next === null || next === '') next = null;
    else next = String(next).trim() || null;
  }
  if (key === 'discordIdentityLinks') {
    next = sanitizeLinks(next);
    if (!next.length) next = null;
  }
  if (key === 'discordChatDirections') {
    next = normalizeDirections(next);
  }
  if (key === 'voice') {
    next = sanitizeVoiceSettings(next);
  }
  if (key === 'pendingDeviceLinkOffer') {
    if (!next || typeof next !== 'object') next = null;
    else {
      const sessionId = String(next.sessionId || '').trim();
      const hubBase = String(next.hubBase || next.origin || '').trim().replace(/\/$/, '');
      if (!sessionId || !/^https?:\/\//i.test(hubBase)) next = null;
      else {
        next = {
          sessionId,
          hubBase,
          origin: String(next.origin || hubBase).replace(/\/$/, ''),
          nonce: String(next.nonce || '').trim() || null,
          label: String(next.label || '').slice(0, 64) || null,
          createdAt: Number(next.createdAt) || Date.now(),
          protocolUrl: String(next.protocolUrl || '').slice(0, 512) || null,
          httpsUrl: String(next.httpsUrl || '').slice(0, 512) || null,
          initiatorId: String(next.initiatorId || '').slice(0, 128) || null,
          status: 'pending'
        };
      }
    }
  }
  store.put('settings', key, { id: key, value: next });
  return loadSettings(store);
}

module.exports = {
  ALLOWED_KEYS,
  NICKNAME_MAX,
  PRIMARY_GROUP_ID_RE,
  sanitizeNickname,
  sanitizePrimaryGroupId,
  sanitizeFabricShareEncoding,
  sanitizeCorpusDirs,
  sanitizeCorpusFiles,
  loadSettings,
  scrubLegacySecrets,
  putSetting
};
