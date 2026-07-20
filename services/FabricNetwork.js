'use strict';

/**
 * FabricNetwork — local `@fabric/core` Peer for GoonCitizen peering.
 *
 * Wire Messages:
 *   - P2P_CHAT_MESSAGE     — network-wide `global` chat (Peer auto-relays)
 *   - CONTRACT_MESSAGE     — GoonCitizen app types + per-Group Federation types
 *   - CONTRACT_PUBLISH     — GoonCitizen genesis + per-Group Federation genesis
 *
 * Lazy-requires Peer/Message so memory-only unit tests stay light.
 */

const EventEmitter = require('events');
const path = require('path');

const { gooncitizenContractId, gooncitizenContractDefinition } = require('../contracts/gooncitizen');
const {
  groupContractDefinition,
  groupContractId,
  isGroupContractDefinition,
  isGroupMessageType,
  GROUP_MESSAGE_TYPES
} = require('../contracts/gooncitizenGroup');

const DEFAULT_SEED = 'relay.goon.vc:7777';
// App `type` values carried inside the GoonCitizen CONTRACT_MESSAGE namespace.
// MissionCreated is handled at ingest even if omitted from the genesis
// messageTypes list (that list is frozen into the contract Actor id).
const APP_RELAY_TYPES = new Set(['MissionCreated', 'MissionBroadcast', 'SCEventBatch', 'GameStateSnapshot']);

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
 * Subscribe app handlers to a Fabric Peer using its native message events.
 *
 * Namespaces:
 *   - GoonCitizen contract id → MissionCreated / MissionBroadcast / SCEventBatch
 *   - Group Federation contracts → GroupChat / GroupChange / GroupShare / invites
 *     (by typed app message, and/or `handlers.isKnownGroupContract(id)`)
 *
 * @param {Object} peer Fabric Peer instance
 * @param {Object} handlers
 * @param {{ relay?: boolean }} [opts]
 */
function attachAppHandlers (peer, handlers = {}, _opts = {}) {
  if (!peer || typeof peer.on !== 'function') {
    throw new Error('attachAppHandlers requires a Fabric Peer');
  }
  if (peer._goonAppHandlersAttached) return peer;
  peer._goonAppHandlersAttached = true;

  const goonId = gooncitizenContractId();
  const actorPubkey = (obj) => (obj && obj.actor && (obj.actor.publicKey || obj.actor.pubkey || obj.actor.id)) || null;

  peer.on('chat', (msg, meta) => {
    if (typeof handlers.onChat !== 'function') return;
    const signer = (meta && meta.signer) || actorPubkey(msg) || null;
    try {
      handlers.onChat(msg || {}, signer, meta || {});
    } catch (e) {
      peer.emit('warning', `[FABRIC:GOON] chat handler error: ${(e && e.message) || e}`);
    }
  });

  peer.on('contract:publish', (ev) => {
    if (!ev || !ev.object) return;
    if (!isGroupContractDefinition(ev.object)) return;
    if (typeof handlers.onGroupContractPublish !== 'function') return;
    try {
      handlers.onGroupContractPublish(ev.object, ev.signer || null, {
        origin: ev.origin,
        contract: ev.contract || groupContractId(ev.object)
      });
    } catch (e) {
      peer.emit('warning', `[FABRIC:GOON] group contract publish handler error: ${(e && e.message) || e}`);
    }
  });

  peer.on('contract:message', (ev) => {
    if (!ev || !ev.contract) return;
    const contract = String(ev.contract);
    const body = ev.object || {};
    const appType = body.type || body['@type'] || null;
    const object = body.object != null ? body.object : body;
    const signer = ev.signer || actorPubkey(body) || null;
    const meta = { origin: ev.origin, wireMessage: null, msg: body, signer, contract };

    try {
      if (contract === goonId) {
        if (appType === 'MissionCreated' && typeof handlers.onMissionCreated === 'function') {
          handlers.onMissionCreated(object, signer, meta);
        } else if (appType === 'MissionBroadcast' && typeof handlers.onMissionBroadcast === 'function') {
          handlers.onMissionBroadcast(object, signer, meta);
        } else if (appType === 'SCEventBatch' && typeof handlers.onEventBatch === 'function') {
          handlers.onEventBatch(object, signer, meta);
        } else if (appType === 'GameStateSnapshot' && typeof handlers.onGameStateSnapshot === 'function') {
          handlers.onGameStateSnapshot(object, signer, meta);
        }
        return;
      }

      const knownGroup = typeof handlers.isKnownGroupContract === 'function'
        ? handlers.isKnownGroupContract(contract)
        : false;
      if (!knownGroup && !isGroupMessageType(appType)) return;

      if (appType === 'GroupChat' && typeof handlers.onGroupChat === 'function') {
        handlers.onGroupChat(object, signer, meta);
      } else if (appType === 'GroupChange' && typeof handlers.onGroupChange === 'function') {
        handlers.onGroupChange(object, signer, meta);
      } else if (appType === 'GroupShare' && typeof handlers.onGroupShare === 'function') {
        handlers.onGroupShare(object, signer, meta);
      } else if (appType === 'FederationContractInvite' && typeof handlers.onFederationInvite === 'function') {
        handlers.onFederationInvite(object, signer, meta);
      } else if (appType === 'FederationContractInviteResponse' && typeof handlers.onFederationInviteResponse === 'function') {
        handlers.onFederationInviteResponse(object, signer, meta);
      }
    } catch (e) {
      peer.emit('warning', `[FABRIC:GOON] contract message handler error (${appType}): ${(e && e.message) || e}`);
    }
  });

  peer.on('contract:proposal', (ev) => {
    if (!ev || String(ev.contract) !== goonId) return;
    if (typeof handlers.onProposal !== 'function') return;
    try {
      handlers.onProposal(ev.payload, ev.signer || null, { origin: ev.origin });
    } catch (e) {
      peer.emit('warning', `[FABRIC:GOON] contract proposal handler error: ${(e && e.message) || e}`);
    }
  });

  return peer;
}

