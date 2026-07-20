'use strict';

/**
 * FabricNetwork — local `@fabric/core` Peer for GoonCitizen peering.
 *
 * Replaces HTTPS batch uplink / chat pull with signed Fabric wire Messages:
 *   - P2P_CHAT_MESSAGE  (Peer auto-relays)
 *   - GenericMessage MissionBroadcast / SCEventBatch (app types; hub must relay)
 *
 * Lazy-requires Peer/Message so memory-only unit tests stay light.
 */

const EventEmitter = require('events');
const path = require('path');

const DEFAULT_SEED = 'relay.goon.vc:7777';
const APP_RELAY_TYPES = new Set(['MissionBroadcast', 'SCEventBatch']);

/**
 * True when `value` looks like a Fabric peer address (`host:port`).
 * @param {*} value
 * @returns {boolean}
 */
function isFabricAddress (value) {
  const s = String(value || '').trim();
  if (!s || /^https?:\/\//i.test(s)) return false;
  return /^[a-zA-Z0-9._-]+(?::\d{1,5})$/.test(s);
}

/**
 * Normalize operator input to `host:port`. Rejects bare http(s) URLs for new
 * peers; migrates legacy `https://host[/…]` → `host:7777` when `migrate` is set.
 * @param {*} value
 * @param {{ migrate?: boolean }} [opts]
 * @returns {string|null}
 */
function normalizeFabricAddress (value, { migrate = false } = {}) {
  const raw = String(value || '').trim().replace(/\/$/, '');
  if (!raw) return null;
  if (isFabricAddress(raw)) return raw;
  if (migrate && /^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (!u.hostname) return null;
      return `${u.hostname}:7777`;
    } catch (_) {
      return null;
    }
  }
  return null;
}

/**
 * Patch a Peer so MissionBroadcast / SCEventBatch emit app events (and
 * optionally fan-out via relayFrom — needed on the org hub).
 * @param {Object} peer Fabric Peer instance
 * @param {Object} handlers { onMissionBroadcast, onEventBatch, onChat? }
 * @param {{ relay?: boolean }} [opts]
 */
function attachAppHandlers (peer, handlers = {}, { relay = false } = {}) {
  if (!peer || typeof peer._handleGenericMessage !== 'function') {
    throw new Error('attachAppHandlers requires a Fabric Peer');
  }
  if (peer._goonAppHandlersAttached) return peer;
  peer._goonAppHandlersAttached = true;

  const original = peer._handleGenericMessage.bind(peer);
  peer._handleGenericMessage = function patchedGeneric (message, origin = null, socket = null, wireMessage = null) {
    const msg = message && typeof message === 'object' ? message : {};
    const type = msg.type || msg['@type'] || null;
    const signer = wireMessage && typeof peer._verifiedFabricSignerPubkeyHex === 'function'
      ? peer._verifiedFabricSignerPubkeyHex(wireMessage)
      : (msg.actor && (msg.actor.publicKey || msg.actor.pubkey || msg.actor.id)) || null;
    const source = signer ? String(signer) : null;

    if (type === 'MissionBroadcast' || type === 'SCEventBatch') {
      const object = msg.object != null ? msg.object : msg;
      try {
        if (type === 'MissionBroadcast' && typeof handlers.onMissionBroadcast === 'function') {
          handlers.onMissionBroadcast(object, source, { origin, wireMessage, msg });
        }
        if (type === 'SCEventBatch' && typeof handlers.onEventBatch === 'function') {
          handlers.onEventBatch(object, source, { origin, wireMessage, msg });
        }
      } catch (e) {
        peer.emit('warning', `[FABRIC:GOON] app handler error (${type}): ${(e && e.message) || e}`);
      }
      if (relay && origin && origin.name && wireMessage && typeof peer.relayFrom === 'function') {
        try { peer.relayFrom(origin.name, wireMessage); } catch (_) { /* ignore */ }
      }
      return peer;
    }

    const result = original(message, origin, socket, wireMessage);

    // After Peer's native chat emit/relay, optionally ingest for LiveRelay.
    if (type === 'P2P_CHAT_MESSAGE' && typeof handlers.onChat === 'function') {
      try { handlers.onChat(msg, source, { origin, wireMessage }); } catch (e) {
        peer.emit('warning', `[FABRIC:GOON] chat handler error: ${(e && e.message) || e}`);
      }
    }
    return result;
  };

  return peer;
}

class FabricNetwork extends EventEmitter {
  /**
   * @param {Object} [settings]
   * @param {boolean} [settings.enable=true]
   * @param {boolean} [settings.listen=true]
   * @param {number} [settings.port=7777]
   * @param {string} [settings.interface='0.0.0.0']
   * @param {string[]} [settings.peers] Seed `host:port` list
   * @param {string|null} [settings.peersDb] LevelDB path for peer registry
   * @param {boolean} [settings.relayAppMessages=false] Fan-out app GenericMessages
   * @param {boolean} [settings.networking=true]
   */
  constructor (settings = {}) {
    super();
    this.settings = Object.assign({
      enable: true,
      listen: true,
      port: 7777,
      interface: '0.0.0.0',
      peers: [DEFAULT_SEED],
      peersDb: null,
      relayAppMessages: false,
      networking: true,
      reconnectToKnownPeers: false,
      listenPortAttempts: 20
    }, settings);
    this._identity = null;
    this._peer = null;
    this._starting = null;
    this._handlers = null;
  }

