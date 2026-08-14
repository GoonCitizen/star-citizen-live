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
const { OUTER, CONTRACT_BODY_TYPES } = require('../contracts/applicationMessageTypes');
const { PEER_PROFILE_TYPE, peeringAddressesFromObject } = require('../functions/peerProfile');
const { FLEET_SHARE_TYPE } = require('../functions/starjumpFleet');
const { PRESENCE_TYPE } = require('../functions/presence');
const {
  peeringInfoForGoonCitizen
} = require('../functions/peerPeeringString');
const {
  createFabricMessageLog,
  summarizeMessage,
  summarizeBuffer
} = require('../functions/fabricMessageLog');

let peerHost;
try {
  peerHost = require('@fabric/http/functions/fabricPeerHost');
} catch (_) {
  peerHost = require('../functions/fabricPeerHost');
}

const DEFAULT_SEEDS = peerHost.DEFAULT_NETWORK_HUB_SEEDS;
/** @deprecated Prefer DEFAULT_SEEDS — first network hub seed. */
const DEFAULT_SEED = DEFAULT_SEEDS[0];
/** Default TCP peer cap (matches @fabric/core MAX_PEERS soft default for slot fill). */
const DEFAULT_MAX_PEERS = peerHost.DEFAULT_MAX_PEERS;
const {
  isNetworkHubAddress,
  isLoopbackFabricAddress,
  collectOwnFabricHosts,
  hostnameResolvesToOwn,
  isSelfFabricAddress,
  isFabricAddress,
  normalizeFabricAddress,
  splitFabricHostPort
} = peerHost;

const localPeerHost = require('../functions/fabricPeerHostLocal');
// Local canonicalize includes dedicated-NIC IP aliases (http pin may lag).
const canonicalizeFabricPeerDial = localPeerHost.canonicalizeFabricPeerDial;

/** App `type` values under GoonCitizen / Group CONTRACT_MESSAGE (ingest catalog). */
const APP_RELAY_TYPES = new Set([
  CONTRACT_BODY_TYPES.MissionCreated,
  CONTRACT_BODY_TYPES.MissionBroadcast,
  CONTRACT_BODY_TYPES.MissionClaim || 'MissionClaim',
  CONTRACT_BODY_TYPES.MissionClaimDecision || 'MissionClaimDecision',
  CONTRACT_BODY_TYPES.SCEventBatch,
  CONTRACT_BODY_TYPES.GameStateSnapshot,
  PEER_PROFILE_TYPE,
  FLEET_SHARE_TYPE,
  PRESENCE_TYPE,
  'DirectChat',
  CONTRACT_BODY_TYPES.GroupChat,
  CONTRACT_BODY_TYPES.GroupChange,
  CONTRACT_BODY_TYPES.GroupChangeProposal || 'GroupChangeProposal',
  CONTRACT_BODY_TYPES.GroupChangeVote || 'GroupChangeVote',
  CONTRACT_BODY_TYPES.GroupShare,
  CONTRACT_BODY_TYPES.GroupActivityTree,
  CONTRACT_BODY_TYPES.GroupJournalRequest || 'GroupJournalRequest',
  CONTRACT_BODY_TYPES.GroupJournalBatch || 'GroupJournalBatch',
  CONTRACT_BODY_TYPES.GroupStateJournal || 'GroupStateJournal',
  CONTRACT_BODY_TYPES.FederationContractInvite,
  CONTRACT_BODY_TYPES.FederationContractInviteResponse,
  CONTRACT_BODY_TYPES.DiscordRequest || 'DiscordRequest',
  CONTRACT_BODY_TYPES.DiscordClaim || 'DiscordClaim',
  CONTRACT_BODY_TYPES.DiscordResponse || 'DiscordResponse',
  CONTRACT_BODY_TYPES.LookupRequest || 'LookupRequest',
  CONTRACT_BODY_TYPES.LookupClaim || 'LookupClaim',
  CONTRACT_BODY_TYPES.LookupResponse || 'LookupResponse',
  CONTRACT_BODY_TYPES.NoteShare || 'NoteShare',
  CONTRACT_BODY_TYPES.NoteUpdate || 'NoteUpdate',
  CONTRACT_BODY_TYPES.GroupDataShare || 'GroupDataShare',
  CONTRACT_BODY_TYPES.DiscordCatalogShare || 'DiscordCatalogShare',
  CONTRACT_BODY_TYPES.IdentityCrossSign || 'IdentityCrossSign',
  CONTRACT_BODY_TYPES.IdentityCrossSignRevoke || 'IdentityCrossSignRevoke'
]);

