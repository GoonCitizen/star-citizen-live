'use strict';

/**
 * Star Citizen Live — LiveRelay (dashboard, register, Fabric Peer ingest).
 *
 * Entry: `scripts/node.js` (`npm start`). Desktop: `main.js`.
 * Game.log is read-only. Fabric git deps are required (`npm i`).
 *
 * Features: collections, REST, live log tail (read-only) and offline replay,
 * Game.log parsing (`functions/parser.js`), optional Discord, missions/groups/
 * chat, and a Fabric Peer (D-009 / D-010).
 *
 * It edits NOTHING in the Star Citizen installation — the log is only ever read.
 */

const http = require('http');
const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { parseLine, RULES, shipName, parseSessionInfo, missionType, isNPC, missionFaction } = require('../functions/parser');
const { channelFromPath } = require('../functions/locate');
const settingsStore = require('../functions/settingsStore');
const { isHttpSharedModeEnabled, resolveHttpListenHost } = require('../functions/httpSharedMode');
const { shouldEnforceRemoteAuth } = require('../functions/httpRemoteAuth');
const { httpBindWarning } = require('../functions/httpBindWarning');
const { applyGoonCitizenEnvAliases } = require('../functions/goonCitizenEnvAliases');

/** Hosted / site-login Bearer session lifetime (ms). */
const BEARER_TTL_MS = 8 * 60 * 60 * 1000;
let resolveFabricPeerInterface;
try {
  ({ resolveFabricPeerInterface } = require('@fabric/core/functions/fabricListenInterface'));
} catch (_) {
  resolveFabricPeerInterface = function resolveFabricPeerInterfaceFallback (opts = {}) {
    const env = opts.env || process.env;
    for (const key of ['FABRIC_INTERFACE', 'FABRIC_PEER_INTERFACE']) {
      const v = String(env[key] || '').trim();
      if (v) return v;
    }
    const explicit = String(opts.interface || opts.host || '').trim();
    if (explicit) return explicit;
    return opts.fallback != null ? String(opts.fallback) : '0.0.0.0';
  };
}
const cumulativeHistory = require('../functions/cumulativeHistory');
const gameLogMissionRegister = require('../functions/gameLogMissionRegister');
const logCorpus = require('../functions/logCorpus');
const fsBrowser = require('../functions/fsBrowser');
const activityTree = require('../functions/activityTree');
const gooncitizenGameState = require('../functions/gooncitizenGameState');
const eventChain = require('../functions/eventChain');
const peerProfile = require('../functions/peerProfile');
const hubBitcoinProxy = require('../functions/hubBitcoinProxy');
const discordConfig = require('../functions/discordConfig');
const discordContract = require('../functions/discordContract');
const discordGuildCatalog = require('../functions/discordGuildCatalog');
const discordCatalogAccumulate = require('../functions/discordCatalogAccumulate');
const groupDataSync = require('../functions/groupDataSync');
const profilePlaytimes = require('../functions/profilePlaytimes');
const profileFiles = require('../functions/profileFiles');
const profileNotes = require('../functions/profileNotes');
const chatPlatform = require('../functions/chatPlatform');
const discordIdentityLink = require('../functions/discordIdentityLink');
const discordChatDirection = require('../functions/discordChatDirection');
const chatLookup = require('../functions/chatLookup');
const appSearch = require('../functions/appSearch');
const identityActor = require('../functions/identityActor');
const collectionRecords = require('../functions/collectionRecords');
let FabricDiscord = undefined;
function loadFabricDiscord () {
  if (FabricDiscord !== undefined) return FabricDiscord;
  try {
    FabricDiscord = require('@fabric/discord');
  } catch (_) {
    FabricDiscord = null;
  }
  return FabricDiscord;
}
const hubDocumentExchangeProxy = require('../functions/hubDocumentExchangeProxy');
const localDocuments = require('../functions/localDocuments');
const documentOffers = require('../functions/documentOffers');
const chatChannelList = require('../functions/chatChannelList');
const peerPeeringString = require('../functions/peerPeeringString');
const presence = require('../functions/presence');
const hubPeeringObserve = require('../functions/hubPeeringObserve');
const liveFeed = require('../functions/liveFeed');
const localGroups = require('../functions/localGroups');
const identityNotes = require('../functions/identityNotes');
const deviceDataSync = require('../functions/deviceDataSync');
const clusterSync = require('../functions/clusterSync');
const clusterMesh = require('../functions/clusterMesh');
const clusterDevices = require('../functions/clusterDevices');
const clusterInventory = require('../functions/clusterInventory');
const { listLinkedDevices } = require('../functions/linkedDevices');
const {
  createFabricMessageLog,
  summarizeMessage,
  logFabricSync,
  logFabricWire,
  logFabricPeer
} = require('../functions/fabricMessageLog');
const starjumpFleet = require('../functions/starjumpFleet');
const shipCatalog = require('../functions/shipCatalog');
const locationCatalog = require('../functions/locationCatalog');
const locationReports = require('../functions/locationReports');
const starmapLayout = require('../functions/starmapLayout');
const groupPresence = require('../functions/groupPresence');
const registerInbox = require('../functions/registerInbox');

// Lines worth surfacing in the monitor - combat/death hints AND mission/objective
// activity. Includes wording the parser may not recognize yet, so we can keep
// discovering real SC 4.x formats and promote them to verified rules.
const INTEREST_HINTS = /\b(kill|killed|death|died|destroy|destruct|destruction|incap|corpse|fatal|eject|defeat|defeated|hostile|objective|mission|contract|bounty)\b/i;

// Mission objective text that implies combat progress - our best proxy for kills,
// since SC 4.8.0 does not log NPC ship kills directly. Inferred, not exact.
const COMBAT_OBJECTIVE = /\b(defeat|defeated|destroy|destroyed|eliminate|eliminated|hostile|wave|waves|bounty|kill)\b/i;

function idFor (content) {
  return crypto.createHash('sha256').update(String(content)).digest('hex').slice(0, 32);
}

// Lazy-loaded identity helpers (functions/identity.js pulls in @fabric/core).
// The local relay must still boot with zero external deps when signing is unused.
let _identityLib = null;
function identityLib () {
  if (!_identityLib) _identityLib = require('../functions/identity');
  return _identityLib;
}

// Collections a remote relay may push into via Fabric SCEventBatch (or legacy
// HTTP POST …/events). 'chatmessages' / mission broadcasts also arrive as
// dedicated wire types (P2P_CHAT_MESSAGE / MissionBroadcast).
const INGEST_COLLECTIONS = ['activities', 'players', 'vehicles', 'kills', 'deaths', 'incaps', 'missionlog', 'chatmessages', 'missionbroadcasts'];

// Org Fabric seed peers (host:port). Removable in Peers; empty saved list is kept.
// Both hubs selectively relay relevant Fabric messages for the network.
const DEFAULT_PEERS = [
  { address: 'hub.fabric.pub:7777', label: 'hub.fabric.pub' },
  { address: 'relay.goon.vc:7777', label: 'relay.goon.vc' }
];

const FabricNetwork = require('./FabricNetwork');

class StarCitizenService extends EventEmitter {
  constructor (settings = {}) {
    super();
    // Map legacy SC_* listen/advertise/allowlist env onto FABRIC_* (idempotent).
    applyGoonCitizenEnvAliases(process.env);
    this.settings = Object.assign({
      port: 3041,
      listen: true, // false = embed via apiHandler() on a host HTTP server (goon.vc)
      mode: 'relay', // 'relay' = local log tailing; 'server' = hosted API; 'android' = mobile node (no log, Fabric Peer, loopback HTTP)
      logfile: null,
      channel: null, // SC channel (LIVE/PTU/EPTU/HOTFIX/TECH-PREVIEW) for display
      seed: null,   // optional: replay a past log once on start to pre-fill the monitor
      discord: {
        enable: false,
        token: null,
        webhook: null,
        channel: null,
        app: { id: null, secret: null },
        announceKills: true,
        announcePlayerJoins: true,
        announceActivities: false,
        announceMissions: false,
        announceCombat: false,
        announceIncaps: false
      },
      missions: { enable: true },
      uplink: { intervalMs: 5000 }, // Fabric SCEventBatch flush cadence (HTTPS uplink retired D-010)
      fabric: null, // { enable, listen, port, interface, peers, peersDb, relayAppMessages }
      settingsDir: null, // Hub-style named store root (stores/gooncitizen); register defaults beneath it
      store: null // optional pre-started types/Store instance (Electron main / scripts/node.js)
    }, settings);
    this.settings.discord = Object.assign({
      enable: false,
      token: null,
      webhook: null,
      channel: null,
      app: { id: null, secret: null },
      announceKills: true,
      announcePlayerJoins: true,
      announceActivities: false,
      announceMissions: false,
      announceCombat: false,
      announceIncaps: false
    }, settings.discord || {});
    if (settings.discord && settings.discord.app) {
      this.settings.discord.app = Object.assign(
        { id: null, secret: null },
        settings.discord.app
      );
    }
    /** Discord bot instance (`@fabric/discord`), or null. */
    this.discordBot = null;
    this._discordBotReady = false;
    /** Cached guild/channel/user catalog from the live bot (TTL refresh). */
    this._discordCatalogCache = { at: 0, data: null, inflight: null };
    this._discordCatalogTtlMs = 30 * 1000;
    /** Per-channel recent messages + roster (short TTL). */
    this._discordChannelInsightCache = new Map();
    this._discordInsightTtlMs = 8 * 1000;
    /** Discord user id ↔ Fabric pubkey mappings (persisted). */
    this._discordIdentityLinks = [];
    /** One-time !link codes keyed by uppercase code. */
    this._discordLinkChallenges = new Map();
    /** Discord Request→Claim→Response journal (auditors / View tree). */
    this._discordCoord = discordContract.createDiscordCoordJournal({ capacity: 800 });
    /** @type {Map<string, object>} */
    this._discordClaimPending = new Map();
    /** Settle window after claim before executing Discord reply (ms). */
    this._discordClaimSettleMs = 450;
    /** Chat `/lookup` Request→Claim→Response journal. */
    this._lookupCoord = chatLookup.createLookupCoordJournal({ capacity: 400 });
    /** @type {Map<string, object>} */
    this._lookupClaimPending = new Map();
    /** Short settle — local catalog query is sync; first claim wins. */
    this._lookupClaimSettleMs = 80;
    this.settings.uplink = Object.assign({ intervalMs: 5000 }, settings.uplink || {});
    delete this.settings.uplink.url;
    delete this.settings.uplink.enable;
    // Fabric Peer (TCP/NOISE). Off under NODE_ENV=test unless explicitly enabled.
    // Hosted `SC_MODE=server` also runs a Peer when settings.fabric.enable is
    // true (public seeds such as relay.goon.vc — see docs/PRODUCTION.md).
    const fabricDefaults = {
      enable: this.settings.mode !== 'server' && process.env.NODE_ENV !== 'test',
      listen: true,
      port: (() => {
        const n = Number(process.env.FABRIC_PORT);
        return Number.isFinite(n) && n > 0 ? n : 7777;
      })(),
      // Peer bind: FABRIC_INTERFACE / FABRIC_PEER_INTERFACE (e.g. 65.21.231.149 for relay.goon.vc).
      interface: resolveFabricPeerInterface({
        interface: settings.fabric && settings.fabric.interface,
        env: process.env
      }),
      peers: null, // null → use operator peer roster
      peersDb: null,
      relayAppMessages: false
    };
    this.settings.fabric = Object.assign(fabricDefaults, settings.fabric || {});
    // Signed ingest is mandatory in server mode when HTTP ingest is enabled.
    // HTTP batch ingest is OFF by default — Fabric Peer is the production sync
    // path (D-010). Opt in with ingest.httpEnable or SC_HTTP_INGEST=1 (tests/legacy).
    this.settings.ingest = Object.assign({
      requireSigned: this.settings.mode === 'server',
      httpEnable: false
    }, settings.ingest || {});
    const httpIngestEnv = String(process.env.SC_HTTP_INGEST || '').trim().toLowerCase();
    if (httpIngestEnv === '1' || httpIngestEnv === 'true' || httpIngestEnv === 'yes' || httpIngestEnv === 'on') {
      this.settings.ingest.httpEnable = true;
    }

    this.state = { status: 'STOPPED', activities: {}, players: {}, logins: {}, vehicles: {}, kills: {}, incaps: {}, deaths: {}, missionlog: {}, notifications: {}, missionbroadcasts: {}, logs: {}, startedAt: null };
    this.state.missionGroups = {};  // missions grouped by MissionId (built from the log)
    this.state.objectives = {};     // objective details keyed by ObjectiveId
    this.state.combatlog = {};      // combat progress inferred from mission objectives
    this.recent = [];   // rolling buffer of the latest lines (for the live monitor)
    this.flagged = [];  // lines matching INTEREST_HINTS - combat/mission candidates
    this.channel = this.settings.channel || channelFromPath(this.settings.logfile); // LIVE/HOTFIX/...
    this.session = {};  // build + hardware of the current game session
    this.sessions = []; // history of game sessions (one per launch detected)
    this._sessionHandle = null; // the session's player handle (for attributing incaps)
    this._nickname = null; // operator display name for chat (from settings.nickname)
    /** Local social profile (`bio`, `scHandle`). */
    /** @type {Object|null} */
    this._profile = null;
    /** public hostname for dial pin / P2P_PEERING_OFFER (optional) */
    this._fabricAdvertiseHost = null;
    /** Opt-in mesh announce of open peer slots (P2P_PEERING_OFFER). */
    this._broadcastPeering = false;
    /** Mesh P2P_PEER_ALIAS by author pubkey. */
    /** @type {Object.<string, string>} */
    this._peerAliasByPubkey = Object.create(null);
    /** PeerProfile cache by pubkey. */
    /** @type {Object.<string, Object>} */
    this._peerProfilesByPubkey = Object.create(null);
    /** PeerPresence cache by pubkey. */
    /** @type {Object.<string, Object>} */
    this._peerPresenceByPubkey = Object.create(null);
    /** ISO timestamp of the last parsed Game.log event (online window). */
    this._lastLogEventAt = null;
    /** Autodetected ship from Game.log (`classId`, `vehicleId`, `name`, `slug`, `at`). */
    /** @type {Object|null} */
    this._detectedShip = null;
    /** Manual ship override (`slug`, `name`, `at`). */
    /** @type {Object|null} */
    this._shipOverride = null;
    this._sharePresence = false;
    this._presenceVisibility = 'private';
    this._presenceGroupIds = [];
    this._shipOverrideSlug = null;
    this._detectedLocation = null;
    this._detectedDestination = null;
    this._locationOverride = null;
    this._locationOverrideSlug = null;
    this._destinationOverride = null;
    this._destinationOverrideSlug = null;
    this._presenceAvailability = 'auto';
    this._presenceStatusText = null;
    this._lastPresencePublish = 0;
    /** Preferred group id for the desktop member/ship overlay. */
    this._primaryGroupId = null;
    /** Opt-in always-on-top overlay window (Electron). */
    this._groupOverlay = false;
    /** Opaque Share clipboard encoding: `'base64'` (default) or `'hex'`. */
    this._fabricShareEncoding = 'base64';
    /** Gossip Discord/chat catalog packs to Federation groups (default off). */
    this._shareDiscordCatalog = false;
    /** Opt-in common play times pack on own profile (default off). */
    this._sharePlaytimes = false;
    /** Opt-in published file listing pack on own profile (default off). */
    this._shareFiles = false;
    /** Last GroupDataShare publish (ms). */
    this._discordCatalogShareAt = 0;
    this._discordCatalogShareAt = 0;
    this._discordCatalogShareMinMs = 5 * 60 * 1000;
    /** Raw defaultGroupMessageId from settings/local.js (for Settings UI hint). */
    this._defaultGroupMessageId = null;
    /** Last nickname announced on the mesh (dedupe ensure → alias spam). */
    this._lastPublishedAlias = null;
    /** Cached Hub / WebRTC observe snapshot. */
    /** @type {Object|null} */
    this._hubObserve = null;
    this._hubObserveTimer = null;
    this._hubObserveInflight = null;
    this._clusterMeshTimer = null;
    this._clusterMeshInflight = null;
    this._clusterMesh = { registered: [], discovered: [], errors: [], at: 0 };
    /** Max auto-rostered non-hub peers from gossip/offer. */
    this._maxDiscoveredPeers = 12;
    /** @type {Promise|null} */
    this._fabricEnsureInflight = null;
    this._seq = 0;
    this._shareLogsGlobal = false;
    /** Seal outbound GroupChat with tip-bound AES-GCM (default off; plaintext still accepted). */
    this._groupChatSeal = false;
    /** Drop inbound GroupChat that lacks a decryptable seal. */
    this._requireSealedGroupChat = false;
    /** LAN opt-in for dashboard HTTP (`0.0.0.0`); default loopback. */
    this._httpSharedMode = isHttpSharedModeEnabled(this.settings.httpSharedMode);
    this._pos = 0;      // byte offset consumed by the live poller
    this._partial = ''; // trailing incomplete line between polls
    this._ino = null;   // file identity, to detect log recreation (restart)
    this._pollTimer = null;
    this.server = null;
    this._identity = null;      // decrypted player identity (uplink signing)
    this._uplinkQueue = [];     // events awaiting signed push to the uplink
    this._uplinkTimer = null;
    this._uplinkWired = false;

    // Peers: Fabric `host:port` addresses (seed hub.fabric.pub + relay.goon.vc).
    // Loaded from the Fabric Store in start(); managed via REST / Peers UI.
    this.peers = [];
    this.fabricNetwork = null;
    /** In-memory Fabric AMP Message ring buffer (advanced UI; not Game.log). */
    this._fabricMessageLog = createFabricMessageLog({ capacity: 500 });

    // Safety net: a stray 'error' (e.g. the game rotating Game.log) must never
    // crash the process. Without a listener, EventEmitter throws on 'error'.
    this._peerDialErrorLogAt = new Map();
    this.on('error', (e) => {
      const msg = (e && e.message) || String(e);
      if (/ECONNREFUSED|Socket timeout: connect|Socket error:|NOISE (encrypt|decrypt) error/i.test(msg)) {
        const key = String(msg).replace(/\d{1,3}(?:\.\d{1,3}){3}/g, '#').slice(0, 160);
        const now = Date.now();
        const last = this._peerDialErrorLogAt.get(key) || 0;
        if (now - last < 60000) return;
        this._peerDialErrorLogAt.set(key, now);
        if (this._peerDialErrorLogAt.size > 64) this._peerDialErrorLogAt.clear();
        console.warn('[STAR-CITIZEN] peer dial:', msg);
        return;
      }
      console.error('[STAR-CITIZEN] error:', msg);
    });

    const MissionManager = require('../services/MissionManager');
    const GroupManager = require('../services/GroupManager');
    const { Store } = require('../types/Store');

    // Shared Fabric Store — the ONLY internal storage (missions, groups,
    // operator settings). Persists under the Hub-style named store
    // (`stores/gooncitizen/register`) unless overridden. Null → memory (tests).
    // An already-started Store may be injected (Electron main / scripts/node.js).
    if (this.settings.store) {
      this.registerStore = this.settings.store;
      this._loadPersistedSettings(); // injected store is already started
    } else {
      const registerDir = this._resolveRegisterPath();
      this.registerStore = new Store({
        path: registerDir,
        json: this._isAndroidMode()
      });
      if (registerDir) console.log(`[STAR-CITIZEN] register store: ${registerDir}`);
    }

    this.missionManager = (this.settings.missions && this.settings.missions.enable)
      ? new MissionManager(Object.assign({}, this.settings.missions, {
        store: this.registerStore,
        // Hosted API must not run empty-allowlist bootstrap (everyone-is-officer).
        requireOfficers: this.settings.mode === 'server' || this.settings.missions.requireOfficers === true
      }))
      : null;

    // Groups: member-created k-of-n Schnorr multisig units (mission scoping +
    // authority sets). Shares the register Store with missions.
    const groupSettings = Object.assign(
      { enable: true },
      this.settings.groups || {},
      { store: this.registerStore }
    );
    this.groupManager = groupSettings.enable !== false ? new GroupManager(groupSettings) : null;
    if (this.missionManager && this.groupManager) {
      this.missionManager.groupManager = this.groupManager;
      this.missionManager.settings.isGroupMember = (groupId, pubkey) => (
        this.groupManager.isInGroupTree(groupId, pubkey)
      );
    }
    if (this.groupManager) {
      // Federation contract publish + GroupChange fan-out (best-effort).
      this.groupManager.on('group:created', (group, meta) => {
        this._publishGroupContractFor(group, meta && meta.definition).catch((e) => this.emit('error', e));
      });
      this.groupManager.on('group:local-change', (change) => {
        this._publishGroupChange(change).catch((e) => this.emit('error', e));
      });
      this.groupManager.on('group:proposal', (proposal) => {
        this._onLocalGroupProposal(proposal).catch((e) => this.emit('error', e));
      });
      this.groupManager.on('group:vote', (ev) => {
        this._publishGroupChangeVote(ev && ev.proposal, ev && ev.voter).catch((e) => this.emit('error', e));
      });
      this.groupManager.on('group:journal-needed', (ev) => {
        this._requestGroupJournal(ev).catch((e) => this.emit('error', e));
      });
    }
    this._wireRegisterInbox();

    // Chat: Hub-style ChatMessage records — global channel + one per group.
    // Global posts use P2P_CHAT_MESSAGE; group posts use GroupChat CONTRACT_MESSAGE.
    const ChatManager = require('../services/ChatManager');
    this.chatManager = new ChatManager({ store: this.registerStore, groupManager: this.groupManager });

    const IdentityCluster = require('../functions/identityCluster');
    this.identityCluster = new IdentityCluster();
    const sameActor = (a, b) => this.identityCluster.clusterEquals(a, b);
    if (this.groupManager) this.groupManager.sameActor = sameActor;
    if (this.missionManager) this.missionManager.settings.sameActor = sameActor;
    if (this.chatManager) this.chatManager.sameActor = sameActor;
    if (this.chatManager) {
      this.chatManager.on('message', (record) => {
        if (this._applyingDeviceDataShare) return;
        if (record && record.source === 'cluster-sync') return;
        const me = this._identity && this._identity.pubkey;
        if (!me || !this.identityCluster) return;
        const snap = typeof this.identityCluster.snapshot === 'function'
          ? this.identityCluster.snapshot(me)
          : null;
        if (!snap || !snap.members || snap.members.length < 2) return;
        this._scheduleAccountDataReplay({ delay: 1500 });
      });
    }

    // Periodic screen snapshots (opt-in; Electron injects the capture fn via
    // setSnapshotCapture). Images under <store root>/snapshots; metadata in
    // the Fabric Store. Idle in hosted server mode and pure-browser sessions.
    const SnapshotManager = require('../services/SnapshotManager');
    this.snapshotManager = new SnapshotManager({
      store: this.registerStore,
      dir: this.settings.settingsDir ? path.join(this.settings.settingsDir, 'snapshots') : null
    });

    // Bearer sessions issued by POST …/auth (Schnorr login challenge)
    // or by client-signed Fabric site login (POST /sessions/…/signatures).
    this._sessions = {};
    // Pending Fabric site-login challenges (D-011) — Passport / GoonCitizen.
    this._siteLoginSessions = null;

    // Bitcoin payouts: escrow mission rewards in authority multisig addresses.
    // settings.payouts = { enable, network, rpc, allowMainnet, feeSats }.
    this.payoutManager = null;
    if (this.settings.payouts && this.settings.payouts.enable !== false && (this.settings.payouts.rpc || this.settings.payouts.ledger)) {
      const PayoutManager = require('../services/PayoutManager');
      this.payoutManager = new PayoutManager(this.settings.payouts);
      if (this.missionManager) {
        this.payoutManager.attach(this.missionManager, {
          resolveGroupWallet: (groupId) => this._resolveCompletionGroupWallet(groupId)
        });
        this.payoutManager.on('payout:payable', (ev) => {
          const escrow = ev && ev.escrow;
          const missionId = ev && ev.missionId;
          const row = registerInbox.entryFromWalletEvent({
            kind: 'WalletPayout',
            status: 'pending',
            actionable: true,
            title: 'Mission payout unlocked',
            body: escrow && escrow.amountSats != null
              ? `${Number(escrow.amountSats).toLocaleString()} sats ready to pay`
              : 'Escrow is payable',
            source: escrow && escrow.payee,
            refs: {
              missionId,
              claimId: escrow && escrow.claimId,
              groupId: escrow && escrow.completionGroupId,
              payeeKind: escrow && escrow.payeeKind,
              address: escrow && escrow.payeeAddress
            },
            dedupeKey: `wallet-payout-${missionId || ''}-${(escrow && escrow.claimId) || ''}`
          });
          if (row) this._appendInbox(row);
        });
        this.payoutManager.on('payout:paid', (ev) => {
          const escrow = ev && ev.escrow;
          const row = registerInbox.entryFromWalletEvent({
            kind: 'WalletPayout',
            status: 'accepted',
            actionable: false,
            title: 'Mission payout broadcast',
            body: ev && ev.txid ? `txid ${String(ev.txid).slice(0, 16)}…` : 'Payout sent',
            refs: {
              missionId: escrow && escrow.missionId,
              txid: ev && ev.txid,
              groupId: escrow && escrow.completionGroupId
            },
            dedupeKey: `wallet-paid-${(ev && ev.txid) || Date.now()}`
          });
          if (row) this._appendInbox(row);
        });
      }
    }

    // Compact cumulative history (ended missions, deaths, sessions, heat).
    // Durable under settingsDir/history.json; updated on startup sync + live tail.
    this.history = this._loadHistory();
    this._historyIndex = cumulativeHistory.indexHistory(this.history);
    this._logCursors = this._loadLogCursors();
    this._historyDirty = false;
    this._historyFlushTimer = null;
    this._historyApplyLive = false; // true only after startup sync (avoids double heat on seed)
    this._historyGenerators = {}; // missionId → generator (for live mission:end typing)
    // Gossip Chain of Blocks (D-018, consensus=gossip): union-mergeable firehose; history.json remains the fold.
    this.eventChain = eventChain.available
      ? eventChain.fromHistory(this.history, null)
      : null;

    // Deterministic historical re-parse job (oldest log forward). Idle until
    // POST …/reparse; progress + result exposed on the monitor payload.
    this._reparse = { status: 'idle' };

    if (this.settings.discord.enable) this._wireDiscord();
  }

  /**
   * Re-resolve Discord config from Store + secrets file + constructor/local bag.
   * @returns {object}
   */
  _applyDiscordConfig () {
    const persisted = settingsStore.loadSettings(this.registerStore);
    const resolved = discordConfig.resolveDiscordConfig({
      localDiscord: this.settings.discord,
      persisted,
      settingsDir: this.settings.settingsDir,
      env: process.env
    });
    this.settings.discord = Object.assign({}, this.settings.discord, resolved);
    return resolved;
  }

  _discordRuntime () {
    return discordConfig.discordRuntimeSummary(this.settings.discord || {}, {
      botReady: this._discordBotReady === true,
      botUser: (this.discordBot && this.discordBot.client && this.discordBot.client.user)
        ? String(this.discordBot.client.user.tag || this.discordBot.client.user.username || '')
        : null,
      botUserId: (this.discordBot && this.discordBot.client && this.discordBot.client.user &&
        this.discordBot.client.user.id != null)
        ? String(this.discordBot.client.user.id)
        : null
    });
  }

  /** @returns {string|null} */
  _localDiscordBotUserId () {
    const u = this.discordBot && this.discordBot.client && this.discordBot.client.user;
    return u && u.id != null ? String(u.id) : null;
  }

  /**
   * Enumerate guilds, channels, and users from the live `@fabric/discord` client.
   * Fetches from Discord when the cache is stale (or `force` is set), then
   * persists ids via `syncGuilds` when the bot exposes it.
   * @param {Object} [opts]
   * @param {boolean} [opts.force]
   * @returns {Promise<object>}
   */
  async _discordGuildCatalog (opts = {}) {
    const force = opts.force === true;
    const now = Date.now();
    const ready = this._discordBotIsReady();
    if (!force && this._discordCatalogCache.data &&
        this._discordCatalogCache.data.botReady === ready &&
        (now - this._discordCatalogCache.at) < this._discordCatalogTtlMs) {
      return this._discordCatalogCache.data;
    }
    if (this._discordCatalogCache.inflight) {
      return this._discordCatalogCache.inflight;
    }
    const work = this._buildDiscordGuildCatalog();
    this._discordCatalogCache.inflight = work;
    try {
      const data = await work;
      this._discordCatalogCache = { at: Date.now(), data, inflight: null };
      return data;
    } catch (e) {
      this._discordCatalogCache.inflight = null;
      throw e;
    }
  }

  /**
   * @returns {Promise<object>}
   */
  async _buildDiscordGuildCatalog () {
    const runtime = this._discordRuntime();
    const selectedChannelId = (this.settings.discord && this.settings.discord.channel) || null;
    const bot = this.discordBot;
    const client = bot && bot.client ? bot.client : null;
    const botReady = this._discordBotReady === true &&
      !!(client && (typeof client.isReady !== 'function' || client.isReady()));
    let sync = null;
    if (botReady && client) {
      try {
        sync = await discordGuildCatalog.refreshDiscordCaches(client, {
          memberLimit: discordGuildCatalog.DEFAULT_MEMBER_LIMIT
        });
      } catch (e) {
        this.emit('warning', `[discord] cache refresh failed: ${e && e.message ? e.message : e}`);
        sync = {
          ok: false,
          error: e && e.message ? e.message : String(e),
          errors: [{ scope: 'refresh', message: e && e.message ? e.message : String(e) }]
        };
      }
      if (bot && typeof bot.syncGuilds === 'function') {
        try {
          await bot.syncGuilds();
        } catch (e) {
          this.emit('warning', `[discord] syncGuilds failed: ${e && e.message ? e.message : e}`);
        }
      }
    }
    const catalog = discordGuildCatalog.buildDiscordGuildCatalog(client, {
      botReady,
      botUser: runtime.botUser || null,
      botUserId: runtime.botUserId || this._localDiscordBotUserId(),
      selectedChannelId,
      sync,
      memberLimit: discordGuildCatalog.DEFAULT_MEMBER_LIMIT
    });
    catalog.identityLinks = this._listDiscordIdentityLinks();
    if (this.registerStore && catalog.guilds && catalog.guilds.length) {
      try {
        discordCatalogAccumulate.foldGuilds(this.registerStore, catalog.guilds, {
          via: 'bot',
          pubkey: (this._identity && this._identity.pubkey) || null,
          appId: this._discordSourceAppId()
        });
      } catch (e) {
        this.emit('warning', '[LiveRelay] Discord catalog persist failed:', e && e.message);
      }
    }
    const merged = this._mergeDiscordCatalog(catalog);
    this._maybePublishGroupDataShare(merged);
    return merged;
  }

  /** @returns {string|null} */
  _discordSourceAppId () {
    const discord = this.settings && this.settings.discord;
    const id = (discord && discord.app && discord.app.id) || (discord && discord.appId) || null;
    return id != null && String(id).trim() ? String(id).trim() : null;
  }

  /** @returns {boolean} */
  _discordBotIsReady () {
    const client = this.discordBot && this.discordBot.client ? this.discordBot.client : null;
    return this._discordBotReady === true &&
      !!(client && (typeof client.isReady !== 'function' || client.isReady()));
  }

  /**
   * Overlay accumulated Store + gossip onto a live (or empty) Discord catalog.
   * @param {object} live
   * @returns {object}
   */
  _mergeDiscordCatalog (live) {
    if (!this.registerStore) return live;
    try {
      const stats = discordCatalogAccumulate.loadChannelMessageStats(this.registerStore);
      const merged = discordCatalogAccumulate.mergeLiveCatalog(
        Object.assign({}, live || {}, { messageStats: stats }),
        discordCatalogAccumulate.loadAccumulatedGuilds(this.registerStore)
      );
      merged.botReady = this._discordBotIsReady();
      merged.worldView = groupDataSync.composeWorldView({
        catalog: merged,
        messageStats: stats,
        playtimes: profilePlaytimes.loadAllPlaytimes(this.registerStore),
        files: profileFiles.loadAllFiles(this.registerStore),
        notes: profileNotes.loadAllNotes(this.registerStore),
        sourceAppId: this._discordSourceAppId(),
        botReady: merged.botReady === true
      });
      merged.offline = merged.worldView.offline === true;
      return merged;
    } catch (e) {
      this.emit('warning', '[LiveRelay] Discord catalog merge failed:', e && e.message);
      return live;
    }
  }

  /**
   * Re-merge Store rows into the in-memory catalog cache (no Discord fetch).
   */
  _refreshDiscordCatalogFromStore () {
    if (!this._discordCatalogCache || !this._discordCatalogCache.data) return;
    this._discordCatalogCache.data = this._mergeDiscordCatalog(this._discordCatalogCache.data);
  }

  /**
   * Fold a Discord chat author + message into the accumulated catalog.
   * @param {object} request
   */
  _observeDiscordCatalogFromRequest (request) {
    if (!this.registerStore || !request) return;
    try {
      const isDm = request.targetType === 'dm' ||
        request.targetType === 1 ||
        request.targetType === '1';
      discordCatalogAccumulate.foldObservation(this.registerStore, {
        guildId: request.guildId || null,
        channelId: request.channelId || null,
        authorId: request.authorId || null,
        authorUsername: request.authorUsername || null
      }, {
        via: 'message',
        pubkey: (this._identity && this._identity.pubkey) || null,
        appId: request.appId || this._discordSourceAppId()
      });
      if (!isDm && request.channelId) {
        discordCatalogAccumulate.foldMessages(this.registerStore, [{
          discordMessageId: request.discordMessageId,
          channelId: request.channelId,
          guildId: request.guildId || null,
          authorId: request.authorId,
          authorUsername: request.authorUsername,
          body: request.content,
          ts: request.createdAt,
          bot: request.bot === true
        }], {
          via: 'message',
          pubkey: (this._identity && this._identity.pubkey) || null,
          observedAt: request.createdAt
        });
      }
      this._refreshDiscordCatalogFromStore();
    } catch (e) {
      this.emit('warning', '[LiveRelay] Discord catalog observe failed:', e && e.message);
    }
  }

  /**
   * Group-scoped GroupDataShare on Federation contracts: chat catalog/messages
   * (Discord first) plus opt-in profile.playtimes / profile.files. Throttled.
   * @param {object} [catalog]
   */
  _maybePublishDiscordCatalogShare (catalog) {
    return this._maybePublishGroupDataShare(catalog);
  }

  /**
   * Compact local play-times pack when the operator opted in.
   * @returns {object|null}
   */
  _localPlaytimesPayload () {
    if (this._sharePlaytimes !== true) return null;
    const pubkey = this._identity && this._identity.pubkey;
    if (!pubkey) return null;
    try {
      const az = this._analyticsDataset();
      return profilePlaytimes.compactPlaytimesPayload({
        pubkey,
        heatcells: (az && az.heatcells) || []
      });
    } catch (_) {
      return null;
    }
  }

  /**
   * Compact pinned-file listing for GroupDataShare / own profile.
   * @returns {object|null}
   */
  _localFilesPayload () {
    const pubkey = this._identity && this._identity.pubkey;
    if (!pubkey || !this.registerStore) return null;
    try {
      return profileFiles.compactFilesPayload({
        pubkey,
        files: localDocuments.list(this.registerStore),
        pinnedOnly: true
      });
    } catch (_) {
      return null;
    }
  }

  _hasPinnedProfileFiles () {
    if (!this.registerStore) return false;
    try {
      return (localDocuments.list(this.registerStore) || []).some((row) => row && row.profilePinned === true);
    } catch (_) {
      return false;
    }
  }

  /**
   * Compact pinned-note listing for GroupDataShare / own profile.
   * @returns {object|null}
   */
  _localNotesPayload () {
    const pubkey = this._identity && this._identity.pubkey;
    if (!pubkey || !this.registerStore) return null;
    try {
      return profileNotes.compactNotesPayload({
        pubkey,
        notes: identityNotes.listNotes(this.registerStore, {
          author: pubkey,
          includeLocal: true
        }),
        pinnedOnly: true
      });
    } catch (_) {
      return null;
    }
  }

  _hasPinnedProfileNotes () {
    if (!this.registerStore) return false;
    try {
      return identityNotes.listNotes(this.registerStore, { profilePinned: true }).length > 0;
    } catch (_) {
      return false;
    }
  }

  /**
   * Force a GroupDataShare pass (bypass the 5-minute throttle).
   */
  _publishGroupDataShareNow () {
    this._discordCatalogShareAt = 0;
    try {
      this._maybePublishGroupDataShare(
        (this._discordCatalogCache && this._discordCatalogCache.data) || { guilds: [] }
      );
    } catch (e) {
      this.emit('warning', '[LiveRelay] GroupDataShare publish failed:', e && e.message);
    }
  }

  _maybePublishGroupDataShare (catalog) {
    const shareChat = this._shareDiscordCatalog === true;
    const sharePlay = this._sharePlaytimes === true;
    const files = this._localFilesPayload();
    const notes = this._localNotesPayload();
    const shareFiles = !!files;
    const shareNotes = !!notes;
    if (!shareChat && !sharePlay && !shareFiles && !shareNotes) return;
    if (!this.fabricNetwork || !this.fabricNetwork.ready || !this._identity) return;
    if (!this.groupManager) return;
    const guilds = catalog && Array.isArray(catalog.guilds) ? catalog.guilds : [];
    const messagePack = (shareChat && this.registerStore)
      ? discordCatalogAccumulate.compactStoredMessagesForShare(this.registerStore)
      : { channels: [], truncated: false };
    const playtimes = sharePlay ? this._localPlaytimesPayload() : null;
    const hasChat = shareChat && (guilds.length || (messagePack.channels && messagePack.channels.length));
    if (!hasChat && !playtimes && !files && !notes) return;
    const now = Date.now();
    if (this._discordCatalogShareAt &&
        (now - this._discordCatalogShareAt) < this._discordCatalogShareMinMs) {
      return;
    }
    const me = this._identity.pubkey;
    const groups = this.groupManager.groups || [];
    let published = 0;
    for (const group of groups) {
      if (!group || !group.contractId) continue;
      if (!this.groupManager.isInGroupTree(group.id, me) && this.settings.mode !== 'server') {
        continue;
      }
      const packs = [];
      if (shareChat && guilds.length) {
        packs.push({
          pack: groupDataSync.PACK_CHAT_CATALOG,
          platform: chatPlatform.PLATFORM_DISCORD,
          payload: { platform: chatPlatform.PLATFORM_DISCORD, guilds }
        });
      }
      if (shareChat && messagePack.channels && messagePack.channels.length) {
        packs.push({
          pack: groupDataSync.PACK_CHAT_MESSAGES,
          platform: chatPlatform.PLATFORM_DISCORD,
          truncated: messagePack.truncated === true,
          payload: { platform: chatPlatform.PLATFORM_DISCORD, channels: messagePack.channels }
        });
      }
      if (playtimes) {
        packs.push({
          pack: groupDataSync.PACK_PROFILE_PLAYTIMES,
          payload: playtimes
        });
      }
      if (files) {
        packs.push({
          pack: groupDataSync.PACK_PROFILE_FILES,
          payload: files
        });
      }
      if (notes) {
        packs.push({
          pack: groupDataSync.PACK_PROFILE_NOTES,
          payload: notes
        });
      }
      const payload = groupDataSync.buildShare({
        groupId: group.id,
        sourceAppId: this._discordSourceAppId(),
        packs
      });
      if (!payload) continue;
      try {
        this.fabricNetwork.publishGroupDataShare(group.contractId, payload);
        published += 1;
      } catch (e) {
        this.emit('warning', '[LiveRelay] GroupDataShare publish failed:', e && e.message);
      }
    }
    if (published) this._discordCatalogShareAt = now;
  }

  /**
   * Merge a peer GroupDataShare / legacy DiscordCatalogShare when we share a
   * Federation group.
   * @param {object} object
   * @param {string} source
   * @param {object} [meta]
   * @returns {object[]|null}
   */
  _ingestDiscordCatalogShare (object, source, meta) {
    return this._ingestGroupDataShare(object, source, meta);
  }

  /**
   * @param {object} object
   * @param {string} source
   * @param {object} [meta]
   * @returns {object[]|null}
   */
  _ingestGroupDataShare (object, source, meta) {
    if (!object || !this.registerStore) return null;
    const share = groupDataSync.sanitizeShare(object);
    if (!share) return null;
    const me = this._identity && this._identity.pubkey;
    const signer = source != null ? String(source) : '';
    const contract = meta && meta.contract;
    const group = (this.groupManager && share.groupId && this.groupManager.findGroup(share.groupId)) ||
      (this.groupManager && contract && this.groupManager.getGroupByContractId(contract)) ||
      null;
    if (!groupDataSync.allowIngest({
      groupManager: this.groupManager,
      group,
      viewer: me,
      signer,
      mode: this.settings.mode
    })) {
      return null;
    }
    const folded = [];
    const appId = share.sourceAppId || null;
    const discordPlatform = chatPlatform.PLATFORM_DISCORD;
    for (const pack of share.packs || []) {
      const name = groupDataSync.canonicalPack(pack.pack);
      const platform = pack.platform || (pack.payload && pack.payload.platform) || discordPlatform;
      if (name === groupDataSync.PACK_CHAT_CATALOG && platform === discordPlatform) {
        const rows = discordCatalogAccumulate.foldGuilds(
          this.registerStore,
          (pack.payload && pack.payload.guilds) || [],
          {
            via: 'gossip',
            pubkey: signer || null,
            groupId: group.id,
            appId,
            observedAt: share.observedAt
          }
        );
        for (const row of rows) folded.push(row);
      } else if (name === groupDataSync.PACK_CHAT_MESSAGES && platform === discordPlatform) {
        for (const ch of (pack.payload && pack.payload.channels) || []) {
          if (!ch || !ch.channelId) continue;
          const rows = discordCatalogAccumulate.foldMessages(
            this.registerStore,
            (ch.messages || []).map((m) => Object.assign({}, m, {
              channelId: ch.channelId,
              guildId: ch.guildId || (m && m.guildId) || null
            })),
            {
              via: 'gossip',
              pubkey: signer || null,
              observedAt: share.observedAt
            }
          );
          for (const row of rows) folded.push(row);
        }
      } else if (name === groupDataSync.PACK_PROFILE_PLAYTIMES) {
        const claimed = pack.payload && pack.payload.pubkey;
        if (signer && claimed) {
          const { pubkeysMatch } = identityLib();
          if (!pubkeysMatch(claimed, signer) && this.settings.mode !== 'server') continue;
        }
        const row = profilePlaytimes.foldPlaytimes(this.registerStore, pack.payload, {
          via: 'gossip',
          pubkey: signer || null,
          groupId: group.id,
          observedAt: share.observedAt
        });
        if (row) folded.push(row);
      } else if (name === groupDataSync.PACK_PROFILE_FILES) {
        const claimed = pack.payload && pack.payload.pubkey;
        if (signer && claimed) {
          const { pubkeysMatch } = identityLib();
          if (!pubkeysMatch(claimed, signer) && this.settings.mode !== 'server') continue;
        }
        const row = profileFiles.foldFiles(this.registerStore, pack.payload, {
          via: 'gossip',
          pubkey: signer || null,
          groupId: group.id,
          observedAt: share.observedAt
        });
        if (row) folded.push(row);
      } else if (name === groupDataSync.PACK_PROFILE_NOTES) {
        const claimed = pack.payload && pack.payload.pubkey;
        if (signer && claimed) {
          const { pubkeysMatch } = identityLib();
          if (!pubkeysMatch(claimed, signer) && this.settings.mode !== 'server') continue;
        }
        const payload = pack.payload && typeof pack.payload === 'object' ? pack.payload : {};
        const claimedNotes = Array.isArray(payload.notes) ? payload.notes.filter((n) => {
          if (!n) return false;
          if (!signer || !n.author) return true;
          const { pubkeysMatch } = identityLib();
          return pubkeysMatch(n.author, signer) || this.settings.mode === 'server';
        }) : [];
        const row = profileNotes.foldNotes(this.registerStore, Object.assign({}, payload, {
          notes: claimedNotes
        }), {
          via: 'gossip',
          pubkey: signer || null,
          groupId: group.id,
          observedAt: share.observedAt
        });
        if (row) folded.push(row);
      }
    }
    this._refreshDiscordCatalogFromStore();
    this.emit('discord:catalog-share', {
      groupId: group.id,
      source: signer || null,
      guilds: folded.filter((r) => r && r.kind !== discordCatalogAccumulate.CHANNEL_MSG_KIND).length,
      packs: (share.packs || []).map((p) => p.pack)
    });
    return folded;
  }

  /**
   * Recent messages + guild roster for one Discord channel (Chat insight).
   * Live Discord history is persisted so the operator can browse after Discord
   * is down. Returns accumulated messages when the bot is offline.
   * @param {string} channelId
   * @param {Object} [opts]
   * @param {boolean} [opts.force]
   * @param {number} [opts.limit]
   * @returns {Promise<object>}
   */
  async _discordChannelInsight (channelId, opts = {}) {
    const id = String(channelId || '').trim();
    const limit = Number.isFinite(Number(opts.limit))
      ? Math.max(1, Math.min(discordGuildCatalog.DEFAULT_MESSAGE_LIMIT, Number(opts.limit)))
      : discordGuildCatalog.DEFAULT_MESSAGE_LIMIT;
    if (!id) {
      return {
        error: 'channel_id_required',
        botReady: false,
        guild: null,
        channel: null,
        members: [],
        messages: []
      };
    }
    const force = opts.force === true;
    const now = Date.now();
    const botReady = this._discordBotIsReady();
    const cached = this._discordChannelInsightCache.get(id);
    if (!force && cached && (now - cached.at) < this._discordInsightTtlMs &&
        cached.data && cached.data.botReady === botReady) {
      return cached.data;
    }
    const catalog = await this._discordGuildCatalog({ force: false });
    let guild = null;
    let channel = null;
    for (const g of catalog.guilds || []) {
      const ch = (g.channels || []).find((c) => String(c.id) === id);
      if (ch) {
        guild = g;
        channel = ch;
        break;
      }
    }
    const storedMessages = this.registerStore
      ? discordCatalogAccumulate.loadAccumulatedMessages(this.registerStore, id, discordCatalogAccumulate.STORE_MESSAGE_CAP)
      : [];
    const chatMessages = (this.chatManager && typeof this.chatManager.list === 'function')
      ? this.chatManager.list(discordGuildCatalog.discordChatChannelKey(id), { limit: discordCatalogAccumulate.STORE_MESSAGE_CAP })
      : [];
    if (!channel && !storedMessages.length && !chatMessages.length) {
      return {
        error: catalog.botReady ? 'channel_not_found' : (catalog.error || 'bot_not_ready'),
        botReady: !!catalog.botReady,
        accumulated: false,
        offline: !catalog.botReady,
        guild: null,
        channel: null,
        members: [],
        messages: []
      };
    }
    if (!channel) {
      const stats = this.registerStore
        ? discordCatalogAccumulate.loadChannelMessageStats(this.registerStore)
        : [];
      const hit = stats.find((s) => String(s.channelId) === id);
      const guildId = hit && hit.guildId;
      guild = guildId
        ? ((catalog.guilds || []).find((g) => String(g.id) === String(guildId)) || { id: guildId, name: guildId, memberCount: null })
        : null;
      channel = {
        id,
        name: (hit && hit.channelName) || id,
        type: 0,
        typeName: 'text'
      };
    }
    const members = Array.isArray(guild && guild.members) ? guild.members : [];
    let liveMessages = [];
    const client = this.discordBot && this.discordBot.client ? this.discordBot.client : null;
    if (botReady && client && client.channels && typeof client.channels.fetch === 'function') {
      try {
        const live = await client.channels.fetch(id);
        if (live && live.messages && typeof live.messages.fetch === 'function') {
          const col = await live.messages.fetch({ limit });
          liveMessages = discordGuildCatalog.serializeMessages(col);
          if (this.registerStore && liveMessages.length) {
            discordCatalogAccumulate.foldMessages(this.registerStore, liveMessages.map((m) => Object.assign({}, m, {
              guildId: (guild && guild.id) || m.guildId || null
            })), {
              via: 'bot',
              pubkey: (this._identity && this._identity.pubkey) || null,
              appId: this._discordSourceAppId()
            });
          }
          this._foldInsightMessagesIntoChat(id, liveMessages);
        }
      } catch (e) {
        this.emit('warning', `[discord] channel ${id} messages fetch failed: ${e && e.message ? e.message : e}`);
      }
    }
    const messages = discordCatalogAccumulate.mergeInsightMessages(
      [storedMessages, chatMessages, liveMessages],
      limit
    );
    const data = {
      error: null,
      botReady,
      accumulated: storedMessages.length > 0 || catalog.accumulated === true,
      offline: !botReady,
      guild: guild
        ? { id: guild.id, name: guild.name, memberCount: guild.memberCount }
        : null,
      channel,
      members,
      messages
    };
    this._discordChannelInsightCache.set(id, { at: Date.now(), data });
    return data;
  }

  /**
   * Idempotent ChatManager fold of Discord history (empty bodies skipped).
   * @param {string} channelId
   * @param {Array<object>} messages
   */
  _foldInsightMessagesIntoChat (channelId, messages) {
    if (!this.chatManager || !channelId) return;
    const channel = discordGuildCatalog.discordChatChannelKey(channelId);
    for (const row of messages || []) {
      const body = String(row.body || row.content || '').trim();
      if (!body) continue;
      const authorId = row.authorId || row.discordUserId || null;
      const linked = authorId
        ? discordIdentityLink.linkForDiscordUser(this._discordIdentityLinks, authorId)
        : null;
      const author = linked
        ? linked.pubkey
        : (authorId ? discordIdentityLink.discordActorKey(authorId) : null);
      if (!author) continue;
      try {
        this.chatManager.post({
          channel,
          body,
          author,
          handle: row.handle || (linked && linked.username) || null,
          ts: row.ts || new Date().toISOString(),
          kind: 'discord',
          discordMessageId: row.discordMessageId || null,
          discordUserId: authorId || null,
          discordChannelId: channelId,
          source: 'discord'
        });
      } catch (e) {
        this.emit('warning', '[LiveRelay] Discord insight chat fold failed:', e && e.message);
      }
    }
  }

  async _startDiscordBot () {
    const cfg = this._applyDiscordConfig();
    if (!cfg.enable || !cfg.token) {
      if (this.discordBot) {
        try { await this.discordBot.stop(); } catch (_) { /* ignore */ }
        this.discordBot = null;
        this._discordBotReady = false;
        this._discordCatalogCache = { at: 0, data: null, inflight: null };
        if (this._discordChannelInsightCache) this._discordChannelInsightCache.clear();
      }
      return null;
    }
    const Discord = loadFabricDiscord();
    if (!Discord) {
      this.emit('error', new Error('@fabric/discord is not installed — cannot start Discord bot'));
      return null;
    }
    if (this.discordBot) {
      try { await this.discordBot.stop(); } catch (_) { /* ignore */ }
      this.discordBot = null;
      this._discordBotReady = false;
    }
    const bot = new Discord({
      token: cfg.token,
      channel: cfg.channel,
      app: cfg.app,
      authority: this.settings.authority || 'localhost:3041',
      // Fabric DiscordRequest/Claim/Response owns replies (multi-operator safe).
      autoCommands: false
    });
    bot.on('error', (e) => this.emit('error', e));
    bot.on('log', (m) => this.emit('debug', `[discord] ${m}`));
    bot.on('ready', () => {
      this._discordBotReady = true;
      this._discordCatalogCache = { at: 0, data: null, inflight: null };
      this._discordChannelInsightCache.clear();
      this.emit('discord:ready');
      this._discordGuildCatalog({ force: true }).catch((e) => {
        this.emit('warning', `[discord] initial guild sync failed: ${e && e.message ? e.message : e}`);
      });
    });
    bot.on('activity', (activity) => {
      this._onDiscordActivity(activity).catch((e) => this.emit('error', e));
    });
    try {
      await bot.start();
      this.discordBot = bot;
      console.log('[STAR-CITIZEN] Discord bot started' +
        (cfg.channel ? ` (channel ${cfg.channel})` : ' (no default channel — set discord.channel)') +
        ' — Fabric DiscordRequest coordination enabled');
      return bot;
    } catch (e) {
      this.emit('error', e);
      this.discordBot = null;
      this._discordBotReady = false;
      return null;
    }
  }

  /**
   * Ingress from @fabric/discord ActivityStreams.
   * Always folds DiscordMessage into the unified ChatManager thread. Command
   * coordination (DiscordRequest race) stays announce-channel-only for
   * `!ping` / `!help` / `!status`. Profile `!link` / `!unlink` run locally
   * without a mesh claim so only the node that issued the code replies.
   * @param {object} activity
   */
  async _onDiscordActivity (activity) {
    const cfg = this.settings.discord || {};
    const request = discordContract.requestFromDiscordActivity(activity, {
      appId: cfg.app && cfg.app.id,
      guildId: discordCatalogAccumulate.guildIdFromActivity(activity)
    });
    if (!request) return null;

    const ingested = this._ingestDiscordChat(request);
    this._observeDiscordCatalogFromRequest(request);
    const linkCmd = discordIdentityLink.parseLinkCommand(request.content);
    let link = null;
    if (linkCmd) {
      link = await this._handleDiscordLinkCommand(request, linkCmd);
    }

    const announceOnly = !!(cfg.channel && request.channelId &&
      String(cfg.channel) !== String(request.channelId));
    const coordCmd = this._isDiscordCoordCommand(request.content);
    if (announceOnly || !coordCmd) {
      return { request, ingested, coordinated: false, published: null, link };
    }

    this._discordCoord.append(discordContract.DISCORD_REQUEST, request, {
      direction: 'local',
      signer: (this._identity && this._identity.pubkey) || null,
      ts: request.createdAt
    });

    let published = null;
    if (this.fabricNetwork && this.fabricNetwork.ready && this._identity) {
      try {
        published = this.fabricNetwork.publishDiscordRequest(request);
      } catch (e) {
        this.emit('error', e);
      }
    }

    // Race claim so only one operator replies on Discord.
    await this._maybeClaimDiscordRequest(request, { localOrigin: true });
    return { request, ingested, coordinated: true, published, link };
  }

  /**
   * @param {*} content
   * @returns {boolean}
   */
  _isDiscordCoordCommand (content) {
    const s = String(content || '').trim();
    return s === '!ping' || s === '!help' || s === '!status';
  }

  /**
   * Store an inbound Discord message on `discord:<channelId>` (guild) or
   * `discord:dm:<authorId>` (DM with a human).
   * @param {object} request
   * @returns {object|null}
   */
  _ingestDiscordChat (request) {
    if (!this.chatManager || !request || !request.channelId) return null;
    const body = String(request.content || '').trim();
    if (!body) return null;
    const isDm = request.targetType === 'dm' ||
      request.targetType === 1 ||
      request.targetType === '1';
    const channel = (isDm && request.authorId)
      ? discordGuildCatalog.discordDmChannelKey(request.authorId)
      : discordGuildCatalog.discordChatChannelKey(request.channelId);
    const linked = discordIdentityLink.linkForDiscordUser(
      this._discordIdentityLinks,
      request.authorId
    );
    const author = linked
      ? linked.pubkey
      : discordIdentityLink.discordActorKey(request.authorId);
    if (!author) return null;
    try {
      return this.chatManager.post({
        channel,
        body,
        author,
        handle: request.authorUsername || (linked && linked.username) || null,
        ts: request.createdAt || new Date().toISOString(),
        kind: isDm ? 'discord-dm' : 'discord',
        discordMessageId: request.discordMessageId || null,
        discordUserId: request.authorId || null,
        discordChannelId: request.channelId || null,
        source: 'discord'
      });
    } catch (e) {
      this.emit('error', e);
      return null;
    }
  }

  /**
   * Complete `!link` / `!unlink` on this node. Silent when the code is unknown
   * so other operators of the same bot do not chatter "invalid code".
   * @param {object} request
   * @param {{ action: string, code: string|null }} cmd
   * @returns {Promise<object|null>}
   */
  async _handleDiscordLinkCommand (request, cmd) {
    if (!request || !cmd) return null;
    const discordUserId = String(request.authorId || '').trim();
    if (!discordUserId) return null;

    if (cmd.action === 'unlink') {
      const { removed } = this._unlinkDiscordIdentity({ discordUserId });
      if (!removed) return { ok: false, reason: 'not_linked' };
      const payload = { content: discordIdentityLink.formatUnlinkedReply(removed) };
      await this._postDiscordBridgeReply(request.channelId, payload);
      return { ok: true, action: 'unlink', link: removed };
    }

    if (cmd.action !== 'link') return null;
    if (!cmd.code) return { ok: false, reason: 'missing_code' };

    const completed = this._completeDiscordLinkChallenge(cmd.code, {
      discordUserId,
      username: request.authorUsername || null
    });
    if (!completed.ok) return completed;
    const payload = { content: discordIdentityLink.formatLinkedReply(completed.link) };
    await this._postDiscordBridgeReply(request.channelId, payload);
    return completed;
  }

  /**
   * @param {string} channelId Discord channel snowflake or `loopback-dm:<botId>`
   * @param {object} payload
   * @returns {Promise<object|null>}
   */
  async _postDiscordBridgeReply (channelId, payload) {
    if (!channelId || !payload) return null;
    const loop = String(channelId);
    if (loop.indexOf('loopback-dm:') === 0) {
      const botId = loop.slice('loopback-dm:'.length);
      if (!this.chatManager || !botId) return null;
      const content = typeof payload === 'string'
        ? payload
        : String((payload && payload.content) || '');
      try {
        return this.chatManager.post({
          channel: discordGuildCatalog.discordDmChannelKey(botId),
          body: content,
          author: discordIdentityLink.discordActorKey(botId),
          handle: (this._discordRuntime() && this._discordRuntime().botUser) || 'Bot',
          kind: 'discord-dm',
          source: 'bot-local',
          discordUserId: botId
        });
      } catch (e) {
        this.emit('error', e);
        return null;
      }
    }
    if (!this.discordBot || !this._discordBotReady) return null;
    try {
      return await this.discordBot.postToChannel(channelId, payload);
    } catch (e) {
      this.emit('error', e);
      return null;
    }
  }

  /**
   * Open (or reuse) a Discord DM channel with a user via the local bot.
   * @param {string} userId
   * @returns {Promise<{ id: string, send: Function }>}
   */
  async _openDiscordUserDm (userId) {
    const id = String(userId || '').trim();
    if (!discordGuildCatalog.parseDiscordDmChannel(discordGuildCatalog.discordDmChannelKey(id))) {
      throw new Error('invalid Discord user id');
    }
    const client = this.discordBot && this.discordBot.client;
    if (!client || !client.users || typeof client.users.fetch !== 'function') {
      throw new Error('Discord client cannot open DMs');
    }
    const user = await client.users.fetch(id);
    if (!user || typeof user.createDM !== 'function') {
      throw new Error('Discord user unavailable for DM');
    }
    const dm = await user.createDM();
    if (!dm || typeof dm.send !== 'function') {
      throw new Error('Discord DM channel not sendable');
    }
    return dm;
  }

  /**
   * In-app DM with the local bot — works even when you run the bot (no Discord
   * API self-DM). Commands like !ping reply in the same Chat thread.
   * @param {Object} opts
   * @param {string} opts.text
   * @param {string} opts.author
   * @param {string|null} [opts.handle]
   * @returns {Promise<object>}
   */
  async _postLocalBotDm (opts = {}) {
    const botId = this._localDiscordBotUserId();
    if (!botId) throw new Error('Discord bot user id unavailable');
    const text = String(opts.text || '').trim();
    if (!text && !opts.attachment) throw new Error('message body required');
    const channel = discordGuildCatalog.discordDmChannelKey(botId);
    const runtime = this._discordRuntime();
    const record = this.chatManager.post({
      channel,
      body: text || (opts.attachment && opts.attachment.name
        ? ('📎 ' + opts.attachment.name)
        : ''),
      author: opts.author,
      handle: opts.handle || null,
      kind: 'discord-dm',
      source: 'local',
      attachment: opts.attachment || null
    });

    const linked = discordIdentityLink.linkForPubkey(this._discordIdentityLinks, opts.author);
    const syntheticAuthorId = (linked && linked.discordUserId) || 'app-local';
    const cfg = this.settings.discord || {};
    const request = discordContract.requestFromDiscordActivity({
      type: 'DiscordMessage',
      actor: {
        ref: syntheticAuthorId,
        username: opts.handle || (linked && linked.username) || 'operator'
      },
      object: {
        id: 'app-dm-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
        content: text,
        created: Date.now()
      },
      target: {
        ref: 'loopback-dm:' + botId,
        type: 'dm'
      }
    }, { appId: cfg.app && cfg.app.id });

    if (request) {
      const linkCmd = discordIdentityLink.parseLinkCommand(request.content);
      if (linkCmd) {
        await this._handleDiscordLinkCommand(request, linkCmd);
      } else if (this._isDiscordCoordCommand(request.content)) {
        const reply = this._localDiscordCoordReply(request.content);
        if (reply) {
          this.chatManager.post({
            channel,
            body: reply,
            author: discordIdentityLink.discordActorKey(botId),
            handle: (runtime && runtime.botUser) || 'Bot',
            kind: 'discord-dm',
            source: 'bot-local',
            discordUserId: botId
          });
        }
      }
    }
    return record;
  }

  /**
   * @param {string} content
   * @returns {string|null}
   */
  _localDiscordCoordReply (content) {
    const s = String(content || '').trim();
    if (s === '!ping') return 'Pong! (local bot DM)';
    if (s === '!help') return 'I am the local GoonCitizen Discord bot. Try !ping, !status, or !link <code> from Discord.';
    if (s === '!status') return 'Local bot DM loopback is up.';
    return null;
  }

  _pruneDiscordLinkChallenges (now) {
    const ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    for (const [code, row] of this._discordLinkChallenges) {
      if (!discordIdentityLink.challengeIsFresh(row, ts)) {
        this._discordLinkChallenges.delete(code);
      }
    }
  }

  _listDiscordIdentityLinks () {
    return discordIdentityLink.sanitizeLinks(this._discordIdentityLinks);
  }

  _persistDiscordIdentityLinks () {
    this._discordIdentityLinks = this._listDiscordIdentityLinks();
    if (!this.registerStore) return this._discordIdentityLinks;
    settingsStore.putSetting(
      this.registerStore,
      'discordIdentityLinks',
      this._discordIdentityLinks.length ? this._discordIdentityLinks : null
    );
    return this._discordIdentityLinks;
  }

  /**
   * @param {string} pubkey
   * @returns {object}
   */
  _createDiscordLinkChallenge (pubkey) {
    this._pruneDiscordLinkChallenges();
    const challenge = discordIdentityLink.buildChallenge({ pubkey });
    for (const [code, row] of this._discordLinkChallenges) {
      if (row && row.pubkey === challenge.pubkey) this._discordLinkChallenges.delete(code);
    }
    this._discordLinkChallenges.set(challenge.code, challenge);
    return {
      code: challenge.code,
      expiresAt: new Date(challenge.expiresAt).toISOString(),
      instruction: discordIdentityLink.formatLinkInstruction(challenge.code)
    };
  }

  /**
   * @param {string} code
   * @param {Object} actor
   * @param {string} actor.discordUserId
   * @param {string|null} [actor.username]
   * @returns {object}
   */
  _completeDiscordLinkChallenge (code, actor) {
    this._pruneDiscordLinkChallenges();
    const key = String(code || '').trim().toUpperCase();
    const challenge = this._discordLinkChallenges.get(key);
    if (!challenge || !discordIdentityLink.challengeIsFresh(challenge)) {
      return { ok: false, reason: 'unknown_or_expired' };
    }
    const link = discordIdentityLink.sanitizeLink({
      discordUserId: actor && actor.discordUserId,
      pubkey: challenge.pubkey,
      username: actor && actor.username,
      linkedAt: new Date().toISOString(),
      verified: true
    });
    if (!link) return { ok: false, reason: 'invalid_link' };
    this._discordLinkChallenges.delete(key);
    this._discordIdentityLinks = discordIdentityLink.upsertLink(this._discordIdentityLinks, link);
    this._persistDiscordIdentityLinks();
    this._discordCatalogCache = { at: 0, data: null, inflight: null };
    return { ok: true, action: 'link', link };
  }

  /**
   * @param {Object} opts
   * @param {string} [opts.discordUserId]
   * @param {string} [opts.pubkey]
   * @returns {{ links: Array, removed: object|null }}
   */
  _unlinkDiscordIdentity (opts = {}) {
    const result = discordIdentityLink.removeLink(this._discordIdentityLinks, opts);
    this._discordIdentityLinks = result.links;
    if (result.removed) {
      this._persistDiscordIdentityLinks();
      this._discordCatalogCache = { at: 0, data: null, inflight: null };
    }
    return result;
  }

  /**
   * @param {string} [pubkey]
   * @returns {object}
   */
  _discordLinkStatus (pubkey) {
    this._pruneDiscordLinkChallenges();
    let pk = null;
    try { pk = pubkey ? discordIdentityLink.canonicalChatActor(pubkey) : null; } catch (_) { pk = null; }
    const linked = pk
      ? discordIdentityLink.linkForPubkey(this._discordIdentityLinks, pk)
      : null;
    let pending = null;
    if (pk) {
      for (const row of this._discordLinkChallenges.values()) {
        if (row && row.pubkey === pk && discordIdentityLink.challengeIsFresh(row)) {
          pending = {
            code: row.code,
            expiresAt: new Date(row.expiresAt).toISOString(),
            instruction: discordIdentityLink.formatLinkInstruction(row.code)
          };
          break;
        }
      }
    }
    return { linked: linked || null, pending, identityPubkey: pk };
  }

  /**
   * First-claim-wins: publish DiscordClaim after a small jitter when we can reply.
   * @param {object} request
   * @param {Object} [opts]
   * @param {boolean} [opts.localOrigin]
   */
  async _maybeClaimDiscordRequest (request, opts = {}) {
    if (!request || !request.requestId) return null;
    if (!this._discordBotReady || !this.discordBot) return null;
    if (!this._identity || !this._identity.pubkey) return null;

    const requestId = String(request.requestId);
    const existing = this._discordCoord.getWinningClaim(requestId);
    if (existing && discordContract.claimIsActive(existing)) {
      // Someone already claimed — only settle if we own it.
      if (String(existing.claimantPubkey) === String(this._identity.pubkey)) {
        this._scheduleDiscordClaimSettle(requestId, request, existing);
      }
      return existing;
    }

    if (this._discordClaimPending.has(requestId)) return this._discordClaimPending.get(requestId).claim;

    const jitter = 40 + Math.floor(Math.random() * 180);
    await new Promise((r) => setTimeout(r, jitter));

    const again = this._discordCoord.getWinningClaim(requestId);
    if (again && discordContract.claimIsActive(again) &&
        String(again.claimantPubkey) !== String(this._identity.pubkey)) {
      return again;
    }

    let claim;
    try {
      claim = discordContract.buildDiscordClaim(request, this._identity.pubkey);
    } catch (e) {
      this.emit('error', e);
      return null;
    }

    this._discordCoord.append(discordContract.DISCORD_CLAIM, claim, {
      direction: 'out',
      signer: this._identity.pubkey,
      ts: claim.claimedAt
    });

    if (this.fabricNetwork && this.fabricNetwork.ready) {
      try {
        this.fabricNetwork.publishDiscordClaim(claim);
      } catch (e) {
        this.emit('error', e);
      }
    }

    this._scheduleDiscordClaimSettle(requestId, request, claim);
    return claim;
  }

  _scheduleDiscordClaimSettle (requestId, request, claim) {
    const id = String(requestId);
    const prev = this._discordClaimPending.get(id);
    if (prev && prev.settleTimer) clearTimeout(prev.settleTimer);
    const settleTimer = setTimeout(() => {
      this._settleDiscordClaim(id).catch((e) => this.emit('error', e));
    }, this._discordClaimSettleMs);
    this._discordClaimPending.set(id, { request, claim, settleTimer, replied: false });
  }

  /**
   * After settle window: if we still hold the winning claim, reply + DiscordResponse.
   * @param {string} requestId
   */
  async _settleDiscordClaim (requestId) {
    const id = String(requestId || '');
    const pending = this._discordClaimPending.get(id);
    if (!pending || pending.replied) return null;

    const win = this._discordCoord.getWinningClaim(id);
    const me = this._identity && this._identity.pubkey;
    if (!win || !me || String(win.claimantPubkey) !== String(me)) {
      this._discordClaimPending.delete(id);
      return null;
    }
    if (!discordContract.claimIsActive(win)) {
      this._discordClaimPending.delete(id);
      return null;
    }

    pending.replied = true;
    const request = pending.request || (this._discordCoord.treeFor(id).request);
    if (!request) {
      this._discordClaimPending.delete(id);
      return null;
    }

    let replyPayload = null;
    let status = 'ok';
    let error = null;
    let discordReplyMessageId = null;

    try {
      replyPayload = this._discordReplyForRequest(request);
      if (replyPayload && this.discordBot && this._discordBotReady) {
        const sent = await this.discordBot.postToChannel(request.channelId, replyPayload);
        if (sent && sent.id) discordReplyMessageId = String(sent.id);
      } else if (!replyPayload) {
        status = 'ignored';
      }
    } catch (e) {
      status = 'error';
      error = (e && e.message) || String(e);
      this.emit('error', e);
    }

    const response = discordContract.buildDiscordResponse(request, win, {
      responderPubkey: me,
      status,
      reply: replyPayload,
      discordReplyMessageId,
      error
    });

    this._discordCoord.append(discordContract.DISCORD_RESPONSE, response, {
      direction: 'out',
      signer: me,
      ts: response.respondedAt
    });

    if (this.fabricNetwork && this.fabricNetwork.ready) {
      try {
        this.fabricNetwork.publishDiscordResponse(response);
      } catch (e) {
        this.emit('error', e);
      }
    }

    this._discordClaimPending.delete(id);
    this.emit('discord:response', { request, claim: win, response });
    return response;
  }

  /**
   * Map DiscordRequest content → outbound Discord payload (claim winner only).
   * @param {object} request
   * @returns {object|null}
   */
  _discordReplyForRequest (request) {
    const content = String((request && request.content) || '').trim();
    const now = new Date().toISOString();
    if (content === '!ping') {
      return { content: `Pong! Coordinated reply at ${now}.` };
    }
    if (content === '!help') {
      return {
        content: 'GoonCitizen Discord bot (Fabric-coordinated). Commands: !ping !help !status  ·  Link identity: !link <code>  ·  !unlink'
      };
    }
    if (content === '!status') {
      const peer = this.fabricNetwork && this.fabricNetwork.ready ? 'up' : 'down';
      return {
        content: `Alive. Fabric peer ${peer}. Identity ${this._identity ? 'unlocked' : 'locked'}.`
      };
    }
    // Non-command traffic: no auto-reply (operators extend via events / future handlers).
    return null;
  }

  _ingestDiscordCoordFrame (type, object, signer, meta = {}) {
    if (!object || !object.requestId) return;
    this._discordCoord.append(type, object, {
      signer: signer || null,
      ts: object.createdAt || object.claimedAt || object.respondedAt || new Date().toISOString(),
      messageId: meta.messageId || null,
      direction: meta.origin === 'local' ? 'out' : 'in'
    });
  }

  /**
   * Start a network-wide `/lookup` after a local chat message posts.
   * @param {object} record ChatMessage
   */
  async _startLookupFromChat (record) {
    if (!record || !record.id) return null;
    const parsed = chatLookup.parseLookupCommand(record.body);
    if (!parsed) return null;
    if (!this._identity || !this._identity.pubkey) return null;

    const request = chatLookup.buildLookupRequest({
      channel: record.channel || 'global',
      query: parsed.query,
      chatMessageId: record.id,
      authorPubkey: record.author || null,
      createdAt: record.ts || new Date().toISOString()
    });

    this._lookupCoord.append(chatLookup.LOOKUP_REQUEST, request, {
      direction: 'local',
      signer: this._identity.pubkey,
      ts: request.createdAt
    });

    if (this.fabricNetwork && this.fabricNetwork.ready) {
      try {
        this.fabricNetwork.publishLookupRequest(request);
      } catch (e) {
        this.emit('error', e);
      }
    }

    return this._maybeClaimLookupRequest(request, { localOrigin: true });
  }

  /**
   * Query local catalogs for a LookupRequest (master report).
   * Discord uses the in-memory guild catalog cache (no blocking refresh).
   * @param {object} request
   * @returns {object}
   */
  _lookupLocalResults (request) {
    const players = Array.isArray(this.players) ? this.players : [];
    const groups = (this.groupManager && Array.isArray(this.groupManager.groups))
      ? this.groupManager.groups
      : [];
    let fleets = [];
    try {
      fleets = this.listFleets({ scope: 'public' }) || [];
    } catch (_) { fleets = []; }

    let peers = [];
    try {
      peers = (typeof this._peersWithStatus === 'function')
        ? this._peersWithStatus()
        : (this.peers || []);
    } catch (_) { peers = this.peers || []; }

    const catalog = (this._discordCatalogCache && this._discordCatalogCache.data) || null;
    const discordGuilds = (catalog && Array.isArray(catalog.guilds)) ? catalog.guilds : [];
    let discordUsers = [];
    if (catalog && Array.isArray(catalog.users)) {
      discordUsers = catalog.users;
    } else if (discordGuilds.length) {
      try {
        discordUsers = discordGuildCatalog.uniqueUsersFromGuilds(discordGuilds);
      } catch (_) { discordUsers = []; }
    }

    return chatLookup.queryLocalPublicListings({
      players,
      groups,
      fleets,
      peers,
      discordGuilds,
      discordUsers,
      query: (request && request.query) || ''
    });
  }

  /**
   * Operator-local search corpus (private notes, membership, packs).
   * @param {string|null} viewer
   * @returns {object}
   */
  _appSearchCorpus (viewer) {
    const serverMode = this.settings.mode === 'server';
    let catalog = null;
    try {
      catalog = (this._discordCatalogCache && this._discordCatalogCache.data) || null;
      if ((!catalog || !Array.isArray(catalog.guilds) || !catalog.guilds.length) &&
          this.registerStore) {
        catalog = {
          guilds: discordCatalogAccumulate.loadAccumulatedGuilds(this.registerStore) || [],
          identityLinks: this._discordIdentityLinks || []
        };
      }
    } catch (_) {
      catalog = catalog || { guilds: [] };
    }

    let discordMessages = [];
    try {
      discordMessages = discordCatalogAccumulate.loadRecentStoredMessages(this.registerStore, {
        perChannel: 20,
        maxTotal: 240
      });
    } catch (_) { discordMessages = []; }

    let chatMessages = [];
    try {
      const all = this.registerStore ? this.registerStore.all('chatmessages') : [];
      chatMessages = (all || []).slice()
        .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')))
        .slice(0, 240);
    } catch (_) { chatMessages = []; }

    let chatChannels = [];
    try {
      chatChannels = this.chatManager
        ? this.chatManager.channelsFor(viewer, { enforceMembership: serverMode })
        : [];
    } catch (_) { chatChannels = []; }

    let groups = [];
    try {
      if (this.groupManager) {
        groups = (serverMode && viewer)
          ? this.groupManager.groupsFor(viewer)
          : (this.groupManager.groups || []);
      }
    } catch (_) { groups = []; }

    let localTags = [];
    try {
      localTags = this._listLocalGroups ? this._listLocalGroups() : [];
    } catch (_) { localTags = []; }

    let notes = [];
    try {
      notes = this._listIdentityNotes({
        viewer,
        enforcePrivacy: serverMode,
        groupIds: serverMode ? this._viewerGroupIds(viewer) : []
      });
    } catch (_) { notes = []; }

    let fleets = [];
    try { fleets = this.listFleets({ scope: 'all' }) || []; } catch (_) { fleets = []; }

    let peers = [];
    try {
      peers = (typeof this._peersWithStatus === 'function')
        ? this._peersWithStatus()
        : (this.peers || []);
    } catch (_) { peers = this.peers || []; }

    let inbox = [];
    try {
      inbox = registerInbox.list(this.registerStore, { backfill: false }).slice(0, 80);
    } catch (_) { inbox = []; }

    let snapshots = [];
    try {
      snapshots = this.snapshotManager ? this.snapshotManager.list({ limit: 80 }) : [];
    } catch (_) { snapshots = []; }

    let playtimes = [];
    try {
      playtimes = this.registerStore ? profilePlaytimes.loadAllPlaytimes(this.registerStore) : [];
    } catch (_) { playtimes = []; }

    let documents = [];
    try {
      documents = this.registerStore ? localDocuments.list(this.registerStore) : [];
    } catch (_) { documents = []; }
    try {
      for (const pack of profileFiles.loadAllFiles(this.registerStore) || []) {
        for (const file of pack.files || []) {
          if (!file || !file.id) continue;
          if (documents.some((d) => d && d.id === file.id)) continue;
          documents.push(Object.assign({ publisher: pack.pubkey }, file));
        }
      }
    } catch (_) { /* ignore */ }

    return {
      catalog,
      discordMessages,
      chatMessages,
      chatChannels,
      groups,
      localTags,
      notes,
      missions: this.missions || [],
      fleets,
      peers,
      players: Array.isArray(this.players) ? this.players : [],
      inbox,
      snapshots,
      playtimes,
      documents,
      locations: locationCatalog.listLocations()
    };
  }

  /**
   * First-claim-wins for `/lookup`. Always runs the local public catalog query first.
   * Local origin uses zero jitter to race the mesh; remotes use a tiny jitter.
   * @param {object} request
   * @param {Object} [opts]
   * @param {boolean} [opts.localOrigin]
   */
  async _maybeClaimLookupRequest (request, opts = {}) {
    if (!request || !request.requestId) return null;
    if (!this._identity || !this._identity.pubkey) return null;

    const requestId = String(request.requestId);
    const results = this._lookupLocalResults(request);

    const existing = this._lookupCoord.getWinningClaim(requestId);
    if (existing && chatLookup.claimIsActive(existing)) {
      if (String(existing.claimantPubkey) === String(this._identity.pubkey)) {
        this._scheduleLookupClaimSettle(requestId, request, existing, results);
      }
      return existing;
    }

    if (this._lookupClaimPending.has(requestId)) {
      const pending = this._lookupClaimPending.get(requestId);
      pending.results = results;
      return pending.claim;
    }

    if (!opts.localOrigin) {
      const jitter = Math.floor(Math.random() * 35);
      if (jitter > 0) await new Promise((r) => setTimeout(r, jitter));
    }

    const again = this._lookupCoord.getWinningClaim(requestId);
    if (again && chatLookup.claimIsActive(again) &&
        String(again.claimantPubkey) !== String(this._identity.pubkey)) {
      return again;
    }

    let claim;
    try {
      claim = chatLookup.buildLookupClaim(request, this._identity.pubkey);
    } catch (e) {
      this.emit('error', e);
      return null;
    }

    this._lookupCoord.append(chatLookup.LOOKUP_CLAIM, claim, {
      direction: 'out',
      signer: this._identity.pubkey,
      ts: claim.claimedAt
    });

    if (this.fabricNetwork && this.fabricNetwork.ready) {
      try {
        this.fabricNetwork.publishLookupClaim(claim);
      } catch (e) {
        this.emit('error', e);
      }
    }

    this._scheduleLookupClaimSettle(requestId, request, claim, results);
    return claim;
  }

  _scheduleLookupClaimSettle (requestId, request, claim, results) {
    const id = String(requestId);
    const prev = this._lookupClaimPending.get(id);
    if (prev && prev.settleTimer) clearTimeout(prev.settleTimer);
    const settleTimer = setTimeout(() => {
      this._settleLookupClaim(id).catch((e) => this.emit('error', e));
    }, this._lookupClaimSettleMs);
    this._lookupClaimPending.set(id, {
      request,
      claim,
      results: results || null,
      settleTimer,
      replied: false
    });
  }

  /**
   * After settle window: if we still hold the winning claim, post chat reply + LookupResponse.
   * @param {string} requestId
   */
  async _settleLookupClaim (requestId) {
    const id = String(requestId || '');
    const pending = this._lookupClaimPending.get(id);
    if (!pending || pending.replied) return null;

    const win = this._lookupCoord.getWinningClaim(id);
    const me = this._identity && this._identity.pubkey;
    if (!win || !me || String(win.claimantPubkey) !== String(me)) {
      this._lookupClaimPending.delete(id);
      return null;
    }
    if (!chatLookup.claimIsActive(win)) {
      this._lookupClaimPending.delete(id);
      return null;
    }

    pending.replied = true;
    const request = pending.request || (this._lookupCoord.treeFor(id).request);
    if (!request) {
      this._lookupClaimPending.delete(id);
      return null;
    }

    const results = pending.results || this._lookupLocalResults(request);
    const replyBody = chatLookup.formatLookupReply(request, results);
    let status = 'ok';
    let error = null;
    let chatMessageId = null;

    try {
      if (this.chatManager) {
        const record = this.chatManager.post({
          channel: request.channel || 'global',
          body: replyBody,
          handle: 'lookup',
          author: me
        });
        chatMessageId = record && record.id ? String(record.id) : null;
        const { pubkeysMatch } = identityLib();
        if (this._identity && pubkeysMatch(this._identity.pubkey, record.author)) {
          this._publishChat(record).catch((e) => this.emit('error', e));
        }
      } else {
        status = 'ignored';
      }
    } catch (e) {
      status = 'error';
      error = (e && e.message) || String(e);
      this.emit('error', e);
    }

    const response = chatLookup.buildLookupResponse(request, win, {
      responderPubkey: me,
      status,
      reply: replyBody,
      results,
      error,
      chatMessageId
    });

    this._lookupCoord.append(chatLookup.LOOKUP_RESPONSE, response, {
      direction: 'out',
      signer: me,
      ts: response.respondedAt
    });

    if (this.fabricNetwork && this.fabricNetwork.ready) {
      try {
        this.fabricNetwork.publishLookupResponse(response);
      } catch (e) {
        this.emit('error', e);
      }
    }

    this._lookupClaimPending.delete(id);
    this.emit('lookup:response', { request, claim: win, response });
    return response;
  }

  _ingestLookupCoordFrame (type, object, signer, meta = {}) {
    if (!object || !object.requestId) return;
    this._lookupCoord.append(type, object, {
      signer: signer || null,
      ts: object.createdAt || object.claimedAt || object.respondedAt || new Date().toISOString(),
      messageId: meta.messageId || null,
      direction: meta.origin === 'local' ? 'out' : 'in'
    });
  }

  /**
   * Auditor tree for one Lookup requestId.
   * @param {string} requestId
   * @returns {object}
   */
  lookupSequenceTree (requestId) {
    return this._lookupCoord.treeFor(String(requestId || '').trim());
  }

  /**
   * Auditor tree for one Discord requestId (journal + Fabric message log seed).
   * @param {string} requestId
   * @returns {object}
   */
  discordSequenceTree (requestId) {
    const id = String(requestId || '').trim();
    const fromJournal = this._discordCoord.treeFor(id);
    const seeded = [];
    const messages = this._fabricMessageLog.list({
      limit: 500,
      hideKeepalive: true,
      q: id
    });
    for (const m of messages) {
      const body = m.body;
      if (!body || typeof body !== 'object') continue;
      const appType = body.type || m.appType;
      const object = body.object != null ? body.object : body;
      if (!object || String(object.requestId || '') !== id) continue;
      if (![
        discordContract.DISCORD_REQUEST,
        discordContract.DISCORD_CLAIM,
        discordContract.DISCORD_RESPONSE
      ].includes(String(appType))) continue;
      seeded.push({
        type: appType,
        object,
        signer: m.actor || null,
        ts: m.ts,
        messageId: m.hash || null,
        direction: m.direction
      });
    }
    if (!seeded.length) return fromJournal;
    const merged = discordContract.buildDiscordSequenceTree(id, [
      ...(this._discordCoord.listRecent(500).filter((r) => r.object && r.object.requestId === id)),
      ...seeded
    ]);
    // Dedupe nodes by type+claimId/requestId+ts
    const seen = new Set();
    merged.nodes = merged.nodes.filter((n) => {
      const key = [
        n.type,
        n.object && (n.object.claimId || n.object.requestId),
        n.ts,
        n.messageId
      ].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return merged;
  }

  /**
   * Extract Discord requestId from a Fabric message log entry body.
   * @param {object} entry
   * @returns {string|null}
   */
  _discordRequestIdFromLogEntry (entry) {
    if (!entry) return null;
    const body = entry.body;
    if (body && typeof body === 'object') {
      const object = body.object != null ? body.object : body;
      if (object && object.requestId) return String(object.requestId);
    }
    const preview = String(entry.bodyPreview || '');
    const m = preview.match(/"requestId"\s*:\s*"([a-f0-9]{64})"/i);
    return m ? m[1] : null;
  }

  /** Where the live Game.log is and whether it is actually visible right now. */
  _logInfo () {
    const file = this.settings.logfile;
    const info = { path: file || null, channel: this.channel || null, exists: false, size: 0, mtime: null };
    if (file) {
      try {
        const st = fs.statSync(file);
        info.exists = true;
        info.size = st.size;
        info.mtime = st.mtime.toISOString();
      } catch (_) { /* not found / unreadable */ }
    }
    return info;
  }

  /**
   * Re-parse every locatable log (game logbackups + corpus + the live log),
   * OLDEST FIRST. Counts lines and per-kind statistics and derives a
   * deterministic Fabric message id for each parsed entry:
   *   id     = sha256(canonical JSON of { type: 'GoonCitizenLogEvent', payload })
   *   digest = sha256(digest + id)   — a chain over all entries, so two runs
   * over the same corpus yield the same digest. Read-only; does not mutate
   * the live collections (the register stays the source of truth, D-005).
   */
  async _runReparse () {
    if (this._reparse.status === 'running') return this._reparse;
    const crypto = require('crypto');
    const readlineLib = require('readline');
    const { canonicalStringify } = identityLib();
    const { findLogs } = require('../scripts/backfill');
    const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

    // Collect candidate files: full corpus discovery (or reparse.dirs override).
    let files = [];
    if (this.settings.reparse && Array.isArray(this.settings.reparse.dirs)) {
      const seen = new Set();
      for (const dir of this.settings.reparse.dirs) {
        for (const f of findLogs(dir)) {
          const abs = path.resolve(f);
          if (!seen.has(abs)) { seen.add(abs); files.push(abs); }
        }
      }
      if (this.settings.logfile && fs.existsSync(this.settings.logfile)) {
        const abs = path.resolve(this.settings.logfile);
        if (!seen.has(abs)) files.push(abs);
      }
    } else {
      files = this._discoverCorpusFileList();
    }
    const dated = files
      .map((f) => { try { return { f, mtime: fs.statSync(f).mtimeMs }; } catch (_) { return null; } })
      .filter(Boolean)
      .sort((a, b) => a.mtime - b.mtime); // oldest log forward

    const job = this._reparse = {
      status: 'running',
      files: dated.length,
      fileIndex: 0,
      currentFile: null,
      lines: 0,
      entries: 0,
      byKind: {},
      digest: '0'.repeat(64),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null
    };
    this.emit('reparse:started', { files: dated.length });

    (async () => {
      try {
        for (const { f } of dated) {
          job.fileIndex += 1;
          job.currentFile = path.basename(f);
          await new Promise((resolve) => {
            const rl = readlineLib.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });
            rl.on('line', (line) => {
              job.lines += 1;
              const ev = parseLine(line);
              if (ev.kind === 'log:raw' || ev.kind === 'log:notice') return;
              job.entries += 1;
              job.byKind[ev.kind] = (job.byKind[ev.kind] || 0) + 1;
              // Deterministic Fabric message per entry (content-derived only).
              const { raw, ...payload } = ev;
              const messageId = sha256hex(canonicalStringify({ type: 'GoonCitizenLogEvent', payload }));
              job.digest = sha256hex(job.digest + messageId);
            });
            rl.on('close', resolve);
            rl.on('error', resolve); // unreadable file: skip, keep going
          });
        }
        job.status = 'done';
      } catch (error) {
        job.status = 'error';
        job.error = error.message || String(error);
      }
      job.currentFile = null;
      job.finishedAt = new Date().toISOString();
      this.emit('reparse:finished', job);
    })();

    return job;
  }

  /**
   * Apply operator settings persisted in the Fabric Store (peers, uplink
   * cadence). Called after the Store has started so the collections are live.
   */
  _loadPersistedSettings () {
    settingsStore.scrubLegacySecrets(this.registerStore);
    const persisted = settingsStore.loadSettings(this.registerStore);
    // Explicit constructor `peers: []` keeps an empty roster (tests / custom).
    const constructorEmpty = Array.isArray(this.settings.peers) && this.settings.peers.length === 0;
    // Explicit empty save via Peers UI — do not re-seed hubs (removal respected).
    const persistedCleared = Array.isArray(persisted.peers) && persisted.peers.length === 0;
    if (!this.peers.length && Array.isArray(persisted.peers)) {
      this.peers = persisted.peers.map((p) => this._normalizePeerRecord(p)).filter(Boolean);
    } else if (!this.peers.length && persisted.peers === undefined) {
      // First boot (peers never configured): seed network Fabric hubs.
      // Public relays (`SC_MODE=server`) need the same seeds so they dial
      // hub.fabric.pub; self-dial of relay.goon.vc is stripped below when
      // FABRIC_PUBLIC_HOST is set.
      const seeds = this.settings.peers !== undefined
        ? this.settings.peers
        : DEFAULT_PEERS;
      this.peers = (seeds || []).map((p) => this._normalizePeerRecord(p)).filter(Boolean);
    }
    // Public hostname for self-dial filter (must be set before heal).
    // Fabric-canonical env only — GoonCitizen maps SC_FABRIC_PUBLIC_HOST at boot.
    this._fabricAdvertiseHost = persisted.fabricAdvertiseHost || null;
    if (!this._fabricAdvertiseHost) {
      const envHost = String(
        process.env.FABRIC_PUBLIC_HOST ||
        process.env.FABRIC_ADVERTISE_HOST ||
        ''
      ).trim();
      if (envHost) this._fabricAdvertiseHost = envHost;
    }
    // Constructor peers (tests / custom deploys): only strip true self-loops.
    // Persisted desktop roster: drop self-loops and re-seed hubs when none left
    // (old saves that only dialed localhost break chat gossip).
    if (!constructorEmpty) {
      const fromConstructor = Array.isArray(this.settings.peers) && this.settings.peers.length > 0;
      if (fromConstructor) {
        this._healPeerRoster({ persist: false, dropSelf: true });
      } else if (!persistedCleared) {
        this._healPeerRoster({ persist: true, dropSelf: true, ensureHubs: true });
      }
    }
    if (persisted.uplinkIntervalMs) this.settings.uplink.intervalMs = persisted.uplinkIntervalMs;
    if (persisted.fabricPort != null && Number(persisted.fabricPort) > 0) {
      const envPort = Number(process.env.FABRIC_PORT);
      // FABRIC_PORT wins over a Store-saved listen port (public seeds stay on :7777).
      if (!(Number.isFinite(envPort) && envPort > 0)) {
        this.settings.fabric.port = Number(persisted.fabricPort);
      }
    }
    // Sharing parsed log events: default OFF (explicit authorize on Peers / Settings).
    this._shareLogsGlobal = persisted.shareLogsGlobal === true;
    this._groupChatSeal = persisted.groupChatSeal === true;
    this._requireSealedGroupChat = persisted.requireSealedGroupChat === true;
    // Dashboard HTTP: loopback by default; LAN requires httpSharedMode (or server mode / env).
    this._httpSharedMode = isHttpSharedModeEnabled(
      persisted.httpSharedMode != null ? persisted.httpSharedMode : this.settings.httpSharedMode
    );
    this._nickname = persisted.nickname || null;
    this._profile = peerProfile.sanitizeProfile(persisted.profile);
    this._discordIdentityLinks = discordIdentityLink.sanitizeLinks(persisted.discordIdentityLinks);
    this._broadcastPeering = persisted.broadcastPeering === true;
    this._notifyMissionBroadcasts = persisted.notifyMissionBroadcasts !== false;
    this._primaryGroupId = settingsStore.sanitizePrimaryGroupId(persisted.primaryGroupId);
    this._groupOverlay = persisted.groupOverlay === true;
    this._fabricShareEncoding = settingsStore.sanitizeFabricShareEncoding(persisted.fabricShareEncoding) || 'base64';
    this._shareDiscordCatalog = persisted.shareDiscordCatalog === true;
    this._sharePlaytimes = persisted.sharePlaytimes === true;
    this._shareFiles = persisted.shareFiles === true;
    this._applySnapshotSettings(persisted);
    this._applyPresenceSettings(persisted);
  }

  /**
   * Clipboard encoding for opaque `fabric:` GroupOffer / invite shares.
   * @param {string} [override]
   * @returns {'hex'|'base64'}
   */
  _opaqueShareEncoding (override) {
    const { normalizeOpaqueShareEncoding } = require('../functions/groupShareMessage');
    if (override != null && override !== '') return normalizeOpaqueShareEncoding(override);
    return this._fabricShareEncoding === 'hex' ? 'hex' : 'base64';
  }

  /**
   * Seed primaryGroupId from settings/local.js `defaultGroupMessageId` when the
   * Store has no primary group yet. Accepts fabric:<hex>, message hash, or group id.
   */
  _applyDefaultGroupFromLocal () {
    const { sanitizeDefaultGroupMessageId, resolveDefaultGroup } = require('../functions/defaultGroupMessage');
    const raw = sanitizeDefaultGroupMessageId(
      this.settings.defaultGroupMessageId ||
      (this.settings.groups && this.settings.groups.defaultGroupMessageId) ||
      null
    );
    this._defaultGroupMessageId = raw;
    if (!raw) return;
    if (this._primaryGroupId) {
      console.log('[STAR-CITIZEN] defaultGroupMessageId present; Store primaryGroupId already set — leaving Store value');
      return;
    }
    const resolved = resolveDefaultGroup(raw, {
      messageLog: this._fabricMessageLog,
      groupManager: this.groupManager
    });
    if (!resolved.ok || !resolved.groupId) {
      // Opaque shares / group ids can still apply before the group is imported;
      // try group-id-only parse without requiring the group to exist yet.
      const { parseDefaultGroupRef } = require('../functions/defaultGroupMessage');
      const parsed = parseDefaultGroupRef(raw);
      if (parsed.groupId) {
        this._primaryGroupId = parsed.groupId;
        if (this.registerStore) {
          try {
            settingsStore.putSetting(this.registerStore, 'primaryGroupId', parsed.groupId);
          } catch (e) {
            this.emit('error', e);
          }
        }
        console.log(`[STAR-CITIZEN] primaryGroupId seeded from defaultGroupMessageId → ${parsed.groupId.slice(0, 12)}…`);
        return;
      }
      console.warn('[STAR-CITIZEN] defaultGroupMessageId not resolved yet:', resolved.error || parsed.error || 'unknown');
      return;
    }
    this._primaryGroupId = resolved.groupId;
    if (this.registerStore) {
      try {
        settingsStore.putSetting(this.registerStore, 'primaryGroupId', resolved.groupId);
      } catch (e) {
        this.emit('error', e);
      }
    }
    console.log(`[STAR-CITIZEN] primaryGroupId seeded from defaultGroupMessageId → ${resolved.groupId.slice(0, 12)}…`);
  }

  /**
   * Primary group's brand color (for dashboard theming), if set.
   * @returns {string|null}
   */
  _primaryGroupColor () {
    if (!this._primaryGroupId || !this.groupManager) return null;
    const g = this.groupManager.getGroup(this._primaryGroupId);
    if (!g || !g.primaryColor) return null;
    const { sanitizePrimaryColor } = require('../functions/groupPrimaryColor');
    return sanitizePrimaryColor(g.primaryColor);
  }

  /**
   * Resolve a pasted Fabric message id / share into a primary group and persist.
   * @param {string} paste
   * @param {Object} [opts]
   * @param {boolean} [opts.apply=true]
   * @returns {object}
   */
  resolveAndSetDefaultGroup (paste, opts = {}) {
    const { resolveDefaultGroup, localJsSnippetFor } = require('../functions/defaultGroupMessage');
    const resolved = resolveDefaultGroup(paste, {
      messageLog: this._fabricMessageLog,
      groupManager: this.groupManager
    });
    if (!resolved.ok) return resolved;
    if (opts.apply === false) return resolved;
    this._primaryGroupId = resolved.groupId;
    if (this.registerStore) {
      settingsStore.putSetting(this.registerStore, 'primaryGroupId', resolved.groupId);
    }
    return Object.assign({}, resolved, {
      primaryGroupId: resolved.groupId,
      primaryColor: this._primaryGroupColor(),
      localJsSnippet: resolved.localJsSnippet || localJsSnippetFor(resolved.messageId || paste)
    });
  }

  _applyPresenceSettings (persisted = {}) {
    const share = presence.sanitizePresenceShare({
      sharePresence: persisted.sharePresence,
      presenceVisibility: persisted.presenceVisibility,
      presenceGroupIds: persisted.presenceGroupIds,
      shipOverrideSlug: persisted.shipOverrideSlug,
      locationOverrideSlug: persisted.locationOverrideSlug,
      destinationOverrideSlug: persisted.destinationOverrideSlug,
      presenceAvailability: persisted.presenceAvailability,
      presenceStatusText: persisted.presenceStatusText
    });
    this._sharePresence = share.sharePresence;
    this._presenceVisibility = share.presenceVisibility;
    this._presenceGroupIds = share.presenceGroupIds.slice();
    this._shipOverrideSlug = share.shipOverrideSlug;
    this._locationOverrideSlug = share.locationOverrideSlug;
    this._destinationOverrideSlug = share.destinationOverrideSlug;
    this._presenceAvailability = share.presenceAvailability;
    this._presenceStatusText = share.presenceStatusText;
    this._shipOverride = share.shipOverrideSlug
      ? presence.buildShipOverride(share.shipOverrideSlug)
      : null;
    this._locationOverride = share.locationOverrideSlug
      ? presence.buildPlaceOverride(share.locationOverrideSlug)
      : null;
    this._destinationOverride = share.destinationOverrideSlug
      ? presence.buildPlaceOverride(share.destinationOverrideSlug)
      : null;
  }

  /**
   * Host for the local dashboard / REST listener.
   * Loopback unless LAN shared mode, hosted server mode, or FABRIC_HUB_INTERFACE.
   * Legacy SC_HTTP_* is mapped onto FABRIC_* via applyGoonCitizenEnvAliases at boot.
   * @returns {string}
   */
  _httpListenHost () {
    return resolveHttpListenHost({
      mode: this.settings.mode,
      httpSharedMode: this._httpSharedMode,
      host: this.settings.httpHost
    });
  }

  /**
   * Close and re-open the HTTP server on the resolved listen host (LAN toggle).
   * No-op when embedded (`listen: false`) or not yet started.
   * @returns {Promise<void>}
   */
  async _rebindHttpListener () {
    if (this.settings.listen === false || !this.server) return;
    const port = this.settings.port;
    const host = this._httpListenHost();
    await new Promise((resolve) => this.server.close(resolve));
    this.server = http.createServer((req, res) => this._handle(req, res));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => {
        this.server.removeListener('error', reject);
        resolve();
      });
    });
    const addr = this.server.address();
    if (addr && typeof addr === 'object' && addr.port) this.settings.port = addr.port;
    const bindWarn = httpBindWarning({
      host,
      mode: this.settings.mode,
      httpSharedMode: this._httpSharedMode === true
    });
    if (bindWarn) console.warn(bindWarn);
  }

  /**
   * Options for {@link FabricNetwork.isSelfFabricAddress} — public hostname +
   * local interface IPs so network hubs never dial themselves.
   * @returns {Object}
   */
  _selfFabricDialOpts () {
    return {
      listenPort: Number(this.settings.fabric && this.settings.fabric.port) || 7777,
      advertiseHost: this._fabricAdvertiseHost || null,
      ownHosts: [...FabricNetwork.collectOwnFabricHosts({
        advertiseHost: this._fabricAdvertiseHost || null
      })]
    };
  }

  /**
   * True when hex is this node's publishing Fabric pubkey (x-only or compressed).
   * @param {*} hex
   * @returns {boolean}
   */
  _isOwnFabricPubkeyHex (hex) {
    const mine = this._identity && this._identity.pubkey
      ? String(this._identity.pubkey).trim().toLowerCase().replace(/^0[23]/, '')
      : '';
    const theirs = String(hex || '').trim().toLowerCase().replace(/^0[23]/, '');
    return !!(mine && theirs && mine === theirs);
  }

  /**
   * Drop self-loop dials from the peer roster. With `ensureHubs` / `forceHubs`,
   * re-seed network hubs when none remain (unless this node *is* that hub).
   * `forceHubs` (Peers → Restore network seeds) also strips all loopback and
   * re-adds missing hub seeds (minus self).
   */
  _healPeerRoster (opts = {}) {
    const removed = [];
    const forceHubs = opts.forceHubs === true;
    const dropSelf = forceHubs || opts.dropSelf === true;
    const dropAllLoopback = forceHubs;
    const selfOpts = this._selfFabricDialOpts();
    const before = this.peers.slice();
    const seen = new Set();
    const rewritten = [];
    this.peers = before.map((p) => {
      const orig = p && p.address;
      const row = this._normalizePeerRecord(p);
      if (!row) {
        if (orig) removed.push(orig);
        return null;
      }
      if (orig && row.address !== orig) rewritten.push(`${orig}→${row.address}`);
      return row;
    }).filter((p) => {
      if (!p || !p.address) return false;
      if (seen.has(p.address)) return false;
      if (dropAllLoopback && FabricNetwork.isLoopbackFabricAddress(p.address)) {
        removed.push(p.address);
        return false;
      }
      if (dropSelf && FabricNetwork.isSelfFabricAddress(p.address, selfOpts)) {
        removed.push(p.address);
        return false;
      }
      seen.add(p.address);
      return true;
    });
    const added = [];
    const ensureHubs = forceHubs || opts.ensureHubs === true;
    const hasHub = this.peers.some((p) => FabricNetwork.isNetworkHubAddress(p.address));
    if (ensureHubs && (forceHubs || !hasHub)) {
      const have = new Set(this.peers.map((p) => p.address));
      for (const seed of DEFAULT_PEERS) {
        const address = seed.address;
        if (have.has(address)) continue;
        if (FabricNetwork.isSelfFabricAddress(address, selfOpts)) continue;
        const row = this._normalizePeerRecord(seed);
        if (!row) continue;
        this.peers.push(row);
        have.add(address);
        added.push(address);
      }
    }
    if (opts.persist && (removed.length || added.length || rewritten.length)) {
      this._persistPeers();
    }
    if (removed.length) {
      console.log(`[STAR-CITIZEN] dropped self/loopback Fabric peers: ${removed.join(', ')}`);
    }
    if (rewritten.length) {
      console.log(`[STAR-CITIZEN] rewritten Fabric peers: ${rewritten.join(', ')}`);
    }
    if (added.length) {
      console.log(`[STAR-CITIZEN] restored network hub seeds: ${added.join(', ')}`);
    }
    return { removed, added, rewritten };
  }

  /**
   * Normalize a peer roster entry to `{ id, address, label, enabled, shareLogs }`.
   * Migrates legacy `url: https://host` → `address: host:7777`.
   * Loopback to another port is valid (local hub in tests). Self-listen
   * addresses are excluded from dialing ({@link #_fabricPeerAddresses}).
   * @returns {Object|null}
   */
  _normalizePeerRecord (p) {
    if (!p || typeof p !== 'object') return null;
    const address = FabricNetwork.canonicalizeFabricPeerDial(
      FabricNetwork.normalizeFabricAddress(
        p.address || p.url,
        { migrate: true }
      ),
      this._selfFabricDialOpts()
    );
    if (!address) return null;
    return {
      id: p.id || idFor(address),
      address,
      label: p.label || null,
      enabled: p.enabled !== false,
      // Opt-in: authorize SCEventBatch / GameStateSnapshot to this peer.
      shareLogs: p.shareLogs === true,
      discovered: p.discovered === true,
      expectedPubkey: p.expectedPubkey
        ? String(p.expectedPubkey).trim().toLowerCase()
        : null,
      lastSeen: p.lastSeen || null,
      lastError: p.lastError || null
    };
  }

  /** Enabled Fabric peer addresses (`host:port`) — excludes self-loop dials. */
  _fabricPeerAddresses () {
    const selfOpts = this._selfFabricDialOpts();
    return this.peers
      .filter((p) => p.enabled !== false && p.address)
      .filter((p) => !this._isOwnFabricPubkeyHex(p.expectedPubkey))
      .map((p) => p.address)
      .filter((a) => !FabricNetwork.isSelfFabricAddress(a, selfOpts));
  }

  /** Fabric addresses authorized to receive log events (null = all connected when global on). */
  _logShareTargets () {
    if (this._shareLogsGlobal) return null;
    return this.peers
      .filter((p) => p && p.enabled !== false && p.shareLogs === true)
      .map((p) => p.address)
      .filter(Boolean);
  }

  /** True when identity unlocked and at least one share path is authorized. */
  _canShareLogs () {
    if (!this._identity) return false;
    if (this._shareLogsGlobal) return true;
    return this.peers.some((p) => p && p.enabled !== false && p.shareLogs === true);
  }

  /**
   * Publish options for log uplink: `{}` broadcasts (global), `{ to }` directs,
   * `null` means nothing authorized.
   * @returns {Object|null} optional `{ to: string[] }` when directed
   */
  _logSharePublishOpts () {
    if (!this._canShareLogs()) return null;
    const targets = this._logShareTargets();
    if (targets === null) return {};
    if (!targets.length) return null;
    return { to: targets };
  }

  /**
   * Unified chat-style activity stream for the Feed tab.
   * @param {number} [limit]
   * @returns {{ items: object[], categories: string[][], sources: string[][] }}
   */
  _liveFeedSnapshot (limit = 400) {
    let chat = [];
    try {
      if (this.chatManager) {
        chat = this.chatManager.list('global', { limit: Math.min(limit, 200) });
        // Include recent group chat too (best-effort; capped).
        const channels = this.chatManager.channelsFor(
          this._identity && this._identity.pubkey,
          { enforceMembership: this.settings.mode === 'server' }
        );
        for (const ch of channels) {
          if (!ch || ch.key === 'global') continue;
          const more = this.chatManager.list(ch.key, { limit: 40 });
          chat = chat.concat(more);
        }
        // Discord bridged threads are not in channelsFor — fold them into logs.
        const discordKeys = new Set();
        try {
          const rows = this.registerStore ? (this.registerStore.all('chatmessages') || []) : [];
          for (const m of rows) {
            if (m && String(m.channel || '').indexOf('discord:') === 0) {
              discordKeys.add(m.channel);
            }
          }
        } catch (_) { /* optional */ }
        for (const key of discordKeys) {
          const more = this.chatManager.list(key, { limit: 40 });
          chat = chat.concat(more);
        }
      }
    } catch (_) { /* chat optional */ }
    try {
      const chatDelivery = require('../functions/chatDelivery');
      chat = chatDelivery.enrichChatMessages(
        this.registerStore,
        chat,
        (this._identity && this._identity.pubkey) || null
      );
    } catch (_) { /* delivery optional */ }
    let broadcasts = [];
    try {
      broadcasts = this._listMissionBroadcasts({ pendingOnly: false, viewer: null }) || [];
    } catch (_) { broadcasts = []; }
    let inbox = [];
    try {
      inbox = ((this.registerStore && this.registerStore.all('inbox')) || [])
        .slice()
        .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')))
        .slice(0, 200);
    } catch (_) { inbox = []; }
    return liveFeed.buildLiveFeed({
      chat,
      broadcasts: broadcasts.slice(-100),
      kills: this.kills,
      deaths: this.deaths,
      incaps: this.incaps,
      vehicles: this.vehicles,
      missionlog: this.missionlog,
      notifications: this.notifications,
      logins: this.logins,
      recent: this.recent,
      inbox
    }, {
      limit,
      aliases: this._peerAliasByPubkey || {},
      profiles: this._peerProfilesByPubkey || {},
      selfPubkey: (this._identity && this._identity.pubkey) || null
    });
  }

  /**
   * Roster + live connection flags for Peers UI (Hub PeerList-inspired).
   * Desktop peering is Fabric TCP/NOISE; browser WebRTC mesh lives on Hub.
   */
  _peersWithStatus () {
    const connections = (this.fabricNetwork && typeof this.fabricNetwork.connectedAddresses === 'function')
      ? this.fabricNetwork.connectedAddresses()
      : [];
    const connectedSet = connections.map((c) => String(c).toLowerCase());
    const listenPort = Number(this.settings.fabric && this.settings.fabric.port) || 7777;
    const selfPk = (this._identity && this._identity.pubkey) || null;
    const { pubkeysMatch } = identityLib();
    return this.peers.map((p) => {
      const address = p.address;
      const connected = connectedSet.some((id) => FabricNetwork.connectionMatchesAddress(id, address));
      const isPrimary = FabricNetwork.isNetworkHubAddress(address) ||
        /hub\.fabric\.pub|relay\.goon\.vc|goon\.vc/i.test(String(p.label || ''));
      const reg = this.fabricNetwork && typeof this.fabricNetwork.lookupPeerRegistry === 'function'
        ? this.fabricNetwork.lookupPeerRegistry(address)
        : null;
      // Peer registry keys are often host:port while candidates dial; only treat
      // hex compressed pubkeys as identity (else prefer expectedPubkey from offers).
      const regId = reg && reg.id != null ? String(reg.id).trim().toLowerCase() : null;
      const expectedPk = p.expectedPubkey ? String(p.expectedPubkey).trim().toLowerCase() : null;
      const pubkey = (regId && peerPeeringString.isLikelyCompressedPubkeyHex(regId) ? regId : null)
        || (expectedPk && peerPeeringString.isLikelyCompressedPubkeyHex(expectedPk) ? expectedPk : null)
        || null;
      const cached = pubkey ? this._peerProfilesByPubkey[pubkey] : null;
      const alias = (pubkey && this._peerAliasByPubkey[pubkey]) ||
        (reg && (reg.alias || reg.nickname)) ||
        (cached && cached.nickname) ||
        null;
      const isSelf = !!(pubkey && selfPk && pubkeysMatch(pubkey, selfPk));
      const peering = peerPeeringString.peeringInfoForGoonCitizen({
        peer: p,
        pubkey,
        address,
        advertiseHost: isSelf ? this._fabricAdvertiseHost : null,
        listenPort
      });
      return Object.assign({}, p, {
        shareLogs: p.shareLogs === true,
        connected,
        transport: 'fabric-tcp',
        primary: isPrimary,
        discovered: p.discovered === true,
        pubkey,
        alias,
        peering: peering.string || null,
        status: p.enabled === false ? 'disabled' : (connected ? 'connected' : 'offline')
      });
    });
  }

  /**
   * Detailed peer view for inspect UI (roster + mesh profile + registry).
   * @param {string} peerId
   * @returns {object|null}
   */
  _peerDetail (peerId) {
    const row = this._peersWithStatus().find((p) => p.id === peerId);
    if (!row) return null;
    const pubkey = row.pubkey || null;
    const profile = pubkey && this._peerProfilesByPubkey[pubkey]
      ? this._peerProfilesByPubkey[pubkey]
      : null;
    const local = this._localProfile();
    const isSelf = !!(pubkey && this._identity && pubkey === this._identity.pubkey);
    const remotePresence = pubkey && this._peerPresenceByPubkey[pubkey]
      ? this._peerPresenceByPubkey[pubkey]
      : null;
    const listenPort = Number(this.settings.fabric && this.settings.fabric.port) || 7777;
    const peering = peerPeeringString.peeringInfoForGoonCitizen({
      peer: row,
      profile: isSelf ? local : profile,
      pubkey,
      advertiseHost: isSelf ? this._fabricAdvertiseHost : null,
      listenPort
    });
    return {
      peer: row,
      profile: isSelf
        ? local
        : (profile || {
          type: peerProfile.PEER_PROFILE_TYPE,
          nickname: row.alias || null,
          bio: null,
          scHandle: null,
          pubkey,
          updatedAt: null
        }),
      presence: isSelf ? this.getPresenceStatus().presence : remotePresence,
      meshAlias: row.alias || null,
      registry: this.fabricNetwork ? this.fabricNetwork.lookupPeerRegistry(row.address) : null,
      linkedDevice: this._linkedDeviceForPubkey(pubkey),
      self: isSelf,
      peering,
      sharePlaytimes: isSelf ? this._sharePlaytimes === true : undefined,
      playtimes: this._playtimesForProfile(pubkey, isSelf),
      shareFiles: isSelf ? this._hasPinnedProfileFiles() : undefined,
      files: this._filesForProfile(pubkey, isSelf)
    };
  }

  _localProfile () {
    return peerProfile.buildLocalProfile({
      nickname: this._nickname,
      profile: this._profile,
      pubkey: this._identity ? this._identity.pubkey : null
    });
  }

  /**
   * Shared play-times pack for a profile. Self only when opted in; peers from Store.
   * @param {string} pubkey
   * @param {boolean} isSelf
   * @returns {object|null}
   */
  _playtimesForProfile (pubkey, isSelf) {
    if (!pubkey) return null;
    if (isSelf) {
      if (this._sharePlaytimes !== true) return null;
      const local = this._localPlaytimesPayload();
      if (!local) return null;
      return {
        pubkey,
        cells: local.cells,
        timezone: local.timezone,
        sampleCount: local.sampleCount,
        generatedAt: local.generatedAt,
        shared: true
      };
    }
    const stored = this.registerStore
      ? profilePlaytimes.loadPlaytimes(this.registerStore, pubkey)
      : null;
    if (!stored) return null;
    return {
      pubkey: stored.pubkey,
      cells: stored.cells,
      timezone: stored.timezone,
      sampleCount: stored.sampleCount,
      generatedAt: stored.generatedAt,
      updatedAt: stored.updatedAt,
      shared: true
    };
  }

  /**
   * Pinned-file listing for a profile. Self shows this node's pins; peers only
   * after they gossiped `profile.files`.
   * @param {string} pubkey
   * @param {boolean} isSelf
   * @returns {object|null}
   */
  _filesForProfile (pubkey, isSelf) {
    if (!pubkey) return null;
    if (isSelf) {
      const local = this._localFilesPayload();
      return {
        pubkey,
        files: (local && local.files) || [],
        truncated: !!(local && local.truncated),
        generatedAt: local && local.generatedAt,
        shared: this._hasPinnedProfileFiles()
      };
    }
    const stored = this.registerStore
      ? profileFiles.loadFiles(this.registerStore, pubkey)
      : null;
    if (!stored) return null;
    return {
      pubkey: stored.pubkey,
      files: stored.files || [],
      truncated: stored.truncated === true,
      generatedAt: stored.generatedAt,
      updatedAt: stored.updatedAt,
      shared: true
    };
  }

  /**
   * Public notes pinned onto a profile (local pins + gossiped `profile.notes`).
   * @param {string} id
   * @param {boolean} isSelf
   * @param {string[]} [extraKeys]
   * @returns {object|null}
   */
  _notesForProfile (id, isSelf, extraKeys) {
    if (!this.registerStore) {
      return isSelf ? { notes: [], shared: false } : null;
    }
    const keys = new Set();
    const add = (value) => {
      const actor = localGroups.canonicalActor(value);
      if (actor) keys.add(actor);
      const s = value != null ? String(value).trim() : '';
      if (s) keys.add(s);
    };
    add(id);
    for (const key of extraKeys || []) add(key);
    const localPinned = identityNotes.listNotes(this.registerStore, { profilePinned: true })
      .filter((n) => n && keys.has(n.subject));
    const shared = profileNotes.loadAllNotes(this.registerStore) || [];
    const notes = profileNotes.notesForSubjects({
      local: localPinned,
      shared,
      subjects: keys
    });
    if (!notes.length && !isSelf) return null;
    return {
      notes,
      truncated: false,
      shared: notes.length > 0
    };
  }

  /**
   * Notes this operator authored (own-profile "My notes").
   * @returns {object[]}
   */
  _listMyNotes () {
    if (!this.registerStore) return [];
    const me = this._identity && this._identity.pubkey;
    return identityNotes.listNotes(this.registerStore, {
      author: me || 'local',
      includeLocal: true
    });
  }

  /**
   * Profile page payload keyed by Fabric pubkey (chat members, presence roster).
   * Works even when the peer is not in the configured TCP roster.
   * @param {string} pubkey
   * @returns {object|null}
   */
  _profileDetailByPubkey (pubkey) {
    const { pubkeysMatch } = identityLib();
    const pk = String(pubkey || '').trim();
    if (!/^0[23][0-9a-fA-F]{64}$/.test(pk) && !/^[0-9a-fA-F]{64}$/.test(pk)) return null;
    const isSelf = !!(this._identity && pubkeysMatch(this._identity.pubkey, pk));
    const rosterPeer = this._peersWithStatus().find((p) => pubkeysMatch(p.pubkey, pk)) || null;
    const cached = this._peerProfilesByPubkey[pk] || null;
    const alias = this._peerAliasByPubkey[pk] || (rosterPeer && rosterPeer.alias) || null;
    const local = this._localProfile();
    const remotePresence = this._peerPresenceByPubkey[pk] || null;
    const listenPort = Number(this.settings.fabric && this.settings.fabric.port) || 7777;
    const peering = peerPeeringString.peeringInfoForGoonCitizen({
      peer: rosterPeer,
      profile: isSelf ? local : cached,
      pubkey: pk,
      advertiseHost: isSelf ? this._fabricAdvertiseHost : null,
      listenPort
    });
    return {
      pubkey: pk,
      peer: rosterPeer,
      profile: isSelf
        ? local
        : (cached || {
          type: peerProfile.PEER_PROFILE_TYPE,
          nickname: alias || null,
          bio: null,
          scHandle: null,
          pubkey: pk,
          updatedAt: null
        }),
      presence: isSelf ? this.getPresenceStatus().presence : remotePresence,
      meshAlias: alias || null,
      linkedDevice: this._linkedDeviceForPubkey(pk),
      self: isSelf,
      peering,
      sharePlaytimes: isSelf ? this._sharePlaytimes === true : undefined,
      playtimes: this._playtimesForProfile(pk, isSelf),
      shareFiles: isSelf ? this._hasPinnedProfileFiles() : undefined,
      files: this._filesForProfile(pk, isSelf),
      shareNotes: isSelf ? this._hasPinnedProfileNotes() : undefined,
      notes: this._notesForProfile(pk, isSelf),
      myNotes: isSelf ? this._listMyNotes() : undefined
    };
  }

  /**
   * Profile for a Fabric pubkey, `discord:<id>`, or future `platform:id`.
   * @param {string} id
   * @returns {object|null}
   */
  _profileDetailByActor (id) {
    const parsed = identityActor.parseActor(id);
    if (!parsed) return null;
    const links = this._discordIdentityLinks || [];
    let catalog = null;
    try {
      catalog = (this._discordCatalogCache && this._discordCatalogCache.data) || null;
      if ((!catalog || !Array.isArray(catalog.guilds) || !catalog.guilds.length) &&
          this.registerStore) {
        catalog = {
          guilds: discordCatalogAccumulate.loadAccumulatedGuilds(this.registerStore) || [],
          identityLinks: links
        };
      }
    } catch (_) {
      catalog = catalog || { guilds: [] };
    }
    let fabricKey = parsed.platform === 'fabric' ? parsed.key : null;
    if (parsed.platform === 'discord') {
      const link = discordIdentityLink.linkForDiscordUser(links, parsed.nativeId);
      if (link && link.pubkey) fabricKey = String(link.pubkey);
    }
    let cluster = null;
    if (fabricKey && this.identityCluster) {
      try { cluster = this.identityCluster.snapshot(fabricKey); } catch (_) { cluster = null; }
    }
    const actor = identityActor.rollupActor(id, { links, cluster, catalog });
    const pk = (actor && actor.platforms.find((p) => p.platform === 'fabric'))
      ? actor.platforms.find((p) => p.platform === 'fabric').key
      : null;
    const fabric = pk ? this._profileDetailByPubkey(pk) : null;
    const discordPlat = actor && actor.platforms.find((p) => p.platform === 'discord');
    const discord = discordPlat
      ? identityActor.discordUserFromCatalog(catalog, discordPlat.nativeId)
      : null;
    const nickname = (fabric && fabric.profile && fabric.profile.nickname)
      || (discord && (discord.displayName || discord.username))
      || null;
    const base = fabric || {
      pubkey: parsed.key,
      peer: null,
      profile: {
        type: peerProfile.PEER_PROFILE_TYPE,
        nickname,
        bio: null,
        scHandle: null,
        pubkey: parsed.platform === 'fabric' ? parsed.key : null,
        updatedAt: null
      },
      presence: null,
      meshAlias: nickname,
      linkedDevice: pk ? this._linkedDeviceForPubkey(pk) : null,
      self: false,
      peering: { string: '' },
      playtimes: null,
      files: null,
      notes: null
    };
    const extraKeys = [];
    if (actor) {
      extraKeys.push(actor.canonical);
      if (actor.requested && actor.requested.key) extraKeys.push(actor.requested.key);
      for (const p of actor.platforms || []) {
        if (p && p.key) extraKeys.push(p.key);
      }
    }
    extraKeys.push(parsed.key);
    const isSelf = !!(base.self);
    return Object.assign({}, base, {
      actor,
      discord,
      pubkey: (fabric && fabric.pubkey) || parsed.key,
      notes: this._notesForProfile((fabric && fabric.pubkey) || parsed.key, isSelf, extraKeys),
      myNotes: isSelf ? this._listMyNotes() : undefined
    });
  }

  /**
   * Dedicated search-result / collection entity.
   * @param {string} kind
   * @param {string} id
   * @param {string|null} viewer
   * @returns {object|null}
   */
  _collectionRecord (kind, id, viewer) {
    return collectionRecords.load(kind, id, {
      corpus: this._appSearchCorpus(viewer),
      getNote: (nid) => this.registerStore ? identityNotes.getNote(this.registerStore, nid) : null,
      getGroup: (gid) => this.groupManager ? this.groupManager.findGroup(gid) : null,
      getFleet: (fid) => (typeof this.getFleet === 'function' ? this.getFleet(fid) : null),
      getLocalTag: (tid) => this.registerStore ? localGroups.getGroup(this.registerStore, tid) : null,
      getInbox: (iid) => this.registerStore ? this.registerStore.get('inbox', iid) : null,
      getSnapshot: (sid) => {
        if (!this.snapshotManager) return null;
        try {
          const rows = this.snapshotManager.list({ limit: 500 }) || [];
          return rows.find((s) => s && String(s.id) === String(sid)) || null;
        } catch (_) { return null; }
      },
      getFabricMessage: (hash) => this._fabricMessageLog.get(hash),
      getChatMessage: (mid) => {
        try {
          const all = this.registerStore ? this.registerStore.all('chatmessages') : [];
          return (all || []).find((m) => m && (
            String(m.id) === String(mid) || String(m.discordMessageId) === String(mid)
          )) || null;
        } catch (_) { return null; }
      },
      getDocument: (did) => {
        const rec = this._fileRecord(did);
        return rec && rec.record ? rec.record : null;
      },
      getLocation: (id) => locationCatalog.resolveLocation(id)
    });
  }

  /**
   * Dedicated file page payload (`GET …/files/:id`).
   * @param {string} documentId
   * @returns {object|null}
   */
  _fileRecord (documentId) {
    const recId = String(documentId || '').trim();
    if (!recId) return null;
    let localDoc = null;
    try {
      if (this.registerStore) {
        const got = localDocuments.get(this.registerStore, recId, {
          dir: this._documentsDir(),
          includeContent: false
        });
        localDoc = got && got.document ? got.document : got;
      }
    } catch (e) {
      if (e && e.status !== 404) throw e;
    }
    const shared = this.registerStore ? profileFiles.loadAllFiles(this.registerStore) : [];
    const listed = profileFiles.findListedFile({ local: localDoc, shared }, recId);
    let remote = null;
    if (!localDoc && this.registerStore) {
      try {
        remote = documentOffers.remoteDocument(this.registerStore, recId, {
          aliases: this._documentOfferAliases()
        });
      } catch (_) { remote = null; }
    }
    const remoteDoc = remote && remote.document ? remote.document : remote;
    const file = (listed && listed.file) || localDoc || remoteDoc;
    if (!file) return null;
    let offers = [];
    try {
      offers = documentOffers.offersForDocument({
        store: this.registerStore,
        documentId: recId,
        localDoc: localDoc || null,
        self: this._documentOfferSelf(),
        aliases: this._documentOfferAliases()
      });
    } catch (_) { offers = []; }
    const publisher = (listed && listed.publisher)
      || (listed && listed.file && listed.file.publisher)
      || (localDoc && this._identity && this._identity.pubkey)
      || (remoteDoc && remoteDoc.peerPubkey)
      || null;
    return {
      type: 'FileRecord',
      kind: 'file',
      id: recId,
      href: profileFiles.fileHref(recId),
      title: file.name || recId,
      record: file,
      local: !!localDoc,
      self: !!(localDoc && this._identity),
      profilePinned: !!(localDoc && localDoc.profilePinned),
      clusterSync: !!(localDoc && localDoc.clusterSync),
      clusterPending: !!(localDoc && localDoc.clusterPending),
      publisher,
      offers
    };
  }

  /**
   * Dedicated location page payload (`GET …/locations/:slug`).
   * Catalog metadata plus node-local reports and live presence.
   * @param {string} slug
   * @returns {object|null}
   */
  _locationRecord (slug) {
    const loc = locationCatalog.resolveLocation(slug);
    if (!loc) return null;
    const reports = locationReports.summarize(this.registerStore, loc.slug, { limit: 40 });
    let roster = {};
    try { roster = this.getPresenceRoster() || {}; } catch (_) { roster = {}; }
    return {
      type: 'LocationRecord',
      location: loc,
      href: '/locations/' + encodeURIComponent(loc.slug),
      mapSystem: loc.system || 'STANTON',
      reports,
      online: locationReports.onlineAt(roster, loc.slug)
    };
  }

  _localReportActor () {
    if (this._identity && this._identity.pubkey) return this._identity.pubkey;
    if (this._sessionHandle) return 'player:' + this._sessionHandle;
    return null;
  }

  _foldLocalPlaceReports (ev) {
    if (!this.registerStore || !ev || !ev.kind) return;
    const at = ev.timestamp || this._lastLogEventAt || new Date().toISOString();
    const meta = {
      actor: this._localReportActor(),
      nickname: this._nickname,
      handle: this._sessionHandle || (this._localReportActor() ? null : 'local'),
      ship: this._detectedShip,
      at
    };
    const kind = String(ev.kind);
    try {
      if (kind === 'quantum:select' && this._detectedDestination) {
        locationReports.recordSighting(this.registerStore, Object.assign({}, meta, {
          place: this._detectedDestination,
          kind: 'self',
          role: 'destination'
        }));
      } else if (kind === 'quantum:route') {
        if (this._detectedLocation) {
          locationReports.recordSighting(this.registerStore, Object.assign({}, meta, {
            place: this._detectedLocation,
            kind: 'self',
            role: 'location'
          }));
        }
        if (this._detectedDestination) {
          locationReports.recordSighting(this.registerStore, Object.assign({}, meta, {
            place: this._detectedDestination,
            kind: 'self',
            role: 'destination'
          }));
        }
      } else if (kind === 'quantum:arrive' && this._detectedLocation) {
        locationReports.recordSighting(this.registerStore, Object.assign({}, meta, {
          place: this._detectedLocation,
          kind: 'visit',
          role: 'location'
        }));
      }
    } catch (_) { /* ignore */ }
  }

  _linkedDeviceForPubkey (pubkey) {
    if (!pubkey) return null;
    if (this.identityCluster) {
      const snap = this.identityCluster.snapshot(pubkey);
      if (snap.members && snap.members.length > 1) {
        return {
          peerFabricId: snap.canonical,
          members: snap.members,
          label: 'linked cluster'
        };
      }
    }
    if (!this.registerStore) return null;
    const persisted = settingsStore.loadSettings(this.registerStore);
    const list = Array.isArray(persisted.linkedDevices) ? persisted.linkedDevices : [];
    return list.find((d) => d && (d.peerFabricId === pubkey || d.pubkey === pubkey)) || null;
  }

  _loadIdentityCluster () {
    if (!this.registerStore || !this.identityCluster) return;
    const IdentityCluster = require('../functions/identityCluster');
    let rows = [];
    try {
      rows = this.registerStore.all('identitycrosssigns') || [];
    } catch (_) {
      rows = [];
    }
    const revokes = [];
    const signs = [];
    for (const row of rows) {
      if (!row) continue;
      if (row.kind === IdentityCluster.REVOKE_TYPE || row.type === IdentityCluster.REVOKE_TYPE) {
        revokes.push(row);
      } else {
        signs.push(row);
      }
    }
    for (const row of signs) this.identityCluster.ingestCrossSign(row);
    for (const row of revokes) this.identityCluster.ingestRevoke(row);
  }

  _persistIdentityCrossSignRow (kind, record) {
    if (!this.registerStore || !record) return;
    const IdentityCluster = require('../functions/identityCluster');
    const nonce16 = String(record.nonce || '').slice(0, 16);
    let id = 'edge:' + String(kind || 'sign') + ':' + nonce16;
    try {
      const a = IdentityCluster.keyOf
        ? IdentityCluster.keyOf(record.localPubkey)
        : '';
      const b = IdentityCluster.keyOf
        ? IdentityCluster.keyOf(record.peerPubkey)
        : '';
      if (a && b) id = a + '->' + b + ':' + String(kind || 'sign') + ':' + nonce16;
      else {
        const ek = IdentityCluster.edgeKey(record.localPubkey, record.peerPubkey) || 'edge';
        id = ek + ':' + String(kind || 'sign') + ':' + nonce16 + ':' + String(record.localPubkey || '').slice(0, 12);
      }
    } catch (_) { /* stub IdentityCluster */ }
    this.registerStore.put('identitycrosssigns', id, Object.assign({
      id,
      kind,
      type: kind
    }, record));
  }

  _ingestIdentityCrossSign (object, signer) {
    const { verifyCrossSignObject } = require('../functions/identityCrossSignVerify');
    const IdentityCluster = require('../functions/identityCluster');
    const checked = verifyCrossSignObject(object, signer);
    if (!checked.ok) {
      logFabricSync('IdentityCrossSign rejected', checked.error);
      this.emit('warning', '[LiveRelay] IdentityCrossSign rejected: ' + checked.error);
      return null;
    }
    const rec = checked.record;
    this._persistIdentityCrossSignRow(checked.kind, Object.assign({}, object, rec));
    if (checked.kind === IdentityCluster.REVOKE_TYPE) {
      this.identityCluster.ingestRevoke(rec);
      logFabricSync('IdentityCrossSignRevoke',
        String(rec.localPubkey || '').slice(0, 12) + ' ↔ ' + String(rec.peerPubkey || '').slice(0, 12));
    } else {
      const ingest = this.identityCluster.ingestCrossSign(rec) || {};
      const me = this._identity && this._identity.pubkey;
      const mine = !!(me && IdentityCluster.keyOf &&
        IdentityCluster.keyOf(me) === IdentityCluster.keyOf(rec.localPubkey));
      logFabricSync(
        'IdentityCrossSign',
        (mine ? 'local' : 'peer') +
          (ingest.linked ? ' linked' : (ingest.pending ? ' pending' : '')) +
          ' ' + String(rec.localPubkey || '').slice(0, 12) +
          ' → ' + String(rec.peerPubkey || '').slice(0, 12)
      );
      if (me && (
        this.identityCluster.clusterEquals(me, rec.localPubkey) ||
        this.identityCluster.clusterEquals(me, rec.peerPubkey)
      )) {
        this._scheduleAccountDataReplay();
      }
    }
    this.emit('identity:cluster', this.identityCluster.snapshot(rec.localPubkey));
    return rec;
  }

  _gossipIdentityCrossSign (object) {
    if (!object || !this.fabricNetwork || !this.fabricNetwork.ready) return;
    try {
      this.fabricNetwork.publishIdentityCrossSign(object);
    } catch (e) {
      this.emit('warning', '[LiveRelay] IdentityCrossSign publish: ' + (e && e.message));
    }
  }

  /**
   * Re-gossip stored BIP340 IdentityCrossSign / Revoke proofs so later peers
   * can verify the cluster without re-running /device-links.
   */
  _replayIdentityCrossSigns () {
    if (!this.registerStore || !this.fabricNetwork || !this.fabricNetwork.ready) return;
    let rows = [];
    try { rows = this.registerStore.all('identitycrosssigns') || []; } catch (_) { rows = []; }
    for (const row of rows) {
      if (!row || !row.signature) continue;
      this._gossipIdentityCrossSign(row);
    }
  }

  /**
   * Sign + ingest + gossip a cross-sign or revoke for the unlocked identity.
   * @param {object} fields { peerPubkey, nonce }
   * @param {string} [kind]
   */
  async publishLocalIdentityCrossSign (fields, kind) {
    const IdentityCluster = require('../functions/identityCluster');
    const { signCrossSign } = require('../functions/identityCrossSignVerify');
    if (!this._identity) throw new Error('Identity is locked');
    const k = kind || IdentityCluster.SIGN_TYPE;
    const obj = signCrossSign(this._identity, fields, k);
    this._ingestIdentityCrossSign(obj, this._identity.pubkey);
    await this._ensureFabric().catch(() => null);
    this._gossipIdentityCrossSign(obj);
    this._scheduleAccountDataReplay();
    return obj;
  }

  /**
   * After a cluster edge lands, replay account data over Fabric (not HTTPS).
   * @param {Object} [opts]
   * @param {number} [opts.delay]
   * @param {boolean} [opts.nudge] replace a pending timer
   * @param {boolean} [opts.resetTries]
   */
  _scheduleAccountDataReplay (opts = {}) {
    if (opts.resetTries === true) this._accountReplayTries = 0;
    if (this._accountReplayTimer) {
      if (opts.nudge !== true && !(Number(opts.delay) > 0)) return;
      clearTimeout(this._accountReplayTimer);
      this._accountReplayTimer = null;
    }
    const delay = Number(opts.delay) > 0 ? Number(opts.delay) : 800;
    this._accountReplayTimer = setTimeout(() => {
      this._accountReplayTimer = null;
      try {
        this._replayAccountDataOverFabric();
      } catch (e) {
        this.emit('warning', '[LiveRelay] account replay failed:', e && e.message);
      }
    }, delay);
    if (this._accountReplayTimer && typeof this._accountReplayTimer.unref === 'function') {
      this._accountReplayTimer.unref();
    }
  }

  _rescheduleAccountDataReplay () {
    const n = (this._accountReplayTries || 0) + 1;
    if (n > 32) return;
    this._accountReplayTries = n;
    this._scheduleAccountDataReplay({
      nudge: true,
      delay: Math.min(800 * n, 10000)
    });
  }

  _localClusterInventory () {
    const me = this._identity && this._identity.pubkey;
    const history = clusterInventory.fromHistory(this.history);
    const notes = this.registerStore
      ? identityNotes.listNotes(this.registerStore).length
      : 0;
    let groups = 0;
    if (this.groupManager && Array.isArray(this.groupManager.groups)) {
      for (const row of this.groupManager.groups) {
        if (!row || !row.id) continue;
        if (me && !this.groupManager.isMember(row.id, me) && this.settings.mode !== 'server') {
          continue;
        }
        groups += 1;
      }
    }
    const tags = this.registerStore ? localGroups.listGroups(this.registerStore).length : 0;
    const chat = this.registerStore ? (this.registerStore.all('chatmessages') || []).length : 0;
    const docs = this.registerStore ? localDocuments.list(this.registerStore) : [];
    let files = 0;
    let filesPending = 0;
    for (const row of docs) {
      if (row && row.clusterSync === true) files += 1;
      if (row && row.clusterPending === true) filesPending += 1;
    }
    const peers = clusterSync.localDialCandidates({
      port: Number(this.settings.fabric && this.settings.fabric.port) || 7777,
      advertiseHost: this._fabricAdvertiseHost || null
    }).length;
    const registerMissions = Array.isArray(this.missions) ? this.missions.length : 0;
    return clusterInventory.sanitizeStats(Object.assign({
      notes,
      groups,
      tags,
      chat,
      files,
      filesPending,
      peers,
      registerMissions,
      generatedAt: new Date().toISOString(),
      pubkey: me || undefined
    }, history), { fill: true });
  }

  _localDeviceDataPacks () {
    const me = this._identity && this._identity.pubkey;
    if (!me || !this.registerStore) return [];
    const packs = [];
    packs.push({
      pack: deviceDataSync.PACK_STATS,
      payload: this._localClusterInventory()
    });
    const profile = deviceDataSync.compactProfile({
      pubkey: me,
      nickname: this._nickname,
      bio: this._profile && this._profile.bio,
      scHandle: this._profile && this._profile.scHandle,
      profile: this._profile
    });
    if (profile) packs.push({ pack: deviceDataSync.PACK_PROFILE, payload: profile });

    if (this.groupManager) {
      const groups = [];
      for (const row of this.groupManager.groups || []) {
        if (!row || !row.id) continue;
        if (!this.groupManager.isMember(row.id, me) && this.settings.mode !== 'server') continue;
        let definition = null;
        try {
          definition = this.groupManager._groupDefinition(row);
        } catch (_) { definition = row._contractDefinition || null; }
        groups.push(Object.assign({}, row, { _contractDefinition: definition }));
      }
      if (groups.length) {
        packs.push({ pack: deviceDataSync.PACK_GROUPS, payload: { groups } });
      }
    }

    const notes = identityNotes.listNotes(this.registerStore, {
      author: me,
      includeLocal: true
    });
    if (notes.length) packs.push({ pack: deviceDataSync.PACK_NOTES, payload: { notes } });

    const tags = localGroups.listGroups(this.registerStore);
    if (tags.length) packs.push({ pack: deviceDataSync.PACK_LOCAL_TAGS, payload: { tags } });

    const peersPack = clusterSync.localPeersPack({
      pubkey: me,
      port: Number(this.settings.fabric && this.settings.fabric.port) || 7777,
      advertiseHost: this._fabricAdvertiseHost || null,
      webrtcHubs: this._clusterWebrtcHubs()
    });
    if (peersPack) packs.push(peersPack);

    const clusterFiles = localDocuments.list(this.registerStore)
      .filter((d) => d && d.clusterSync === true);
    if (clusterFiles.length) {
      packs.push({
        pack: deviceDataSync.PACK_FILES,
        payload: { files: clusterFiles.slice(0, deviceDataSync.MAX_FILES) }
      });
    }

    const chatPick = deviceDataSync.selectChatForShare(this.registerStore.all('chatmessages') || []);
    if (chatPick.messages.length) {
      packs.push({
        pack: deviceDataSync.PACK_CHAT,
        truncated: chatPick.truncated,
        payload: { messages: chatPick.messages }
      });
    }
    return packs;
  }

  /**
   * Publish DeviceDataShare + re-gossip group genesis over Fabric so a newly
   * linked device can catch up without HTTPS.
   */
  _replayAccountDataOverFabric () {
    if (!this._identity) return null;
    if (!this.fabricNetwork || !this.fabricNetwork.ready) {
      this._rescheduleAccountDataReplay();
      return null;
    }
    const me = this._identity.pubkey;
    const cluster = this.identityCluster && (
      typeof this.identityCluster.snapshot === 'function'
        ? this.identityCluster.snapshot(me)
        : (typeof this.identityCluster.clusterFor === 'function'
          ? this.identityCluster.clusterFor(me)
          : null)
    );
    if (!cluster || !cluster.members || cluster.members.length < 2) return null;

    if (this.groupManager) {
      for (const row of this.groupManager.groups || []) {
        if (!row || !row.id) continue;
        if (!this.groupManager.isMember(row.id, me) && this.settings.mode !== 'server') continue;
        this._publishGroupContractFor(row).catch((e) => this.emit('error', e));
      }
    }
    if (this.missionManager) {
      for (const mission of (this.missionManager.missions || []).slice(0, 48)) {
        if (!mission || !mission.id) continue;
        this.publishMissionCreated(mission).catch((e) => this.emit('error', e));
      }
    }
    try { this._publishGroupDataShareNow(); } catch (_) { /* optional */ }
    try { this._publishLocalProfile(); } catch (_) { /* optional */ }
    try { this._maybeSendPeerAlias(); } catch (_) { /* optional */ }

    const packs = this._localDeviceDataPacks();
    const shares = deviceDataSync.chunkShares({ fromPubkey: me, packs });
    if (!shares.length) return null;
    const messages = [];
    try {
      for (const payload of shares) {
        const msg = this.fabricNetwork.publishDeviceDataShare(payload);
        if (msg) messages.push(msg);
      }
      this._storeOutboundClusterCollection(messages);
      this._storeOutboundClusterInventory(shares[0]);
      this._dialStoredClusterPeers();
      this._pushClusterFiles();
      this._accountReplayTries = 0;
      const chatPacks = packs.filter((p) => p && p.pack === deviceDataSync.PACK_CHAT);
      const chatN = chatPacks.reduce((n, p) => {
        return n + ((p.payload && Array.isArray(p.payload.messages)) ? p.payload.messages.length : 0);
      }, 0);
      logFabricSync(
        'publish DeviceDataShare',
        'frames=' + messages.length +
          ' packs=' + packs.map((p) => p.pack).join(',') +
          (chatN ? (' chat=' + chatN) : '')
      );
      this.emit('identity:account-replay', {
        fromPubkey: me,
        packs: packs.map((p) => p.pack),
        frames: messages.length,
        chat: chatN
      });
      return shares[shares.length - 1];
    } catch (e) {
      this.emit('warning', '[LiveRelay] DeviceDataShare publish: ' + (e && e.message));
      this._rescheduleAccountDataReplay();
      return null;
    }
  }

  /**
   * Apply a cluster-gated DeviceDataShare. Signer must be this actor's cluster.
   * @param {object} object
   * @param {string} signer
   * @returns {object|null}
   */
  _ingestDeviceDataShare (object, signer) {
    if (!object || !this.registerStore || !this._identity) return null;
    const share = deviceDataSync.sanitizeShare(object);
    if (!share) return null;
    const me = this._identity.pubkey;
    const from = share.fromPubkey;
    if (!this.identityCluster || !this.identityCluster.clusterEquals(me, from)) return null;
    if (signer && !this.identityCluster.clusterEquals(me, signer) && this.settings.mode !== 'server') {
      return null;
    }
    const applied = [];
    this._applyingDeviceDataShare = true;
    try {
    for (const pack of share.packs || []) {
      const name = pack.pack;
      const payload = pack.payload || {};
      try {
        if (name === deviceDataSync.PACK_PROFILE) {
          if (!this._nickname && payload.nickname) {
            this._nickname = payload.nickname;
            settingsStore.putSetting(this.registerStore, 'nickname', payload.nickname);
            applied.push('profile');
          }
          const hasBio = !!(this._profile && (this._profile.bio || this._profile.scHandle));
          if (!hasBio && (payload.bio || payload.scHandle)) {
            this._profile = { bio: payload.bio || null, scHandle: payload.scHandle || null };
            settingsStore.putSetting(this.registerStore, 'profile', this._profile);
            if (applied.indexOf('profile') < 0) applied.push('profile');
          }
        } else if (name === deviceDataSync.PACK_GROUPS && this.groupManager) {
          for (const row of payload.groups || []) {
            if (row.definition) {
              try {
                this.groupManager.ingestContractPublish(row.definition, from);
                applied.push('groups');
              } catch (_) { /* not a group contract */ }
            }
          }
        } else if (name === deviceDataSync.PACK_NOTES) {
          for (const row of payload.notes || []) {
            const n = identityNotes.sanitizeNote(row);
            if (!n) continue;
            const prev = identityNotes.getNote(this.registerStore, n.id);
            if (prev && Number(prev.revision || 0) >= Number(n.revision || 0)) continue;
            this.registerStore.put(identityNotes.COLLECTION, n.id, n);
            applied.push('notes');
          }
        } else if (name === deviceDataSync.PACK_LOCAL_TAGS) {
          for (const row of payload.tags || []) {
            const g = localGroups.sanitizeGroup(row);
            if (!g) continue;
            if (!localGroups.getGroup(this.registerStore, g.id)) {
              this.registerStore.put(localGroups.COLLECTION, g.id, g);
              applied.push('local-tags');
            }
          }
        } else if (name === deviceDataSync.PACK_CHAT && this.chatManager) {
          for (const row of payload.messages || []) {
            try {
              if (!this.chatManager._shareableChannel(row.channel)) continue;
              this.chatManager.post({
                channel: row.channel,
                body: row.body,
                author: row.author,
                handle: row.handle,
                ts: row.ts,
                discordMessageId: row.discordMessageId,
                kind: row.kind,
                source: 'cluster-sync',
                clusterShare: true
              });
              applied.push('chat');
            } catch (_) { /* skip one */ }
          }
        } else if (name === deviceDataSync.PACK_STATS) {
          applied.push('stats');
        } else if (name === deviceDataSync.PACK_PEERS) {
          this._applyClusterPeerPack(payload, from);
          applied.push('peers');
        } else if (name === deviceDataSync.PACK_FILES) {
          if (!this._clusterFileExpect) this._clusterFileExpect = new Set();
          for (const row of payload.files || []) {
            const compact = deviceDataSync.compactFileRow(row);
            if (!compact) continue;
            localDocuments.ensureClusterPlaceholder(this.registerStore, compact);
            this._clusterFileExpect.add(compact.id);
            applied.push('files');
          }
        }
      } catch (e) {
        this.emit('warning', '[LiveRelay] DeviceDataShare pack ' + name + ': ' + (e && e.message));
      }
    }
    this._recordClusterShareInventory(from, share, applied);
    this.emit('identity:account-replay-applied', {
      fromPubkey: from,
      packs: [...new Set(applied)]
    });
    logFabricSync(
      'apply DeviceDataShare',
      'from=' + String(from).slice(0, 12) + ' packs=' + [...new Set(applied)].join(',')
    );
    return share;
    } finally {
      this._applyingDeviceDataShare = false;
    }
  }

  _putClusterPeerRow (pubkey, extra) {
    const key = clusterSync.peerStoreKey(pubkey);
    if (!key || !this.registerStore) return null;
    const prev = this.registerStore.get(clusterSync.STORE_COLLECTION, key) || {};
    const next = Object.assign({}, prev, extra || {}, {
      pubkey: (extra && extra.pubkey) || prev.pubkey || pubkey
    });
    if (Array.isArray(extra && extra.candidates)) {
      next.candidates = extra.candidates;
    } else if (Array.isArray(prev.candidates)) {
      next.candidates = prev.candidates;
    }
    if (extra && extra.inventory && typeof extra.inventory === 'object') {
      next.inventory = extra.inventory;
    } else if (prev.inventory && typeof prev.inventory === 'object') {
      next.inventory = prev.inventory;
    }
    this.registerStore.put(clusterSync.STORE_COLLECTION, key, next);
    return next;
  }

  _recordClusterShareInventory (fromPubkey, share, applied) {
    const incoming = clusterInventory.fromShare(share, {
      pubkey: fromPubkey,
      applied: Array.isArray(applied) ? [...new Set(applied)] : undefined,
      generatedAt: share && share.generatedAt
    });
    const key = clusterSync.peerStoreKey(fromPubkey);
    const prev = key && this.registerStore
      ? this.registerStore.get(clusterSync.STORE_COLLECTION, key)
      : null;
    const inventory = clusterInventory.mergeStats(prev && prev.inventory, incoming);
    return this._putClusterPeerRow(fromPubkey, {
      observedAt: new Date().toISOString(),
      inventory
    });
  }

  _storeOutboundClusterInventory (share) {
    if (!this.registerStore || !share) return null;
    const inventory = clusterInventory.fromShare(share, {
      pubkey: this._identity && this._identity.pubkey,
      fill: true
    });
    this.registerStore.put(
      clusterSync.STORE_COLLECTION,
      clusterSync.LAST_OUTBOUND_STATS_KEY,
      inventory
    );
    return inventory;
  }

  /**
   * HTTPS origins used as Hub WebRTC *registry* coordinators (RegisterWebRTCPeer /
   * ListWebRTCPeers). Node LiveRelay advertises LAN TCP candidates there; it does
   * not host ICE. Passport / Hub browser still use the same hubs for signaling.
   * @returns {string[]}
   */
  _clusterWebrtcHubs () {
    const extra = this.settings && this.settings.fabric && this.settings.fabric.webrtcHubs;
    return clusterSync.sanitizeWebrtcHubs(
      Array.isArray(extra) && extra.length
        ? extra.concat(clusterSync.DEFAULT_WEBRTC_HUBS)
        : clusterSync.DEFAULT_WEBRTC_HUBS
    );
  }

  _storeOutboundClusterCollection (message) {
    if (!this.registerStore) return null;
    const list = Array.isArray(message) ? message : (message ? [message] : []);
    const collection = clusterSync.collectionFromMessages(list);
    if (!collection) return null;
    this.registerStore.put(
      clusterSync.STORE_COLLECTION,
      clusterSync.LAST_OUTBOUND_KEY,
      collection
    );
    return collection;
  }

  _applyClusterPeerPack (payload, fromPubkey) {
    const compact = clusterSync.compactPeers(Object.assign({}, payload, {
      pubkey: (payload && payload.pubkey) || fromPubkey
    }));
    if (!compact) return [];
    this._putClusterPeerRow(compact.pubkey, {
      pubkey: compact.pubkey,
      candidates: compact.candidates,
      webrtc: compact.webrtc,
      observedAt: new Date().toISOString()
    });
    const me = this._identity && this._identity.pubkey;
    const selfCandidates = clusterSync.localDialCandidates({
      port: Number(this.settings.fabric && this.settings.fabric.port) || 7777,
      advertiseHost: this._fabricAdvertiseHost || null
    });
    const allowLoopback = !!(this.settings.fabric && this.settings.fabric.allowLoopbackDiscovery);
    const targets = clusterSync.dialTargets(compact, {
      localPubkey: me,
      selfCandidates,
      allowLoopback
    });
    return this._dialClusterCandidates(targets, compact.pubkey);
  }

  _dialClusterCandidates (addresses, pubkey) {
    if (!this.fabricNetwork || !Array.isArray(addresses) || !addresses.length) return [];
    const allowLoopback = !!(this.settings.fabric && this.settings.fabric.allowLoopbackDiscovery);
    const queued = this.fabricNetwork.dialClusterCandidates(addresses, {
      pubkey,
      allowLoopback
    });
    if (queued.length) this._considerDiscoveredPeers(queued, 'cluster', { pubkey });
    return queued;
  }

  _dialStoredClusterPeers () {
    if (!this.registerStore || !this._identity) return [];
    const me = this._identity.pubkey;
    const queued = [];
    for (const row of this.registerStore.all(clusterSync.STORE_COLLECTION) || []) {
      if (!row || !row.pubkey || !Array.isArray(row.candidates)) continue;
      if (this.identityCluster && !this.identityCluster.clusterEquals(me, row.pubkey)) continue;
      queued.push(...this._applyClusterPeerPack(row, row.pubkey));
    }
    return queued;
  }

  _listLinkedDevices () {
    if (!this.registerStore) return [];
    const persisted = settingsStore.loadSettings(this.registerStore);
    return listLinkedDevices(persisted.linkedDevices);
  }

  /**
   * Re-publish IdentityCrossSign for paired devices that are not yet a cluster
   * edge (desktop overlay closed before the initiator tick, or Fabric was down).
   */
  async _nudgePendingCrossSigns () {
    if (!this._identity || typeof this.publishLocalIdentityCrossSign !== 'function') return 0;
    const now = Date.now();
    if (this._lastCrossSignNudge && now - this._lastCrossSignNudge < 8000) return 0;
    this._lastCrossSignNudge = now;
    const me = this._identity.pubkey;
    const list = this._listLinkedDevices() || [];
    let n = 0;
    for (const row of list) {
      const pk = row.peerPubkey || row.peerPubkeyHex;
      const nonce = row.nonce;
      if (!pk || !nonce) continue;
      if (this.identityCluster && this.identityCluster.clusterEquals(me, pk)) continue;
      try {
        await this.publishLocalIdentityCrossSign({ peerPubkey: pk, nonce });
        n += 1;
      } catch (e) {
        this.emit('warning', '[LiveRelay] IdentityCrossSign nudge: ' + ((e && e.message) || e));
      }
    }
    try { this._replayIdentityCrossSigns(); } catch (_) { /* ignore */ }
    return n;
  }

  _clusterAllowPubkeys () {
    const me = this._identity && this._identity.pubkey;
    const allow = [];
    if (this.identityCluster && me && typeof this.identityCluster.snapshot === 'function') {
      const snap = this.identityCluster.snapshot(me);
      for (const m of (snap && snap.members) || []) allow.push(m);
    }
    for (const d of this._listLinkedDevices()) {
      allow.push(d.peerPubkey || d.peerFabricId);
    }
    return allow.filter(Boolean);
  }

  _clusterMeshHubs () {
    const extra = this.settings && this.settings.fabric && this.settings.fabric.webrtcHubs;
    return clusterSync.sanitizeWebrtcHubs(
      Array.isArray(extra) && extra.length
        ? extra.concat(clusterSync.COORDINATOR_HUBS)
        : clusterSync.COORDINATOR_HUBS
    );
  }

  _startClusterMeshTimer () {
    if (this._clusterMeshTimer) return;
    if (this.settings.fabric && this.settings.fabric.enable === false) return;
    this._clusterMeshTick();
    this._clusterMeshTimer = setInterval(() => this._clusterMeshTick(), clusterMesh.HEARTBEAT_MS);
    if (this._clusterMeshTimer.unref) this._clusterMeshTimer.unref();
  }

  _stopClusterMeshTimer () {
    if (this._clusterMeshTimer) {
      clearInterval(this._clusterMeshTimer);
      this._clusterMeshTimer = null;
    }
  }

  /**
   * Advertise LAN hints on Hub WebRTC (coordinator only) and TCP-dial siblings.
   */
  _clusterMeshTick () {
    if (this._clusterMeshInflight || this._stopping) return this._clusterMeshInflight;
    if (!this._identity) return null;
    if (this.settings.fabric && this.settings.fabric.enable === false) return null;
    const me = this._identity.pubkey;
    const candidates = clusterSync.localDialCandidates({
      port: Number(this.settings.fabric && this.settings.fabric.port) || 7777,
      advertiseHost: this._fabricAdvertiseHost || null
    });
    const hubs = this._clusterMeshHubs();
    this._clusterMeshInflight = clusterMesh.heartbeat({
      hubs,
      pubkey: me,
      candidates,
      port: Number(this.settings.fabric && this.settings.fabric.port) || 7777,
      allowPubkeys: this._clusterAllowPubkeys()
    }).then((out) => {
      const prevReg = ((this._clusterMesh && this._clusterMesh.registered) || []).join('|');
      this._clusterMesh = {
        registered: out.registered || [],
        discovered: out.discovered || [],
        errors: out.errors || [],
        at: Date.now()
      };
      const nextReg = (out.registered || []).join('|');
      if (nextReg && nextReg !== prevReg) {
        logFabricPeer('webrtc-hub', out.registered.join(', '));
      }
      const queued = [];
      for (const hit of out.discovered || []) {
        queued.push(...this._applyClusterPeerPack({
          pubkey: hit.pubkey,
          candidates: hit.candidates,
          webrtc: { hubs: hit.hub ? [hit.hub] : this._clusterMeshHubs() }
        }, hit.pubkey));
      }
      if (queued.length) {
        logFabricPeer('dial', 'webrtc-hub ' + queued.join(', '));
      }
      if (out.errors && out.errors.length) {
        this.emit('warning', '[LiveRelay] cluster mesh: ' + out.errors.map((e) => e.error).join('; '));
      }
      return out;
    }).catch((e) => {
      this._clusterMesh = Object.assign({}, this._clusterMesh, {
        errors: [{ error: (e && e.message) || String(e) }],
        at: Date.now()
      });
      this.emit('warning', '[LiveRelay] cluster mesh: ' + ((e && e.message) || String(e)));
      return null;
    }).finally(() => {
      this._clusterMeshInflight = null;
    });
    return this._clusterMeshInflight;
  }

  _setFileClusterSync (documentId, enabled) {
    const document = localDocuments.setClusterSync(
      this.registerStore,
      documentId,
      enabled === true
    );
    this._scheduleAccountDataReplay();
    if (enabled === true) {
      try { this._pushClusterFiles(); } catch (e) {
        this.emit('warning', '[LiveRelay] cluster file push: ' + (e && e.message));
      }
    }
    return document;
  }

  _clusterConnectionIds () {
    const net = this.fabricNetwork;
    const peer = net && net.peer;
    if (!peer || !this._identity || !this.identityCluster) return [];
    const me = this._identity.pubkey;
    const snap = this.identityCluster.snapshot(me);
    if (!snap || !snap.members || snap.members.length < 2) return [];
    const stored = [];
    try {
      for (const row of (this.registerStore.all(clusterSync.STORE_COLLECTION) || [])) {
        if (!row || !row.pubkey) continue;
        if (!this.identityCluster.clusterEquals(me, row.pubkey)) continue;
        if (String(row.pubkey).toLowerCase() === String(me).toLowerCase()) continue;
        for (const c of row.candidates || []) stored.push(String(c));
      }
    } catch (_) { /* ok */ }
    const out = [];
    for (const id of Object.keys(peer.connections || {})) {
      const reg = net.lookupPeerRegistry(id);
      if (reg && reg.id && this.identityCluster.clusterEquals(me, reg.id) &&
        String(reg.id).toLowerCase() !== String(me).toLowerCase()) {
        out.push(id);
        continue;
      }
      if (stored.some((addr) => FabricNetwork.connectionMatchesAddress(id, addr))) {
        out.push(id);
      }
    }
    return out;
  }

  _pushClusterFiles () {
    if (!this.fabricNetwork || !this.registerStore) return 0;
    const targets = this._clusterConnectionIds();
    if (!targets.length) return 0;
    const files = localDocuments.list(this.registerStore)
      .filter((d) => d && d.clusterSync === true && d.clusterPending !== true);
    if (!files.length) return 0;
    let sent = 0;
    for (const meta of files) {
      let buf = null;
      try {
        const got = localDocuments.get(this.registerStore, meta.id, {
          dir: this._documentsDir(),
          includeContent: true
        });
        const b64 = got && got.document && got.document.contentBase64;
        if (b64) buf = Buffer.from(b64, 'base64');
      } catch (_) { continue; }
      if (!buf || !buf.length) continue;
      sent += this.fabricNetwork.sendCatalogFileToAddresses(targets, buf, {
        documentId: meta.id
      });
    }
    if (sent) logFabricSync('cluster-file push', 'frames=' + sent + ' targets=' + targets.length);
    return sent;
  }

  _expectsClusterFile (documentId) {
    const id = String(documentId || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(id)) return false;
    if (this._clusterFileExpect && this._clusterFileExpect.has(id)) return true;
    if (!this.registerStore) return false;
    try {
      const row = this.registerStore.get(localDocuments.COLLECTION, id);
      return !!(row && row.clusterSync === true);
    } catch (_) {
      return false;
    }
  }

  _ingestClusterFileBytes (ev) {
    if (!ev || !this.registerStore) return null;
    const buf = ev.buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) return null;
    const expected = String(ev.documentId || '').trim().toLowerCase();
    if (!this._expectsClusterFile(expected)) return null;
    try {
      const created = localDocuments.createFromBuffer(
        this.registerStore,
        buf,
        { clusterSync: true },
        { dir: this._documentsDir() }
      );
      if (!created || created.id !== expected) return null;
      logFabricSync('cluster-file ingest', created.id.slice(0, 12));
      this.emit('identity:cluster-file', { id: created.id });
      return created;
    } catch (e) {
      this.emit('warning', '[LiveRelay] cluster file ingest: ' + (e && e.message));
      return null;
    }
  }

  _clusterSyncSnapshot () {
    const me = this._identity && this._identity.pubkey;
    const local = me
      ? clusterSync.compactPeers({
        pubkey: me,
        port: Number(this.settings.fabric && this.settings.fabric.port) || 7777,
        candidates: clusterSync.localDialCandidates({
          port: Number(this.settings.fabric && this.settings.fabric.port) || 7777,
          advertiseHost: this._fabricAdvertiseHost || null
        }),
        advertiseHost: this._fabricAdvertiseHost || null,
        webrtcHubs: this._clusterWebrtcHubs()
      })
      : null;
    const last = this.registerStore
      ? this.registerStore.get(clusterSync.STORE_COLLECTION, clusterSync.LAST_OUTBOUND_KEY)
      : null;
    const lastStats = this.registerStore
      ? this.registerStore.get(clusterSync.STORE_COLLECTION, clusterSync.LAST_OUTBOUND_STATS_KEY)
      : null;
    const peers = (this.registerStore
      ? this.registerStore.all(clusterSync.STORE_COLLECTION)
      : [])
      .filter((row) => clusterSync.isPeerHintRow(row));
    const inbound = [];
    for (const row of peers) {
      if (row.inventory && typeof row.inventory === 'object') {
        inbound.push(clusterInventory.sanitizeStats(Object.assign({
          pubkey: row.pubkey,
          generatedAt: row.inventory.generatedAt || row.observedAt
        }, row.inventory)));
      }
    }
    const cluster = (this.identityCluster && me && typeof this.identityCluster.snapshot === 'function')
      ? this.identityCluster.snapshot(me)
      : { canonical: me || null, members: me ? [me] : [], edges: [] };
    const pending = clusterDevices.pendingFromClusterInstance(this.identityCluster, me);
    const fabricStatus = this.fabricNetwork && typeof this.fabricNetwork.status === 'function'
      ? this.fabricNetwork.status()
      : null;
    return {
      type: 'ClusterSync',
      data: {
        transport: clusterSync.TRANSPORT.slice(),
        local,
        collection: last || null,
        peers,
        members: cluster.members || [],
        edges: cluster.edges || [],
        pending,
        linkedDevices: this._listLinkedDevices(),
        mesh: this._clusterMesh || { registered: [], discovered: [], errors: [], at: 0 },
        fabric: {
          ready: !!(this.fabricNetwork && this.fabricNetwork.ready),
          connected: Number(fabricStatus && fabricStatus.fabricConnected) || 0,
          listening: !!(fabricStatus && fabricStatus.listening)
        },
        inventory: {
          local: this._localClusterInventory(),
          outbound: lastStats || null,
          inbound
        }
      }
    };
  }

  _ingestClusterSyncCollection (doc, viewer) {
    const rows = clusterSync.replayShareCollection(doc);
    const applied = [];
    for (const row of rows) {
      const share = this._ingestDeviceDataShare(row.share, row.author || viewer);
      if (share) applied.push({
        fromPubkey: share.fromPubkey,
        packs: (share.packs || []).map((p) => p.pack),
        hash: row.hash
      });
    }
    return applied.length ? applied : null;
  }

  /**
   * Promote gossip/offer addresses onto the roster (shareLogs off) and dial.
   * @param {string[]} addresses
   * @param {'offer'|'gossip'} kind
   */
  _considerDiscoveredPeers (addresses, kind, meta = {}) {
    if (!Array.isArray(addresses) || !addresses.length) return;
    const selfOpts = this._selfFabricDialOpts();
    const have = new Set(this.peers.map((p) => p.address));
    const discoveredCount = this.peers.filter((p) => p.discovered === true && !FabricNetwork.isNetworkHubAddress(p.address)).length;
    const expectedPubkey = meta.pubkey
      ? String(meta.pubkey).trim().toLowerCase()
      : null;
    if (this._isOwnFabricPubkeyHex(expectedPubkey)) {
      console.log(`[STAR-CITIZEN] ignoring discovered peers (${kind}): pubkey is our own`);
      return;
    }
    let added = 0;
    for (const raw of addresses) {
      const address = FabricNetwork.canonicalizeFabricPeerDial(
        FabricNetwork.normalizeFabricAddress(raw, { migrate: false }),
        selfOpts
      );
      if (!address || have.has(address)) continue;
      if (FabricNetwork.isSelfFabricAddress(address, selfOpts)) continue;
      if (FabricNetwork.isLoopbackFabricAddress(address)) continue;
      if (FabricNetwork.isNetworkHubAddress(address)) continue;
      if (discoveredCount + added >= this._maxDiscoveredPeers) break;
      const peer = {
        id: idFor(address),
        address,
        label: kind === 'gossip' ? 'discovered (gossip)' : 'discovered (offer)',
        enabled: true,
        shareLogs: false,
        discovered: true,
        expectedPubkey: expectedPubkey || null
      };
      this.peers.push(peer);
      have.add(address);
      added += 1;
      this.emit('peer:discovered', peer);
    }
    if (added) {
      this._persistPeers();
      this._refreshFabric().catch((e) => this.emit('error', e));
    }
  }

  /**
   * Refresh Hub /services/peering observe (TCP + WebRTC registration counts).
   * @param {Object} [opts]
   * @param {boolean} [opts.force]
   */
  async _refreshHubObserve (opts = {}) {
    if (this._hubObserveInflight) return this._hubObserveInflight;
    const age = this._hubObserve && this._hubObserve.summary && this._hubObserve.summary.fetchedAt
      ? Date.now() - Date.parse(this._hubObserve.summary.fetchedAt)
      : Infinity;
    if (!opts.force && age < 15000 && this._hubObserve) return this._hubObserve;
    this._hubObserveInflight = hubPeeringObserve.observeHubPeering(undefined, { timeoutMs: 4000 })
      .then((snap) => {
        this._hubObserve = snap;
        return snap;
      })
      .catch((e) => {
        this._hubObserve = {
          hubs: [],
          summary: { observed: 0, online: 0, p2pConnections: 0, webrtcRegistered: 0, error: (e && e.message) || String(e) }
        };
        return this._hubObserve;
      })
      .finally(() => { this._hubObserveInflight = null; });
    return this._hubObserveInflight;
  }

  _isAndroidMode () {
    return this.settings.mode === 'android';
  }

  _skipGameLog () {
    return this.settings.mode === 'server' || this._isAndroidMode();
  }

  /**
   * CORS for the Capacitor WebView on the same device talking to loopback LiveRelay.
   * @param {http.IncomingMessage} req
   * @returns {Object}
   */
  _localDashboardCorsHeaders (req) {
    if (!this._isAndroidMode()) return {};
    const origin = String((req.headers && req.headers.origin) || '');
    const allow = origin && (
      /^https?:\/\/localhost(?::\d+)?$/i.test(origin) ||
      /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(origin) ||
      /^capacitor:\/\//i.test(origin)
    );
    if (!allow) return {};
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Cache-Control, X-Requested-With',
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin'
    };
  }

  _startHubObserveTimer () {
    if (this._hubObserveTimer || this.settings.mode === 'server' || this._isAndroidMode()) return;
    this._refreshHubObserve().catch(() => {});
    this._hubObserveTimer = setInterval(() => {
      this._refreshHubObserve({ force: true }).catch(() => {});
    }, 60000);
    if (this._hubObserveTimer.unref) this._hubObserveTimer.unref();
  }

  /** Map persisted snapshot* settings onto the SnapshotManager (live). */
  _applySnapshotSettings (persisted) {
    if (!this.snapshotManager) return;
    this.snapshotManager.configure({
      enabled: persisted.snapshotsEnabled !== undefined ? persisted.snapshotsEnabled : undefined,
      intervalMs: persisted.snapshotIntervalSeconds !== undefined ? Number(persisted.snapshotIntervalSeconds) * 1000 : undefined,
      autoPurge: persisted.snapshotAutoPurge !== undefined ? persisted.snapshotAutoPurge : undefined,
      maxBytes: persisted.snapshotMaxMB !== undefined ? Number(persisted.snapshotMaxMB) * 1024 * 1024 : undefined
    });
  }

  /**
   * Provide the platform screen-capture function (Electron main). While set
   * and snapshots are enabled, the manager captures on its interval.
   * @param {Function|null} fn async () => ({ buffer, width, height }).
   */
  setSnapshotCapture (fn) {
    if (this.snapshotManager) this.snapshotManager.setCapture(fn);
  }

  /** Blob directory for this node's document catalog (null in memory-only tests). */
  _documentsDir () {
    return this.settings.settingsDir
      ? localDocuments.documentsDir(this.settings.settingsDir)
      : null;
  }

  _documentOfferAliases () {
    return this._peerAliasByPubkey || {};
  }

  _documentOfferSelf () {
    const pubkey = this._identity && this._identity.pubkey;
    return {
      peerPubkey: pubkey || null,
      peerAlias: 'this node'
    };
  }

  _documentCatalogPayload () {
    const local = localDocuments.list(this.registerStore);
    const offers = documentOffers.list(this.registerStore);
    const documents = documentOffers.mergeCatalog(local, offers, {
      self: this._documentOfferSelf(),
      aliases: this._documentOfferAliases()
    });
    return { documents, offers };
  }

  _documentDetailPayload (documentId) {
    const id = String(documentId || '').trim();
    let got = null;
    let local = true;
    try {
      got = localDocuments.get(this.registerStore, id, { dir: this._documentsDir() });
    } catch (e) {
      if (!e || e.status !== 404) throw e;
      got = documentOffers.remoteDocument(this.registerStore, id, {
        aliases: this._documentOfferAliases()
      });
      local = false;
      if (!got) throw e;
    }
    const localDoc = got && got.document ? got.document : got;
    const offers = documentOffers.offersForDocument({
      store: this.registerStore,
      documentId: id,
      localDoc: local ? localDoc : null,
      self: this._documentOfferSelf(),
      aliases: this._documentOfferAliases()
    });
    return {
      document: localDoc,
      offers,
      local: !!(localDoc && localDoc.local !== false)
    };
  }

  _onDocumentInventoryRequest (ev) {
    const originName = ev && ev.origin && (ev.origin.name != null ? ev.origin.name : ev.origin);
    if (!originName) return;
    const items = documentOffers.inventoryItemsFromLocal(
      localDocuments.list(this.registerStore, { includeBlobIndex: true })
    );
    const peer = (ev && ev.peer) || (this.fabricNetwork && this.fabricNetwork.peer);
    documentOffers.replyInventory(peer, String(originName), items);
  }

  _onDocumentInventoryResponse (ev) {
    if (!this.registerStore) return;
    const items = documentOffers.itemsFromInventoryMessage(ev && ev.message);
    const originName = ev && ev.origin && (ev.origin.name != null ? ev.origin.name : ev.origin);
    const address = originName ? String(originName) : null;
    const signer = ev && ev.signerPubkeyHex ? String(ev.signerPubkeyHex).toLowerCase() : null;
    const reg = this.fabricNetwork && address
      ? this.fabricNetwork.lookupPeerRegistry(address)
      : null;
    const pubkey = documentOffers.peerKeyFromHex(signer)
      || (reg && documentOffers.peerKeyFromHex(reg.id))
      || null;
    const alias = (pubkey && this._peerAliasByPubkey && this._peerAliasByPubkey[pubkey])
      || (reg && (reg.alias || reg.nickname))
      || null;
    documentOffers.replacePeerOffers(this.registerStore, {
      peerPubkey: pubkey,
      peerAddress: address,
      peerAlias: alias
    }, items);
  }

  _queryPeerInventories () {
    const net = this.fabricNetwork;
    const peer = net && net.peer;
    const asked = documentOffers.requestConnectedInventories(peer);
    return {
      requested: asked.requested,
      peers: asked.peers,
      ready: !!(net && net.ready),
      offers: documentOffers.list(this.registerStore)
    };
  }

  /**
   * Create a catalog row from JSON `contentBase64` or loopback `filePath`
   * (build artifacts under this repo — see functions/publishBuildDocuments).
   * @param {http.IncomingMessage} req
   * @param {object} d
   * @returns {object}
   */
  _ingestLocalDocument (req, d = {}) {
    const publishBuildDocuments = require('../functions/publishBuildDocuments');
    const { isLoopbackRequest } = require('../functions/isLoopbackRequest');
    const dir = this._documentsDir();
    if (d.filePath) {
      if (!isLoopbackRequest(req)) {
        const err = new Error('filePath ingest is loopback-only');
        err.status = 403;
        throw err;
      }
      const repoRoot = path.resolve(__dirname, '..');
      const abs = publishBuildDocuments.resolveIngestPath(d.filePath, repoRoot);
      return localDocuments.createFromFile(this.registerStore, abs, {
        name: d.name,
        mime: d.mime || publishBuildDocuments.mimeForFilename(d.name || abs),
        author: d.author
      }, { dir });
    }
    return localDocuments.create(this.registerStore, d || {}, { dir });
  }

  _documentPublishOpts (override = {}) {
    const documentBlobPrice = require('../functions/documentBlobPrice');
    return {
      dir: this._documentsDir(),
      policy: documentBlobPrice.policyFromSettings(this.settings, override)
    };
  }

  /**
   * Create + publish a file on this node's catalog for a chat attach.
   * @param {object} file
   * @param {number} [price]
   * @param {string} [author]
   * @returns {object} Chat attachment meta
   */
  _createLocalChatAttachment (file = {}, price, author) {
    const chatAttachment = require('../functions/chatAttachment');
    const created = localDocuments.create(this.registerStore, {
      name: file.name,
      mime: file.mime,
      contentBase64: file.contentBase64,
      size: file.size,
      author: author || null
    }, { dir: this._documentsDir() });
    const override = {};
    if (price != null && Number.isFinite(Number(price))) {
      override.purchasePriceSats = Math.max(0, Math.floor(Number(price)));
    }
    const published = localDocuments.publish(
      this.registerStore,
      created.id,
      this._documentPublishOpts(override)
    );
    if (this._hasPinnedProfileFiles()) this._publishGroupDataShareNow();
    return chatAttachment.normalizeAttachment({
      documentId: published.id,
      name: published.name,
      mime: published.mime,
      purchasePriceSats: published.purchasePriceSats,
      size: published.size
    });
  }

  /**
   * Best-effort Discord bot post (caption only). Throws mapped errors.
   * @param {string} discordChannelId
   * @param {string} handle
   * @param {string} text
   * @returns {Promise<object>}
   */
  async _postDiscordBridgeText (discordChannelId, handle, text) {
    if (!this._discordBotReady || !this.discordBot) {
      const err = new Error('Discord bot not ready');
      err.status = 503;
      throw err;
    }
    const dirSettings = settingsStore.loadSettings(this.registerStore);
    if (!discordChatDirection.isDiscordOutboundAllowed(discordChannelId, dirSettings)) {
      const err = new Error('Channel is listen-only — Chat → Discord posting is disabled for this channel');
      err.status = 403;
      throw err;
    }
    try {
      return await this.discordBot.postToChannel(discordChannelId, {
        content: discordIdentityLink.formatOutboundDiscordContent(handle, text)
      });
    } catch (discordErr) {
      const mapped = discordGuildCatalog.formatDiscordBridgeError(discordErr);
      const err = new Error(mapped.error);
      err.status = mapped.status;
      throw err;
    }
  }

  /** Persist the peer roster into the Fabric Store (runtime fields stripped). */
  _persistPeers () {
    if (!this.registerStore || !this.registerStore.persistent) return;
    settingsStore.putSetting(this.registerStore, 'peers', this.peers.map(({ lastSeen, lastError, ...p }) => p));
  }

  /**
   * LevelDB path for the Fabric-backed register Store, or null for memory-only.
   * Priority: registerPath → missions.dir → groups.dir → settingsDir/register
   * (settingsDir is the Hub-style named root, e.g. stores/gooncitizen).
   */
  _resolveRegisterPath () {
    const explicit = this.settings.registerPath
      || (this.settings.missions && this.settings.missions.dir)
      || (this.settings.groups && this.settings.groups.dir)
      || null;
    if (explicit) return explicit;
    if (this.settings.settingsDir) {
      return path.join(this.settings.settingsDir, 'register');
    }
    return null;
  }

  /**
   * Durable history.json — requires settingsDir (desktop / npm start) or an
   * explicit historyFile. Without either, cumulative state stays in-memory for
   * the process (unit tests) and is not loaded from a shared repo path.
   */
  _historyFile () {
    if (this.settings.historyFile) return this.settings.historyFile;
    if (this.settings.settingsDir) return cumulativeHistory.historyPath(this.settings.settingsDir);
    return null;
  }

  _cursorsFile () {
    if (this.settings.cursorsFile) return this.settings.cursorsFile;
    if (this.settings.settingsDir) return cumulativeHistory.cursorsPath(this.settings.settingsDir);
    return null;
  }

  _loadHistory () {
    try {
      return cumulativeHistory.loadHistory(this._historyFile());
    } catch (e) {
      console.error('[STAR-CITIZEN] history load failed:', e.message);
      return cumulativeHistory.emptyHistory();
    }
  }

  _loadLogCursors () {
    try {
      return cumulativeHistory.loadCursors(this._cursorsFile());
    } catch (e) {
      console.error('[STAR-CITIZEN] log cursors load failed:', e.message);
      return {};
    }
  }

  _markHistoryDirty () {
    this._historyDirty = true;
    if (this._historyFlushTimer || this.settings.mode === 'server') return;
    this._historyFlushTimer = setTimeout(() => {
      this._historyFlushTimer = null;
      this._flushHistory();
    }, 2000);
    if (this._historyFlushTimer.unref) this._historyFlushTimer.unref();
  }

  _flushHistory () {
    if (!this._historyDirty) return;
    try {
      cumulativeHistory.saveHistory(this._historyFile(), this.history);
      cumulativeHistory.saveCursors(this._cursorsFile(), this._logCursors);
      this._historyDirty = false;
    } catch (e) {
      console.error('[STAR-CITIZEN] history flush failed:', e.message);
    }
  }

  /**
   * Startup (and catch-up): fold every locatable Game.log + logbackup into
   * durable history using byte cursors. Only new bytes are read. Does not
   * mutate live session collections — seed/openLog still own the Live tab feed.
   */
  async _syncCumulativeHistory () {
    if (this._skipGameLog()) return { changed: false, files: 0, lines: 0 };

    const explicitDirs = this.settings.reparse && Array.isArray(this.settings.reparse.dirs)
      ? this.settings.reparse.dirs
      : null;

    let files;
    if (explicitDirs) {
      const seen = new Set();
      files = [];
      for (const dir of explicitDirs) {
        for (const f of logCorpus.findLogs(dir)) {
          const abs = path.resolve(f);
          if (!seen.has(abs)) { seen.add(abs); files.push(abs); }
        }
      }
      if (this.settings.logfile && fs.existsSync(this.settings.logfile)) {
        const abs = path.resolve(this.settings.logfile);
        if (!seen.has(abs)) files.push(abs);
      }
    } else if (this.settings.settingsDir || this.settings.logfile) {
      // Desktop / npm start: all install channels + logbackups + ./Gamelogs +
      // operator-imported dirs (Analyze file browser) + live log.
      files = logCorpus.discoverCorpusFiles({
        logfile: this.settings.logfile || null,
        repoRoot: path.join(__dirname, '..'),
        extraDirs: this._corpusDirs(),
        extraFiles: this._corpusFiles()
      });
    } else {
      return { changed: false, files: 0, lines: 0 };
    }

    if (!files.length) return { changed: false, files: 0, lines: 0 };

    const result = await cumulativeHistory.syncFiles(
      files,
      this.history,
      this._logCursors,
      (done, total) => {
        if (done === total || done === 1) {
          console.log(`[STAR-CITIZEN] cumulative sync ${done}/${total} log files`);
        }
      }
    );
    this._historyIndex = result.index || cumulativeHistory.indexHistory(this.history);
    logCorpus.stampHistoryOwnership(this.history, {
      ownerPubkey: (this._identity && this._identity.pubkey) || null,
      fileCount: files.length
    });
    if (result.changed || result.lines > 0 || files.length) {
      this._historyDirty = true;
      this._flushHistory();
    }
    if (result.lines > 0) {
      const c = cumulativeHistory.cumulativeCounts(this.history);
      console.log(`[STAR-CITIZEN] cumulative history: ${c.missions} missions · ${c.deaths} deaths · ${c.players} pilots (${result.lines} new lines · ${files.length} files)`);
    }
    // Fold ended Game.log missions into the officer register (evidence rows).
    try { this._foldHistoryMissionsIntoRegister(); } catch (e) { this.emit('error', e); }
    if (this._sharePlaytimes === true || this._hasPinnedProfileFiles()) {
      this._publishGroupDataShareNow();
    }
    return Object.assign({}, result, { files: files.length });
  }

  /**
   * Upsert cumulative-history mission ends into MissionManager (idempotent).
   * @returns {{ created: number, updated: number }}
   */
  _foldHistoryMissionsIntoRegister () {
    if (!this.missionManager || !this.history || !Array.isArray(this.history.missions)) {
      return { created: 0, updated: 0 };
    }
    let created = 0;
    let updated = 0;
    for (const row of this.history.missions) {
      const snap = gameLogMissionRegister.snapshotFromHistoryRow(row);
      if (!snap) continue;
      const r = this.missionManager.upsertFromGameLog(snap);
      if (r.created) created += 1;
      else if (r.updated) updated += 1;
    }
    if (created || updated) {
      console.log(`[STAR-CITIZEN] register ← Game.log history: +${created} new · ${updated} updated`);
    }
    return { created, updated };
  }

  /**
   * Mirror a live missionGroups entry into the register.
   * @param {Object} group missionGroups[id] blob
   */
  _syncGameLogMissionToRegister (group) {
    if (!this.missionManager || !group || !group.id) return null;
    if (!gameLogMissionRegister.isTrackableMissionId(group.id)) return null;
    const last = group.notifications && group.notifications.length
      ? group.notifications[group.notifications.length - 1]
      : null;
    const snap = gameLogMissionRegister.snapshotFromGameLog({
      missionId: group.id,
      scMissionId: group.id,
      generator: group.generator || null,
      text: last && last.text,
      outcome: group.outcome || null,
      reason: group.reason || null,
      player: group.player || this._sessionHandle || null,
      contractId: group.contractId || null,
      startedAt: group.startedAt || null,
      endedAt: group.endedAt || null,
      firstSeen: group.firstSeen || null
    });
    if (!snap) return null;
    return this.missionManager.upsertFromGameLog(snap);
  }

  /** Operator-imported directories (Feed file browser). */
  _corpusDirs () {
    if (!this.registerStore) return [];
    const persisted = settingsStore.loadSettings(this.registerStore);
    return fsBrowser.sanitizeCorpusDirs(persisted.corpusDirs);
  }

  /** Operator-selected individual log files (Feed file browser). */
  _corpusFiles () {
    if (!this.registerStore) return [];
    const persisted = settingsStore.loadSettings(this.registerStore);
    return fsBrowser.sanitizeCorpusFiles(persisted.corpusFiles);
  }

  /**
   * Persist imported corpus dirs and/or files; optionally sync into history.
   * @param {Object} [opts]
   * @param {string[]} [opts.dirs]
   * @param {string[]} [opts.files]
   * @param {boolean} [opts.sync]
   * @param {boolean} [opts.replaceDirs]
   * @param {boolean} [opts.replaceFiles]
   */
  async _importCorpus (opts = {}) {
    if (!this.registerStore || !this.registerStore.persistent) {
      throw new Error('No persistent store configured (settingsDir)');
    }
    if (opts.dirs !== undefined) {
      // Allow relative paths (e.g. "samples") resolved from the relay cwd / repo root.
      const resolved = (opts.dirs || []).map((d) => {
        if (typeof d !== 'string' || !d.trim()) return d;
        return path.isAbsolute(d.trim()) ? d.trim() : path.resolve(process.cwd(), d.trim());
      });
      const incoming = fsBrowser.sanitizeCorpusDirs(resolved);
      const next = opts.replaceDirs
        ? incoming
        : fsBrowser.sanitizeCorpusDirs(this._corpusDirs().concat(incoming));
      settingsStore.putSetting(this.registerStore, 'corpusDirs', next.length ? next : null);
    }
    if (opts.files !== undefined) {
      const incoming = fsBrowser.sanitizeCorpusFiles(opts.files);
      const next = opts.replaceFiles
        ? incoming
        : fsBrowser.sanitizeCorpusFiles(this._corpusFiles().concat(incoming));
      settingsStore.putSetting(this.registerStore, 'corpusFiles', next.length ? next : null);
    }
    let result = null;
    if (opts.sync !== false) {
      result = await this._syncCumulativeHistory();
    }
    return {
      type: 'LogCorpusImport',
      importedDirs: this._corpusDirs(),
      importedFiles: this._corpusFiles(),
      result,
      corpus: this._corpusStatus()
    };
  }

  /** List of log files that feed Analyze (live + backups + corpus). */
  _discoverCorpusFileList () {
    if (this.settings.reparse && Array.isArray(this.settings.reparse.dirs)) {
      const seen = new Set();
      const files = [];
      for (const dir of this.settings.reparse.dirs) {
        for (const f of logCorpus.findLogs(dir)) {
          const abs = path.resolve(f);
          if (!seen.has(abs)) { seen.add(abs); files.push(abs); }
        }
      }
      if (this.settings.logfile && fs.existsSync(this.settings.logfile)) {
        const abs = path.resolve(this.settings.logfile);
        if (!seen.has(abs)) files.push(abs);
      }
      return files;
    }
    return logCorpus.discoverCorpusFiles({
      logfile: this.settings.logfile || null,
      repoRoot: path.join(__dirname, '..'),
      extraDirs: this._corpusDirs(),
      extraFiles: this._corpusFiles()
    });
  }

  _corpusStatus () {
    const summary = logCorpus.summarizeCorpus({
      files: this._discoverCorpusFileList(),
      cursors: this._logCursors,
      history: this.history,
      liveLogfile: this.settings.logfile || null
    });
    summary.importedDirs = this._corpusDirs();
    summary.importedFiles = this._corpusFiles();
    return summary;
  }

  /** Fold a live (or ingested) parsed event into durable history. */
  _applyHistoryEvent (ev, extra = {}) {
    if (!ev) return;
    if (!this._historyApplyLive && !extra.force) return;
    if (ev.kind === 'mission:marker' && ev.missionId) {
      this._historyGenerators[ev.missionId] = ev.generator;
    }
    const changed = cumulativeHistory.applyLiveEvent(this.history, this._historyIndex, ev, {
      handle: extra.handle || this._sessionHandle,
      generators: this._historyGenerators,
      countHeat: extra.countHeat !== false
    });
    if (changed) {
      this._markHistoryDirty();
      if (this.eventChain && eventChain.available) {
        try {
          eventChain.appendEvent(this.eventChain, ev, {
            source: (this._identity && this._identity.pubkey) || extra.handle || this._sessionHandle || null
          });
        } catch (e) { this.emit('error', e); }
      }
      this.emit('history:updated', { via: 'event', kind: ev.kind });
    }
  }

  /**
   * Compact game-state document for Hub sidechain `/services/rsi` (beacon-sealed).
   * @param {Object} [opts]
   * @param {string|null} [opts.source]
   */
  buildGameStateSnapshot (opts = {}) {
    return gooncitizenGameState.buildGameStateSnapshot(this.history, {
      source: opts.source || (this._identity && this._identity.pubkey) || null,
      sources: this.history && this.history._sources
    });
  }

  /**
   * Merge a peer GameStateSnapshot into cumulative history (hub / desktop).
   * @returns {{ changed: Boolean, snapshot: Object|null }}
   */
  ingestGameStateSnapshot (source, snap) {
    if (!snap || typeof snap !== 'object') return { changed: false, snapshot: null };
    const changed = gooncitizenGameState.mergeSnapshotIntoHistory(
      this.history,
      this._historyIndex,
      snap,
      source || null
    );
    if (changed) {
      this._markHistoryDirty();
      this.emit('history:updated', { via: 'GameStateSnapshot', source });
    }
    return { changed, snapshot: this.buildGameStateSnapshot() };
  }

  /** Publish local cumulative snapshot over Fabric (share-consent-gated). */
  async publishGameStateSnapshot () {
    const opts = this._logSharePublishOpts();
    if (!opts) return null;
    await this._ensureFabric();
    if (!this.fabricNetwork || !this.fabricNetwork.ready) return null;
    const snap = this.buildGameStateSnapshot({ source: this._identity.pubkey });
    try {
      this.fabricNetwork.publishGameStateSnapshot(snap, opts);
      this.emit('gamestate:published', { digest: snap.digest, counts: snap.counts });
      return snap;
    } catch (e) {
      this.emit('error', e);
      return null;
    }
  }

  _touchLogCursor () {
    if (!this.settings.logfile || this._skipGameLog()) return;
    try {
      const st = fs.statSync(this.settings.logfile);
      const key = path.resolve(this.settings.logfile);
      this._logCursors[key] = { size: st.size, mtimeMs: st.mtimeMs };
      this._markHistoryDirty();
    } catch (_) { /* log gone mid-rotation */ }
  }

  // Cumulative history is the analytics source of truth. Active (not-yet-ended)
  // missions from the live session are merged in so the current flight still shows.
  _analyticsDataset () {
    const h = this.history || cumulativeHistory.emptyHistory();
    const me = this._sessionHandle || 'you';
    const liveActive = this.missionGroups
      .filter((m) => m.startedAt && !m.outcome)
      .map((m) => ({
        type: m.type,
        faction: missionFaction(m.generator),
        outcome: null,
        player: m.player || me,
        ts: m.startedAt || m.firstSeen,
        active: true
      }))
      .filter((x) => x.ts);

    const heat = Object.assign({}, h.heat);
    const heatcells = Object.keys(heat).map((k) => {
      const p = k.split('|');
      return { ym: p[0], d: +p[1], h: +p[2], n: heat[k] };
    });

    const missions = (h.missions || []).concat(liveActive);
    const deaths = h.deaths || [];
    const sessions = h.sessions || [];
    const quantum = h.quantum || [];
    const incap = h.incap || [];
    const crimestat = h.crimestat || [];
    const ymOf = (s) => (typeof s === 'string' && s.length >= 7) ? s.slice(0, 7) : null;
    const months = new Set();
    missions.forEach((m) => { const y = ymOf(m.ts); if (y) months.add(y); });
    deaths.forEach((d) => { const y = ymOf(d.ts); if (y) months.add(y); });
    quantum.forEach((q) => { const y = ymOf(q.ts); if (y) months.add(y); });
    incap.forEach((i) => { const y = ymOf(i.ts); if (y) months.add(y); });
    crimestat.forEach((c) => { const y = ymOf(c.ts); if (y) months.add(y); });
    heatcells.forEach((c) => months.add(c.ym));
    const players = [...new Set([].concat(
      h.players || [],
      this.players.map((p) => p.name),
      missions.map((m) => m.player),
      deaths.map((d) => d.player),
      quantum.map((q) => q.player),
      incap.map((i) => i.player),
      crimestat.map((c) => c.player)
    ))].filter(Boolean);

    const corpus = this._corpusStatus();
    return {
      type: 'Analytics',
      generatedAt: (h.meta && (h.meta.lastFlushAt || h.meta.generatedAt)) || null,
      cumulative: true,
      availableMonths: [...months].sort().reverse(),
      players,
      missions: missions.slice(-20000),
      deaths: deaths.slice(-20000),
      sessions,
      quantum: quantum.slice(-20000),
      incap: incap.slice(-20000),
      crimestat: crimestat.slice(-20000),
      heatcells,
      counts: cumulativeHistory.cumulativeCounts(h),
      corpus,
      sources: {
        fileCount: corpus.fileCount || 0,
        importedDirs: (corpus.importedDirs || []).length,
        importedFiles: (corpus.importedFiles || []).length,
        pendingFiles: corpus.pendingFiles || 0
      },
      ownerPubkey: (h.meta && h.meta.ownerPubkey) || (this._identity && this._identity.pubkey) || null
    };
  }

  /**
   * Build (and optionally publish) a Fabric Tree of cumulative history leaves
   * into a Group Contract namespace.
   */
  async publishActivityTreeToGroup (groupId, opts = {}) {
    if (!this.groupManager) throw new Error('groups unavailable');
    const group = this.groupManager.getGroup(groupId);
    if (!group || !group.contractId) throw new Error('group not found or missing contractId');
    const tree = activityTree.buildActivityTree(this.history, {
      ownerPubkey: (this._identity && this._identity.pubkey) || null
    });
    const body = activityTree.toContractBody(tree, {
      contractId: group.contractId,
      groupId: group.id
    });
    this.groupManager.ingestActivityTree(group.id, body, body.ownerPubkey);
    let published = null;
    if (opts.publish !== false) {
      await this._ensureFabric();
      if (this.fabricNetwork && this.fabricNetwork.ready && this._identity) {
        published = this.fabricNetwork.publishGroupActivityTree(group.contractId, body);
      }
    }
    return { tree: body, published: !!published, groupId: group.id, contractId: group.contractId };
  }

  get activities () { return Object.values(this.state.activities); }
  get players () { return Object.values(this.state.players); }   // distinct handles
  get logins () { return Object.values(this.state.logins); }     // every login event
  get vehicles () { return Object.values(this.state.vehicles); }
  get kills () { return Object.values(this.state.kills); }
  get incaps () { return Object.values(this.state.incaps); }              // player down (revivable) events
  get deaths () { return Object.values(this.state.deaths); }              // local-player deaths (corpse-recovery signal)
  get missionlog () { return Object.values(this.state.missionlog); }
  get notifications () { return Object.values(this.state.notifications); }  // general HUD/zone notices
  get combatlog () { return Object.values(this.state.combatlog); }          // combat progress via mission objectives

  // Missions grouped by MissionId, with their objectives joined in by ObjectiveId.
  get missionGroups () {
    return Object.values(this.state.missionGroups).map((m) => {
      const objectives = Object.keys(m.objectiveIds).map((oid) => this.state.objectives[oid]).filter(Boolean);
      const last = m.notifications[m.notifications.length - 1];
      // Lifecycle status: an explicit outcome (Complete/Abandon/Fail/Deactivate) once
      // ended, else 'Active' if we saw it start, else null (seen only via objectives).
      const status = m.outcome || (m.startedAt ? 'Active' : null);
      return { id: m.id, title: last ? last.text : null, generator: m.generator || null, type: missionType(m.generator),
        firstSeen: m.firstSeen, lastSeen: m.lastSeen,
        startedAt: m.startedAt || null, endedAt: m.endedAt || null, outcome: m.outcome || null, reason: m.reason || null,
        status, contractId: m.contractId || null, player: m.player || null,
        objectives, notifications: m.notifications };
    });
  }

  // Mission-outcome tallies for the dashboard, computed from the grouped missions.
  // Local player only + self-reported (see DESIGN-mission-dashboard.md / D-005).
  missionStats () {
    const s = { accepted: 0, completed: 0, abandoned: 0, failed: 0, deactivated: 0, active: 0 };
    for (const m of Object.values(this.state.missionGroups)) {
      if (m.startedAt) s.accepted += 1;
      switch (m.outcome) {
        case 'Complete': s.completed += 1; break;
        case 'Abandon': s.abandoned += 1; break;
        case 'Fail': s.failed += 1; break;
        case 'Deactivate': s.deactivated += 1; break;
        default: if (m.startedAt) s.active += 1;   // started, no outcome yet
      }
    }
    return s;
  }
  get logs () { return Object.values(this.state.logs); }
  get missions () { return this.missionManager ? this.missionManager.missions : []; }
  get status () { return this.state.status; }

  // ---- HTTP ----

  /**
   * Embeddable request handler for hosting the API inside another HTTP
   * server (e.g. the goon.vc Hub). Handles /services/star-citizen/* and
   * returns true; returns false (without touching the response) for
   * unrelated paths so the host can route them elsewhere.
   * @returns {Function} async (req, res) => Boolean
   */
  apiHandler () {
    const base = '/services/star-citizen';
    return async (req, res) => {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      // Fabric site login (D-011) lives at the HTTP root so Passport / desktop
      // can use the same /sessions contract as Hub when this service is the
      // public origin (relay.goon.vc).
      if (pathname === '/sessions' || pathname.startsWith('/sessions/')) {
        await this._handle(req, res);
        return true;
      }
      // Hub-compatible discovery: OPTIONS / ARC + GET /services/peering.
      if (pathname === '/' || pathname === '/services/peering' ||
          pathname.startsWith('/services/peering/')) {
        await this._handle(req, res);
        return true;
      }
      if (pathname !== base && !pathname.startsWith(`${base}/`)) return false;
      await this._handle(req, res);
      return true;
    };
  }

  // ---- Signed ingest (remote relays -> hosted server) ----

  /**
   * Verify a Schnorr envelope and check the optional sender allowlist.
   * @param {Object} envelope { pubkey, payload, signature }
   * @returns {{ ok: Boolean, error: String|null, code: Number }}
   */
  _checkEnvelope (envelope) {
    if (!envelope || !envelope.pubkey || !envelope.signature || envelope.payload === undefined) {
      return { ok: false, code: 401, error: 'Signed envelope required: { pubkey, payload, signature }' };
    }
    const allowed = this.settings.ingest.allowedKeys;
    if (Array.isArray(allowed) && allowed.length && !allowed.includes(envelope.pubkey)) {
      return { ok: false, code: 403, error: 'Sender key is not on the roster' };
    }
    if (!identityLib().verifyEnvelope(envelope)) {
      return { ok: false, code: 401, error: 'Invalid signature' };
    }
    return { ok: true, code: 200, error: null };
  }

  // ---- Auth sessions (Schnorr login) ----

  /**
   * Resolve the authenticated pubkey for a request from its Bearer session.
   * @returns {String|null} Pubkey, or null when unauthenticated/expired.
   */
  _authPubkey (req) {
    const header = (req.headers && req.headers.authorization) || '';
    if (!header.startsWith('Bearer ')) return null;
    const session = this._sessions[header.slice(7)];
    if (!session) return null;
    if (session.expiresAt < Date.now()) { delete this._sessions[session.token]; return null; }
    return session.pubkey;
  }

  /**
   * Issue a session for a Schnorr login envelope:
   * `{ pubkey, payload: { intent: 'login', ts }, signature }` where `ts` is
   * within 5 minutes of server time (replay damping).
   * @returns {{ token, pubkey, expiresAt }|{ error, code }}
   */
  _login (envelope) {
    const check = this._checkEnvelope(envelope);
    if (!check.ok) return { error: check.error, code: check.code };
    const p = envelope.payload || {};
    if (p.intent !== 'login') return { error: 'payload.intent must be "login"', code: 400 };
    const ts = Date.parse(p.ts);
    if (Number.isNaN(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
      return { error: 'payload.ts must be within 5 minutes of server time', code: 401 };
    }
    const token = crypto.randomBytes(24).toString('hex');
    const session = {
      token,
      pubkey: envelope.pubkey,
      createdAt: Date.now(),
      expiresAt: Date.now() + BEARER_TTL_MS
    };
    this._sessions[token] = session;
    // Cap session table growth.
    const keys = Object.keys(this._sessions);
    if (keys.length > 5000) delete this._sessions[keys[0]];
    return { token, pubkey: session.pubkey, expiresAt: new Date(session.expiresAt).toISOString() };
  }

  /**
   * Drop a Bearer session (logout / revoke). Returns true when a session was removed.
   * @param {object} req
   * @returns {boolean}
   */
  _revokeBearerSession (req) {
    const header = (req.headers && req.headers.authorization) || '';
    if (!header.startsWith('Bearer ')) return false;
    const token = header.slice(7);
    if (!this._sessions[token]) return false;
    delete this._sessions[token];
    return true;
  }

  /**
   * True when this HTTP peer must present a Schnorr/Bearer session for writes
   * (`SC_MODE=server`, or `httpSharedMode` from a non-loopback address).
   * @param {http.IncomingMessage} req
   * @returns {boolean}
   */
  _enforceRemoteAuth (req) {
    return shouldEnforceRemoteAuth({
      mode: this.settings.mode,
      httpSharedMode: this._httpSharedMode === true,
      req
    });
  }

  /**
   * Resolve the acting identity for register mutations. In hosted server
   * mode (and LAN shared-mode from a non-loopback peer) the authenticated
   * session pubkey is authoritative (bodies cannot impersonate); locally
   * the body-provided actor id is kept (M5 behavior).
   */
  _actor (req, bodyValue) {
    if (this._enforceRemoteAuth(req)) return this._authPubkey(req);
    return this._authPubkey(req) || bodyValue || null;
  }

  /**
   * Idempotently upsert one remote event into a collection, tagged with its
   * source pubkey. The id derives from source + collection + content (no
   * timestamps), so re-delivery of the same batch is a no-op.
   * @returns {{ id: String, created: Boolean }}
   */
  _ingestEvent (source, collection, data) {
    if (!INGEST_COLLECTIONS.includes(collection)) {
      throw Object.assign(new Error(`Unknown collection: ${collection}`), { code: 'BAD_COLLECTION' });
    }
    if (collection === 'players') {
      if (!data || !data.name) throw Object.assign(new Error('players event requires name'), { code: 'BAD_EVENT' });
      const { player } = this.recordPlayer(data.name, data.timestamp || new Date().toISOString());
      player.source = player.source || source;
      return { id: player.id, created: false };
    }
    if (collection === 'chatmessages') {
      return this.chatManager.ingest(source, data);
    }
    if (collection === 'missionbroadcasts') {
      return this._ingestMissionBroadcast(source, data);
    }
    const { canonicalStringify } = identityLib();
    const id = idFor(canonicalStringify({ source, collection, data }));
    const existed = !!this.state[collection][id];
    if (!existed) {
      this.state[collection][id] = Object.assign({ id, source }, data);
      if (collection === 'kills') this.emit('kill', this.state[collection][id]);
      // Fold peer-sourced gameplay into cumulative analytics (desktop + hosted hub).
      if (collection === 'deaths' || collection === 'missionlog') {
        const kind = data.kind || (collection === 'deaths' ? 'player:death' : null);
        if (kind === 'player:death' || kind === 'mission:end') {
          this._applyHistoryEvent({
            kind,
            timestamp: data.timestamp,
            player: data.player,
            bodyId: data.bodyId,
            completionType: data.completionType || data.outcome,
            missionId: data.missionId,
            generator: data.generator
          }, { countHeat: false, force: true, handle: data.player || null });
          this.emit('history:updated', { via: 'ingest', collection });
        }
      }
    }
    return { id, created: !existed };
  }

  /** Snapshot fields shared on MissionCreated / MissionBroadcast wire payloads. */
  _missionWireSnapshot (m) {
    if (!m) return null;
    return {
      id: m.id,
      title: m.title,
      type: m.type,
      description: m.description,
      reward: m.reward,
      groupId: m.groupId,
      authorities: m.authorities,
      createdBy: m.createdBy,
      createdAt: m.createdAt,
      status: m.status,
      assigneeId: m.assigneeId || null,
      participantIds: Array.isArray(m.participantIds) ? m.participantIds.slice() : [],
      outOfGame: m.outOfGame,
      deadline: m.deadline,
      location: m.location
    };
  }

  /**
   * Receive a peer mission creation: upsert the register only (no Accept/Ignore
   * offer). Idempotent via missionManager.ingestRemote.
   */
  _ingestMissionCreated (source, data = {}) {
    if (!this.missionManager) {
      throw Object.assign(new Error('Mission system not available'), { code: 'BAD_COLLECTION' });
    }
    const mission = data.mission || data;
    if (!mission || !mission.id) {
      throw Object.assign(new Error('missioncreated requires mission.id'), { code: 'BAD_EVENT' });
    }
    const ingested = this.missionManager.ingestRemote(Object.assign({}, mission, { source }));
    return { id: mission.id, created: !!ingested.created, mission: ingested.mission };
  }

  /**
   * Receive a peer completion claim (Fabric `MissionClaim`). Signer must be the
   * claimant. Upserts the mission snapshot when the register does not have it yet.
   */
  _ingestMissionClaim (source, data = {}) {
    if (!this.missionManager) {
      throw Object.assign(new Error('Mission system not available'), { code: 'BAD_COLLECTION' });
    }
    const { pubkeysMatch } = identityLib();
    const claim = data.claim || data;
    if (!claim || !claim.id || !claim.missionId) {
      throw Object.assign(new Error('missionclaim requires claim.id and missionId'), { code: 'BAD_EVENT' });
    }
    if (!pubkeysMatch(source, claim.claimantId)) {
      return { id: claim.id, created: false, skipped: 'signer-mismatch' };
    }
    if (!this.missionManager.getMission(claim.missionId) && data.mission && data.mission.id) {
      this._ingestMissionCreated(source, { mission: data.mission });
    }
    return this.missionManager.ingestClaim(claim);
  }

  /**
   * Receive a peer approve/reject (Fabric `MissionClaimDecision`).
   * Approve re-verifies k-of-n Schnorr when the mission has authorities.
   */
  _ingestMissionClaimDecision (source, data = {}) {
    if (!this.missionManager) {
      throw Object.assign(new Error('Mission system not available'), { code: 'BAD_COLLECTION' });
    }
    const { pubkeysMatch } = identityLib();
    const validation = data.validation || data;
    if (!validation || !validation.claimId || !validation.decision) {
      throw Object.assign(new Error('missionclaimdecision requires claimId and decision'), { code: 'BAD_EVENT' });
    }
    if (data.mission && data.mission.id && !this.missionManager.getMission(data.mission.id)) {
      this._ingestMissionCreated(source, { mission: data.mission });
    }
    if (data.claim && data.claim.id && !this.missionManager.store.get('claims', data.claim.id)) {
      // Nested claim is only trusted when this message is from the claimant.
      // Approvers must not mint a completion row for someone else.
      if (pubkeysMatch(source, data.claim.claimantId)) {
        this.missionManager.ingestClaim(data.claim);
      }
    }
    const missionId = validation.missionId || (data.claim && data.claim.missionId) || null;
    const mission = missionId ? this.missionManager.getMission(missionId) : null;
    const hasAuthorities = !!(mission && mission.authorities && mission.authorities.keys &&
      mission.authorities.keys.length);
    if (validation.decision === 'reject' || (validation.decision === 'approve' && !hasAuthorities)) {
      if (!pubkeysMatch(source, validation.officerId)) {
        return { created: false, skipped: 'signer-mismatch' };
      }
    }
    if (validation.decision === 'reject' && mission) {
      const officer = String(validation.officerId || '');
      if (hasAuthorities) {
        const onSet = mission.authorities.keys.some((k) => pubkeysMatch(k, officer));
        if (!onSet) return { created: false, skipped: 'not-authority' };
      } else {
        const isCreator = mission.createdBy && pubkeysMatch(mission.createdBy, officer);
        if (!isCreator && !this.missionManager.isOfficer(officer)) {
          return { created: false, skipped: 'not-authority' };
        }
      }
    }
    return this.missionManager.ingestValidation(validation);
  }

  /**
   * Persist browseable register/gossip events into the inbox collection
   * (Notifications UI). Complements audit chains — does not replace them.
   */
  _wireRegisterInbox () {
    if (this._inboxWired) return;
    this._inboxWired = true;
    if (this.missionManager) {
      this.missionManager.on('audit', (entry) => {
        const row = registerInbox.entryFromMissionAudit(entry);
        if (row) this._appendInbox(row);
      });
      this.missionManager.on('application:accepted', (app) => {
        this._resolveInboxWhere(
          (r) => r.kind === 'MissionApplication' && r.refs && r.refs.applicationId === app.id,
          { status: 'accepted', actionable: false, resolvedAt: new Date().toISOString() }
        );
      });
      this.missionManager.on('application:rejected', (app) => {
        this._resolveInboxWhere(
          (r) => r.kind === 'MissionApplication' && r.refs && r.refs.applicationId === app.id,
          { status: 'rejected', actionable: false, resolvedAt: new Date().toISOString() }
        );
      });
      this.missionManager.on('claim:validated', (validation) => {
        const claimId = validation && validation.claimId;
        if (!claimId) return;
        this._resolveInboxWhere(
          (r) => r.kind === 'MissionClaim' && r.refs && r.refs.claimId === claimId,
          { status: 'accepted', actionable: false, resolvedAt: new Date().toISOString() }
        );
      });
      this.missionManager.on('claim:rejected', (validation) => {
        const claimId = validation && validation.claimId;
        if (!claimId) return;
        this._resolveInboxWhere(
          (r) => r.kind === 'MissionClaim' && r.refs && r.refs.claimId === claimId,
          { status: 'rejected', actionable: false, resolvedAt: new Date().toISOString() }
        );
      });
      this.missionManager.on('claim:superseded', (claim) => {
        if (!claim || !claim.id) return;
        this._resolveInboxWhere(
          (r) => r.kind === 'MissionClaim' && r.refs && r.refs.claimId === claim.id,
          {
            status: 'superseded',
            actionable: false,
            resolvedAt: new Date().toISOString(),
            summary: claim.supersedeReason || 'another claim accepted'
          }
        );
      });
    }
    if (this.groupManager) {
      this.groupManager.on('audit', (entry) => {
        const row = registerInbox.entryFromGroupAudit(entry);
        if (row) this._appendInbox(row);
      });
      this.groupManager.on('group:proposal', (proposal) => {
        const row = registerInbox.entryFromGroupChangeProposal(proposal);
        if (row) this._appendInbox(row);
      });
      this.groupManager.on('group:vote', (ev) => {
        const proposal = ev && ev.proposal;
        const row = registerInbox.entryFromGroupChangeProposal(proposal);
        if (!row || !this.registerStore) return;
        const existing = this.registerStore.get('inbox', row.id);
        if (existing) {
          registerInbox.patch(this.registerStore, row.id, {
            title: row.title,
            body: row.body,
            status: row.status,
            actionable: row.actionable
          });
        } else {
          this._appendInbox(row);
        }
      });
      this.groupManager.on('group:proposal-adopted', (ev) => {
        const proposal = ev && ev.proposal;
        if (!proposal || !proposal.id) return;
        this._resolveInboxWhere(
          (r) => r.kind === 'GroupChangeProposal' && r.refs && r.refs.proposalId === proposal.id,
          {
            status: 'accepted',
            actionable: false,
            resolvedAt: proposal.adoptedAt || new Date().toISOString(),
            title: `Proposal ${proposal.action || 'change'} (adopted)`
          }
        );
      });
      this.groupManager.on('group:application', (app) => {
        if (!app || !app.groupId) return;
        this._resolveInboxWhere(
          (r) => r.kind === 'GroupOffer' && r.status === 'pending' &&
            r.refs && r.refs.groupId === app.groupId,
          {
            status: 'accepted',
            actionable: false,
            resolvedAt: app.createdAt || new Date().toISOString(),
            title: 'Applied to join'
          }
        );
      });
      this.groupManager.on('group:application-accepted', (app) => {
        this._resolveInboxWhere(
          (r) => r.kind === 'GroupApplication' && (
            (r.refs && r.refs.applicationId === app.id) ||
            (r.refs && r.refs.groupId === app.groupId && r.source === app.applicantId)
          ),
          { status: 'accepted', actionable: false, resolvedAt: app.decidedAt || new Date().toISOString() }
        );
        const group = this.groupManager.getGroup(app.groupId);
        const name = (group && group.name) || null;
        const notice = registerInbox.normalizeEntry({
          id: `inbox-gad-${app.id}`,
          kind: 'GroupApplicationDecision',
          status: 'accepted',
          actionable: false,
          ts: app.decidedAt || new Date().toISOString(),
          title: name ? `You're in · ${name}` : 'Join accepted',
          body: app.message || null,
          source: app.decidedBy || null,
          refs: {
            groupId: app.groupId,
            applicationId: app.id,
            applicantId: app.applicantId,
            groupName: name
          },
          dedupeKey: `gapp-decision-${app.id}`
        });
        if (notice) this._appendInbox(notice);
      });
      this.groupManager.on('group:application-rejected', (app) => {
        this._resolveInboxWhere(
          (r) => r.kind === 'GroupApplication' && (
            (r.refs && r.refs.applicationId === app.id) ||
            (r.refs && r.refs.groupId === app.groupId && r.source === app.applicantId)
          ),
          { status: 'rejected', actionable: false, resolvedAt: app.decidedAt || new Date().toISOString() }
        );
        const group = this.groupManager.getGroup(app.groupId);
        const name = (group && group.name) || null;
        const notice = registerInbox.normalizeEntry({
          id: `inbox-gad-${app.id}`,
          kind: 'GroupApplicationDecision',
          status: 'rejected',
          actionable: false,
          ts: app.decidedAt || new Date().toISOString(),
          title: name ? `Join declined · ${name}` : 'Join declined',
          body: app.reason || app.message || null,
          source: app.decidedBy || null,
          refs: {
            groupId: app.groupId,
            applicationId: app.id,
            applicantId: app.applicantId,
            groupName: name
          },
          dedupeKey: `gapp-decision-${app.id}`
        });
        if (notice) this._appendInbox(notice);
      });
    }
  }

  _appendInbox (partial) {
    if (!this.registerStore || !partial) return null;
    const enriched = registerInbox.enrichRefs(this.registerStore, partial);
    const { entry, created } = registerInbox.append(this.registerStore, enriched);
    if (created && entry) this.emit('inbox:item', entry);
    return entry;
  }

  _operatorActor (req, bodyActor) {
    if (this._enforceRemoteAuth(req)) return this._authPubkey(req) || null;
    return this._authPubkey(req) ||
      (this._identity && this._identity.pubkey) ||
      bodyActor ||
      'local';
  }

  /**
   * Session required for hosted / shared-LAN HTTP. Loopback desktop keeps
   * the unlocked-identity path.
   * @param {http.IncomingMessage} req
   * @param {function} send
   * @returns {boolean}
   */
  _requireSession (req, send) {
    if (this._enforceRemoteAuth(req) && !this._authPubkey(req)) {
      send(401, { error: 'Authentication required (POST …/auth with a signed login envelope)' });
      return false;
    }
    return true;
  }

  /**
   * Acting viewer for an HTTP request. Never falls back to the unlocked
   * operator identity when a session is required.
   * @param {http.IncomingMessage} req
   * @returns {string|null}
   */
  _requestViewer (req) {
    if (this._enforceRemoteAuth(req)) return this._authPubkey(req) || null;
    return this._authPubkey(req) || (this._identity && this._identity.pubkey) || null;
  }

  _viewerGroupIds (viewer) {
    if (!viewer || !this.groupManager) return [];
    return this.groupManager.groupsFor(viewer).map((g) => g.id);
  }

  _listLocalGroups () {
    return localGroups.listGroups(this.registerStore);
  }

  _createLocalGroup (opts, actor) {
    const group = localGroups.createGroup(this.registerStore, Object.assign({}, opts, {
      createdBy: actor
    }));
    this._appendInbox(registerInbox.entryFromLocalGroup(group, 'create', null, actor));
    return group;
  }

  _renameLocalGroup (id, name, actor) {
    const group = localGroups.renameGroup(this.registerStore, id, name);
    this._appendInbox(registerInbox.entryFromLocalGroup(group, 'rename', null, actor));
    return group;
  }

  _deleteLocalGroup (id, actor) {
    const group = localGroups.getGroup(this.registerStore, id);
    if (!group) {
      const err = new Error('Local group not found');
      err.code = 'NOT_FOUND';
      throw err;
    }
    localGroups.deleteGroup(this.registerStore, id);
    this._appendInbox(registerInbox.entryFromLocalGroup(group, 'delete', null, actor));
    return { deleted: true, id: group.id };
  }

  _addLocalGroupMember (id, member, actor) {
    const before = localGroups.getGroup(this.registerStore, id);
    const group = localGroups.addMember(this.registerStore, id, member);
    const row = localGroups.sanitizeMember(member);
    const existed = before && row && before.members.some((m) => m.actor === row.actor);
    if (!existed && row) {
      this._appendInbox(registerInbox.entryFromLocalGroup(group, 'add', row, actor));
    }
    return group;
  }

  _removeLocalGroupMember (id, actorKey, actor) {
    const key = localGroups.canonicalActor(actorKey);
    const before = localGroups.getGroup(this.registerStore, id);
    const member = before && key
      ? before.members.find((m) => m.actor === key)
      : null;
    const group = localGroups.removeMember(this.registerStore, id, actorKey);
    if (member) {
      this._appendInbox(registerInbox.entryFromLocalGroup(group, 'remove', member, actor));
    }
    return group;
  }

  _listIdentityNotes (opts = {}) {
    return identityNotes.listNotes(this.registerStore, opts);
  }

  _createIdentityNote (opts, actor) {
    const note = identityNotes.createNote(this.registerStore, Object.assign({}, opts, {
      author: actor
    }));
    this._appendInbox(registerInbox.entryFromIdentityNote(note, 'create', actor));
    return note;
  }

  _updateIdentityNote (id, opts, actor) {
    const prev = identityNotes.getNote(this.registerStore, id);
    if (prev && actor && prev.author !== actor && prev.author !== 'local') {
      const err = new Error('forbidden: not the note author');
      err.code = 'FORBIDDEN';
      throw err;
    }
    const note = identityNotes.updateNote(this.registerStore, id, opts);
    this._appendInbox(registerInbox.entryFromIdentityNote(note, 'update', actor));
    return note;
  }

  /**
   * Pin (or unpin) a note onto the subject's public profile wall.
   * @param {string} id
   * @param {boolean} pinned
   * @param {string} actor
   * @returns {object}
   */
  _pinIdentityNote (id, pinned, actor) {
    const prev = identityNotes.getNote(this.registerStore, id);
    if (!prev) {
      const err = new Error('Note not found');
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (!actor || actor === 'local') {
      const err = new Error('Unlock your identity to pin notes');
      err.code = 'FORBIDDEN';
      throw err;
    }
    if (prev.inbound === true) {
      const err = new Error('forbidden: not the note author');
      err.code = 'FORBIDDEN';
      throw err;
    }
    if (this.settings.mode === 'server' && prev.author !== actor && prev.author !== 'local') {
      const err = new Error('forbidden: not the note author');
      err.code = 'FORBIDDEN';
      throw err;
    }
    const note = identityNotes.setProfilePinned(this.registerStore, id, pinned === true);
    this._appendInbox(registerInbox.entryFromIdentityNote(note, 'update', actor));
    this._publishGroupDataShareNow();
    return note;
  }

  /**
   * Mark a note shared and publish NoteShare / NoteUpdate to a group or peer.
   * @param {string} id
   * @param {object} opts
   * @param {string} actor
   * @returns {Promise<object>}
   */
  async _shareIdentityNote (id, opts, actor) {
    const prev = identityNotes.getNote(this.registerStore, id);
    if (!prev) {
      const err = new Error('Note not found');
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (!actor || actor === 'local') {
      const err = new Error('Unlock your identity to share notes');
      err.code = 'FORBIDDEN';
      throw err;
    }
    if (this.settings.mode === 'server' && prev.author !== actor && prev.author !== 'local') {
      const err = new Error('forbidden: not the note author');
      err.code = 'FORBIDDEN';
      throw err;
    }
    const note = identityNotes.markShared(this.registerStore, id, opts);
    const payload = identityNotes.buildSharePayload(note, {
      scope: opts.scope,
      groupId: opts.groupId,
      peerPubkey: opts.peerPubkey,
      author: actor,
      update: (Number(note.revision) || 1) > 1
    });
    if (opts.scope === 'group') {
      const gm = this.groupManager;
      const group = gm && gm.findGroup(opts.groupId);
      if (!group) {
        const err = new Error('Group not found');
        err.code = 'NOT_FOUND';
        throw err;
      }
      if (!group.includes(actor)) {
        const err = new Error('forbidden: members only');
        err.code = 'FORBIDDEN';
        throw err;
      }
      if (this.fabricNetwork && group.contractId) {
        try {
          await this.fabricNetwork.publishGroupShare(group.contractId, {
            kind: identityNotes.SHARE_TYPE,
            object: payload
          });
        } catch (e) {
          this.emit('warning', '[LiveRelay] NoteShare group publish failed:', e && e.message);
        }
      }
    } else if (this.fabricNetwork) {
      try {
        await this.fabricNetwork.publishNoteShare(payload);
      } catch (e) {
        this.emit('warning', '[LiveRelay] NoteShare peer publish failed:', e && e.message);
      }
    }
    this._appendInbox(registerInbox.entryFromIdentityNote(note, 'share', actor));
    return { note, payload };
  }

  _ingestNoteShare (object, source, meta) {
    if (!object || !this.registerStore) return null;
    const raw = object.object != null ? object.object : object;
    const me = this._identity && this._identity.pubkey;
    const scope = raw && raw.scope;
    if (scope === 'peer' && me) {
      const { pubkeysMatch } = identityLib();
      const a = raw.peerA;
      const b = raw.peerB || raw.peerPubkey;
      if (a && b && !pubkeysMatch(me, a) && !pubkeysMatch(me, b)) return null;
    }
    if (scope === 'group' && me && this.groupManager) {
      const contract = meta && meta.contract;
      const group = (raw.groupId && this.groupManager.findGroup(raw.groupId)) ||
        (contract && this.groupManager.getGroupByContractId(contract));
      if (group && !this.groupManager.isInGroupTree(group.id, me) && this.settings.mode !== 'server') {
        return null;
      }
    }
    const note = identityNotes.ingestShare(this.registerStore, object, source);
    if (!note) return null;
    this._appendInbox(registerInbox.entryFromIdentityNote(note, 'share', source));
    this.emit('note:share', { note, source: source || null });
    return note;
  }

  _resolveInboxWhere (pred, patchObj) {
    if (!this.registerStore || typeof pred !== 'function') return;
    for (const row of this.registerStore.all('inbox') || []) {
      if (!pred(row)) continue;
      registerInbox.patch(this.registerStore, row.id, patchObj);
    }
  }

  _syncInboxMissionBroadcast (rec) {
    const row = registerInbox.entryFromMissionBroadcast(rec);
    if (!row) return null;
    const prev = this.registerStore && this.registerStore.get('inbox', row.id);
    if (prev) {
      return registerInbox.patch(this.registerStore, row.id, {
        status: row.status,
        actionable: row.actionable,
        resolvedAt: row.resolvedAt,
        resolvedBy: row.resolvedBy,
        refs: row.refs,
        title: row.title,
        body: row.body,
        reward: row.reward
      });
    }
    return this._appendInbox(row);
  }

  /**
   * Receive a peer mission broadcast: upsert the mission register entry and
   * keep a pending offer for the UI (desktop notify + Accept / Ignore).
   * Idempotent on (source, missionId, broadcastAt).
   */
  _ingestMissionBroadcast (source, data = {}) {
    if (!this.missionManager) {
      throw Object.assign(new Error('Mission system not available'), { code: 'BAD_COLLECTION' });
    }
    const mission = data.mission || data;
    if (!mission || !mission.id) {
      throw Object.assign(new Error('missionbroadcast requires mission.id'), { code: 'BAD_EVENT' });
    }
    const broadcastAt = data.broadcastAt || mission.broadcastAt || new Date().toISOString();
    const scope = data.scope === 'group' ? 'group' : 'global';
    const groupId = data.groupId || mission.groupId || null;
    if (scope === 'group' && !groupId) {
      throw Object.assign(new Error('group-scoped broadcast requires groupId'), { code: 'BAD_EVENT' });
    }

    // Local nodes drop group-only offers unless the unlocked identity is in
    // the target group tree (group or a subgroup). Hosted mode keeps all
    // offers; the list filters by viewer.
    const { canonicalStringify, pubkeysMatch } = identityLib();
    const me = this._identity && this._identity.pubkey;
    if (scope === 'group' && me && this.groupManager && !this.groupManager.isInGroupTree(groupId, me)) {
      return { id: null, created: false, filtered: true };
    }

    const id = data.id || idFor(canonicalStringify({ source, missionId: mission.id, broadcastAt }));
    const store = this.registerStore;
    if (store && store.get('missionbroadcasts', id)) {
      return { id, created: false };
    }

    const ingested = this.missionManager.ingestRemote(Object.assign({}, mission, { source }));
    const record = {
      '@type': 'MissionBroadcast',
      id,
      missionId: mission.id,
      mission: ingested.mission,
      source: String(source),
      handle: data.handle || null,
      broadcastAt,
      receivedAt: new Date().toISOString(),
      scope,
      groupId: groupId || null,
      status: 'pending'
    };
    // Don't surface offers we originated (same node identity or creator).
    if (me && (pubkeysMatch(source, me) || pubkeysMatch(ingested.mission.createdBy, me))) {
      record.status = 'self';
    }
    if (store) store.put('missionbroadcasts', id, record);
    else {
      this.state.missionbroadcasts = this.state.missionbroadcasts || {};
      this.state.missionbroadcasts[id] = record;
    }
    this._syncInboxMissionBroadcast(record);
    if (record.status === 'pending') this.emit('mission:broadcast', record);
    return { id, created: true };
  }

  _listMissionBroadcasts ({ pendingOnly = false, viewer = null } = {}) {
    const store = this.registerStore;
    const all = store
      ? store.all('missionbroadcasts')
      : Object.values(this.state.missionbroadcasts || {});
    let rows = all.slice().sort((a, b) => String(b.broadcastAt || '').localeCompare(String(a.broadcastAt || '')));
    if (pendingOnly) rows = rows.filter((r) => r.status === 'pending');
    // Hosted: hide group-scoped offers from non-members of that group tree.
    if (this.settings.mode === 'server' && this.groupManager) {
      rows = rows.filter((r) => {
        if (r.scope !== 'group' || !r.groupId) return true;
        return !!(viewer && this.groupManager.isInGroupTree(r.groupId, viewer));
      });
    }
    return rows;
  }

  _getMissionBroadcast (id) {
    if (this.registerStore) return this.registerStore.get('missionbroadcasts', id);
    return (this.state.missionbroadcasts || {})[id] || null;
  }

  _putMissionBroadcast (record) {
    if (this.registerStore) this.registerStore.put('missionbroadcasts', record.id, record);
    else {
      this.state.missionbroadcasts = this.state.missionbroadcasts || {};
      this.state.missionbroadcasts[record.id] = record;
    }
    return record;
  }

  /**
   * Best-effort: publish a MissionCreated CONTRACT_MESSAGE so peers upsert the
   * mission into their register. No-op when Fabric/identity is unavailable
   * (local-only create still succeeds).
   * @param {Object} mission
   */
  async publishMissionCreated (mission) {
    if (!mission || !mission.id) return null;
    if (!this._identity) return null;
    await this._ensureFabric();
    if (!this.fabricNetwork || !this.fabricNetwork.ready) return null;
    const payload = {
      '@type': 'MissionCreated',
      missionId: mission.id,
      createdAt: mission.createdAt || new Date().toISOString(),
      handle: this._nickname || this._sessionHandle || null,
      mission: this._missionWireSnapshot(mission)
    };
    this.fabricNetwork.publishMissionCreated(payload);
    return payload;
  }

  /**
   * Gossip a completion claim as a Fabric CONTRACT_MESSAGE (`MissionClaim`).
   * Best-effort — local register write still succeeds if the Peer is down.
   * @param {Object} claim
   */
  async publishMissionClaim (claim) {
    if (!claim || !claim.id || !claim.missionId) return null;
    if (!this._identity) return null;
    await this._ensureFabric();
    if (!this.fabricNetwork || !this.fabricNetwork.ready) return null;
    const mission = this.missionManager ? this.missionManager.getMission(claim.missionId) : null;
    const payload = {
      '@type': 'MissionClaim',
      type: 'MissionClaim',
      claim: {
        id: claim.id,
        missionId: claim.missionId,
        claimantId: claim.claimantId,
        note: claim.note || '',
        evidence: Array.isArray(claim.evidence) ? claim.evidence : [],
        completionGroupId: claim.completionGroupId || null,
        status: claim.status || 'pending',
        claimedAt: claim.claimedAt || new Date().toISOString()
      },
      mission: this._missionWireSnapshot(mission)
    };
    this.fabricNetwork.publishMissionClaim(payload);
    return payload;
  }

  /**
   * Gossip an approve/reject as a Fabric CONTRACT_MESSAGE (`MissionClaimDecision`).
   * @param {Object} validation
   * @param {Object} [claim]
   */
  async publishMissionClaimDecision (validation, claim) {
    if (!validation || !validation.claimId) return null;
    if (!this._identity) return null;
    await this._ensureFabric();
    if (!this.fabricNetwork || !this.fabricNetwork.ready) return null;
    const row = claim || (this.missionManager && this.missionManager.store.get('claims', validation.claimId)) || null;
    const mission = this.missionManager && row
      ? this.missionManager.getMission(row.missionId)
      : null;
    const payload = {
      '@type': 'MissionClaimDecision',
      type: 'MissionClaimDecision',
      validation: {
        id: validation.id,
        claimId: validation.claimId,
        missionId: validation.missionId || (row && row.missionId) || null,
        officerId: validation.officerId || null,
        decision: validation.decision,
        note: validation.note || '',
        validatedAt: validation.validatedAt || new Date().toISOString(),
        authorization: validation.authorization || null
      },
      claim: row
        ? {
          id: row.id,
          missionId: row.missionId,
          claimantId: row.claimantId,
          note: row.note || '',
          completionGroupId: row.completionGroupId || null,
          claimedAt: row.claimedAt
        }
        : null,
      mission: this._missionWireSnapshot(mission)
    };
    this.fabricNetwork.publishMissionClaimDecision(payload);
    return payload;
  }

  /**
   * Publish a mission offer over Fabric (MissionBroadcast CONTRACT_MESSAGE).
   * Creator-only; open missions only. Scope defaults to group when the mission
   * has a groupId, else network-wide (`global` — all connected Fabric peers).
   * Group scope is membership-filtered on receive (group + subgroups).
   * @param {string} missionId
   * @param {string} actor Creator pubkey
   * @param {Object} [opts]
   * @param {string} [opts.scope] `'global'` or `'group'`
   * @param {string} [opts.groupId]
   */
  async broadcastMission (missionId, actor, opts = {}) {
    if (!this.missionManager) throw Object.assign(new Error('Mission system not available'), { code: 'UNAVAILABLE' });
    const m = this.missionManager.getMission(missionId);
    if (!m) throw Object.assign(new Error('Mission not found'), { code: 'NOT_FOUND' });
    if (m.status !== 'open') throw new Error(`mission is ${m.status}, not open`);
    if (!actor || m.createdBy !== actor) {
      const err = new Error('forbidden: only the creator can broadcast this mission');
      err.code = 'FORBIDDEN';
      throw err;
    }
    if (!this._identity) throw new Error('Unlock your identity to broadcast');
    await this._ensureFabric();
    if (!this.fabricNetwork || !this.fabricNetwork.ready) {
      throw new Error('Fabric peer is not ready — check Peers / listen port');
    }

    let groupId = opts.groupId != null ? opts.groupId : (m.groupId || null);
    let scope = opts.scope;
    if (!scope) scope = groupId ? 'group' : 'global';
    if (scope !== 'global' && scope !== 'group') throw new Error('scope must be global or group');
    if (scope === 'group') {
      if (!groupId) throw new Error('groupId required for group-scoped broadcast');
      if (m.groupId && groupId !== m.groupId) throw new Error('groupId must match the mission group');
    } else {
      groupId = groupId || null;
    }

    const broadcastAt = new Date().toISOString();
    const payload = {
      '@type': 'MissionBroadcast',
      missionId: m.id,
      broadcastAt,
      scope,
      groupId: scope === 'group' ? groupId : null,
      handle: this._nickname || this._sessionHandle || null,
      mission: this._missionWireSnapshot(m)
    };
    if (scope === 'group') {
      const contractId = await this._ensureGroupContractId(groupId);
      if (!contractId) throw new Error('group Federation contract is not ready');
      this.fabricNetwork.publishGroupShare(contractId, {
        kind: 'MissionBroadcast',
        groupId,
        contractId,
        object: payload
      });
    } else {
      this.fabricNetwork.publishMissionBroadcast(payload);
    }
    const st = this.fabricNetwork.status();
    return {
      missionId: m.id,
      broadcastAt,
      scope,
      groupId: payload.groupId,
      peers: st.fabricConnected,
      fabricPeerId: st.fabricPeerId
    };
  }

  /**
   * Ensure a group's Federation contract is persisted + published. Returns contractId.
   * @param {string} groupId
   * @returns {Promise<string|null>}
   */
  async _ensureGroupContractId (groupId) {
    if (!this.groupManager || !groupId) return null;
    const { group, definition } = this.groupManager.ensureContract(groupId);
    await this._publishGroupContractFor(group, definition);
    return group.contractId || null;
  }

  /**
   * Group wallet address for a mission completion payout (Taproot primary).
   * @param {string} groupId
   * @returns {{ address: string, groupId: string, mode: string }|null}
   */
  _resolveCompletionGroupWallet (groupId) {
    if (!this.groupManager || !groupId) return null;
    const group = this.groupManager.getGroup(groupId);
    if (!group) throw new Error('completion group not found');
    const { groupTaprootWallet } = require('../functions/groupSpendLadder');
    const pm = this.payoutManager;
    const tapWallet = groupTaprootWallet(group, {
      network: (pm && pm.settings && pm.settings.network) || 'regtest'
    });
    if (!tapWallet || !tapWallet.address) throw new Error('completion group wallet unavailable');
    return {
      address: tapWallet.address,
      groupId: group.id,
      mode: tapWallet.mode || 'taproot',
      keys: tapWallet.keys,
      threshold: tapWallet.threshold
    };
  }

  async _publishGroupContractFor (group, definition) {
    if (!group) return null;
    let def = definition;
    let g = group;
    if (!def && this.groupManager) {
      try {
        const ensured = this.groupManager.ensureContract(group.id);
        def = ensured.definition;
        g = ensured.group;
      } catch (_) { return null; }
    }
    if (!def) return null;
    await this._ensureFabric();
    if (!this.fabricNetwork || !this.fabricNetwork.ready) return null;
    const { groupContractId } = require('../contracts/gooncitizenGroup');
    this.fabricNetwork.setGroupContractKnown(g.contractId || groupContractId(def), true);
    this.fabricNetwork.publishGroupContract(def);
    return def;
  }

  async _publishGroupChange (change) {
    if (!change) return null;
    let contractId = change.contractId;
    if (!contractId && change.groupId) {
      contractId = await this._ensureGroupContractId(change.groupId);
    }
    if (!contractId) return null;
    await this._ensureFabric();
    if (!this.fabricNetwork || !this.fabricNetwork.ready) return null;
    const msg = this.fabricNetwork.publishGroupChange(contractId, change);
    this._attachJournalFabricMessage(contractId, change.id, msg, 'GroupChange');
    // Tip attestation: Schnorr over folded stateDigest (member threshold).
    try {
      await this._publishGroupStateTip(contractId, change.groupId || null);
    } catch (e) { this.emit('error', e); }
    return change;
  }

  /**
   * Publish a local GroupChangeProposal and attach a BIP340 vote when possible.
   * @param {object} proposal
   */
  async _onLocalGroupProposal (proposal) {
    if (!proposal || !proposal.id) return null;
    let contractId = proposal.contractId;
    if (!contractId && proposal.groupId) {
      contractId = await this._ensureGroupContractId(proposal.groupId);
    }
    if (contractId) {
      await this._ensureFabric();
      if (this.fabricNetwork && this.fabricNetwork.ready) {
        const gcp = require('../functions/groupChangeProposal');
        const msg = this.fabricNetwork.publishGroupChangeProposal(
          contractId,
          gcp.proposalWireObject(proposal)
        );
        this._attachJournalFabricMessage(contractId, proposal.id, msg, 'GroupChangeProposal');
      }
    }
    // Upgrade local trust vote to a real Schnorr signature when identity is unlocked.
    await this._trySignLocalProposalVote(proposal);
    return proposal;
  }

  /**
   * If the unlocked identity is a signer and the proposal still has a local:
   * vote (or no vote yet), replace/add a BIP340 signature and publish the vote.
   * @param {object} proposal
   */
  async _trySignLocalProposalVote (proposal) {
    if (!proposal || proposal.status !== 'pending' || !this.groupManager) return null;
    const identity = this._identity;
    if (!identity || !identity.pubkey) return null;
    const group = this.groupManager.getGroup(proposal.groupId);
    if (!group || !group.isSigner(identity.pubkey)) return null;
    const gcp = require('../functions/groupChangeProposal');
    const existing = proposal.signatures && (
      proposal.signatures[identity.pubkey] ||
      proposal.signatures[String(identity.pubkey).toLowerCase()]
    );
    if (existing && !String(existing).startsWith('local:')) return null;
    try {
      const signed = gcp.signProposalVote(identity, proposal);
      // Replace local placeholder before cast so verify path sees BIP340.
      const fresh = this.groupManager.getProposal(proposal.id);
      if (!fresh || fresh.status !== 'pending') return null;
      if (fresh.signatures) {
        for (const k of Object.keys(fresh.signatures)) {
          if (String(fresh.signatures[k] || '').startsWith('local:')) {
            delete fresh.signatures[k];
          }
        }
        this.groupManager.store.put('groupchangeproposals', fresh.id, fresh);
      }
      return this.groupManager.castVote(proposal.id, signed.pubkey, signed.signature, {
        requireVerify: true,
        local: true
      });
    } catch (e) {
      this.emit('warning', '[LiveRelay] proposal vote sign failed:', e && e.message);
      return null;
    }
  }

  async _publishGroupChangeVote (proposal, voter) {
    if (!proposal || !proposal.id || !voter) return null;
    let contractId = proposal.contractId;
    if (!contractId && proposal.groupId) {
      contractId = await this._ensureGroupContractId(proposal.groupId);
    }
    if (!contractId) return null;
    const sig = proposal.signatures && (
      proposal.signatures[voter] || proposal.signatures[String(voter).toLowerCase()]
    );
    if (!sig || String(sig).startsWith('local:')) return null;
    await this._ensureFabric();
    if (!this.fabricNetwork || !this.fabricNetwork.ready) return null;
    const gcp = require('../functions/groupChangeProposal');
    const body = gcp.voteWireObject(proposal, voter, sig);
    const msg = this.fabricNetwork.publishGroupChangeVote(contractId, body);
    this._attachJournalFabricMessage(contractId, `${proposal.id}:vote:${voter}`, msg, 'GroupChangeVote');
    return body;
  }

  /**
   * Persist the signed AMP Message onto the local Statechain journal row so
   * peers can later replay bit-identical Fabric frames.
   * @param {string} contractId
   * @param {string} entryId
   * @param {object|null} msg Fabric Message
   * @param {string} [type]
   */
  _attachJournalFabricMessage (contractId, entryId, msg, type) {
    if (!this.registerStore || !contractId || !entryId || !msg) return;
    try {
      const groupStatechain = require('../functions/groupStatechain');
      const buf = typeof msg.toBuffer === 'function' ? msg.toBuffer() : null;
      const hash = msg.id
        || msg.hash
        || (buf && require('crypto').createHash('sha256').update(buf).digest('hex'))
        || null;
      groupStatechain.attachFabricMessage(this.registerStore, contractId, entryId, {
        hash: hash ? String(hash) : null,
        hex: buf ? buf.toString('hex') : null,
        type: type || 'GroupChange'
      });
    } catch (e) {
      this.emit('warning', '[LiveRelay] attach journal fabric message failed:', e && e.message);
    }
  }

  /**
   * Fold a signed CONTRACT_MESSAGE into the ARC accumulate collection
   * (`contractmessages`) via `@fabric/core` — same tip for mesh / paste / local.
   * @param {string} contractId
   * @param {Object|null} meta
   * @param {string} [meta.messageHex]
   * @param {Object} [meta.wireMessage]
   * @param {string} [meta.origin]
   * @param {string} [originHint]
   * @returns {object|null} ingestMessageBuffer result
   */
  _accumulateContractMessageWire (contractId, meta = {}, originHint) {
    if (!this.registerStore || !contractId) return null;
    let buffer = null;
    if (meta && meta.messageHex) {
      buffer = meta.messageHex;
    } else if (meta && meta.wireMessage && typeof meta.wireMessage.toBuffer === 'function') {
      buffer = meta.wireMessage.toBuffer();
    }
    if (!buffer) return null;
    try {
      const accumulate = require('../functions/contractMessageAccumulate');
      const origin = originHint
        || (meta && meta.origin)
        || 'mesh';
      const ingestMeta = { origin };
      // ARC F1: signer mutations need genesis/tip signers (or capabilityToken).
      const group = this.groupManager && this.groupManager.getGroupByContractId(contractId);
      if (group) {
        const signers = group.validators
          || (group.proposedPolicy && group.proposedPolicy.validators)
          || group.members
          || [];
        if (signers.length) {
          ingestMeta.genesis = {
            signers,
            readers: group.members || signers,
            threshold: group.threshold
          };
        }
      }
      if (meta && meta.capabilityToken) ingestMeta.capabilityToken = meta.capabilityToken;
      if (meta && meta.bitcoinBlockHash) {
        ingestMeta.bitcoinBlockHash = meta.bitcoinBlockHash;
        if (meta.bitcoinHeight != null) ingestMeta.bitcoinHeight = meta.bitcoinHeight;
      } else if (this.fabricNetwork && typeof this.fabricNetwork.getBitcoinTip === 'function') {
        try {
          const tip = this.fabricNetwork.getBitcoinTip();
          if (tip && tip.blockHash) {
            ingestMeta.bitcoinBlockHash = tip.blockHash;
            if (tip.height != null) ingestMeta.bitcoinHeight = tip.height;
          }
        } catch (_) { /* optional */ }
      }
      const result = accumulate.ingestMessageBuffer(this.registerStore, contractId, buffer, ingestMeta);
      if (result && result.accepted && result.entry) {
        // Generalized delivery sync filter (not GroupChat-only).
        const doc = accumulate.loadDoc(this.registerStore, contractId);
        if (accumulate.isSyncTrackedType(result.entry.type, doc, ingestMeta)) {
          this._noteContractMessageReceived(contractId, result, meta);
        }
      }
      return result;
    } catch (e) {
      this.emit('debug', `[ARC] accumulate failed: ${e && e.message ? e.message : e}`);
      return null;
    }
  }

  /**
   * Phase-1 delivery sync after accepting a sync-tracked CONTRACT_MESSAGE:
   * mark local received, then publish Fabric MessageReceived when remote.
   * Filter: {@link @fabric/core/functions/contractMessageAccumulate.isSyncTrackedType}.
   * @param {string} contractId
   * @param {object} result accumulate result
   * @param {object} [meta]
   */
  _noteContractMessageReceived (contractId, result, meta = {}) {
    if (!this.registerStore || !result || !result.entry) return;
    const me = this._identity && this._identity.pubkey;
    if (!me) return;
    try {
      const commit = require('../functions/contractMessageCommit');
      const chatDelivery = require('../functions/chatDelivery');
      const hash = String(result.entry.hash || '').toLowerCase();
      if (!hash) return;
      let readers = [];
      if (this.groupManager) {
        const group = this.groupManager.getGroupByContractId(contractId);
        if (group && typeof this.groupManager.getChatSealTip === 'function') {
          const tip = this.groupManager.getChatSealTip(group.id);
          if (tip && Array.isArray(tip.memberPubkeys)) readers = tip.memberPubkeys;
        }
      }
      if (!readers.length && result.tip && result.tip.content && Array.isArray(result.tip.content.members)) {
        readers = result.tip.content.members;
      }
      if (!readers.length) readers = [me];
      let record = this.registerStore.get('contractmessagecommits', hash);
      if (!record) {
        record = commit.createPending({
          id: hash,
          contractId,
          wireHash: hash,
          readers
        });
      }
      commit.markReceived(record, me);
      this.registerStore.put('contractmessagecommits', hash, record);
      const chatId = result.entry.object && result.entry.object.id
        ? String(result.entry.object.id)
        : null;
      if (chatId) chatDelivery.attachWireHash(this.registerStore, chatId, hash, contractId);

      // Remote sync-tracked frame → publish Fabric MessageReceived.
      const origin = (meta && meta.origin) || result.entry.origin || 'mesh';
      if (origin !== 'local' && this.fabricNetwork && this.fabricNetwork.ready) {
        try {
          const ack = this.fabricNetwork.publishMessageReceived(contractId, {
            messageId: hash,
            chatMessageId: chatId,
            sourceType: result.entry.type || null,
            receivedAt: new Date().toISOString()
          });
          if (ack && typeof ack.toBuffer === 'function') {
            this._accumulateContractMessageWire(contractId, {
              wireMessage: ack,
              messageHex: ack.toBuffer().toString('hex'),
              origin: 'local'
            }, 'local');
          }
        } catch (e) {
          this.emit('debug', `[ARC] MessageReceived publish failed: ${e && e.message ? e.message : e}`);
        }
      }
    } catch (e) {
      this.emit('debug', `[ARC] 2PC received note failed: ${e && e.message ? e.message : e}`);
    }
  }

  /**
   * Ensure a FabricNetwork exists that can Schnorr-sign CONTRACT_MESSAGEs.
   * Does not require fabric.enable or a listening peer (NODE_ENV=test disables
   * the peer by default; GroupShare / receipts still need local AMP signatures).
   * @returns {FabricNetwork|null}
   */
  _ensureFabricSignerSync () {
    if (!this._identity) return null;
    if (this.fabricNetwork) {
      this.fabricNetwork.setIdentity(this._identity);
      return this.fabricNetwork;
    }
    this.fabricNetwork = new FabricNetwork({
      enable: false,
      listen: false,
      peers: [],
      peersDb: null,
      messageLog: this._fabricMessageLog
    });
    this.fabricNetwork.setIdentity(this._identity);
    return this.fabricNetwork;
  }

  /**
   * Local reader phase-2 receipt by AMP wire hash (unified Fabric path).
   * @param {string} wireHash
   * @param {Object} [hints]
   * @param {string} [hints.contractId]
   * @param {string} [hints.chatMessageId]
   * @returns {object}
   */
  _markDeliveryReceipt (wireHash, hints = {}) {
    const chatDelivery = require('../functions/chatDelivery');
    const me = this._identity && this._identity.pubkey;
    if (!me) {
      const e = new Error('Unlock your identity to send a receipt');
      e.code = 'UNAUTHORIZED';
      throw e;
    }
    const target = chatDelivery.resolveDeliveryTarget({
      store: this.registerStore,
      groupManager: this.groupManager
    }, wireHash, hints);

    if (!target.contractId) {
      const e = new Error('contractId required (unknown wire hash / group)');
      e.code = 'BAD_REQUEST';
      throw e;
    }
    // Sign locally even when fabric peer is disabled / not ready (same as
    // GroupShare clipboard CONTRACT_MESSAGE). Mesh relay is best-effort.
    const fabricNetwork = this._ensureFabricSignerSync();
    if (!fabricNetwork) {
      const e = new Error('Fabric network unavailable — receipt requires a signed CONTRACT_MESSAGE');
      e.code = 'UNAVAILABLE';
      throw e;
    }

    let readers = target.readers && target.readers.length ? target.readers : [me];
    const { keyFromIdentity } = require('../functions/identity');
    const signerKey = keyFromIdentity(this._identity);
    const receiptSig = chatDelivery.signReceiptSig(signerKey, target.wireHash);
    const msg = fabricNetwork.publishMessageReceipt(target.contractId, {
      messageId: target.wireHash,
      chatMessageId: target.chatMessageId || null,
      sourceType: target.sourceType || null,
      receiptAt: new Date().toISOString(),
      receiptSig
    }, { relay: !!(fabricNetwork.ready) });
    if (!msg || typeof msg.toBuffer !== 'function') {
      const e = new Error('MessageReceipt publish failed');
      e.code = 'UNAVAILABLE';
      throw e;
    }
    const result = this._accumulateContractMessageWire(target.contractId, {
      wireMessage: msg,
      messageHex: msg.toBuffer().toString('hex'),
      origin: 'local'
    }, 'local');
    if (!result || result.error) {
      const e = new Error((result && result.error) || 'MessageReceipt accumulate failed');
      e.code = 'BAD_REQUEST';
      throw e;
    }
    if (!result.accepted && !result.duplicate) {
      const e = new Error('MessageReceipt was not stored');
      e.code = 'BAD_REQUEST';
      throw e;
    }

    const out = chatDelivery.markLocalReceipt(this.registerStore, {
      wireHash: target.wireHash,
      contractId: target.contractId,
      readers,
      viewerPubkey: me,
      receiptSig,
      signerKey
    });
    return {
      wireHash: target.wireHash,
      contractId: target.contractId,
      chatMessageId: target.chatMessageId,
      messageHex: msg.toBuffer().toString('hex'),
      delivery: chatDelivery.deliverySummary(out.record, me)
    };
  }

  /**
   * Chat-row convenience wrapper → unified wireHash receipt path.
   * @param {string} chatMessageId
   * @returns {object}
   */
  _markChatMessageReceipt (chatMessageId) {
    const row = this.registerStore && this.registerStore.get('chatmessages', String(chatMessageId));
    if (!row || !row.wireHash) {
      const e = new Error('message has no wire hash yet (await mesh/accumulate)');
      e.code = 'NOT_FOUND';
      throw e;
    }
    if (!String(row.channel || '').startsWith('group:')) {
      const e = new Error('delivery sync applies to contract (group) channels only');
      e.code = 'BAD_REQUEST';
      throw e;
    }
    const data = this._markDeliveryReceipt(row.wireHash, {
      contractId: row.contractId || null,
      chatMessageId: row.id
    });
    return Object.assign({ id: row.id }, data);
  }

  /**
   * Mesh MessageReceived / MessageReceipt → accumulate AMP bytes, then 2PC sidecar.
   * @param {object} object
   * @param {*} source
   * @param {object} [meta]
   * @param {string} [kind]
   */
  _applyRemoteDeliveryAck (object, source, meta = {}, kind = 'MessageReceipt') {
    if (!object) return;
    const contractId = (meta && meta.contract) || object.contractId || null;
    if (contractId && meta && (meta.wireMessage || meta.messageHex)) {
      this._accumulateContractMessageWire(contractId, meta, (meta && meta.origin) || 'mesh');
      return;
    }
    // Fallback when wire bytes are unavailable (legacy / tests).
    if (!this.registerStore) return;
    try {
      const chatDelivery = require('../functions/chatDelivery');
      const { resolveSignerPubkey } = require('../functions/identity');
      const signer = resolveSignerPubkey(source) || source || object.author;
      let readers = null;
      if (contractId && this.groupManager) {
        const group = this.groupManager.getGroupByContractId(contractId);
        if (group && typeof this.groupManager.getChatSealTip === 'function') {
          const tip = this.groupManager.getChatSealTip(group.id);
          if (tip && tip.memberPubkeys && tip.memberPubkeys.length) readers = tip.memberPubkeys;
        } else if (group && group.members) {
          readers = group.members;
        }
      }
      const body = Object.assign({}, object, {
        type: object.type || object['@type'] || kind,
        '@type': object['@type'] || object.type || kind
      });
      chatDelivery.applyRemoteDeliveryAck(this.registerStore, body, signer, {
        contractId,
        readers
      });
    } catch (e) {
      this.emit('debug', `[ARC] ${kind} ack failed: ${e && e.message ? e.message : e}`);
    }
  }

  /**
   * Ask peers for missing journal rows (newly connected / invite shell).
   * @param {Object} ev
   * @param {string} [ev.contractId]
   * @param {object} [ev.group]
   * @param {number} [ev.fromClock]
   */
  async _requestGroupJournal (ev = {}) {
    const contractId = (ev && ev.contractId)
      || (ev.group && ev.group.contractId)
      || null;
    if (!contractId) return null;
    await this._ensureFabric().catch(() => null);
    if (!this.fabricNetwork || !this.fabricNetwork.ready) return null;
    const groupId = (ev.group && ev.group.id) || ev.groupId || null;
    return this.fabricNetwork.publishGroupJournalRequest(contractId, {
      fromClock: ev.fromClock != null ? ev.fromClock : 1,
      groupId
    });
  }

  /**
   * Respond to a GroupJournalRequest with a Schnorr-attested batch.
   * @param {object} request
   * @param {string|null} source
   */
  async _respondGroupJournalRequest (request, source = null) {
    if (!request || !this.groupManager || !this.registerStore) return null;
    const contractId = String(request.contractId || '').trim();
    if (!contractId) return null;
    const group = this.groupManager.getGroupByContractId(contractId)
      || (request.groupId && this.groupManager.getGroup(request.groupId));
    if (!group) return null;
    // Cluster members (D-013 sameActor) may serve journal catch-up.
    const me = this._identity && this._identity.pubkey;
    if (!me || !this.groupManager.isMember(group.id, me)) return null;

    const data = this.groupManager.store.get('groups', group.id);
    const definition = this.groupManager._groupDefinition
      ? this.groupManager._groupDefinition(data)
      : null;
    if (!definition) return null;

    const groupStatechain = require('../functions/groupStatechain');
    const { gooncitizenContractId } = require('../contracts/gooncitizen');
    const { signGroupStateTip } = require('../functions/groupStateSigning');
    const fromClock = request.fromClock != null ? Number(request.fromClock) : 1;
    const batch = groupStatechain.buildJournalBatch(
      this.registerStore,
      contractId,
      definition,
      fromClock,
      { name: 'GoonCitizenGroup', parentContractId: gooncitizenContractId() }
    );
    if (this._identity) {
      const tip = signGroupStateTip(this._identity, contractId, batch.tipClock, batch.stateDigest);
      batch.signatures = { [tip.pubkey]: tip.signature };
    }
    await this._ensureFabric().catch(() => null);
    if (!this.fabricNetwork || !this.fabricNetwork.ready) return null;
    return this.fabricNetwork.publishGroupJournalBatch(contractId, batch);
  }

  /**
   * Publish GroupStateJournal tip attestation after a local mutation.
   * @param {string} contractId
   * @param {string|null} groupId
   */
  async _publishGroupStateTip (contractId, groupId = null) {
    if (!this._identity || !this.groupManager || !this.registerStore) return null;
    const group = this.groupManager.getGroupByContractId(contractId)
      || (groupId && this.groupManager.getGroup(groupId));
    if (!group || !group.includes(this._identity.pubkey)) return null;
    const data = this.groupManager.store.get('groups', group.id);
    const definition = this.groupManager._groupDefinition(data);
    if (!definition) return null;
    const groupStatechain = require('../functions/groupStatechain');
    const { signGroupStateTip, groupFabricIdentity } = require('../functions/groupStateSigning');
    const doc = groupStatechain.loadDoc(this.registerStore, contractId);
    const content = groupStatechain.foldGroupState(definition, doc.journal.entries);
    const stateDigest = groupStatechain.stateDigestOfContent(content);
    const tip = signGroupStateTip(this._identity, contractId, doc.clock, stateDigest);
    await this._ensureFabric().catch(() => null);
    if (!this.fabricNetwork || !this.fabricNetwork.ready) return null;
    return this.fabricNetwork.publishGroupStateJournal(contractId, {
      contractId,
      groupId: group.id,
      tipClock: doc.clock,
      stateDigest,
      identity: groupFabricIdentity(Object.assign({}, group, { contractId })),
      signatures: { [tip.pubkey]: tip.signature },
      attestedAt: new Date().toISOString()
    });
  }

  async _handle (req, res) {
    const base = '/services/star-citizen';
    const url = new URL(req.url, `http://localhost:${this.settings.port}`);
    const pathname = url.pathname;
    const cors = this._localDashboardCorsHeaders(req);
    if (cors && Object.keys(cors).length) {
      const origWriteHead = res.writeHead.bind(res);
      res.writeHead = function androidCorsWriteHead (code, headers, extra) {
        if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
          return origWriteHead(code, Object.assign({}, cors, headers), extra);
        }
        return origWriteHead(code, headers, extra);
      };
    }
    const send = (code, obj) => {
      res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, cors));
      res.end(JSON.stringify(obj, null, 2));
    };
    if (req.method === 'OPTIONS' && this._isAndroidMode()) {
      res.writeHead(204, cors);
      return res.end();
    }
    // Read the JSON body. When embedded behind Express (historical Hub mount), body-parser
    // has already consumed the stream and parsed req.body — use it directly.
    const body = async () => {
      if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) return req.body;
      const c = []; for await (const ch of req) c.push(ch); return c.length ? JSON.parse(Buffer.concat(c).toString()) : {};
    };

    try {
      // Fabric site login (D-011) — Passport / GoonCitizen client-signed sessions.
      const { tryHandleSiteLogin } = require('../functions/fabricSiteLogin');
      const siteLogin = await tryHandleSiteLogin(this, req, res, pathname, body);
      if (siteLogin === true) return;
      const { tryHandleDeviceLink } = require('../functions/fabricDeviceLinkRelay');
      if (await tryHandleDeviceLink(this, req, res, pathname, body)) return;
      const { tryHandleDeviceLinkLocal } = require('../functions/fabricDeviceLinkLocalHttp');
      if (await tryHandleDeviceLinkLocal(this, req, res, pathname, body, send)) return;
      // Hub-compatible peering discovery (OPTIONS ARC + /services/peering).
      // Must run before the SPA GET `/` branch so OPTIONS is not 404'd.
      const liveRelayPeeringHttp = require('../functions/liveRelayPeeringHttp');
      if (liveRelayPeeringHttp.tryHandlePeeringDiscovery(this, req, res, pathname)) return;
      // GET /sessions → same dashboard (header SiteLogin buttons).
      const serveSpa = siteLogin === 'spa' ||
        (req.method === 'GET' && (pathname === '/' || pathname === `${base}/ui` ||
          pathname === '/groups' || /^\/groups\/[^/]+$/.test(pathname) ||
          pathname === '/profiles' || /^\/profiles\/[^/]+$/.test(pathname) ||
          pathname === '/missions' || /^\/missions\/[^/]+$/.test(pathname) ||
          pathname === '/collections' || /^\/collections\/[^/]+\/[^/]+$/.test(pathname) ||
          pathname === '/files' || /^\/files\/[^/]+$/.test(pathname) ||
          pathname === '/locations' ||
          (/^\/locations\/[^/]+$/.test(pathname) &&
            pathname !== '/locations/map' && pathname !== '/locations/reports') ||
          /^\/wallet\/construct\/?$/.test(pathname)));
      if (serveSpa) {
        let html;
        try {
          const uiPath = path.join(__dirname, '..', 'assets', 'index.html');
          // Invalidate in-memory SPA shell when assets/index.html is rebuilt
          // (npm run build:browser) so desktop does not require a full restart.
          const st = fs.statSync(uiPath);
          const mtimeMs = st.mtimeMs || st.mtime.getTime();
          if (!this._uiHtml || this._uiHtmlMtimeMs !== mtimeMs) {
            this._uiHtml = fs.readFileSync(uiPath, 'utf8');
            this._uiHtmlMtimeMs = mtimeMs;
          }
          html = this._uiHtml;
        } catch (_) {
          html = '<h1>GoonCitizen</h1><p>UI missing — run <code>npm run build:browser</code> to generate assets/index.html from components/Dashboard.js.</p>';
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }
      // Always-on-top desktop overlay (primary group members + ships).
      if (req.method === 'GET' && (pathname === '/overlay' || pathname === '/overlay.html')) {
        try {
          const overlayPath = path.join(__dirname, '..', 'assets', 'overlay.html');
          const html = fs.readFileSync(overlayPath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(html);
        } catch (_) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('overlay missing');
        }
      }
      if (req.method === 'GET' && pathname === `${base}/overlay/primary-group`) {
        if (!this._requireSession(req, send)) return;
        return send(200, { type: 'PrimaryGroupOverlay', data: this.getPrimaryGroupOverlay() });
      }
      // Parser rules — the configured regular expressions, for the dashboard's
      // rules table (toggle-to-highlight in the live log browser).
      if (req.method === 'GET' && pathname === `${base}/rules`) {
        return send(200, {
          type: 'Collection',
          data: RULES.map((r, i) => ({
            id: `rule-${i}`,
            kind: r.kind,
            tag: r.tag || null,
            pattern: r.test.source,
            flags: r.test.flags || '',
            verified: r.verified !== false
          }))
        });
      }
      // Grouped missions (by MissionId), objectives joined in.
      if (req.method === 'GET' && pathname === `${base}/missiongroups`) {
        if (!this._requireSession(req, send)) return;
        return send(200, { type: 'Collection', data: this.missionGroups });
      }
      // Combat progress inferred from mission objectives (proxy for kills).
      if (req.method === 'GET' && pathname === `${base}/combat`) {
        if (!this._requireSession(req, send)) return;
        return send(200, { type: 'Collection', data: this.combatlog });
      }
      // Analytics: compact merged dataset (backfilled history + live session) for
      // the "Analyze" dashboard tab. The client slices it by month/year + pilot +
      // mission type + outcome. Local-player today; same shape serves shared multi-pilot history (M4).
      if (req.method === 'GET' && pathname === `${base}/analytics`) {
        if (!this._requireSession(req, send)) return;
        return send(200, this._analyticsDataset());
      }
      // Player log corpus: every Game.log + logbackup feeding cumulative Analyze.
      if (req.method === 'GET' && pathname === `${base}/corpus`) {
        if (!this._requireSession(req, send)) return;
        return send(200, this._corpusStatus());
      }
      if (req.method === 'POST' && pathname === `${base}/corpus/sync`) {
        if (this.settings.mode === 'server') {
          return send(400, { error: 'corpus sync is a local-player operation' });
        }
        if (this._enforceRemoteAuth(req) && !this._authPubkey(req)) {
          return send(401, { error: 'Authentication required (POST …/auth with a signed login envelope)' });
        }
        const result = await this._syncCumulativeHistory();
        return send(200, { type: 'LogCorpusSync', result, corpus: this._corpusStatus() });
      }
      // Import folders and/or individual *.log files into cumulative history (local only).
      if (req.method === 'POST' && pathname === `${base}/corpus/import`) {
        if (this.settings.mode === 'server') {
          return send(400, { error: 'corpus import is a local-player operation' });
        }
        if (this._enforceRemoteAuth(req) && !this._authPubkey(req)) {
          return send(401, { error: 'Authentication required (POST …/auth with a signed login envelope)' });
        }
        const d = await body();
        const dirs = Array.isArray(d.dirs) ? d.dirs : (d.dir ? [d.dir] : []);
        const files = Array.isArray(d.files) ? d.files : (d.file ? [d.file] : []);
        if (!dirs.length && !files.length) {
          return send(400, { error: 'dirs and/or files required' });
        }
        try {
          const out = await this._importCorpus({
            dirs: dirs.length ? dirs : undefined,
            files: files.length ? files : undefined,
            sync: d.sync !== false
          });
          return send(200, out);
        } catch (e) {
          return send(400, { error: e.message });
        }
      }
      if (req.method === 'POST' && pathname === `${base}/corpus/remove`) {
        if (this.settings.mode === 'server') {
          return send(400, { error: 'corpus remove is a local-player operation' });
        }
        if (this._enforceRemoteAuth(req) && !this._authPubkey(req)) {
          return send(401, { error: 'Authentication required (POST …/auth with a signed login envelope)' });
        }
        const d = await body();
        const removeDirs = new Set(fsBrowser.sanitizeCorpusDirs(Array.isArray(d.dirs) ? d.dirs : (d.dir ? [d.dir] : [])));
        const removeFiles = new Set(fsBrowser.sanitizeCorpusFiles(Array.isArray(d.files) ? d.files : (d.file ? [d.file] : [])));
        if (!removeDirs.size && !removeFiles.size) {
          return send(400, { error: 'dirs and/or files required' });
        }
        try {
          const out = await this._importCorpus({
            dirs: removeDirs.size ? this._corpusDirs().filter((p) => !removeDirs.has(p)) : undefined,
            files: removeFiles.size ? this._corpusFiles().filter((p) => !removeFiles.has(p)) : undefined,
            replaceDirs: !!removeDirs.size,
            replaceFiles: !!removeFiles.size,
            sync: false
          });
          return send(200, Object.assign(out, {
            type: 'LogCorpusRemove',
            removedDirs: [...removeDirs],
            removedFiles: [...removeFiles]
          }));
        } catch (e) {
          return send(400, { error: e.message });
        }
      }
      // Read-only directory listing for the Feed / Analyze file browser (local only).
      if (req.method === 'GET' && pathname === `${base}/fs`) {
        if (this.settings.mode === 'server') {
          return send(400, { error: 'filesystem browse is a local-player operation' });
        }
        if (!this._requireSession(req, send)) return;
        const listing = fsBrowser.listDirectory(url.searchParams.get('path'));
        return send(listing.error && listing.error === 'path not found' ? 404 : 200, listing);
      }
      // Fabric Tree over cumulative history leaves (preview or publish to a Group).
      if (req.method === 'GET' && pathname === `${base}/activity-tree`) {
        if (!this._requireSession(req, send)) return;
        const tree = activityTree.buildActivityTree(this.history, {
          ownerPubkey: (this._identity && this._identity.pubkey) || null
        });
        return send(200, tree);
      }
      if (req.method === 'POST' && pathname === `${base}/activity-tree/publish`) {
        if (this._enforceRemoteAuth(req) && !this._authPubkey(req)) {
          return send(401, { error: 'Authentication required (POST …/auth with a signed login envelope)' });
        }
        const d = await body();
        const groupId = d.groupId || d.id;
        if (!groupId) return send(400, { error: 'groupId required' });
        try {
          const out = await this.publishActivityTreeToGroup(groupId, { publish: d.publish !== false });
          return send(200, Object.assign({ type: 'GroupActivityTreePublish' }, out));
        } catch (e) {
          return send(400, { error: e.message });
        }
      }
      // Snapshot for the monitor UI: counts + recent + combat candidates (newest first).
      if (req.method === 'GET' && pathname === `${base}/monitor`) {
        if (!this._requireSession(req, send)) return;
        const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 250, 1000);
        const newest = (arr) => arr.slice(-limit).reverse();
        const cumulative = cumulativeHistory.cumulativeCounts(this.history);
        const feed = this._liveFeedSnapshot(limit);
        return send(200, {
          status: this.status, startedAt: this.state.startedAt, now: new Date().toISOString(),
          loginfo: this._logInfo(), reparse: this._reparse, corpus: this._corpusStatus(),
          channel: this.channel, session: this.session, sessions: this.sessions,
          missions: this.missionGroups,
          missionStats: this.missionStats(),
          kills: newest(this.kills),
          deaths: newest(this.deaths),
          feed,
          counts: {
            // Header / home default to cumulative (all-time local history).
            missions: cumulative.missions,
            deaths: cumulative.deaths,
            players: cumulative.players,
            sessions: cumulative.sessions,
            completed: cumulative.completed,
            abandoned: cumulative.abandoned,
            failed: cumulative.failed,
            // Session-scoped (this process / current Game.log seed + live).
            session: {
              activities: this.activities.length, players: this.players.length, logins: this.logins.length,
              vehicles: this.vehicles.length, kills: this.kills.length, incaps: this.incaps.length, deaths: this.deaths.length,
              missionlog: this.missionlog.length, missions: this.missionGroups.length, notifications: this.notifications.length,
              combat: this.combatlog.length,
              logs: this.logs.length, flagged: this.flagged.length
            },
            // Aliases kept for older UI bits that still read session fields.
            activities: this.activities.length, kills: this.kills.length, incaps: this.incaps.length,
            vehicles: this.vehicles.length, logins: this.logins.length,
            missionlog: this.missionlog.length, notifications: this.notifications.length,
            combat: this.combatlog.length, logs: this.logs.length, flagged: this.flagged.length
          },
          recent: newest(this.recent),
          flagged: newest(this.flagged)
        });
      }
      // Chat-style unified activity stream (local parse + peer ingest).
      if (req.method === 'GET' && pathname === `${base}/feed`) {
        if (!this._requireSession(req, send)) return;
        const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 400, 2000);
        return send(200, Object.assign({ type: 'LiveFeed' }, this._liveFeedSnapshot(limit)));
      }
      if (req.method === 'GET' && pathname === base) {
        return send(200, { type: 'StarCitizen', data: {
          status: this.status, startedAt: this.state.startedAt, channel: this.channel, session: this.session, sessions: this.sessions.length,
          activities: this.activities.length, players: this.players.length, logins: this.logins.length,
          vehicles: this.vehicles.length, kills: this.kills.length, incaps: this.incaps.length, deaths: this.deaths.length,
          missionlog: this.missionlog.length, missionStats: this.missionStats(),
          logs: this.logs.length, missions: this.missions.length
        }});
      }
      // ---- Operator settings + peers (Hub-compatible shapes; LOCAL relay only) ----
      // Mirrors hub.fabric.pub: GET /settings (list), PUT /settings/:name, and
      // AddPeer/RemovePeer/ListPeers semantics over REST. Disabled in hosted
      // server mode — goon.vc settings belong to the Hub's own settings API.
      if (this.settings.mode !== 'server') {
        const store = this.registerStore;
        const editable = !!(store && store.persistent);
        const mutating = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
        if (mutating && this._enforceRemoteAuth(req) && !this._authPubkey(req)) {
          return send(401, { error: 'Authentication required (POST …/auth with a signed login envelope)' });
        }
        if (req.method === 'GET' && pathname === '/settings') {
          if (!this._requireSession(req, send)) return;
          const fabricStatus = this.fabricNetwork ? this.fabricNetwork.status() : {
            enable: this.settings.fabric.enable !== false,
            fabricListenPort: this.settings.fabric.port,
            fabricPeerId: this._identity ? this._identity.pubkey : null,
            fabricConnected: 0,
            ready: false
          };
          return send(200, {
            success: true,
            settings: settingsStore.loadSettings(store),
            editable,
            allowedKeys: settingsStore.ALLOWED_KEYS,
            runtime: {
              logfile: this.settings.logfile,
              channel: this.channel,
              port: this.settings.port,
              httpHost: this._httpListenHost(),
              httpSharedMode: this._httpSharedMode === true,
              mode: this.settings.mode,
              identity: this._identity ? this._identity.pubkey : null,
              uplinkActive: !!this._uplinkTimer,
              uplinkQueued: this._uplinkQueue.length,
              shareLogsGlobal: this._shareLogsGlobal === true,
              groupChatSeal: this._groupChatSeal === true,
              requireSealedGroupChat: this._requireSealedGroupChat === true,
              sharePresence: this._sharePresence === true,
              presenceVisibility: this._presenceVisibility || 'private',
              shareLogsActive: this._canShareLogs(),
              shareLogsTargets: this._logShareTargets(),
              fabricListenPort: fabricStatus.fabricListenPort,
              fabricPeerId: fabricStatus.fabricPeerId,
              fabricConnected: fabricStatus.fabricConnected,
              fabricConnections: fabricStatus.fabricConnections || [],
              fabricReady: fabricStatus.ready,
              meshAliases: Object.keys(this._peerAliasByPubkey || {}).map((pubkey) => ({
                pubkey,
                alias: this._peerAliasByPubkey[pubkey]
              })),
              localProfile: this._localProfile(),
              networkObserve: this._hubObserve,
              fabricAdvertiseHost: this._fabricAdvertiseHost || null,
              broadcastPeering: this._broadcastPeering === true,
              primaryGroupId: this._primaryGroupId || null,
              primaryGroupColor: this._primaryGroupColor(),
              defaultGroupMessageId: this._defaultGroupMessageId || null,
              groupOverlay: this._groupOverlay === true,
              fabricShareEncoding: this._opaqueShareEncoding(),
              shareDiscordCatalog: this._shareDiscordCatalog === true,
              sharePlaytimes: this._sharePlaytimes === true,
              shareFiles: this._hasPinnedProfileFiles(),
              selfPeering: (() => {
                const listenPort = Number(this.settings.fabric && this.settings.fabric.port) || 7777;
                const info = peerPeeringString.peeringInfoForGoonCitizen({
                  pubkey: this._identity && this._identity.pubkey,
                  advertiseHost: this._fabricAdvertiseHost,
                  listenPort
                });
                return info.string || null;
              })(),
              snapshots: this.snapshotManager ? this.snapshotManager.stats() : null,
              bitcoin: hubBitcoinProxy.bitcoinRuntimeForSettings(this.settings),
              documents: hubDocumentExchangeProxy.documentsRuntimeForSettings(this.settings),
              discord: this._discordRuntime()
            }
          });
        }
        let sMatch;
        if ((sMatch = pathname.match(/^\/settings\/([a-zA-Z]+)$/)) && req.method === 'PUT') {
          if (this._enforceRemoteAuth(req) && !this._authPubkey(req)) {
            return send(401, { error: 'Authentication required (POST …/auth with a signed login envelope)' });
          }
          if (!editable) return send(400, { error: 'No persistent store configured (settingsDir)' });
          const d = await body();
          try {
            const updated = settingsStore.putSetting(store, sMatch[1], d.value);
            // Live-applicable settings take effect immediately; the rest on restart.
            let requiresRestart = ['logfile', 'channel'].includes(sMatch[1]);
            if (sMatch[1] === 'peers') {
              this.peers = (updated.peers || []).map((p) => this._normalizePeerRecord(p)).filter(Boolean);
              this._refreshFabric().catch((e) => this.emit('error', e));
              requiresRestart = false;
            }
            if (sMatch[1] === 'fabricPort') {
              this.settings.fabric.port = Number(updated.fabricPort) || 7777;
              this._refreshFabric().catch((e) => this.emit('error', e));
              requiresRestart = false;
            }
            if (sMatch[1] === 'uplinkIntervalMs') { this.settings.uplink.intervalMs = updated.uplinkIntervalMs || 5000; requiresRestart = false; }
            if (sMatch[1] === 'shareLogsGlobal') { this._shareLogsGlobal = updated.shareLogsGlobal === true; requiresRestart = false; }
            if (sMatch[1] === 'groupChatSeal') { this._groupChatSeal = updated.groupChatSeal === true; requiresRestart = false; }
            if (sMatch[1] === 'requireSealedGroupChat') {
              this._requireSealedGroupChat = updated.requireSealedGroupChat === true;
              requiresRestart = false;
            }
            if (sMatch[1] === 'httpSharedMode') {
              this._httpSharedMode = updated.httpSharedMode === true;
              requiresRestart = false;
              // Rebind after this response finishes — closing the server while the
              // PUT is still open would deadlock server.close().
              res.once('finish', () => {
                this._rebindHttpListener().catch((e) => this.emit('error', e));
              });
            }
            if (sMatch[1] === 'nickname') {
              this._nickname = updated.nickname || null;
              this._publishPeerAlias(this._nickname).catch((e) => this.emit('error', e));
              this._publishLocalProfile().catch((e) => this.emit('error', e));
              this._scheduleAccountDataReplay();
              requiresRestart = false;
            }
            if (sMatch[1] === 'profile') {
              this._profile = peerProfile.sanitizeProfile(updated.profile);
              this._publishLocalProfile().catch((e) => this.emit('error', e));
              this._scheduleAccountDataReplay();
              requiresRestart = false;
            }
            if (sMatch[1] === 'fabricAdvertiseHost') {
              this._fabricAdvertiseHost = updated.fabricAdvertiseHost || null;
              if (this.fabricNetwork) {
                this.fabricNetwork.setAdvertiseHost(this._fabricAdvertiseHost);
                // Opt-in gate: only announce when broadcastPeering is on.
                this.fabricNetwork.maybePublishPeeringOffer();
              }
              requiresRestart = false;
            }
            if (sMatch[1] === 'broadcastPeering') {
              this._broadcastPeering = updated.broadcastPeering === true;
              if (this.fabricNetwork) {
                this.fabricNetwork.setBroadcastPeering(this._broadcastPeering);
                if (this._broadcastPeering) {
                  this.fabricNetwork.maybePublishPeeringOffer({ force: true });
                }
              }
              requiresRestart = false;
            }
            if (sMatch[1] === 'notifyMissionBroadcasts') { this._notifyMissionBroadcasts = updated.notifyMissionBroadcasts !== false; requiresRestart = false; }
            if (sMatch[1] === 'primaryGroupId') {
              this._primaryGroupId = settingsStore.sanitizePrimaryGroupId(updated.primaryGroupId);
              requiresRestart = false;
            }
            if (sMatch[1] === 'groupOverlay') {
              this._groupOverlay = updated.groupOverlay === true;
              requiresRestart = false;
            }
            if (sMatch[1] === 'fabricShareEncoding') {
              this._fabricShareEncoding = settingsStore.sanitizeFabricShareEncoding(updated.fabricShareEncoding) || 'base64';
              requiresRestart = false;
            }
            if (sMatch[1] === 'shareDiscordCatalog') {
              this._shareDiscordCatalog = updated.shareDiscordCatalog === true;
              if (this._shareDiscordCatalog) this._discordCatalogShareAt = 0;
              requiresRestart = false;
            }
            if (sMatch[1] === 'sharePlaytimes') {
              this._sharePlaytimes = updated.sharePlaytimes === true;
              if (this._sharePlaytimes) this._publishGroupDataShareNow();
              requiresRestart = false;
            }
            if (sMatch[1] === 'shareFiles') {
              const on = updated.shareFiles === true;
              if (this.registerStore) {
                for (const row of localDocuments.list(this.registerStore) || []) {
                  if (!row || !row.id) continue;
                  if (on && row.published === true) {
                    localDocuments.setProfilePinned(this.registerStore, row.id, true, this._documentPublishOpts());
                  } else if (!on) {
                    localDocuments.setProfilePinned(this.registerStore, row.id, false, this._documentPublishOpts());
                  }
                }
              }
              if (on || this._hasPinnedProfileFiles()) this._publishGroupDataShareNow();
              requiresRestart = false;
            }
            if (sMatch[1] === 'corpusDirs' || sMatch[1] === 'corpusFiles') {
              // Imported log folders/files apply live — sync into cumulative history.
              requiresRestart = false;
              this._syncCumulativeHistory().catch((e) => this.emit('error', e));
            }
            if (sMatch[1].startsWith('snapshot')) { this._applySnapshotSettings(updated); requiresRestart = false; }
            if (sMatch[1].startsWith('notify')) { requiresRestart = false; }
            if (sMatch[1] === 'sharePresence' || sMatch[1] === 'presenceVisibility' ||
              sMatch[1] === 'presenceGroupIds' || sMatch[1] === 'shipOverrideSlug' ||
              sMatch[1] === 'presenceAvailability' || sMatch[1] === 'presenceStatusText') {
              this._applyPresenceSettings(updated);
              if (this._sharePresence) {
                this.publishPresence().catch((e) => this.emit('error', e));
              }
              requiresRestart = false;
            }
            if (sMatch[1] === 'presenceAvailability' || sMatch[1] === 'presenceStatusText' ||
                sMatch[1] === 'sharePresence' || sMatch[1] === 'presenceVisibility' ||
                sMatch[1] === 'presenceGroupIds' || sMatch[1] === 'shipOverrideSlug') {
              // presence handlers above set requiresRestart
            }
            if (String(sMatch[1]).startsWith('discord')) {
              this._applyDiscordConfig();
              if (['discordBotEnable', 'discordAppId', 'discordChannel'].includes(sMatch[1])) {
                this._startDiscordBot().catch((e) => this.emit('error', e));
              }
              requiresRestart = false;
            }
            return send(200, {
              success: true,
              settings: updated,
              requiresRestart,
              runtime: {
                primaryGroupId: this._primaryGroupId || null,
                primaryGroupColor: this._primaryGroupColor(),
                shareDiscordCatalog: this._shareDiscordCatalog === true,
                sharePlaytimes: this._sharePlaytimes === true,
                shareFiles: this._hasPinnedProfileFiles(),
                discord: this._discordRuntime()
              }
            });
          } catch (e) { return send(400, { error: e.message }); }
        }
        if (pathname === '/settings/discord/secrets' && req.method === 'PUT') {
          if (!editable) return send(400, { error: 'No persistent store configured (settingsDir)' });
          const d = await body();
          try {
            const summary = discordConfig.writeSecretsFile(this.settings.settingsDir, {
              token: d.token,
              appSecret: d.appSecret != null ? d.appSecret : d.clientSecret,
              webhook: d.webhook
            });
            this._applyDiscordConfig();
            await this._startDiscordBot();
            return send(200, {
              success: true,
              secrets: summary,
              runtime: { discord: this._discordRuntime() }
            });
          } catch (e) {
            return send(400, { error: e.message });
          }
        }
        if (pathname === '/settings/primaryGroup/from-message' && req.method === 'POST') {
          if (!editable) return send(400, { error: 'No persistent store configured (settingsDir)' });
          const d = await body();
          try {
            const result = this.resolveAndSetDefaultGroup(d.value != null ? d.value : d.paste, {
              apply: d.apply !== false
            });
            if (!result.ok) return send(400, { error: result.error || 'resolve failed', data: result });
            return send(200, {
              success: true,
              data: result,
              settings: this.registerStore ? settingsStore.loadSettings(this.registerStore) : {},
              runtime: {
                primaryGroupId: this._primaryGroupId || null,
                primaryGroupColor: this._primaryGroupColor(),
                defaultGroupMessageId: this._defaultGroupMessageId || null
              }
            });
          } catch (e) { return send(400, { error: e.message }); }
        }
        if (pathname === `${base}/peers` || pathname === '/peers') {
          // Shared-mode / hosted-style remote auth: do not leak the peer roster
          // (or accept AddPeer) to unauthenticated LAN neighbors.
          if (!this._requireSession(req, send)) return;
          if (req.method === 'GET') return send(200, { type: 'Collection', data: this._peersWithStatus() });
          if (req.method === 'POST') {
            const d = await body();
            const raw = d.address || d.url || d.peering || '';
            const parsed = peerPeeringString.parsePeerDialInput(raw) ||
              (() => {
                const address = FabricNetwork.normalizeFabricAddress(raw, { migrate: false });
                return address ? { address, pubkey: null } : null;
              })();
            if (!parsed || !parsed.address) {
              return send(400, {
                error: 'peer address must be host:port or pubkey@host:port (Fabric), e.g. relay.goon.vc:7777'
              });
            }
            const address = parsed.address;
            // Loopback to *another* port is valid (local Hub faucet on :7777 while
            // desktop listens on :7778). Same-port loopback is caught as self below.
            if (FabricNetwork.isSelfFabricAddress(address, this._selfFabricDialOpts())) {
              return send(400, { error: 'refusing to dial this node (self) — set fabricAdvertiseHost / FABRIC_PUBLIC_HOST if this keeps happening' });
            }
            if (this.peers.some((p) => p.address === address)) return send(400, { error: 'peer already exists' });
            const peer = {
              id: idFor(address),
              address,
              label: d.label || null,
              enabled: d.enabled !== false,
              shareLogs: d.shareLogs === true,
              expectedPubkey: parsed.pubkey || (d.pubkey ? String(d.pubkey).trim().toLowerCase() : null)
            };
            this.peers.push(peer);
            this._persistPeers();
            this._refreshFabric().catch((e) => this.emit('error', e));
            this.emit('peer:added', peer);
            return send(200, { type: 'Peer', data: this._peersWithStatus().find((p) => p.id === peer.id) || peer });
          }
        }
        if (pathname === `${base}/peers/announce` || pathname === '/peers/announce') {
          if (req.method === 'POST') {
            if (!this._requireSession(req, send)) return;
            if (!this._identity) {
              return send(400, { error: 'Unlock your identity to announce peering' });
            }
            if (!this._fabricAdvertiseHost) {
              return send(400, { error: 'Set fabricAdvertiseHost before announcing (Settings or Network → Peers)' });
            }
            try {
              await this._ensureFabric();
              if (!this.fabricNetwork || !this.fabricNetwork.ready) {
                return send(400, { error: 'Fabric peer is not ready' });
              }
              const msg = this.fabricNetwork.publishPeeringOffer({ force: true });
              if (!msg) {
                return send(400, {
                  error: 'Could not announce — need at least one live Fabric connection and an open peer slot'
                });
              }
              const listenPort = Number(this.settings.fabric && this.settings.fabric.port) || 7777;
              const selfPeering = peerPeeringString.peeringInfoForGoonCitizen({
                pubkey: this._identity.pubkey,
                advertiseHost: this._fabricAdvertiseHost,
                listenPort
              });
              return send(200, {
                type: 'PeeringAnnounce',
                data: {
                  ok: true,
                  peering: selfPeering.string || null,
                  broadcastPeering: this._broadcastPeering === true
                }
              });
            } catch (e) {
              return send(400, { error: e.message || String(e) });
            }
          }
        }
        if (pathname === `${base}/peers/restore-seeds` || pathname === '/peers/restore-seeds') {
          if (req.method === 'POST') {
            if (!this._requireSession(req, send)) return;
            const result = this._healPeerRoster({ persist: true, forceHubs: true });
            this._refreshFabric().catch((e) => this.emit('error', e));
            return send(200, {
              type: 'PeerRosterHeal',
              data: {
                removed: result.removed,
                added: result.added,
                peers: this._peersWithStatus()
              }
            });
          }
        }
        if (pathname === `${base}/profile` || pathname === '/profile') {
          if (req.method === 'GET') {
            if (!this._requireSession(req, send)) return;
            return send(200, { type: 'PeerProfile', data: this._localProfile() });
          }
        }
        let profileMatch;
        if ((profileMatch = pathname.match(new RegExp(`^(?:${base})?/profiles/([^/]+)$`))) && req.method === 'GET') {
          if (!this._requireSession(req, send)) return;
          const detail = this._profileDetailByActor(decodeURIComponent(profileMatch[1]));
          if (!detail) return send(404, { error: 'Profile not found' });
          return send(200, { type: 'PeerProfileDetail', data: detail });
        }
        if (pathname === `${base}/presence` || pathname === '/presence') {
          if (req.method === 'GET') {
            if (!this._requireSession(req, send)) return;
            return send(200, { type: presence.PRESENCE_TYPE, data: this.getPresenceStatus() });
          }
          if (req.method === 'PUT') {
            if (!this._requireSession(req, send)) return;
            const d = await body();
            try {
              const result = this.setPresenceSettings(d || {});
              return send(200, { type: presence.PRESENCE_TYPE, data: result });
            } catch (e) {
              return send(400, { error: e.message, code: e.code || null });
            }
          }
        }
        if (pathname === `${base}/presence/ship` || pathname === '/presence/ship') {
          if (req.method === 'PUT') {
            if (!this._requireSession(req, send)) return;
            const d = await body();
            try {
              let slug = null;
              if (d && d.autodetect === true) slug = null;
              else if (d && (d.clear === true || presence.isShipClearedSlug(d.slug))) {
                slug = presence.SHIP_NONE_SLUG;
              } else if (d && d.slug !== undefined) slug = d.slug;
              const result = this.setShipOverride(slug);
              return send(200, { type: presence.PRESENCE_TYPE, data: result });
            } catch (e) {
              return send(400, { error: e.message, code: e.code || null });
            }
          }
        }
        if (pathname === `${base}/presence/roster` || pathname === '/presence/roster') {
          if (req.method === 'GET') {
            if (!this._requireSession(req, send)) return;
            return send(200, {
              type: 'PeerPresenceRoster',
              data: this.getPresenceRoster()
            });
          }
        }
        // Fabric AMP Message log (wire Messages only — not Game.log). Advanced UI.
        if (pathname === `${base}/fabric/messages` || pathname === '/fabric/messages') {
          if (req.method === 'GET') {
            if (!this._requireSession(req, send)) return;
            const q = url.searchParams;
            const hideKeepalive = q.get('keepalive') !== '1' && q.get('hideKeepalive') !== '0';
            if (q.get('format') === 'collection' || q.get('format') === 'fabric-message-collection') {
              const { collectionFromLog } = require('../functions/fabricMessageLog');
              return send(200, collectionFromLog(this._fabricMessageLog, {
                hideKeepalive,
                limit: Number(q.get('limit')) || 2000
              }));
            }
            const messages = this._fabricMessageLog.list({
              limit: Number(q.get('limit')) || 200,
              direction: q.get('dir') || q.get('direction') || null,
              type: q.get('type') || null,
              q: q.get('q') || q.get('filter') || null,
              contract: q.get('contract') || q.get('contractId') || null,
              hideKeepalive
            });
            return send(200, {
              type: 'FabricMessageLog',
              data: messages,
              meta: this._fabricMessageLog.status()
            });
          }
          if (req.method === 'DELETE') {
            if (!this._requireSession(req, send)) return;
            return send(200, { type: 'FabricMessageLog', data: this._fabricMessageLog.clear() });
          }
        }
        if (pathname === `${base}/fabric/messages/clear` || pathname === '/fabric/messages/clear') {
          if (req.method === 'POST' || req.method === 'DELETE') {
            if (!this._requireSession(req, send)) return;
            return send(200, { type: 'FabricMessageLog', data: this._fabricMessageLog.clear() });
          }
        }
        if (pathname === `${base}/fabric/messages/pause` || pathname === '/fabric/messages/pause') {
          if (req.method === 'POST') {
            if (!this._requireSession(req, send)) return;
            this._fabricMessageLog.pause();
            return send(200, { type: 'FabricMessageLog', meta: this._fabricMessageLog.status() });
          }
        }
        if (pathname === `${base}/fabric/messages/resume` || pathname === '/fabric/messages/resume') {
          if (req.method === 'POST') {
            if (!this._requireSession(req, send)) return;
            this._fabricMessageLog.resume();
            return send(200, { type: 'FabricMessageLog', meta: this._fabricMessageLog.status() });
          }
        }
        if ((pathname === `${base}/fabric/messages/decode` || pathname === '/fabric/messages/decode') &&
            req.method === 'POST') {
          if (!this._requireSession(req, send)) return;
          const d = await body();
          try {
            const data = this.decodeOpaqueFabricMessage(
              d.protocolUrl || d.messageHex || d.messageBase64 || d.hex || d.base64 || d.message || ''
            );
            return send(200, { type: 'FabricMessageDecode', data });
          } catch (e) {
            return send(400, { error: e.message || String(e) });
          }
        }
        // Discord coordination sequence tree (Request → Claim → Response).
        if ((pathname === `${base}/fabric/messages/tree` || pathname === '/fabric/messages/tree') &&
            req.method === 'GET') {
          if (!this._requireSession(req, send)) return;
          const requestId = String(url.searchParams.get('requestId') || url.searchParams.get('id') || '').trim();
          if (!requestId) return send(400, { error: 'requestId required' });
          return send(200, {
            type: 'DiscordSequenceTree',
            data: this.discordSequenceTree(requestId)
          });
        }
        let fabricMsgMatch;
        if ((fabricMsgMatch = pathname.match(new RegExp(`^(?:${base})?/fabric/messages/([^/]+)$`))) &&
            req.method === 'GET') {
          if (!this._requireSession(req, send)) return;
          const msgId = decodeURIComponent(fabricMsgMatch[1]);
          const row = this._fabricMessageLog.get(msgId);
          if (!row) {
            return send(200, {
              type: 'FabricMessage',
              data: { hash: msgId, missing: true }
            });
          }
          return send(200, { type: 'FabricMessage', data: row });
        }
      }

      // Discord ↔ Fabric link is per-session identity (hosted + desktop).
      // Guild catalog / world-view stay in the desktop-only block so a hosted
      // session cannot read the operator bot roster.
      if ((pathname === `${base}/discord/link` || pathname === '/discord/link') &&
          (req.method === 'GET' || req.method === 'POST' || req.method === 'DELETE')) {
        if (!this._requireSession(req, send)) return;
        const me = this._requestViewer(req);
        if (!me) {
          return send(401, { error: 'Unlock your identity to link Discord' });
        }
        if (req.method === 'GET') {
          return send(200, {
            type: 'DiscordIdentityLink',
            data: this._discordLinkStatus(me)
          });
        }
        if (req.method === 'POST') {
          const pending = this._createDiscordLinkChallenge(me);
          return send(200, {
            type: 'DiscordIdentityLinkChallenge',
            data: Object.assign({
              linked: discordIdentityLink.linkForPubkey(this._discordIdentityLinks, me) || null
            }, pending)
          });
        }
        const { removed } = this._unlinkDiscordIdentity({ pubkey: me });
        return send(200, {
          type: 'DiscordIdentityLink',
          data: { unlinked: !!removed, removed: removed || null }
        });
      }

      if (this.settings.mode !== 'server') {
        const mutating = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
        if (mutating && this._enforceRemoteAuth(req) && !this._authPubkey(req)) {
          return send(401, { error: 'Authentication required (POST …/auth with a signed login envelope)' });
        }
        // Discord guild / channel / user catalog for Chat Discord insight.
        if ((pathname === `${base}/discord/links` || pathname === '/discord/links') &&
            req.method === 'GET') {
          if (!this._requireSession(req, send)) return;
          return send(200, {
            type: 'Collection',
            data: this._listDiscordIdentityLinks()
          });
        }
        if ((pathname === `${base}/discord/guilds` || pathname === '/discord/guilds') &&
            req.method === 'GET') {
          if (!this._requireSession(req, send)) return;
          const catalog = await this._discordGuildCatalog({
            force: url.searchParams.get('refresh') === '1'
          });
          return send(200, { type: 'DiscordGuildCatalog', data: catalog });
        }
        if ((pathname === `${base}/world-view` || pathname === '/world-view' ||
            pathname === `${base}/discord/world-view` || pathname === '/discord/world-view') &&
            req.method === 'GET') {
          if (!this._requireSession(req, send)) return;
          const catalog = await this._discordGuildCatalog({
            force: url.searchParams.get('refresh') === '1'
          });
          return send(200, {
            type: 'WorldView',
            data: catalog.worldView || groupDataSync.composeWorldView({
              catalog,
              messageStats: this.registerStore
                ? discordCatalogAccumulate.loadChannelMessageStats(this.registerStore)
                : [],
              playtimes: this.registerStore
                ? profilePlaytimes.loadAllPlaytimes(this.registerStore)
                : [],
              files: this.registerStore
                ? profileFiles.loadAllFiles(this.registerStore)
                : [],
              notes: this.registerStore
                ? profileNotes.loadAllNotes(this.registerStore)
                : [],
              sourceAppId: this._discordSourceAppId(),
              botReady: catalog.botReady === true
            })
          });
        }
        if ((pathname === `${base}/search` || pathname === '/search') && req.method === 'GET') {
          if (!this._requireSession(req, send)) return;
          const searchViewer = this._requestViewer(req);
          const q = url.searchParams.get('q') || url.searchParams.get('query') || '';
          const limit = parseInt(url.searchParams.get('limit'), 10) || appSearch.DEFAULT_LIMIT;
          const data = appSearch.searchCorpus(this._appSearchCorpus(searchViewer), q, { limit });
          return send(200, { type: 'AppSearch', data });
        }
        let collectionMatch;
        if ((collectionMatch = pathname.match(new RegExp(`^${base}/collections/([^/]+)/([^/]+)$`))) &&
            req.method === 'GET') {
          if (!this._requireSession(req, send)) return;
          const collectionViewer = this._requestViewer(req);
          const kind = decodeURIComponent(collectionMatch[1]);
          const recId = decodeURIComponent(collectionMatch[2]);
          const data = this._collectionRecord(kind, recId, collectionViewer);
          if (!data) return send(404, { error: 'Record not found' });
          return send(200, { type: 'CollectionRecord', data });
        }
        let fileMatch;
        if ((fileMatch = pathname.match(new RegExp(`^${base}/files/([^/]+)$`))) && req.method === 'GET') {
          if (!this._requireSession(req, send)) return;
          const data = this._fileRecord(decodeURIComponent(fileMatch[1]));
          if (!data) return send(404, { error: 'File not found' });
          return send(200, { type: 'FileRecord', data });
        }
        if ((fileMatch = pathname.match(new RegExp(`^${base}/files/([^/]+)/pin$`))) && req.method === 'POST') {
          if (!this._requireSession(req, send)) return;
          if (!this.registerStore) return send(503, { error: 'document store unavailable' });
          const d = await body();
          const pinned = !(d && (d.pinned === false || d.profilePinned === false));
          try {
            const document = localDocuments.setProfilePinned(
              this.registerStore,
              decodeURIComponent(fileMatch[1]),
              pinned,
              this._documentPublishOpts()
            );
            this._publishGroupDataShareNow();
            const data = this._fileRecord(document.id || fileMatch[1]);
            return send(200, { type: 'FilePin', data: data || { record: document, profilePinned: pinned } });
          } catch (e) {
            return send((e && e.status) || 400, { error: e.message || String(e) });
          }
        }
        if ((fileMatch = pathname.match(new RegExp(`^${base}/files/([^/]+)/cluster-sync$`))) && req.method === 'POST') {
          if (!this._requireSession(req, send)) return;
          if (!this.registerStore) return send(503, { error: 'document store unavailable' });
          const d = await body();
          const on = !(d && (d.clusterSync === false || d.sync === false || d.enabled === false));
          try {
            const document = this._setFileClusterSync(decodeURIComponent(fileMatch[1]), on);
            const data = this._fileRecord(document.id || fileMatch[1]);
            return send(200, {
              type: 'FileClusterSync',
              data: data || { record: document, clusterSync: on }
            });
          } catch (e) {
            return send((e && e.status) || 400, { error: e.message || String(e) });
          }
        }
        let discordGuildMatch;
        if ((discordGuildMatch = pathname.match(new RegExp(`^(?:${base})?/discord/guilds/([^/]+)/(channels|members)$`))) &&
            req.method === 'GET') {
          if (!this._requireSession(req, send)) return;
          const guildId = decodeURIComponent(discordGuildMatch[1]);
          const slice = discordGuildMatch[2];
          const catalog = await this._discordGuildCatalog({
            force: url.searchParams.get('refresh') === '1'
          });
          const guild = (catalog.guilds || []).find((g) => String(g.id) === String(guildId));
          if (!guild) {
            return send(404, {
              error: catalog.botReady ? 'Guild not found (bot may not be in that server)' : 'Discord bot not ready'
            });
          }
          if (slice === 'members') {
            return send(200, {
              type: 'DiscordGuildMembers',
              data: {
                guildId: guild.id,
                guildName: guild.name,
                members: guild.members || [],
                memberCount: guild.memberCount,
                botReady: catalog.botReady
              }
            });
          }
          return send(200, {
            type: 'DiscordGuildChannels',
            data: {
              guildId: guild.id,
              guildName: guild.name,
              channels: guild.channels || [],
              members: guild.members || [],
              selectedChannelId: catalog.selectedChannelId || null,
              botReady: catalog.botReady
            }
          });
        }
        let discordChannelMatch;
        if ((discordChannelMatch = pathname.match(new RegExp(`^(?:${base})?/discord/channels/([^/]+)$`))) &&
            req.method === 'GET') {
          if (!this._requireSession(req, send)) return;
          const channelId = decodeURIComponent(discordChannelMatch[1]);
          const insight = await this._discordChannelInsight(channelId, {
            force: url.searchParams.get('refresh') === '1',
            limit: parseInt(url.searchParams.get('limit'), 10) || discordGuildCatalog.DEFAULT_MESSAGE_LIMIT
          });
          if (insight.error === 'channel_id_required') {
            return send(400, { error: 'channel id required' });
          }
          if (insight.error && !insight.channel &&
              !(insight.messages && insight.messages.length)) {
            const notReady = !insight.botReady ||
              insight.error === 'bot_not_ready' ||
              insight.error === 'discord_client_unavailable';
            return send(notReady ? 503 : 404, {
              error: notReady
                ? 'Discord bot not ready'
                : 'Channel not found (bot may not see that channel)',
              data: insight
            });
          }
          return send(200, { type: 'DiscordChannelInsight', data: insight });
        }
        let discordTreeMatch;
        if ((discordTreeMatch = pathname.match(new RegExp(`^(?:${base})?/discord/coordination/([^/]+)$`))) &&
            req.method === 'GET') {
          if (!this._requireSession(req, send)) return;
          const requestId = decodeURIComponent(discordTreeMatch[1]);
          return send(200, {
            type: 'DiscordSequenceTree',
            data: this.discordSequenceTree(requestId)
          });
        }
        if ((pathname === `${base}/discord/coordination` || pathname === '/discord/coordination') &&
            req.method === 'GET') {
          if (!this._requireSession(req, send)) return;
          return send(200, {
            type: 'Collection',
            data: this._discordCoord.listRecent(Number(url.searchParams.get('limit')) || 100)
          });
        }
        if (pathname === `${base}/network/observe` || pathname === '/network/observe') {
          if (req.method === 'GET') {
            if (!this._requireSession(req, send)) return;
            const force = url.searchParams.get('refresh') === '1';
            const snap = await this._refreshHubObserve({ force });
            return send(200, { type: 'NetworkObserve', data: snap });
          }
        }
        let pMatch;
        if ((pMatch = pathname.match(new RegExp(`^(?:${base})?/peers/([^/]+)$`)))) {
          if (!this._requireSession(req, send)) return;
          const peer = this.peers.find((p) => p.id === pMatch[1]);
          if (!peer) return send(404, { error: 'Peer not found' });
          if (req.method === 'GET') {
            return send(200, { type: 'PeerDetail', data: this._peerDetail(peer.id) });
          }
          if (req.method === 'DELETE') {
            this.peers = this.peers.filter((p) => p.id !== peer.id);
            this._persistPeers();
            this._refreshFabric().catch((e) => this.emit('error', e));
            this.emit('peer:removed', peer);
            return send(200, { success: true });
          }
          if (req.method === 'POST') {
            const d = await body();
            if (d.enabled !== undefined) peer.enabled = !!d.enabled;
            if (d.label !== undefined) peer.label = d.label || null;
            if (d.shareLogs !== undefined) peer.shareLogs = !!d.shareLogs;
            this._persistPeers();
            this._refreshFabric().catch((e) => this.emit('error', e));
            return send(200, { type: 'Peer', data: this._peersWithStatus().find((p) => p.id === peer.id) || peer });
          }
        }

        // ---- Game.log visibility: info, raw browsing, deterministic re-parse ----
        if (req.method === 'GET' && pathname === `${base}/loginfo`) {
          if (!this._requireSession(req, send)) return;
          return send(200, { type: 'LogInfo', data: this._logInfo() });
        }
        // Browse the raw log by byte window (the file can be hundreds of MB —
        // never read it whole). Client pages with start offsets.
        if (req.method === 'GET' && pathname === `${base}/logslice`) {
          if (!this._requireSession(req, send)) return;
          const info = this._logInfo();
          if (!info.exists) return send(404, { error: 'Game.log not found — set the path in Settings or SC_LOGFILE' });
          const bytes = Math.min(Math.max(parseInt(url.searchParams.get('bytes'), 10) || 65536, 1024), 512 * 1024);
          let start = url.searchParams.get('start');
          start = start === null || start === 'end' ? Math.max(0, info.size - bytes) : Math.max(0, parseInt(start, 10) || 0);
          const end = Math.min(info.size, start + bytes);
          const text = await new Promise((resolve, reject) => {
            const chunks = [];
            fs.createReadStream(info.path, { start, end: Math.max(start, end - 1) })
              .on('data', (c) => chunks.push(c))
              .on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
              .on('error', reject);
          });
          return send(200, { type: 'LogSlice', data: { start, end, size: info.size, text } });
        }
        if (req.method === 'POST' && pathname === `${base}/reparse`) {
          if (!this._requireSession(req, send)) return;
          const job = await this._runReparse();
          return send(200, { type: 'Reparse', data: job });
        }
        if (req.method === 'GET' && pathname === `${base}/reparse`) {
          if (!this._requireSession(req, send)) return;
          return send(200, { type: 'Reparse', data: this._reparse });
        }

        // ---- Ship + location catalogs (public) + personal fleets ----
        // Personal fleets are operator-local (not the public ship catalog).
        if (pathname === `${base}/locations` || pathname === '/locations') {
          if (req.method === 'GET') {
            const q = url.searchParams.get('q') || url.searchParams.get('query') || '';
            const limit = Number(url.searchParams.get('limit')) || 40;
            const system = url.searchParams.get('system') || '';
            const hotspot = url.searchParams.get('hotspot') === '1' ||
              url.searchParams.get('hotspots') === '1';
            const locations = q || system || hotspot
              ? locationCatalog.searchLocations(q, {
                limit,
                system: system || undefined,
                hotspot: hotspot || undefined
              })
              : locationCatalog.listLocations().slice(0, Math.min(200, Math.max(1, limit)));
            return send(200, {
              type: 'LocationCatalog',
              data: locations,
              meta: locationCatalog.catalogStatus()
            });
          }
        }
        if (pathname === `${base}/locations/map` || pathname === '/locations/map') {
          if (req.method === 'GET') {
            const system = url.searchParams.get('system') || 'STANTON';
            const includeHotspots = url.searchParams.get('hotspots') !== '0';
            const destinations = url.searchParams.getAll('dest').map((raw) => {
              const parts = String(raw).split(':');
              const n = parts[0];
              const c = Number(parts[1]) || 1;
              return { n, c };
            }).filter((r) => r.n);
            const layout = starmapLayout.layoutSystem(system, {
              includeHotspots,
              destinations
            });
            layout.systems = (locationCatalog.listSystems() || []).map((s) => ({
              code: s.code || s.name,
              name: s.name || s.code
            }));
            return send(200, { type: 'StarMap', data: layout });
          }
        }
        if (pathname === `${base}/locations/reports`) {
          if (req.method === 'GET') {
            if (!this._requireSession(req, send)) return;
            const limit = parseInt(url.searchParams.get('limit'), 10) || 40;
            return send(200, {
              type: 'LocationReports',
              data: locationReports.listRecent(this.registerStore, { limit })
            });
          }
        }
        {
          const prefixes = [`${base}/locations/`];
          let locSlug = null;
          for (const prefix of prefixes) {
            if (pathname.indexOf(prefix) !== 0) continue;
            const rest = pathname.slice(prefix.length);
            if (!rest || rest.indexOf('/') !== -1) continue;
            if (rest === 'map' || rest === 'reports') continue;
            try { locSlug = decodeURIComponent(rest); } catch (_) { locSlug = rest; }
            break;
          }
          if (locSlug && req.method === 'GET') {
            if (!this._requireSession(req, send)) return;
            const data = this._locationRecord(locSlug);
            if (!data) return send(404, { error: 'Location not found' });
            return send(200, { type: 'LocationRecord', data });
          }
        }
        const fleetPath = pathname === `${base}/fleets` || pathname === '/fleets' ||
          pathname.startsWith(`${base}/fleets/`) || pathname.startsWith('/fleets/');
        if (fleetPath && !this._requireSession(req, send)) return;
        if (pathname === `${base}/ships` || pathname === '/ships') {
          if (req.method === 'GET') {
            const q = url.searchParams.get('q') || url.searchParams.get('query') || '';
            const limit = Number(url.searchParams.get('limit')) || 40;
            const ships = q
              ? shipCatalog.searchShips(q, { limit })
              : shipCatalog.listShips().slice(0, Math.min(200, Math.max(1, limit)));
            return send(200, {
              type: 'ShipCatalog',
              data: ships,
              meta: shipCatalog.catalogStatus()
            });
          }
        }
        if (pathname === `${base}/fleets` || pathname === '/fleets') {
          if (req.method === 'GET') {
            const scope = url.searchParams.get('scope') || 'all';
            return send(200, { type: 'Collection', data: this.listFleets({ scope }) });
          }
          if (req.method === 'POST') {
            const d = await body();
            try {
              const isCustom = d.custom === true ||
                (Array.isArray(d.ships) && d.json == null && !d.path && !d.sample);
              const fleet = isCustom ? this.createFleet(d) : this.importFleet(d);
              return send(200, { type: 'Fleet', data: starjumpFleet.summarizeFleet(fleet) });
            } catch (e) {
              return send(e.code === 'NOT_FOUND' ? 404 : 400, { error: e.message, code: e.code || null });
            }
          }
        }
        if (pathname === `${base}/fleets/samples` || pathname === '/fleets/samples') {
          if (req.method === 'GET') {
            return send(200, { type: 'Collection', data: this.listFleetSamples() });
          }
        }
        let fleetMatch;
        if ((fleetMatch = pathname.match(new RegExp(`^(?:${base})?/fleets/([^/]+)/ships$`)))) {
          const fleetId = decodeURIComponent(fleetMatch[1]);
          if (req.method === 'POST') {
            const d = await body();
            try {
              const fleet = this.updateFleetShips(fleetId, d || {});
              return send(200, { type: 'Fleet', data: starjumpFleet.summarizeFleet(fleet) });
            } catch (e) {
              const code = e.code === 'NOT_FOUND' ? 404 : (e.code === 'FORBIDDEN' ? 403 : 400);
              return send(code, { error: e.message, code: e.code || null });
            }
          }
          if (req.method === 'PUT') {
            const d = await body();
            try {
              const fleet = this.updateFleet(fleetId, { ships: (d && d.ships) || d });
              return send(200, { type: 'Fleet', data: starjumpFleet.summarizeFleet(fleet) });
            } catch (e) {
              const code = e.code === 'NOT_FOUND' ? 404 : (e.code === 'FORBIDDEN' ? 403 : 400);
              return send(code, { error: e.message, code: e.code || null });
            }
          }
        }
        if ((fleetMatch = pathname.match(new RegExp(`^(?:${base})?/fleets/([^/]+)/ships/([^/]+)$`))) &&
          req.method === 'DELETE') {
          try {
            const fleet = this.updateFleetShips(decodeURIComponent(fleetMatch[1]), {
              slug: decodeURIComponent(fleetMatch[2]),
              remove: true
            });
            return send(200, { type: 'Fleet', data: starjumpFleet.summarizeFleet(fleet) });
          } catch (e) {
            const code = e.code === 'NOT_FOUND' ? 404 : (e.code === 'FORBIDDEN' ? 403 : 400);
            return send(code, { error: e.message, code: e.code || null });
          }
        }
        if ((fleetMatch = pathname.match(new RegExp(`^(?:${base})?/fleets/([^/]+)$`)))) {
          const fleetId = decodeURIComponent(fleetMatch[1]);
          if (req.method === 'GET') {
            const full = url.searchParams.get('export') === '1';
            const fleet = this.getFleet(fleetId, { includeExport: full });
            if (!fleet) return send(404, { error: 'Fleet not found' });
            return send(200, { type: 'Fleet', data: fleet });
          }
          if (req.method === 'PATCH' || req.method === 'PUT') {
            const d = await body();
            try {
              const fleet = this.updateFleet(fleetId, d);
              return send(200, { type: 'Fleet', data: starjumpFleet.summarizeFleet(fleet) });
            } catch (e) {
              return send(e.code === 'NOT_FOUND' ? 404 : 400, { error: e.message, code: e.code || null });
            }
          }
          if (req.method === 'DELETE') {
            const ok = this.deleteFleet(fleetId);
            if (!ok) return send(404, { error: 'Fleet not found' });
            return send(200, { success: true });
          }
        }
        if ((fleetMatch = pathname.match(new RegExp(`^(?:${base})?/fleets/([^/]+)/share$`))) && req.method === 'POST') {
          const d = await body();
          try {
            const result = await this.shareFleet(decodeURIComponent(fleetMatch[1]), d || {});
            return send(200, { type: 'FleetShare', data: result });
          } catch (e) {
            const code = e.code === 'NOT_FOUND' ? 404 : (e.code === 'FORBIDDEN' ? 403 : 400);
            return send(code, { error: e.message, code: e.code || null });
          }
        }

        // ---- Snapshot library (periodic screen captures; LOCAL relay only) ----
        const sm = this.snapshotManager;
        if (sm && pathname === `${base}/snapshots`) {
          if (req.method === 'GET') {
            if (!this._requireSession(req, send)) return;
            const limit = parseInt(url.searchParams.get('limit'), 10) || 200;
            const before = url.searchParams.get('before') || null;
            return send(200, { type: 'Collection', data: sm.list({ limit, before }), stats: sm.stats() });
          }
          if (req.method === 'DELETE') {
            if (!this._requireSession(req, send)) return;
            const removed = sm.purgeAll();
            return send(200, { success: true, removed });
          }
        }
        let snapMatch;
        if (sm && (snapMatch = pathname.match(new RegExp(`^${base}/snapshots/([^/]+)/image$`))) && req.method === 'GET') {
          if (!this._requireSession(req, send)) return;
          const file = sm.imagePath(snapMatch[1]);
          if (!file) return send(404, { error: 'Snapshot not found' });
          res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=31536000, immutable' });
          return fs.createReadStream(file).pipe(res);
        }
      }

      // Schnorr login: exchange a signed envelope for a Bearer session token.
      if (req.method === 'POST' && pathname === `${base}/auth`) {
        const result = this._login(await body());
        if (result.error) return send(result.code || 401, { error: result.error });
        return send(200, { type: 'Session', data: result });
      }
      if (req.method === 'DELETE' && pathname === `${base}/auth`) {
        const revoked = this._revokeBearerSession(req);
        return send(200, { type: 'SessionRevoke', data: { revoked } });
      }

      if (pathname === `${base}/identity/cluster` || pathname === '/identity/cluster') {
        if (!this._requireSession(req, send)) return;
        // Prefer explicit pubkey query; never fall back to unlocked operator when
        // remote auth is on (use session viewer instead).
        const pk = url.searchParams.get('pubkey') || this._requestViewer(req);
        const snap = this.identityCluster
          ? this.identityCluster.snapshot(pk)
          : { canonical: pk, members: pk ? [pk] : [], edges: [] };
        const pending = clusterDevices.pendingFromClusterInstance(this.identityCluster, pk);
        return send(200, {
          type: 'IdentityCluster',
          data: Object.assign({}, snap, { pending })
        });
      }
      if (pathname === `${base}/identity/cluster/sync` || pathname === '/identity/cluster/sync') {
        if (!this._requireSession(req, send)) return;
        if (req.method === 'GET') {
          return send(200, this._clusterSyncSnapshot());
        }
        if (req.method === 'POST') {
          const d = await body();
          if (d && Array.isArray(d.dial) && d.dial.length) {
            const queued = this._dialClusterCandidates(d.dial, d.pubkey || null);
            const snap = this._clusterSyncSnapshot();
            snap.data.queued = queued;
            return send(200, snap);
          }
          if (d && (d.mesh === true || d.action === 'mesh')) {
            await this._clusterMeshTick();
            return send(200, this._clusterSyncSnapshot());
          }
          if (d && (d.publish === true || d.action === 'publish' || d.refresh === true)) {
            this._scheduleAccountDataReplay();
            this._dialStoredClusterPeers();
            this._clusterMeshTick();
            return send(200, this._clusterSyncSnapshot());
          }
          if (d && (d.crossSign === true || d.action === 'cross-sign')) {
            await this._nudgePendingCrossSigns();
            this._scheduleAccountDataReplay();
            return send(200, this._clusterSyncSnapshot());
          }
          const applied = this._ingestClusterSyncCollection(d, this._requestViewer(req));
          if (!applied) return send(400, { error: 'invalid cluster sync collection' });
          return send(200, { type: 'ClusterSync', data: applied });
        }
        return send(405, { error: 'GET or POST' });
      }
      if ((pathname === `${base}/identity/session` || pathname === '/identity/session') &&
          req.method === 'POST') {
        if (!this._isAndroidMode()) return send(404, { error: 'not an Android node' });
        const { isLoopbackRequest } = require('../functions/isLoopbackRequest');
        if (!isLoopbackRequest(req)) return send(403, { error: 'local node only' });
        const d = await body();
        if (d && d.lock) {
          this.setIdentity(null);
          return send(200, { ok: true, locked: true });
        }
        try {
          const ident = identityLib().restoreIdentity({
            xprv: d && d.xprv,
            mnemonic: (d && d.mnemonic) || undefined
          });
          this.setIdentity(ident);
          return send(200, { ok: true, pubkey: ident.pubkey });
        } catch (e) {
          return send(400, { error: e.message || String(e) });
        }
      }
      if (pathname === `${base}/identity/cross-sign` || pathname === '/identity/cross-sign') {
        if (req.method === 'POST') {
          const d = await body();
          const IdentityCluster = require('../functions/identityCluster');
          const kind = (d && (d.type || d['@type'])) || IdentityCluster.SIGN_TYPE;
          if (d && d.signature && d.identity) {
            try {
              const rec = this._ingestIdentityCrossSign(d, d.pubkeyHex || d.localPubkey);
              if (!rec) return send(400, { error: 'invalid IdentityCrossSign' });
              this._gossipIdentityCrossSign(d);
              return send(200, { type: kind, data: rec });
            } catch (e) {
              return send(400, { error: (e && e.message) || 'invalid IdentityCrossSign' });
            }
          }
          if (!this._identity) return send(401, { error: 'Unlock your identity' });
          if (this._enforceRemoteAuth(req) && !this._authPubkey(req)) {
            return send(401, { error: 'Authentication required (POST …/auth with a signed login envelope)' });
          }
          try {
            const obj = await this.publishLocalIdentityCrossSign({
              peerPubkey: d.peerPubkey,
              nonce: d.nonce
            }, kind);
            return send(200, { type: kind, data: obj });
          } catch (e) {
            return send(400, { error: e.message || String(e) });
          }
        }
      }

      // ---- Groups (k-of-n Schnorr multisig units / Federation contracts) ----
      const Group = require('../types/Group');
      const gm = this.groupManager;
      const viewer = this._authPubkey(req);
      const serverMode = this.settings.mode === 'server';
      const remoteAuth = this._enforceRemoteAuth(req);
      let gmatch = null;
      // Hosted mode and LAN shared-mode (non-loopback) require a session.
      const requireAuth = () => this._requireSession(req, send);
      const sendStoreErr = (e) => {
        const code = e.code === 'NOT_FOUND' ? 404
          : (e.code === 'FORBIDDEN' ? 403
            : (e.code === 'UNAVAILABLE' ? 503 : 400));
        return send(code, { error: e.message || String(e) });
      };

      // ---- Local tags (operator-local Discord / Fabric identity groups) ----
      if (pathname === `${base}/local-groups`) {
        if (req.method === 'GET') {
          if (!requireAuth()) return;
          return send(200, { type: 'Collection', data: this._listLocalGroups() });
        }
        if (req.method === 'POST') {
          if (!requireAuth()) return;
          try {
            const d = await body();
            const actor = this._operatorActor(req, d.createdBy);
            const group = this._createLocalGroup(d, actor);
            this._scheduleAccountDataReplay();
            return send(200, { type: 'LocalGroup', data: group });
          } catch (e) { return sendStoreErr(e); }
        }
      }
      let lgMatch = null;
      if ((lgMatch = pathname.match(new RegExp(`^${base}/local-groups/([^/]+)/members/(.+)$`))) &&
          req.method === 'DELETE') {
        if (!requireAuth()) return;
        try {
          const actor = this._operatorActor(req);
          const memberActor = decodeURIComponent(lgMatch[2]);
          const group = this._removeLocalGroupMember(lgMatch[1], memberActor, actor);
          this._scheduleAccountDataReplay();
          return send(200, { type: 'LocalGroup', data: group });
        } catch (e) { return sendStoreErr(e); }
      }
      if ((lgMatch = pathname.match(new RegExp(`^${base}/local-groups/([^/]+)/members$`))) &&
          req.method === 'POST') {
        if (!requireAuth()) return;
        try {
          const d = await body();
          const actor = this._operatorActor(req);
          const group = this._addLocalGroupMember(lgMatch[1], d, actor);
          this._scheduleAccountDataReplay();
          return send(200, { type: 'LocalGroup', data: group });
        } catch (e) { return sendStoreErr(e); }
      }
      if ((lgMatch = pathname.match(new RegExp(`^${base}/local-groups/([^/]+)$`)))) {
        if (req.method === 'GET') {
          if (!requireAuth()) return;
          const group = localGroups.getGroup(this.registerStore, lgMatch[1]);
          if (!group) return send(404, { error: 'Local group not found' });
          return send(200, { type: 'LocalGroup', data: group });
        }
        if (req.method === 'PUT') {
          if (!requireAuth()) return;
          try {
            const d = await body();
            const actor = this._operatorActor(req);
            const group = this._renameLocalGroup(lgMatch[1], d.name, actor);
            this._scheduleAccountDataReplay();
            return send(200, { type: 'LocalGroup', data: group });
          } catch (e) { return sendStoreErr(e); }
        }
        if (req.method === 'DELETE') {
          if (!requireAuth()) return;
          try {
            const actor = this._operatorActor(req);
            const data = this._deleteLocalGroup(lgMatch[1], actor);
            this._scheduleAccountDataReplay();
            return send(200, { type: 'LocalGroup', data });
          } catch (e) { return sendStoreErr(e); }
        }
      }

      // ---- Identity notes (private; share to a Federation group or peer) ----
      if (pathname === `${base}/notes`) {
        if (req.method === 'GET') {
          if (!requireAuth()) return;
          const subject = url.searchParams.get('subject') || null;
          const mine = url.searchParams.get('mine') === '1' ||
            url.searchParams.get('mine') === 'true';
          const noteViewer = this._requestViewer(req);
          const author = url.searchParams.get('author') ||
            (mine ? (noteViewer || 'local') : null);
          const data = this._listIdentityNotes({
            subject: mine ? null : subject,
            author,
            includeLocal: mine && !remoteAuth,
            viewer: noteViewer,
            enforcePrivacy: remoteAuth,
            groupIds: remoteAuth ? this._viewerGroupIds(noteViewer) : []
          });
          return send(200, { type: 'Collection', data });
        }
        if (req.method === 'POST') {
          if (!requireAuth()) return;
          try {
            const d = await body();
            const actor = this._operatorActor(req, d.author);
            const note = this._createIdentityNote(d, actor);
            this._scheduleAccountDataReplay();
            return send(200, { type: 'IdentityNote', data: note });
          } catch (e) { return sendStoreErr(e); }
        }
      }
      let noteMatch = null;
      if ((noteMatch = pathname.match(new RegExp(`^${base}/notes/([^/]+)/share$`))) &&
          req.method === 'POST') {
        if (!requireAuth()) return;
        try {
          const d = await body();
          const actor = this._operatorActor(req);
          const data = await this._shareIdentityNote(noteMatch[1], d, actor);
          return send(200, { type: 'NoteShare', data });
        } catch (e) { return sendStoreErr(e); }
      }
      if ((noteMatch = pathname.match(new RegExp(`^${base}/notes/([^/]+)/pin$`))) &&
          req.method === 'POST') {
        if (!requireAuth()) return;
        try {
          const d = await body();
          const actor = this._operatorActor(req);
          const pinned = !(d && (d.pinned === false || d.profilePinned === false));
          const data = this._pinIdentityNote(noteMatch[1], pinned, actor);
          return send(200, { type: 'NotePin', data });
        } catch (e) { return sendStoreErr(e); }
      }
      if ((noteMatch = pathname.match(new RegExp(`^${base}/notes/([^/]+)$`)))) {
        if (req.method === 'GET') {
          if (!requireAuth()) return;
          const note = identityNotes.getNote(this.registerStore, noteMatch[1]);
          if (!note) return send(404, { error: 'Note not found' });
          if (remoteAuth) {
            const noteViewer = this._requestViewer(req);
            if (!identityNotes.noteVisibleTo(note, noteViewer, this._viewerGroupIds(noteViewer))) {
              return send(404, { error: 'Note not found' });
            }
          }
          return send(200, { type: 'IdentityNote', data: note });
        }
        if (req.method === 'PUT') {
          if (!requireAuth()) return;
          try {
            const d = await body();
            const actor = this._operatorActor(req);
            const note = this._updateIdentityNote(noteMatch[1], d, actor);
            this._scheduleAccountDataReplay();
            return send(200, { type: 'IdentityNote', data: note });
          } catch (e) { return sendStoreErr(e); }
        }
      }

      // ---- Chat (Hub ChatMessage types: global + group:<id> channels) ----
      const cm = this.chatManager;
      if (cm && req.method === 'GET' && pathname === `${base}/chat/channels`) {
        if (!requireAuth()) return;
        return send(200, { type: 'Collection', data: cm.channelsFor(viewer, { enforceMembership: serverMode }) });
      }
      if (cm && pathname === `${base}/chat/messages`) {
        if (req.method === 'GET') {
          // Shared-LAN / hosted: do not dump chat history without a session.
          // Loopback desktop keeps the unlocked path via _requireSession.
          if (!requireAuth()) return;
          const channel = url.searchParams.get('channel') || 'global';
          if (!cm.canAccess(channel, viewer, { enforceMembership: serverMode })) {
            return send(403, { error: 'forbidden: not a member of this channel' });
          }
          const since = url.searchParams.get('since') || null;
          const limit = parseInt(url.searchParams.get('limit'), 10) || 200;
          const chatDelivery = require('../functions/chatDelivery');
          const ChatManager = require('../services/ChatManager');
          const { overlayPinnedMessages } = require('../functions/chatMessagePins');
          let listed = cm.list(channel, { since, limit });
          const pinGroupId = ChatManager.groupIdOf(channel);
          if (pinGroupId && this.groupManager) {
            const pinGroup = this.groupManager.getGroup(pinGroupId);
            listed = overlayPinnedMessages(listed, pinGroup && pinGroup.pinnedMessages);
          }
          let rows = chatDelivery.enrichChatMessages(
            this.registerStore,
            listed,
            viewer || (this._identity && this._identity.pubkey) || null
          );
          if (discordGuildCatalog.parseDiscordChatChannel(channel)) {
            rows = discordIdentityLink.applyLinksToMessages(rows, this._discordIdentityLinks);
          }
          return send(200, { type: 'Collection', data: rows });
        }
        if (req.method === 'POST') {
          // Hosted chat authenticates via the Schnorr envelope (message of record).
          // Local / shared-mode still needs a session so LAN clients cannot speak
          // as the unlocked identity.
          if (!serverMode && !requireAuth()) return;
          const d = await body();
          try {
            let record;
            if (serverMode) {
              // Hosted: a Schnorr-signed envelope is the message of record —
              // {Object}.
              const check = this._checkEnvelope(d);
              if (!check.ok) return send(check.code, { error: check.error });
              const p = d.payload || {};
              if (discordGuildCatalog.isDiscordChatKey(p.channel || '')) {
                return send(400, { error: 'Discord bridge posts are local-operator only' });
              }
              if (!cm.canAccess(p.channel || 'global', d.pubkey, { enforceMembership: true })) {
                return send(403, { error: 'forbidden: not a member of this channel' });
              }
              record = cm.post({
                channel: p.channel,
                body: p.body,
                ts: p.ts,
                handle: p.handle,
                author: d.pubkey,
                attachment: p.attachment || null
              });
            } else {
              // Local relay: author is the unlocked identity (or session pubkey).
              // Shared-mode LAN clients never inherit the unlocked key.
              const author = remoteAuth
                ? viewer
                : (viewer || (this._identity && this._identity.pubkey) || d.author || null);
              if (!author) return send(401, { error: 'Unlock your identity to chat' });
              if (!cm.canAccess(d.channel || 'global', author, { enforceMembership: remoteAuth })) {
                return send(403, { error: 'forbidden: not a member of this channel' });
              }
              const chatAttachment = require('../functions/chatAttachment');
              let attachment = d.attachment || null;
              if (!attachment && d.file && d.file.contentBase64) {
                attachment = this._createLocalChatAttachment(d.file, d.purchasePriceSats, author);
              }
              const caption = String(d.body || '').trim() ||
                (attachment ? ('📎 ' + attachment.name) : '');
              const discordText = chatAttachment.discordCaptionForAttach(caption, attachment);
              const handle = d.handle || this._nickname || this._sessionHandle || null;
              const bridge = chatChannelList.bridgeForChannel(
                d.channel,
                this.groupManager ? this.groupManager.groups : []
              );
              const discordDmUserId = discordGuildCatalog.parseDiscordDmChannel(d.channel);
              if (discordDmUserId) {
                if (!this._discordBotReady || !this.discordBot) {
                  return send(503, { error: 'Discord bot not ready' });
                }
                if (!discordText) return send(400, { error: 'message body required' });
                const botId = this._localDiscordBotUserId();
                try {
                  if (botId && discordDmUserId === botId) {
                    record = await this._postLocalBotDm({
                      text: discordText,
                      author,
                      handle,
                      attachment
                    });
                  } else {
                    const dm = await this._openDiscordUserDm(discordDmUserId);
                    let sent;
                    try {
                      sent = await dm.send({
                        content: discordIdentityLink.formatOutboundDiscordContent(handle, discordText)
                      });
                    } catch (discordErr) {
                      const mapped = discordGuildCatalog.formatDiscordBridgeError(discordErr);
                      return send(mapped.status, { error: mapped.error });
                    }
                    record = cm.post({
                      channel: d.channel,
                      body: caption,
                      handle,
                      author,
                      kind: 'discord-dm',
                      discordMessageId: sent && sent.id ? String(sent.id) : null,
                      discordUserId: discordDmUserId,
                      discordChannelId: dm && dm.id ? String(dm.id) : null,
                      source: 'local',
                      attachment
                    });
                  }
                } catch (e) {
                  const mapped = discordGuildCatalog.formatDiscordBridgeError(e);
                  if (/Missing Permissions|Missing Access|unknown channel/i.test(mapped.error)) {
                    return send(mapped.status, { error: mapped.error });
                  }
                  return send(400, { error: e.message || String(e) });
                }
                return send(200, { type: 'ChatMessage', data: record });
              }
              const discordChannelId = discordGuildCatalog.parseDiscordChatChannel(d.channel);
              if (discordChannelId) {
                if (!discordText) return send(400, { error: 'message body required' });
                let sent;
                try {
                  sent = await this._postDiscordBridgeText(discordChannelId, handle, discordText);
                } catch (discordErr) {
                  return send(discordErr.status || 400, { error: discordErr.message || String(discordErr) });
                }
                if (bridge.bridged && bridge.fabricKey) {
                  record = cm.post({
                    channel: bridge.fabricKey,
                    body: caption,
                    handle,
                    author,
                    attachment,
                    discordMessageId: sent && sent.id ? String(sent.id) : null,
                    source: 'local'
                  });
                  const { pubkeysMatch } = identityLib();
                  if (this._identity && pubkeysMatch(this._identity.pubkey, record.author)) {
                    this._publishChat(record).catch((e) => this.emit('error', e));
                  }
                } else {
                  record = cm.post({
                    channel: d.channel,
                    body: caption,
                    handle,
                    author,
                    kind: 'discord',
                    discordMessageId: sent && sent.id ? String(sent.id) : null,
                    source: 'local',
                    attachment
                  });
                }
                return send(200, { type: 'ChatMessage', data: record });
              }
              record = cm.post({
                channel: d.channel,
                body: caption,
                handle,
                author,
                attachment
              });
              const { pubkeysMatch } = identityLib();
              if (this._identity && pubkeysMatch(this._identity.pubkey, record.author)) {
                this._publishChat(record).catch((e) => this.emit('error', e));
              }
              if (bridge.bridged && discordText) {
                for (const key of bridge.discordKeys) {
                  const id = discordGuildCatalog.parseDiscordChatChannel(key);
                  if (!id) continue;
                  this._postDiscordBridgeText(id, handle, discordText).catch((e) => this.emit('error', e));
                }
              }
            }
            // Network-wide `/lookup` race (Request → Claim → Response).
            if (record && chatLookup.parseLookupCommand(record.body) &&
                !discordGuildCatalog.parseDiscordChatChannel(record.channel)) {
              this._startLookupFromChat(record).catch((e) => this.emit('error', e));
            }
            return send(200, { type: 'ChatMessage', data: record });
          } catch (e) {
            const status = (e && e.status) || (/forbidden/i.test(e.message) ? 403 : 400);
            return send(status, { error: e.message });
          }
        }
      }
      const pinMatch = pathname.match(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/chat/messages/([^/]+)/pin$`));
      if (cm && pinMatch && req.method === 'POST') {
        if (!requireAuth()) return;
        const author = viewer || (this._identity && this._identity.pubkey) || null;
        if (!author) return send(401, { error: 'Unlock your identity to pin messages' });
        const ChatManager = require('../services/ChatManager');
        const {
          overlayPinnedMessages,
          parsePinRequest,
          togglePinnedMessageId
        } = require('../functions/chatMessagePins');
        try {
          const id = decodeURIComponent(pinMatch[1]);
          const rec = cm.get(id);
          if (!rec) return send(404, { error: 'message not found' });
          if (!cm.canAccess(rec.channel, author, { enforceMembership: remoteAuth })) {
            return send(403, { error: 'forbidden: not a member of this channel' });
          }
          const d = await body();
          const want = parsePinRequest(d, rec.pinned === true);
          const groupId = ChatManager.groupIdOf(rec.channel);
          if (groupId && this.groupManager && this.groupManager.isMember(groupId, author)) {
            const g = this.groupManager.getGroup(groupId);
            const nextIds = togglePinnedMessageId(g && g.pinnedMessages, id, want);
            await this.groupManager.updateGroup(groupId, { pinnedMessages: nextIds }, author);
          }
          let updated = cm.setPinned(id, { pinned: want, actor: author });
          if (groupId && this.groupManager) {
            const g2 = this.groupManager.getGroup(groupId);
            updated = overlayPinnedMessages([updated], g2 && g2.pinnedMessages)[0] || updated;
          }
          return send(200, { type: 'ChatMessage', data: updated });
        } catch (e) {
          const code = e.code === 'FORBIDDEN' ? 403
            : (e.code === 'NOT_FOUND' ? 404 : 400);
          return send(code, { error: e.message || String(e) });
        }
      }
      const receiptMatch = pathname.match(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/chat/messages/([^/]+)/receipt$`));
      if (cm && receiptMatch && req.method === 'POST') {
        if (!requireAuth()) return;
        try {
          const data = this._markChatMessageReceipt(decodeURIComponent(receiptMatch[1]));
          return send(200, { type: 'ChatMessageReceipt', data });
        } catch (e) {
          const code = e.code === 'UNAUTHORIZED' ? 401
            : (e.code === 'NOT_FOUND' ? 404
              : (e.code === 'UNAVAILABLE' ? 503 : 400));
          return send(code, { error: e.message || String(e) });
        }
      }
      // Unified delivery sync (wireHash-first; Chat route above is an alias).
      const deliveryGet = pathname.match(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/delivery/([^/]+)$`));
      if (deliveryGet && req.method === 'GET') {
        const chatDelivery = require('../functions/chatDelivery');
        const hash = decodeURIComponent(deliveryGet[1]).toLowerCase();
        const record = this.registerStore && this.registerStore.get('contractmessagecommits', hash);
        const me = viewer || (this._identity && this._identity.pubkey) || null;
        return send(200, {
          type: 'DeliverySync',
          data: {
            wireHash: hash,
            delivery: chatDelivery.deliverySummary(record, me)
          }
        });
      }
      const deliveryReceipt = pathname.match(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/delivery/([^/]+)/receipt$`));
      if (deliveryReceipt && req.method === 'POST') {
        if (!requireAuth()) return;
        try {
          const d = await body();
          const data = this._markDeliveryReceipt(decodeURIComponent(deliveryReceipt[1]), {
            contractId: d.contractId || null,
            chatMessageId: d.chatMessageId || null
          });
          return send(200, { type: 'DeliveryReceipt', data });
        } catch (e) {
          const code = e.code === 'UNAUTHORIZED' ? 401
            : (e.code === 'NOT_FOUND' ? 404
              : (e.code === 'UNAVAILABLE' ? 503 : 400));
          return send(code, { error: e.message || String(e) });
        }
      }
      if (pathname === `${base}/groups`) {
        if (!gm) return send(503, { error: 'Group system not available' });
        if (req.method === 'GET') {
          // Members see their groups; public groups are included for discovery.
          let data;
          if (viewer) {
            const mine = gm.groupsFor(viewer);
            const publicOnes = gm.groups.filter((g) => g.visibility === 'public' && !mine.some((m) => m.id === g.id));
            data = mine.concat(publicOnes.map((g) => new Group(g).toPublicJSON()));
          } else if (serverMode) {
            data = gm.groups.filter((g) => g.visibility === 'public').map((g) => new Group(g).toPublicJSON());
          } else {
            data = gm.groups;
          }
          return send(200, { type: 'Collection', data });
        }
        if (req.method === 'POST') {
          if (!requireAuth()) return;
          const d = await body();
          const creator = remoteAuth ? viewer : (viewer || d.creator); // local relay may specify creator explicitly
          try {
            const group = await gm.createGroup(d, creator);
            // group:created listener publishes CONTRACT_PUBLISH when Fabric is up.
            this._publishGroupContractFor(group).catch((e) => this.emit('error', e));
            this._scheduleAccountDataReplay();
            return send(200, { type: 'Group', data: group });
          } catch (e) { return send(e.code === 'FORBIDDEN' ? 403 : 400, { error: e.message }); }
        }
      }
      // Opaque Fabric GroupOffer / invite share (copy-paste fabric:<hex>).
      if ((gmatch = pathname.match(new RegExp(`^${base}/groups/([^/]+)/share$`))) && (req.method === 'GET' || req.method === 'POST')) {
        if (!gm) return send(503, { error: 'Group system not available' });
        if (!requireAuth()) return;
        const group = gm.findGroup(gmatch[1]);
        if (!group) return send(404, { error: 'Group not found' });
        const actor = viewer || (this._identity && this._identity.pubkey);
        if (!actor || !group.includes(actor)) return send(403, { error: 'forbidden: members only' });
        const d = req.method === 'POST' ? await body() : {};
        try {
          const data = await this.createGroupShare(group.id, actor, { note: d.note, relay: d.relay !== false });
          return send(200, { type: 'GroupShare', data });
        } catch (e) {
          return send(e.code === 'FORBIDDEN' ? 403 : 400, { error: e.message });
        }
      }
      if (pathname === `${base}/groups/share/ingest` && req.method === 'POST') {
        if (!gm) return send(503, { error: 'Group system not available' });
        if (!requireAuth()) return;
        const d = await body();
        try {
          const data = await this.ingestOpaqueGroupShare(
            d.protocolUrl || d.messageHex || d.messageBase64 || d.hex || d.base64 || d.message || ''
          );
          return send(200, { type: 'GroupShareIngest', data });
        } catch (e) {
          return send(e.code === 'FORBIDDEN' ? 403 : 400, { error: e.message });
        }
      }
      // FederationContractInvite — Hub-shaped join / co-signer invite under a group contract.
      if ((gmatch = pathname.match(new RegExp(`^${base}/groups/([^/]+)/invites$`))) && req.method === 'POST') {
        if (!gm) return send(503, { error: 'Group system not available' });
        if (!requireAuth()) return;
        const group = gm.findGroup(gmatch[1]);
        if (!group) return send(404, { error: 'Group not found' });
        const actor = viewer || (this._identity && this._identity.pubkey);
        if (!actor || !group.includes(actor)) return send(403, { error: 'forbidden: members only' });
        const d = await body();
        try {
          const data = await this.inviteToGroupFederation(group.id, actor, {
            note: d.note,
            inviteId: d.inviteId,
            inviteePubkey: d.inviteePubkey || d.invitee || d.pubkey || null,
            role: d.role || 'signer',
            relay: d.relay !== false
          });
          return send(200, { type: 'FederationContractInvite', data });
        } catch (e) {
          return send(e.code === 'FORBIDDEN' ? 403 : 400, { error: e.message });
        }
      }
      if ((gmatch = pathname.match(new RegExp(`^${base}/groups/([^/]+)/invites/([^/]+)/(accept|reject)$`))) && req.method === 'POST') {
        if (!gm) return send(503, { error: 'Group system not available' });
        if (!requireAuth()) return;
        const actor = viewer || (this._identity && this._identity.pubkey);
        if (!actor) return send(401, { error: 'Authentication required' });
        try {
          const data = await this.respondToGroupFederationInvite(gmatch[1], gmatch[2], actor, gmatch[3] === 'accept');
          return send(200, { type: 'FederationContractInviteResponse', data });
        } catch (e) {
          return send(e.code === 'FORBIDDEN' ? 403 : /not found/i.test(e.message) ? 404 : 400, { error: e.message });
        }
      }
      if ((gmatch = pathname.match(new RegExp(`^${base}/groups/([^/]+)$`)))) {
        if (!gm) return send(503, { error: 'Group system not available' });
        const group = gm.findGroup(gmatch[1]);
        if (!group) return send(404, { error: 'Group not found' });
        if (req.method === 'GET') {
          const view = gm.viewFor(group, viewer);
          if (!view) return send(403, { error: 'forbidden: this group is private' });
          return send(200, { type: 'Group', data: view });
        }
        if (req.method === 'PUT') {
          if (!requireAuth()) return;
          const d = await body();
          const actor = viewer || d.actor;
          try { return send(200, { type: 'Group', data: await gm.updateGroup(group.id, d, actor) }); }
          catch (e) { return send(e.code === 'FORBIDDEN' ? 403 : /not found/i.test(e.message) ? 404 : 400, { error: e.message }); }
        }
      }
      if ((gmatch = pathname.match(new RegExp(`^${base}/groups/([^/]+)/fleets$`))) && req.method === 'GET') {
        if (!gm) return send(503, { error: 'Group system not available' });
        const group = gm.findGroup(gmatch[1]);
        if (!group) return send(404, { error: 'Group not found' });
        const view = gm.viewFor(group, viewer);
        if (!view) return send(403, { error: 'forbidden: this group is private' });
        const me = viewer || (this._identity && this._identity.pubkey) || null;
        const isMember = !!(me && Array.isArray(group.members) && group.members.includes(me));
        if (!isMember && group.visibility !== 'public') {
          return send(403, { error: 'forbidden: members only' });
        }
        try {
          const fleets = this.listGroupFleets(group.id);
          return send(200, { type: 'GroupFleets', data: fleets });
        } catch (e) {
          return send(400, { error: e.message });
        }
      }
      if ((gmatch = pathname.match(new RegExp(`^${base}/groups/([^/]+)/statechain$`))) && req.method === 'GET') {
        if (!gm) return send(503, { error: 'Group system not available' });
        const group = gm.findGroup(gmatch[1]);
        if (!group) return send(404, { error: 'Group not found' });
        const view = gm.viewFor(group, viewer);
        if (!view) return send(403, { error: 'forbidden: this group is private' });
        const me = viewer || (this._identity && this._identity.pubkey) || null;
        const isMember = !!(me && Array.isArray(group.members) && group.members.includes(me));
        if (!isMember && group.visibility !== 'public') {
          return send(403, { error: 'forbidden: members only' });
        }
        if (!group.contractId) {
          return send(200, {
            type: 'GroupStatechain',
            data: {
              groupId: group.id,
              contractId: null,
              clock: 0,
              stateDigest: null,
              content: null,
              journal: { entries: [] },
              activityTree: null,
              fleets: {}
            }
          });
        }
        try {
          const groupStatechain = require('../functions/groupStatechain');
          const doc = groupStatechain.loadDoc(this.registerStore, group.contractId);
          const digest = groupStatechain.stateDigestOfContent(doc.content || {});
          const journalLimit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 100));
          const entries = (doc.journal.entries || []).slice(-journalLimit).reverse();
          const fleets = (doc.content && doc.content.fleets) || {};
          return send(200, {
            type: 'GroupStatechain',
            data: {
              groupId: group.id,
              contractId: group.contractId,
              clock: doc.clock,
              version: doc.version,
              stateDigest: digest,
              content: isMember ? doc.content : {
                groupId: doc.content && doc.content.groupId,
                members: doc.content && doc.content.members,
                activityTree: doc.content && doc.content.activityTree,
                fleets
              },
              journal: { entries: isMember ? entries : entries.map((e) => ({
                id: e.id,
                type: e.type,
                clock: e.clock,
                acceptedAt: e.acceptedAt
              })) },
              activityTree: (doc.content && doc.content.activityTree) || null,
              fleets
            }
          });
        } catch (e) {
          return send(400, { error: e.message });
        }
      }
      if ((gmatch = pathname.match(new RegExp(`^${base}/groups/([^/]+)/members$`))) && req.method === 'POST') {
        if (!gm) return send(503, { error: 'Group system not available' });
        if (!requireAuth()) return;
        const d = await body();
        const actor = viewer || d.actor;
        const group = gm.findGroup(gmatch[1]);
        if (!group) return send(404, { error: 'Group not found' });
        try {
          const result = d.remove
            ? gm.proposeChange({
              groupId: group.id,
              action: 'member.remove',
              actor,
              member: d.pubkey
            })
            : gm.proposeChange({
              groupId: group.id,
              action: 'member.add',
              actor,
              member: d.pubkey,
              role: d.role
            });
          return send(result.adopted || !result.proposal ? 200 : 202, {
            type: result.adopted ? 'Group' : 'GroupChangeProposal',
            data: result.adopted ? result.group : result.proposal,
            group: result.group,
            adopted: !!result.adopted
          });
        } catch (e) {
          return send(e.code === 'FORBIDDEN' ? 403 : /not found/i.test(e.message) ? 404 : 400, { error: e.message });
        }
      }
      if ((gmatch = pathname.match(new RegExp(`^${base}/groups/([^/]+)/proposals$`)))) {
        if (!gm) return send(503, { error: 'Group system not available' });
        const group = gm.findGroup(gmatch[1]);
        if (!group) return send(404, { error: 'Group not found' });
        if (!viewer || !gm.isMember(group.id, viewer)) {
          return send(403, { error: 'forbidden: members only' });
        }
        if (req.method === 'GET') {
          const includeAdopted = /^(1|true|yes)$/i.test(String(url.searchParams.get('includeAdopted') || ''));
          return send(200, {
            type: 'Collection',
            data: gm.listProposals(group.id, { includeAdopted })
          });
        }
      }
      if ((gmatch = pathname.match(new RegExp(`^${base}/groups/([^/]+)/proposals/([^/]+)/votes$`))) &&
          req.method === 'POST') {
        if (!gm) return send(503, { error: 'Group system not available' });
        if (!requireAuth()) return;
        const group = gm.findGroup(gmatch[1]);
        if (!group) return send(404, { error: 'Group not found' });
        const proposal = gm.getProposal(gmatch[2]);
        if (!proposal || proposal.groupId !== group.id) return send(404, { error: 'proposal not found' });
        const d = await body();
        const actor = viewer || d.actor;
        try {
          let signature = d.signature || null;
          if (!signature && this._identity && this._identity.pubkey) {
            const { pubkeysMatch } = require('../functions/identity');
            if (pubkeysMatch(this._identity.pubkey, actor)) {
              const gcp = require('../functions/groupChangeProposal');
              signature = gcp.signProposalVote(this._identity, proposal).signature;
            }
          }
          if (!signature) return send(400, { error: 'signature required (or unlock identity)' });
          const result = gm.castVote(proposal.id, actor, signature, {
            requireVerify: true,
            local: true
          });
          return send(result.adopted ? 200 : 202, {
            type: result.adopted ? 'Group' : 'GroupChangeProposal',
            data: result.adopted ? result.group : result.proposal,
            group: result.group,
            proposal: result.proposal,
            adopted: !!result.adopted
          });
        } catch (e) {
          return send(e.code === 'FORBIDDEN' ? 403 : /not found/i.test(e.message) ? 404 : 400, { error: e.message });
        }
      }
      if ((gmatch = pathname.match(new RegExp(`^${base}/groups/([^/]+)/applications$`)))) {
        if (!gm) return send(503, { error: 'Group system not available' });
        const group = gm.findGroup(gmatch[1]);
        if (!group) return send(404, { error: 'Group not found' });
        if (req.method === 'GET') {
          if (!viewer || group.creator !== viewer) return send(403, { error: 'forbidden: only the creator can list join applications' });
          return send(200, { type: 'Collection', data: gm.getGroupApplications(group.id) });
        }
        if (req.method === 'POST') {
          if (!requireAuth()) return;
          const d = await body();
          // Local relay: publishing identity is the default applicant when no Bearer.
          const applicant = viewer
            || (this._identity && this._identity.pubkey)
            || d.applicantId;
          try { return send(200, { type: 'GroupApplication', data: await gm.applyToGroup(group.id, applicant, d.message) }); }
          catch (e) { return send(e.code === 'FORBIDDEN' ? 403 : 400, { error: e.message }); }
        }
      }
      if ((gmatch = pathname.match(new RegExp(`^${base}/group-applications/([^/]+)/decision$`))) && req.method === 'POST') {
        if (!gm) return send(503, { error: 'Group system not available' });
        if (!requireAuth()) return;
        const d = await body();
        try {
          return send(200, {
            type: 'GroupApplication',
            data: await gm.decideApplication(Object.assign({}, d, { applicationId: gmatch[1], actor: viewer || d.actor }))
          });
        } catch (e) {
          return send(e.code === 'FORBIDDEN' ? 403 : /not found/i.test(e.message) ? 404 : 400, { error: e.message });
        }
      }
      if (req.method === 'GET' && pathname === `${base}/groupaudit`) {
        if (!requireAuth()) return;
        return send(200, { type: 'Collection', data: gm ? gm.audit : [] });
      }

      // Signed batch ingest: legacy HTTP path for Schnorr-signed event batches.
      // Disabled by default — production peering is Fabric Peer (D-010). Enable
      // with ingest.httpEnable or SC_HTTP_INGEST=1 for tests / transitional hubs.
      if (req.method === 'POST' && pathname === `${base}/events`) {
        if (this.settings.ingest.httpEnable !== true) {
          return send(403, {
            error: 'HTTP event ingest is disabled; use Fabric Peer SCEventBatch (set ingest.httpEnable or SC_HTTP_INGEST=1 for legacy)'
          });
        }
        const envelope = await body();
        const check = this._checkEnvelope(envelope);
        if (!check.ok) return send(check.code, { error: check.error });
        const events = (envelope.payload && Array.isArray(envelope.payload.events)) ? envelope.payload.events : null;
        if (!events) return send(400, { error: 'payload.events array required' });
        const results = [];
        let created = 0;
        for (const ev of events) {
          try {
            const r = this._ingestEvent(envelope.pubkey, ev.collection, ev.data);
            if (r.created) created += 1;
            results.push({ id: r.id, collection: ev.collection, created: r.created });
          } catch (e) {
            results.push({ error: e.message, collection: ev.collection || null });
          }
        }
        this.emit('ingest', { source: envelope.pubkey, received: events.length, created });
        return send(200, { type: 'IngestResult', received: events.length, created, results });
      }

      const collections = { activities: () => this.activities, players: () => this.players, logins: () => this.logins, vehicles: () => this.vehicles, kills: () => this.kills, incaps: () => this.incaps, deaths: () => this.deaths, missionlog: () => this.missionlog, notifications: () => this.notifications, messages: () => this.logs };
      for (const [name, getter] of Object.entries(collections)) {
        if (pathname === `${base}/${name}`) {
          if (req.method === 'GET') {
            // Same bar as /monitor: session required on hosted / shared-LAN.
            if (!requireAuth()) return;
            return send(200, { type: 'Collection', data: getter() });
          }
          if (req.method === 'POST' && name !== 'messages' && name !== 'logins' && name !== 'notifications' && name !== 'incaps' && name !== 'deaths') {
            if (!requireAuth()) return;
            const data = await body();
            // Server mode: remote collection writes only via enabled HTTP ingest
            // (signed) or Fabric Peer — never unsigned.
            if (this.settings.ingest.requireSigned) {
              if (this.settings.ingest.httpEnable !== true) {
                return send(403, {
                  error: 'HTTP collection ingest is disabled; use Fabric Peer (set ingest.httpEnable or SC_HTTP_INGEST=1 for legacy)'
                });
              }
              const check = this._checkEnvelope(data);
              if (!check.ok) return send(check.code, { error: check.error });
              try {
                const r = this._ingestEvent(data.pubkey, name, data.payload);
                return send(200, { type: name, data: this.state[name][r.id] || { id: r.id } });
              } catch (e) { return send(400, { error: e.message }); }
            }
            // Players dedupe by handle (distinct roster) rather than per-event.
            if (name === 'players' && data.name) {
              const { player } = this.recordPlayer(data.name, data.timestamp || new Date().toISOString());
              return send(200, { type: 'players', data: player });
            }
            const id = idFor(JSON.stringify(data) + Date.now());
            this.state[name][id] = Object.assign({ id }, data);
            if (name === 'kills') this.emit('kill', this.state[name][id]);
            return send(200, { type: name, data: this.state[name][id] });
          }
        }
      }
      // Missions shared to a group are visible to its members only (hosted mode).
      // Membership spans the group tree (group + subgroups), matching the
      // broadcast receive filter and _listMissionBroadcasts.
      const visible = (m) => {
        if (!m) return false;
        if (!serverMode || !m.groupId) return true;
        return !!(viewer && gm && gm.isInGroupTree(m.groupId, viewer));
      };
      if (pathname === `${base}/missions`) {
        if (req.method === 'GET') return send(200, { type: 'Collection', data: this.missions.filter(visible) });
        if (req.method === 'POST') {
          if (!this.missionManager) return send(503, { error: 'Mission system not available' });
          if (!requireAuth()) return;
          const d = await body();
          const creator = this._actor(req, d.createdBy || d.officerId);
          if (d.groupId) {
            if (!gm || !gm.getGroup(d.groupId)) return send(404, { error: 'Group not found' });
            if (!gm.isMember(d.groupId, creator)) return send(403, { error: 'forbidden: not a member of the target group' });
          }
          try {
            const mission = await this.missionManager.createMission(Object.assign({}, d, { createdBy: creator }));
            // Best-effort mesh share: peers upsert the mission. Explicit
            // Broadcast still creates Accept/Ignore offers.
            this.publishMissionCreated(mission).catch((e) => this.emit('error', e));
            return send(200, { type: 'Mission', data: mission });
          } catch (e) { return send(e.code === 'FORBIDDEN' ? 403 : 400, { error: e.message }); }
        }
      }
      const mMatch = pathname.match(new RegExp(`^${base}/missions/([^/]+)$`));
      if (mMatch && req.method === 'GET') {
        if (!this.missionManager) return send(503, { error: 'Mission system not available' });
        const m = this.missionManager.getMission(mMatch[1]);
        if (!m || !visible(m)) return send(404, { error: 'Mission not found' });
        return send(200, { type: 'Mission', data: m });
      }

      // ---- Mission register flow (M5.2) ----
      const reg = this.missionManager;
      // Run a register action and map errors: 403 forbidden, 404 not found, else 400.
      const run = async (fn, type) => {
        if (!reg) return send(503, { error: 'Mission system not available' });
        try { return send(200, { type, data: await fn() }); }
        catch (e) { return send(e.code === 'FORBIDDEN' ? 403 : /not found/i.test(e.message) ? 404 : 400, { error: e.message }); }
      };
      // Read-only lists (server mode: Bearer session required — PII / register audit).
      if (req.method === 'GET' && pathname === `${base}/applications`) {
        if (this.settings.mode === 'server' && !this._authPubkey(req)) {
          return send(401, { error: 'Authentication required' });
        }
        return send(200, { type: 'Collection', data: reg ? reg.applications : [] });
      }
      if (req.method === 'GET' && pathname === `${base}/claims`) {
        if (this.settings.mode === 'server' && !this._authPubkey(req)) {
          return send(401, { error: 'Authentication required' });
        }
        return send(200, { type: 'Collection', data: reg ? reg.claims : [] });
      }
      if (req.method === 'GET' && pathname === `${base}/validations`) {
        if (this.settings.mode === 'server' && !this._authPubkey(req)) {
          return send(401, { error: 'Authentication required' });
        }
        return send(200, { type: 'Collection', data: reg ? reg.validations : [] });
      }
      if (req.method === 'GET' && pathname === `${base}/audit`) {
        if (this.settings.mode === 'server' && !this._authPubkey(req)) {
          return send(401, { error: 'Authentication required' });
        }
        return send(200, { type: 'Collection', data: reg ? reg.audit : [] });
      }
      // Mission sub-resources and actions.
      let mr;
      if ((mr = pathname.match(new RegExp(`^${base}/missions/([^/]+)/applications$`))) && req.method === 'GET')
        return send(200, { type: 'Collection', data: reg ? reg.getMissionApplications(mr[1]) : [] });
      if ((mr = pathname.match(new RegExp(`^${base}/missions/([^/]+)/cancel$`))) && req.method === 'POST') {
        if (!requireAuth()) return;
        const d = await body(); return run(() => reg.cancelMission(Object.assign({}, d, { missionId: mr[1], officerId: this._actor(req, d.officerId) })), 'Mission');
      }
      if ((mr = pathname.match(new RegExp(`^${base}/missions/([^/]+)/apply$`))) && req.method === 'POST') {
        if (!requireAuth()) return;
        const d = await body(); return run(() => reg.applyToMission(Object.assign({}, d, { missionId: mr[1], applicantId: this._actor(req, d.applicantId) })), 'Application');
      }
      if ((mr = pathname.match(new RegExp(`^${base}/missions/([^/]+)/broadcast$`))) && req.method === 'POST') {
        if (!requireAuth()) return;
        const actor = this._actor(req, null) || (this._identity && this._identity.pubkey) || null;
        const d = await body();
        try {
          const data = await this.broadcastMission(mr[1], actor, {
            scope: d.scope,
            groupId: d.groupId
          });
          return send(200, { type: 'MissionBroadcast', data });
        } catch (e) {
          return send(e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 400, { error: e.message });
        }
      }
      if (pathname === `${base}/missionbroadcasts` && req.method === 'GET') {
        const pendingOnly = url.searchParams.get('pending') !== '0';
        const persisted = settingsStore.loadSettings(this.registerStore);
        const notifyDesktop = persisted.notifyDesktop !== false;
        return send(200, {
          type: 'Collection',
          data: this._listMissionBroadcasts({ pendingOnly, viewer }),
          notify: notifyDesktop && this._notifyMissionBroadcasts !== false
        });
      }
      if ((mr = pathname.match(new RegExp(`^${base}/missionbroadcasts/([^/]+)/(accept|ignore)$`))) && req.method === 'POST') {
        if (!requireAuth()) return;
        const rec = this._getMissionBroadcast(mr[1]);
        if (!rec) return send(404, { error: 'Broadcast not found' });
        if (rec.status !== 'pending') return send(400, { error: `broadcast already ${rec.status}` });
        const actor = this._actor(req, null) || (this._identity && this._identity.pubkey) || null;
        if (mr[2] === 'ignore') {
          rec.status = 'ignored';
          rec.resolvedAt = new Date().toISOString();
          rec.resolvedBy = actor;
          this._putMissionBroadcast(rec);
          this._syncInboxMissionBroadcast(rec);
          return send(200, { type: 'MissionBroadcast', data: rec });
        }
        if (!actor) return send(401, { error: 'Unlock your identity to accept' });
        try {
          // Accept = apply (pending officer decision), not auto-join/assign.
          const app = await reg.applyToMission({
            missionId: rec.missionId,
            applicantId: actor,
            message: 'via broadcast'
          });
          rec.status = 'accepted';
          rec.resolvedAt = new Date().toISOString();
          rec.resolvedBy = actor;
          rec.applicationId = app.id;
          this._putMissionBroadcast(rec);
          this._syncInboxMissionBroadcast(rec);
          return send(200, { type: 'MissionBroadcast', data: rec, application: app });
        } catch (e) {
          return send(/not found/i.test(e.message) ? 404 : 400, { error: e.message });
        }
      }
      if (pathname === `${base}/inbox` && req.method === 'GET') {
        const pendingOnly = url.searchParams.get('pending') === '1';
        const kind = url.searchParams.get('kind') || null;
        const scope = url.searchParams.get('scope') || null;
        const missionId = url.searchParams.get('missionId') || null;
        const groupId = url.searchParams.get('groupId') || null;
        const notificationsOnly = scope === 'notifications' || url.searchParams.get('notifications') === '1';
        const data = registerInbox.list(this.registerStore, {
          pendingOnly,
          kind,
          missionId,
          groupId,
          notificationsOnly,
          backfill: true
        }).filter((r) => r.status !== 'self');
        return send(200, {
          type: 'Collection',
          data,
          pending: registerInbox.pendingCount(this.registerStore)
        });
      }
      if ((mr = pathname.match(new RegExp(`^${base}/inbox/([^/]+)/(dismiss|ignore)$`))) && req.method === 'POST') {
        const row = this.registerStore && this.registerStore.get('inbox', decodeURIComponent(mr[1]));
        if (!row) return send(404, { error: 'Inbox item not found' });
        if (row.kind === 'MissionBroadcast' && row.refs && row.refs.broadcastId) {
          // Prefer the dedicated broadcast accept/ignore endpoints for missions.
          return send(400, { error: 'Use /missionbroadcasts/:id/ignore for mission offers' });
        }
        const actor = this._actor(req, null) || (this._identity && this._identity.pubkey) || null;
        const updated = registerInbox.patch(this.registerStore, row.id, {
          status: 'ignored',
          actionable: false,
          resolvedAt: new Date().toISOString(),
          resolvedBy: actor
        });
        return send(200, { type: registerInbox.INBOX_TYPE, data: updated });
      }
      if ((mr = pathname.match(new RegExp(`^${base}/missions/([^/]+)/claim$`))) && req.method === 'POST') {
        if (!requireAuth()) return;
        const d = await body();
        return run(async () => {
          const claim = await reg.submitClaim(Object.assign({}, d, { missionId: mr[1], claimantId: this._actor(req, d.claimantId) }));
          this.publishMissionClaim(claim).catch((e) => this.emit('error', e));
          return claim;
        }, 'Claim');
      }
      if ((mr = pathname.match(new RegExp(`^${base}/applications/([^/]+)/decision$`))) && req.method === 'POST') {
        if (!requireAuth()) return;
        const d = await body(); return run(() => reg.decideApplication(Object.assign({}, d, { applicationId: mr[1], officerId: this._actor(req, d.officerId) })), 'Application');
      }
      if ((mr = pathname.match(new RegExp(`^${base}/claims/([^/]+)/validate$`))) && req.method === 'POST') {
        if (!requireAuth()) return;
        const d = await body();
        return run(async () => {
          const validation = await reg.validateClaim(Object.assign({}, d, { claimId: mr[1], officerId: this._actor(req, d.officerId) }));
          this.publishMissionClaimDecision(validation).catch((e) => this.emit('error', e));
          return validation;
        }, 'Validation');
      }

      // ---- Bitcoin wallet (Hub components brought forward; group multisig) ----
      const pm = this.payoutManager;
      if (req.method === 'GET' && pathname === `${base}/wallet`) {
        const escrows = (this.missionManager ? this.missionManager.missions : [])
          .filter((m) => m.escrow)
          .map((m) => ({
            missionId: m.id,
            title: m.title,
            status: m.status,
            escrow: m.escrow
          }));
        return send(200, {
          type: 'Wallet',
          data: {
            mode: pm ? pm.mode : 'disabled',
            network: pm ? pm.settings.network : null,
            feeSats: pm ? pm.settings.feeSats : null,
            escrows,
            bitcoin: hubBitcoinProxy.bitcoinRuntimeForSettings(this.settings)
          }
        });
      }

      // ---- Hub-backed personal Bitcoin (proxy; identity xpub watch + Hub-wallet send) ----
      const btcPath = `${base}/bitcoin`;
      if (pathname === `${btcPath}/status` || pathname.startsWith(`${btcPath}/`)) {
        const btcCfg = Object.assign({}, this.settings.bitcoin || {});
        if (!hubBitcoinProxy.isBitcoinEnabled(this.settings)) {
          return send(503, { error: 'Bitcoin wallet disabled (settings.bitcoin.enable)' });
        }
        const btc = hubBitcoinProxy.withResolvedHubAdminToken({
          hub: hubBitcoinProxy.normalizeHubBase(btcCfg.hub),
          network: String(btcCfg.network || 'regtest'),
          adminToken: btcCfg.adminToken || null,
          adminTokenFile: btcCfg.adminTokenFile || null
        });
        try {
          if (pathname === `${btcPath}/status` && req.method === 'GET') {
            const status = await hubBitcoinProxy.fetchStatus(btc);
            return send(200, { type: 'BitcoinStatus', data: status, hub: btc.hub, network: btc.network });
          }
          if (pathname === `${btcPath}/wallet` && req.method === 'GET') {
            const xpubParam = String(url.searchParams.get('xpub') || '').trim();
            const ident = this._identity || {};
            const watchXpub = hubBitcoinProxy.bitcoinWatchXpubFromIdentity(ident) || xpubParam;
            if (!watchXpub) return send(400, { error: 'xpub query param required (or unlock identity)' });
            const summary = await hubBitcoinProxy.fetchWalletSummary(btc, { xpub: watchXpub });
            return send(200, {
              type: 'BitcoinWallet',
              data: summary,
              walletId: hubBitcoinProxy.deriveWalletIdFromXpub(watchXpub),
              watchXpub
            });
          }
          if (pathname === `${btcPath}/receive` && req.method === 'GET') {
            const xpubParam = String(url.searchParams.get('xpub') || '').trim();
            const index = Number(url.searchParams.get('index') || 0);
            const ident = this._identity || {};
            const xpub = xpubParam || String(ident.xpub || '').trim();
            if (!xpub && !ident.xprv) return send(400, { error: 'xpub query param required (or unlock identity)' });
            const derived = hubBitcoinProxy.deriveReceiveAddress(xpub, index, btc.network, {
              xprv: ident.xprv || null
            });
            if (!derived) return send(400, { error: 'unable to derive receive address from identity' });
            const watchXpub = derived.accountXpub || hubBitcoinProxy.bitcoinWatchXpubFromIdentity(ident) || xpub;
            return send(200, {
              type: 'BitcoinReceive',
              data: Object.assign({}, derived, {
                network: btc.network,
                walletId: hubBitcoinProxy.deriveWalletIdFromXpub(watchXpub)
              })
            });
          }
          if (pathname === `${btcPath}/transactions` && req.method === 'GET') {
            const xpubParam = String(url.searchParams.get('xpub') || '').trim();
            const limit = Number(url.searchParams.get('limit') || 50);
            const ident = this._identity || {};
            const watchXpub = hubBitcoinProxy.bitcoinWatchXpubFromIdentity(ident) || xpubParam;
            if (!watchXpub) return send(400, { error: 'xpub query param required (or unlock identity)' });
            const txs = await hubBitcoinProxy.fetchTransactions(btc, { xpub: watchXpub, limit });
            return send(200, { type: 'BitcoinTransactions', data: txs });
          }
          if (pathname === `${btcPath}/utxos` && req.method === 'GET') {
            const xpubParam = String(url.searchParams.get('xpub') || '').trim();
            const ident = this._identity || {};
            const watchXpub = hubBitcoinProxy.bitcoinWatchXpubFromIdentity(ident) || xpubParam;
            if (!watchXpub) return send(400, { error: 'xpub query param required (or unlock identity)' });
            const utxos = await hubBitcoinProxy.fetchUtxos(btc, { xpub: watchXpub });
            return send(200, { type: 'BitcoinUtxos', data: utxos });
          }
          if (pathname === `${btcPath}/send` && req.method === 'POST') {
            if (!requireAuth()) return;
            const d = await body();
            const result = await hubBitcoinProxy.sendHubPayment(btc, {
              to: d.to || d.address,
              amountSats: d.amountSats,
              memo: d.memo,
              xpub: d.xpub,
              walletId: d.walletId
            });
            return send(200, { type: 'BitcoinSend', data: result });
          }
          if (pathname === `${btcPath}/faucet` && req.method === 'GET') {
            const discovered = await hubBitcoinProxy.discoverFaucet(btc);
            return send(200, { type: 'BitcoinFaucet', data: discovered });
          }
          if (pathname === `${btcPath}/faucet` && req.method === 'POST') {
            if (!requireAuth()) return;
            const d = await body();
            const result = await hubBitcoinProxy.requestFaucet(btc, {
              address: d.address || d.to,
              amountSats: d.amountSats
            });
            return send(200, { type: 'BitcoinFaucetResult', data: result });
          }
          return send(404, { error: 'unknown bitcoin route' });
        } catch (e) {
          const status = (e && e.status) || 502;
          return send(status, { error: e.message || String(e), data: e.data || null });
        }
      }

      // ---- Local document catalog (this node — not hub.fabric.pub) ----
      const docsPath = `${base}/documents`;
      if (pathname === docsPath || pathname.startsWith(`${docsPath}/`)) {
        if (!hubDocumentExchangeProxy.isDocumentsEnabled(this.settings)) {
          return send(503, { error: 'Document Exchange disabled (settings.documents.enable)' });
        }
        try {
          if (pathname === docsPath && req.method === 'GET') {
            if (!requireAuth()) return;
            const payload = this._documentCatalogPayload();
            return send(200, {
              type: 'DocumentList',
              data: { documents: payload.documents, offers: payload.offers },
              local: true
            });
          }
          if (pathname === docsPath && req.method === 'POST') {
            if (!requireAuth()) return;
            const d = await body();
            const created = this._ingestLocalDocument(req, d || {});
            let document = created;
            if (d && (d.publish === true || d.published === true)) {
              document = localDocuments.publish(
                this.registerStore,
                created.id,
                this._documentPublishOpts(d)
              );
            }
            if (d && (d.pinToProfile === true || d.profilePinned === true || d.pinned === true)) {
              document = localDocuments.setProfilePinned(
                this.registerStore,
                created.id,
                true,
                this._documentPublishOpts(d)
              );
              this._publishGroupDataShareNow();
            } else if (this._hasPinnedProfileFiles()) {
              this._publishGroupDataShareNow();
            }
            if (d && (d.clusterSync === true || d.sync === true)) {
              document = this._setFileClusterSync(created.id, true);
            }
            return send(200, {
              type: document && document.published ? 'DocumentPublish' : 'DocumentCreate',
              data: { document },
              local: true
            });
          }
          if (pathname === `${docsPath}/inventory` && req.method === 'POST') {
            if (!requireAuth()) return;
            const queried = this._queryPeerInventories();
            return send(200, { type: 'DocumentInventory', data: queried, local: true });
          }
          if (pathname === `${docsPath}/offers` && req.method === 'GET') {
            if (!requireAuth()) return;
            const documentId = String(url.searchParams.get('documentId') || url.searchParams.get('id') || '').trim();
            const offers = documentId
              ? documentOffers.offersForDocument({
                store: this.registerStore,
                documentId,
                aliases: this._documentOfferAliases()
              })
              : documentOffers.sortOffersByPrice(documentOffers.list(this.registerStore));
            return send(200, { type: 'DocumentOffers', data: { offers, documentId: documentId || null } });
          }
          let docMatch = pathname.match(new RegExp(`^${docsPath}/([^/]+)$`));
          if (docMatch && req.method === 'GET') {
            if (!requireAuth()) return;
            const payload = this._documentDetailPayload(decodeURIComponent(docMatch[1]));
            return send(200, { type: 'Document', data: payload, local: payload.local });
          }
          docMatch = pathname.match(new RegExp(`^${docsPath}/([^/]+)/publish$`));
          if (docMatch && req.method === 'POST') {
            if (!requireAuth()) return;
            const d = await body();
            const published = localDocuments.publish(
              this.registerStore,
              decodeURIComponent(docMatch[1]),
              this._documentPublishOpts(d || {})
            );
            if (this._hasPinnedProfileFiles()) this._publishGroupDataShareNow();
            return send(200, { type: 'DocumentPublish', data: { document: published }, local: true });
          }
          docMatch = pathname.match(new RegExp(`^${docsPath}/([^/]+)/cluster-sync$`));
          if (docMatch && req.method === 'POST') {
            if (!requireAuth()) return;
            const d = await body();
            const on = !(d && (d.clusterSync === false || d.sync === false || d.enabled === false));
            const document = this._setFileClusterSync(decodeURIComponent(docMatch[1]), on);
            return send(200, { type: 'FileClusterSync', data: { document, clusterSync: on }, local: true });
          }
          docMatch = pathname.match(new RegExp(`^${docsPath}/([^/]+)/purchase$`));
          if (docMatch && req.method === 'POST') {
            return send(501, {
              error: 'Purchase invoices are Hub-only — content on this node is in the local catalog'
            });
          }
          docMatch = pathname.match(new RegExp(`^${docsPath}/([^/]+)/claim$`));
          if (docMatch && req.method === 'POST') {
            return send(501, {
              error: 'Purchase claim is Hub-only — content on this node is in the local catalog'
            });
          }
          return send(404, { error: 'unknown documents route' });
        } catch (e) {
          const status = (e && e.status) || 400;
          return send(status, { error: e.message || String(e), data: e.data || null });
        }
      }
      let wMatch;
      if ((wMatch = pathname.match(new RegExp(`^${base}/groups/([^/]+)/wallet$`))) && req.method === 'GET') {
        if (!gm) return send(503, { error: 'Group system not available' });
        const group = gm.findGroup(wMatch[1]);
        if (!group) return send(404, { error: 'Group not found' });
        if (serverMode && !(viewer && group.includes(viewer))) {
          return send(403, { error: 'forbidden: members only' });
        }
        if (!pm) {
          return send(200, {
            type: 'GroupWallet',
            data: {
              groupId: group.id,
              keys: [...group.members].sort(),
              threshold: group.threshold,
              mode: 'disabled',
              address: null,
              bitcoinEnable: hubBitcoinProxy.isBitcoinEnabled(this.settings),
              note: 'configure payouts (bitcoind RPC) to derive addresses'
            }
          });
        }
        try {
          const { groupTaprootWallet } = require('../functions/groupSpendLadder');
          const tapWallet = groupTaprootWallet(group, { network: (pm && pm.network) || 'regtest' });
          let legacy = null;
          try {
            const signers = group.validators || group.members;
            legacy = await pm.multisigAddress(signers, group.threshold);
          } catch (_) { /* optional */ }
          const bitcoinEnable = hubBitcoinProxy.isBitcoinEnabled(this.settings);
          const data = Object.assign({ groupId: group.id }, tapWallet, {
            legacyP2wsh: legacy,
            keys: tapWallet.keys,
            threshold: tapWallet.threshold,
            bitcoinEnable,
            balanceSats: null,
            utxos: [],
            history: [],
            balanceSource: null,
            balanceError: null
          });
          if (bitcoinEnable && data.address) {
            try {
              const funding = await this._groupWalletFunding(data.address, pm);
              Object.assign(data, funding);
            } catch (e) {
              data.balanceError = (e && e.message) || String(e);
            }
          }
          return send(200, { type: 'GroupWallet', data });
        } catch (e) { return send(400, { error: e.message }); }
      }

      // ---- Group Taproot withdrawals (failover ladder) ----
      if ((wMatch = pathname.match(new RegExp(`^${base}/groups/([^/]+)/withdrawals$`)))) {
        if (!gm) return send(503, { error: 'Group system not available' });
        const group = gm.findGroup(wMatch[1]);
        if (!group) return send(404, { error: 'Group not found' });
        if (req.method === 'GET') {
          if (serverMode && !(viewer && group.includes(viewer))) {
            return send(403, { error: 'forbidden: members only' });
          }
          const list = (this.store && this.store.all)
            ? this.store.all('groupwithdrawals').filter((w) => w.groupId === group.id)
            : [];
          return send(200, { type: 'GroupWithdrawalList', data: list });
        }
        if (req.method === 'POST') {
          if (!requireAuth()) return;
          const actor = viewer || (this._identity && this._identity.pubkey);
          if (!actor || group.creator !== actor) {
            return send(403, { error: 'forbidden: only the group creator (publisher) may propose withdrawals' });
          }
          const d = await body();
          try {
            const data = await this.proposeGroupWithdrawal(group.id, actor, d);
            return send(200, { type: 'GroupWithdrawal', data });
          } catch (e) {
            return send(e.code === 'FORBIDDEN' ? 403 : 400, { error: e.message });
          }
        }
      }
      if ((wMatch = pathname.match(new RegExp(`^${base}/groups/([^/]+)/withdrawals/([^/]+)/(witness|finalize)$`))) && req.method === 'POST') {
        if (!gm) return send(503, { error: 'Group system not available' });
        if (!requireAuth()) return;
        const group = gm.findGroup(wMatch[1]);
        if (!group) return send(404, { error: 'Group not found' });
        const actor = viewer || (this._identity && this._identity.pubkey);
        const d = await body();
        try {
          const data = wMatch[3] === 'finalize'
            ? await this.finalizeGroupWithdrawal(group.id, wMatch[2], actor, d)
            : await this.witnessGroupWithdrawal(group.id, wMatch[2], actor, d);
          return send(200, { type: 'GroupWithdrawal', data });
        } catch (e) {
          return send(e.code === 'FORBIDDEN' ? 403 : /not found/i.test(e.message) ? 404 : 400, { error: e.message });
        }
      }

      // ---- Bitcoin escrow / payouts ----
      const escrowMission = (id) => {
        const m = reg ? reg.getMission(id) : null;
        if (!m || !visible(m)) return null;
        return m;
      };
      if ((mr = pathname.match(new RegExp(`^${base}/missions/([^/]+)/escrow$`)))) {
        if (!pm) return send(503, { error: 'Payout system not available' });
        const m = escrowMission(mr[1]);
        if (!m) return send(404, { error: 'Mission not found' });
        if (req.method === 'GET') {
          if (!m.escrow) return send(404, { error: 'Mission has no escrow' });
          let funding = null;
          try { funding = await pm.checkFunding(m.escrow); reg.store.put('missions', m.id, m); } catch (e) { funding = { error: e.message }; }
          return send(200, { type: 'Escrow', data: Object.assign({}, m.escrow, { funding }) });
        }
        if (req.method === 'POST') {
          if (!requireAuth()) return;
          const d = await body();
          const actor = this._actor(req, d.actor);
          const allowed = actor && (actor === m.createdBy || (m.authorities && m.authorities.keys.includes(actor)));
          if (!allowed) return send(403, { error: 'forbidden: only the creator or an authority may create the escrow' });
          if (m.escrow) return send(400, { error: 'escrow already exists' });
          try {
            m.escrow = await pm.createEscrow(m, d.amountSats);
            reg.store.put('missions', m.id, m);
            reg._audit(actor, 'escrow.create', 'mission', m.id, `${m.escrow.amountSats} sats -> ${m.escrow.address || 'ledger'}`);
            const escrowNotice = registerInbox.entryFromWalletEvent({
              kind: 'WalletEscrow',
              status: 'info',
              actionable: false,
              title: 'Mission escrow created',
              body: m.escrow.address
                ? `${m.escrow.amountSats} sats → ${m.escrow.address}`
                : `${m.escrow.amountSats} sats (ledger)`,
              source: actor,
              refs: {
                missionId: m.id,
                address: m.escrow.address || null,
                amountSats: m.escrow.amountSats
              },
              dedupeKey: `wallet-escrow-${m.id}`
            });
            if (escrowNotice) this._appendInbox(escrowNotice);
            return send(200, { type: 'Escrow', data: m.escrow });
          } catch (e) { return send(400, { error: e.message }); }
        }
      }
      if ((mr = pathname.match(new RegExp(`^${base}/missions/([^/]+)/payout$`))) && req.method === 'POST') {
        if (!pm) return send(503, { error: 'Payout system not available' });
        if (!requireAuth()) return;
        const m = escrowMission(mr[1]);
        if (!m || !m.escrow) return send(404, { error: 'Mission escrow not found' });
        const d = await body();
        try {
          if (d.signedTxHex) {
            const result = await pm.broadcastPayout(m.escrow, d.signedTxHex);
            reg.store.put('missions', m.id, m);
            reg._audit(this._actor(req, d.actor), 'escrow.paid', 'mission', m.id, result.txid);
            return send(200, { type: 'Payout', data: result });
          }
          const built = await pm.buildPayout(
            m.escrow,
            d.toAddress || m.escrow.payeeAddress || null
          );
          reg.store.put('missions', m.id, m);
          return send(200, { type: 'PayoutPsbt', data: built });
        } catch (e) { return send(400, { error: e.message }); }
      }

      return send(404, { error: 'Not found', path: pathname });
    } catch (e) {
      return send(500, { error: e.message });
    }
  }

  // ---- Log handling (read-only) ----
  parseLogEntry (entry) { return parseLine(entry); }

  handleLogChange (entry) {
    const ev = parseLine(entry);
    const id = idFor(entry);

    if (ev.timestamp) this._lastLogEventAt = ev.timestamp;
    else this._lastLogEventAt = new Date().toISOString();
    this._updateDetectedShipFromEvent(ev);
    this._updateDetectedPlacesFromEvent(ev);

    // Stamp session build/hardware from header lines (one-shot, additive).
    const sinfo = parseSessionInfo(entry);
    if (sinfo) this.session[sinfo.key] = sinfo.value;

    // Always keep a generic record.
    this.state.logs[id] = ev;
    const activity = { type: 'StarCitizenLogEntry', id, kind: ev.kind, timestamp: ev.timestamp, object: { id, content: entry }, target: '/logs' };
    this.state.activities[id] = activity;

    // Rolling buffers powering the live monitor UI.
    const recognized = !(ev.kind === 'log:raw' || ev.kind === 'log:notice');
    const rec = { seq: ++this._seq, kind: ev.kind, tag: ev.tag, verified: ev.verified, timestamp: ev.timestamp, recognized, raw: String(entry) };
    this.recent.push(rec);
    if (this.recent.length > 500) this.recent.shift();
    const tracked = ev.kind === 'kill' || ev.kind === 'vehicle:destroy' || (ev.kind && ev.kind.indexOf('mission:') === 0);
    if (tracked || INTEREST_HINTS.test(entry)) {
      this.flagged.push(rec);
      if (this.flagged.length > 2000) this.flagged.shift();
    }

    // Route classified events into the right collections + emit specific events.
    switch (ev.kind) {
      case 'kill': {
        const kill = {
          id, killer: ev.killer, victim: ev.victim, weapon: ev.weapon, weaponClass: ev.weaponClass,
          zone: ev.zone, damageType: ev.damageType, killerId: ev.killerId, victimId: ev.victimId,
          killerNpc: isNPC(ev.killer), victimNpc: isNPC(ev.victim),
          // who, relative to the relay's player: 'kill' (we got it), 'death' (we died), or 'other'
          involves: ev.killer === this._sessionHandle ? 'kill' : (ev.victim === this._sessionHandle ? 'death' : 'other'),
          timestamp: ev.timestamp,
          raw: String(entry)
        };
        this.state.kills[id] = kill;
        this.emit('kill', kill);
        break;
      }
      case 'player:login': {
        this._sessionHandle = ev.handle;
        this.recordPlayer(ev.handle, ev.timestamp);
        this._applyHistoryEvent(ev);
        break;
      }
      case 'player:incap': {
        const inc = {
          id, kind: ev.kind, player: this._sessionHandle || null, text: ev.text,
          timestamp: ev.timestamp, raw: String(entry)
        };
        this.state.incaps[id] = inc;
        this.emit('player:incap', inc);
        break;
      }
      case 'player:death': {
        // Local-player death (corpse-recovery body marker). One event per death;
        // SC stopped logging kills after 4.3.0, so this is the current-build signal.
        const d = {
          id, kind: ev.kind, player: this._sessionHandle || null, bodyId: ev.bodyId,
          timestamp: ev.timestamp, raw: String(entry)
        };
        this.state.deaths[id] = d;
        this.emit('player:death', d);
        this._applyHistoryEvent(ev);
        break;
      }
      case 'vehicle:destroy': {
        const v = {
          id, vehicle: ev.vehicle, vehicleName: shipName(ev.vehicle), cause: ev.cause,
          attacker: ev.attacker, fromLevel: ev.fromLevel, toLevel: ev.toLevel,
          timestamp: ev.timestamp, raw: String(entry)
        };
        this.state.vehicles[id] = v;
        this.emit('vehicle:destroy', v);
        break;
      }
      case 'mission:contract':
      case 'mission:objective':
      case 'mission:notification':
      case 'mission:marker':
      case 'mission:start':
      case 'mission:end': {
        const me = { id, kind: ev.kind, timestamp: ev.timestamp,
          contract: ev.contract, generator: ev.generator, text: ev.text, objectiveId: ev.objectiveId, missionId: ev.missionId,
          contractId: ev.contractId, completionType: ev.completionType, reason: ev.reason, player: ev.player,
          raw: String(entry) };
        this.state.missionlog[id] = me;
        this._indexMission(ev);
        this.emit(ev.kind, me);
        this.emit('mission:event', me);
        this._applyHistoryEvent(ev);
        break;
      }
      case 'hud:notification': {
        const n = { id, kind: ev.kind, text: ev.text, timestamp: ev.timestamp, raw: String(entry) };
        this.state.notifications[id] = n;
        this.emit('notification', n);
        break;
      }
      case 'session:start': {
        // A fresh game launch. Start a new session record; build/hardware lines
        // that follow fill into this same object (this.session points at it).
        this.session = { startedOn: ev.startedOn, detectedAt: ev.timestamp, channel: this.channel };
        this.sessions.push(this.session);
        if (this.sessions.length > 50) this.sessions.shift();
        this.emit('session:start', this.session);
        break;
      }
      default: break;
    }

    // Activity heat for other live lines (mission/death/login already applied above).
    if (this._historyApplyLive && ev.timestamp) {
      const folded = ev.kind === 'player:login' || ev.kind === 'player:death' ||
        (ev.kind && ev.kind.indexOf('mission:') === 0);
      if (!folded) this._applyHistoryEvent(ev, { countHeat: true });
    }

    this.emit('event', ev);       // every parsed line (used by replay tally)
    this.emit('activity', activity);
    return ev;
  }

  // Build the grouped mission view as mission events arrive. ObjectiveId is the
  // join key: notifications carry both MissionId + ObjectiveId; objective updates
  // carry ObjectiveId + the latest text. Contracts carry neither and stay in the
  // flat missionlog only.
  _indexMission (ev) {
    if (ev.objectiveId) {
      const o = this.state.objectives[ev.objectiveId] ||
        (this.state.objectives[ev.objectiveId] = { id: ev.objectiveId, firstSeen: ev.timestamp, updates: 0 });
      if (ev.text) o.text = ev.text;     // keep the latest objective text
      o.lastSeen = ev.timestamp;
      o.updates += 1;
    }
    if (ev.missionId && ev.missionId !== '00000000-0000-0000-0000-000000000000') {
      const m = this.state.missionGroups[ev.missionId] ||
        (this.state.missionGroups[ev.missionId] = { id: ev.missionId, firstSeen: ev.timestamp, objectiveIds: {}, notifications: [] });
      m.lastSeen = ev.timestamp;
      if (ev.generator) m.generator = ev.generator;   // template name -> mission type
      // Lifecycle: start stamps acceptance + contract template; end stamps the outcome.
      if (ev.kind === 'mission:start') {
        if (!m.startedAt) m.startedAt = ev.timestamp;
        if (ev.contractId) m.contractId = ev.contractId;
      }
      if (ev.kind === 'mission:end') {
        m.endedAt = ev.timestamp;
        m.outcome = ev.completionType;   // Complete | Abandon | Fail | Deactivate
        m.reason = ev.reason;
        if (ev.player) m.player = ev.player;
      }
      if (ev.kind === 'mission:notification') {
        m.notifications.push({ text: ev.text, objectiveId: ev.objectiveId || null, timestamp: ev.timestamp });
        if (m.notifications.length > 100) m.notifications.shift();
      }
      if (ev.objectiveId) m.objectiveIds[ev.objectiveId] = true;
      // Keep the officer-validated register in sync with Game.log lifecycle
      // (start / end / richer titles from notifications). Evidence only.
      try { this._syncGameLogMissionToRegister(m); } catch (e) { this.emit('error', e); }
    }

    // Combat progress proxy: a mission objective whose text implies combat. This
    // is the closest we get to "kills" on 4.8.0 (NPC ship kills are not logged).
    if (ev.text && COMBAT_OBJECTIVE.test(ev.text)) {
      if (ev.objectiveId && this.state.objectives[ev.objectiveId]) this.state.objectives[ev.objectiveId].combat = true;
      const c = { id: idFor(ev.text + '|' + ev.timestamp), text: ev.text, missionId: ev.missionId || null, objectiveId: ev.objectiveId || null, timestamp: ev.timestamp };
      this.state.combatlog[c.id] = c;
      this.emit('combat:progress', c);
    }
  }

  // Distinct-player roster keyed by handle, plus a login-event history. Forward-
  // looking to a multi-relay (Fabric) build: "who is playing" (distinct) vs
  // "how many logins/sessions". Emits player:join only the first time a handle
  // appears; player:login on every login.
  recordPlayer (name, timestamp) {
    if (!name) return null;
    const key = String(name).toLowerCase();
    let player = this.state.players[key];
    const isNew = !player;
    if (isNew) player = this.state.players[key] = { id: key, name, firstSeen: timestamp, lastSeen: timestamp, logins: 0 };
    player.name = name;            // keep latest display casing
    player.lastSeen = timestamp;
    player.logins += 1;
    const login = { id: idFor(name + '|' + timestamp), name, timestamp };
    this.state.logins[login.id] = login;
    if (isNew) this.emit('player:join', player);
    this.emit('player:login', login);
    return { player, isNew };
  }

  // Read-only poller. Survives the game rotating Game.log between sessions:
  // when the file shrinks/recreates (a restart), we reset to byte 0 and re-read
  // from the top so the new session header ("Log started on…") is captured. Start
  // at the current end-of-file so we only stream genuinely new lines while live.
  openLog () {
    if (!this.settings.logfile) return;
    try { const st = fs.statSync(this.settings.logfile); this._pos = st.size; this._ino = st.ino; }
    catch (_) { this._pos = 0; this._ino = null; }
    this._partial = '';
    this._scheduleNextPoll();
  }

  _scheduleNextPoll () {
    if (this.state.status === 'STOPPED' || this.state.status === 'STOPPING') return;
    this._pollTimer = setTimeout(() => this._poll(), 700);
  }

  _poll () {
    if (this.state.status === 'STOPPED' || this.state.status === 'STOPPING' || !this.settings.logfile) return;
    fs.stat(this.settings.logfile, (err, st) => {
      if (err) return this._scheduleNextPoll();        // file gone mid-rotation; retry
      // Restart = a different file at the same path (new inode) OR the file shrank.
      // The inode check catches a relaunch even if the new log already grew past
      // our old offset (e.g. after an ALT-F4 + quick restart).
      const newFile = this._ino && st.ino && st.ino !== this._ino;
      if (newFile || st.size < this._pos) {
        this._pos = 0; this._partial = '';
        this.emit('session:restart', { at: new Date().toISOString() });
      }
      this._ino = st.ino;
      if (st.size <= this._pos) return this._scheduleNextPoll();
      const stream = fs.createReadStream(this.settings.logfile, { start: this._pos, end: st.size - 1, encoding: 'utf8' });
      let buf = '';
      stream.on('data', (c) => { buf += c; });
      stream.on('error', () => this._scheduleNextPoll());
      stream.on('end', () => {
        this._pos = st.size;
        const lines = (this._partial + buf).split(/\r?\n/);
        this._partial = lines.pop();                    // hold back any incomplete final line
        for (const line of lines) { if (line.trim()) { try { this.handleLogChange(line); } catch (e) { this.emit('error', e); } } }
        // Advance durable cursor to the last fully consumed byte (exclude partial).
        if (this.settings.logfile) {
          const key = path.resolve(this.settings.logfile);
          this._logCursors[key] = { size: this._pos, mtimeMs: st.mtimeMs };
          this._markHistoryDirty();
        }
        this._scheduleNextPoll();
      });
    });
  }

  async replayLog (path) {
    return new Promise((resolve, reject) => {
      let count = 0;
      const rl = readline.createInterface({ input: fs.createReadStream(path), crlfDelay: Infinity });
      rl.on('line', (line) => { if (line.trim()) { this.handleLogChange(line); count++; } });
      rl.on('close', () => resolve(count));
      rl.on('error', reject);
    });
  }

  // ---- Discord (optional) ----
  _wireDiscord () {
    this.on('kill', (k) => { if (this.settings.discord.announceKills) this._discordKill(k); });
    this.on('player:join', (p) => { if (this.settings.discord.announcePlayerJoins) this._discordJoin(p); });
    this.on('activity', (a) => { if (this.settings.discord.announceActivities) this._discordActivity(a); });
    this.on('mission:objective', (m) => { if (this.settings.discord.announceMissions) this._discordMission(m); });
    this.on('combat:progress', (c) => { if (this.settings.discord.announceCombat) this._discordCombat(c); });
    this.on('player:incap', (i) => { if (this.settings.discord.announceIncaps) this._discordIncap(i); });
  }

  _discordIncap (i) {
    return this.postToDiscord({ embeds: [{ title: '🩸 Incapacitated', description: `${i.player || 'A pilot'} was downed`,
      color: 0x9B59B6, timestamp: new Date().toISOString() }] });
  }

  _discordMission (m) {
    return this.postToDiscord({ embeds: [{ title: '🎯 Objective', description: m.text || 'Objective updated',
      color: 0xF1C40F, timestamp: new Date().toISOString() }] });
  }
  _discordCombat (c) {
    return this.postToDiscord({ embeds: [{ title: '⚔️ Combat', description: c.text || 'Combat objective progressed',
      color: 0xE74C3C, timestamp: new Date().toISOString() }] });
  }

  _discordKill (k) {
    const who = (n, npc) => (npc ? `${n} (NPC)` : n);
    const title = k.involves === 'death' ? '💀 Death' : k.involves === 'kill' ? '⚔️ Kill' : '💀 Kill';
    return this.postToDiscord({ embeds: [{ title,
      description: `${who(k.killer, k.killerNpc)} killed ${who(k.victim, k.victimNpc)}`,
      fields: [
        { name: 'Weapon', value: k.weapon || 'Unknown', inline: true },
        { name: 'Zone', value: k.zone || 'Unknown', inline: true },
        { name: 'Type', value: k.damageType || 'Unknown', inline: true }
      ],
      color: k.involves === 'death' ? 0x992D22 : 0xFF0000, timestamp: new Date().toISOString() }] });
  }
  _discordJoin (p) {
    return this.postToDiscord({ embeds: [{ title: '👤 Player', description: `${p.name} logged in`, color: 0x0000FF, timestamp: new Date().toISOString() }] });
  }
  _discordActivity (a) {
    return this.postToDiscord({ embeds: [{ title: '🎮 Activity', description: a.kind, color: 0x00FF00, timestamp: new Date().toISOString() }] });
  }

  async postToDiscord (payload) {
    if (!this.settings.discord || !this.settings.discord.enable) return null;
    const channel = String(this.settings.discord.channel || '').trim();
    if (this.discordBot && this._discordBotReady && channel) {
      try {
        return await this.discordBot.postToChannel(channel, payload);
      } catch (e) {
        this.emit('error', e);
      }
    }
    if (!this.settings.discord.webhook) return null;
    if (typeof fetch !== 'function') return null;
    try {
      return await fetch(this.settings.discord.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      this.emit('error', e);
      return null;
    }
  }

  // ---- Fabric P2P peering (AMP/Message over TCP/NOISE) ----

  /**
   * Provide (or clear) the player's decrypted identity. While set, a local
   * Fabric Peer is started and log events are published as SCEventBatch.
   * Called by the Electron main process after unlock.
   * @param {Object|null} identity Decrypted identity ({ xprv, pubkey, … }) or null to lock.
   */
  setIdentity (identity) {
    this._identity = identity || null;
    // Serialize refresh/stop so stop() can await any in-flight transition.
    const prev = this._fabricTransition || Promise.resolve();
    this._fabricTransition = prev
      .then(() => (this._identity ? this._refreshFabric() : this._stopFabric()))
      .catch((e) => this.emit('error', e));
    if (this._identity) {
      try { this._flushPendingFederationInvites(); } catch (e) { this.emit('error', e); }
    }
  }

  /** @deprecated Use {@link #_fabricPeerAddresses}; kept for older tests. */
  _uplinkTargets () {
    return this._fabricPeerAddresses();
  }

  /**
   * Attach handlers to an external Fabric Peer (goon.vc Hub `agent`) so
   * MissionBroadcast / SCEventBatch / chat are ingested into this LiveRelay
   * and optionally re-relayed to other TCP peers.
   * @param {Object} peer Fabric Peer
   * @param {Object} [opts]
   * @param {boolean} [opts.relay]
   */
  attachFabricPeer (peer, { relay = true } = {}) {
    FabricNetwork.attachAppHandlers(peer, this._fabricIngestHandlers(), { relay });
    return this;
  }

  _fabricIngestHandlers () {
    const { resolveSignerPubkey, pubkeysMatch } = identityLib();
    /** Prefer declared actor when a star hop re-signed the outer frame. */
    const actorId = (source, actor) => {
      const claimed = actor && (actor.publicKey || actor.pubkey || actor.id);
      if (claimed) return String(claimed);
      return resolveSignerPubkey(source, actor);
    };
    return {
      onMissionCreated: (object, source, meta) => {
        const actor = meta && meta.msg && meta.msg.actor;
        const resolved = actorId(source, actor);
        if (!resolved) return;
        try {
          this._ingestMissionCreated(resolved, object || {});
          this.emit('ingest', { source: resolved, received: 1, created: 1, via: 'fabric' });
        } catch (e) { this.emit('error', e); }
      },
      onMissionBroadcast: (object, source, meta) => {
        const actor = meta && meta.msg && meta.msg.actor;
        const resolved = actorId(source, actor);
        if (!resolved) return;
        try {
          this._ingestMissionBroadcast(resolved, object || {});
          this.emit('ingest', { source: resolved, received: 1, created: 1, via: 'fabric' });
        } catch (e) { this.emit('error', e); }
      },
      onMissionClaim: (object, source, meta) => {
        const actor = meta && meta.msg && meta.msg.actor;
        const resolved = actorId(source, actor);
        if (!resolved) return;
        try {
          this._ingestMissionClaim(resolved, object || {});
          this.emit('ingest', { source: resolved, received: 1, created: 1, via: 'fabric', kind: 'MissionClaim' });
        } catch (e) { this.emit('error', e); }
      },
      onMissionClaimDecision: (object, source, meta) => {
        const actor = meta && meta.msg && meta.msg.actor;
        const resolved = actorId(source, actor);
        if (!resolved) return;
        try {
          this._ingestMissionClaimDecision(resolved, object || {});
          this.emit('ingest', { source: resolved, received: 1, created: 1, via: 'fabric', kind: 'MissionClaimDecision' });
        } catch (e) { this.emit('error', e); }
      },
      onEventBatch: (object, source, meta) => {
        const actor = meta && meta.msg && meta.msg.actor;
        const resolved = actorId(source, actor);
        if (!resolved || !object || !Array.isArray(object.events)) return;
        if (this.eventChain && eventChain.available) {
          try {
            eventChain.mergeBatch(this.eventChain, object.events, resolved);
          } catch (e) { this.emit('error', e); }
        }
        let created = 0;
        for (const ev of object.events) {
          if (!ev || !ev.collection) continue;
          try {
            const r = this._ingestEvent(resolved, ev.collection, ev.data || {});
            if (r && r.created) created += 1;
          } catch (e) { this.emit('error', e); }
        }
        this.emit('ingest', { source: resolved, received: object.events.length, created, via: 'fabric' });
        for (const p of this.peers) {
          if (p.enabled !== false) { p.lastSeen = new Date().toISOString(); p.lastError = null; }
        }
      },
      onGameStateSnapshot: (object, source, meta) => {
        const actor = meta && meta.msg && meta.msg.actor;
        const resolved = actorId(source, actor);
        if (!resolved || !object) return;
        try {
          const r = this.ingestGameStateSnapshot(resolved, object);
          this.emit('ingest', {
            source: resolved,
            received: 1,
            created: r.changed ? 1 : 0,
            via: 'fabric',
            kind: 'GameStateSnapshot'
          });
        } catch (e) { this.emit('error', e); }
      },
      onProposal: (payload, source) => {
        // Mission escrow / payout ContractProposals scoped to the GoonCitizen
        // contract. Transport only — the officer-validated register remains the
        // source of truth; observers can react to the signed proposal here.
        if (!payload) return;
        this.emit('mission:proposal', { payload, source: source || null, via: 'fabric' });
      },
      onChat: (msg, source) => {
        if (!this.chatManager || !msg) return;
        // First-class P2P_CHAT_MESSAGE: Peer emits `{ text }` + meta.signer.
        // Shared with Hub UI / Fabric TUI via fabricChatNormalize / fabricChatText.
        const { chatTextOf, chatActorIdOf } = require('../functions/fabricChatNormalize');
        const text = chatTextOf(msg);
        const author = chatActorIdOf(msg, { signer: source, defaultActorId: source })
          || source
          || null;
        if (!author || !String(text).trim()) return;
        const ts = new Date().toISOString();
        const handle = this._peerAliasByPubkey[author] || null;
        try {
          this.chatManager.ingest(author, {
            channel: 'global',
            body: String(text),
            author,
            handle,
            ts
          });
        } catch (e) {
          if (!/must match|unknown channel/i.test(e.message || '')) this.emit('error', e);
        }
      },
      onPeerAlias: (ev, source) => {
        const alias = ev && ev.alias != null ? String(ev.alias).trim().slice(0, 64) : '';
        const signer = (ev && ev.signer) || resolveSignerPubkey(source) || source || null;
        if (!alias || !signer) return;
        this._peerAliasByPubkey[signer] = alias;
        this._peerProfilesByPubkey[signer] = peerProfile.mergeRemoteProfile(
          this._peerProfilesByPubkey[signer],
          { pubkey: signer, nickname: alias, alias }
        );
        // Refresh handle on recent local chat rows from this author (best-effort).
        try {
          if (this.chatManager) {
            const all = this.chatManager.list('global', { limit: 200 });
            for (const m of all) {
              if (m && m.author === signer && m.handle !== alias) {
                m.handle = alias;
                this.store.put('chatmessages', m.id, m);
              }
            }
          }
        } catch (_) { /* ignore */ }
      },
      onPeerProfile: (object, source) => {
        const signer = resolveSignerPubkey(source) || source || null;
        if (!signer || !object) return;
        this._peerProfilesByPubkey[signer] = peerProfile.mergeRemoteProfile(
          this._peerProfilesByPubkey[signer],
          Object.assign({}, object, { pubkey: signer })
        );
        if (object.nickname) {
          const alias = String(object.nickname).trim().slice(0, 64);
          if (alias) this._peerAliasByPubkey[signer] = alias;
        }
      },
      onFleetShare: (object, source) => {
        try {
          this._ingestFleetShare(object, resolveSignerPubkey(source) || source || null);
        } catch (e) { this.emit('error', e); }
      },
      onPeerPresence: (object, source) => {
        const signer = resolveSignerPubkey(source) || source || null;
        if (!signer || !object) return;
        const merged = presence.mergeRemotePresence(
          this._peerPresenceByPubkey[signer],
          Object.assign({}, object, { pubkey: signer })
        );
        this._indexPeerPresence(signer, merged);
      },
      onDirectChat: (object, source, meta) => {
        if (!object) return;
        const ChatManager = require('../services/ChatManager');
        const author = resolveSignerPubkey(source) || source || null;
        if (!author) return;
        const channel = object.channel || ChatManager.dmChannelKey(object.peerA, object.peerB);
        if (!channel || !ChatManager.parseDmChannel(channel)) return;
        const me = this._identity && this._identity.pubkey;
        // Only keep DMs addressed to this node (or authored here).
        if (me && this.chatManager && !this.chatManager.canAccess(channel, me, { enforceMembership: true })) return;
        // Group invites also ride DirectChat so spoke↔spoke via a shared hub
        // still lands when CONTRACT_MESSAGE fan-out is flaky / peer offline briefly.
        const embedded = object.invite
          || (() => {
            try {
              const p = typeof object.body === 'string' ? JSON.parse(object.body) : null;
              return (p && p.type === 'FederationContractInvite') ? p : null;
            } catch (_) { return null; }
          })();
        if (embedded && embedded.type === 'FederationContractInvite') {
          try {
            this._ingestFederationInvite(embedded, author, meta || {});
          } catch (e) { this.emit('error', e); }
        }
        if (!this.chatManager || object.body == null || object.body === '') return;
        // Don't dump raw invite JSON into the DM transcript.
        let body = object.body;
        if (embedded && typeof body === 'string' && body.trim().charAt(0) === '{') {
          body = `Group invite: ${embedded.groupName || embedded.note || 'open Notifications to accept'}`;
        }
        try {
          this.chatManager.ingest(author, {
            channel,
            body,
            author: object.author || author,
            handle: object.handle || this._peerAliasByPubkey[author] || null,
            ts: object.ts || new Date().toISOString(),
            attachment: object.attachment || null
          });
        } catch (e) {
          if (!/must match|unknown channel|invalid/i.test(e.message || '')) this.emit('error', e);
        }
      },
      onPeeringCandidate: (ev) => {
        if (!ev || !Array.isArray(ev.addresses)) return;
        this._considerDiscoveredPeers(ev.addresses, ev.kind || 'gossip', {
          pubkey: ev.pubkey || null,
          peering: ev.peering || null
        });
      },
      isKnownGroupContract: (id) => !!(this.groupManager && this.groupManager.getGroupByContractId(id)),
      onGroupContractPublish: (object, source) => {
        if (!this.groupManager || !object) return;
        try {
          this.groupManager.ingestContractPublish(object, resolveSignerPubkey(source) || source);
          if (this.fabricNetwork) {
            const { groupContractId } = require('../contracts/gooncitizenGroup');
            this.fabricNetwork.setGroupContractKnown(groupContractId(object), true);
          }
        } catch (e) { this.emit('error', e); }
      },
      onGroupChat: (object, source, meta) => {
        if (!this.chatManager || !this.groupManager || !object) return;
        const contractId = (meta && meta.contract) || object.contractId;
        const group = (contractId && this.groupManager.getGroupByContractId(contractId))
          || (object.groupId && this.groupManager.getGroup(object.groupId));
        if (!group) return;
        const me = this._identity && this._identity.pubkey;
        if (me && !this.groupManager.isInGroupTree(group.id, me) && this.settings.mode !== 'server') return;
        const author = object.author || resolveSignerPubkey(source) || source;
        const ts = object.ts || new Date().toISOString();
        let body = object.body != null ? object.body : object.content;
        const {
          isSealedGroupChat,
          isParticipantSealedGroupChat,
          openGroupChatBody
        } = require('../functions/groupChatSeal');
        if (isSealedGroupChat(object)) {
          try {
            if (isParticipantSealedGroupChat(object.seal)) {
              if (!this._identity) throw new Error('identity required to open participant seal');
              const { keyFromIdentity } = require('../functions/identity');
              body = openGroupChatBody(object.seal, {
                keyOrPrivate: keyFromIdentity(this._identity),
                pubkey: this._identity.pubkey
              });
            } else {
              const tip = this.groupManager.getChatSealTip(group.id);
              body = openGroupChatBody(object.seal, {
                contractId: tip.contractId,
                clock: object.seal.basisClock,
                stateDigest: object.seal.stateDigest,
                memberPubkeys: tip.memberPubkeys
              });
            }
          } catch (e) {
            this.emit('debug', `[GroupChat] seal open failed: ${e && e.message ? e.message : e}`);
            if (this._requireSealedGroupChat || body == null || body === '') return;
          }
        } else if (this._requireSealedGroupChat) {
          return;
        }
        if (!author || body == null || body === '') return;
        // Persist ChatMessage before ARC accumulate so wireHash can attach to the row.
        try {
          this.chatManager.ingest(author, {
            channel: `group:${group.id}`,
            body,
            author,
            handle: object.handle || null,
            ts,
            id: object.id || null,
            attachment: object.attachment || null
          });
        } catch (e) {
          if (!/must match|unknown channel/i.test(e.message || '')) this.emit('error', e);
        }
        if (contractId) {
          this._accumulateContractMessageWire(contractId, meta || {}, (meta && meta.origin) || 'mesh');
        }
      },
      onMessageReceipt: (object, source, meta) => {
        this._applyRemoteDeliveryAck(object, source, meta, 'MessageReceipt');
      },
      onMessageReceived: (object, source, meta) => {
        this._applyRemoteDeliveryAck(object, source, meta, 'MessageReceived');
      },
      onGroupChange: (object, source, meta) => {
        if (!this.groupManager || !object) return;
        try {
          const change = Object.assign({}, object, {
            contractId: object.contractId || (meta && meta.contract) || null
          });
          this.groupManager.ingestGroupChange(change, resolveSignerPubkey(source) || source);
          // Retain inbound GroupChange as a Fabric-message journal row when possible.
          const contractId = change.contractId;
          const entryId = change.id;
          const wire = meta && (meta.wireMessage || meta.msg);
          if (contractId && entryId && meta && meta.origin !== 'local') {
            // Wire hex may be on the peer event; best-effort from signed outbound path.
            if (wire && wire.hex) {
              this._attachJournalFabricMessage(contractId, entryId, {
                hash: wire.hash,
                toBuffer: () => Buffer.from(String(wire.hex), 'hex')
              }, 'GroupChange');
            }
          }
        } catch (e) { this.emit('error', e); }
      },
      onGroupChangeProposal: (object, source, meta) => {
        if (!this.groupManager || !object) return;
        try {
          const body = Object.assign({}, object, {
            contractId: object.contractId || (meta && meta.contract) || null
          });
          this.groupManager.ingestGroupChangeProposal(body, resolveSignerPubkey(source) || source);
          if (meta && meta.origin !== 'local') {
            this._accumulateContractMessageWire(
              body.contractId,
              meta || {},
              (meta && meta.origin) || 'mesh'
            );
          }
        } catch (e) { this.emit('error', e); }
      },
      onGroupChangeVote: (object, source, meta) => {
        if (!this.groupManager || !object) return;
        try {
          const body = Object.assign({}, object, {
            contractId: object.contractId || (meta && meta.contract) || null
          });
          this.groupManager.ingestGroupChangeVote(body, resolveSignerPubkey(source) || source);
          if (meta && meta.origin !== 'local') {
            this._accumulateContractMessageWire(
              body.contractId,
              meta || {},
              (meta && meta.origin) || 'mesh'
            );
          }
        } catch (e) { this.emit('error', e); }
      },
      onGroupJournalRequest: (object, source, meta) => {
        this._respondGroupJournalRequest(
          Object.assign({}, object || {}, {
            contractId: (object && object.contractId) || (meta && meta.contract) || null
          }),
          resolveSignerPubkey(source) || source
        ).catch((e) => this.emit('error', e));
      },
      onGroupJournalBatch: (object, source, meta) => {
        if (!this.groupManager || !object) return;
        try {
          const batch = Object.assign({}, object, {
            contractId: object.contractId || (meta && meta.contract) || null
          });
          this.groupManager.ingestJournalBatch(batch, resolveSignerPubkey(source) || source);
        } catch (e) { this.emit('error', e); }
      },
      onGroupStateJournal: (object, source, meta) => {
        if (!this.groupManager || !object) return;
        try {
          const { verifyGroupStateTip } = require('../functions/groupStateSigning');
          const contractId = object.contractId || (meta && meta.contract) || null;
          if (!contractId || !object.signatures) return;
          const group = this.groupManager.getGroupByContractId(contractId);
          if (!group) return;
          const ok = verifyGroupStateTip(
            group,
            contractId,
            object.tipClock,
            object.stateDigest,
            object.signatures
          );
          if (ok) this.emit('group:state-tip', { contractId, object, source, verified: true });
        } catch (e) { this.emit('error', e); }
      },
      onGroupShare: (object, source, meta) => {
        if (!object) return;
        const kind = object.kind || object['@type'];
        const inner = object.object != null ? object.object : object;
        const resolved = actorId(source, meta && meta.msg && meta.msg.actor)
          || resolveSignerPubkey(source)
          || source
          || null;
        try {
          if (kind === 'GroupOffer') {
            this._ingestGroupOffer(object, resolved, meta);
            return;
          }
          if (kind === 'NoteShare' || kind === 'NoteUpdate' ||
            (inner && (inner.type === 'NoteShare' || inner.type === 'NoteUpdate' ||
              inner['@type'] === 'NoteShare' || inner['@type'] === 'NoteUpdate'))) {
            try {
              this._ingestNoteShare(inner || object, resolved, meta);
            } catch (e) { this.emit('error', e); }
            return;
          }
          if (kind === 'MissionBroadcast' || (inner && inner.mission)) {
            if (!resolved) return;
            this._ingestMissionBroadcast(resolved, inner);
          }
          if (kind === starjumpFleet.FLEET_SHARE_TYPE ||
            (inner && (inner.kind === starjumpFleet.FLEET_SHARE_TYPE || inner.type === starjumpFleet.FLEET_SHARE_TYPE))) {
            const fleetObj = inner && inner.kind === starjumpFleet.FLEET_SHARE_TYPE ? inner : (inner || object);
            this._ingestFleetShare(fleetObj, resolved);
            // Journal into the group Statechain when we know the group contract.
            try {
              const contractId = (meta && meta.contract) || (object && object.contract);
              const group = contractId && this.groupManager
                ? this.groupManager.getGroupByContractId(contractId)
                : null;
              if (group) this.groupManager.ingestFleetShare(group.id, fleetObj, resolved);
            } catch (e) {
              this.emit('warning', '[LiveRelay] inbound FleetShare journal failed:', e && e.message);
            }
          }
          if (kind === presence.PRESENCE_TYPE ||
            (inner && (inner.kind === presence.PRESENCE_TYPE || inner.type === presence.PRESENCE_TYPE))) {
            const doc = inner && inner.kind === presence.PRESENCE_TYPE ? inner : (inner || object);
            if (resolved && doc) {
              this._indexPeerPresence(resolved, presence.mergeRemotePresence(
                this._peerPresenceByPubkey[resolved],
                Object.assign({}, doc, { pubkey: resolved })
              ));
            }
          }
        } catch (e) { this.emit('error', e); }
      },
      onGroupActivityTree: (object, source, meta) => {
        if (!this.groupManager || !object) return;
        try {
          const contractId = (meta && meta.contract) || object.contractId;
          const group = (contractId && this.groupManager.getGroupByContractId(contractId))
            || (object.groupId && this.groupManager.getGroup(object.groupId));
          if (!group) return;
          this.groupManager.ingestActivityTree(
            group.id,
            object,
            resolveSignerPubkey(source) || object.ownerPubkey || source
          );
        } catch (e) { this.emit('error', e); }
      },
      onFederationInvite: (object, source, meta) => {
        try {
          this._ingestFederationInvite(object, resolveSignerPubkey(source) || source, meta);
        } catch (e) { this.emit('error', e); }
      },
      onFederationInviteResponse: (object, source, meta) => {
        try {
          this._ingestFederationInviteResponse(object, resolveSignerPubkey(source) || source, meta);
        } catch (e) { this.emit('error', e); }
      },
      onDiscordRequest: (object, source, meta) => {
        try {
          this._ingestDiscordCoordFrame(discordContract.DISCORD_REQUEST, object, resolveSignerPubkey(source) || source, meta);
          // Remote (or echoed) requests: try claim if we can reply.
          if (meta && meta.origin !== 'local') {
            this._maybeClaimDiscordRequest(object, { localOrigin: false }).catch((e) => this.emit('error', e));
          }
        } catch (e) { this.emit('error', e); }
      },
      onDiscordClaim: (object, source, meta) => {
        try {
          this._ingestDiscordCoordFrame(discordContract.DISCORD_CLAIM, object, resolveSignerPubkey(source) || source, meta);
          const id = object && object.requestId;
          if (!id) return;
          const pending = this._discordClaimPending.get(String(id));
          if (!pending) return;
          const win = this._discordCoord.getWinningClaim(String(id));
          const me = this._identity && this._identity.pubkey;
          if (win && me && String(win.claimantPubkey) !== String(me)) {
            if (pending.settleTimer) clearTimeout(pending.settleTimer);
            this._discordClaimPending.delete(String(id));
          }
        } catch (e) { this.emit('error', e); }
      },
      onDiscordResponse: (object, source, meta) => {
        try {
          this._ingestDiscordCoordFrame(discordContract.DISCORD_RESPONSE, object, resolveSignerPubkey(source) || source, meta);
          const id = object && object.requestId;
          if (id) this._discordClaimPending.delete(String(id));
        } catch (e) { this.emit('error', e); }
      },
      onLookupRequest: (object, source, meta) => {
        try {
          this._ingestLookupCoordFrame(chatLookup.LOOKUP_REQUEST, object, resolveSignerPubkey(source) || source, meta);
          // Remotes race on LookupRequest only (do not re-parse chat text).
          if (meta && meta.origin !== 'local') {
            this._maybeClaimLookupRequest(object, { localOrigin: false }).catch((e) => this.emit('error', e));
          }
        } catch (e) { this.emit('error', e); }
      },
      onLookupClaim: (object, source, meta) => {
        try {
          this._ingestLookupCoordFrame(chatLookup.LOOKUP_CLAIM, object, resolveSignerPubkey(source) || source, meta);
          const id = object && object.requestId;
          if (!id) return;
          const pending = this._lookupClaimPending.get(String(id));
          if (!pending) return;
          const win = this._lookupCoord.getWinningClaim(String(id));
          const me = this._identity && this._identity.pubkey;
          if (win && me && String(win.claimantPubkey) !== String(me)) {
            if (pending.settleTimer) clearTimeout(pending.settleTimer);
            this._lookupClaimPending.delete(String(id));
          }
        } catch (e) { this.emit('error', e); }
      },
      onLookupResponse: (object, source, meta) => {
        try {
          this._ingestLookupCoordFrame(chatLookup.LOOKUP_RESPONSE, object, resolveSignerPubkey(source) || source, meta);
          const id = object && object.requestId;
          if (id) this._lookupClaimPending.delete(String(id));
        } catch (e) { this.emit('error', e); }
      },
      onNoteShare: (object, source, meta) => {
        try {
          this._ingestNoteShare(object, resolveSignerPubkey(source) || source, meta);
        } catch (e) { this.emit('error', e); }
      },
      onNoteUpdate: (object, source, meta) => {
        try {
          this._ingestNoteShare(object, resolveSignerPubkey(source) || source, meta);
        } catch (e) { this.emit('error', e); }
      },
      onGroupDataShare: (object, source, meta) => {
        try {
          this._ingestGroupDataShare(object, resolveSignerPubkey(source) || source, meta);
        } catch (e) { this.emit('error', e); }
      },
      onDiscordCatalogShare: (object, source, meta) => {
        try {
          this._ingestDiscordCatalogShare(object, resolveSignerPubkey(source) || source, meta);
        } catch (e) { this.emit('error', e); }
      },
      onIdentityCrossSign: (object, source, meta) => {
        try {
          this._ingestIdentityCrossSign(object, resolveSignerPubkey(source) || source, meta);
        } catch (e) { this.emit('error', e); }
      },
      onDeviceDataShare: (object, source, meta) => {
        try {
          this._ingestDeviceDataShare(object, resolveSignerPubkey(source) || source);
        } catch (e) { this.emit('error', e); }
      },
      onInventoryRequest: (ev) => {
        try { this._onDocumentInventoryRequest(ev); } catch (e) { this.emit('error', e); }
      },
      onInventoryResponse: (ev) => {
        try { this._onDocumentInventoryResponse(ev); } catch (e) { this.emit('error', e); }
      },
      onDocumentReceived: (ev) => {
        try { this._ingestClusterFileBytes(ev); } catch (e) { this.emit('error', e); }
      }
    };
  }

  // ---- Personal fleets (Starjump / FleetViewer) ---------------------------

  _fleetsDir () {
    return path.join(__dirname, '..', 'data', 'fleets');
  }

  listFleetSamples () {
    const dir = this._fleetsDir();
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch (_) { return []; }
    return names.map((name) => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        const ships = starjumpFleet.extractShips(raw);
        return {
          name,
          shipCount: ships.reduce((n, s) => n + (s.count || 1), 0),
          uniqueShips: ships.length,
          sourceType: raw.type || null
        };
      } catch (_) {
        return { name, shipCount: 0, uniqueShips: 0, sourceType: null };
      }
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * @param {Object} [opts]
   * @param {string} [opts.scope] `'all'` | `'mine'` | `'shared'` | `'public'`
   */
  listFleets (opts = {}) {
    const me = this._identity && this._identity.pubkey;
    const scope = String(opts.scope || 'all');
    let rows = (this.registerStore ? this.registerStore.all('fleets') : []).map((f) => starjumpFleet.summarizeFleet(f)).filter(Boolean);
    if (scope === 'mine') rows = rows.filter((f) => me && f.ownerPubkey === me && !f.remote);
    else if (scope === 'shared') rows = rows.filter((f) => f.remote || (f.visibility && f.visibility !== 'private'));
    else if (scope === 'public') rows = rows.filter((f) => f.visibility === 'public');
    rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return rows;
  }

  getFleet (id, { includeExport = false } = {}) {
    if (!this.registerStore || !id) return null;
    const fleet = this.registerStore.get('fleets', id);
    if (!fleet) return null;
    const summary = starjumpFleet.summarizeFleet(fleet);
    if (includeExport && fleet.export) summary.export = fleet.export;
    return summary;
  }

  /**
   * Create an empty or pre-filled custom fleet (editable roster).
   * @param {Object} data
   * @param {string} [data.name]
   * @param {object[]} [data.ships]
   * @param {string} [data.visibility]
   * @param {string[]} [data.groupIds]
   */
  createFleet (data = {}) {
    if (!this.registerStore) {
      const e = new Error('store unavailable'); e.code = 'UNAVAILABLE'; throw e;
    }
    const owner = this._identity && this._identity.pubkey;
    const fleet = starjumpFleet.createCustomFleet({
      name: data.name,
      ships: Array.isArray(data.ships) ? data.ships : [],
      ownerPubkey: owner || null,
      visibility: data.visibility || 'private',
      groupIds: data.groupIds
    });
    this.registerStore.put('fleets', fleet.id, fleet);
    this.emit('fleet:created', starjumpFleet.summarizeFleet(fleet));
    return fleet;
  }

  /**
   * Import from JSON body, filesystem path, or bundled sample name.
   * @param {Object} data
   * @param {object|string} [data.json]
   * @param {string} [data.path]
   * @param {string} [data.sample]
   * @param {string} [data.name]
   * @param {string} [data.visibility]
   */
  importFleet (data = {}) {
    let raw = data.json != null ? data.json : null;
    let sourceFile = data.sourceFile || null;
    if (!raw && data.sample) {
      const name = path.basename(String(data.sample));
      if (!name.endsWith('.json') || name.includes('..')) {
        const e = new Error('invalid sample name'); e.code = 'INVALID_SAMPLE'; throw e;
      }
      const file = path.join(this._fleetsDir(), name);
      if (!fs.existsSync(file)) {
        const e = new Error('sample not found'); e.code = 'NOT_FOUND'; throw e;
      }
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      sourceFile = name;
    }
    if (!raw && data.path) {
      const file = path.resolve(String(data.path));
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        const e = new Error('file not found'); e.code = 'NOT_FOUND'; throw e;
      }
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      sourceFile = path.basename(file);
    }
    if (raw == null) {
      const e = new Error('json, path, or sample required'); e.code = 'INVALID'; throw e;
    }
    if (!this.registerStore) {
      const e = new Error('store unavailable'); e.code = 'UNAVAILABLE'; throw e;
    }
    const owner = this._identity && this._identity.pubkey;
    const fleet = starjumpFleet.parseStarjumpExport(raw, {
      name: data.name,
      ownerPubkey: owner || null,
      sourceFile,
      visibility: data.visibility || 'private',
      keepExport: true
    });
    // Prefer stable id per owner+ships; overwrite prior import of same roster.
    this.registerStore.put('fleets', fleet.id, fleet);
    this.emit('fleet:imported', starjumpFleet.summarizeFleet(fleet));
    return fleet;
  }

  updateFleet (id, patch = {}) {
    if (!this.registerStore) {
      const e = new Error('store unavailable'); e.code = 'UNAVAILABLE'; throw e;
    }
    const fleet = this.registerStore.get('fleets', id);
    if (!fleet) {
      const e = new Error('Fleet not found'); e.code = 'NOT_FOUND'; throw e;
    }
    const me = this._identity && this._identity.pubkey;
    if (fleet.remote && fleet.ownerPubkey && me && fleet.ownerPubkey !== me) {
      const e = new Error('cannot edit a peer fleet'); e.code = 'FORBIDDEN'; throw e;
    }
    if (patch.name !== undefined) {
      const name = starjumpFleet.sanitizeName(patch.name);
      if (name) fleet.name = name;
    }
    if (patch.visibility !== undefined) {
      fleet.visibility = starjumpFleet.sanitizeVisibility(patch.visibility);
    }
    if (Array.isArray(patch.groupIds)) {
      fleet.groupIds = patch.groupIds.map(String).filter(Boolean);
    }
    if (Array.isArray(patch.ships)) {
      starjumpFleet.setFleetShips(fleet, patch.ships, { replace: true });
    }
    fleet.updatedAt = new Date().toISOString();
    this.registerStore.put('fleets', fleet.id, fleet);
    return fleet;
  }

  /**
   * Add, set count, or remove a ship on a fleet.
   * Body: `{Object}` or `{ ships: [...] }` to replace.
   */
  updateFleetShips (id, op = {}) {
    if (!this.registerStore) {
      const e = new Error('store unavailable'); e.code = 'UNAVAILABLE'; throw e;
    }
    const fleet = this.registerStore.get('fleets', id);
    if (!fleet) {
      const e = new Error('Fleet not found'); e.code = 'NOT_FOUND'; throw e;
    }
    const me = this._identity && this._identity.pubkey;
    if (fleet.remote && fleet.ownerPubkey && me && fleet.ownerPubkey !== me) {
      const e = new Error('cannot edit a peer fleet'); e.code = 'FORBIDDEN'; throw e;
    }
    if (Array.isArray(op.ships)) {
      starjumpFleet.setFleetShips(fleet, op.ships, { replace: true });
    } else {
      starjumpFleet.applyShipOp(fleet, op);
    }
    this.registerStore.put('fleets', fleet.id, fleet);
    return fleet;
  }

  deleteFleet (id) {
    if (!this.registerStore || !id) return false;
    return this.registerStore.del('fleets', id);
  }

  _ingestFleetShare (object, sourcePubkey) {
    if (!this.registerStore || !object) return null;
    const fleet = starjumpFleet.fleetFromShareObject(object, sourcePubkey);
    const prev = this.registerStore.get('fleets', fleet.id);
    if (prev && !prev.remote && prev.ownerPubkey && prev.ownerPubkey === fleet.ownerPubkey) {
      // Do not clobber our own local export with a peer echo.
      return prev;
    }
    this.registerStore.put('fleets', fleet.id, fleet);
    this.emit('fleet:shared', starjumpFleet.summarizeFleet(fleet));
    return fleet;
  }

  /**
   * Fleets folded into a group's Statechain (latest FleetShare tip per fleetId).
   * @param {string} groupIdOrSlug
   * @returns {object[]}
   */
  listGroupFleets (groupIdOrSlug) {
    if (!this.groupManager) return [];
    const group = this.groupManager.findGroup(groupIdOrSlug) || this.groupManager.getGroup(groupIdOrSlug);
    if (!group || !group.contractId || !this.registerStore) return [];
    const groupStatechain = require('../functions/groupStatechain');
    const doc = groupStatechain.loadDoc(this.registerStore, group.contractId);
    const map = (doc && doc.content && doc.content.fleets) || {};
    return Object.keys(map).sort().map((id) => map[id]);
  }

  /**
   * Share a fleet to peers, groups, and/or public mesh.
   * @param {string} id
   * @param {Object} [opts]
   * @param {string} [opts.visibility]
   * @param {string[]} [opts.groupIds]
   * @param {boolean} [opts.includeExport]
   * @param {boolean} [opts.relay]
   */
  async shareFleet (id, opts = {}) {
    if (!this.registerStore) {
      const e = new Error('store unavailable'); e.code = 'UNAVAILABLE'; throw e;
    }
    const fleet = this.registerStore.get('fleets', id);
    if (!fleet) {
      const e = new Error('Fleet not found'); e.code = 'NOT_FOUND'; throw e;
    }
    const me = this._identity && this._identity.pubkey;
    if (!me) {
      const e = new Error('Unlock your identity to share fleets'); e.code = 'LOCKED'; throw e;
    }
    if (fleet.remote && fleet.ownerPubkey && fleet.ownerPubkey !== me) {
      const e = new Error('cannot re-share a peer fleet from this UI yet'); e.code = 'FORBIDDEN'; throw e;
    }
    if (!fleet.ownerPubkey) fleet.ownerPubkey = me;

    const visibility = starjumpFleet.sanitizeVisibility(opts.visibility || fleet.visibility || 'peers');
    let groupIds = Array.isArray(opts.groupIds) ? opts.groupIds.map(String).filter(Boolean) : (fleet.groupIds || []);
    // Require an explicit group list for visibility "groups" (no implicit fan-out to every membership).
    if (visibility === 'groups' && !groupIds.length) {
      const e = new Error('Select at least one group to share into');
      e.code = 'BAD_REQUEST';
      throw e;
    }
    fleet.visibility = visibility;
    fleet.groupIds = groupIds;
    fleet.sharedAt = new Date().toISOString();
    fleet.updatedAt = fleet.sharedAt;
    this.registerStore.put('fleets', fleet.id, fleet);

    const shareObject = starjumpFleet.buildFleetShareObject(fleet, {
      includeExport: opts.includeExport !== false
    });
    const published = { peers: false, groups: [], public: false };

    if (visibility === 'private') {
      return { fleet: starjumpFleet.summarizeFleet(fleet), published, share: shareObject };
    }

    await this._ensureFabric().catch(() => null);
    if (!this.fabricNetwork || !this.fabricNetwork.ready) {
      const e = new Error('Fabric peer not ready — unlock identity and wait for peering');
      e.code = 'NOT_READY';
      throw e;
    }

    if (visibility === 'peers' || visibility === 'public') {
      this.fabricNetwork.publishFleetShare(shareObject);
      published.peers = true;
      if (visibility === 'public') published.public = true;
    }

    if (visibility === 'groups' || (groupIds.length && visibility === 'public')) {
      for (const groupId of groupIds) {
        const group = this.groupManager && this.groupManager.getGroup(groupId);
        if (!group) continue;
        if (!group.includes(me)) continue;
        const contractId = group.contractId || null;
        if (!contractId) continue;
        this.fabricNetwork.publishGroupShare(contractId, {
          kind: starjumpFleet.FLEET_SHARE_TYPE,
          object: shareObject
        });
        try {
          this.groupManager.ingestFleetShare(groupId, shareObject, me);
        } catch (e) {
          this.emit('warning', '[LiveRelay] journal FleetShare failed:', e && e.message);
        }
        published.groups.push(groupId);
      }
    }

    return { fleet: starjumpFleet.summarizeFleet(fleet), published, share: shareObject };
  }

  _updateDetectedShipFromEvent (ev) {
    if (!ev || !ev.kind) return;
    const at = ev.timestamp || this._lastLogEventAt || new Date().toISOString();
    // Quantum travel lines carry the vehicle currently under local control.
    if (ev.kind && ev.kind.indexOf('quantum:') === 0 && ev.vehicle) {
      this._detectedShip = presence.buildDetectedShip(ev.vehicle, ev.vehicleId, at);
      return;
    }
    // ClearDriver = just left the seat — still the last piloted ship (keep for presence).
    if (ev.kind === 'vehicle:control' && ev.vehicle) {
      this._detectedShip = presence.buildDetectedShip(ev.vehicle, ev.vehicleId, at);
    }
  }

  _updateDetectedPlacesFromEvent (ev) {
    if (!ev || !ev.kind) return;
    const at = ev.timestamp || this._lastLogEventAt || new Date().toISOString();
    const kind = String(ev.kind);
    if (kind === 'quantum:select' && ev.destination) {
      this._detectedDestination = presence.buildDetectedPlace(ev.destination, at);
      this._foldLocalPlaceReports(ev);
      return;
    }
    if (kind === 'quantum:route') {
      if (ev.origin) this._detectedLocation = presence.buildDetectedPlace(ev.origin, at);
      if (ev.destination) this._detectedDestination = presence.buildDetectedPlace(ev.destination, at);
      this._foldLocalPlaceReports(ev);
      return;
    }
    if (kind === 'quantum:arrive') {
      const landed = ev.destination ||
        (this._detectedDestination &&
          (this._detectedDestination.token || this._detectedDestination.slug || this._detectedDestination.name));
      if (landed) this._detectedLocation = presence.buildDetectedPlace(landed, at);
      this._detectedDestination = null;
    }
    this._foldLocalPlaceReports(ev);
  }

  _buildPresenceDocument () {
    return presence.buildPresenceDocument({
      pubkey: this._identity ? this._identity.pubkey : null,
      nickname: this._nickname,
      lastEventAt: this._lastLogEventAt,
      detectedShip: this._detectedShip,
      shipOverride: this._shipOverride,
      detectedLocation: this._detectedLocation,
      locationOverride: this._locationOverride,
      detectedDestination: this._detectedDestination,
      destinationOverride: this._destinationOverride,
      visibility: this._presenceVisibility,
      groupIds: this._presenceGroupIds,
      availability: this._presenceAvailability,
      statusText: this._presenceStatusText
    });
  }

  getPresenceStatus () {
    const doc = this._buildPresenceDocument();
    return {
      presence: doc,
      settings: {
        sharePresence: this._sharePresence,
        presenceVisibility: this._presenceVisibility,
        presenceGroupIds: this._presenceGroupIds.slice(),
        shipOverrideSlug: this._shipOverrideSlug,
        locationOverrideSlug: this._locationOverrideSlug,
        destinationOverrideSlug: this._destinationOverrideSlug,
        presenceAvailability: this._presenceAvailability,
        presenceStatusText: this._presenceStatusText
      },
      detectedShip: this._detectedShip,
      shipOverride: this._shipOverride,
      detectedLocation: this._detectedLocation,
      locationOverride: this._locationOverride,
      detectedDestination: this._detectedDestination,
      destinationOverride: this._destinationOverride,
      online: doc.online,
      lastEventAt: this._lastLogEventAt
    };
  }

  /**
   * Cache PeerPresence under compressed + x-only forms so group member keys match.
   * @param {string} pubkey
   * @param {object} doc
   * @private
   */
  _indexPeerPresence (pubkey, doc) {
    if (!pubkey || !doc) return;
    const key = String(pubkey);
    this._peerPresenceByPubkey[key] = doc;
    try {
      const { pubkeyXOnly } = identityLib();
      const x = pubkeyXOnly(key);
      if (x && String(x).toLowerCase() !== key.toLowerCase()) {
        this._peerPresenceByPubkey[x] = doc;
      }
    } catch (_) { /* ignore */ }
    try {
      locationReports.foldPresence(this.registerStore, pubkey, doc);
    } catch (_) { /* ignore */ }
  }

  /**
   * Cached PeerPresence keyed by pubkey (includes self when sharing).
   * Remote entries are only those received while peers opted into sharePresence.
   */
  getPresenceRoster () {
    const out = Object.create(null);
    const { pubkeysMatch } = identityLib();
    for (const [pubkey, doc] of Object.entries(this._peerPresenceByPubkey || {})) {
      if (!pubkey || !doc) continue;
      // Prefer a single canonical entry when both compressed + x-only are indexed.
      let skip = false;
      for (const existing of Object.keys(out)) {
        if (pubkeysMatch(existing, pubkey)) {
          skip = true;
          break;
        }
      }
      if (skip) continue;
      out[pubkey] = {
        // Trust published online (supports force online/offline).
        online: doc.online === true,
        statusText: doc.statusText || null,
        lastEventAt: doc.lastEventAt || null,
        ship: presence.enrichShipMeta(doc.ship || null),
        location: presence.enrichPlaceMeta(doc.location || null),
        destination: presence.enrichPlaceMeta(doc.destination || null),
        nickname: doc.nickname || null,
        updatedAt: doc.updatedAt || doc.lastSeen || null
      };
    }
    const me = this._identity && this._identity.pubkey;
    if (me) {
      const local = this._buildPresenceDocument();
      // Replace any remote-indexed self row with live local presence.
      for (const key of Object.keys(out)) {
        if (pubkeysMatch(key, me)) delete out[key];
      }
      out[me] = {
        online: local.online,
        statusText: local.statusText || null,
        lastEventAt: local.lastEventAt,
        ship: presence.enrichShipMeta(local.ship),
        location: presence.enrichPlaceMeta(local.location),
        destination: presence.enrichPlaceMeta(local.destination),
        nickname: local.nickname,
        updatedAt: local.updatedAt,
        sharing: this._sharePresence === true,
        visibility: this._presenceVisibility,
        availability: this._presenceAvailability
      };
    }
    return out;
  }

  /**
   * Primary-group overlay payload: members + PeerPresence ships for the HUD.
   * Local desktop HUD — always returns the roster for the configured primary
   * group (no membership hard-gate). Optional warning when the unlocked
   * identity is not on the roster.
   * @returns {object}
   */
  getPrimaryGroupOverlay () {
    const groupId = this._primaryGroupId || null;
    const overlayEnabled = this._groupOverlay === true;
    if (!groupId || !this.groupManager) {
      return { groupId: null, name: null, members: [], overlayEnabled };
    }
    const group = this.groupManager.getGroup(groupId);
    if (!group) {
      return { groupId, name: null, members: [], overlayEnabled, error: 'primary group not found' };
    }

    const { pubkeysMatch, pubkeyXOnly } = identityLib();
    const me = this._identity && this._identity.pubkey;
    const memberOfPrimary = !!(me && (
      group.includes(me) ||
      (typeof this.groupManager.isInGroupTree === 'function' &&
        this.groupManager.isInGroupTree(groupId, me))
    ));
    // Soft signal only — never blank the HUD over a membership mismatch.
    const warning = (me && !memberOfPrimary)
      ? 'local identity is not listed on this primary group (showing roster anyway)'
      : null;

    const roster = this.getPresenceRoster();
    const presenceFor = (pk) => {
      if (roster[pk]) return roster[pk];
      for (const [key, row] of Object.entries(roster)) {
        if (pubkeysMatch(key, pk)) return row;
      }
      try {
        const x = pubkeyXOnly(pk);
        if (x && roster[x]) return roster[x];
      } catch (_) { /* ignore */ }
      return null;
    };

    // Fabric-connected peers count as online when presence is missing/stale.
    const connected = new Set();
    try {
      for (const p of this._peersWithStatus()) {
        if (!p || !p.pubkey) continue;
        if (p.status === 'connected' || p.connected === true) {
          connected.add(String(p.pubkey).toLowerCase());
          try {
            const x = pubkeyXOnly(p.pubkey);
            if (x) connected.add(String(x).toLowerCase());
          } catch (_) { /* ignore */ }
        }
      }
    } catch (_) { /* ignore */ }

    const aliasFor = (pk) => {
      if (this._peerAliasByPubkey && this._peerAliasByPubkey[pk]) {
        return this._peerAliasByPubkey[pk];
      }
      for (const [key, alias] of Object.entries(this._peerAliasByPubkey || {})) {
        if (alias && pubkeysMatch(key, pk)) return alias;
      }
      return null;
    };

    const members = (group.members || []).map((pk) => {
      const p = presenceFor(pk);
      let online = !!(p && p.online);
      if (!online) {
        const pkL = String(pk).toLowerCase();
        if (connected.has(pkL)) online = true;
        else {
          try {
            const x = pubkeyXOnly(pk);
            if (x && connected.has(String(x).toLowerCase())) online = true;
          } catch (_) { /* ignore */ }
        }
      }
      // Self: prefer live local presence (already in roster) — keep online accurate.
      if (me && pubkeysMatch(me, pk) && p) online = p.online === true;

      const ship = presence.enrichShipMeta((p && p.ship) || null);
      const location = presence.enrichPlaceMeta((p && p.location) || null);
      const destination = presence.enrichPlaceMeta((p && p.destination) || null);
      return {
        pubkey: pk,
        nickname: (p && p.nickname) || aliasFor(pk) || null,
        online,
        ship,
        shipType: (ship && ship.type) || null,
        location,
        destination,
        statusText: (p && p.statusText) || null,
        lastEventAt: (p && p.lastEventAt) || null,
        connected: connected.has(String(pk).toLowerCase())
      };
    });
    members.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      const an = String(a.nickname || a.pubkey).toLowerCase();
      const bn = String(b.nickname || b.pubkey).toLowerCase();
      return an < bn ? -1 : an > bn ? 1 : 0;
    });
    const owner = groupPresence.isGroupOwner(group, me);
    const memberRoster = Object.create(null);
    for (const row of members) {
      if (row && row.pubkey) memberRoster[row.pubkey] = row;
    }
    const composition = owner
      ? groupPresence.summarizeOnlineMembers(group.members || [], memberRoster)
      : null;
    let map = null;
    if (owner && composition) {
      const system = groupPresence.majoritySystem(composition.members.filter((m) => m.online));
      map = starmapLayout.layoutSystem(system, {
        includeHotspots: true,
        members: composition.members.filter((m) => m.online)
      });
    }
    return {
      groupId: group.id,
      name: group.name,
      members,
      overlayEnabled,
      memberOfPrimary,
      owner,
      composition,
      map,
      warning: warning || undefined
    };
  }

  /**
   * Update presence share settings (persisted to Fabric Store when available).
   */
  setPresenceSettings (patch = {}) {
    if (!this.registerStore) {
      const e = new Error('store unavailable'); e.code = 'UNAVAILABLE'; throw e;
    }
    const next = presence.sanitizePresenceShare(Object.assign({
      sharePresence: this._sharePresence,
      presenceVisibility: this._presenceVisibility,
      presenceGroupIds: this._presenceGroupIds,
      shipOverrideSlug: this._shipOverrideSlug,
      locationOverrideSlug: this._locationOverrideSlug,
      destinationOverrideSlug: this._destinationOverrideSlug,
      presenceAvailability: this._presenceAvailability,
      presenceStatusText: this._presenceStatusText
    }, patch));
    settingsStore.putSetting(this.registerStore, 'sharePresence', next.sharePresence);
    settingsStore.putSetting(this.registerStore, 'presenceVisibility', next.presenceVisibility);
    settingsStore.putSetting(this.registerStore, 'presenceGroupIds', next.presenceGroupIds.length ? next.presenceGroupIds : null);
    settingsStore.putSetting(this.registerStore, 'shipOverrideSlug', next.shipOverrideSlug);
    settingsStore.putSetting(this.registerStore, 'locationOverrideSlug', next.locationOverrideSlug);
    settingsStore.putSetting(this.registerStore, 'destinationOverrideSlug', next.destinationOverrideSlug);
    settingsStore.putSetting(this.registerStore, 'presenceAvailability', next.presenceAvailability);
    settingsStore.putSetting(this.registerStore, 'presenceStatusText', next.presenceStatusText);
    this._applyPresenceSettings(next);
    if (this._sharePresence) {
      this.publishPresence().catch((e) => this.emit('error', e));
    }
    return this.getPresenceStatus();
  }

  /**
   * Manual current-ship override (`slug`), clear published ship
   * ({@link presence.SHIP_NONE_SLUG}), or autodetect (`null`).
   * @param {string|null} slug
   */
  setShipOverride (slug) {
    if (!this.registerStore) {
      const e = new Error('store unavailable'); e.code = 'UNAVAILABLE'; throw e;
    }
    const normalized = slug === undefined || slug === null || slug === ''
      ? null
      : presence.sanitizePresenceShare({ shipOverrideSlug: slug }).shipOverrideSlug;
    settingsStore.putSetting(this.registerStore, 'shipOverrideSlug', normalized);
    this._shipOverrideSlug = normalized;
    this._shipOverride = normalized ? presence.buildShipOverride(normalized) : null;
    if (this._sharePresence) {
      this.publishPresence().catch((e) => this.emit('error', e));
    }
    return this.getPresenceStatus();
  }

  /**
   * Publish PeerPresence to peers / groups per visibility settings.
   */
  async publishPresence () {
    if (!this._sharePresence) {
      return { presence: this.getPresenceStatus(), published: { peers: false, groups: [], public: false } };
    }
    const me = this._identity && this._identity.pubkey;
    if (!me) {
      const e = new Error('Unlock your identity to share presence'); e.code = 'LOCKED'; throw e;
    }

    const doc = this._buildPresenceDocument();
    if (me) {
      this._indexPeerPresence(me, presence.mergeRemotePresence(
        this._peerPresenceByPubkey[me],
        doc
      ));
    }

    const visibility = presence.sanitizeVisibility(this._presenceVisibility);
    let groupIds = this._presenceGroupIds.slice();
    if (visibility === 'groups' && !groupIds.length && this.groupManager) {
      groupIds = (this.groupManager.groups || []).map((g) => g.id);
    }

    const shareObject = presence.buildPresenceShareObject(doc);
    const published = { peers: false, groups: [], public: false };

    if (visibility === 'private') {
      return { presence: this.getPresenceStatus(), published, share: shareObject };
    }

    await this._ensureFabric().catch(() => null);
    if (!this.fabricNetwork || !this.fabricNetwork.ready) {
      const e = new Error('Fabric peer not ready — unlock identity and wait for peering');
      e.code = 'NOT_READY';
      throw e;
    }

    if (visibility === 'peers' || visibility === 'public') {
      this.fabricNetwork.publishPeerPresence(shareObject);
      published.peers = true;
      if (visibility === 'public') published.public = true;
    }

    if (visibility === 'groups' || (groupIds.length && visibility === 'public')) {
      for (const groupId of groupIds) {
        const group = this.groupManager && this.groupManager.getGroup(groupId);
        if (!group) continue;
        if (!group.includes(me)) continue;
        const contractId = group.contractId || null;
        if (!contractId) continue;
        this.fabricNetwork.publishGroupShare(contractId, {
          kind: presence.PRESENCE_TYPE,
          object: shareObject
        });
        published.groups.push(groupId);
      }
    }

    this._lastPresencePublish = Date.now();
    return { presence: this.getPresenceStatus(), published, share: shareObject };
  }

  async _ensureFabric () {
    // Re-entrancy guard: _publishPeerAlias (and other callers) await this method.
    // Without coalescing, a sync path that schedules alias publish from inside
    // ensure re-enters ensure before any await yields → stack overflow.
    if (this._fabricEnsureInflight) return this._fabricEnsureInflight;
    this._fabricEnsureInflight = this._ensureFabricBody();
    try {
      return await this._fabricEnsureInflight;
    } finally {
      this._fabricEnsureInflight = null;
    }
  }

  async _ensureFabricBody () {
    if (this._stopping) return null;
    if (this.settings.fabric.enable === false) return null;
    if (!this._identity) return null;
    if (!this.fabricNetwork) {
      const peersDb = this.settings.fabric.peersDb != null
        ? this.settings.fabric.peersDb
        : FabricNetwork.peersDbPath(this.settings.settingsDir);
      this.fabricNetwork = new FabricNetwork({
        enable: true,
        listen: this.settings.fabric.listen !== false,
        port: this.settings.fabric.port || 7777,
        interface: this.settings.fabric.interface || '0.0.0.0',
        peers: this._fabricPeerAddresses(),
        peersDb,
        relayAppMessages: !!this.settings.fabric.relayAppMessages,
        reconnectToKnownPeers: false,
        advertiseHost: this._fabricAdvertiseHost || null,
        ownHosts: [...FabricNetwork.collectOwnFabricHosts({
          advertiseHost: this._fabricAdvertiseHost || null
        })],
        broadcastPeering: this._broadcastPeering === true,
        messageLog: this._fabricMessageLog
      });
      this.fabricNetwork.setHandlers(this._fabricIngestHandlers());
      this.fabricNetwork.on('error', (e) => this.emit('error', e));
      this.fabricNetwork.on('warning', (m) => {
        const s = (m && m.message) || String(m);
        if (/ECONNREFUSED|Socket timeout: connect|Socket error:|NOISE (encrypt|decrypt) error/i.test(s)) {
          this.emit('error', m instanceof Error ? m : new Error(s));
          return;
        }
        console.warn('[STAR-CITIZEN] fabric:', s);
      });
      this.fabricNetwork.on('connections:open', () => {
        try { this._dialStoredClusterPeers(); } catch (e) {
          this.emit('warning', '[LiveRelay] cluster dial: ' + (e && e.message));
        }
        try { this._pushClusterFiles(); } catch (e) {
          this.emit('warning', '[LiveRelay] cluster file push: ' + (e && e.message));
        }
        this._scheduleAccountDataReplay({ resetTries: true, nudge: true, delay: 400 });
        void this._nudgePendingCrossSigns();
      });
      this.fabricNetwork.on('peer:self', (ev) => {
        const addr = ev && ev.address
          ? FabricNetwork.normalizeFabricAddress(ev.address, { migrate: false })
          : null;
        if (!addr) return;
        const before = this.peers.length;
        this.peers = this.peers.filter((p) => p.address !== addr);
        if (this.peers.length !== before) {
          this._persistPeers();
          console.log(`[STAR-CITIZEN] dropped peer ${addr} after fabric self-session`);
          this._refreshFabric().catch((e) => this.emit('error', e));
        }
      });
    }
    this.fabricNetwork.setIdentity(this._identity);
    this.fabricNetwork.setAdvertiseHost(this._fabricAdvertiseHost || null);
    this.fabricNetwork.setBroadcastPeering(this._broadcastPeering === true);
    this.fabricNetwork.setPeers(this._fabricPeerAddresses());
    if (this.groupManager) {
      this.fabricNetwork.setKnownGroupContracts(this.groupManager.knownContractIds());
    }
    const starting = !this.fabricNetwork.peer;
    if (starting) await this.fabricNetwork.start();
    this._startFabricFlush();
    this._startHubObserveTimer();
    // Alias publish must never await _ensureFabric (ensure → alias → ensure overflow).
    // Only (re)announce when the peer just came up or the nickname changed.
    this._maybeSendPeerAlias();
    this._publishLocalProfile().catch((e) => this.emit('error', e));
    if (starting) {
      this._replayIdentityCrossSigns();
      void this._nudgePendingCrossSigns();
      this._scheduleAccountDataReplay();
      this._dialStoredClusterPeers();
      this._startClusterMeshTimer();
    }
    return this.fabricNetwork;
  }

  async _publishLocalProfile () {
    try {
      if (!this.fabricNetwork || !this.fabricNetwork.ready) return null;
      const doc = this._localProfile();
      // Always refresh self cache for inspect UI.
      if (doc.pubkey) {
        this._peerProfilesByPubkey[doc.pubkey] = peerProfile.mergeRemoteProfile(
          this._peerProfilesByPubkey[doc.pubkey],
          doc
        );
      }
      // Publish when there is something beyond empty fields.
      if (!doc.nickname && !doc.bio && !doc.scHandle) return null;
      return this.fabricNetwork.publishPeerProfile(doc);
    } catch (e) {
      this.emit('error', e);
      return null;
    }
  }

  /**
   * Publish P2P_PEER_ALIAS when the Fabric peer is already up.
   * Does not call _ensureFabric (avoids re-entrancy with ensure → alias → ensure).
   * @param {string} [nickname] defaults to current operator nickname
   * @param {Object} [opts] force=true republishes even if unchanged
   * @param {boolean} [opts.force]
   */
  _sendPeerAlias (nickname, opts = {}) {
    if (!this.fabricNetwork || !this.fabricNetwork.ready) return false;
    const name = (nickname != null ? String(nickname) : String(this._nickname || '')).trim();
    if (!name) {
      this._lastPublishedAlias = null;
      return false;
    }
    if (!opts.force && this._lastPublishedAlias === name) return true;
    try {
      this.fabricNetwork.publishPeerAlias(name);
      this._lastPublishedAlias = name;
      const self = this._identity && this._identity.pubkey;
      if (self) this._peerAliasByPubkey[self] = name.slice(0, 64);
      return true;
    } catch (e) {
      this.emit('error', e);
      return false;
    }
  }

  _maybeSendPeerAlias () {
    if (!this._nickname) return false;
    return this._sendPeerAlias(this._nickname);
  }

  async _refreshFabric () {
    if (!this._identity || this.settings.fabric.enable === false) {
      await this._stopFabric();
      return;
    }
    if (this.fabricNetwork && this.fabricNetwork.peer) {
      const prev = this.fabricNetwork._identity && this.fabricNetwork._identity.pubkey;
      const next = this._identity.pubkey;
      this.fabricNetwork.setIdentity(this._identity);
      this.fabricNetwork.setPeers(this._fabricPeerAddresses());
      // Re-key requires a Peer restart; peer-list changes connect in-place.
      if (prev && next && prev !== next) {
        await this.fabricNetwork.restart();
      }
      this._startFabricFlush();
      return;
    }
    await this._ensureFabric();
  }

  async _stopFabric () {
    this._stopUplink();
    this._lastPublishedAlias = null;
    this._stopClusterMeshTimer();
    if (this._hubObserveTimer) {
      clearInterval(this._hubObserveTimer);
      this._hubObserveTimer = null;
    }
    if (this.fabricNetwork) {
      await this.fabricNetwork.stop();
      this.fabricNetwork = null;
    }
  }

  _startFabricFlush () {
    if (this._uplinkTimer) return;
    this._uplinkQueue = this._uplinkQueue || [];
    if (!this._uplinkWired) {
      this._uplinkWired = true;
      // Log events queue only when share is authorized (global or per-peer);
      // chat + mission broadcasts publish immediately and ignore this gate.
      const queue = (collection) => (ev) => {
        if (!this._canShareLogs()) return;
        this._uplinkQueue.push({ collection, data: ev });
        if (this._uplinkQueue.length > 5000) this._uplinkQueue.shift();
      };
      this.on('kill', queue('kills'));
      this.on('player:death', queue('deaths'));
      this.on('player:incap', queue('incaps'));
      this.on('vehicle:destroy', queue('vehicles'));
      this.on('mission:event', queue('missionlog'));
      this.on('player:join', (p) => {
        if (!this._canShareLogs()) return;
        this._uplinkQueue.push({ collection: 'players', data: { name: p.name, timestamp: p.lastSeen } });
      });
    }
    const interval = this.settings.uplink.intervalMs || 5000;
    this._uplinkTimer = setInterval(() => {
      this._flushUplink().catch((e) => this.emit('error', e));
      this._maybePublishGameState().catch((e) => this.emit('error', e));
      this._maybePublishPresence().catch((e) => this.emit('error', e));
    }, interval);
    if (this._uplinkTimer.unref) this._uplinkTimer.unref();
    const seeds = this._fabricPeerAddresses();
    logFabricPeer('seeds', seeds.length ? seeds.join(', ') : '(none)');
  }

  /**
   * Periodically publish cumulative GameStateSnapshot so org hubs
   * (relay.goon.vc) can fold analytics into the Hub sidechain / beacon seal.
   */
  async _maybePublishGameState () {
    if (!this._canShareLogs()) return null;
    const minMs = Number(this.settings.gameStatePublishIntervalMs) || 60000;
    const now = Date.now();
    if (this._lastGameStatePublish && (now - this._lastGameStatePublish) < minMs) return null;
    const h = this.history || {};
    if (!(h.missions && h.missions.length) && !(h.deaths && h.deaths.length)) return null;
    const snap = await this.publishGameStateSnapshot();
    if (snap) this._lastGameStatePublish = now;
    return snap;
  }

  /**
   * Periodic PeerPresence publish when sharing is enabled (default 60s cadence).
   */
  async _maybePublishPresence () {
    if (!this._sharePresence) return null;
    const minMs = Number(this.settings.presencePublishIntervalMs) || 60000;
    const now = Date.now();
    if (this._lastPresencePublish && (now - this._lastPresencePublish) < minMs) return null;
    try {
      const result = await this.publishPresence();
      if (result) this._lastPresencePublish = now;
      return result;
    } catch (e) {
      if (e && (e.code === 'NOT_READY' || e.code === 'LOCKED')) return null;
      throw e;
    }
  }

  _stopUplink () {
    if (this._uplinkTimer) { clearInterval(this._uplinkTimer); this._uplinkTimer = null; }
  }

  /**
   * Publish a mission escrow / payout proposal as a GoonCitizen-namespaced
   * ContractProposal (transport only; register internals unchanged).
   * @param {Object[]} messages signed acceptance / PSBT frames
   * @param {Object} [opts]
   * @param {string} [opts.purpose]
   * @param {object[]} [opts.statePatch]
   * @param {string} [opts.psbtProposalBase64]
   */
  async broadcastMissionProposal (messages, opts = {}) {
    await this._ensureFabric();
    if (!this.fabricNetwork || !this.fabricNetwork.ready) {
      throw Object.assign(new Error('Fabric peer is not ready'), { code: 'UNAVAILABLE' });
    }
    return this.fabricNetwork.publishContractProposal(messages, opts);
  }

  async _publishPeerAlias (nickname) {
    try {
      // Settings updates must force a new announce even if the string matches.
      if (!this.fabricNetwork || !this.fabricNetwork.ready) await this._ensureFabric();
      this._sendPeerAlias(nickname, { force: true });
    } catch (e) {
      this.emit('error', e);
    }
  }

  async _publishChat (record) {
    try {
      // Hot path: do not re-enter full ensure (setPeers / alias) on every message.
      if (!this.fabricNetwork || !this.fabricNetwork.ready) await this._ensureFabric();
      if (!this.fabricNetwork || !this.fabricNetwork.ready || !record) return;
      // Star gossip needs at least one hub socket; re-dial seeds if we are lonely.
      if (!(this.fabricNetwork.status().fabricConnected > 0)) {
        this.fabricNetwork.setPeers(this._fabricPeerAddresses());
      }
      const channel = record.channel || 'global';
      if (channel === 'global') {
        this.fabricNetwork.publishChat(record);
        return;
      }
      const ChatManager = require('../services/ChatManager');
      const dm = ChatManager.parseDmChannel(channel);
      if (dm) {
        this.fabricNetwork.publishDirectChat({
          id: record.id,
          channel,
          peerA: dm.a,
          peerB: dm.b,
          author: record.author,
          body: record.body,
          handle: record.handle || null,
          ts: record.ts,
          attachment: record.attachment || null
        });
        return;
      }
      const groupId = ChatManager.groupIdOf(channel);
      if (!groupId) return;
      const contractId = await this._ensureGroupContractId(groupId);
      if (!contractId) return;
      const payload = {
        id: record.id,
        groupId,
        contractId,
        author: record.author,
        handle: record.handle || null,
        ts: record.ts
      };
      if (record.attachment) payload.attachment = record.attachment;
      if (this._groupChatSeal && this.groupManager) {
        try {
          const { sealGroupChatBody } = require('../functions/groupChatSeal');
          const tip = this.groupManager.getChatSealTip(groupId);
          // Prefer hub-blind participant wraps (v2); tip fields are metadata only.
          payload.seal = sealGroupChatBody({
            mode: 'participant',
            body: record.body,
            contractId: tip.contractId,
            clock: tip.clock,
            stateDigest: tip.stateDigest,
            memberPubkeys: tip.memberPubkeys
          });
        } catch (e) {
          this.emit('error', e);
          payload.body = record.body;
        }
      } else {
        payload.body = record.body;
      }
      const msg = this.fabricNetwork.publishGroupChat(contractId, payload);
      if (msg && typeof msg.toBuffer === 'function') {
        this._accumulateContractMessageWire(contractId, {
          wireMessage: msg,
          messageHex: msg.toBuffer().toString('hex'),
          origin: 'local'
        }, 'local');
      }
    } catch (e) {
      this.emit('error', e);
    }
  }

  /**
   * Sign a GroupOffer CONTRACT_MESSAGE for copy-paste (`fabric:` + raw bytes, base64 by default).
   * Optionally relays on the mesh when the peer is ready.
   */
  async createGroupShare (groupId, actor, opts = {}) {
    if (!this.groupManager) throw Object.assign(new Error('Group system not available'), { code: 'UNAVAILABLE' });
    const group = this.groupManager.getGroup(groupId);
    if (!group) throw Object.assign(new Error('Group not found'), { code: 'NOT_FOUND' });
    if (!group.includes(actor)) {
      const e = new Error('forbidden: only members may share'); e.code = 'FORBIDDEN'; throw e;
    }
    if (!this._identity) throw new Error('Unlock your identity to share');
    const { group: g, definition } = this.groupManager.ensureContract(groupId);
    const contractId = g.contractId || (definition && require('../contracts/gooncitizenGroup').groupContractId(definition));
    if (!contractId || !definition) throw new Error('group Federation contract is not ready');

    const {
      buildGroupOfferBody,
      GROUP_SHARE_KIND_OFFER
    } = require('../functions/groupShareMessage');
    const offer = buildGroupOfferBody({
      group: g,
      definition,
      actor,
      note: opts.note
    });

    await this._ensureFabric().catch(() => null);
    if (!this.fabricNetwork) {
      this.fabricNetwork = new FabricNetwork({
        enable: false,
        listen: false,
        peers: [],
        peersDb: null,
        messageLog: this._fabricMessageLog
      });
    }
    this.fabricNetwork.setIdentity(this._identity);
    // Prefer a live peer so Share actually hits the mesh (not clipboard-only).
    if (opts.relay !== false && !this.fabricNetwork.ready) {
      await this._ensureFabric().catch(() => null);
    }
    const msg = this.fabricNetwork.signContractMessage(contractId, 'GroupShare', offer, { relay: false });
    let relayed = false;
    let relayError = null;
    if (opts.relay !== false) {
      try {
        if (!(this.fabricNetwork.status().fabricConnected > 0)) {
          this.fabricNetwork.setPeers(this._fabricPeerAddresses());
        }
        if (!this.fabricNetwork.ready) {
          throw new Error('Fabric peer not ready — unlock identity and wait for peering');
        }
        // Group namespace (members / known contracts) + GoonCitizen genesis
        // so peers who have never seen this group still receive the offer.
        this.fabricNetwork.publishGroupShare(contractId, offer);
        const { gooncitizenContractId } = require('../contracts/gooncitizen');
        this.fabricNetwork.publishGroupShare(gooncitizenContractId(), offer);
        relayed = true;
      } catch (e) {
        relayError = e && e.message ? e.message : String(e);
        this.emit('error', e);
      }
    }
    const encoded = this.fabricNetwork.encodeOpaqueMessage(msg, {
      encoding: this._opaqueShareEncoding(opts.encoding)
    });
    const st = this.fabricNetwork.status();
    const messageId = (msg && (msg.id || msg.hash))
      ? String(msg.id || msg.hash).toLowerCase()
      : null;
    return {
      kind: GROUP_SHARE_KIND_OFFER,
      offerId: offer.offerId,
      groupId: g.id,
      contractId,
      messageId,
      protocolUrl: encoded.protocolUrl,
      protocolUrlHex: encoded.protocolUrlHex || encoded.protocolUrl,
      protocolUrlBase64: encoded.protocolUrlBase64,
      messageHex: encoded.messageHex,
      messageBase64: encoded.messageBase64,
      pagePath: g.path || `/groups/${g.slug || g.id}`,
      visibility: g.visibility,
      relayed,
      relayError,
      peers: st.fabricConnected || 0,
      localJsSnippet: messageId
        ? require('../functions/defaultGroupMessage').localJsSnippetFor(messageId)
        : require('../functions/defaultGroupMessage').localJsSnippetFor(encoded.protocolUrl)
    };
  }

  /**
   * Decode an opaque fabric:<hex|base64> Message without ingesting/mutating state.
   * @param {string} protocolUrlOrPayload
   * @returns {object}
   */
  decodeOpaqueFabricMessage (protocolUrlOrPayload) {
    const {
      parseOpaqueFabricMessage,
      classifyGroupShareMessage,
      buildOpaqueFabricUrl
    } = require('../functions/groupShareMessage');
    const parsed = parseOpaqueFabricMessage(protocolUrlOrPayload);
    if (!parsed.ok) throw new Error(parsed.error || 'invalid fabric message');
    let classified = { kind: 'unknown' };
    try {
      classified = classifyGroupShareMessage(parsed.message) || classified;
    } catch (_) { /* best-effort */ }
    const msgType = (parsed.message && parsed.message.type) || null;
    const hash = (parsed.message && (parsed.message.id || parsed.message.hash)) || null;
    return {
      encoding: parsed.encoding || 'hex',
      hex: parsed.hex,
      base64: parsed.base64,
      messageHex: parsed.hex,
      messageBase64: parsed.base64,
      protocolUrl: buildOpaqueFabricUrl(parsed.buffer, { encoding: parsed.encoding || 'hex' }),
      protocolUrlHex: buildOpaqueFabricUrl(parsed.buffer, { encoding: 'hex' }),
      protocolUrlBase64: buildOpaqueFabricUrl(parsed.buffer, { encoding: 'base64' }),
      type: msgType,
      wireType: msgType,
      kind: classified.kind || null,
      contractId: classified.contractId || null,
      groupId: classified.groupId || null,
      hash: hash ? String(hash) : null,
      bytes: parsed.buffer.length
    };
  }

  /**
   * Ingest an opaque fabric:<hex|base64> GroupOffer / invite / group CONTRACT_PUBLISH.
   */
  async ingestOpaqueGroupShare (protocolUrlOrHex) {
    const {
      parseOpaqueFabricMessage,
      classifyGroupShareMessage,
      GROUP_SHARE_KIND_OFFER
    } = require('../functions/groupShareMessage');
    const parsed = parseOpaqueFabricMessage(protocolUrlOrHex);
    if (!parsed.ok) throw new Error(parsed.error || 'invalid fabric message');
    try {
      const summary = summarizeMessage(parsed.message, { direction: 'in', via: 'opaque' });
      if (summary) {
        this._fabricMessageLog.append(summary);
        logFabricWire(summary);
      }
    } catch (_) { /* best-effort log */ }
    const classified = classifyGroupShareMessage(parsed.message);
    if (classified.kind === 'GroupPublish') {
      const result = this.groupManager.ingestContractPublish(classified.object, 'opaque-share');
      return { kind: 'GroupPublish', ...result };
    }
    if (classified.kind === 'GroupOffer') {
      return this._ingestGroupOffer(classified.object, 'opaque-share', {
        contract: classified.contractId
      });
    }
    if (classified.kind === 'FederationContractInvite') {
      return this._ingestFederationInvite(classified.object, 'opaque-share', {
        contract: classified.contractId
      });
    }
    throw new Error(`unsupported share kind: ${classified.kind || 'unknown'} (expected ${GROUP_SHARE_KIND_OFFER})`);
  }

  _ingestGroupOffer (object, source, meta = {}) {
    if (!object || object.kind !== 'GroupOffer') return null;
    const definition = object.definition;
    let group = null;
    let created = false;
    if (definition && this.groupManager) {
      const pub = this.groupManager.ingestContractPublish(definition, source || 'group-offer');
      group = pub && pub.group;
      created = !!(pub && pub.created);
    } else if (object.contractId && this.groupManager) {
      group = this.groupManager.getGroupByContractId(object.contractId);
    } else if (object.groupId && this.groupManager) {
      group = this.groupManager.getGroup(object.groupId);
    }
    const payload = {
      kind: 'GroupOffer',
      offer: object,
      group: group ? (typeof group.toJSON === 'function' ? group.toJSON() : group) : null,
      created,
      source: source || null,
      contractId: object.contractId || (meta && meta.contract) || null
    };
    const inboxRow = registerInbox.entryFromGroupOffer(payload);
    const inbox = inboxRow ? this._appendInbox(inboxRow) : null;
    this.emit('group:offer', payload);
    payload.inbox = inbox;
    payload.inboxId = inbox && inbox.id;
    payload.pending = !!(inbox && inbox.status === 'pending');
    return payload;
  }

  /**
   * Publish a Hub-shaped FederationContractInvite under the group's contract
   * (and GoonCitizen genesis when targeting an invitee so they receive it
   * without already knowing the group).
   * @param {string} groupId
   * @param {string} actor Member inviting
   * @param {Object} [opts]
   * @param {string} [opts.note]
   * @param {string} [opts.inviteId]
   * @param {string} [opts.inviteePubkey]
   * @param {string} [opts.role] `'reader'` or `'signer'`
   */
  async inviteToGroupFederation (groupId, actor, opts = {}) {
    if (!this.groupManager) throw Object.assign(new Error('Group system not available'), { code: 'UNAVAILABLE' });
    const group = this.groupManager.getGroup(groupId);
    if (!group) throw Object.assign(new Error('Group not found'), { code: 'NOT_FOUND' });
    if (!group.includes(actor)) {
      const e = new Error('forbidden: only members may invite'); e.code = 'FORBIDDEN'; throw e;
    }
    if (!this._identity) throw new Error('Unlock your identity to invite');
    const contractId = await this._ensureGroupContractId(groupId);
    if (!contractId) throw new Error('group Federation contract is not ready');
    const { pubkeysMatch, pubkeyXOnly } = identityLib();
    const PUBKEY_RE = /^(0[23][0-9a-f]{64}|[0-9a-f]{64})$/;
    let invitee = opts.inviteePubkey != null ? String(opts.inviteePubkey).trim().toLowerCase() : null;
    if (invitee) {
      if (!PUBKEY_RE.test(invitee)) {
        const e = new Error('invalid invitee pubkey'); e.code = 'BAD_REQUEST'; throw e;
      }
      if (pubkeysMatch(invitee, actor)) {
        const e = new Error('cannot invite yourself'); e.code = 'BAD_REQUEST'; throw e;
      }
      if (group.members && group.members.some((m) => pubkeysMatch(m, invitee))) {
        const e = new Error('already a member of this group'); e.code = 'BAD_REQUEST'; throw e;
      }
      // Prefer compressed form when the invitee is already a known member/author.
      // X-only wire ids are accepted and matched via pubkeysMatch on ingest.
      if (pubkeyXOnly(invitee) && !/^0[23]/.test(invitee)) {
        /* keep x-only — destination matches with pubkeysMatch */
      }
    } else {
      invitee = null;
    }
    const { buildFederationContractInvite } = require('../functions/federationContractInvite');
    const { normalizeProposedPolicy } = require('../contracts/gooncitizenGroup');
    const { gooncitizenContractId } = require('../contracts/gooncitizen');
    const role = String(opts.role || 'signer').toLowerCase() === 'reader' ? 'reader' : 'signer';
    let capabilityToken = null;
    try {
      const { issueContractCapability, roleToCapability } = require('@fabric/core/functions/contractCapability');
      capabilityToken = issueContractCapability({
        issuerKey: require('../functions/identity').keyFromIdentity(this._identity),
        subject: invitee || actor,
        contractId,
        capability: roleToCapability(role)
      });
    } catch (_) { /* token optional if key path fails */ }
    const inviteId = opts.inviteId || idFor(`invite:${groupId}:${Date.now()}:${actor}:${invitee || ''}`);
    const signers = group.validators || (group.proposedPolicy && group.proposedPolicy.validators) || group.members;
    const invite = buildFederationContractInvite({
      inviteId,
      inviterHubId: actor,
      contractId,
      note: opts.note || `Join group ${group.name}`,
      inviteePubkey: invitee || undefined,
      groupId: group.id,
      groupName: group.name,
      role,
      capabilityToken: capabilityToken || undefined,
      proposedPolicy: normalizeProposedPolicy({
        validators: signers,
        threshold: group.threshold
      })
    });
    await this._ensureFabric().catch(() => null);
    if (!this.fabricNetwork) {
      this.fabricNetwork = new FabricNetwork({
        enable: false,
        listen: false,
        peers: [],
        peersDb: null,
        messageLog: this._fabricMessageLog
      });
    }
    this.fabricNetwork.setIdentity(this._identity);
    // Prefer a live peer so direct invites actually hit the mesh.
    if (!this.fabricNetwork.ready) {
      await this._ensureFabric().catch(() => null);
    }
    // Sign for clipboard even if peer is not ready; relay when possible.
    const msg = this.fabricNetwork.signContractMessage(contractId, 'FederationContractInvite', invite, { relay: false });
    let relayed = false;
    let relayError = null;
    if (opts.relay !== false && this.fabricNetwork.ready) {
      try {
        if (!(this.fabricNetwork.status().fabricConnected > 0)) {
          this.fabricNetwork.setPeers(this._fabricPeerAddresses());
        }
        this.fabricNetwork.publishFederationInvite(contractId, invite);
        // Genesis namespace so invitees who have never seen this group still get it.
        this.fabricNetwork.publishFederationInvite(gooncitizenContractId(), invite);
        // Dual-path: DirectChat to the invitee (same hub flood as DMs) so
        // spoke↔spoke delivery does not depend on group-contract awareness.
        if (invitee) {
          const ChatManager = require('../services/ChatManager');
          const channel = ChatManager.dmChannelKey(actor, invitee);
          if (channel) {
            const dm = ChatManager.parseDmChannel(channel);
            this.fabricNetwork.publishDirectChat({
              id: `invite-dm:${inviteId}`,
              channel,
              peerA: dm.a,
              peerB: dm.b,
              author: actor,
              body: `Group invite: ${group.name} — open Notifications to accept`,
              handle: null,
              ts: new Date().toISOString(),
              invite
            });
          }
        }
        relayed = true;
      } catch (e) {
        relayError = e && e.message ? e.message : String(e);
        this.emit('error', e);
      }
    } else if (opts.relay !== false) {
      relayError = 'Fabric peer not ready — unlock identity and wait for peering';
    }
    const encoded = this.fabricNetwork.encodeOpaqueMessage(msg, {
      encoding: this._opaqueShareEncoding(opts.encoding)
    });
    const stored = Object.assign({}, invite, {
      groupId: group.id,
      groupName: group.name,
      status: 'pending',
      createdAt: new Date().toISOString(),
      protocolUrl: encoded.protocolUrl,
      protocolUrlHex: encoded.protocolUrlHex || null,
      protocolUrlBase64: encoded.protocolUrlBase64 || null,
      messageHex: encoded.messageHex,
      messageBase64: encoded.messageBase64,
      direction: 'outbound'
    });
    if (this.registerStore) {
      this.registerStore.put('groupinvites', inviteId, stored);
    }
    const st = this.fabricNetwork.status();
    return Object.assign({}, invite, {
      kind: 'FederationContractInvite',
      groupId: group.id,
      groupName: group.name,
      protocolUrl: encoded.protocolUrl,
      protocolUrlHex: encoded.protocolUrlHex || encoded.protocolUrl,
      protocolUrlBase64: encoded.protocolUrlBase64,
      messageHex: encoded.messageHex,
      messageBase64: encoded.messageBase64,
      relayed,
      relayError,
      peers: st.fabricConnected || 0
    });
  }

  /**
   * Balance + UTXO history for a group Taproot address when Bitcoin is enabled.
   * Prefers local payouts RPC (scantxoutset); falls back to Hub address balance.
   * @param {string} address
   * @param {object} [pm] PayoutManager
   * @returns {Promise<object>}
   */
  async _groupWalletFunding (address, pm) {
    const addr = String(address || '').trim();
    const out = {
      balanceSats: 0,
      utxos: [],
      history: [],
      balanceSource: null,
      balanceError: null
    };
    if (!addr) return out;

    if (pm && pm.mode === 'bitcoin' && typeof pm.scanAddress === 'function') {
      try {
        const scan = await pm.scanAddress(addr);
        out.balanceSats = scan.balanceSats || 0;
        out.utxos = scan.utxos || [];
        out.history = scan.history || [];
        out.balanceSource = 'payouts-rpc';
        return out;
      } catch (e) {
        out.balanceError = (e && e.message) || String(e);
      }
    }

    try {
      const btcCfg = Object.assign({}, this.settings.bitcoin || {});
      const btc = hubBitcoinProxy.withResolvedHubAdminToken({
        hub: hubBitcoinProxy.normalizeHubBase(btcCfg.hub),
        network: String(btcCfg.network || 'regtest'),
        adminToken: btcCfg.adminToken || null,
        adminTokenFile: btcCfg.adminTokenFile || null
      });
      const bal = await hubBitcoinProxy.fetchAddressBalance(btc, addr);
      const raw = (bal && bal.data) || bal || {};
      let balanceSats = null;
      if (raw.balanceSats != null) balanceSats = Number(raw.balanceSats);
      else if (raw.confirmedSats != null) balanceSats = Number(raw.confirmedSats);
      else if (raw.balance != null) balanceSats = Math.round(Number(raw.balance) * 1e8);
      out.balanceSats = Number.isFinite(balanceSats) ? balanceSats : 0;
      out.balanceSource = 'hub';
      out.balanceError = null;
      try {
        const info = await hubBitcoinProxy.fetchAddressInfo(btc, addr);
        const body = (info && info.data) || info || {};
        const utxos = body.utxos || body.unspents || [];
        if (Array.isArray(utxos) && utxos.length) {
          out.utxos = utxos.map((u) => ({
            txid: u.txid,
            vout: u.vout,
            amountSats: u.amountSats != null
              ? Number(u.amountSats)
              : Math.round((Number(u.amount) || 0) * 1e8),
            height: u.height != null ? Number(u.height) : null
          }));
          out.history = out.utxos.map((u) => Object.assign({}, u, { status: 'unspent' }));
        }
      } catch (_) { /* balance alone is enough */ }
      return out;
    } catch (e) {
      if (!out.balanceError) out.balanceError = (e && e.message) || String(e);
      return out;
    }
  }

  /**
   * Publisher proposes a Taproot spend or decay-migrate for the group vault.
   * @param {string} groupId
   * @param {string} actor Must be group.creator
   * @param {object} opts
   */
  async proposeGroupWithdrawal (groupId, actor, opts = {}) {
    if (!this.groupManager) throw Object.assign(new Error('Group system not available'), { code: 'UNAVAILABLE' });
    const group = this.groupManager.getGroup(groupId);
    if (!group) throw Object.assign(new Error('Group not found'), { code: 'NOT_FOUND' });
    if (group.creator !== actor) {
      const e = new Error('forbidden: only the creator may propose withdrawals'); e.code = 'FORBIDDEN'; throw e;
    }
    const { groupSpendLadder } = require('../functions/groupSpendLadder');
    const tap = require('@fabric/core/functions/contractTaproot');
    const policy = groupSpendLadder(group, { network: opts.network || 'regtest' });
    const action = String(opts.action || 'spend').toLowerCase() === 'migrate' ? 'migrate' : 'spend';
    const ctx = {
      utxoAgeBlocks: Number(opts.utxoAgeBlocks) || 0,
      tipHeight: Number(opts.tipHeight) || 0,
      tipClock: Number(opts.tipClock) || 0,
      contractState: opts.contractState || null
    };
    let prepared = null;
    if (action === 'migrate') {
      if (!opts.fundedTxHex) {
        prepared = {
          action: 'migrate',
          target: tap.selectMigrateTarget(policy, ctx),
          note: 'Provide fundedTxHex to build PSBT'
        };
      } else {
        prepared = tap.prepareDecayMigrationPsbt({
          policy,
          fundedTxHex: opts.fundedTxHex,
          vaultAddress: opts.vaultAddress,
          feeSats: opts.feeSats,
          ctx
        });
      }
    } else {
      if (!opts.fundedTxHex || !opts.destinationAddress) {
        const active = tap.selectActiveTiers(policy, ctx);
        prepared = {
          action: 'spend',
          activeTiers: active.map((t) => ({ id: t.id, threshold: t.threshold, after: t.after, until: t.until })),
          preferredTierId: active[0] ? active[0].id : null,
          address: tap.toAddress(policy),
          note: 'Provide fundedTxHex + destinationAddress to build PSBT'
        };
      } else {
        prepared = tap.prepareTierWithdrawalPsbt({
          policy,
          tierId: opts.tierId,
          fundedTxHex: opts.fundedTxHex,
          vaultAddress: opts.vaultAddress,
          destinationAddress: opts.destinationAddress,
          feeSats: opts.feeSats,
          ctx
        });
      }
    }
    const id = opts.requestId || idFor(`gwd:${groupId}:${Date.now()}`);
    const record = {
      id,
      groupId,
      contractId: group.contractId || null,
      action,
      tierId: prepared.tierId || opts.tierId || null,
      status: prepared.psbtBase64 ? 'prepared' : 'proposed',
      proposedBy: actor,
      createdAt: new Date().toISOString(),
      destinationAddress: opts.destinationAddress || prepared.childAddress || null,
      prepared,
      signatures: {},
      type: 'ContractWithdrawalRequest'
    };
    if (this.registerStore) this.registerStore.put('groupwithdrawals', id, record);
    const wdNotice = registerInbox.entryFromWalletEvent({
      kind: 'WalletWithdrawal',
      status: record.status === 'prepared' ? 'pending' : 'info',
      actionable: record.status === 'prepared' || record.status === 'proposed',
      title: 'Group withdrawal proposed',
      body: record.destinationAddress
        ? `to ${record.destinationAddress}`
        : (record.prepared && record.prepared.address) || 'Taproot withdrawal',
      source: actor,
      refs: {
        groupId,
        withdrawalId: id,
        contractId: record.contractId,
        tierId: record.tierId
      },
      dedupeKey: `wallet-wd-${id}`
    });
    if (wdNotice) this._appendInbox(wdNotice);
    try {
      await this._ensureFabric().catch(() => null);
      if (this.fabricNetwork && group.contractId) {
        this.fabricNetwork._publishContractMessage(group.contractId, 'ContractWithdrawalRequest', {
          type: 'ContractWithdrawalRequest',
          contractId: group.contractId,
          requestId: id,
          action,
          tierId: record.tierId,
          destinationAddress: record.destinationAddress,
          proposedBy: actor,
          createdAt: record.createdAt
        });
      }
    } catch (_) { /* best-effort mesh */ }
    return record;
  }

  async witnessGroupWithdrawal (groupId, requestId, actor, opts = {}) {
    if (!this.registerStore) throw new Error('store unavailable');
    const group = this.groupManager && this.groupManager.getGroup(groupId);
    if (!group) throw Object.assign(new Error('Group not found'), { code: 'NOT_FOUND' });
    if (!group.isSigner || !group.isSigner(actor)) {
      // Group instance from getGroup is Group class
      const g = group;
      const signers = g.validators || [];
      if (!signers.includes(actor)) {
        const e = new Error('forbidden: only signers may witness'); e.code = 'FORBIDDEN'; throw e;
      }
    }
    const rec = this.registerStore.get('groupwithdrawals', requestId);
    if (!rec || rec.groupId !== groupId) throw Object.assign(new Error('withdrawal not found'), { code: 'NOT_FOUND' });
    const sig = opts.signature || opts.sig;
    if (!sig) throw new Error('signature required');
    rec.signatures = rec.signatures || {};
    rec.signatures[actor] = String(sig);
    rec.status = 'witnessing';
    this.registerStore.put('groupwithdrawals', requestId, rec);
    return rec;
  }

  async finalizeGroupWithdrawal (groupId, requestId, actor, opts = {}) {
    if (!this.registerStore) throw new Error('store unavailable');
    const group = this.groupManager && this.groupManager.getGroup(groupId);
    if (!group) throw Object.assign(new Error('Group not found'), { code: 'NOT_FOUND' });
    if (group.creator !== actor && !(group.isSigner && group.isSigner(actor))) {
      const signers = group.validators || [];
      if (group.creator !== actor && !signers.includes(actor)) {
        const e = new Error('forbidden'); e.code = 'FORBIDDEN'; throw e;
      }
    }
    const rec = this.registerStore.get('groupwithdrawals', requestId);
    if (!rec || rec.groupId !== groupId) throw Object.assign(new Error('withdrawal not found'), { code: 'NOT_FOUND' });
    const need = group.threshold || 1;
    const sigCount = Object.keys(rec.signatures || {}).length;
    if (rec.action === 'spend' && sigCount < need && !opts.force) {
      throw new Error(`need ${need} signer witnesses, have ${sigCount}`);
    }
    rec.status = 'finalized';
    rec.finalizedAt = new Date().toISOString();
    rec.finalizedBy = actor;
    if (opts.txid) rec.txid = String(opts.txid);
    this.registerStore.put('groupwithdrawals', requestId, rec);
    return rec;
  }

  /**
   * Accept or reject a FederationContractInvite. Accept adds the responder
   * as a member via GroupChange (local + published).
   */
  async respondToGroupFederationInvite (groupIdOrSlug, inviteId, actor, accept) {
    if (!this.groupManager) throw Object.assign(new Error('Group system not available'), { code: 'UNAVAILABLE' });
    if (!actor) throw Object.assign(new Error('actor required (unlock identity or authenticate)'), { code: 'FORBIDDEN' });
    let group = this.groupManager.findGroup(groupIdOrSlug);
    const stored = this.registerStore && this.registerStore.get('groupinvites', inviteId);
    if (!group && stored && stored.contractId) {
      group = this.groupManager.getGroupByContractId(stored.contractId);
    }
    if (!group && stored) {
      const shell = this.groupManager.ingestFederationInviteShell(stored, 'invite-accept');
      group = shell && shell.group;
    }
    if (!group) throw Object.assign(new Error('Group not found'), { code: 'NOT_FOUND' });
    const contractId = (stored && stored.contractId) || group.contractId || await this._ensureGroupContractId(group.id);
    if (!contractId) throw new Error('group Federation contract is not ready');
    const { buildFederationContractInviteResponse } = require('../functions/federationContractInvite');
    const response = buildFederationContractInviteResponse({
      inviteId,
      accept: !!accept,
      responderPubkey: actor
    });
    await this._ensureFabric().catch(() => null);
    if (this.fabricNetwork && this.fabricNetwork.ready) {
      try {
        this.fabricNetwork.publishFederationInviteResponse(contractId, response);
      } catch (e) {
        this.emit('error', e);
      }
    }
    // Local invitee membership: join immediately so paste-accept is usable
    // without waiting for the inviter's GroupChange round-trip.
    let joined = null;
    if (accept) {
      joined = await this.groupManager.joinFromPendingInvite(group.id, actor, stored || {
        inviteId,
        contractId
      });
    }
    if (stored && this.registerStore) {
      stored.status = accept ? 'accepted' : 'rejected';
      stored.respondedAt = new Date().toISOString();
      stored.responderPubkey = actor;
      stored.groupId = group.id;
      this.registerStore.put('groupinvites', inviteId, stored);
      const inboxRow = registerInbox.entryFromFederationInvite(stored, stored.source || stored.inviterHubId);
      if (inboxRow) {
        const prev = this.registerStore.get('inbox', inboxRow.id);
        if (prev) {
          registerInbox.patch(this.registerStore, inboxRow.id, {
            status: stored.status,
            actionable: false,
            resolvedAt: stored.respondedAt,
            resolvedBy: actor,
            refs: Object.assign({}, prev.refs || {}, { groupId: group.id })
          });
        } else {
          this._appendInbox(Object.assign({}, inboxRow, {
            status: stored.status,
            actionable: false,
            resolvedAt: stored.respondedAt,
            resolvedBy: actor
          }));
        }
      }
    }
    return Object.assign({}, response, {
      group: joined || (typeof group.toJSON === 'function' ? group.toJSON() : group)
    });
  }

  _queuePendingFederationInvite (invite, source, meta) {
    if (!invite || !invite.inviteId) return;
    if (!this._pendingFederationInvites) this._pendingFederationInvites = new Map();
    this._pendingFederationInvites.set(invite.inviteId, {
      invite,
      source: source || null,
      meta: meta || {},
      queuedAt: Date.now()
    });
    // Bound memory if unlock never happens.
    if (this._pendingFederationInvites.size > 64) {
      const oldest = this._pendingFederationInvites.keys().next().value;
      this._pendingFederationInvites.delete(oldest);
    }
  }

  _flushPendingFederationInvites () {
    const pending = this._pendingFederationInvites;
    if (!pending || !pending.size || !this._identity) return;
    const rows = Array.from(pending.values());
    pending.clear();
    for (const row of rows) {
      try {
        this._ingestFederationInvite(row.invite, row.source, row.meta);
      } catch (e) { this.emit('error', e); }
    }
  }

  _ingestFederationInvite (object, source, meta) {
    const {
      parseFederationContractInviteLoose
    } = require('../functions/federationContractInvite');
    const { pubkeysMatch } = identityLib();
    const invite = parseFederationContractInviteLoose(object)
      || parseFederationContractInviteLoose(JSON.stringify(object));
    if (!invite || !invite.inviteId) {
      return { kind: 'FederationContractInvite', invite: null, pending: false };
    }
    // Dedup: inviter already persisted outbound; ignore mesh echo.
    if (this.registerStore && this.registerStore.get('groupinvites', invite.inviteId)) {
      return { kind: 'FederationContractInvite', invite, pending: false, duplicate: true };
    }
    const me = this._identity && this._identity.pubkey
      ? String(this._identity.pubkey)
      : null;
    const invitee = invite.inviteePubkey ? String(invite.inviteePubkey) : null;
    // Targeted invite: only the invitee keeps a persistent copy + inbox row.
    // Match compressed ↔ x-only (wire authors / chat hover ids often differ).
    if (invitee) {
      if (!me) {
        // Identity locked — queue until unlock rather than drop (spoke may
        // receive the frame while the wallet is locked).
        this._queuePendingFederationInvite(invite, source, meta);
        return { kind: 'FederationContractInvite', invite, pending: false, skipped: 'identity-locked' };
      }
      if (!pubkeysMatch(me, invitee)) {
        return { kind: 'FederationContractInvite', invite, pending: false, skipped: 'not-invitee' };
      }
    }
    if (me && invite.inviterHubId && pubkeysMatch(me, invite.inviterHubId)) {
      return { kind: 'FederationContractInvite', invite, pending: false, skipped: 'self-inviter' };
    }
    const contractId = invite.contractId || (meta && meta.contract) || null;
    let group = null;
    let created = false;
    if (this.groupManager && contractId) {
      group = this.groupManager.getGroupByContractId(contractId);
      if (!group && invite.proposedPolicy) {
        const shell = this.groupManager.ingestFederationInviteShell(
          Object.assign({}, invite, { contractId }),
          source || 'federation-invite'
        );
        if (shell) {
          group = shell.group;
          created = !!shell.created;
        }
      }
    }
    const storedInvite = Object.assign({}, invite, {
      groupId: (group && group.id) || invite.groupId || null,
      groupName: invite.groupName || (group && group.name) || null,
      contractId: contractId || null,
      status: 'pending',
      source: source || null,
      direction: 'inbound',
      receivedAt: new Date().toISOString()
    });
    if (this.registerStore) {
      this.registerStore.put('groupinvites', invite.inviteId, storedInvite);
    }
    const inboxRow = registerInbox.entryFromFederationInvite(storedInvite, source);
    const inbox = inboxRow ? this._appendInbox(inboxRow) : null;
    this.emit('group:invite', invite);
    return {
      kind: 'FederationContractInvite',
      invite,
      group: group
        ? (typeof group.toJSON === 'function' ? group.toJSON() : group)
        : null,
      created,
      pending: !!(inbox && inbox.status === 'pending'),
      inbox,
      inboxId: inbox && inbox.id,
      contractId
    };
  }

  _ingestFederationInviteResponse (object, source, meta) {
    const {
      parseFederationContractInviteResponseLoose
    } = require('../functions/federationContractInvite');
    const response = parseFederationContractInviteResponseLoose(object)
      || parseFederationContractInviteResponseLoose(JSON.stringify(object));
    if (!response) return;
    const stored = this.registerStore && this.registerStore.get('groupinvites', response.inviteId);
    if (stored && this.registerStore) {
      stored.status = response.accept ? 'accepted' : 'rejected';
      stored.respondedAt = new Date().toISOString();
      stored.responderPubkey = response.responderPubkey || source;
      this.registerStore.put('groupinvites', response.inviteId, stored);
      // Patch any local MultisigWalletInvite / FederationInvite row.
      this._resolveInboxWhere(
        (r) => (r.kind === 'FederationInvite' || r.kind === 'MultisigWalletInvite') &&
          r.refs && r.refs.inviteId === response.inviteId,
        {
          status: stored.status,
          actionable: false,
          resolvedAt: stored.respondedAt,
          resolvedBy: stored.responderPubkey
        }
      );
      // Inviter (and anyone holding the outbound invite) gets a decision notice.
      const decision = registerInbox.entryFromFederationInviteDecision(response, stored, source);
      if (decision) this._appendInbox(decision);
    }
    // When a peer accepts, add them as a member if we have the group locally.
    if (response.accept && response.responderPubkey && this.groupManager && stored) {
      const group = (stored.groupId && this.groupManager.getGroup(stored.groupId))
        || (stored.contractId && this.groupManager.getGroupByContractId(stored.contractId));
      if (group && group.creator && !group.includes(response.responderPubkey)) {
        this.groupManager._appendGroupStatechain(group.id, {
          id: `invite-resp:${response.inviteId}`,
          type: 'FederationContractInviteResponse',
          message: response,
          acceptedAt: new Date().toISOString()
        });
        this.groupManager.addMember(group.id, response.responderPubkey, group.creator).catch((e) => this.emit('error', e));
      }
    }
    this.emit('group:invite-response', response);
  }

  /**
   * Publish queued log events as one SCEventBatch over Fabric.
   * Requeues when the peer is not ready.
   */
  async _flushUplink () {
    if (!this._uplinkQueue || !this._uplinkQueue.length) return null;
    const opts = this._logSharePublishOpts();
    if (!opts) return null;
    await this._ensureFabric();
    if (!this.fabricNetwork || !this.fabricNetwork.ready) return null;
    const connected = this.fabricNetwork.status().fabricConnected;
    if (!connected) return null; // keep queue until at least one Fabric peer is up
    const events = this._uplinkQueue.splice(0, 200);
    try {
      this.fabricNetwork.publishEventBatch(events, new Date().toISOString(), opts);
      const targets = opts.to || null;
      for (const p of this.peers) {
        if (p.enabled === false) continue;
        const hit = !targets || targets.some((addr) => FabricNetwork.connectionMatchesAddress(p.address, addr)
          || FabricNetwork.connectionMatchesAddress(addr, p.address));
        if (hit) { p.lastSeen = new Date().toISOString(); p.lastError = null; }
      }
      this.emit('uplink:sent', { count: events.length, via: 'fabric', to: targets });
      return { created: events.length, via: 'fabric', to: targets };
    } catch (e) {
      this._uplinkQueue.unshift(...events);
      if (this._uplinkQueue.length > 5000) this._uplinkQueue.length = 5000;
      for (const p of this.peers) {
        if (p.enabled !== false) p.lastError = e.message;
      }
      this.emit('uplink:error', { error: e.message });
      return null;
    }
  }

  // ---- Lifecycle ----
  async start () {
    this.state.status = 'STARTING';
    if (this.registerStore) {
      try {
        await this.registerStore.start();
      } catch (e) {
        this.emit('error', e);
        console.error('[STAR-CITIZEN] register store failed to start:', e && e.message ? e.message : e);
      }
    }
    this._loadPersistedSettings(); // peers + uplink cadence from the Fabric Store
    this._loadIdentityCluster();
    try {
      const { restorePendingDeviceLinkOffer } = require('../functions/fabricDeviceLinkLocalHttp');
      restorePendingDeviceLinkOffer(this);
    } catch (_) { /* Android helper optional on hosted */ }
    this._applyDiscordConfig();
    if (this.missionManager) await this.missionManager.start();
    if (this.groupManager) await this.groupManager.start();
    this._applyDefaultGroupFromLocal();
    const skipGameLog = this._skipGameLog();
    // 1) Fold Game.log + logbackups into durable cumulative history (cursor-based).
    // 2) Seed the Live tab from the current Game.log (session memory only).
    // 3) Tail new lines; those update both session state and cumulative history.
    if (!skipGameLog) {
      try { await this._syncCumulativeHistory(); } catch (e) { this.emit('error', e); }
      this._historyApplyLive = false;
      if (this.settings.seed && fs.existsSync(this.settings.seed)) {
        try {
          const n = await this.replayLog(this.settings.seed);
          console.log(`[STAR-CITIZEN] seeded ${n} lines from ${this.settings.seed}`);
        } catch (e) { this.emit('error', e); }
      }
      this._historyApplyLive = true;
      this.openLog();
    } else if (this._historyFile()) {
      // Hosted hub or Android node: durable aggregation from peer
      // SCEventBatch / GameStateSnapshot ingest (no Game.log on this device).
      this._historyApplyLive = true;
      console.log(`[STAR-CITIZEN] cumulative aggregator: ${this._historyFile()}`);
    }
    if (this.settings.listen !== false) {
      this.server = http.createServer((req, res) => this._handle(req, res));
      const host = this._httpListenHost();
      await new Promise((resolve, reject) => {
        this.server.once('error', reject);
        this.server.listen(this.settings.port, host, () => {
          this.server.removeListener('error', reject);
          resolve();
        });
      });
      const addr = this.server.address();
      if (addr && typeof addr === 'object' && addr.port) this.settings.port = addr.port;
    }
    if (this.missionManager && this.missionManager.officers.size === 0) {
      if (this.missionManager.settings.requireOfficers) {
        console.error('[STAR-CITIZEN] SC_OFFICERS empty — mission officer mutations are denied until an allowlist is set');
      } else {
        console.warn('[STAR-CITIZEN] SC_OFFICERS empty — bootstrap mode (everyone is an officer). Set SC_OFFICERS for production.');
      }
    }
    if (this._identity) {
      try {
        await this._refreshFabric();
      } catch (e) {
        this.emit('error', e);
        console.error('[STAR-CITIZEN] fabric peer failed to start:', e && e.message ? e.message : e);
      }
    }
    try {
      await this._startDiscordBot();
    } catch (e) {
      this.emit('error', e);
      console.error('[STAR-CITIZEN] discord bot failed to start:', e && e.message ? e.message : e);
    }
    this.state.status = 'STARTED';
    this.state.startedAt = new Date().toISOString();
    this.emit('ready');
    if (this.server) {
      const host = this._httpListenHost();
      const displayHost = (host === '0.0.0.0' || host === '::') ? 'localhost' : host;
      console.log(`[STAR-CITIZEN] listening on http://${displayHost}:${this.settings.port}/services/star-citizen (bind ${host})`);
      const bindWarn = httpBindWarning({
        host,
        mode: this.settings.mode,
        httpSharedMode: this._httpSharedMode === true
      });
      if (bindWarn) console.warn(bindWarn);
    } else {
      console.log('[STAR-CITIZEN] API ready (embedded mode, no listener)');
    }
    return this;
  }

  async stop () {
    this.state.status = 'STOPPING';
    this._stopping = true;
    try {
      const { stopDeviceLinkTick } = require('../functions/fabricDeviceLinkLocalHttp');
      stopDeviceLinkTick(this);
    } catch (_) { /* ignore */ }
    if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
    if (this._historyFlushTimer) { clearTimeout(this._historyFlushTimer); this._historyFlushTimer = null; }
    this._flushHistory();
    if (this.snapshotManager) this.snapshotManager.stop();
    if (this.discordBot) {
      try { await this.discordBot.stop(); } catch (_) { /* ignore */ }
      this.discordBot = null;
      this._discordBotReady = false;
    }
    this._discordCatalogCache = { at: 0, data: null, inflight: null };
    if (this._discordChannelInsightCache) this._discordChannelInsightCache.clear();
    // Let any in-flight fabric transition settle before tearing down.
    if (this._fabricTransition) { try { await this._fabricTransition; } catch (_) { /* logged */ } }
    await this._stopFabric();
    if (this.missionManager) await this.missionManager.stop();
    if (this.groupManager) await this.groupManager.stop();
    if (this.registerStore) await this.registerStore.stop();
    if (this.server) {
      await new Promise((r) => this.server.close(r));
      this.server = null;
    }
    this.state.status = 'STOPPED';
    this._stopping = false;
    this.emit('stopped');
    return this;
  }
}

module.exports = StarCitizenService;
module.exports.BEARER_TTL_MS = BEARER_TTL_MS;
