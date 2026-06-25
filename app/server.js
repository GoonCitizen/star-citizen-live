'use strict';

/**
 * Star Citizen Live - Fabric-free service (M1 skeleton + M3 parser).
 *
 * Boots with ZERO external dependencies - only Node.js built-ins (http, crypto,
 * events, fs, readline) plus global fetch. No @fabric/hub, no SSH git deps, no
 * 400 MB install. `node app/server.js` just works.
 *
 * Features: in-memory collections, REST endpoints, live log tailing (read-only,
 * optional) AND offline replay, real Game.log event parsing (app/parser.js),
 * optional Discord webhook posting, and the mission/contract seam.
 *
 * It edits NOTHING in the Star Citizen installation - the log is only ever read.
 */

const http = require('http');
const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs');
const readline = require('readline');

const { parseLine, shipName, parseSessionInfo, missionType, isNPC, missionFaction } = require('./parser');
const { resolveLogFile, channelFromPath } = require('./locate');

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

class StarCitizenService extends EventEmitter {
  constructor (settings = {}) {
    super();
    this.settings = Object.assign({
      port: 3041,
      logfile: null,
      channel: null, // SC channel (LIVE/PTU/EPTU/HOTFIX/TECH-PREVIEW) for display
      seed: null,   // optional: replay a past log once on start to pre-fill the monitor
      discord: { enable: false, webhook: null, announceKills: true, announcePlayerJoins: true, announceActivities: false, announceMissions: false, announceCombat: false, announceIncaps: false },
      missions: { enable: true }
    }, settings);
    this.settings.discord = Object.assign({ enable: false, webhook: null, announceKills: true, announcePlayerJoins: true, announceActivities: false, announceMissions: false, announceCombat: false, announceIncaps: false }, settings.discord || {});

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

    // Safety net: a stray 'error' (e.g. the game rotating Game.log) must never
    // crash the process. Without a listener, EventEmitter throws on 'error'.
    this.on('error', (e) => console.error('[STAR-CITIZEN] error:', (e && e.message) || e));

    const MissionManager = require('../services/MissionManager');
    this.missionManager = (this.settings.missions && this.settings.missions.enable)
      ? new MissionManager(this.settings.missions) : null;

    this.history = this._loadHistory();   // compact backfill of past logs (Analyze tab)

    if (this.settings.discord.enable) this._wireDiscord();
  }

  // Load the backfilled history aggregate (built by `npm run backfill`), if present.
  _loadHistory () {
    const empty = { missions: [], deaths: [], sessions: [], heat: {}, players: [], meta: {} };
    try {
      const f = this.settings.historyFile || require('path').join(__dirname, '..', 'stores', 'history.json');
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
  async _handle (req, res) {
    const base = '/services/star-citizen';
    const url = new URL(req.url, `http://localhost:${this.settings.port}`);
    const path = url.pathname;
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj, null, 2)); };
    const body = async () => { const c = []; for await (const ch of req) c.push(ch); return c.length ? JSON.parse(Buffer.concat(c).toString()) : {}; };