  static get DEFAULT_SEED () { return DEFAULT_SEED; }
  static isFabricAddress (v) { return isFabricAddress(v); }
  static normalizeFabricAddress (v, opts) { return normalizeFabricAddress(v, opts); }
  static attachAppHandlers (peer, handlers, opts) { return attachAppHandlers(peer, handlers, opts); }

  /** Whether the Peer is up and has identity key material. */
  get ready () {
    return !!(this._peer && this._identity && this._peer.key);
  }

  get peer () { return this._peer; }

  /**
   * Provide (or clear) unlocked identity. Does not start/stop by itself —
   * callers invoke {@link #start} / {@link #stop}.
   * @param {Object|null} identity
   */
  setIdentity (identity) {
    this._identity = identity || null;
  }

  /**
   * Register ingest callbacks used when wire messages arrive.
   * @param {Object} handlers { onMissionBroadcast, onEventBatch, onChat }
   */
  setHandlers (handlers) {
    this._handlers = handlers || null;
  }

  /**
   * Replace the outbound seed peer list (host:port). When the Peer is already
   * running, initiates connections to newly added addresses (no listen restart).
   * @param {string[]} addresses
   */
  setPeers (addresses) {
    const list = (Array.isArray(addresses) ? addresses : [])
      .map((a) => normalizeFabricAddress(a, { migrate: true }))
      .filter(Boolean);
    const prev = new Set(this.settings.peers || []);
    this.settings.peers = list;
    if (this._peer && typeof this._peer._connect === 'function') {
      for (const addr of list) {
        if (prev.has(addr)) continue;
        if (this._peer.connections && this._peer.connections[addr]) continue;
        try {
          this._peer._upsertPeerRegistry(addr, { address: addr });
          this._peer._connect(addr);
        } catch (e) {
          this.emit('warning', `connect ${addr}: ${(e && e.message) || e}`);
        }
      }
    }
  }

  /**
   * Runtime status for GET /settings.
   * @returns {Object}
   */
  status () {
    const peer = this._peer;
    const connections = peer && peer.connections ? Object.keys(peer.connections).length : 0;
    return {
      enable: this.settings.enable !== false,
      listening: !!(peer && this.settings.listen),
      fabricListenPort: peer ? peer.settings.port : this.settings.port,
      fabricPeerId: peer && peer.key ? peer.key.pubkey : (this._identity && this._identity.pubkey) || null,
      fabricConnected: connections,
      fabricPeers: (this.settings.peers || []).slice(),
      ready: this.ready
    };
  }

  async start () {
    if (this.settings.enable === false) return this;
    if (!this._identity) throw new Error('FabricNetwork.start requires an unlocked identity');
    if (this._peer) return this;
    if (this._starting) return this._starting;

    this._starting = this._startInner().finally(() => { this._starting = null; });
    return this._starting;
  }

  async _startInner () {
    const Peer = require('@fabric/core/types/peer');
    const { keyFromIdentity } = require('../functions/identity');
    const key = keyFromIdentity(this._identity);

    const peersDb = this.settings.peersDb != null
      ? this.settings.peersDb
      : null;

    const peer = new Peer({
      listen: this.settings.listen !== false,
      port: Number(this.settings.port) || 7777,
      interface: this.settings.interface || '0.0.0.0',
      peers: (this.settings.peers || []).slice(),
      peersDb,
      networking: this.settings.networking !== false,
      reconnectToKnownPeers: this.settings.reconnectToKnownPeers === true,
      listenPortAttempts: this.settings.listenPortAttempts || 20,
      key: { xprv: key.xprv },
      upnp: false
    });

    peer.on('error', (e) => this.emit('error', e));
    peer.on('warning', (m) => this.emit('warning', m));
    peer.on('log', (m) => this.emit('log', m));
    peer.on('ready', (info) => this.emit('ready', info));
    peer.on('connections:open', (ev) => this.emit('connections:open', ev));
    peer.on('connections:close', (ev) => this.emit('connections:close', ev));

    // Track raw inbound TCP sockets ourselves: Peer only registers a
    // connection after the NOISE handshake, and its same-peer dedup can leave
    // an accepted socket untracked — net.Server.close() would then wait on it
    // forever during stop().
    this._rawInbound = new Set();
    this._stoppingPeer = false;
    if (peer.server && typeof peer.server.on === 'function') {
      peer.server.on('connection', (sock) => {
        if (this._stoppingPeer) { try { sock.destroy(); } catch (_) { /* closing */ } return; }
        this._rawInbound.add(sock);
        sock.on('close', () => this._rawInbound.delete(sock));
      });
    }

    attachAppHandlers(peer, {
      onMissionBroadcast: (object, source, meta) => {
        this.emit('missionBroadcast', { object, source, meta });
        if (this._handlers && typeof this._handlers.onMissionBroadcast === 'function') {
          this._handlers.onMissionBroadcast(object, source, meta);
        }
      },
      onEventBatch: (object, source, meta) => {
        this.emit('eventBatch', { object, source, meta });
        if (this._handlers && typeof this._handlers.onEventBatch === 'function') {
          this._handlers.onEventBatch(object, source, meta);
        }
      },
      onChat: (msg, source, meta) => {
        this.emit('chat', { msg, source, meta });
        if (this._handlers && typeof this._handlers.onChat === 'function') {
          this._handlers.onChat(msg, source, meta);
        }
      }
    }, { relay: !!this.settings.relayAppMessages });

    await peer.start();
    this._peer = peer;
    console.log(`[STAR-CITIZEN] fabric peer listening on ${peer.settings.port} (id ${String(peer.key.pubkey).slice(0, 12)}…)`);
    return this;
  }