/** True when `appType` is a known GoonCitizen / Group contract body type. */
const isKnownAppRelayType = peerHost.createIsKnownAppRelayType(APP_RELAY_TYPES);

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
 * @param {Object} [opts]
 * @param {boolean} [opts.relay]
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

  peer.on('peerAlias', (ev) => {
    if (typeof handlers.onPeerAlias !== 'function') return;
    try {
      handlers.onPeerAlias(ev || {}, (ev && ev.signer) || null, ev || {});
    } catch (e) {
      peer.emit('warning', `[FABRIC:GOON] peerAlias handler error: ${(e && e.message) || e}`);
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
    const meta = {
      origin: ev.origin,
      // Bit-identical AMP frame from Peer (for ARC accumulate / Statechain attach).
      wireMessage: ev.wireMessage || null,
      messageHex: ev.messageHex || null,
      messageId: ev.messageId || null,
      msg: body,
      signer,
      contract
    };

    try {
      if (contract === goonId) {
        if (appType && !isKnownAppRelayType(appType)) {
          peer.emit('warning', `[FABRIC:GOON] ignoring unknown GoonCitizen app type: ${appType}`);
          return;
        }
        if (appType === CONTRACT_BODY_TYPES.MissionCreated && typeof handlers.onMissionCreated === 'function') {
          handlers.onMissionCreated(object, signer, meta);
        } else if (appType === CONTRACT_BODY_TYPES.MissionBroadcast && typeof handlers.onMissionBroadcast === 'function') {
          handlers.onMissionBroadcast(object, signer, meta);
        } else if ((appType === CONTRACT_BODY_TYPES.MissionClaim || appType === 'MissionClaim') &&
          typeof handlers.onMissionClaim === 'function') {
          handlers.onMissionClaim(object, signer, meta);
        } else if ((appType === CONTRACT_BODY_TYPES.MissionClaimDecision || appType === 'MissionClaimDecision') &&
          typeof handlers.onMissionClaimDecision === 'function') {
          handlers.onMissionClaimDecision(object, signer, meta);
        } else if (appType === CONTRACT_BODY_TYPES.SCEventBatch && typeof handlers.onEventBatch === 'function') {
          handlers.onEventBatch(object, signer, meta);
        } else if (appType === CONTRACT_BODY_TYPES.GameStateSnapshot && typeof handlers.onGameStateSnapshot === 'function') {
          handlers.onGameStateSnapshot(object, signer, meta);
        } else if (appType === PEER_PROFILE_TYPE && typeof handlers.onPeerProfile === 'function') {
          handlers.onPeerProfile(object, signer, meta);
        } else if (appType === FLEET_SHARE_TYPE && typeof handlers.onFleetShare === 'function') {
          handlers.onFleetShare(object, signer, meta);
        } else if (appType === PRESENCE_TYPE && typeof handlers.onPeerPresence === 'function') {
          handlers.onPeerPresence(object, signer, meta);
        } else if (appType === 'DirectChat' && typeof handlers.onDirectChat === 'function') {
          handlers.onDirectChat(object, signer, meta);
        } else if (appType === CONTRACT_BODY_TYPES.GroupShare && typeof handlers.onGroupShare === 'function') {
          // Network-wide GroupOffer / MissionBroadcast-in-GroupShare discovery
          // (same CONTRACT_MESSAGE type, GoonCitizen genesis namespace).
          handlers.onGroupShare(object, signer, meta);
        } else if (appType === CONTRACT_BODY_TYPES.FederationContractInvite && typeof handlers.onFederationInvite === 'function') {
          // Direct group invites (inviteePubkey) discoverable without prior group contract.
          handlers.onFederationInvite(object, signer, meta);
        } else if (appType === CONTRACT_BODY_TYPES.FederationContractInviteResponse && typeof handlers.onFederationInviteResponse === 'function') {
          handlers.onFederationInviteResponse(object, signer, meta);
        } else if ((appType === CONTRACT_BODY_TYPES.DiscordRequest || appType === 'DiscordRequest') &&
          typeof handlers.onDiscordRequest === 'function') {
          handlers.onDiscordRequest(object, signer, meta);
        } else if ((appType === CONTRACT_BODY_TYPES.DiscordClaim || appType === 'DiscordClaim') &&
          typeof handlers.onDiscordClaim === 'function') {
          handlers.onDiscordClaim(object, signer, meta);
        } else if ((appType === CONTRACT_BODY_TYPES.DiscordResponse || appType === 'DiscordResponse') &&
          typeof handlers.onDiscordResponse === 'function') {
          handlers.onDiscordResponse(object, signer, meta);
        } else if ((appType === CONTRACT_BODY_TYPES.LookupRequest || appType === 'LookupRequest') &&
          typeof handlers.onLookupRequest === 'function') {
          handlers.onLookupRequest(object, signer, meta);
        } else if ((appType === CONTRACT_BODY_TYPES.LookupClaim || appType === 'LookupClaim') &&
          typeof handlers.onLookupClaim === 'function') {
          handlers.onLookupClaim(object, signer, meta);
        } else if ((appType === CONTRACT_BODY_TYPES.LookupResponse || appType === 'LookupResponse') &&
          typeof handlers.onLookupResponse === 'function') {
          handlers.onLookupResponse(object, signer, meta);
        } else if ((appType === CONTRACT_BODY_TYPES.NoteShare || appType === 'NoteShare') &&
          typeof handlers.onNoteShare === 'function') {
          handlers.onNoteShare(object, signer, meta);
        } else if ((appType === CONTRACT_BODY_TYPES.NoteUpdate || appType === 'NoteUpdate') &&
          typeof handlers.onNoteUpdate === 'function') {
          handlers.onNoteUpdate(object, signer, meta);
        } else if ((appType === CONTRACT_BODY_TYPES.GroupDataShare || appType === 'GroupDataShare') &&
          typeof handlers.onGroupDataShare === 'function') {
          handlers.onGroupDataShare(object, signer, meta);
        } else if ((appType === CONTRACT_BODY_TYPES.DiscordCatalogShare || appType === 'DiscordCatalogShare') &&
          typeof handlers.onDiscordCatalogShare === 'function') {
          handlers.onDiscordCatalogShare(object, signer, meta);
        } else if ((appType === CONTRACT_BODY_TYPES.IdentityCrossSign || appType === 'IdentityCrossSign' ||
          appType === CONTRACT_BODY_TYPES.IdentityCrossSignRevoke || appType === 'IdentityCrossSignRevoke') &&
          typeof handlers.onIdentityCrossSign === 'function') {
          handlers.onIdentityCrossSign(object, signer, meta);
        }
        return;
      }

      if ((appType === CONTRACT_BODY_TYPES.IdentityCrossSign || appType === 'IdentityCrossSign' ||
        appType === CONTRACT_BODY_TYPES.IdentityCrossSignRevoke || appType === 'IdentityCrossSignRevoke') &&
        typeof handlers.onIdentityCrossSign === 'function') {
        handlers.onIdentityCrossSign(object, signer, meta);
        return;
      }

      const knownGroup = typeof handlers.isKnownGroupContract === 'function'
        ? handlers.isKnownGroupContract(contract)
        : false;
      if (!knownGroup && !isGroupMessageType(appType)) return;

      if (appType === CONTRACT_BODY_TYPES.GroupChat && typeof handlers.onGroupChat === 'function') {
        handlers.onGroupChat(object, signer, meta);
      } else if ((appType === CONTRACT_BODY_TYPES.MessageReceipt || appType === 'MessageReceipt') &&
        typeof handlers.onMessageReceipt === 'function') {
        handlers.onMessageReceipt(object, signer, meta);
      } else if ((appType === CONTRACT_BODY_TYPES.MessageReceived || appType === 'MessageReceived') &&
        typeof handlers.onMessageReceived === 'function') {
        handlers.onMessageReceived(object, signer, meta);
      } else if (appType === CONTRACT_BODY_TYPES.GroupChange && typeof handlers.onGroupChange === 'function') {
        handlers.onGroupChange(object, signer, meta);
      } else if ((appType === CONTRACT_BODY_TYPES.GroupChangeProposal || appType === 'GroupChangeProposal') &&
        typeof handlers.onGroupChangeProposal === 'function') {
        handlers.onGroupChangeProposal(object, signer, meta);
      } else if ((appType === CONTRACT_BODY_TYPES.GroupChangeVote || appType === 'GroupChangeVote') &&
        typeof handlers.onGroupChangeVote === 'function') {
        handlers.onGroupChangeVote(object, signer, meta);
      } else if (appType === CONTRACT_BODY_TYPES.GroupShare && typeof handlers.onGroupShare === 'function') {
        handlers.onGroupShare(object, signer, meta);
      } else if (appType === CONTRACT_BODY_TYPES.GroupActivityTree && typeof handlers.onGroupActivityTree === 'function') {
        handlers.onGroupActivityTree(object, signer, meta);
      } else if ((appType === CONTRACT_BODY_TYPES.GroupJournalRequest || appType === 'GroupJournalRequest') &&
        typeof handlers.onGroupJournalRequest === 'function') {
        handlers.onGroupJournalRequest(object, signer, meta);
      } else if ((appType === CONTRACT_BODY_TYPES.GroupJournalBatch || appType === 'GroupJournalBatch') &&
        typeof handlers.onGroupJournalBatch === 'function') {
        handlers.onGroupJournalBatch(object, signer, meta);
      } else if ((appType === CONTRACT_BODY_TYPES.GroupStateJournal || appType === 'GroupStateJournal') &&
        typeof handlers.onGroupStateJournal === 'function') {
        handlers.onGroupStateJournal(object, signer, meta);
      } else if (appType === CONTRACT_BODY_TYPES.FederationContractInvite && typeof handlers.onFederationInvite === 'function') {
        handlers.onFederationInvite(object, signer, meta);
      } else if (appType === CONTRACT_BODY_TYPES.FederationContractInviteResponse && typeof handlers.onFederationInviteResponse === 'function') {
        handlers.onFederationInviteResponse(object, signer, meta);
      } else if ((appType === CONTRACT_BODY_TYPES.GroupDataShare || appType === 'GroupDataShare') &&
        typeof handlers.onGroupDataShare === 'function') {
        handlers.onGroupDataShare(object, signer, meta);
      } else if ((appType === CONTRACT_BODY_TYPES.DiscordCatalogShare || appType === 'DiscordCatalogShare') &&
        typeof handlers.onDiscordCatalogShare === 'function') {
        handlers.onDiscordCatalogShare(object, signer, meta);
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

  peer.on('inventory', (ev) => {
    if (typeof handlers.onInventoryRequest !== 'function') return;
    try {
      handlers.onInventoryRequest(Object.assign({}, ev || {}, { peer }));
    } catch (e) {
      peer.emit('warning', `[FABRIC:GOON] inventory request handler error: ${(e && e.message) || e}`);
    }
  });

  peer.on('inventoryResponse', (ev) => {
    if (typeof handlers.onInventoryResponse !== 'function') return;
    try {
      handlers.onInventoryResponse(Object.assign({}, ev || {}, { peer }));
    } catch (e) {
      peer.emit('warning', `[FABRIC:GOON] inventory response handler error: ${(e && e.message) || e}`);
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
      peers: DEFAULT_SEEDS.slice(),
      peersDb: null,
      relayAppMessages: false,
      networking: true,
      reconnectToKnownPeers: false,
      listenPortAttempts: 20,
      maxPeers: DEFAULT_MAX_PEERS,
      advertiseHost: null,
      ownHosts: null,
      broadcastPeering: false,
      messageLog: null,
      messageLogCapacity: undefined
    }, settings);
    this._identity = null;
    this._peer = null;
    this._starting = null;
    this._handlers = null;
    /** Locally known group Federation contract ids. */
    /** @type {Set} */
    this._groupContractIds = new Set();
    this._slotFillTimer = null;
    this._lastPeeringOfferAt = 0;
    this._messageLog = settings.messageLog || createFabricMessageLog({
      capacity: settings.messageLogCapacity
    });
  }

  static get DEFAULT_SEED () { return DEFAULT_SEED; }
  static get DEFAULT_SEEDS () { return DEFAULT_SEEDS.slice(); }
  static isNetworkHubAddress (v) { return isNetworkHubAddress(v); }
  static isLoopbackFabricAddress (v) { return isLoopbackFabricAddress(v); }
  static isSelfFabricAddress (v, listenPort, opts) { return isSelfFabricAddress(v, listenPort, opts); }
  static collectOwnFabricHosts (opts) { return collectOwnFabricHosts(opts); }
  static canonicalizeFabricPeerDial (v, listenPort, opts) {
    return canonicalizeFabricPeerDial(v, listenPort, opts);
  }
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
    // Caller (LiveRelay) already excludes self-loop addresses. Loopback to a
    // *different* port is valid (local hub peer in tests / LAN relays).
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
      // Re-dial network hubs that dropped (star gossip depends on them).
      for (const addr of list) {
        if (!isNetworkHubAddress(addr)) continue;
        const connected = Object.keys(this._peer.connections || {})
          .some((id) => FabricNetwork.connectionMatchesAddress(id, addr));
        if (connected) continue;
        try {
          this._peer._upsertPeerRegistry(addr, { address: addr });
          this._peer._connect(addr);
        } catch (e) {
          this.emit('warning', `reconnect hub ${addr}: ${(e && e.message) || e}`);
        }
      }
    }
  }

  status () {
    const peer = this._peer;
    const connectionIds = peer && peer.connections ? Object.keys(peer.connections) : [];
    const log = this._messageLog && typeof this._messageLog.status === 'function'
      ? this._messageLog.status()
      : null;
    return {
      enable: this.settings.enable !== false,
      listening: !!(peer && this.settings.listen),
      fabricListenPort: peer ? peer.settings.port : this.settings.port,
      fabricPeerId: peer && peer.key ? peer.key.pubkey : (this._identity && this._identity.pubkey) || null,
      fabricConnected: connectionIds.length,
      fabricConnections: connectionIds.slice(),
      fabricPeers: (this.settings.peers || []).slice(),
      ready: this.ready,
      groupContracts: this._groupContractIds.size,
      messageLog: log
    };
  }

  /** Shared Fabric wire-message ring buffer (advanced UI). */
  get messageLog () {
    return this._messageLog;
  }

  /**
   * Record a Fabric AMP Message (instance or wire buffer) in the advanced log.
   * @param {'in'|'out'} direction
   * @param {object|Buffer} messageOrBuffer
   * @param {Object} [meta]
   * @param {string|null} [meta.peer]
   * @param {string|null} [meta.via]
   */
  recordMessage (direction, messageOrBuffer, meta = {}) {
    if (!this._messageLog) return null;
    try {
      const summary = Buffer.isBuffer(messageOrBuffer)
        ? summarizeBuffer(messageOrBuffer, { direction, peer: meta.peer || null, via: meta.via || null })
        : summarizeMessage(messageOrBuffer, { direction, peer: meta.peer || null, via: meta.via || null });
      if (!summary) return null;
      return this._messageLog.append(summary);
    } catch (_) {
      return null;
    }
  }

  _attachMessageLog (peer) {
    if (!peer || typeof peer._handleFabricMessage !== 'function' || peer._goonMessageLogAttached) return;
    peer._goonMessageLogAttached = true;
    const orig = peer._handleFabricMessage.bind(peer);
    const self = this;
    peer._handleFabricMessage = function (buffer, origin = null, socket = null) {
      const peerName = origin && (origin.name != null ? origin.name : origin);
      self.recordMessage('in', buffer, {
        peer: peerName != null ? String(peerName) : null,
        via: 'peer'
      });
      return orig(buffer, origin, socket);
    };
  }

  /** Connected Fabric addresses (connection map keys, typically host:port). */
  connectedAddresses () {
    return this.status().fabricConnections || [];
  }

  /**
   * True when `connectionId` matches a roster address (exact or host match).
   * @param {string} connectionId
   * @param {string} rosterAddress
   */
  static connectionMatchesAddress (connectionId, rosterAddress) {
    const id = String(connectionId || '').toLowerCase();
    const addr = String(rosterAddress || '').toLowerCase();
    if (!id || !addr) return false;
    if (id === addr) return true;
    const host = addr.split(':')[0];
    if (host && (id === host || id.startsWith(host + ':'))) return true;
    return false;
  }

  _signMessage (vectorType, body, opts = {}) {
    const Message = require('@fabric/core/types/message');
    const { keyFromIdentity } = require('../functions/identity');
    const key = opts.key
      || (this._peer && this._peer.key)
      || (this._identity ? keyFromIdentity(this._identity) : null);
    if (!key) throw new Error('signing key required (unlock identity)');
    const wireBody = typeof body === 'string' ? body : JSON.stringify(body);
    return Message.fromVector([vectorType, wireBody]).signWithKey(key);
  }

  /**
   * Sign a Message and optionally relay to peers. Sign-only works with an
   * unlocked identity even when the peer is not listening yet.
   * @param {string} vectorType
   * @param {object|string} body
   * @param {Object} [opts]
   * @param {string[]} [opts.to]
   * @param {boolean} [opts.relay]
   * @param {object} [opts.key]
   */
  _signAndRelay (vectorType, body, opts = {}) {
    const msg = this._signMessage(vectorType, body, opts);
    const shouldRelay = opts.relay !== false;
    this.recordMessage('out', msg, {
      via: shouldRelay && this.ready ? 'relay' : 'local',
      peer: Array.isArray(opts.to) && opts.to.length ? opts.to.join(',') : null
    });
    if (!shouldRelay) return msg;
    if (!this.ready) return msg;
    const peer = this._peer;
    const buf = msg.toBuffer();
    const targets = Array.isArray(opts.to) ? opts.to.map((a) => String(a).trim()).filter(Boolean) : null;
    if (!targets || !targets.length) {
      peer.relayFrom(null, msg);
      return msg;
    }
    for (const id of Object.keys(peer.connections || {})) {
      const hit = targets.some((addr) => FabricNetwork.connectionMatchesAddress(id, addr));
      if (hit && peer.connections[id] && typeof peer.connections[id]._writeFabric === 'function') {
        peer.connections[id]._writeFabric(buf);
      }
    }
    return msg;
  }

  /**
   * Sign a CONTRACT_MESSAGE without requiring peer ready (clipboard / share).
   * @param {string} contractId
   * @param {string} type
   * @param {object} object
   * @param {Object} [opts]
   * @param {boolean} [opts.relay]
   */
  signContractMessage (contractId, type, object, opts = {}) {
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
    const msg = this._signMessage(OUTER.CONTRACT_MESSAGE, body, opts);
    this.recordMessage('out', msg, { via: 'local' });
    return msg;
  }

  /**
   * Encode a signed Message as opaque fabric:&lt;payload&gt; (base64 body by default, or hex).
   * @param {object} message
   * @param {Object} [opts]
   * @param {string} [opts.encoding] `'base64'` (default) or `'hex'`
   * @returns {{ message: object, buffer: Buffer, messageHex: string, messageBase64: string, protocolUrl: string, protocolUrlHex: string, protocolUrlBase64: string }}
   */
  encodeOpaqueMessage (message, opts = {}) {
    const { buildOpaqueFabricUrl, normalizeOpaqueShareEncoding } = require('../functions/groupShareMessage');
    if (!message || typeof message.toBuffer !== 'function') {
      throw new Error('Fabric Message required');
    }
    const buffer = message.toBuffer();
    const encoding = normalizeOpaqueShareEncoding(opts.encoding);
    return {
      message,
      buffer,
      messageHex: buffer.toString('hex'),
      messageBase64: buffer.toString('base64'),
      protocolUrl: buildOpaqueFabricUrl(buffer, { encoding }),
      protocolUrlHex: buildOpaqueFabricUrl(buffer, { encoding: 'hex' }),
      protocolUrlBase64: buildOpaqueFabricUrl(buffer, { encoding: 'base64' })
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
    const { masterKeyFromIdentity } = require('../functions/identity');
    // Peer derives FABRIC_KEY_DERIVATION_PATH from the HD master xprv.
    const master = masterKeyFromIdentity(this._identity);

    const peersDb = this.settings.peersDb != null
      ? this.settings.peersDb
      : null;

    const maxPeers = Number(this.settings.maxPeers) > 0
      ? Number(this.settings.maxPeers)
      : DEFAULT_MAX_PEERS;
    const peer = new Peer({
      listen: this.settings.listen !== false,
      port: Number(this.settings.port) || 7777,
      interface: this.settings.interface || '0.0.0.0',
      peers: (this.settings.peers || []).slice(),
      peersDb,
      networking: this.settings.networking !== false,
      reconnectToKnownPeers: this.settings.reconnectToKnownPeers === true,
      listenPortAttempts: this.settings.listenPortAttempts || 20,
      key: { xprv: master.xprv },
      upnp: false,
      constraints: {
        peers: { max: maxPeers }
      }
    });
    this._wrapPeeringCandidateEnqueue(peer);

    peer.on('error', (e) => this.emit('error', e));
    peer.on('warning', (m) => this.emit('warning', m));
    peer.on('log', (m) => this.emit('log', m));
    peer.on('ready', (info) => this.emit('ready', info));
    peer.on('connections:open', (ev) => this.emit('connections:open', ev));
    peer.on('connections:close', (ev) => this.emit('connections:close', ev));
    peer.on('peer:self', (ev) => {
      this.emit('peer:self', ev);
      const addr = ev && ev.address;
      if (addr) {
        this.emit('warning',
          `[STAR-CITIZEN] fabric self-session at ${addr}: ${(ev && ev.reason) || 'own key'}`);
      }
    });
    this._attachMessageLog(peer);

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
      onMissionClaim: (object, source, meta) => {
        this.emit('missionClaim', { object, source, meta });
        this._forward('onMissionClaim', object, source, meta);
      },
      onMissionClaimDecision: (object, source, meta) => {
        this.emit('missionClaimDecision', { object, source, meta });
        this._forward('onMissionClaimDecision', object, source, meta);
      },
      onEventBatch: (object, source, meta) => {
        this.emit('eventBatch', { object, source, meta });
        this._forward('onEventBatch', object, source, meta);
      },
      onChat: (msg, source, meta) => {
        this.emit('chat', { msg, source, meta });
        this._forward('onChat', msg, source, meta);
      },
      onPeerAlias: (ev, source, meta) => {
        this.emit('peerAlias', { ev, source, meta });
        this._forward('onPeerAlias', ev, source, meta);
      },
      onPeerProfile: (object, source, meta) => {
        this.emit('peerProfile', { object, source, meta });
        this._forward('onPeerProfile', object, source, meta);
      },
      onFleetShare: (object, source, meta) => {
        this.emit('fleetShare', { object, source, meta });
        this._forward('onFleetShare', object, source, meta);
      },
      onPeerPresence: (object, source, meta) => {
        this.emit('peerPresence', { object, source, meta });
        this._forward('onPeerPresence', object, source, meta);
      },
      onDirectChat: (object, source, meta) => {
        this.emit('directChat', { object, source, meta });
        this._forward('onDirectChat', object, source, meta);
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
      onMessageReceipt: (object, source, meta) => {
        this.emit('messageReceipt', { object, source, meta });
        this._forward('onMessageReceipt', object, source, meta);
      },
      onMessageReceived: (object, source, meta) => {
        this.emit('messageReceived', { object, source, meta });
        this._forward('onMessageReceived', object, source, meta);
      },
      onGroupChange: (object, source, meta) => {
        this.emit('groupChange', { object, source, meta });
        this._forward('onGroupChange', object, source, meta);
      },
      onGroupChangeProposal: (object, source, meta) => {
        this.emit('groupChangeProposal', { object, source, meta });
        this._forward('onGroupChangeProposal', object, source, meta);
      },
      onGroupChangeVote: (object, source, meta) => {
        this.emit('groupChangeVote', { object, source, meta });
        this._forward('onGroupChangeVote', object, source, meta);
      },
      onGroupShare: (object, source, meta) => {
        this.emit('groupShare', { object, source, meta });
        this._forward('onGroupShare', object, source, meta);
      },
      onGroupJournalRequest: (object, source, meta) => {
        this.emit('groupJournalRequest', { object, source, meta });
        this._forward('onGroupJournalRequest', object, source, meta);
      },
      onGroupJournalBatch: (object, source, meta) => {
        this.emit('groupJournalBatch', { object, source, meta });
        this._forward('onGroupJournalBatch', object, source, meta);
      },
      onGroupStateJournal: (object, source, meta) => {
        this.emit('groupStateJournal', { object, source, meta });
        this._forward('onGroupStateJournal', object, source, meta);
      },
      onFederationInvite: (object, source, meta) => {
        this.emit('federationInvite', { object, source, meta });
        this._forward('onFederationInvite', object, source, meta);
      },
      onFederationInviteResponse: (object, source, meta) => {
        this.emit('federationInviteResponse', { object, source, meta });
        this._forward('onFederationInviteResponse', object, source, meta);
      },
      onIdentityCrossSign: (object, source, meta) => {
        this.emit('identityCrossSign', { object, source, meta });
        this._forward('onIdentityCrossSign', object, source, meta);
      },
      onInventoryRequest: (ev) => {
        this.emit('inventoryRequest', ev);
        this._forward('onInventoryRequest', ev);
      },
      onInventoryResponse: (ev) => {
        this.emit('inventoryResponse', ev);
        this._forward('onInventoryResponse', ev);
      }
    });

    peer.on('connections:open', () => {
      try { this.publishContract(); } catch (_) { /* not ready / no peers yet */ }
      this.fillPeerSlots();
    });
    peer.on('connections:close', () => {
      this.fillPeerSlots();
      this.maybePublishPeeringOffer();
    });

    // Core enqueues P2P_PEERING_OFFER candidates but does not always dial; we
    // drain slots and surface gossip addresses for roster discovery.
    peer.on('peeringOffer', (ev) => {
      this._ingestPeeringEvent(ev, 'offer');
    });
    peer.on('peeringGossip', (ev) => {
      this._ingestPeeringEvent(ev, 'gossip');
    });

    await peer.start();
    this._peer = peer;
    this._sanitizePeerCandidates(peer);
    this._startSlotFillTimer();
    console.log(`[STAR-CITIZEN] fabric peer listening on ${peer.settings.port} (id ${String(peer.key.pubkey).slice(0, 12)}…)`);
    try { this.publishContract(); } catch (_) { /* best-effort */ }
    this.fillPeerSlots();
    // Opt-in only: do not force on start (broadcastPeering must be on).
    this.maybePublishPeeringOffer();
    return this;
  }

  _startSlotFillTimer () {
    if (this._slotFillTimer) return;
    this._slotFillTimer = setInterval(() => {
      try {
        this.fillPeerSlots();
        this.maybePublishPeeringOffer();
      } catch (e) {
        this.emit('warning', `slot fill: ${(e && e.message) || e}`);
      }
    }, 20000);
    if (this._slotFillTimer.unref) this._slotFillTimer.unref();
  }

  _stopSlotFillTimer () {
    if (this._slotFillTimer) {
      clearInterval(this._slotFillTimer);
      this._slotFillTimer = null;
    }
  }

  _peerDialOpts () {
    return {
      listenPort: Number(this.settings.port) || 7777,
      advertiseHost: this.settings.advertiseHost || null,
      ownHosts: this.settings.ownHosts
    };
  }

  _canonicalizeDial (address) {
    return canonicalizeFabricPeerDial(address, this._peerDialOpts());
  }

  /**
   * Core Peer enqueues gossip itself; wrap so stale `:7778` hubs and self IPs never queue.
   * @param {object} peer
   * @returns {void}
   */
  _wrapPeeringCandidateEnqueue (peer) {
    if (!peer || typeof peer._enqueuePeeringCandidate !== 'function') return;
    if (peer._fabricCanonicalEnqueue) return;
    const orig = peer._enqueuePeeringCandidate.bind(peer);
    const self = this;
    peer._enqueuePeeringCandidate = function (host, port, meta) {
      const next = self._canonicalizeDial(`${host}:${port}`);
      if (!next) return;
      const parts = splitFabricHostPort(next);
      return orig(parts.host, parts.port, meta);
    };
    peer._fabricCanonicalEnqueue = true;
  }

  /**
   * Drop or rewrite candidates already sitting in the Peer queue (peersDb / gossip).
   * @param {object} peer
   * @returns {void}
   */
  _sanitizePeerCandidates (peer) {
    if (!peer || !Array.isArray(peer.candidates)) return;
    const kept = [];
    const keys = new Set();
    for (const c of peer.candidates) {
      const host = c && (c.object ? c.object.host : c.host);
      const port = c && (c.object ? c.object.port : c.port);
      const next = this._canonicalizeDial(`${host}:${port}`);
      if (!next) continue;
      const parts = splitFabricHostPort(next);
      const key = `${parts.host}:${parts.port}`;
      if (keys.has(key)) continue;
      keys.add(key);
      if (c.object) {
        c.object.host = parts.host;
        c.object.port = parts.port;
      } else {
        c.host = parts.host;
        c.port = parts.port;
      }
      kept.push(c);
    }
    peer.candidates = kept;
    if (peer._candidateKeys && typeof peer._candidateKeys.clear === 'function') {
      peer._candidateKeys.clear();
      for (const k of keys) peer._candidateKeys.add(k);
    }
  }

  /**
   * Enqueue host:port from offer/gossip and dial open slots.
   * @param {Object} ev
   * @param {object} [ev.message]
   * @param {'offer'|'gossip'} kind
   */
  _ingestPeeringEvent (ev, kind) {
    const message = ev && ev.message;
    const object = (message && (message.object || message)) || {};
    const offerPubkey = object.pubkey
      ? String(object.pubkey).trim().toLowerCase()
      : (message && message.actor && (message.actor.pubkey || message.actor.publicKey || message.actor.id))
        ? String(message.actor.pubkey || message.actor.publicKey || message.actor.id).trim().toLowerCase()
        : null;
    const myPubkey = this._identity && this._identity.pubkey
      ? String(this._identity.pubkey).trim().toLowerCase().replace(/^0[23]/, '')
      : null;
    const offerPkNorm = offerPubkey
      ? offerPubkey.replace(/^0[23]/, '')
      : null;
    // Pre-dial: peering/gossip already named our key — do not enqueue.
    if (myPubkey && offerPkNorm && myPubkey === offerPkNorm) {
      this.emit('warning',
        `[STAR-CITIZEN] ignoring ${kind} peering candidate: advertised pubkey is our own`);
      this.emit('peer:self', {
        address: object.host && object.port ? `${object.host}:${object.port}` : null,
        reason: `${kind} pubkey is own Fabric key`
      });
      return;
    }
    const addrs = peeringAddressesFromObject(object).map((addr) => {
      return this._canonicalizeDial(addr);
    }).filter(Boolean).filter((addr) => {
      if (isLoopbackFabricAddress(addr) && !this.settings.allowLoopbackDiscovery) return false;
      return true;
    });
    for (const addr of addrs) {
      const [host, port] = String(addr).split(':');
      if (this._peer && typeof this._peer._enqueuePeeringCandidate === 'function') {
        try {
          this._peer._enqueuePeeringCandidate(host, Number(port), { pubkey: offerPubkey });
        } catch (_) { /* ignore */ }
      }
    }
    this.fillPeerSlots();
    if (addrs.length) {
      const payload = {
        addresses: addrs,
        kind,
        origin: ev && ev.origin,
        pubkey: offerPubkey,
        peering: object.peering ? String(object.peering).trim() : null
      };
      this.emit('peeringCandidate', payload);
      this._forward('onPeeringCandidate', payload);
    }
  }

  /**
   * Dial queued peering candidates into open connection slots.
   * @returns {number} remaining candidate count
   */
  fillPeerSlots () {
    const peer = this._peer;
    if (!peer || typeof peer._fillPeerSlots !== 'function') return 0;
    this._sanitizePeerCandidates(peer);
    try { peer._fillPeerSlots(); } catch (e) {
      this.emit('warning', `fillPeerSlots: ${(e && e.message) || e}`);
    }
    return Array.isArray(peer.candidates) ? peer.candidates.length : 0;
  }

  /**
   * When under capacity and advertise host + opt-in broadcast are set, publish
   * P2P_PEERING_OFFER so hubs / peers can gossip this node into open slots.
   * @param {Object} [opts]
   * @param {boolean} [opts.force] Skip throttle; still requires advertise host.
   *   When force=true, skips broadcastPeering gate (Announce now).
   */
  maybePublishPeeringOffer (opts = {}) {
    if (!this.ready) return null;
    const host = this.settings.advertiseHost
      ? String(this.settings.advertiseHost).trim()
      : '';
    if (!host || isLoopbackFabricAddress(`${host}:1`)) return null;
    if (!opts.force && this.settings.broadcastPeering !== true) return null;
    const connCount = Object.keys(this._peer.connections || {}).length;
    const maxPeers = Number(this.settings.maxPeers) > 0
      ? Number(this.settings.maxPeers)
      : DEFAULT_MAX_PEERS;
    if (connCount >= maxPeers || connCount === 0) return null;
    const now = Date.now();
    if (!opts.force && (now - (this._lastPeeringOfferAt || 0)) < 30000) return null;
    this._lastPeeringOfferAt = now;
    const port = Number(this._peer.settings.port) || Number(this.settings.port) || 7777;
    const pubkey = this._identity && this._identity.pubkey
      ? String(this._identity.pubkey).trim().toLowerCase()
      : '';
    const dial = peeringInfoForGoonCitizen({
      pubkey,
      advertiseHost: host,
      listenPort: port
    });
    const payload = {
      type: 'P2P_PEERING_OFFER',
      actor: { id: pubkey || (this._identity && this._identity.pubkey) },
      object: {
        slots: Math.max(1, maxPeers - connCount),
        transport: 'fabric',
        host,
        port,
        pubkey: pubkey || undefined,
        peering: dial.string || undefined,
        rendezvous: { hubs: DEFAULT_SEEDS.slice() }
      }
    };
    try {
      return this._signAndRelay('P2P_PEERING_OFFER', payload);
    } catch (e) {
      this.emit('warning', `peering offer: ${(e && e.message) || e}`);
      return null;
    }
  }

  /**
   * Force one P2P_PEERING_OFFER (Announce now). Requires advertise host.
   * @param {Object} [opts]
   * @param {boolean} [opts.force=true]
   */
  publishPeeringOffer (opts = {}) {
    return this.maybePublishPeeringOffer(Object.assign({ force: true }, opts));
  }

  setAdvertiseHost (host) {
    this.settings.advertiseHost = host || null;
  }

  setBroadcastPeering (on) {
    this.settings.broadcastPeering = on === true;
  }

  async stop () {
    this._stopSlotFillTimer();
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

  publishContract () {
    if (!this.ready) return null;
    return this._signAndRelay(OUTER.CONTRACT_PUBLISH, gooncitizenContractDefinition());
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
    return this._signAndRelay(OUTER.CONTRACT_PUBLISH, definition);
  }

  /**
   * Publish a chat record as first-class `P2P_CHAT_MESSAGE` (global only on
   * the LiveRelay path; group chat uses {@link #publishGroupChat}).
   * Wire body = raw UTF-8 message text only (no JSON / handle). Author is AMP signature.
   * @param {Object} record ChatManager record
   */
  publishChat (record) {
    if (!record || !record.body || !record.author) throw new Error('chat record required');
    const pubkey = this._identity && this._identity.pubkey;
    // ChatManager stores canonical x-only authors; identity.pubkey is often compressed.
    const { pubkeysMatch } = require('../functions/identity');
    if (pubkey && !pubkeysMatch(record.author, pubkey)) {
      throw new Error('chat author must be local identity');
    }
    return this._signAndRelay(OUTER.P2P_CHAT_MESSAGE, String(record.body));
  }

  /**
   * Broadcast personal nickname as first-class `P2P_PEER_ALIAS` (UTF-8 body).
   * @param {string} nickname
   */
  publishPeerAlias (nickname) {
    const name = String(nickname || '').trim().slice(0, 64);
    if (!name) return null;
    const peer = this._peer;
    if (peer && typeof peer._announceAlias === 'function') {
      peer._announceAlias(name);
      return true;
    }
    return this._signAndRelay('P2P_PEER_ALIAS', name);
  }

  /**
   * Broadcast local social profile under the GoonCitizen contract namespace.
   * @param {object} profile from {@link buildLocalProfile}
   */
  publishPeerProfile (profile) {
    if (!profile || typeof profile !== 'object') return null;
    return this._publishContractMessage(gooncitizenContractId(), PEER_PROFILE_TYPE, {
      nickname: profile.nickname || null,
      bio: profile.bio || null,
      scHandle: profile.scHandle || null,
      updatedAt: profile.updatedAt || new Date().toISOString()
    });
  }

  /**
   * Broadcast a personal Starjump fleet under the GoonCitizen contract.
   * @param {object} shareObject from {@link buildFleetShareObject}
   */
  publishFleetShare (shareObject) {
    if (!shareObject || typeof shareObject !== 'object') throw new Error('FleetShare object required');
    return this._publishContractMessage(gooncitizenContractId(), FLEET_SHARE_TYPE, shareObject);
  }

  /**
   * Broadcast local online presence + current ship under the GoonCitizen contract.
   * @param {object} presenceObject from {@link buildPresenceShareObject}
   */
  publishPeerPresence (presenceObject) {
    if (!presenceObject || typeof presenceObject !== 'object') return null;
    return this._publishContractMessage(gooncitizenContractId(), PRESENCE_TYPE, presenceObject);
  }

  /**
   * Publish a 1:1 DirectChat under the GoonCitizen contract namespace.
   * @param {Object} payload DirectChat fields (`channel`, `peerA`, `peerB`, `author`, `body`, optional `handle` / `ts` / `id`).
   */
  publishDirectChat (payload) {
    if (!payload || !payload.body || !payload.author || !payload.channel) {
      throw new Error('DirectChat payload required');
    }
    return this._publishContractMessage(gooncitizenContractId(), 'DirectChat', Object.assign({}, payload));
  }

  /**
   * Publish an identity note share or update under the GoonCitizen namespace.
   * @param {Object} payload NoteShare / NoteUpdate fields
   */
  publishNoteShare (payload) {
    const type = (payload && (payload.type || payload['@type'])) ||
      CONTRACT_BODY_TYPES.NoteShare || 'NoteShare';
    return this._publishContractMessage(gooncitizenContractId(), type, Object.assign({}, payload));
  }

  /**
   * Gossip an IdentityCrossSign / IdentityCrossSignRevoke under GoonCitizen.
   * @param {Object} payload verified-ready body from signCrossSign
   */
  publishIdentityCrossSign (payload) {
    const type = (payload && (payload.type || payload['@type'])) ||
      CONTRACT_BODY_TYPES.IdentityCrossSign || 'IdentityCrossSign';
    return this._publishContractMessage(gooncitizenContractId(), type, Object.assign({}, payload));
  }

  /**
   * Publish pack-typed group data on a Federation contract (chat catalogs /
   * messages, opt-in play times; unknown packs are dropped by receivers).
   * @param {string} contractId
   * @param {Object} payload GroupDataShare fields
   */
  publishGroupDataShare (contractId, payload) {
    const type = CONTRACT_BODY_TYPES.GroupDataShare || 'GroupDataShare';
    return this._publishContractMessage(contractId, type, Object.assign({
      type,
      '@type': type
    }, payload || {}));
  }

  /**
   * Publish a compact Discord guild catalog under a Group Federation contract.
   * Wraps into GroupDataShare (legacy DiscordCatalogShare type is still ingested).
   * @param {string} contractId
   * @param {Object} payload DiscordCatalogShare or GroupDataShare fields
   */
  publishDiscordCatalogShare (contractId, payload) {
    const groupDataSync = require('../functions/groupDataSync');
    const wrapped = groupDataSync.sanitizeShare(payload) ||
      groupDataSync.buildShare({
        groupId: payload && payload.groupId,
        sourceAppId: payload && payload.sourceAppId,
        observedAt: payload && payload.observedAt,
        truncated: payload && payload.truncated,
        packs: [{
          pack: groupDataSync.PACK_DISCORD_CATALOG,
          truncated: payload && payload.truncated,
          payload: { guilds: (payload && payload.guilds) || [] }
        }]
      });
    if (!wrapped) return null;
    return this.publishGroupDataShare(contractId, wrapped);
  }

  /**
   * Look up a peer registry entry by Fabric address (best-effort).
   * @param {string} address
   * @returns {{ id: string|null, alias: string|null, nickname: string|null, address: string|null }|null}
   */
  lookupPeerRegistry (address) {
    const peer = this._peer;
    if (!peer || !address) return null;
    const registry = (peer._state && peer._state.peers) || {};
    const addr = String(address).toLowerCase();
    for (const [id, row] of Object.entries(registry)) {
      if (!row || typeof row !== 'object') continue;
      const rowAddr = String(row.address || '').toLowerCase();
      if (rowAddr && FabricNetwork.connectionMatchesAddress(rowAddr, addr)) {
        return {
          id: row.id || id,
          alias: row.alias || row.nickname || null,
          nickname: row.nickname || row.alias || null,
          address: row.address || null
        };
      }
      if (String(id).toLowerCase() === addr) {
        return {
          id,
          alias: row.alias || row.nickname || null,
          nickname: row.nickname || row.alias || null,
          address: row.address || null
        };
      }
    }
    return null;
  }

  publishMissionCreated (payload) {
    return this._publishContractMessage(gooncitizenContractId(), 'MissionCreated', Object.assign({}, payload));
  }

  publishMissionBroadcast (payload) {
    return this._publishContractMessage(gooncitizenContractId(), 'MissionBroadcast', Object.assign({}, payload));
  }

  publishMissionClaim (payload) {
    const type = CONTRACT_BODY_TYPES.MissionClaim || 'MissionClaim';
    return this._publishContractMessage(gooncitizenContractId(), type, Object.assign({}, payload));
  }

  publishMissionClaimDecision (payload) {
    const type = CONTRACT_BODY_TYPES.MissionClaimDecision || 'MissionClaimDecision';
    return this._publishContractMessage(gooncitizenContractId(), type, Object.assign({}, payload));
  }

  /**
   * Discord bot coordination — inbound user request (GoonCitizen namespace).
   * @param {Object} payload DiscordRequest object
   */
  publishDiscordRequest (payload) {
    const type = CONTRACT_BODY_TYPES.DiscordRequest || 'DiscordRequest';
    return this._publishContractMessage(gooncitizenContractId(), type, Object.assign({}, payload));
  }

  /**
   * Discord bot coordination — exclusive claim (first-wins).
   * @param {Object} payload DiscordClaim object
   */
  publishDiscordClaim (payload) {
    const type = CONTRACT_BODY_TYPES.DiscordClaim || 'DiscordClaim';
    return this._publishContractMessage(gooncitizenContractId(), type, Object.assign({}, payload));
  }

  /**
   * Discord bot coordination — handler outcome / Discord reply record.
   * @param {Object} payload DiscordResponse object
   */
  publishDiscordResponse (payload) {
    const type = CONTRACT_BODY_TYPES.DiscordResponse || 'DiscordResponse';
    return this._publishContractMessage(gooncitizenContractId(), type, Object.assign({}, payload));
  }

  /**
   * Chat `/lookup` coordination — public listing query (GoonCitizen namespace).
   * @param {Object} payload LookupRequest object
   */
  publishLookupRequest (payload) {
    const type = CONTRACT_BODY_TYPES.LookupRequest || 'LookupRequest';
    return this._publishContractMessage(gooncitizenContractId(), type, Object.assign({}, payload));
  }

  /**
   * Chat `/lookup` — exclusive claim (first-wins).
   * @param {Object} payload LookupClaim object
   */
  publishLookupClaim (payload) {
    const type = CONTRACT_BODY_TYPES.LookupClaim || 'LookupClaim';
    return this._publishContractMessage(gooncitizenContractId(), type, Object.assign({}, payload));
  }

  /**
   * Chat `/lookup` — winner's reply payload.
   * @param {Object} payload LookupResponse object
   */
  publishLookupResponse (payload) {
    const type = CONTRACT_BODY_TYPES.LookupResponse || 'LookupResponse';
    return this._publishContractMessage(gooncitizenContractId(), type, Object.assign({}, payload));
  }

  publishEventBatch (events, sentAt = new Date().toISOString(), opts = {}) {
    if (!Array.isArray(events) || !events.length) return null;
    return this._publishContractMessage(gooncitizenContractId(), 'SCEventBatch', { events, sentAt }, opts);
  }

  /**
   * Publish a compact cumulative game-state snapshot for Hub sidechain sync.
   * @param {Object} snapshot from functions/gooncitizenGameState.buildGameStateSnapshot
   * @param {Object} [opts] Optional Fabric addresses; omit to broadcast
   * @param {string[]} [opts.to]
   */
  publishGameStateSnapshot (snapshot, opts = {}) {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('GameStateSnapshot required');
    return this._publishContractMessage(gooncitizenContractId(), 'GameStateSnapshot', Object.assign({}, snapshot), opts);
  }

  /**
   * @param {string} contractId Group Federation contract id
   * @param {Object} payload GroupChat object
   */
  publishGroupChat (contractId, payload) {
    return this._publishContractMessage(contractId, 'GroupChat', Object.assign({}, payload));
  }

  /**
   * Phase-1 delivery ACK — Fabric CONTRACT_MESSAGE under the group contract.
   * @param {string} contractId
   * @param {Object} payload { messageId, receivedAt?, chatMessageId? }
   */
  publishMessageReceived (contractId, payload) {
    const type = CONTRACT_BODY_TYPES.MessageReceived || 'MessageReceived';
    return this._publishContractMessage(contractId, type, Object.assign({
      type,
      receivedAt: new Date().toISOString()
    }, payload || {}));
  }

  /**
   * Phase-2 delivery receipt — Fabric CONTRACT_MESSAGE (stored + relayed like GroupChat).
   * @param {string} contractId
   * @param {Object} payload { messageId, receiptAt?, receiptSig?, chatMessageId? }
   * @param {Object} [opts] forwarded to `_publishContractMessage` / `_signAndRelay`
   * @param {boolean} [opts.relay]
   */
  publishMessageReceipt (contractId, payload, opts = {}) {
    const type = CONTRACT_BODY_TYPES.MessageReceipt || 'MessageReceipt';
    return this._publishContractMessage(contractId, type, Object.assign({
      type,
      receiptAt: new Date().toISOString()
    }, payload || {}), opts);
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
   * @param {Object} payload GroupChangeProposal object
   */
  publishGroupChangeProposal (contractId, payload) {
    const type = CONTRACT_BODY_TYPES.GroupChangeProposal || 'GroupChangeProposal';
    return this._publishContractMessage(contractId, type, Object.assign({ type }, payload || {}));
  }

  /**
   * @param {string} contractId
   * @param {Object} payload GroupChangeVote object
   */
  publishGroupChangeVote (contractId, payload) {
    const type = CONTRACT_BODY_TYPES.GroupChangeVote || 'GroupChangeVote';
    return this._publishContractMessage(contractId, type, Object.assign({ type }, payload || {}));
  }

  /**
   * Request missing Statechain journal rows from peers that know this contract.
   * @param {string} contractId
   * @param {Object} [opts]
   * @param {number} [opts.fromClock]
   * @param {string} [opts.groupId]
   */
  publishGroupJournalRequest (contractId, opts = {}) {
    const type = CONTRACT_BODY_TYPES.GroupJournalRequest || 'GroupJournalRequest';
    return this._publishContractMessage(contractId, type, {
      type,
      v: 1,
      contractId: String(contractId),
      groupId: opts.groupId || null,
      fromClock: Math.max(0, Number(opts.fromClock) || 0),
      requestedAt: new Date().toISOString()
    });
  }

  /**
   * Reply with replayable journal entries + tip Schnorr signatures.
   * @param {string} contractId
   * @param {object} batch GroupJournalBatch body
   */
  publishGroupJournalBatch (contractId, batch) {
    const type = CONTRACT_BODY_TYPES.GroupJournalBatch || 'GroupJournalBatch';
    return this._publishContractMessage(
      contractId,
      type,
      Object.assign({ type, v: 1 }, batch || {})
    );
  }

  /**
   * Publish a tip attestation (stateDigest + member Schnorr signatures).
   * @param {string} contractId
   * @param {object} tip GroupStateJournal body
   */
  publishGroupStateJournal (contractId, tip) {
    const type = CONTRACT_BODY_TYPES.GroupStateJournal || 'GroupStateJournal';
    return this._publishContractMessage(
      contractId,
      type,
      Object.assign({ type, v: 1 }, tip || {})
    );
  }

  /**
   * @param {string} contractId
   * @param {Object} payload GroupShare object `{ kind, object, … }`
   */
  publishGroupShare (contractId, payload) {
    return this._publishContractMessage(contractId, 'GroupShare', Object.assign({}, payload));
  }

  /**
   * Publish a Merkle activity tree into a Group Contract namespace.
   * @param {string} contractId
   * @param {Object} payload GroupActivityTree body (root, digests, counts, …)
   */
  publishGroupActivityTree (contractId, payload) {
    return this._publishContractMessage(contractId, 'GroupActivityTree', Object.assign({}, payload));
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
    return this._signAndRelay(OUTER.CONTRACT_PROPOSAL, payload);
  }

  /**
   * Ask every connected Fabric peer for their published document catalog.
   * Replies arrive as `inventoryResponse` / handler `onInventoryResponse`.
   * @returns {{ requested: number, peers: string[] }}
   */
  requestPeerInventories () {
    const documentOffers = require('../functions/documentOffers');
    return documentOffers.requestConnectedInventories(this._peer);
  }

  /**
   * Reply to `P2P_INVENTORY_REQUEST` with this node's published catalog items.
   * @param {string} originName
   * @param {object[]} items
   * @returns {boolean}
   */
  replyDocumentInventory (originName, items) {
    const documentOffers = require('../functions/documentOffers');
    return documentOffers.replyInventory(this._peer, originName, items);
  }

  _publishContractMessage (contractId, type, object, opts = {}) {
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
    // Legacy callers expected peer ready; keep that guard when relaying.
    if (opts.relay !== false && !this.ready) {
      this._requireReady();
    }
    return this._signAndRelay(OUTER.CONTRACT_MESSAGE, body, opts);
  }
}

FabricNetwork.APP_RELAY_TYPES = APP_RELAY_TYPES;
FabricNetwork.isKnownAppRelayType = isKnownAppRelayType;
FabricNetwork.GROUP_MESSAGE_TYPES = GROUP_MESSAGE_TYPES;
FabricNetwork.peersDbPath = function peersDbPath (settingsDir) {
  if (!settingsDir) return null;
  return path.join(settingsDir, 'peers');
};

module.exports = FabricNetwork;
