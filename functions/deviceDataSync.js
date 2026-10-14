'use strict';

/**
 * Cluster-gated account replay after D-013 device-link.
 *
 * Pairing rendezvous stays HTTPS (`/device-links`). After `IdentityCrossSign`,
 * each device publishes a compact `DeviceDataShare` CONTRACT_MESSAGE (not
 * frozen into genesis `messageTypes`) so the sibling can rebuild groups,
 * notes, local tags, profile, a bounded chat slice, `account.stats`
 * (counts only: notes, Game.log folds, missions, …), `account.peers`
 * (LAN RFC1918 + advertise host + Hub WebRTC origins), and opted-in
 * `account.files` metadata (no bytes). File bytes travel as `P2P_FILE_SEND`.
 * Receivers apply the share only when the signer is in the same identity
 * cluster. No seeds, xprvs, tokens, or passwords ride this envelope. Wire
 * frames are also stored as a FabricMessageCollection
 * (`functions/clusterSync.js`).
 */

const identityNotes = require('./identityNotes');
const localGroups = require('./localGroups');
const peerProfile = require('./peerProfile');
const clusterInventory = require('./clusterInventory');

const SHARE_TYPE = 'DeviceDataShare';
const PACK_PROFILE = 'account.profile';
const PACK_GROUPS = 'account.groups';
const PACK_NOTES = 'account.notes';
const PACK_LOCAL_TAGS = 'account.local-tags';
const PACK_CHAT = 'account.chat';
const PACK_STATS = 'account.stats';
const PACK_PEERS = 'account.peers';
const PACK_FILES = 'account.files';

const KNOWN_PACKS = Object.freeze([
  PACK_PROFILE,
  PACK_GROUPS,
  PACK_NOTES,
  PACK_LOCAL_TAGS,
  PACK_CHAT,
  PACK_STATS,
  PACK_PEERS,
  PACK_FILES
]);

const MAX_GROUPS = 48;
const MAX_NOTES = 200;
const MAX_TAGS = 48;
const MAX_CHAT = 80;
const MAX_FILES = 48;
/** Truncate on the wire so several ChatMessage rows fit one AMP frame. */
const CHAT_BODY_MAX = 480;
/**
 * JSON size of a DeviceDataShare object. CONTRACT_MESSAGE envelope + 208-byte
 * AMP header must stay under 4096 (`MAX_MESSAGE_SIZE` is 3888).
 */
const AMP_OBJECT_BUDGET = 2400;
const AMP_FRAME_MAX = 4096;

const SECRET_KEY = /^(mnemonic|xprv|xpub|seed|password|passwd|token|secret|adminToken|webhook|cookie|privateKey)$/i;

