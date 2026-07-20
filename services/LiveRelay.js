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

// Collections a remote relay may push into via the signed batch endpoint.
// 'chatmessages' carries Hub-style ChatMessage records (P2P_CHAT_MESSAGE wire events).
const INGEST_COLLECTIONS = ['activities', 'players', 'vehicles', 'kills', 'deaths', 'incaps', 'missionlog', 'chatmessages', 'missionbroadcasts'];

// The org's central relay — seeded as the default peer on first boot so log
// aggregation and chat work out of the box (removable in Peers).
const DEFAULT_PEER_URL = 'https://relay.goon.vc';

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
      uplink: { enable: false, url: null, intervalMs: 5000 },
      settingsDir: null, // Hub-style named store root (stores/gooncitizen); register defaults beneath it
      store: null // optional pre-started types/Store instance (Electron main / scripts/node.js)
    }, settings);
    this.settings.discord = Object.assign({ enable: false, webhook: null, announceKills: true, announcePlayerJoins: true, announceActivities: false, announceMissions: false, announceCombat: false, announceIncaps: false }, settings.discord || {});
    this.settings.uplink = Object.assign({ enable: false, url: null, intervalMs: 5000 }, settings.uplink || {});
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

    // Peers: remote hubs (e.g. goon.vc) that receive this relay's signed
    // event batches — the desktop counterpart of the Hub's AddPeer/RemovePeer.
    // Loaded from the Fabric Store settings in start(); managed via REST.
    this.peers = [];

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

    // Chat: Hub-style ChatMessage records — global channel + one per group.
    // Local posts ride the signed uplink to peers; remote messages arrive via
    // the batch ingest and periodic peer pull (idempotent content ids).
    const ChatManager = require('../services/ChatManager');
    this.chatManager = new ChatManager({ store: this.registerStore, groupManager: this.groupManager });
    this._chatSince = {};      // `${peerUrl}|${channel}` → last pulled ts
    this._peerSessions = {};   // peerUrl → { token, expiresAt } (chat pull auth)

    // Periodic screen snapshots (opt-in; Electron injects the capture fn via
    // setSnapshotCapture). Images under <store root>/snapshots; metadata in
    // the Fabric Store. Idle in hosted server mode and pure-browser sessions.
    const SnapshotManager = require('../services/SnapshotManager');
    this.snapshotManager = new SnapshotManager({
      store: this.registerStore,
      dir: this.settings.settingsDir ? path.join(this.settings.settingsDir, 'snapshots') : null
    });

    // Bearer sessions issued by POST …/auth (Schnorr login challenge).
    this._sessions = {};

    // Bitcoin payouts: escrow mission rewards in authority multisig addresses.
    // settings.payouts = { enable, network, rpc, allowMainnet, feeSats }.
    this.payoutManager = null;
    if (this.settings.payouts && this.settings.payouts.enable !== false && (this.settings.payouts.rpc || this.settings.payouts.ledger)) {
      const PayoutManager = require('../services/PayoutManager');
      this.payoutManager = new PayoutManager(this.settings.payouts);
      if (this.missionManager) this.payoutManager.attach(this.missionManager);
    }

    this.history = this._loadHistory();   // compact backfill of past logs (Analyze tab)

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
    const { defaultDirs, findLogs } = require('../scripts/backfill');
    const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

    // Collect candidate files: backup dirs + the live log; oldest first by mtime.
    // settings.reparse.dirs overrides the auto-detected locations (tests / custom corpora).
    const dirs = (this.settings.reparse && Array.isArray(this.settings.reparse.dirs))
      ? this.settings.reparse.dirs
      : defaultDirs();
    const seen = new Set();
    const files = [];
    for (const dir of dirs) for (const f of findLogs(dir)) { if (!seen.has(f)) { seen.add(f); files.push(f); } }
    if (this.settings.logfile && !seen.has(this.settings.logfile) && fs.existsSync(this.settings.logfile)) {
      files.push(this.settings.logfile);
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
    if (!this.peers.length && Array.isArray(persisted.peers)) {
      this.peers = persisted.peers.map((p) => Object.assign({ enabled: true }, p));
    } else if (!this.peers.length && persisted.peers === undefined && this.settings.mode !== 'server') {
      // First boot (peers never configured): seed the org's central relay.
      // A user-saved empty list stays empty — removal is respected. Tests and
      // custom deployments override the seed via settings.peers.
      const seeds = this.settings.peers !== undefined
        ? this.settings.peers
        : [{ url: DEFAULT_PEER_URL, label: 'goon.vc central relay' }];
      this.peers = (seeds || []).map((p) => Object.assign({ id: idFor(p.url), enabled: true }, p));
    }
    if (persisted.uplinkIntervalMs) this.settings.uplink.intervalMs = persisted.uplinkIntervalMs;
    // Sharing parsed log events with peer hubs (org aggregation): default ON.
    this._shareLogsGlobal = persisted.shareLogsGlobal !== false;
    this._nickname = persisted.nickname || null;
    this._notifyMissionBroadcasts = persisted.notifyMissionBroadcasts !== false;
    this._applySnapshotSettings(persisted);
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

  // Load the backfilled history aggregate (built by `npm run backfill`), if present.
  _loadHistory () {
    const empty = { missions: [], deaths: [], sessions: [], heat: {}, players: [], meta: {} };
    try {
      const f = this.settings.historyFile || path.join(__dirname, '..', 'stores', 'history.json');
      if (fs.existsSync(f)) return Object.assign(empty, JSON.parse(fs.readFileSync(f, 'utf8')));
    } catch (e) { console.error('[STAR-CITIZEN] history load failed:', e.message); }
    return empty;
  }

  // Merge backfilled history with the current live session into one compact dataset
  // for the Analyze tab. Local-player today; the same shape serves org-wide (M4).
  _analyticsDataset () {
    const h = this.history || { missions: [], deaths: [], sessions: [], heat: {}, players: [], meta: {} };
    const me = this._sessionHandle || 'you';
    const liveM = this.missionGroups.map((m) => ({ type: m.type, faction: missionFaction(m.generator), outcome: m.outcome, player: m.player || me, ts: m.startedAt || m.firstSeen })).filter((x) => x.ts);
    const liveD = this.deaths.map((d) => ({ player: d.player || me, ts: d.timestamp })).filter((x) => x.ts);
    const liveS = this.sessions.map((s) => ({ player: me, ts: s.detectedAt })).filter((x) => x.ts);

    const heat = Object.assign({}, h.heat);
    for (const a of this.activities) {
      const t = Date.parse(a.timestamp); if (Number.isNaN(t)) continue;
      const d = new Date(t);
      const k = (d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')) + '|' + ((d.getDay() + 6) % 7) + '|' + d.getHours();
      heat[k] = (heat[k] || 0) + 1;
    }
    const heatcells = Object.keys(heat).map((k) => { const p = k.split('|'); return { ym: p[0], d: +p[1], h: +p[2], n: heat[k] }; });

    const missions = h.missions.concat(liveM);
    const deaths = h.deaths.concat(liveD);
    const sessions = (h.sessions || []).concat(liveS);
    const ymOf = (s) => (typeof s === 'string' && s.length >= 7) ? s.slice(0, 7) : null;
    const months = new Set();
    missions.forEach((m) => { const y = ymOf(m.ts); if (y) months.add(y); });
    deaths.forEach((d) => { const y = ymOf(d.ts); if (y) months.add(y); });
    heatcells.forEach((c) => months.add(c.ym));
    const players = [...new Set([].concat(h.players || [], this.players.map((p) => p.name), missions.map((m) => m.player), deaths.map((d) => d.player)))].filter(Boolean);

    return {
      type: 'Analytics',
      generatedAt: (h.meta && h.meta.generatedAt) || null,
      availableMonths: [...months].sort().reverse(),
      players,
      missions: missions.slice(-20000),
      deaths: deaths.slice(-20000),
      sessions,
      heatcells
    };
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
    }
    return { id, created: !existed };
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
    const { canonicalStringify } = identityLib();
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
      status: 'pending'
    };
    // Don't surface offers we originated (same node identity or creator).
    const me = this._identity && this._identity.pubkey;
    if (me && (source === me || ingested.mission.createdBy === me)) {
      record.status = 'self';
    }
    if (store) store.put('missionbroadcasts', id, record);
    else {
      this.state.missionbroadcasts = this.state.missionbroadcasts || {};
      this.state.missionbroadcasts[id] = record;
    }
    if (record.status === 'pending') this.emit('mission:broadcast', record);
    return { id, created: true };
  }

  _listMissionBroadcasts ({ pendingOnly = false } = {}) {
    const store = this.registerStore;
    const all = store
      ? store.all('missionbroadcasts')
      : Object.values(this.state.missionbroadcasts || {});
    const rows = all.slice().sort((a, b) => String(b.broadcastAt || '').localeCompare(String(a.broadcastAt || '')));
    return pendingOnly ? rows.filter((r) => r.status === 'pending') : rows;
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
   * Queue a mission offer to every enabled peer and flush immediately.
   * Creator-only; open missions only.
   */
  async broadcastMission (missionId, actor) {
    if (!this.missionManager) throw Object.assign(new Error('Mission system not available'), { code: 'UNAVAILABLE' });
    const m = this.missionManager.getMission(missionId);
    if (!m) throw Object.assign(new Error('Mission not found'), { code: 'NOT_FOUND' });
    if (m.status !== 'open') throw new Error(`mission is ${m.status}, not open`);
    if (!actor || m.createdBy !== actor) {
      const err = new Error('forbidden: only the creator can broadcast this mission');
      err.code = 'FORBIDDEN';
      throw err;
    }
    if (!this._identity || !this._uplinkTargets().length) {
      throw new Error('Unlock your identity and configure at least one peer to broadcast');
    }
    const broadcastAt = new Date().toISOString();
    const payload = {
      '@type': 'MissionBroadcast',
      missionId: m.id,
      broadcastAt,
      handle: this._nickname || this._sessionHandle || null,
      mission: {
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
      }
    };
    this._uplinkQueue.push({ collection: 'missionbroadcasts', data: payload });
    const results = await this._flushUplink();
    return {
      missionId: m.id,
      broadcastAt,
      peers: this._uplinkTargets().length,
      result: results
    };
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
      // SPA shell — dashboard at / and dedicated group pages at /groups/:id (or :slug).
      if (req.method === 'GET' && (pathname === '/' || pathname === `${base}/ui` || pathname === '/groups' || /^\/groups\/[^/]+$/.test(pathname))) {
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
      // mission type + outcome. Local-player today; same shape serves org-wide (M4).
      if (req.method === 'GET' && pathname === `${base}/analytics`) {
        return send(200, this._analyticsDataset());
      }
      // Snapshot for the monitor UI: counts + recent + combat candidates (newest first).
      if (req.method === 'GET' && pathname === `${base}/monitor`) {
        const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 250, 1000);
        const newest = (arr) => arr.slice(-limit).reverse();
        return send(200, {
          status: this.status, startedAt: this.state.startedAt, now: new Date().toISOString(),
          loginfo: this._logInfo(), reparse: this._reparse,
          channel: this.channel, session: this.session, sessions: this.sessions,
          missions: this.missionGroups,
          missionStats: this.missionStats(),
          kills: newest(this.kills),
          deaths: newest(this.deaths),
          counts: {
            activities: this.activities.length, players: this.players.length, logins: this.logins.length,
            vehicles: this.vehicles.length, kills: this.kills.length, incaps: this.incaps.length, deaths: this.deaths.length,
            missionlog: this.missionlog.length, missions: this.missionGroups.length, notifications: this.notifications.length,
            combat: this.combatlog.length,
            logs: this.logs.length, flagged: this.flagged.length
          },
          recent: newest(this.recent),
          flagged: newest(this.flagged)
        });
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
            if (sMatch[1] === 'peers') { this.peers = (updated.peers || []).map((p) => Object.assign({ enabled: true }, p)); this._refreshUplink(); requiresRestart = false; }
            if (sMatch[1] === 'uplinkIntervalMs') { this.settings.uplink.intervalMs = updated.uplinkIntervalMs || 5000; requiresRestart = false; }
            if (sMatch[1] === 'shareLogsGlobal') { this._shareLogsGlobal = updated.shareLogsGlobal !== false; requiresRestart = false; }
            if (sMatch[1] === 'nickname') { this._nickname = updated.nickname || null; requiresRestart = false; }
            if (sMatch[1] === 'notifyMissionBroadcasts') { this._notifyMissionBroadcasts = updated.notifyMissionBroadcasts !== false; requiresRestart = false; }
            if (sMatch[1].startsWith('snapshot')) { this._applySnapshotSettings(updated); requiresRestart = false; }
            if (sMatch[1].startsWith('notify')) { requiresRestart = false; }
            return send(200, { success: true, settings: updated, requiresRestart });
          } catch (e) { return send(400, { error: e.message }); }
        }
        if (pathname === `${base}/peers` || pathname === '/peers') {
          if (req.method === 'GET') return send(200, { type: 'Collection', data: this.peers });
          if (req.method === 'POST') {
            const d = await body();
            if (!d.url || !/^https?:\/\//.test(d.url)) return send(400, { error: 'peer url must be http(s)' });
            if (this.peers.some((p) => p.url === d.url)) return send(400, { error: 'peer already exists' });
            const peer = { id: idFor(d.url), url: d.url.replace(/\/$/, ''), label: d.label || null, enabled: d.enabled !== false };
            this.peers.push(peer);
            this._persistPeers();
            this._refreshUplink();
            this.emit('peer:added', peer);
            return send(200, { type: 'Peer', data: peer });
          }
        }
        let pMatch;
        if ((pMatch = pathname.match(new RegExp(`^(?:${base})?/peers/([^/]+)$`)))) {
          const peer = this.peers.find((p) => p.id === pMatch[1]);
          if (!peer) return send(404, { error: 'Peer not found' });
          if (req.method === 'DELETE') {
            this.peers = this.peers.filter((p) => p.id !== peer.id);
            this._persistPeers();
            this._refreshUplink();
            this.emit('peer:removed', peer);
            return send(200, { success: true });
          }
          if (req.method === 'POST') {
            const d = await body();
            if (d.enabled !== undefined) peer.enabled = !!d.enabled;
            if (d.label !== undefined) peer.label = d.label || null;
            this._persistPeers();
            this._refreshUplink();
            return send(200, { type: 'Peer', data: peer });
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

      // ---- Groups (k-of-n Schnorr multisig units) ----
      const Group = require('../types/Group');
      const gm = this.groupManager;
      const viewer = this._authPubkey(req);
      const serverMode = this.settings.mode === 'server';
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
              // Ride the signed uplink so the org (goon.vc) converges; the
              // server re-verifies author === batch signer.
              if (this._identity && this._identity.pubkey === record.author) {
                this._uplinkQueue.push({ collection: 'chatmessages', data: record });
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
          try { return send(200, { type: 'Group', data: await gm.createGroup(d, creator) }); }
          catch (e) { return send(e.code === 'FORBIDDEN' ? 403 : 400, { error: e.message }); }
        }
      }
      let gmatch;
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
          const applicant = viewer || d.applicantId;
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
      const visible = (m) => {
        if (!m) return false;
        if (!serverMode || !m.groupId) return true;
        return !!(viewer && gm && gm.isMember(m.groupId, viewer));
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
          try { return send(200, { type: 'Mission', data: await this.missionManager.createMission(Object.assign({}, d, { createdBy: creator })) }); }
          catch (e) { return send(e.code === 'FORBIDDEN' ? 403 : 400, { error: e.message }); }
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
        try {
          const data = await this.broadcastMission(mr[1], actor);
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
          data: this._listMissionBroadcasts({ pendingOnly }),
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
          return send(200, { type: 'MissionBroadcast', data: rec, application: app });
        } catch (e) {
          return send(/not found/i.test(e.message) ? 404 : 400, { error: e.message });
        }
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
          timestamp: ev.timestamp
        };
        this.state.kills[id] = kill;
        this.emit('kill', kill);
        break;
      }
      case 'player:login': {
        this._sessionHandle = ev.handle;
        this.recordPlayer(ev.handle, ev.timestamp);
        break;
      }
      case 'player:incap': {
        const inc = { id, kind: ev.kind, player: this._sessionHandle || null, text: ev.text, timestamp: ev.timestamp };
        this.state.incaps[id] = inc;
        this.emit('player:incap', inc);
        break;
      }
      case 'player:death': {
        // Local-player death (corpse-recovery body marker). One event per death;
        // SC stopped logging kills after 4.3.0, so this is the current-build signal.
        const d = { id, kind: ev.kind, player: this._sessionHandle || null, bodyId: ev.bodyId, timestamp: ev.timestamp };
        this.state.deaths[id] = d;
        this.emit('player:death', d);
        break;
      }
      case 'vehicle:destroy': {
        const v = { id, vehicle: ev.vehicle, vehicleName: shipName(ev.vehicle), cause: ev.cause, attacker: ev.attacker, fromLevel: ev.fromLevel, toLevel: ev.toLevel, timestamp: ev.timestamp };
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
          contractId: ev.contractId, completionType: ev.completionType, reason: ev.reason, player: ev.player };
        this.state.missionlog[id] = me;
        this._indexMission(ev);
        this.emit(ev.kind, me);
        this.emit('mission:event', me);
        break;
      }
      case 'hud:notification': {
        const n = { id, kind: ev.kind, text: ev.text, timestamp: ev.timestamp };
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

  // ---- Uplink (local relay -> hosted goon.vc server) ----

  /**
   * Provide (or clear) the player's decrypted identity. While set, parsed
   * events are queued and pushed to the configured uplink as Schnorr-signed
   * batches. Called by the Electron main process after unlock.
   * @param {Object|null} identity Decrypted identity ({ xprv, pubkey, … }) or null to lock.
   */
  setIdentity (identity) {
    this._identity = identity || null;
    if (this._identity && this._uplinkTargets().length) {
      this._startUplink();
    } else {
      this._stopUplink();
    }
  }

  /** Active uplink URLs: enabled peers + the legacy single-url setting. */
  _uplinkTargets () {
    const urls = this.peers.filter((p) => p.enabled !== false && p.url).map((p) => p.url);
    if (this.settings.uplink.enable && this.settings.uplink.url && !urls.includes(this.settings.uplink.url)) {
      urls.push(this.settings.uplink.url);
    }
    return urls;
  }

  /** Re-evaluate the uplink after the peer list changes. */
  _refreshUplink () {
    if (this._identity && this._uplinkTargets().length) this._startUplink();
    else this._stopUplink();
  }

  _startUplink () {
    if (this._uplinkTimer) return;
    this._uplinkQueue = this._uplinkQueue || [];
    if (!this._uplinkWired) {
      this._uplinkWired = true;
      // Log events push only while "share logs to global" is on; chat is
      // queued separately and is unaffected by the toggle.
      const queue = (collection) => (ev) => {
        if (!this._identity || this._shareLogsGlobal === false) return;
        this._uplinkQueue.push({ collection, data: ev });
        if (this._uplinkQueue.length > 5000) this._uplinkQueue.shift();
      };
      this.on('kill', queue('kills'));
      this.on('player:death', queue('deaths'));
      this.on('player:incap', queue('incaps'));
      this.on('vehicle:destroy', queue('vehicles'));
      this.on('mission:event', queue('missionlog'));
      this.on('player:join', (p) => {
        if (!this._identity || this._shareLogsGlobal === false) return;
        this._uplinkQueue.push({ collection: 'players', data: { name: p.name, timestamp: p.lastSeen } });
      });
    }
    const interval = this.settings.uplink.intervalMs || 5000;
    this._uplinkTimer = setInterval(() => {
      this._flushUplink().catch((e) => this.emit('error', e));
      this._syncChatFromPeers().catch((e) => this.emit('error', e));
    }, interval);
    if (this._uplinkTimer.unref) this._uplinkTimer.unref();
    console.log(`[STAR-CITIZEN] uplink active -> ${this._uplinkTargets().join(', ')}`);
  }

  _stopUplink () {
    if (this._uplinkTimer) { clearInterval(this._uplinkTimer); this._uplinkTimer = null; }
  }

  /**
   * Authenticate against a peer hub with the unlocked identity (Schnorr
   * login) and cache the Bearer session for chat pulls.
   * @returns {Promise<String|null>} Session token, or null.
   */
  async _peerSession (url) {
    if (!this._identity || typeof fetch !== 'function') return null;
    const cached = this._peerSessions[url];
    if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;
    try {
      const envelope = identityLib().signEnvelope(this._identity, { intent: 'login', ts: new Date().toISOString() });
      const res = await fetch(`${url.replace(/\/$/, '')}/services/star-citizen/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope)
      });
      if (!res.ok) return null;
      const json = await res.json();
      this._peerSessions[url] = {
        token: json.data.token,
        expiresAt: Date.parse(json.data.expiresAt) || (Date.now() + 3600000)
      };
      return json.data.token;
    } catch (_) {
      return null;
    }
  }

  /**
   * Pull new chat from every enabled peer: the global channel always, plus
   * the group channels the unlocked identity belongs to (authenticated with
   * a signed login session on the peer). Merging is idempotent — ids are
   * content-derived, so re-pulls and multi-peer overlap are no-ops.
   */
  async _syncChatFromPeers () {
    if (!this.chatManager || typeof fetch !== 'function') return;
    const targets = this._uplinkTargets();
    if (!targets.length) return;

    const channels = ['global'];
    if (this._identity && this.groupManager) {
      for (const g of this.groupManager.groupsFor(this._identity.pubkey)) channels.push('group:' + g.id);
    }

    for (const url of targets) {
      for (const channel of channels) {
        const key = `${url}|${channel}`;
        try {
          const headers = {};
          if (channel !== 'global') {
            const token = await this._peerSession(url);
            if (!token) continue;
            headers.Authorization = `Bearer ${token}`;
          }
          const q = new URLSearchParams({ channel, limit: '200' });
          if (this._chatSince[key]) q.set('since', this._chatSince[key]);
          const res = await fetch(`${url.replace(/\/$/, '')}/services/star-citizen/chat/messages?${q}`, { headers });
          if (!res.ok) continue;
          const json = await res.json();
          for (const m of (json.data || [])) {
            try {
              this.chatManager.post({ channel: m.channel, body: m.body, author: m.author, handle: m.handle, ts: m.ts, source: m.source || url });
              if (m.ts > (this._chatSince[key] || '')) this._chatSince[key] = m.ts;
            } catch (_) { /* channel unknown locally — skip */ }
          }
        } catch (_) { /* peer unreachable — retry next tick */ }
      }
    }
  }

  /**
   * Push queued events to every enabled peer as one signed batch. Server-side
   * ingest is idempotent (content-derived ids), so delivering the same batch
   * to multiple peers — or re-delivering after a partial failure — is safe.
   * Events are requeued only when EVERY peer fails.
   */
  async _flushUplink () {
    if (!this._identity || !this._uplinkQueue || !this._uplinkQueue.length) return null;
    if (typeof fetch !== 'function') return null;
    const targets = this._uplinkTargets();
    if (!targets.length) return null;
    const events = this._uplinkQueue.splice(0, 200);
    const envelope = identityLib().signEnvelope(this._identity, { events, sentAt: new Date().toISOString() });
    const body = JSON.stringify(envelope);

    const results = await Promise.all(targets.map(async (url) => {
      const peer = this.peers.find((p) => p.url === url);
      try {
        const res = await fetch(url.replace(/\/$/, '') + '/services/star-citizen/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body
        });
        if (!res.ok) {
          if (peer) peer.lastError = `HTTP ${res.status}`;
          this.emit('uplink:error', { url, status: res.status });
          // 4xx (bad roster/key) is a hard reject for this peer; 5xx may recover.
          return res.status >= 500 ? 'retry' : 'rejected';
        }
        const result = await res.json().catch(() => null);
        if (peer) { peer.lastSeen = new Date().toISOString(); peer.lastError = null; }
        this.emit('uplink:sent', { url, count: events.length, result });
        return result || 'ok';
      } catch (e) {
        if (peer) peer.lastError = e.message;
        this.emit('uplink:error', { url, error: e.message });
        return 'retry';
      }
    }));

    const delivered = results.some((r) => r !== 'retry' && r !== 'rejected');
    if (!delivered && results.some((r) => r === 'retry')) {
      this._uplinkQueue.unshift(...events); // nothing landed anywhere: retry next tick
      if (this._uplinkQueue.length > 5000) this._uplinkQueue.length = 5000;
      return null;
    }
    return results.find((r) => r !== 'retry' && r !== 'rejected') || null;
  }

  // ---- Lifecycle ----
  async start () {
    this.state.status = 'STARTING';
    if (this.registerStore) await this.registerStore.start();
    this._loadPersistedSettings(); // peers + uplink cadence from the Fabric Store
    if (this.missionManager) await this.missionManager.start();
    if (this.groupManager) await this.groupManager.start();
    const serverMode = this.settings.mode === 'server';
    // Seed FIRST (replays history), then start the live poller at the current
    // end-of-file so we only stream genuinely new lines and don't double-read.
    // A seed pointing at a not-yet-written log (default location) is skipped;
    // the poller below tails it the moment the game creates it.
    if (!serverMode && this.settings.seed && fs.existsSync(this.settings.seed)) {
      try { const n = await this.replayLog(this.settings.seed); console.log(`[STAR-CITIZEN] seeded ${n} lines from ${this.settings.seed}`); }
      catch (e) { this.emit('error', e); }
    }
    if (!serverMode) this.openLog();
    if (this.settings.listen !== false) {
      this.server = http.createServer((req, res) => this._handle(req, res));
      await new Promise((resolve) => this.server.listen(this.settings.port, resolve));
    }
    this._refreshUplink();
    this.state.status = 'STARTED';
    this.state.startedAt = new Date().toISOString();
    this.emit('ready');
    if (this.server) console.log(`[STAR-CITIZEN] listening on http://localhost:${this.settings.port}/services/star-citizen`);
    else console.log('[STAR-CITIZEN] API ready (embedded mode, no listener)');
    return this;
  }

  async stop () {
    this.state.status = 'STOPPING';
    if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
    if (this.snapshotManager) this.snapshotManager.stop();
    this._stopUplink();
    if (this.missionManager) await this.missionManager.stop();
    if (this.groupManager) await this.groupManager.stop();
    if (this.registerStore) await this.registerStore.stop();
    if (this.server) {
      await new Promise((r) => this.server.close(r));
      this.server = null;
    }
    this.state.status = 'STOPPED';
    this.emit('stopped');
    return this;
  }
}

module.exports = StarCitizenService;
