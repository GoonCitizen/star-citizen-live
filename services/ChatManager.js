'use strict';

/**
 * ChatManager — org chat brought forward from the Hub, on the Fabric Store.
 *
 * Message types follow hub.fabric.pub conventions:
 *   - stored records are `@type: 'ChatMessage'`
 *   - `global` rides Fabric `P2P_CHAT_MESSAGE` (D-010)
 *   - `group:<groupId>` rides `GroupChat` under that Group's Federation
 *     `CONTRACT_MESSAGE` namespace (Groups-as-Federations)
 *
 * Channels:
 *   - `global`            — network chat on this node (all local viewers)
 *   - `group:<groupId>`   — dedicated channel per group / subgroup, members
 *                           only in hosted mode (the local relay shows your groups)
 *   - `discord:<id>`      — bridged Discord guild thread (local bot; not Fabric mesh)
 *   - `discord:dm:<uid>`  — Discord user DM (bot↔user; local bot loopback allowed)
 *
 * Ids are content-derived (channel + author + body + ts), so merging the
 * same message from multiple paths (local post, peer push, peer pull) is
 * idempotent — the same convergence rule as the event uplink.
 */

const crypto = require('crypto');
const EventEmitter = require('events');
const { OUTER } = require('../contracts/applicationMessageTypes');
const { pubkeysMatch, canonicalChatAuthor } = require('../functions/identity');
const {
  parseDiscordChatChannel,
  parseDiscordDmChannel,
  isDiscordChatKey
} = require('../functions/discordGuildCatalog');
const { canonicalChatActor } = require('../functions/discordIdentityLink');
const {
  encodeWireBody,
  decodeWireBody,
  normalizeAttachment,
  isWireEncoded
} = require('../functions/chatAttachment');

const GLOBAL_CHANNEL = 'global';
const GROUP_PREFIX = 'group:';
const DM_PREFIX = 'dm:';
/** GoonCitizen CONTRACT_MESSAGE body type for 1:1 chat (mesh). */
const DIRECT_CHAT_TYPE = 'DirectChat';
const MAX_BODY = 2000;
const TYPE = 'ChatMessage';
const WIRE_TYPE = OUTER.P2P_CHAT_MESSAGE;
const PUBKEY_RE = /^(?:0[23][0-9a-fA-F]{64}|[0-9a-fA-F]{64})$/;