function isoNow (value) {
  if (value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function isPubkey (value) {
  const s = String(value || '').trim();
  return /^(?:0[23][0-9a-fA-F]{64}|[0-9a-fA-F]{64})$/.test(s);
}

function stripSecrets (row) {
  if (!row || typeof row !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (SECRET_KEY.test(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = stripSecrets(v);
      if (nested) out[k] = nested;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function compactProfile (opts = {}) {
  const pubkey = String(opts.pubkey || '').trim();
  if (!isPubkey(pubkey)) return null;
  const nickname = peerProfile.sanitizeNickname
    ? peerProfile.sanitizeNickname(opts.nickname)
    : (opts.nickname ? String(opts.nickname).trim().slice(0, 32) : null);
  const profile = peerProfile.sanitizeProfile
    ? peerProfile.sanitizeProfile(opts.profile || { bio: opts.bio, scHandle: opts.scHandle })
    : null;
  if (!nickname && !profile) return null;
  return {
    pubkey,
    nickname: nickname || null,
    bio: (profile && profile.bio) || null,
    scHandle: (profile && profile.scHandle) || null
  };
}

function compactGroupRow (row) {
  if (!row || typeof row !== 'object') return null;
  const id = String(row.id || '').trim();
  const name = String(row.name || '').trim().slice(0, 80);
  if (!id || !name) return null;
  const members = Array.isArray(row.members)
    ? row.members.map((m) => String(m || '').trim()).filter(Boolean).slice(0, 64)
    : [];
  const out = {
    id,
    name,
    contractId: row.contractId ? String(row.contractId) : null,
    creator: row.creator ? String(row.creator) : null,
    members,
    visibility: row.visibility === 'public' ? 'public' : 'private',
    parentId: row.parentId ? String(row.parentId) : null,
    threshold: row.threshold != null ? Number(row.threshold) : null
  };
  const definition = row.definition || row._contractDefinition;
  if (definition && typeof definition === 'object') {
    out.definition = stripSecrets(definition);
  }
  return out;
}

function compactFileRow (row) {
  if (!row || typeof row !== 'object') return null;
  const id = String(row.id || row.sha256 || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) return null;
  const sha256 = String(row.sha256 || id).trim().toLowerCase();
  const out = {
    id,
    sha256: /^[0-9a-f]{64}$/.test(sha256) ? sha256 : id,
    name: String(row.name || 'upload').slice(0, 256),
    mime: String(row.mime || 'application/octet-stream').slice(0, 128)
  };
  if (row.size != null && Number.isFinite(Number(row.size))) {
    out.size = Math.max(0, Math.floor(Number(row.size)));
  }
  return out;
}

function compactChatRow (row) {
  if (!row || typeof row !== 'object') return null;
  const id = String(row.id || '').trim();
  const channel = String(row.channel || '').trim();
  const body = String(row.body || '').trim().slice(0, CHAT_BODY_MAX);
  const author = String(row.author || '').trim();
  if (!id || !channel || !body || !author) return null;
  const out = {
    id,
    channel,
    body,
    author,
    handle: row.handle ? String(row.handle).slice(0, 64) : null,
    ts: row.ts || row.createdAt || null
  };
  if (row.discordMessageId) out.discordMessageId = String(row.discordMessageId).slice(0, 32);
  if (row.kind) out.kind = String(row.kind).slice(0, 32);
  return out;
}

function utf8Bytes (value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.byteLength(s, 'utf8');
}

function shareFitsAmp (share) {
  return !!(share && utf8Bytes(share) <= AMP_OBJECT_BUDGET);
}

/**
 * Newest-first cap of compact chat rows for DeviceDataShare.
 * @param {Array<object>} [rows]
 * @returns {{ messages: object[], truncated: boolean }}
 */
function selectChatForShare (rows) {
  const compact = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const item = compactChatRow(row);
    if (item) compact.push(item);
  }
  compact.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  if (compact.length > MAX_CHAT) {
    return { messages: compact.slice(-MAX_CHAT), truncated: true };
  }
  return { messages: compact, truncated: false };
}

function _arrayKeyForPack (pack) {
  if (pack === PACK_CHAT) return 'messages';
  if (pack === PACK_NOTES) return 'notes';
  if (pack === PACK_GROUPS) return 'groups';
  if (pack === PACK_LOCAL_TAGS) return 'tags';
  if (pack === PACK_FILES) return 'files';
  return null;
}

function _shrinkChatItem (item) {
  if (!item || typeof item !== 'object') return null;
  const body = String(item.body || '').slice(0, 160);
  if (!body) return null;
  return Object.assign({}, item, { body });
}

/**
 * Split one pack so each piece fits {@link AMP_OBJECT_BUDGET} by itself.
 * @param {object} pack
 * @param {string} fromPubkey
 * @param {string} generatedAt
 * @returns {object[]}
 */
function splitPack (pack, fromPubkey, generatedAt) {
  const key = _arrayKeyForPack(pack && pack.pack);
  const items = key && pack.payload && Array.isArray(pack.payload[key])
    ? pack.payload[key]
    : [];
  if (!key || !items.length) return [];
  const out = [];
  let batch = [];
  const flush = (truncated) => {
    if (!batch.length) return;
    out.push({
      pack: pack.pack,
      truncated: truncated === true || pack.truncated === true,
      payload: { [key]: batch }
    });
    batch = [];
  };
  for (const item of items) {
    const trial = batch.concat([item]);
    const trialPack = {
      pack: pack.pack,
      truncated: pack.truncated === true || items.length > trial.length,
      payload: { [key]: trial }
    };
    if (shareFitsAmp(buildShare({ fromPubkey, packs: [trialPack], generatedAt }))) {
      batch = trial;
      continue;
    }
    flush(true);
    const alone = {
      pack: pack.pack,
      truncated: true,
      payload: { [key]: [item] }
    };
    if (shareFitsAmp(buildShare({ fromPubkey, packs: [alone], generatedAt }))) {
      batch = [item];
      continue;
    }
    if (pack.pack === PACK_CHAT) {
      const tiny = _shrinkChatItem(item);
      if (tiny) {
        out.push({
          pack: PACK_CHAT,
          truncated: true,
          payload: { messages: [tiny] }
        });
      }
    }
  }
  flush(pack.truncated === true || items.length > batch.length);
  return out;
}

/**
 * Split a DeviceDataShare into AMP-safe frames (chat, notes, groups, …).
 * @param {object} opts
 * @param {string} opts.fromPubkey
 * @param {Array<object>} [opts.packs]
 * @param {string} [opts.generatedAt]
 * @returns {object[]}
 */
function chunkShares (opts = {}) {
  const fromPubkey = String(opts.fromPubkey || '').trim();
  if (!isPubkey(fromPubkey)) return [];
  const generatedAt = isoNow(opts.generatedAt);
  const sanitized = (opts.packs || []).map(sanitizePack).filter(Boolean);
  if (!sanitized.length) return [];

  const pieces = [];
  for (const pack of sanitized) {
    const alone = buildShare({ fromPubkey, packs: [pack], generatedAt });
    if (shareFitsAmp(alone)) {
      pieces.push(pack);
    } else {
      pieces.push.apply(pieces, splitPack(pack, fromPubkey, generatedAt));
    }
  }

  const shares = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    const share = buildShare({ fromPubkey, packs: current, generatedAt });
    if (share) shares.push(share);
    current = [];
  };
  for (const pack of pieces) {
    const trial = current.concat([pack]);
    if (shareFitsAmp(buildShare({ fromPubkey, packs: trial, generatedAt }))) {
      current = trial;
      continue;
    }
    flush();
    if (shareFitsAmp(buildShare({ fromPubkey, packs: [pack], generatedAt }))) {
      current = [pack];
    }
  }
  flush();
  return shares;
}

/**
 * @param {object} opts
 * @param {string} opts.fromPubkey
 * @param {Array<object>} [opts.packs]
 * @param {string} [opts.generatedAt]
 * @returns {object|null}
 */
function buildShare (opts = {}) {
  const fromPubkey = String(opts.fromPubkey || '').trim();
  if (!isPubkey(fromPubkey)) return null;
  const packs = (opts.packs || []).map(sanitizePack).filter(Boolean);
  if (!packs.length) return null;
  return {
    type: SHARE_TYPE,
    '@type': SHARE_TYPE,
    fromPubkey,
    generatedAt: isoNow(opts.generatedAt),
    truncated: packs.some((p) => p.truncated === true) || opts.truncated === true,
    packs
  };
}

function sanitizePack (entry) {
  if (!entry || typeof entry !== 'object') return null;
  const pack = String(entry.pack || '').trim();
  if (KNOWN_PACKS.indexOf(pack) < 0) return null;
  const payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : {};

  if (pack === PACK_PROFILE) {
    const compact = compactProfile(payload);
    if (!compact) return null;
    return { pack, truncated: false, payload: compact };
  }

  if (pack === PACK_GROUPS) {
    const raw = Array.isArray(payload.groups) ? payload.groups : [];
    const groups = [];
    for (const row of raw) {
      const compact = compactGroupRow(row);
      if (!compact) continue;
      if (groups.length < MAX_GROUPS) groups.push(compact);
    }
    if (!groups.length) return null;
    return {
      pack,
      truncated: raw.length > groups.length,
      payload: { groups }
    };
  }

  if (pack === PACK_NOTES) {
    const raw = Array.isArray(payload.notes) ? payload.notes : [];
    const notes = [];
    for (const row of raw) {
      const n = identityNotes.sanitizeNote(row);
      if (!n) continue;
      if (notes.length < MAX_NOTES) {
        notes.push({
          id: n.id,
          subject: n.subject,
          subjectHandle: n.subjectHandle,
          body: n.body,
          author: n.author,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
          revision: n.revision,
          visibility: n.visibility,
          shareGroupId: n.shareGroupId,
          profilePinned: n.profilePinned === true
        });
      }
    }
    if (!notes.length) return null;
    return {
      pack,
      truncated: raw.length > notes.length,
      payload: { notes }
    };
  }

  if (pack === PACK_LOCAL_TAGS) {
    const raw = Array.isArray(payload.tags) ? payload.tags : (payload.groups || []);
    const tags = [];
    for (const row of raw) {
      const g = localGroups.sanitizeGroup(row);
      if (!g) continue;
      if (tags.length < MAX_TAGS) tags.push(g);
    }
    if (!tags.length) return null;
    return {
      pack,
      truncated: raw.length > tags.length,
      payload: { tags }
    };
  }

  if (pack === PACK_CHAT) {
    const raw = Array.isArray(payload.messages) ? payload.messages : [];
    const messages = [];
    for (const row of raw) {
      const compact = compactChatRow(row);
      if (!compact) continue;
      if (messages.length < MAX_CHAT) messages.push(compact);
    }
    if (!messages.length) return null;
    return {
      pack,
      truncated: raw.length > messages.length,
      payload: { messages }
    };
  }

  if (pack === PACK_STATS) {
    const compact = clusterInventory.sanitizeStats(payload, { fill: true });
    return { pack, truncated: false, payload: compact };
  }

  if (pack === PACK_PEERS) {
    const clusterSync = require('./clusterSync');
    const compact = clusterSync.compactPeers(payload);
    if (!compact) return null;
    return {
      pack,
      truncated: Array.isArray(payload.candidates) &&
        payload.candidates.length > compact.candidates.length,
      payload: compact
    };
  }

  if (pack === PACK_FILES) {
    const raw = Array.isArray(payload.files) ? payload.files : [];
    const files = [];
    for (const row of raw) {
      const compact = compactFileRow(row);
      if (!compact) continue;
      if (files.length < MAX_FILES) files.push(compact);
    }
    if (!files.length) return null;
    return {
      pack,
      truncated: raw.length > files.length,
      payload: { files }
    };
  }

  return null;
}

/**
 * @param {object} object
 * @returns {object|null}
 */
function sanitizeShare (object) {
  const raw = object && object.object != null ? object.object : object;
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || raw['@type'] || '').trim();
  if (type && type !== SHARE_TYPE) return null;
  return buildShare({
    fromPubkey: raw.fromPubkey || raw.pubkey,
    packs: raw.packs,
    generatedAt: raw.generatedAt,
    truncated: raw.truncated
  });
}

module.exports = {
  SHARE_TYPE,
  PACK_PROFILE,
  PACK_GROUPS,
  PACK_NOTES,
  PACK_LOCAL_TAGS,
  PACK_CHAT,
  PACK_STATS,
  PACK_PEERS,
  PACK_FILES,
  KNOWN_PACKS,
  isPubkey,
  MAX_GROUPS,
  MAX_NOTES,
  MAX_TAGS,
  MAX_CHAT,
  MAX_FILES,
  CHAT_BODY_MAX,
  AMP_OBJECT_BUDGET,
  AMP_FRAME_MAX,
  compactProfile,
  compactGroupRow,
  compactChatRow,
  compactFileRow,
  selectChatForShare,
  utf8Bytes,
  shareFitsAmp,
  chunkShares,
  buildShare,
  sanitizePack,
  sanitizeShare
};