    try {
      // Live monitor web UI (read-only dashboard).
      if (req.method === 'GET' && (path === '/' || path === `${base}/ui`)) {
        let html;
        try { html = this._uiHtml || (this._uiHtml = fs.readFileSync(require('path').join(__dirname, 'ui.html'), 'utf8')); }
        catch (_) { html = '<h1>Star Citizen Live</h1><p>UI file missing (app/ui.html).</p>'; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }
      // Grouped missions (by MissionId), objectives joined in.
      if (req.method === 'GET' && path === `${base}/missiongroups`) {
        return send(200, { type: 'Collection', data: this.missionGroups });
      }
      // Combat progress inferred from mission objectives (proxy for kills).
      if (req.method === 'GET' && path === `${base}/combat`) {
        return send(200, { type: 'Collection', data: this.combatlog });
      }
      // Analytics: compact merged dataset (backfilled history + live session) for
      // the "Analyze" dashboard tab. The client slices it by month/year + pilot +
      // mission type + outcome. Local-player today; same shape serves org-wide (M4).
      if (req.method === 'GET' && path === `${base}/analytics`) {
        return send(200, this._analyticsDataset());
      }
      // Snapshot for the monitor UI: counts + recent + combat candidates (newest first).
      if (req.method === 'GET' && path === `${base}/monitor`) {
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
      if (req.method === 'GET' && path === base) {
        return send(200, { type: 'StarCitizen', data: {
          status: this.status, startedAt: this.state.startedAt, channel: this.channel, session: this.session, sessions: this.sessions.length,
          activities: this.activities.length, players: this.players.length, logins: this.logins.length,
          vehicles: this.vehicles.length, kills: this.kills.length, incaps: this.incaps.length, deaths: this.deaths.length,
          missionlog: this.missionlog.length, missionStats: this.missionStats(),
          logs: this.logs.length, missions: this.missions.length
        }});
      }
      const collections = { activities: () => this.activities, players: () => this.players, logins: () => this.logins, vehicles: () => this.vehicles, kills: () => this.kills, incaps: () => this.incaps, deaths: () => this.deaths, missionlog: () => this.missionlog, notifications: () => this.notifications, messages: () => this.logs };
      for (const [name, getter] of Object.entries(collections)) {
        if (path === `${base}/${name}`) {
          if (req.method === 'GET') return send(200, { type: 'Collection', data: getter() });
          if (req.method === 'POST' && name !== 'messages' && name !== 'logins' && name !== 'notifications' && name !== 'incaps' && name !== 'deaths') {
            const data = await body();
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
      if (path === `${base}/missions`) {
        if (req.method === 'GET') return send(200, { type: 'Collection', data: this.missions });
        if (req.method === 'POST') {
          if (!this.missionManager) return send(503, { error: 'Mission system not available' });
          try { return send(200, { type: 'Mission', data: await this.missionManager.createMission(await body()) }); }
          catch (e) { return send(e.code === 'FORBIDDEN' ? 403 : 400, { error: e.message }); }
        }
      }
      const mMatch = path.match(new RegExp(`^${base}/missions/([^/]+)$`));
      if (mMatch && req.method === 'GET') {
        if (!this.missionManager) return send(503, { error: 'Mission system not available' });
        const m = this.missionManager.getMission(mMatch[1]);
        return m ? send(200, { type: 'Mission', data: m }) : send(404, { error: 'Mission not found' });
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
      if (req.method === 'GET' && path === `${base}/applications`) return send(200, { type: 'Collection', data: reg ? reg.applications : [] });
      if (req.method === 'GET' && path === `${base}/claims`) return send(200, { type: 'Collection', data: reg ? reg.claims : [] });
      if (req.method === 'GET' && path === `${base}/validations`) return send(200, { type: 'Collection', data: reg ? reg.validations : [] });
      if (req.method === 'GET' && path === `${base}/audit`) return send(200, { type: 'Collection', data: reg ? reg.audit : [] });
      // Mission sub-resources and actions.
      let mr;
      if ((mr = path.match(new RegExp(`^${base}/missions/([^/]+)/applications$`))) && req.method === 'GET')
        return send(200, { type: 'Collection', data: reg ? reg.getMissionApplications(mr[1]) : [] });
      if ((mr = path.match(new RegExp(`^${base}/missions/([^/]+)/cancel$`))) && req.method === 'POST') {
        const d = await body(); return run(() => reg.cancelMission(Object.assign({ missionId: mr[1] }, d)), 'Mission');
      }
      if ((mr = path.match(new RegExp(`^${base}/missions/([^/]+)/apply$`))) && req.method === 'POST') {
        const d = await body(); return run(() => reg.applyToMission(Object.assign({ missionId: mr[1] }, d)), 'Application');
      }
      if ((mr = path.match(new RegExp(`^${base}/missions/([^/]+)/claim$`))) && req.method === 'POST') {
        const d = await body(); return run(() => reg.submitClaim(Object.assign({ missionId: mr[1] }, d)), 'Claim');
      }
      if ((mr = path.match(new RegExp(`^${base}/applications/([^/]+)/decision$`))) && req.method === 'POST') {
        const d = await body(); return run(() => reg.decideApplication(Object.assign({ applicationId: mr[1] }, d)), 'Application');
      }
      if ((mr = path.match(new RegExp(`^${base}/claims/([^/]+)/validate$`))) && req.method === 'POST') {
        const d = await body(); return run(() => reg.validateClaim(Object.assign({ claimId: mr[1] }, d)), 'Validation');
      }

      return send(404, { error: 'Not found', path });
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

  // ---- Lifecycle ----
  async start () {
    this.state.status = 'STARTING';
    if (this.missionManager) await this.missionManager.start();
    // Seed FIRST (replays history), then start the live poller at the current
    // end-of-file so we only stream genuinely new lines and don't double-read.
    if (this.settings.seed) {
      try { const n = await this.replayLog(this.settings.seed); console.log(`[STAR-CITIZEN] seeded ${n} lines from ${this.settings.seed}`); }
      catch (e) { this.emit('error', e); }
    }
    this.openLog();
    this.server = http.createServer((req, res) => this._handle(req, res));
    await new Promise((resolve) => this.server.listen(this.settings.port, resolve));
    this.state.status = 'STARTED';
    this.state.startedAt = new Date().toISOString();
    this.emit('ready');
    console.log(`[STAR-CITIZEN] listening on http://localhost:${this.settings.port}/services/star-citizen`);
    return this;
  }

  async stop () {
    this.state.status = 'STOPPING';
    if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
    if (this.missionManager) await this.missionManager.stop();
    if (this.server) await new Promise((r) => this.server.close(r));
    this.state.status = 'STOPPED';
    this.emit('stopped');
    return this;
  }
}

module.exports = StarCitizenService;

if (require.main === module) {
  // Auto-locate the active log across drives/channels (SC_LOGFILE or SC_CHANNEL override).
  const resolved = resolveLogFile({ explicit: process.env.SC_LOGFILE || null, channel: process.env.SC_CHANNEL || null });
  if (resolved.file) console.log(`[STAR-CITIZEN] log: ${resolved.channel || '?'} channel (${resolved.source}) -> ${resolved.file}`);
  else console.log('[STAR-CITIZEN] no Game.log found across drives/channels - set SC_LOGFILE or SC_CHANNEL');
  const svc = new StarCitizenService({
    port: process.env.PORT || 3041,
    logfile: resolved.file,
    channel: resolved.channel,
    seed: process.env.SC_SEED || resolved.file,   // pre-fill from history by default
    missions: { enable: true, dir: process.env.SC_REGISTER_DIR || null, officers: (process.env.SC_OFFICERS || '').split(',').map((s) => s.trim()).filter(Boolean) },
    discord: { enable: !!process.env.DISCORD_WEBHOOK_URL, webhook: process.env.DISCORD_WEBHOOK_URL || null }
  });
  svc.start();
}
