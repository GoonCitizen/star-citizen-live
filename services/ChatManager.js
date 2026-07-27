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
 *
 * Ids are content-derived (channel + author + body + ts), so merging the
 * same message from multiple paths (local post, peer push, peer pull) is
 * idempotent — the same convergence rule as the event uplink.
 */

const crypto = require('crypto');
const EventEmitter = require('events');

const GLOBAL_CHANNEL = 'global';
const GROUP_PREFIX = 'group:';
const MAX_BODY = 2000;
const TYPE = 'ChatMessage';
const WIRE_TYPE = 'P2P_CHAT_MESSAGE';

function sha256 (s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

function canonical (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

class ChatManager extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {import('../types/Store').Store} opts.store Shared Fabric Store.
   * @param {import('./GroupManager')} [opts.groupManager] For channel membership.
   */
  constructor ({ store, groupManager = null } = {}) {
    super();
    this.store = store;
    this.groupManager = groupManager;
  }

  static get GLOBAL_CHANNEL () { return GLOBAL_CHANNEL; }
  static get GROUP_PREFIX () { return GROUP_PREFIX; }
  static get TYPE () { return TYPE; }
  static get WIRE_TYPE () { return WIRE_TYPE; }

  /** `group:<id>` → groupId, or null for non-group channels. */
  static groupIdOf (channel) {
    return String(channel || '').startsWith(GROUP_PREFIX) ? String(channel).slice(GROUP_PREFIX.length) : null;
  }

  _validChannel (channel) {
    if (channel === GLOBAL_CHANNEL) return true;
    const groupId = ChatManager.groupIdOf(channel);
    return !!(groupId && this.groupManager && this.groupManager.getGroup(groupId));
  }

  /**
   * May `viewer` read/post this channel? Global: anyone. Group channels:
   * members only when enforcing (hosted mode); locally the relay is the
   * player's own node, so their groups are already the visible set.
   */
  canAccess (channel, viewer, { enforceMembership = false } = {}) {
    if (channel === GLOBAL_CHANNEL) return true;
    const groupId = ChatManager.groupIdOf(channel);
    if (!groupId || !this.groupManager || !this.groupManager.getGroup(groupId)) return false;
    if (!enforceMembership) return true;
    return !!(viewer && this.groupManager.isMember(groupId, viewer));
  }

  /**
   * Channels visible to a viewer: global plus a `group:<id>` channel per
   * group (the viewer's groups when enforcing membership, else all).
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
    for (const ch of channels) {
      const msgs = all.filter((m) => m.channel === ch.key);
      ch.count = msgs.length;
      ch.lastTs = msgs.reduce((max, m) => (m.ts > max ? m.ts : max), '') || null;
    }
    return channels;
  }

  /**
   * Post a message. The id is content-derived so the same message merged
   * from any path converges. Returns the stored record.
   * @param {Object} data { channel, body, author, handle?, ts? }
   */
  post (data = {}) {
    const channel = String(data.channel || GLOBAL_CHANNEL);
    if (!this._validChannel(channel)) throw new Error(`unknown channel: ${channel}`);
    const body = String(data.body || '').trim().slice(0, MAX_BODY);
    if (!body) throw new Error('message body required');
    if (!data.author) throw new Error('author (pubkey) required');
    const ts = data.ts || new Date().toISOString();

    // Global mesh chat is UTF-8 text only on the wire (no ts) — id from author+body
    // so multi-path ingest converges. Group / local channels keep ts in the id.
    const idBasis = channel === GLOBAL_CHANNEL
      ? { channel, author: data.author, body }
      : { channel, author: data.author, body, ts };
    const record = {
      '@type': TYPE,
      id: sha256(canonical(idBasis)).slice(0, 32),
      channel,
      author: String(data.author),
      handle: data.handle ? String(data.handle).slice(0, 64) : null,
      body,
      ts
    };
    if (data.source) record.source = data.source;

    const existing = this.store.get('chatmessages', record.id);
    if (existing) return existing; // idempotent merge
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
    // Fabric wire authors are often x-only; identities use compressed pubkeys.
    const { pubkeysMatch } = require('../functions/identity');
    if (!pubkeysMatch(data.author, source)) {
      throw Object.assign(new Error('chat author must match the batch signer'), { code: 'FORBIDDEN' });
    }
    const before = this.store.get('chatmessages', ChatManager.idOf(data));
    const record = this.post({
      channel: data.channel,
      body: data.body,
      author: data.author,
      handle: data.handle,
      ts: data.ts,
      source
    });
    return { id: record.id, created: !before };
  }

  /** Deterministic id for a message payload (mirror of post()). */
  static idOf (data) {
    const body = String(data.body || '').trim().slice(0, MAX_BODY);
    const channel = String(data.channel || GLOBAL_CHANNEL);
    const basis = channel === GLOBAL_CHANNEL
      ? { channel, author: data.author, body }
      : { channel, author: data.author, body, ts: data.ts };
    return sha256(canonical(basis)).slice(0, 32);
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