function sha256 (s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

/** Deterministic DM channel key for two Fabric pubkeys. */
function dmChannelKey (a, b) {
  let xa;
  let xb;
  try {
    xa = canonicalChatAuthor(a);
    xb = canonicalChatAuthor(b);
  } catch (_) {
    return null;
  }
  if (xa === xb) return null;
  const [lo, hi] = [xa, xb].sort((p, q) => p.localeCompare(q));
  return `${DM_PREFIX}${lo}:${hi}`;
}

/** Parse `dm:<pkA>:<pkB>` → `{ a, b }` or null. */
function parseDmChannel (channel) {
  const s = String(channel || '');
  if (!s.startsWith(DM_PREFIX)) return null;
  const rest = s.slice(DM_PREFIX.length);
  const i = rest.indexOf(':');
  if (i <= 0) return null;
  const a = rest.slice(0, i);
  const b = rest.slice(i + 1);
  if (!PUBKEY_RE.test(a) || !PUBKEY_RE.test(b)) return null;
  return { a, b };
}

function canonical (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

class ChatManager extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {Object} opts.store Shared Fabric Store.
   * @param {Object} [opts.groupManager] For channel membership.
   */
  constructor ({ store, groupManager = null, sameActor = null } = {}) {
    super();
    this.store = store;
    this.groupManager = groupManager;
    this.sameActor = typeof sameActor === 'function' ? sameActor : pubkeysMatch;
  }

  static get GLOBAL_CHANNEL () { return GLOBAL_CHANNEL; }
  static get GROUP_PREFIX () { return GROUP_PREFIX; }
  static get DM_PREFIX () { return DM_PREFIX; }
  static get DIRECT_CHAT_TYPE () { return DIRECT_CHAT_TYPE; }
  static get TYPE () { return TYPE; }
  static get WIRE_TYPE () { return WIRE_TYPE; }
  static dmChannelKey (a, b) { return dmChannelKey(a, b); }
  static parseDmChannel (channel) { return parseDmChannel(channel); }

  /** `group:<id>` → groupId, or null for non-group channels. */
  static groupIdOf (channel) {
    return String(channel || '').startsWith(GROUP_PREFIX) ? String(channel).slice(GROUP_PREFIX.length) : null;
  }

  _validChannel (channel) {
    if (channel === GLOBAL_CHANNEL) return true;
    if (parseDmChannel(channel)) return true;
    if (isDiscordChatKey(channel)) return true;
    const groupId = ChatManager.groupIdOf(channel);
    return !!(groupId && this.groupManager && this.groupManager.getGroup(groupId));
  }

  /**
   * May `viewer` read/post this channel? Global: anyone. Group channels:
   * members only when enforcing (hosted mode); locally the relay is the
   * player's own node, so their groups are already the visible set.
   * DM channels: only the two participant pubkeys.
   * Discord `discord:<channelId>` / `discord:dm:<userId>` threads: local node
   * always; hosted requires an authenticated viewer.
   */
  canAccess (channel, viewer, { enforceMembership = false } = {}) {
    if (channel === GLOBAL_CHANNEL) return true;
    if (isDiscordChatKey(channel)) {
      return enforceMembership ? !!viewer : true;
    }
    const dm = parseDmChannel(channel);
    if (dm) {
      if (!viewer) return !enforceMembership;
      return this.sameActor(viewer, dm.a) || this.sameActor(viewer, dm.b);
    }
    const groupId = ChatManager.groupIdOf(channel);
    if (!groupId || !this.groupManager || !this.groupManager.getGroup(groupId)) return false;
    if (!enforceMembership) return true;
    return !!(viewer && this.groupManager.isMember(groupId, viewer));
  }

  /**
   * Other participant in a DM channel for `viewer`, or null.
   */
  dmPeerOf (channel, viewer) {
    const dm = parseDmChannel(channel);
    if (!dm || !viewer) return null;
    if (this.sameActor(viewer, dm.a)) return dm.b;
    if (this.sameActor(viewer, dm.b)) return dm.a;
    return null;
  }

  /**
   * Channels visible to a viewer: global, group channels, plus DM threads
   * that already have messages involving the viewer.
   */
  channelsFor (viewer, { enforceMembership = false } = {}) {
    const channels = [{ key: GLOBAL_CHANNEL, label: 'Global', kind: 'global' }];
    if (this.groupManager) {
      const groups = enforceMembership
        ? (viewer ? this.groupManager.groupsFor(viewer) : [])
        : this.groupManager.groups;
      for (const g of groups) {
        channels.push({ key: GROUP_PREFIX + g.id, label: g.name, kind: 'group', groupId: g.id });
      }
    }
    const all = this.store.all('chatmessages');
    const dmKeys = new Set();
    for (const m of all) {
      if (!m || !m.channel || !String(m.channel).startsWith(DM_PREFIX)) continue;
      if (!this.canAccess(m.channel, viewer, { enforceMembership: true })) continue;
      dmKeys.add(m.channel);
    }
    for (const key of dmKeys) {
      const peer = this.dmPeerOf(key, viewer);
      channels.push({
        key,
        label: peer ? ('DM ' + peer.slice(0, 8) + '…') : 'Direct message',
        kind: 'dm',
        peerPubkey: peer
      });
    }
    const discordDmKeys = new Set();
    for (const m of all) {
      if (!m || !m.channel || !parseDiscordDmChannel(m.channel)) continue;
      if (!this.canAccess(m.channel, viewer, { enforceMembership })) continue;
      discordDmKeys.add(m.channel);
    }
    for (const key of discordDmKeys) {
      const peerId = parseDiscordDmChannel(key);
      channels.push({
        key,
        label: peerId ? ('DM ' + peerId) : 'Discord DM',
        kind: 'discord-dm',
        discordUserId: peerId
      });
    }
    for (const ch of channels) {
      const msgs = all.filter((m) => m.channel === ch.key);
      ch.count = msgs.length;
      ch.lastTs = msgs.reduce((max, m) => (m.ts > max ? m.ts : max), '') || null;
    }
    return channels;
  }

  /**
   * Ensure a DM channel descriptor exists in the channel list (even with 0 msgs).
   * @returns {{ key, label, kind, peerPubkey }}
   */
  openDm (viewer, peerPubkey) {
    const key = dmChannelKey(viewer, peerPubkey);
    if (!key) throw new Error('invalid DM participants');
    if (!viewer || !peerPubkey) throw new Error('both participants required');
    return {
      key,
      label: 'DM ' + String(peerPubkey).slice(0, 8) + '…',
      kind: 'dm',
      peerPubkey: String(peerPubkey)
    };
  }

  /**
   * Post a message. The id is content-derived so the same message merged
   * from any path converges. Returns the stored record.
   * Optional `attachment` (DocumentPublish) is encoded into the wire body for
   * global UTF-8 chat and stored as a structured field for UI / group payloads.
   * @param {Object} data Message fields (`channel`, `body`, `author`, optional `handle` / `ts` / `attachment`).
   */
  post (data = {}) {
    const channel = String(data.channel || GLOBAL_CHANNEL);
    if (!this._validChannel(channel)) throw new Error(`unknown channel: ${channel}`);
    let attachment = normalizeAttachment(data.attachment);
    let body = String(data.body || '').trim();
    if (attachment && !isWireEncoded(body)) {
      body = encodeWireBody({ caption: body, attachment });
    } else if (!attachment && isWireEncoded(body)) {
      attachment = decodeWireBody(body).attachment;
    }
    body = body.slice(0, MAX_BODY);
    if (!body) throw new Error('message body required');
    if (!data.author) throw new Error('author (pubkey) required');
    const author = canonicalChatActor(data.author);
    const dm = parseDmChannel(channel);
    if (dm && !this.canAccess(channel, author, { enforceMembership: true })) {
      throw new Error('author is not a participant in this DM');
    }
    const ts = data.ts || new Date().toISOString();
    const discordMessageId = data.discordMessageId ? String(data.discordMessageId) : '';

    // Global mesh chat is UTF-8 text only on the wire (no ts) — id from author+body
    // so multi-path ingest converges. Discord rows key on the Discord message id.
    // Group / local channels keep ts in the id.
    const idBasis = discordMessageId
      ? { channel, discordMessageId }
      : (channel === GLOBAL_CHANNEL
        ? { channel, author, body }
        : { channel, author, body, ts });
    const record = {
      '@type': TYPE,
      id: sha256(canonical(idBasis)).slice(0, 32),
      channel,
      author,
      handle: data.handle ? String(data.handle).slice(0, 64) : null,
      body,
      ts
    };
    if (attachment) record.attachment = attachment;
    if (data.source) record.source = data.source;
    if (data.kind) record.kind = String(data.kind).slice(0, 32);
    if (discordMessageId) record.discordMessageId = discordMessageId;
    if (data.discordUserId) record.discordUserId = String(data.discordUserId);

    const existing = this.store.get('chatmessages', record.id);
    if (existing) {
      // Prefer filling attachment on an earlier text-only merge of the same id.
      let changed = false;
      if (attachment && !existing.attachment) {
        existing.attachment = attachment;
        changed = true;
      }
      if (discordMessageId && !existing.discordMessageId) {
        existing.discordMessageId = discordMessageId;
        changed = true;
      }
      if (changed) this.store.put('chatmessages', existing.id, existing);
      return existing;
    }
    this.store.put('chatmessages', record.id, record);
    this.emit('message', record);
    return record;
  }

  /**
   * Ingest a ChatMessage pushed by a remote relay (signed batch). The signer
   * must be the author — nobody relays words into someone else's mouth.
   * @returns {{ id, created }}
   */
  ingest (source, data = {}) {
    if (!data || !data.body || !data.author || !data.ts) {
      throw Object.assign(new Error('chat event requires author, body and ts'), { code: 'BAD_EVENT' });
    }
    if (parseDiscordChatChannel(data.channel)) {
      throw Object.assign(new Error('discord channels are not mesh-ingested'), { code: 'FORBIDDEN' });
    }
    // Fabric wire authors are often x-only; identities use compressed pubkeys.
    if (!pubkeysMatch(data.author, source)) {
      throw Object.assign(new Error('chat author must match the batch signer'), { code: 'FORBIDDEN' });
    }
    const author = canonicalChatAuthor(source);
    const before = this.store.get('chatmessages', ChatManager.idOf({
      channel: data.channel,
      body: data.body,
      author,
      ts: data.ts
    }));
    const record = this.post({
      channel: data.channel,
      body: data.body,
      author,
      handle: data.handle,
      ts: data.ts,
      attachment: data.attachment || null,
      source
    });
    return { id: record.id, created: !before };
  }

  /** Deterministic id for a message payload (mirror of post()). */
  static idOf (data) {
    const body = String(data.body || '').trim().slice(0, MAX_BODY);
    const channel = String(data.channel || GLOBAL_CHANNEL);
    const author = canonicalChatActor(data.author);
    const discordMessageId = data.discordMessageId ? String(data.discordMessageId) : '';
    const basis = discordMessageId
      ? { channel, discordMessageId }
      : (channel === GLOBAL_CHANNEL
        ? { channel, author, body }
        : { channel, author, body, ts: data.ts });
    return sha256(canonical(basis)).slice(0, 32);
  }

  /**
   * Stored ChatMessage by id, or null.
   * @param {string} id
   * @returns {object|null}
   */
  get (id) {
    if (!id) return null;
    return this.store.get('chatmessages', String(id)) || null;
  }

  /**
   * Toggle this node's pin flag on a stored message.
   * @param {string} id
   * @param {Object} [opts]
   * @param {boolean} [opts.pinned]
   * @param {string} [opts.actor]
   * @returns {object}
   */
  setPinned (id, { pinned = true, actor = null } = {}) {
    const rec = this.get(id);
    if (!rec) {
      const e = new Error('message not found');
      e.code = 'NOT_FOUND';
      throw e;
    }
    const next = pinned !== false && pinned !== 0 && String(pinned) !== 'false';
    rec.pinned = next;
    rec.pinnedAt = next ? new Date().toISOString() : null;
    rec.pinnedBy = next && actor ? String(actor) : null;
    this.store.put('chatmessages', rec.id, rec);
    this.emit('message', rec);
    return rec;
  }

  /**
   * Messages in a channel, ascending by ts.
   * @param {String} channel Channel key.
   * @param {Object} [opts] { since (ISO ts, exclusive), limit }
   */
  list (channel, { since = null, limit = 200 } = {}) {
    let msgs = this.store.all('chatmessages').filter((m) => m.channel === channel);
    if (since) msgs = msgs.filter((m) => m.ts > since);
    msgs.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : 1));
    return msgs.slice(-Math.max(1, Math.min(limit, 1000)));
  }
}

module.exports = ChatManager;
module.exports.canonicalChatAuthor = canonicalChatAuthor;
module.exports.canonicalChatActor = canonicalChatActor;
