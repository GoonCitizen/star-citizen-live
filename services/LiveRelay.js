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

const { parseLine, shipName, parseSessionInfo, missionType, isNPC, missionFaction } = require('../functions/parser');
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
const INGEST_COLLECTIONS = ['activities', 'players', 'vehicles', 'kills', 'deaths', 'incaps', 'missionlog'];

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
      settingsDir: null // dir for persisted operator settings (settings.json) + peer list
    }, settings);
    this.settings.discord = Object.assign({ enable: false, webhook: null, announceKills: true, announcePlayerJoins: true, announceActivities: false, announceMissions: false, announceCombat: false, announceIncaps: false }, settings.discord || {});
    this.settings.uplink = Object.assign({ enable: false, url: null, intervalMs: 5000 }, settings.uplink || {});
    // Signed ingest is mandatory in server mode; opt-in locally.
    this.settings.ingest = Object.assign({ requireSigned: this.settings.mode === 'server' }, settings.ingest || {});

    this.state = { status: 'STOPPED', activities: {}, players: {}, logins: {}, vehicles: {}, kills: {}, incaps: {}, deaths: {}, missionlog: {}, notifications: {}, logs: {}, startedAt: null };
    this.state.missionGroups = {};  // missions grouped by MissionId (built from the log)
    this.state.objectives = {};     // objective details keyed by ObjectiveId
    this.state.combatlog = {};      // combat progress inferred from mission objectives
    this.recent = [];   // rolling buffer of the latest lines (for the live monitor)
    this.flagged = [];  // lines matching INTEREST_HINTS - combat/mission candidates
    this.channel = this.settings.channel || channelFromPath(this.settings.logfile); // LIVE/HOTFIX/...
    this.session = {};  // build + hardware of the current game session
    this.sessions = []; // history of game sessions (one per launch detected)
    this._sessionHandle = null; // the session's player handle (for attributing incaps)
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
    // Loaded from the persisted operator settings; managed via REST.
    const persisted = this.settings.settingsDir ? settingsStore.loadSettings(this.settings.settingsDir) : {};
    this.peers = (Array.isArray(persisted.peers) ? persisted.peers : []).map((p) => Object.assign({ enabled: true }, p));
    if (persisted.uplinkIntervalMs) this.settings.uplink.intervalMs = persisted.uplinkIntervalMs;

    // Safety net: a stray 'error' (e.g. the game rotating Game.log) must never
    // crash the process. Without a listener, EventEmitter throws on 'error'.
    this.on('error', (e) => console.error('[STAR-CITIZEN] error:', (e && e.message) || e));

    const MissionManager = require('../services/MissionManager');
    this.missionManager = (this.settings.missions && this.settings.missions.enable)
      ? new MissionManager(this.settings.missions) : null;

    // Groups: member-created k-of-n Schnorr multisig units (mission scoping +
    // authority sets). Shares the register directory by default.
    const GroupManager = require('../services/GroupManager');
    const groupSettings = Object.assign({ enable: true, dir: (this.settings.missions && this.settings.missions.dir) || null }, this.settings.groups || {});
    this.groupManager = groupSettings.enable ? new GroupManager(groupSettings) : null;
    if (this.missionManager && this.groupManager) this.missionManager.groupManager = this.groupManager;

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

    if (this.settings.discord.enable) this._wireDiscord();
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
    const { canonicalStringify } = identityLib();
    const id = idFor(canonicalStringify({ source, collection, data }));
    const existed = !!this.state[collection][id];
    if (!existed) {
      this.state[collection][id] = Object.assign({ id, source }, data);
      if (collection === 'kills') this.emit('kill', this.state[collection][id]);
    }
    return { id, created: !existed };
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
      // Live monitor web UI (read-only dashboard) — built from components/Dashboard.js.
      if (req.method === 'GET' && (pathname === '/' || pathname === `${base}/ui`)) {
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
        const settingsDir = this.settings.settingsDir;
        if (req.method === 'GET' && pathname === '/settings') {
          const persisted = settingsDir ? settingsStore.loadSettings(settingsDir) : {};
          return send(200, {
            success: true,
            settings: persisted,
            editable: !!settingsDir,
            allowedKeys: settingsStore.ALLOWED_KEYS,
            runtime: {
              logfile: this.settings.logfile,
              channel: this.channel,
              port: this.settings.port,
              mode: this.settings.mode,
              identity: this._identity ? this._identity.pubkey : null,
              uplinkActive: !!this._uplinkTimer,
              uplinkQueued: this._uplinkQueue.length
            }
          });
        }
        let sMatch;
        if ((sMatch = pathname.match(/^\/settings\/([a-zA-Z]+)$/)) && req.method === 'PUT') {
          if (!settingsDir) return send(400, { error: 'No settings directory configured (settingsDir)' });
          const d = await body();
          try {
            const updated = settingsStore.putSetting(settingsDir, sMatch[1], d.value);
            // Live-applicable settings take effect immediately; the rest on restart.
            let requiresRestart = ['logfile', 'channel', 'discordWebhook'].includes(sMatch[1]);
            if (sMatch[1] === 'peers') { this.peers = (updated.peers || []).map((p) => Object.assign({ enabled: true }, p)); this._refreshUplink(); requiresRestart = false; }
            if (sMatch[1] === 'uplinkIntervalMs') { this.settings.uplink.intervalMs = updated.uplinkIntervalMs || 5000; requiresRestart = false; }
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
            if (settingsDir) settingsStore.putSetting(settingsDir, 'peers', this.peers.map(({ lastSeen, lastError, ...p }) => p));
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
            if (settingsDir) settingsStore.putSetting(settingsDir, 'peers', this.peers.map(({ lastSeen, lastError, ...p }) => p));
            this._refreshUplink();
            this.emit('peer:removed', peer);
            return send(200, { success: true });
          }
          if (req.method === 'POST') {
            const d = await body();
            if (d.enabled !== undefined) peer.enabled = !!d.enabled;
            if (d.label !== undefined) peer.label = d.label || null;
            if (settingsDir) settingsStore.putSetting(settingsDir, 'peers', this.peers.map(({ lastSeen, lastError, ...p }) => p));
            this._refreshUplink();
            return send(200, { type: 'Peer', data: peer });
          }
        }
      }

      // Schnorr login: exchange a signed envelope for a Bearer session token.
      if (req.method === 'POST' && pathname === `${base}/auth`) {
        const result = this._login(await body());
        if (result.error) return send(result.code || 401, { error: result.error });
        return send(200, { type: 'Session', data: result });
      }

      // ---- Groups (k-of-n Schnorr multisig units) ----
      const gm = this.groupManager;
      const viewer = this._authPubkey(req);
      const serverMode = this.settings.mode === 'server';
      // In hosted mode every mutation requires an authenticated session.
      const requireAuth = () => {
        if (serverMode && !viewer) { send(401, { error: 'Authentication required (POST …/auth with a signed login envelope)' }); return false; }
        return true;
      };
      if (pathname === `${base}/groups`) {
        if (!gm) return send(503, { error: 'Group system not available' });
        if (req.method === 'GET') {
          // Members see their groups; unauthenticated hosted callers see none.
          const data = serverMode
            ? (viewer ? gm.groupsFor(viewer) : [])
            : (viewer ? gm.groupsFor(viewer) : gm.groups);
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
      if ((gmatch = pathname.match(new RegExp(`^${base}/groups/([^/]+)$`))) && req.method === 'GET') {
        if (!gm) return send(503, { error: 'Group system not available' });
        const group = gm.getGroup(gmatch[1]);
        if (!group) return send(404, { error: 'Group not found' });
        if (serverMode && (!viewer || !group.includes(viewer))) return send(403, { error: 'forbidden: not a group member' });
        return send(200, { type: 'Group', data: group.toJSON() });
      }
      if ((gmatch = pathname.match(new RegExp(`^${base}/groups/([^/]+)/members$`))) && req.method === 'POST') {
        if (!gm) return send(503, { error: 'Group system not available' });
        if (!requireAuth()) return;
        const d = await body();
        const actor = viewer || d.actor;
        try {
          const data = d.remove
            ? await gm.removeMember(gmatch[1], d.pubkey, actor)
            : await gm.addMember(gmatch[1], d.pubkey, actor);
          return send(200, { type: 'Group', data });
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

      // ---- Bitcoin escrow / payouts ----
      const pm = this.payoutManager;
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
      const queue = (collection) => (ev) => {
        if (!this._identity) return;
        this._uplinkQueue.push({ collection, data: ev });
        if (this._uplinkQueue.length > 5000) this._uplinkQueue.shift();
      };
      this.on('kill', queue('kills'));
      this.on('player:death', queue('deaths'));
      this.on('player:incap', queue('incaps'));
      this.on('vehicle:destroy', queue('vehicles'));
      this.on('mission:event', queue('missionlog'));
      this.on('player:join', (p) => {
        if (!this._identity) return;
        this._uplinkQueue.push({ collection: 'players', data: { name: p.name, timestamp: p.lastSeen } });
      });
    }
    const interval = this.settings.uplink.intervalMs || 5000;
    this._uplinkTimer = setInterval(() => { this._flushUplink().catch((e) => this.emit('error', e)); }, interval);
    if (this._uplinkTimer.unref) this._uplinkTimer.unref();
    console.log(`[STAR-CITIZEN] uplink active -> ${this._uplinkTargets().join(', ')}`);
  }

  _stopUplink () {
    if (this._uplinkTimer) { clearInterval(this._uplinkTimer); this._uplinkTimer = null; }
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
    if (this.missionManager) await this.missionManager.start();
    if (this.groupManager) await this.groupManager.start();
    const serverMode = this.settings.mode === 'server';
    // Seed FIRST (replays history), then start the live poller at the current
    // end-of-file so we only stream genuinely new lines and don't double-read.
    if (!serverMode && this.settings.seed) {
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
    this._stopUplink();
    if (this.missionManager) await this.missionManager.stop();
    if (this.groupManager) await this.groupManager.stop();
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