class FabricNetwork extends EventEmitter {
  /**
   * @param {Object} [settings]
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
    /** @type {Set<string>} locally known group Federation contract ids */
    this._groupContractIds = new Set();
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

  setIdentity (identity) {
    this._identity = identity || null;
  }

  setHandlers (handlers) {
    this._handlers = handlers || null;
  }

  /**
   * Register (or forget) a group Federation contract id for ingest routing.
   * @param {string} contractId
   * @param {boolean} [known=true]
   */
  setGroupContractKnown (contractId, known = true) {
    const id = String(contractId || '').trim();
    if (!id) return;
    if (known) this._groupContractIds.add(id);
    else this._groupContractIds.delete(id);
  }

  /** Replace the known group-contract id set (e.g. after loading groups). */
  setKnownGroupContracts (ids) {
    this._groupContractIds = new Set(
      (Array.isArray(ids) ? ids : []).map((x) => String(x || '').trim()).filter(Boolean)
    );
  }

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
      ready: this.ready,
      groupContracts: this._groupContractIds.size
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

  _forward (name, ...args) {
    if (this._handlers && typeof this._handlers[name] === 'function') {
      this._handlers[name](...args);
    }
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

    this._rawInbound = new Set();
    this._stoppingPeer = false;
    if (peer.server && typeof peer.server.on === 'function') {
      peer.server.on('connection', (sock) => {
        if (this._stoppingPeer) { try { sock.destroy(); } catch (_) { /* closing */ } return; }
        this._rawInbound.add(sock);
        sock.on('close', () => this._rawInbound.delete(sock));
      });
    }

    const self = this;
    attachAppHandlers(peer, {
      isKnownGroupContract: (id) => self._groupContractIds.has(String(id)),
      onMissionCreated: (object, source, meta) => {
        this.emit('missionCreated', { object, source, meta });
        this._forward('onMissionCreated', object, source, meta);
      },
      onMissionBroadcast: (object, source, meta) => {
        this.emit('missionBroadcast', { object, source, meta });
        this._forward('onMissionBroadcast', object, source, meta);
      },
      onEventBatch: (object, source, meta) => {
        this.emit('eventBatch', { object, source, meta });
        this._forward('onEventBatch', object, source, meta);
      },
      onChat: (msg, source, meta) => {
        this.emit('chat', { msg, source, meta });
        this._forward('onChat', msg, source, meta);
      },
      onProposal: (payload, source, meta) => {
        this.emit('contractProposal', { payload, source, meta });
        this._forward('onProposal', payload, source, meta);
      },
      onGroupContractPublish: (object, source, meta) => {
        const id = (meta && meta.contract) || groupContractId(object);
        this.setGroupContractKnown(id, true);
        this.emit('groupContractPublish', { object, source, meta, contractId: id });
        this._forward('onGroupContractPublish', object, source, meta);
      },
      onGroupChat: (object, source, meta) => {
        this.emit('groupChat', { object, source, meta });
        this._forward('onGroupChat', object, source, meta);
      },
      onGroupChange: (object, source, meta) => {
        this.emit('groupChange', { object, source, meta });
        this._forward('onGroupChange', object, source, meta);
      },
      onGroupShare: (object, source, meta) => {
        this.emit('groupShare', { object, source, meta });
        this._forward('onGroupShare', object, source, meta);
      },
      onFederationInvite: (object, source, meta) => {
        this.emit('federationInvite', { object, source, meta });
        this._forward('onFederationInvite', object, source, meta);
      },
      onFederationInviteResponse: (object, source, meta) => {
        this.emit('federationInviteResponse', { object, source, meta });
        this._forward('onFederationInviteResponse', object, source, meta);
      }
    });

    peer.on('connections:open', () => {
      try { this.publishContract(); } catch (_) { /* not ready / no peers yet */ }
    });

    await peer.start();
    this._peer = peer;
    console.log(`[STAR-CITIZEN] fabric peer listening on ${peer.settings.port} (id ${String(peer.key.pubkey).slice(0, 12)}…)`);
    try { this.publishContract(); } catch (_) { /* best-effort */ }
    return this;
  }

