'use strict';

/**
 * Star Citizen Live - Fabric-free service (M1 skeleton + M3 parser).
 *
 * Boots with ZERO external dependencies - only Node.js built-ins (http, crypto,
 * events, fs, readline) plus global fetch (identity/group crypto loads lazily).
 * This file is the SERVICE DEFINITION only — the server entry that boots it
 * from the environment is `scripts/node.js` (`npm start`).
 *
 * Features: in-memory collections, REST endpoints, live log tailing (read-only,
 * optional) AND offline replay, real Game.log event parsing (functions/parser.js),
 * optional Discord webhook posting, and the mission/contract seam.
 *
 * It edits NOTHING in the Star Citizen installation - the log is only ever read.
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
const cumulativeHistory = require('../functions/cumulativeHistory');
const logCorpus = require('../functions/logCorpus');
const fsBrowser = require('../functions/fsBrowser');
const activityTree = require('../functions/activityTree');
const gooncitizenGameState = require('../functions/gooncitizenGameState');
const eventChain = require('../functions/eventChain');
const peerProfile = require('../functions/peerProfile');
const presence = require('../functions/presence');
const hubPeeringObserve = require('../functions/hubPeeringObserve');
const liveFeed = require('../functions/liveFeed');
const {
  createFabricMessageLog,
  summarizeMessage
} = require('../functions/fabricMessageLog');
const starjumpFleet = require('../functions/starjumpFleet');
const shipCatalog = require('../functions/shipCatalog');
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
    this.settings = Object.assign({
      port: 3041,
      listen: true, // false = embed via apiHandler() on a host HTTP server (goon.vc)
      mode: 'relay', // 'relay' = local log tailing; 'server' = hosted API (no log, signed ingest required)
      logfile: null,
      channel: null, // SC channel (LIVE/PTU/EPTU/HOTFIX/TECH-PREVIEW) for display
      seed: null,   // optional: replay a past log once on start to pre-fill the monitor
      discord: { enable: false, webhook: null, announceKills: true, announcePlayerJoins: true, announceActivities: false, announceMissions: false, announceCombat: false, announceIncaps: false },
      missions: { enable: true },
      uplink: { enable: false, url: null, intervalMs: 5000 }, // legacy; Fabric Peer is the peering transport
      fabric: null, // { enable, listen, port, interface, peers, peersDb, relayAppMessages }
      settingsDir: null, // Hub-style named store root (stores/gooncitizen); register defaults beneath it
      store: null // optional pre-started types/Store instance (Electron main / scripts/node.js)
    }, settings);
    this.settings.discord = Object.assign({ enable: false, webhook: null, announceKills: true, announcePlayerJoins: true, announceActivities: false, announceMissions: false, announceCombat: false, announceIncaps: false }, settings.discord || {});
    this.settings.uplink = Object.assign({ enable: false, url: null, intervalMs: 5000 }, settings.uplink || {});
    // Fabric Peer (TCP/NOISE). Disabled in hosted server mode (hub agent) and
    // by default under NODE_ENV=test unless explicitly enabled.
    const fabricDefaults = {
      enable: this.settings.mode !== 'server' && process.env.NODE_ENV !== 'test',
      listen: true,
      port: 7777,
      interface: '0.0.0.0',
      peers: null, // null → use operator peer roster
      peersDb: null,
      relayAppMessages: false
    };
    this.settings.fabric = Object.assign(fabricDefaults, settings.fabric || {});
    // Signed ingest is mandatory in server mode; opt-in locally.
    this.settings.ingest = Object.assign({ requireSigned: this.settings.mode === 'server' }, settings.ingest || {});

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
    /** @type {{ bio: string|null, scHandle: string|null }|null} local social profile */
    this._profile = null;
    /** public hostname for P2P_PEERING_OFFER (optional) */
    this._fabricAdvertiseHost = null;
    /** @type {Record<string, string>} mesh P2P_PEER_ALIAS by author pubkey */
    this._peerAliasByPubkey = Object.create(null);
    /** @type {Record<string, object>} PeerProfile cache by pubkey */
    this._peerProfilesByPubkey = Object.create(null);
    /** @type {Record<string, object>} PeerPresence cache by pubkey */
    this._peerPresenceByPubkey = Object.create(null);
    /** ISO timestamp of the last parsed Game.log event (online window). */
    this._lastLogEventAt = null;
    /** @type {{ classId: string, vehicleId: string|null, name: string|null, slug: string|null, at: string }|null} */
    this._detectedShip = null;
    /** @type {{ slug: string, name: string, at: string }|null} manual ship override */
    this._shipOverride = null;
    this._sharePresence = false;
    this._presenceVisibility = 'private';
    this._presenceGroupIds = [];
    this._shipOverrideSlug = null;
    this._presenceAvailability = 'auto';
    this._presenceStatusText = null;
    this._lastPresencePublish = 0;
    /** Last nickname announced on the mesh (dedupe ensure → alias spam). */
    this._lastPublishedAlias = null;
    /** @type {object|null} cached Hub / WebRTC observe snapshot */
    this._hubObserve = null;
    this._hubObserveTimer = null;
    this._hubObserveInflight = null;
    /** Max auto-rostered non-hub peers from gossip/offer. */
    this._maxDiscoveredPeers = 12;
    /** @type {Promise<import('../services/FabricNetwork')|null>|null} */
    this._fabricEnsureInflight = null;
    this._seq = 0;
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
    this.on('error', (e) => console.error('[STAR-CITIZEN] error:', (e && e.message) || e));

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
      this.registerStore = new Store({ path: registerDir });
      if (registerDir) console.log(`[STAR-CITIZEN] register store: ${registerDir}`);
    }

    this.missionManager = (this.settings.missions && this.settings.missions.enable)
      ? new MissionManager(Object.assign({}, this.settings.missions, { store: this.registerStore }))
      : null;

    // Groups: member-created k-of-n Schnorr multisig units (mission scoping +
    // authority sets). Shares the register Store with missions.
    const groupSettings = Object.assign(
      { enable: true },
      this.settings.groups || {},
      { store: this.registerStore }
    );
    this.groupManager = groupSettings.enable !== false ? new GroupManager(groupSettings) : null;
    if (this.missionManager && this.groupManager) this.missionManager.groupManager = this.groupManager;
    if (this.groupManager) {
      // Federation contract publish + GroupChange fan-out (best-effort).
      this.groupManager.on('group:created', (group, meta) => {
        this._publishGroupContractFor(group, meta && meta.definition).catch((e) => this.emit('error', e));
      });
      this.groupManager.on('group:local-change', (change) => {
        this._publishGroupChange(change).catch((e) => this.emit('error', e));
      });
    }
    this._wireRegisterInbox();

    // Chat: Hub-style ChatMessage records — global channel + one per group.
    // Global posts use P2P_CHAT_MESSAGE; group posts use GroupChat CONTRACT_MESSAGE.
    const ChatManager = require('../services/ChatManager');
    this.chatManager = new ChatManager({ store: this.registerStore, groupManager: this.groupManager });

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
      if (this.missionManager) this.payoutManager.attach(this.missionManager);
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
    const persisted = settingsStore.loadSettings(this.registerStore);
    // Explicit constructor `peers: []` keeps an empty roster (tests / custom).
    const constructorEmpty = Array.isArray(this.settings.peers) && this.settings.peers.length === 0;
    // Explicit empty save via Peers UI — do not re-seed hubs (removal respected).
    const persistedCleared = Array.isArray(persisted.peers) && persisted.peers.length === 0;
    if (!this.peers.length && Array.isArray(persisted.peers)) {
      this.peers = persisted.peers.map((p) => this._normalizePeerRecord(p)).filter(Boolean);
    } else if (!this.peers.length && persisted.peers === undefined && this.settings.mode !== 'server') {
      // First boot (peers never configured): seed network Fabric hubs.
      const seeds = this.settings.peers !== undefined
        ? this.settings.peers
        : DEFAULT_PEERS;
      this.peers = (seeds || []).map((p) => this._normalizePeerRecord(p)).filter(Boolean);
    }
    // Constructor peers (tests / custom deploys): only strip true self-loops.
    // Persisted desktop roster: drop self-loops and re-seed hubs when none left
    // (old saves that only dialed localhost break chat gossip).
    if (!constructorEmpty && this.settings.mode !== 'server') {
      const fromConstructor = Array.isArray(this.settings.peers) && this.settings.peers.length > 0;
      if (fromConstructor) {
        this._healPeerRoster({ persist: false, dropSelf: true });
      } else if (!persistedCleared) {
        this._healPeerRoster({ persist: true, dropSelf: true, ensureHubs: true });
      }
    }
    if (persisted.uplinkIntervalMs) this.settings.uplink.intervalMs = persisted.uplinkIntervalMs;
    if (persisted.fabricPort != null && Number(persisted.fabricPort) > 0) {
      this.settings.fabric.port = Number(persisted.fabricPort);
    }
    // Sharing parsed log events: default OFF (explicit authorize on Peers / Settings).
    this._shareLogsGlobal = persisted.shareLogsGlobal === true;
    this._nickname = persisted.nickname || null;
    this._profile = peerProfile.sanitizeProfile(persisted.profile);
    this._fabricAdvertiseHost = persisted.fabricAdvertiseHost || null;
    this._notifyMissionBroadcasts = persisted.notifyMissionBroadcasts !== false;
    this._applySnapshotSettings(persisted);
    this._applyPresenceSettings(persisted);
  }

  _applyPresenceSettings (persisted = {}) {
    const share = presence.sanitizePresenceShare({
      sharePresence: persisted.sharePresence,
      presenceVisibility: persisted.presenceVisibility,
      presenceGroupIds: persisted.presenceGroupIds,
      shipOverrideSlug: persisted.shipOverrideSlug,
      presenceAvailability: persisted.presenceAvailability,
      presenceStatusText: persisted.presenceStatusText
    });
    this._sharePresence = share.sharePresence;
    this._presenceVisibility = share.presenceVisibility;
    this._presenceGroupIds = share.presenceGroupIds.slice();
    this._shipOverrideSlug = share.shipOverrideSlug;
    this._presenceAvailability = share.presenceAvailability;
    this._presenceStatusText = share.presenceStatusText;
    this._shipOverride = share.shipOverrideSlug
      ? presence.buildShipOverride(share.shipOverrideSlug)
      : null;
  }

  /**
   * Drop self-loop peers; optionally restore network hub seeds.
   * `forceHubs` (Peers → Restore network seeds) also strips all loopback and
   * re-adds hub.fabric.pub + relay.goon.vc.
   * @param {{ persist?: boolean, dropSelf?: boolean, ensureHubs?: boolean, forceHubs?: boolean }} [opts]
   * @returns {{ removed: string[], added: string[] }}
   */
  _healPeerRoster (opts = {}) {
    const removed = [];
    const forceHubs = opts.forceHubs === true;
    const dropSelf = forceHubs || opts.dropSelf === true;
    const dropAllLoopback = forceHubs;
    const listenPort = Number(this.settings.fabric && this.settings.fabric.port) || 7777;
    const before = this.peers.slice();
    this.peers = before.filter((p) => {
      if (!p || !p.address) return false;
      if (dropAllLoopback && FabricNetwork.isLoopbackFabricAddress(p.address)) {
        removed.push(p.address);
        return false;
      }
      if (dropSelf && FabricNetwork.isSelfFabricAddress(p.address, listenPort)) {
        removed.push(p.address);
        return false;
      }
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
        const row = this._normalizePeerRecord(seed);
        if (!row) continue;
        this.peers.push(row);
        have.add(address);
        added.push(address);
      }
    }
    if (opts.persist && (removed.length || added.length)) {
      this._persistPeers();
    }
    if (removed.length) {
      console.log(`[STAR-CITIZEN] dropped self/loopback Fabric peers: ${removed.join(', ')}`);
    }
    if (added.length) {
      console.log(`[STAR-CITIZEN] restored network hub seeds: ${added.join(', ')}`);
    }
    return { removed, added };
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
    const address = FabricNetwork.normalizeFabricAddress(
      p.address || p.url,
      { migrate: true }
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
      lastSeen: p.lastSeen || null,
      lastError: p.lastError || null
    };
  }

  /** Enabled Fabric peer addresses (`host:port`) — excludes self-loop dials. */
  _fabricPeerAddresses () {
    const listenPort = Number(this.settings.fabric && this.settings.fabric.port) || 7777;
    return this.peers
      .filter((p) => p.enabled !== false && p.address)
      .map((p) => p.address)
      .filter((a) => !FabricNetwork.isSelfFabricAddress(a, listenPort));
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
   * @returns {{ to?: string[] }|null}
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
      }
    } catch (_) { /* chat optional */ }
    let broadcasts = [];
    try {
      broadcasts = this._listMissionBroadcasts({ pendingOnly: false, viewer: null }) || [];
    } catch (_) { broadcasts = []; }
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
      recent: this.recent
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
    return this.peers.map((p) => {
      const address = p.address;
      const connected = connectedSet.some((id) => FabricNetwork.connectionMatchesAddress(id, address));
      const isPrimary = FabricNetwork.isNetworkHubAddress(address) ||
        /hub\.fabric\.pub|relay\.goon\.vc|goon\.vc/i.test(String(p.label || ''));
      const reg = this.fabricNetwork && typeof this.fabricNetwork.lookupPeerRegistry === 'function'
        ? this.fabricNetwork.lookupPeerRegistry(address)
        : null;
      const pubkey = (reg && reg.id) || null;
      const cached = pubkey ? this._peerProfilesByPubkey[pubkey] : null;
      const alias = (pubkey && this._peerAliasByPubkey[pubkey]) ||
        (reg && (reg.alias || reg.nickname)) ||
        (cached && cached.nickname) ||
        null;
      return Object.assign({}, p, {
        shareLogs: p.shareLogs === true,
        connected,
        transport: 'fabric-tcp',
        primary: isPrimary,
        discovered: p.discovered === true,
        pubkey,
        alias,
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
      self: isSelf
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
   * Profile page payload keyed by Fabric pubkey (chat members, presence roster).
   * Works even when the peer is not in the configured TCP roster.
   * @param {string} pubkey
   * @returns {object|null}
   */
  _profileDetailByPubkey (pubkey) {
    const pk = String(pubkey || '').trim();
    if (!/^0[23][0-9a-fA-F]{64}$/.test(pk) && !/^[0-9a-fA-F]{64}$/.test(pk)) return null;
    const isSelf = !!(this._identity && this._identity.pubkey === pk);
    const rosterPeer = this._peersWithStatus().find((p) => p.pubkey === pk) || null;
    const cached = this._peerProfilesByPubkey[pk] || null;
    const alias = this._peerAliasByPubkey[pk] || (rosterPeer && rosterPeer.alias) || null;
    const local = this._localProfile();
    const remotePresence = this._peerPresenceByPubkey[pk] || null;
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
      self: isSelf
    };
  }

  _linkedDeviceForPubkey (pubkey) {
    if (!pubkey || !this.registerStore) return null;
    const persisted = settingsStore.loadSettings(this.registerStore);
    const list = Array.isArray(persisted.linkedDevices) ? persisted.linkedDevices : [];
    return list.find((d) => d && (d.peerFabricId === pubkey || d.pubkey === pubkey)) || null;
  }

  /**
   * Promote gossip/offer addresses onto the roster (shareLogs off) and dial.
   * @param {string[]} addresses
   * @param {'offer'|'gossip'} kind
   */
  _considerDiscoveredPeers (addresses, kind) {
    if (!Array.isArray(addresses) || !addresses.length) return;
    const listenPort = Number(this.settings.fabric && this.settings.fabric.port) || 7777;
    const have = new Set(this.peers.map((p) => p.address));
    const discoveredCount = this.peers.filter((p) => p.discovered === true && !FabricNetwork.isNetworkHubAddress(p.address)).length;
    let added = 0;
    for (const raw of addresses) {
      const address = FabricNetwork.normalizeFabricAddress(raw, { migrate: false });
      if (!address || have.has(address)) continue;
      if (FabricNetwork.isSelfFabricAddress(address, listenPort)) continue;
      if (FabricNetwork.isLoopbackFabricAddress(address)) continue;
      if (FabricNetwork.isNetworkHubAddress(address)) continue;
      if (discoveredCount + added >= this._maxDiscoveredPeers) break;
      const peer = {
        id: idFor(address),
        address,
        label: kind === 'gossip' ? 'discovered (gossip)' : 'discovered (offer)',
        enabled: true,
        shareLogs: false,
        discovered: true
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
   * @param {{ force?: boolean }} [opts]
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

  _startHubObserveTimer () {
    if (this._hubObserveTimer || this.settings.mode === 'server') return;
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
    if (this.settings.mode === 'server') return { changed: false, files: 0, lines: 0 };

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
    return Object.assign({}, result, { files: files.length });
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
   * @param {{
   *   dirs?: string[],
   *   files?: string[],
   *   sync?: boolean,
   *   replaceDirs?: boolean,
   *   replaceFiles?: boolean
   * }} [opts]
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
   * Compact game-state document for Hub sidechain `/gooncitizen` (beacon-sealed).
   * @param {{ source?: string|null }} [opts]
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
    if (!this.settings.logfile || this.settings.mode === 'server') return;
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
    const session = { token, pubkey: envelope.pubkey, createdAt: Date.now(), expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
    this._sessions[token] = session;
    // Cap session table growth.
    const keys = Object.keys(this._sessions);
    if (keys.length > 5000) delete this._sessions[keys[0]];
    return { token, pubkey: session.pubkey, expiresAt: new Date(session.expiresAt).toISOString() };
  }

  /**
   * Resolve the acting identity for register mutations. In hosted server
   * mode the authenticated session pubkey is authoritative (bodies cannot
   * impersonate); locally the body-provided actor id is kept (M5 behavior).
   */
  _actor (req, bodyValue) {
    if (this.settings.mode === 'server') return this._authPubkey(req);
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
    }
    if (this.groupManager) {
      this.groupManager.on('audit', (entry) => {
        const row = registerInbox.entryFromGroupAudit(entry);
        if (row) this._appendInbox(row);
      });
      this.groupManager.on('group:application-accepted', (app) => {
        this._resolveInboxWhere(
          (r) => r.kind === 'GroupApplication' && (
            (r.refs && r.refs.applicationId === app.id) ||
            (r.refs && r.refs.groupId === app.groupId && r.source === app.applicantId)
          ),
          { status: 'accepted', actionable: false, resolvedAt: app.decidedAt || new Date().toISOString() }
        );
      });
      this.groupManager.on('group:application-rejected', (app) => {
        this._resolveInboxWhere(
          (r) => r.kind === 'GroupApplication' && (
            (r.refs && r.refs.applicationId === app.id) ||
            (r.refs && r.refs.groupId === app.groupId && r.source === app.applicantId)
          ),
          { status: 'rejected', actionable: false, resolvedAt: app.decidedAt || new Date().toISOString() }
        );
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
   * Publish a mission offer over Fabric (MissionBroadcast CONTRACT_MESSAGE).
   * Creator-only; open missions only. Scope defaults to group when the mission
   * has a groupId, else network-wide (`global` — all connected Fabric peers).
   * Group scope is membership-filtered on receive (group + subgroups).
   * @param {string} missionId
   * @param {string} actor Creator pubkey
   * @param {{ scope?: 'global'|'group', groupId?: string }} [opts]
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
    this.fabricNetwork.publishGroupChange(contractId, change);
    return change;
  }

  async _handle (req, res) {
    const base = '/services/star-citizen';
    const url = new URL(req.url, `http://localhost:${this.settings.port}`);
    const pathname = url.pathname;
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj, null, 2)); };
    // Read the JSON body. When embedded behind Express (goon.vc Hub), body-parser
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
      // GET /sessions → same dashboard (header SiteLogin buttons).
      const serveSpa = siteLogin === 'spa' ||
        (req.method === 'GET' && (pathname === '/' || pathname === `${base}/ui` ||
          pathname === '/groups' || /^\/groups\/[^/]+$/.test(pathname) ||
          pathname === '/profiles' || /^\/profiles\/[^/]+$/.test(pathname) ||
          pathname === '/missions' || /^\/missions\/[^/]+$/.test(pathname)));
      if (serveSpa) {
        let html;
        try {
          const uiPath = path.join(__dirname, '..', 'assets', 'index.html');
          html = this._uiHtml || (this._uiHtml = fs.readFileSync(uiPath, 'utf8'));
        } catch (_) {
          html = '<h1>GoonCitizen</h1><p>UI missing — run <code>npm run build:browser</code> to generate assets/index.html from components/Dashboard.js.</p>';
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
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
        return send(200, { type: 'Collection', data: this.missionGroups });
      }
      // Combat progress inferred from mission objectives (proxy for kills).
      if (req.method === 'GET' && pathname === `${base}/combat`) {
        return send(200, { type: 'Collection', data: this.combatlog });
      }
      // Analytics: compact merged dataset (backfilled history + live session) for
      // the "Analyze" dashboard tab. The client slices it by month/year + pilot +
      // mission type + outcome. Local-player today; same shape serves shared multi-pilot history (M4).
      if (req.method === 'GET' && pathname === `${base}/analytics`) {
        return send(200, this._analyticsDataset());
      }
      // Player log corpus: every Game.log + logbackup feeding cumulative Analyze.
      if (req.method === 'GET' && pathname === `${base}/corpus`) {
        return send(200, this._corpusStatus());
      }
      if (req.method === 'POST' && pathname === `${base}/corpus/sync`) {
        if (this.settings.mode === 'server') {
          return send(400, { error: 'corpus sync is a local-player operation' });
        }
        const result = await this._syncCumulativeHistory();
        return send(200, { type: 'LogCorpusSync', result, corpus: this._corpusStatus() });
      }
      // Import folders and/or individual *.log files into cumulative history (local only).
      if (req.method === 'POST' && pathname === `${base}/corpus/import`) {
        if (this.settings.mode === 'server') {
          return send(400, { error: 'corpus import is a local-player operation' });
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
        const listing = fsBrowser.listDirectory(url.searchParams.get('path'));
        return send(listing.error && listing.error === 'path not found' ? 404 : 200, listing);
      }
      // Fabric Tree over cumulative history leaves (preview or publish to a Group).
      if (req.method === 'GET' && pathname === `${base}/activity-tree`) {
        const tree = activityTree.buildActivityTree(this.history, {
          ownerPubkey: (this._identity && this._identity.pubkey) || null
        });
        return send(200, tree);
      }
      if (req.method === 'POST' && pathname === `${base}/activity-tree/publish`) {
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
        if (req.method === 'GET' && pathname === '/settings') {
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
              mode: this.settings.mode,
              identity: this._identity ? this._identity.pubkey : null,
              uplinkActive: !!this._uplinkTimer,
              uplinkQueued: this._uplinkQueue.length,
              shareLogsGlobal: this._shareLogsGlobal === true,
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
              snapshots: this.snapshotManager ? this.snapshotManager.stats() : null
            }
          });
        }
        let sMatch;
        if ((sMatch = pathname.match(/^\/settings\/([a-zA-Z]+)$/)) && req.method === 'PUT') {
          if (!editable) return send(400, { error: 'No persistent store configured (settingsDir)' });
          const d = await body();
          try {
            const updated = settingsStore.putSetting(store, sMatch[1], d.value);
            // Live-applicable settings take effect immediately; the rest on restart.
            let requiresRestart = ['logfile', 'channel', 'discordWebhook'].includes(sMatch[1]);
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
            if (sMatch[1] === 'nickname') {
              this._nickname = updated.nickname || null;
              this._publishPeerAlias(this._nickname).catch((e) => this.emit('error', e));
              this._publishLocalProfile().catch((e) => this.emit('error', e));
              requiresRestart = false;
            }
            if (sMatch[1] === 'profile') {
              this._profile = peerProfile.sanitizeProfile(updated.profile);
              this._publishLocalProfile().catch((e) => this.emit('error', e));
              requiresRestart = false;
            }
            if (sMatch[1] === 'fabricAdvertiseHost') {
              this._fabricAdvertiseHost = updated.fabricAdvertiseHost || null;
              if (this.fabricNetwork) this.fabricNetwork.setAdvertiseHost(this._fabricAdvertiseHost);
              if (this.fabricNetwork) this.fabricNetwork.maybePublishPeeringOffer({ force: true });
              requiresRestart = false;
            }
            if (sMatch[1] === 'notifyMissionBroadcasts') { this._notifyMissionBroadcasts = updated.notifyMissionBroadcasts !== false; requiresRestart = false; }
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
            return send(200, { success: true, settings: updated, requiresRestart });
          } catch (e) { return send(400, { error: e.message }); }
        }
        if (pathname === `${base}/peers` || pathname === '/peers') {
          if (req.method === 'GET') return send(200, { type: 'Collection', data: this._peersWithStatus() });
          if (req.method === 'POST') {
            const d = await body();
            const address = FabricNetwork.normalizeFabricAddress(d.address || d.url, { migrate: false });
            if (!address) return send(400, { error: 'peer address must be host:port (Fabric), e.g. relay.goon.vc:7777' });
            if (FabricNetwork.isLoopbackFabricAddress(address)) {
              return send(400, { error: 'loopback peers (localhost / 127.0.0.1) are not dialed — use hub.fabric.pub:7777 or relay.goon.vc:7777' });
            }
            if (this.peers.some((p) => p.address === address)) return send(400, { error: 'peer already exists' });
            const peer = {
              id: idFor(address),
              address,
              label: d.label || null,
              enabled: d.enabled !== false,
              shareLogs: d.shareLogs === true
            };
            this.peers.push(peer);
            this._persistPeers();
            this._refreshFabric().catch((e) => this.emit('error', e));
            this.emit('peer:added', peer);
            return send(200, { type: 'Peer', data: this._peersWithStatus().find((p) => p.id === peer.id) || peer });
          }
        }
        if (pathname === `${base}/peers/restore-seeds` || pathname === '/peers/restore-seeds') {
          if (req.method === 'POST') {
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
            return send(200, { type: 'PeerProfile', data: this._localProfile() });
          }
        }
        let profileMatch;
        if ((profileMatch = pathname.match(new RegExp(`^(?:${base})?/profiles/([^/]+)$`))) && req.method === 'GET') {
          const detail = this._profileDetailByPubkey(decodeURIComponent(profileMatch[1]));
          if (!detail) return send(404, { error: 'Profile not found (invalid pubkey)' });
          return send(200, { type: 'PeerProfileDetail', data: detail });
        }
        if (pathname === `${base}/presence` || pathname === '/presence') {
          if (req.method === 'GET') {
            return send(200, { type: presence.PRESENCE_TYPE, data: this.getPresenceStatus() });
          }
          if (req.method === 'PUT') {
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
            const d = await body();
            try {
              const slug = d && d.autodetect === true ? null : (d && d.slug);
              const result = this.setShipOverride(slug);
              return send(200, { type: presence.PRESENCE_TYPE, data: result });
            } catch (e) {
              return send(400, { error: e.message, code: e.code || null });
            }
          }
        }
        if (pathname === `${base}/presence/roster` || pathname === '/presence/roster') {
          if (req.method === 'GET') {
            return send(200, {
              type: 'PeerPresenceRoster',
              data: this.getPresenceRoster()
            });
          }
        }
        // Fabric AMP Message log (wire Messages only — not Game.log). Advanced UI.
        if (pathname === `${base}/fabric/messages` || pathname === '/fabric/messages') {
          if (req.method === 'GET') {
            const q = url.searchParams;
            const hideKeepalive = q.get('keepalive') !== '1' && q.get('hideKeepalive') !== '0';
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
            return send(200, { type: 'FabricMessageLog', data: this._fabricMessageLog.clear() });
          }
        }
        if (pathname === `${base}/fabric/messages/clear` || pathname === '/fabric/messages/clear') {
          if (req.method === 'POST' || req.method === 'DELETE') {
            return send(200, { type: 'FabricMessageLog', data: this._fabricMessageLog.clear() });
          }
        }
        if (pathname === `${base}/fabric/messages/pause` || pathname === '/fabric/messages/pause') {
          if (req.method === 'POST') {
            this._fabricMessageLog.pause();
            return send(200, { type: 'FabricMessageLog', meta: this._fabricMessageLog.status() });
          }
        }
        if (pathname === `${base}/fabric/messages/resume` || pathname === '/fabric/messages/resume') {
          if (req.method === 'POST') {
            this._fabricMessageLog.resume();
            return send(200, { type: 'FabricMessageLog', meta: this._fabricMessageLog.status() });
          }
        }
        if (pathname === `${base}/network/observe` || pathname === '/network/observe') {
          if (req.method === 'GET') {
            const force = url.searchParams.get('refresh') === '1';
            const snap = await this._refreshHubObserve({ force });
            return send(200, { type: 'NetworkObserve', data: snap });
          }
        }
        let pMatch;
        if ((pMatch = pathname.match(new RegExp(`^(?:${base})?/peers/([^/]+)$`)))) {
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
          return send(200, { type: 'LogInfo', data: this._logInfo() });
        }
        // Browse the raw log by byte window (the file can be hundreds of MB —
        // never read it whole). Client pages with start offsets.
        if (req.method === 'GET' && pathname === `${base}/logslice`) {
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
          const job = await this._runReparse();
          return send(200, { type: 'Reparse', data: job });
        }
        if (req.method === 'GET' && pathname === `${base}/reparse`) {
          return send(200, { type: 'Reparse', data: this._reparse });
        }

        // ---- Ship catalog + personal fleets (Starjump / custom) ----
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
            const limit = parseInt(url.searchParams.get('limit'), 10) || 200;
            const before = url.searchParams.get('before') || null;
            return send(200, { type: 'Collection', data: sm.list({ limit, before }), stats: sm.stats() });
          }
          if (req.method === 'DELETE') {
            const removed = sm.purgeAll();
            return send(200, { success: true, removed });
          }
        }
        let snapMatch;
        if (sm && (snapMatch = pathname.match(new RegExp(`^${base}/snapshots/([^/]+)/image$`))) && req.method === 'GET') {
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

      // ---- Groups (k-of-n Schnorr multisig units / Federation contracts) ----
      const Group = require('../types/Group');
      const gm = this.groupManager;
      const viewer = this._authPubkey(req);
      const serverMode = this.settings.mode === 'server';
      let gmatch = null;
      // In hosted mode every mutation requires an authenticated session.
      const requireAuth = () => {
        if (serverMode && !viewer) { send(401, { error: 'Authentication required (POST …/auth with a signed login envelope)' }); return false; }
        return true;
      };

      // ---- Chat (Hub ChatMessage types: global + group:<id> channels) ----
      const cm = this.chatManager;
      if (cm && req.method === 'GET' && pathname === `${base}/chat/channels`) {
        return send(200, { type: 'Collection', data: cm.channelsFor(viewer, { enforceMembership: serverMode }) });
      }
      if (cm && pathname === `${base}/chat/messages`) {
        if (req.method === 'GET') {
          const channel = url.searchParams.get('channel') || 'global';
          if (!cm.canAccess(channel, viewer, { enforceMembership: serverMode })) {
            return send(403, { error: 'forbidden: not a member of this channel' });
          }
          const since = url.searchParams.get('since') || null;
          const limit = parseInt(url.searchParams.get('limit'), 10) || 200;
          return send(200, { type: 'Collection', data: cm.list(channel, { since, limit }) });
        }
        if (req.method === 'POST') {
          const d = await body();
          try {
            let record;
            if (serverMode) {
              // Hosted: a Schnorr-signed envelope is the message of record —
              // { pubkey, payload: { channel, body, ts, handle? }, signature }.
              const check = this._checkEnvelope(d);
              if (!check.ok) return send(check.code, { error: check.error });
              const p = d.payload || {};
              if (!cm.canAccess(p.channel || 'global', d.pubkey, { enforceMembership: true })) {
                return send(403, { error: 'forbidden: not a member of this channel' });
              }
              record = cm.post({ channel: p.channel, body: p.body, ts: p.ts, handle: p.handle, author: d.pubkey });
            } else {
              // Local relay: author is the unlocked identity (or session pubkey).
              const author = viewer || (this._identity && this._identity.pubkey) || d.author || null;
              if (!author) return send(401, { error: 'Unlock your identity to chat' });
              record = cm.post({
                channel: d.channel,
                body: d.body,
                // Prefer an explicit handle, then the operator nickname, then
                // the in-game session login — pubkey remains the author id.
                handle: d.handle || this._nickname || this._sessionHandle || null,
                author
              });
              // Publish over Fabric (P2P_CHAT_MESSAGE); Peer auto-relays.
              if (this._identity && this._identity.pubkey === record.author) {
                this._publishChat(record).catch((e) => this.emit('error', e));
              }
            }
            return send(200, { type: 'ChatMessage', data: record });
          } catch (e) {
            return send(/forbidden/i.test(e.message) ? 403 : 400, { error: e.message });
          }
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
          const creator = viewer || d.creator; // local relay may specify creator explicitly
          try {
            const group = await gm.createGroup(d, creator);
            // group:created listener publishes CONTRACT_PUBLISH when Fabric is up.
            this._publishGroupContractFor(group).catch((e) => this.emit('error', e));
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
          const data = await this.ingestOpaqueGroupShare(d.protocolUrl || d.messageHex || d.hex || '');
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
            inviteePubkey: d.inviteePubkey || d.invitee || d.pubkey || null
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
              activityTree: null
            }
          });
        }
        try {
          const groupStatechain = require('../functions/groupStatechain');
          const doc = groupStatechain.loadDoc(this.registerStore, group.contractId);
          const digest = groupStatechain.stateDigestOfContent(doc.content || {});
          const journalLimit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 100));
          const entries = (doc.journal.entries || []).slice(-journalLimit).reverse();
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
                activityTree: doc.content && doc.content.activityTree
              },
              journal: { entries: isMember ? entries : entries.map((e) => ({
                id: e.id,
                type: e.type,
                clock: e.clock,
                acceptedAt: e.acceptedAt
              })) },
              activityTree: (doc.content && doc.content.activityTree) || null
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
          const data = d.remove
            ? await gm.removeMember(group.id, d.pubkey, actor)
            : await gm.addMember(group.id, d.pubkey, actor);
          return send(200, { type: 'Group', data });
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
        return send(200, { type: 'Collection', data: gm ? gm.audit : [] });
      }

      // Signed batch ingest: remote relays push Schnorr-signed event batches.
      // Envelope: { pubkey, payload: { events: [{ collection, data }, …] }, signature }.
      // Idempotent — replayed batches upsert to the same content-derived ids.
      if (req.method === 'POST' && pathname === `${base}/events`) {
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
          if (req.method === 'GET') return send(200, { type: 'Collection', data: getter() });
          if (req.method === 'POST' && name !== 'messages' && name !== 'logins' && name !== 'notifications' && name !== 'incaps' && name !== 'deaths') {
            const data = await body();
            // Server mode (goon.vc): unsigned single-event POSTs are rejected —
            // remote relays must use the signed batch endpoint above.
            if (this.settings.ingest.requireSigned) {
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
      // Read-only lists.
      if (req.method === 'GET' && pathname === `${base}/applications`) return send(200, { type: 'Collection', data: reg ? reg.applications : [] });
      if (req.method === 'GET' && pathname === `${base}/claims`) return send(200, { type: 'Collection', data: reg ? reg.claims : [] });
      if (req.method === 'GET' && pathname === `${base}/validations`) return send(200, { type: 'Collection', data: reg ? reg.validations : [] });
      if (req.method === 'GET' && pathname === `${base}/audit`) return send(200, { type: 'Collection', data: reg ? reg.audit : [] });
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
          const app = await reg.applyToMission({ missionId: rec.missionId, applicantId: actor, message: 'via broadcast' });
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
        const d = await body(); return run(() => reg.submitClaim(Object.assign({}, d, { missionId: mr[1], claimantId: this._actor(req, d.claimantId) })), 'Claim');
      }
      if ((mr = pathname.match(new RegExp(`^${base}/applications/([^/]+)/decision$`))) && req.method === 'POST') {
        if (!requireAuth()) return;
        const d = await body(); return run(() => reg.decideApplication(Object.assign({}, d, { applicationId: mr[1], officerId: this._actor(req, d.officerId) })), 'Application');
      }
      if ((mr = pathname.match(new RegExp(`^${base}/claims/([^/]+)/validate$`))) && req.method === 'POST') {
        if (!requireAuth()) return;
        const d = await body(); return run(() => reg.validateClaim(Object.assign({}, d, { claimId: mr[1], officerId: this._actor(req, d.officerId) })), 'Validation');
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
            escrows
          }
        });
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
            data: { groupId: group.id, keys: [...group.members].sort(), threshold: group.threshold, mode: 'disabled', address: null, note: 'configure payouts (bitcoind RPC) to derive addresses' }
          });
        }
        try {
          const wallet = await pm.multisigAddress(group.members, group.threshold);
          return send(200, { type: 'GroupWallet', data: Object.assign({ groupId: group.id }, wallet) });
        } catch (e) { return send(400, { error: e.message }); }
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
          const built = await pm.buildPayout(m.escrow, d.toAddress || m.escrow.payee);
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
    if (!this.settings.discord.enable || !this.settings.discord.webhook) return null;
    if (typeof fetch !== 'function') return null;
    try {
      return await fetch(this.settings.discord.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch (e) { this.emit('error', e); return null; }
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
   * @param {{ relay?: boolean }} [opts]
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
        // Legacy JSON envelopes (object.body/content) are no longer accepted on the wire.
        const text = (msg && msg.text != null)
          ? String(msg.text)
          : ((msg.object && (msg.object.body != null ? msg.object.body : msg.object.content)) || null);
        const author = resolveSignerPubkey(source, msg && msg.actor) || source || null;
        if (!author || text == null || !String(text).trim()) return;
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
        this._peerPresenceByPubkey[signer] = presence.mergeRemotePresence(
          this._peerPresenceByPubkey[signer],
          Object.assign({}, object, { pubkey: signer })
        );
      },
      onDirectChat: (object, source) => {
        if (!this.chatManager || !object) return;
        const ChatManager = require('../services/ChatManager');
        const author = resolveSignerPubkey(source) || source || null;
        if (!author || !object.body) return;
        const channel = object.channel || ChatManager.dmChannelKey(object.peerA, object.peerB);
        if (!channel || !ChatManager.parseDmChannel(channel)) return;
        const me = this._identity && this._identity.pubkey;
        // Only keep DMs addressed to this node (or authored here).
        if (me && !this.chatManager.canAccess(channel, me, { enforceMembership: true })) return;
        try {
          this.chatManager.ingest(author, {
            channel,
            body: object.body,
            author: object.author || author,
            handle: object.handle || this._peerAliasByPubkey[author] || null,
            ts: object.ts || new Date().toISOString()
          });
        } catch (e) {
          if (!/must match|unknown channel|invalid/i.test(e.message || '')) this.emit('error', e);
        }
      },
      onPeeringCandidate: (ev) => {
        if (!ev || !Array.isArray(ev.addresses)) return;
        this._considerDiscoveredPeers(ev.addresses, ev.kind || 'gossip');
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
        const body = object.body != null ? object.body : object.content;
        const ts = object.ts || new Date().toISOString();
        if (!author || !body) return;
        try {
          this.chatManager.ingest(author, {
            channel: `group:${group.id}`,
            body,
            author,
            handle: object.handle || null,
            ts,
            id: object.id || null
          });
        } catch (e) {
          if (!/must match|unknown channel/i.test(e.message || '')) this.emit('error', e);
        }
      },
      onGroupChange: (object, source, meta) => {
        if (!this.groupManager || !object) return;
        try {
          const change = Object.assign({}, object, {
            contractId: object.contractId || (meta && meta.contract) || null
          });
          this.groupManager.ingestGroupChange(change, resolveSignerPubkey(source) || source);
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
          if (kind === 'MissionBroadcast' || (inner && inner.mission)) {
            if (!resolved) return;
            this._ingestMissionBroadcast(resolved, inner);
          }
          if (kind === starjumpFleet.FLEET_SHARE_TYPE ||
            (inner && (inner.kind === starjumpFleet.FLEET_SHARE_TYPE || inner.type === starjumpFleet.FLEET_SHARE_TYPE))) {
            this._ingestFleetShare(inner && inner.kind === starjumpFleet.FLEET_SHARE_TYPE ? inner : (inner || object), resolved);
          }
          if (kind === presence.PRESENCE_TYPE ||
            (inner && (inner.kind === presence.PRESENCE_TYPE || inner.type === presence.PRESENCE_TYPE))) {
            const doc = inner && inner.kind === presence.PRESENCE_TYPE ? inner : (inner || object);
            if (resolved && doc) {
              this._peerPresenceByPubkey[resolved] = presence.mergeRemotePresence(
                this._peerPresenceByPubkey[resolved],
                Object.assign({}, doc, { pubkey: resolved })
              );
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
   * @param {{ scope?: 'all'|'mine'|'shared'|'public' }} [opts]
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
   * @param {{ name?: string, ships?: object[], visibility?: string, groupIds?: string[] }} data
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
   * @param {{ json?: object|string, path?: string, sample?: string, name?: string, visibility?: string }} data
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
   * Body: `{ slug|name, count?, variant?, remove? }` or `{ ships: [...] }` to replace.
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
   * Share a fleet to peers, groups, and/or public mesh.
   * @param {string} id
   * @param {{ visibility?: string, groupIds?: string[], includeExport?: boolean, relay?: boolean }} [opts]
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
    if (visibility === 'groups' && !groupIds.length && this.groupManager) {
      groupIds = (this.groupManager.groups || []).map((g) => g.id);
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

  _buildPresenceDocument () {
    return presence.buildPresenceDocument({
      pubkey: this._identity ? this._identity.pubkey : null,
      nickname: this._nickname,
      lastEventAt: this._lastLogEventAt,
      detectedShip: this._detectedShip,
      shipOverride: this._shipOverride,
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
        presenceAvailability: this._presenceAvailability,
        presenceStatusText: this._presenceStatusText
      },
      detectedShip: this._detectedShip,
      shipOverride: this._shipOverride,
      online: doc.online,
      lastEventAt: this._lastLogEventAt
    };
  }

  /**
   * Cached PeerPresence keyed by pubkey (includes self when sharing).
   * Remote entries are only those received while peers opted into sharePresence.
   */
  getPresenceRoster () {
    const out = Object.create(null);
    for (const [pubkey, doc] of Object.entries(this._peerPresenceByPubkey || {})) {
      if (!pubkey || !doc) continue;
      out[pubkey] = {
        // Trust published online (supports force online/offline).
        online: doc.online === true,
        statusText: doc.statusText || null,
        lastEventAt: doc.lastEventAt || null,
        ship: doc.ship || null,
        nickname: doc.nickname || null,
        updatedAt: doc.updatedAt || doc.lastSeen || null
      };
    }
    const me = this._identity && this._identity.pubkey;
    if (me) {
      const local = this._buildPresenceDocument();
      out[me] = {
        online: local.online,
        statusText: local.statusText || null,
        lastEventAt: local.lastEventAt,
        ship: local.ship,
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
      presenceAvailability: this._presenceAvailability,
      presenceStatusText: this._presenceStatusText
    }, patch));
    settingsStore.putSetting(this.registerStore, 'sharePresence', next.sharePresence);
    settingsStore.putSetting(this.registerStore, 'presenceVisibility', next.presenceVisibility);
    settingsStore.putSetting(this.registerStore, 'presenceGroupIds', next.presenceGroupIds.length ? next.presenceGroupIds : null);
    settingsStore.putSetting(this.registerStore, 'shipOverrideSlug', next.shipOverrideSlug);
    settingsStore.putSetting(this.registerStore, 'presenceAvailability', next.presenceAvailability);
    settingsStore.putSetting(this.registerStore, 'presenceStatusText', next.presenceStatusText);
    this._applyPresenceSettings(next);
    if (this._sharePresence) {
      this.publishPresence().catch((e) => this.emit('error', e));
    }
    return this.getPresenceStatus();
  }

  /**
   * Manual current-ship override (`slug`) or autodetect (`null`).
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
      this._peerPresenceByPubkey[me] = presence.mergeRemotePresence(
        this._peerPresenceByPubkey[me],
        doc
      );
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
    if (this.settings.fabric.enable === false || this.settings.mode === 'server') return null;
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
        messageLog: this._fabricMessageLog
      });
      this.fabricNetwork.setHandlers(this._fabricIngestHandlers());
      this.fabricNetwork.on('error', (e) => this.emit('error', e));
    }
    this.fabricNetwork.setIdentity(this._identity);
    this.fabricNetwork.setAdvertiseHost(this._fabricAdvertiseHost || null);
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
   * @param {{ force?: boolean }} [opts] force=true republishes even if unchanged
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
    if (!this._identity || this.settings.fabric.enable === false || this.settings.mode === 'server') {
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
    console.log(`[STAR-CITIZEN] fabric peering active` + (seeds.length ? ` → ${seeds.join(', ')}` : ''));
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
   * @param {import('@fabric/core/types/message')[]} messages signed acceptance / PSBT frames
   * @param {{ purpose?: string, statePatch?: object[], psbtProposalBase64?: string }} [opts]
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
          ts: record.ts
        });
        return;
      }
      const groupId = ChatManager.groupIdOf(channel);
      if (!groupId) return;
      const contractId = await this._ensureGroupContractId(groupId);
      if (!contractId) return;
      this.fabricNetwork.publishGroupChat(contractId, {
        id: record.id,
        groupId,
        contractId,
        author: record.author,
        body: record.body,
        handle: record.handle || null,
        ts: record.ts
      });
    } catch (e) {
      this.emit('error', e);
    }
  }

  /**
   * Sign a GroupOffer CONTRACT_MESSAGE for copy-paste (`fabric:<hex>`).
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
    const encoded = this.fabricNetwork.encodeOpaqueMessage(msg);
    const st = this.fabricNetwork.status();
    return {
      kind: GROUP_SHARE_KIND_OFFER,
      offerId: offer.offerId,
      groupId: g.id,
      contractId,
      protocolUrl: encoded.protocolUrl,
      messageHex: encoded.messageHex,
      pagePath: g.path || `/groups/${g.slug || g.id}`,
      visibility: g.visibility,
      relayed,
      relayError,
      peers: st.fabricConnected || 0
    };
  }

  /**
   * Ingest an opaque fabric:<hex> GroupOffer / invite / group CONTRACT_PUBLISH.
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
      if (summary) this._fabricMessageLog.append(summary);
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
    if (inboxRow) this._appendInbox(inboxRow);
    this.emit('group:offer', payload);
    return payload;
  }

  /**
   * Publish a Hub-shaped FederationContractInvite under the group's contract
   * (and GoonCitizen genesis when targeting an invitee so they receive it
   * without already knowing the group).
   * @param {string} groupId
   * @param {string} actor Member inviting
   * @param {{ note?: string, inviteId?: string, inviteePubkey?: string }} [opts]
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
    const PUBKEY_RE = /^0[23][0-9a-f]{64}$/;
    let invitee = opts.inviteePubkey != null ? String(opts.inviteePubkey).trim().toLowerCase() : null;
    if (invitee) {
      if (!PUBKEY_RE.test(invitee)) {
        const e = new Error('invalid invitee pubkey'); e.code = 'BAD_REQUEST'; throw e;
      }
      if (invitee === String(actor).toLowerCase()) {
        const e = new Error('cannot invite yourself'); e.code = 'BAD_REQUEST'; throw e;
      }
      if (group.includes(invitee)) {
        const e = new Error('already a member of this group'); e.code = 'BAD_REQUEST'; throw e;
      }
    } else {
      invitee = null;
    }
    const { buildFederationContractInvite } = require('../functions/federationContractInvite');
    const { normalizeProposedPolicy } = require('../contracts/gooncitizenGroup');
    const { gooncitizenContractId } = require('../contracts/gooncitizen');
    const inviteId = opts.inviteId || idFor(`invite:${groupId}:${Date.now()}:${actor}:${invitee || ''}`);
    const invite = buildFederationContractInvite({
      inviteId,
      inviterHubId: actor,
      contractId,
      note: opts.note || `Join group ${group.name}`,
      inviteePubkey: invitee || undefined,
      groupId: group.id,
      groupName: group.name,
      proposedPolicy: normalizeProposedPolicy({
        validators: group.members,
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
    if (this.fabricNetwork.ready) {
      try {
        if (!(this.fabricNetwork.status().fabricConnected > 0)) {
          this.fabricNetwork.setPeers(this._fabricPeerAddresses());
        }
        this.fabricNetwork.publishFederationInvite(contractId, invite);
        // Genesis namespace so invitees who have never seen this group still get it.
        this.fabricNetwork.publishFederationInvite(gooncitizenContractId(), invite);
        relayed = true;
      } catch (e) {
        relayError = e && e.message ? e.message : String(e);
        this.emit('error', e);
      }
    } else {
      relayError = 'Fabric peer not ready — unlock identity and wait for peering';
    }
    const encoded = this.fabricNetwork.encodeOpaqueMessage(msg);
    const stored = Object.assign({}, invite, {
      groupId: group.id,
      groupName: group.name,
      status: 'pending',
      createdAt: new Date().toISOString(),
      protocolUrl: encoded.protocolUrl,
      messageHex: encoded.messageHex,
      direction: 'outbound'
    });
    if (this.registerStore) {
      this.registerStore.put('groupinvites', inviteId, stored);
    }
    const st = this.fabricNetwork.status();
    return Object.assign({}, invite, {
      groupId: group.id,
      groupName: group.name,
      protocolUrl: encoded.protocolUrl,
      messageHex: encoded.messageHex,
      relayed,
      relayError,
      peers: st.fabricConnected || 0
    });
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

  _ingestFederationInvite (object, source, meta) {
    const {
      parseFederationContractInviteLoose
    } = require('../functions/federationContractInvite');
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
      ? String(this._identity.pubkey).toLowerCase()
      : null;
    const invitee = invite.inviteePubkey ? String(invite.inviteePubkey).toLowerCase() : null;
    // Targeted invite: only the invitee keeps a persistent copy + inbox row.
    if (invitee && (!me || me !== invitee)) {
      return { kind: 'FederationContractInvite', invite, pending: false, skipped: 'not-invitee' };
    }
    if (me && invite.inviterHubId && String(invite.inviterHubId).toLowerCase() === me) {
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
    if (inboxRow) this._appendInbox(inboxRow);
    this.emit('group:invite', invite);
    return {
      kind: 'FederationContractInvite',
      invite,
      group: group || null,
      created,
      pending: true,
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
    if (this.registerStore) await this.registerStore.start();
    this._loadPersistedSettings(); // peers + uplink cadence from the Fabric Store
    if (this.missionManager) await this.missionManager.start();
    if (this.groupManager) await this.groupManager.start();
    const serverMode = this.settings.mode === 'server';
    // 1) Fold Game.log + logbackups into durable cumulative history (cursor-based).
    // 2) Seed the Live tab from the current Game.log (session memory only).
    // 3) Tail new lines; those update both session state and cumulative history.
    if (!serverMode) {
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
      // Hosted hub (relay.goon.vc): durable cumulative aggregation from peer
      // SCEventBatch / GameStateSnapshot ingest — sealed into Hub sidechain.
      this._historyApplyLive = true;
      console.log(`[STAR-CITIZEN] cumulative aggregator: ${this._historyFile()}`);
    }
    if (this.settings.listen !== false) {
      this.server = http.createServer((req, res) => this._handle(req, res));
      await new Promise((resolve) => this.server.listen(this.settings.port, resolve));
    }
    if (this._identity) await this._refreshFabric();
    this.state.status = 'STARTED';
    this.state.startedAt = new Date().toISOString();
    this.emit('ready');
    if (this.server) console.log(`[STAR-CITIZEN] listening on http://localhost:${this.settings.port}/services/star-citizen`);
    else console.log('[STAR-CITIZEN] API ready (embedded mode, no listener)');
    return this;
  }

  async stop () {
    this.state.status = 'STOPPING';
    this._stopping = true;
    if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
    if (this._historyFlushTimer) { clearTimeout(this._historyFlushTimer); this._historyFlushTimer = null; }
    this._flushHistory();
    if (this.snapshotManager) this.snapshotManager.stop();
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