  async stop () {
    // A start may still be in flight (setIdentity → start is fire-and-forget
    // in callers); wait for it so the freshly bound listener gets torn down.
    if (this._starting) {
      try { await this._starting; } catch (_) { /* start failed — nothing to stop */ }
    }
    const peer = this._peer;
    this._peer = null;
    if (!peer) return this;
    this._stoppingPeer = true;
    // Peer.stop() destroys tracked sockets but only a clean stream `end`
    // clears each connection's ping keepalive — tear down explicitly so an
    // abrupt shutdown cannot leave ref'd timers holding the event loop.
    for (const id of Object.keys(peer.connections || {})) {
      const c = peer.connections[id];
      if (!c) continue;
      try {
        if (c._keepalive) { clearInterval(c._keepalive); c._keepalive = null; }
        if (typeof c.destroy === 'function') c.destroy();
      } catch (_) { /* already torn down */ }
    }
    // Destroy accepted-but-untracked inbound sockets so server.close() can
    // complete (see _rawInbound note in _startInner).
    if (this._rawInbound) {
      for (const sock of this._rawInbound) {
        try { sock.destroy(); } catch (_) { /* already closed */ }
      }
      this._rawInbound.clear();
    }
    try { await peer.stop(); } catch (e) { this.emit('error', e); }
    return this;
  }

  /**
   * Restart with current identity + peer list (e.g. after Peers UI change).
   */
  async restart () {
    await this.stop();
    if (this._identity && this.settings.enable !== false) await this.start();
    return this;
  }

  _requireReady () {
    if (!this.ready) throw new Error('Fabric peer is not ready (unlock identity and wait for start)');
    return this._peer;
  }

  _signAndRelay (vectorType, body) {
    const Message = require('@fabric/core/types/message');
    const peer = this._requireReady();
    const msg = Message.fromVector([vectorType, JSON.stringify(body)]).signWithKey(peer.key);
    peer.relayFrom(null, msg);
    return msg;
  }

  /**
   * Publish a ChatMessage record as P2P_CHAT_MESSAGE (auto-relayed by Peer).
   * @param {Object} record ChatManager record
   */
  publishChat (record) {
    if (!record || !record.body || !record.author) throw new Error('chat record required');
    const pubkey = this._identity && this._identity.pubkey;
    if (pubkey && record.author !== pubkey) throw new Error('chat author must be local identity');
    const body = {
      type: 'P2P_CHAT_MESSAGE',
      actor: { publicKey: record.author, id: record.author },
      object: {
        channel: record.channel || 'global',
        body: record.body,
        author: record.author,
        handle: record.handle || null,
        ts: record.ts,
        id: record.id || null
      }
    };
    return this._signAndRelay('P2P_CHAT_MESSAGE', body);
  }

  /**
   * Publish a mission offer (GenericMessage MissionBroadcast).
   * @param {Object} payload Broadcast payload (mission, scope, groupId, …)
   */
  publishMissionBroadcast (payload) {
    const pubkey = this._identity && this._identity.pubkey;
    if (!pubkey) throw new Error('identity required');
    const object = Object.assign({}, payload);
    const body = {
      type: 'MissionBroadcast',
      '@type': 'MissionBroadcast',
      actor: { publicKey: pubkey, id: pubkey },
      object
    };
    return this._signAndRelay('GenericMessage', body);
  }

  /**
   * Publish a signed batch of log/register events.
   * @param {Array<{collection:string,data:Object}>} events
   * @param {string} [sentAt]
   */
  publishEventBatch (events, sentAt = new Date().toISOString()) {
    const pubkey = this._identity && this._identity.pubkey;
    if (!pubkey) throw new Error('identity required');
    if (!Array.isArray(events) || !events.length) return null;
    const body = {
      type: 'SCEventBatch',
      '@type': 'SCEventBatch',
      actor: { publicKey: pubkey, id: pubkey },
      object: { events, sentAt }
    };
    return this._signAndRelay('GenericMessage', body);
  }
}

FabricNetwork.APP_RELAY_TYPES = APP_RELAY_TYPES;
FabricNetwork.peersDbPath = function peersDbPath (settingsDir) {
  if (!settingsDir) return null;
  return path.join(settingsDir, 'peers');
};

module.exports = FabricNetwork;