  async stop () {
    if (this._starting) {
      try { await this._starting; } catch (_) { /* start failed — nothing to stop */ }
    }
    const peer = this._peer;
    this._peer = null;
    if (!peer) return this;
    this._stoppingPeer = true;
    for (const id of Object.keys(peer.connections || {})) {
      const c = peer.connections[id];
      if (!c) continue;
      try {
        if (c._keepalive) { clearInterval(c._keepalive); c._keepalive = null; }
        if (typeof c.destroy === 'function') c.destroy();
      } catch (_) { /* already torn down */ }
    }
    if (this._rawInbound) {
      for (const sock of this._rawInbound) {
        try { sock.destroy(); } catch (_) { /* already closed */ }
      }
      this._rawInbound.clear();
    }
    try { await peer.stop(); } catch (e) { this.emit('error', e); }
    return this;
  }

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
   * Announce the GoonCitizen contract definition (CONTRACT_PUBLISH).
   * @returns {Object|null}
   */
  publishContract () {
    if (!this.ready) return null;
    return this._signAndRelay('CONTRACT_PUBLISH', gooncitizenContractDefinition());
  }

  /**
   * Publish a Group Federation genesis (CONTRACT_PUBLISH).
   * @param {Object} definition From {@link groupContractDefinition}
   */
  publishGroupContract (definition) {
    if (!isGroupContractDefinition(definition)) {
      throw new Error('publishGroupContract requires a GoonCitizenGroup definition');
    }
    const id = groupContractId(definition);
    this.setGroupContractKnown(id, true);
    return this._signAndRelay('CONTRACT_PUBLISH', definition);
  }

  /**
   * Publish a chat record as first-class `P2P_CHAT_MESSAGE` (global only on
   * the LiveRelay path; group chat uses {@link #publishGroupChat}).
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

  publishMissionCreated (payload) {
    return this._publishContractMessage(gooncitizenContractId(), 'MissionCreated', Object.assign({}, payload));
  }

  publishMissionBroadcast (payload) {
    return this._publishContractMessage(gooncitizenContractId(), 'MissionBroadcast', Object.assign({}, payload));
  }

  publishEventBatch (events, sentAt = new Date().toISOString()) {
    if (!Array.isArray(events) || !events.length) return null;
    return this._publishContractMessage(gooncitizenContractId(), 'SCEventBatch', { events, sentAt });
  }

  /**
   * Publish a compact cumulative game-state snapshot for Hub sidechain sync.
   * @param {Object} snapshot from functions/gooncitizenGameState.buildGameStateSnapshot
   */
  publishGameStateSnapshot (snapshot) {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('GameStateSnapshot required');
    return this._publishContractMessage(gooncitizenContractId(), 'GameStateSnapshot', Object.assign({}, snapshot));
  }

  /**
   * @param {string} contractId Group Federation contract id
   * @param {Object} payload GroupChat object
   */
  publishGroupChat (contractId, payload) {
    return this._publishContractMessage(contractId, 'GroupChat', Object.assign({}, payload));
  }

  /**
   * @param {string} contractId
   * @param {Object} payload GroupChange object
   */
  publishGroupChange (contractId, payload) {
    return this._publishContractMessage(contractId, 'GroupChange', Object.assign({}, payload));
  }

  /**
   * @param {string} contractId
   * @param {Object} payload GroupShare object `{ kind, object, … }`
   */
  publishGroupShare (contractId, payload) {
    return this._publishContractMessage(contractId, 'GroupShare', Object.assign({}, payload));
  }

  /**
   * @param {string} contractId
   * @param {Object} invite FederationContractInvite fields/object
   */
  publishFederationInvite (contractId, invite) {
    const {
      buildFederationContractInvite,
      FEDERATION_CONTRACT_INVITE
    } = require('../functions/federationContractInvite');
    const doc = invite && invite.type === FEDERATION_CONTRACT_INVITE
      ? invite
      : buildFederationContractInvite(Object.assign({ contractId }, invite || {}));
    return this._publishContractMessage(contractId, FEDERATION_CONTRACT_INVITE, doc);
  }

  /**
   * @param {string} contractId
   * @param {Object} response FederationContractInviteResponse fields/object
   */
  publishFederationInviteResponse (contractId, response) {
    const {
      buildFederationContractInviteResponse,
      FEDERATION_CONTRACT_INVITE_RESPONSE
    } = require('../functions/federationContractInvite');
    const doc = response && response.type === FEDERATION_CONTRACT_INVITE_RESPONSE
      ? response
      : buildFederationContractInviteResponse(response || {});
    return this._publishContractMessage(contractId, FEDERATION_CONTRACT_INVITE_RESPONSE, doc);
  }

  publishContractProposal (messages, opts = {}) {
    const pubkey = this._identity && this._identity.pubkey;
    if (!pubkey) throw new Error('identity required');
    if (!Array.isArray(messages) || !messages.length) throw new Error('at least one message is required');
    const { buildContractProposalPayload } = require('@fabric/core/functions/contractProposal');
    const payload = buildContractProposalPayload({
      contractId: gooncitizenContractId(),
      parentChainRoot: opts.parentChainRoot || null,
      messages,
      statePatch: Array.isArray(opts.statePatch) ? opts.statePatch : [],
      psbtProposalBase64: opts.psbtProposalBase64
    });
    if (opts.purpose) payload.purpose = String(opts.purpose);
    return this._signAndRelay('CONTRACT_PROPOSAL', payload);
  }

  _publishContractMessage (contractId, type, object) {
    const pubkey = this._identity && this._identity.pubkey;
    if (!pubkey) throw new Error('identity required');
    const contract = String(contractId || '').trim();
    if (!contract) throw new Error('contract id required');
    const body = {
      contract,
      type,
      actor: { publicKey: pubkey, id: pubkey },
      object
    };
    return this._signAndRelay('CONTRACT_MESSAGE', body);
  }
}

FabricNetwork.APP_RELAY_TYPES = APP_RELAY_TYPES;
FabricNetwork.GROUP_MESSAGE_TYPES = GROUP_MESSAGE_TYPES;
FabricNetwork.peersDbPath = function peersDbPath (settingsDir) {
  if (!settingsDir) return null;
  return path.join(settingsDir, 'peers');
};

module.exports = FabricNetwork;
