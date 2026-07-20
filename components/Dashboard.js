'use strict';

/**
 * GoonCitizen live monitor + analytics dashboard.
 * Source of truth for the desktop/browser UI; `npm run build:browser`
 * bundles this into assets/index.html.
 */

const React = require('react');
const Onboarding = require('./Onboarding');
const Identity = require('./Identity');
const FabricLoginModal = require('./FabricLoginModal');
const Chat = require('./Chat');
const GlobalChatDock = require('./GlobalChatDock');
const MissionBroadcastBanner = require('./MissionBroadcastBanner');
const Notifications = require('./Notifications');
const Groups = require('./Groups');
const Library = require('./Library');
const Missions = require('./Missions');
const Peers = require('./Peers');
const Settings = require('./Settings');
const Wallet = require('./Wallet');

const { FEATURES } = require('../constants');
const featureEnabled = (key) => FEATURES[key] !== false;

// Top-level features, listed along the top of the dashboard (Hub-style).
// Feature-flagged tabs (see constants.FEATURES) are filtered out when disabled.
const TABS = [
  ['home', 'Home'],
  ['live', 'Feed'],
  ['analyze', 'Analyze'],
  ['missions', 'Missions'],
  ['wallet', 'Wallet'],
  ['library', 'Library'],
  ['chat', 'Chat'],
  ['groups', 'Groups'],
  ['peers', 'Peers']
].filter(([k]) => featureEnabled(k));
// Advanced-only tabs — hidden unless "Advanced mode" is enabled in Settings.
const ADVANCED_TABS = new Set(['peers']);

// Notifications is opened from the header bell (not a primary feature tab).
const TAB_KEYS = TABS.map(([k]) => k).concat(['notifications']);

const ADVANCED_MODE_KEY = 'gooncitizen.advancedMode';

function readAdvancedMode () {
  try {
    return (typeof localStorage !== 'undefined') && localStorage.getItem(ADVANCED_MODE_KEY) === '1';
  } catch (_) {
    return false;
  }
}

function writeAdvancedMode (on) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (on) localStorage.setItem(ADVANCED_MODE_KEY, '1');
    else localStorage.removeItem(ADVANCED_MODE_KEY);
  } catch (_) { /* ignore */ }
}

const TITLE = 'GoonCitizen — Monitor';

const CSS = `
  :root{
    --bg:#0e1117; --panel:#161b22; --panel2:#1c232d; --line:#2a313c;
    --text:#e6edf3; --muted:#8b949e; --accent:#3b82f6;
    --good:#3fb950; --warn:#d29922; --raw:#6e7681; --kill:#f85149;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);
       font-family:'Segoe UI',system-ui,sans-serif;font-size:14px}
  header{position:sticky;top:0;z-index:5;background:var(--panel);
         border-bottom:1px solid var(--line);padding:12px 18px}
  .row{display:flex;flex-wrap:wrap;align-items:center;gap:14px}
  h1{font-size:17px;margin:0;font-weight:650}
  .pill{padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600}
  .pill.on{background:rgba(63,185,80,.15);color:var(--good)}
  .pill.off{background:rgba(248,81,73,.15);color:var(--kill)}
  .idchip{border:1px solid transparent;cursor:pointer;font-family:inherit}
  .idchip.off{background:rgba(210,153,34,.15);color:var(--warn)}
  .idchip:hover{border-color:var(--accent)}
  .counts{display:flex;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:12.5px}
  .counts b{color:var(--text)}
  .counts .k b{color:var(--kill)}
  .ctrl{margin-left:auto;display:flex;gap:12px;align-items:center;color:var(--muted);font-size:12.5px}
  input[type=text]{background:var(--bg);border:1px solid var(--line);color:var(--text);
       border-radius:6px;padding:6px 9px;font-size:13px;min-width:240px}
  label{display:flex;gap:5px;align-items:center;cursor:pointer;user-select:none}
  main{padding:16px 18px;display:grid;gap:16px;grid-template-columns:1fr 1fr}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden;
         display:flex;flex-direction:column;min-height:200px}
  .panel.full{grid-column:1 / -1}
  .panel h2{font-size:13px;margin:0;padding:10px 14px;border-bottom:1px solid var(--line);
            display:flex;align-items:center;gap:8px;font-weight:600}
  .panel h2 .sub{color:var(--muted);font-weight:400;font-size:12px}
  .panel h2 .btn{margin-left:auto}
  .btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);
       border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer}
  .btn:hover{border-color:var(--accent)}
  .feed{overflow:auto;max-height:46vh;padding:6px 0}
  .full .feed{max-height:40vh}
  .line{display:flex;gap:10px;align-items:flex-start;padding:5px 14px;border-bottom:1px solid #20262f}
  .line:hover{background:var(--panel2)}
  .time{color:var(--muted);font-size:11px;white-space:nowrap;font-variant-numeric:tabular-nums;padding-top:2px}
  .badge{font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:5px;white-space:nowrap;flex:none}
  .b-good{background:rgba(63,185,80,.15);color:var(--good)}
  .b-warn{background:rgba(210,153,34,.18);color:var(--warn)}
  .b-raw{background:rgba(110,118,129,.18);color:var(--raw)}
  .b-kill{background:rgba(248,81,73,.18);color:var(--kill)}
  .b-acc{background:rgba(59,130,246,.18);color:var(--accent)}
  .raw{font-family:'Cascadia Code',Consolas,monospace;font-size:12px;word-break:break-word;flex:1;line-height:1.45}
  .copy{opacity:0;font-size:11px;background:none;border:none;color:var(--accent);cursor:pointer;flex:none}
  .line:hover .copy{opacity:1}
  .mission{padding:8px 14px;border-bottom:1px solid #20262f}
  .mhead{display:flex;gap:10px;align-items:center}
  .mtitle{font-weight:600;flex:1}
  .mid{color:var(--muted);font-size:10.5px;font-family:'Cascadia Code',Consolas,monospace}
  .obj{margin:3px 0 0 26px;font-size:12.5px;color:var(--text)}
  .obj.muted{color:var(--muted);font-style:italic}
  .empty{color:var(--muted);padding:22px 14px;text-align:center;font-style:italic}
  mark{background:rgba(210,153,34,.35);color:inherit;border-radius:2px}
  @media(max-width:820px){main{grid-template-columns:1fr}}
  .tab{background:var(--panel2);border:1px solid var(--line);color:var(--muted);border-radius:7px;padding:5px 16px;font-size:13px;cursor:pointer}
  .tab.on{color:var(--text);border-color:var(--accent)}
  .slrow{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px}
  .flab{font-size:11px;color:var(--muted);margin-right:3px;min-width:54px}
  .chip{font-size:12px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--muted);cursor:pointer}
  .chip.on{background:rgba(59,130,246,.15);color:var(--accent);border-color:var(--accent)}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:10px;padding:12px 14px;width:100%}
  .mc{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
  .mc .l{font-size:12px;color:var(--muted)}
  .mc .v{font-size:23px;font-weight:650;color:var(--text);line-height:1.25}
  .mc .d{font-size:11px;color:var(--muted);margin-top:2px}
  .lbr{display:grid;grid-template-columns:1fr 72px 86px 56px;gap:8px;align-items:center;padding:6px 8px;font-size:12.5px;border-radius:6px}
  .lbr.click{cursor:pointer}.lbr.click:hover{background:var(--panel2)}
  .line.rulehit{background:rgba(59,130,246,.10);box-shadow:inset 3px 0 0 var(--accent)}
  .logwarn{background:rgba(210,153,34,.12);color:var(--warn);border-radius:7px;margin:10px 14px 0;
    padding:9px 12px;font-size:12.5px}
  .lognav{display:flex;gap:8px;align-items:center;padding:8px 14px;border-bottom:1px solid var(--line)}
  .lognav .sub{color:var(--muted);font-size:12px;flex:1;text-align:center;font-variant-numeric:tabular-nums}
  .logbrowse{font-family:'Cascadia Code',Consolas,monospace;font-size:11.5px;line-height:1.5;max-height:44vh}
  .logline{padding:0 14px;white-space:pre-wrap;word-break:break-all;border-bottom:1px solid #171c23}
  .logline.rulehit{background:rgba(59,130,246,.14);box-shadow:inset 3px 0 0 var(--accent)}
  .reparse{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 14px;border-top:1px solid var(--line)}
  .reparse .sub{color:var(--muted);font-size:12px}
  .rpkinds{display:flex;gap:6px;flex-wrap:wrap;width:100%}
  .rules{padding:6px 0;overflow:auto;max-height:44vh}
  .rule{display:grid;grid-template-columns:64px 250px 1fr 92px;gap:10px;align-items:center;
    padding:6px 14px;border-bottom:1px solid #20262f;font-size:12.5px}
  .rule.head{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid var(--line)}
  .rule.on{background:rgba(59,130,246,.07)}
  .rule .rkind{font-weight:600;word-break:break-word}
  .rule .rpat{font-family:'Cascadia Code',Consolas,monospace;font-size:11px;color:var(--muted);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  @media(max-width:900px){.rule{grid-template-columns:56px 1fr 80px}.rule .rpat{display:none}}
  .home-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px;padding:14px}
  .tab-badge{display:inline-block;background:var(--accent);color:#fff;border-radius:999px;font-size:10.5px;
    font-weight:700;min-width:16px;padding:0 5px;margin-left:6px;line-height:16px;vertical-align:text-top}
  .bell{position:relative;background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:5px 11px;font-size:14px;cursor:pointer;line-height:1}
  .bell:hover{border-color:var(--accent)}
  .bell.on{border-color:var(--accent);color:var(--accent)}
  .bell .dot{position:absolute;top:-4px;right:-4px;background:var(--accent);color:#fff;border-radius:999px;
    font-size:10px;font-weight:700;min-width:16px;padding:0 4px;line-height:16px;text-align:center}
  .home-card{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:16px;
    text-align:left;cursor:pointer;color:var(--text);display:grid;gap:8px;align-content:start}
  .home-card:hover{border-color:var(--accent)}
  .home-card .hc-title{font-size:15px;font-weight:650}
  .home-card .hc-desc{font-size:12.5px;color:var(--muted);line-height:1.5}
  .home-card .hc-stat{font-size:11.5px;color:var(--accent);font-family:'Cascadia Code',Consolas,monospace}
`;

const GOOD = '#3fb950';
const WARN = '#d29922';
const KILL = '#f85149';
const ACC = '#3b82f6';
const GRAY = '#6e7681';
const OC = {
  Complete: { t: 'Completed', c: GOOD },
  Abandon: { t: 'Abandoned', c: WARN },
  Fail: { t: 'Failed', c: KILL },
  Deactivate: { t: 'Deactivated', c: GRAY }
};
const OCK = ['Complete', 'Abandon', 'Fail', 'Deactivate'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MISSION_STATUS = {
  Complete: ['b-good', '✅ complete'],
  Abandon: ['b-warn', '⤺ abandoned'],
  Fail: ['b-kill', '✖ failed'],
  Deactivate: ['b-raw', '⊘ deactivated'],
  Active: ['b-acc', '● active']
};

function esc (s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function shortTime (ts) {
  if (!ts) return '—';
  const t = String(ts).match(/T(\d{2}:\d{2}:\d{2})/);
  return t ? t[1] : String(ts).slice(0, 8);
}

function ymOf (ts) {
  return (typeof ts === 'string' && ts.length >= 7) ? ts.slice(0, 7) : '';
}

function facOf (m) {
  return m.faction || 'Unknown';
}

function has (set, v) {
  return (!set || !set.size) ? true : set.has(v);
}

function monthMinus (ym, k) {
  const p = ym.split('-');
  let y = +p[0];
  let m = +p[1] - k;
  while (m <= 0) { m += 12; y--; }
  return y + '-' + String(m).padStart(2, '0');
}

function keywordsFrom (filter) {
  return String(filter || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function matches (raw, kws) {
  if (!kws.length) return true;
  const low = String(raw || '').toLowerCase();
  return kws.some((k) => low.includes(k));
}

function highlight (raw, kws) {
  let h = esc(raw);
  for (const k of kws) {
    if (!k) continue;
    const re = new RegExp('(' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
    h = h.replace(re, '<mark>$1</mark>');
  }
  return h;
}

function badge (ev) {
  if (ev.kind === 'kill') return ['b-kill', 'kill'];
  if (!ev.recognized) return ['b-raw', ev.kind === 'log:notice' ? 'notice' : 'raw'];
  if (ev.verified === false) return ['b-warn', ev.kind + ' ?'];
  return ['b-good', ev.kind];
}

class Dashboard extends React.Component {
  constructor (props) {
    super(props);
    const hashTab = (typeof window !== 'undefined' && String(window.location.hash || '').replace(/^#/, '')) || '';
    const advancedMode = readAdvancedMode();
    const tabAllowed = (t) => TAB_KEYS.includes(t) && (advancedMode || !ADVANCED_TABS.has(t));
    this.state = {
      advancedMode,
      tab: tabAllowed(hashTab) ? hashTab : 'home',
      status: '…',
      online: false,
      counts: {
        // Cumulative (default strip) + session-scoped nested object from monitor.
        kills: 0, combat: 0, deaths: 0, incaps: 0, missions: 0,
        players: 0, sessions: 0, completed: 0, abandoned: 0, failed: 0,
        logins: 0, vehicles: 0, flagged: 0, logs: 0,
        session: null
      },
      missionStats: {},
      sessions: [],
      channel: null,
      session: {},
      updated: '—',
      build: '',
      filter: '',
      hideKnown: false,
      auto: true,
      flagged: [],
      recent: [],
      missions: [],
      kills: [],
      copyAllLabel: 'Copy all',
      // analyze
      analytics: null,
      azLoading: false,
      azMonths: null,
      azPlayers: null,
      azTypes: null,
      azOutcomes: null,
      azFactions: null,
      identityPubkey: null,
      identityLocked: false,
      identityExists: false,
      showSettings: false,
      showIdentity: false,
      chatUnread: 0,
      notifyPending: 0,
      nickname: null,
      // Game.log visibility + rules + re-parse
      loginfo: null,
      reparse: null,
      rules: [],
      activeRules: new Set(), // rule ids toggled for highlighting
      logSlice: null,         // { start, end, size, text } from the raw browser
      logBrowserOpen: false
    };
    this._timer = null;
    this._copiedTimers = {};
    this._identityUnsub = null;
  }

  componentDidMount () {
    this.poll();
    this.fetchAnalytics(); // cumulative stats available on every tab by default
    this.fetchRules();
    this.loadNickname();
    this._timer = setInterval(() => {
      if (this.state.auto) this.poll();
    }, 2000);
    this._analyticsTimer = setInterval(() => {
      if (this.state.auto) this.fetchAnalytics();
    }, 15000);
    this._onHash = () => {
      const h = String(window.location.hash || '').replace(/^#/, '');
      const allowed = TAB_KEYS.includes(h) && (this.state.advancedMode || !ADVANCED_TABS.has(h));
      const tab = allowed ? h : 'home';
      if (tab !== this.state.tab) this.showTab(tab, { fromHash: true });
    };
    window.addEventListener('hashchange', this._onHash);
    // Live lock-state from the desktop shell (auto-lock, manual lock, forget).
    const idBridge = (window.electronAPI && window.electronAPI.identity) || null;
    if (idBridge && idBridge.onChanged) {
      this._identityUnsub = idBridge.onChanged((summary) => {
        this.setState({
          identityExists: !!(summary && summary.exists),
          identityLocked: !!(summary && summary.exists && !summary.unlocked),
          identityPubkey: (summary && summary.unlocked) ? summary.pubkey : null
        });
      });
    }
  }

  componentWillUnmount () {
    if (this._onHash) window.removeEventListener('hashchange', this._onHash);
    if (this._identityUnsub) this._identityUnsub();
    if (this._timer) clearInterval(this._timer);
    if (this._analyticsTimer) clearInterval(this._analyticsTimer);
    Object.values(this._copiedTimers).forEach(clearTimeout);
  }

  async loadNickname () {
    try {
      const res = await fetch('/settings').then((r) => r.json());
      this.setState({ nickname: (res.settings && res.settings.nickname) || null });
    } catch (_) { /* ignore */ }
  }

  async poll () {
    try {
      const r = await fetch('/services/star-citizen/monitor?limit=300');
      const d = await r.json();
      const s = d.session || {};
      const parts = [d.channel, s.branch, s.changelist].filter(Boolean);
      this.setState({
        status: d.status,
        online: d.status === 'STARTED',
        counts: d.counts || this.state.counts,
        missionStats: d.missionStats || {},
        sessions: d.sessions || [],
        channel: d.channel,
        session: s,
        build: parts.join(' · '),
        updated: 'updated ' + shortTime(d.now),
        flagged: d.flagged || [],
        recent: d.recent || [],
        missions: d.missions || [],
        kills: d.kills || [],
        loginfo: d.loginfo || null,
        reparse: d.reparse || null
      });
    } catch (_) {
      this.setState({ status: 'OFFLINE', online: false });
    }
  }

  fetchRules () {
    fetch('/services/star-citizen/rules')
      .then((r) => r.json())
      .then((j) => {
        const rules = j.data || [];
        // All patterns highlight by default; the table toggles them off.
        this.setState({ rules, activeRules: new Set(rules.map((r) => r.id)) });
      })
      .catch(() => {});
  }

  toggleRule (id) {
    const next = new Set(this.state.activeRules);
    if (next.has(id)) next.delete(id); else next.add(id);
    this.setState({ activeRules: next });
  }

  /** Compiled regexes for the currently toggled rules (highlighting). */
  activeRegexes () {
    const out = [];
    for (const rule of this.state.rules) {
      if (!this.state.activeRules.has(rule.id)) continue;
      try { out.push(new RegExp(rule.pattern, rule.flags || '')); } catch (_) { /* bad pattern */ }
    }
    return out;
  }

  async fetchLogSlice (start) {
    try {
      const q = start === undefined ? 'start=end' : `start=${start}`;
      const r = await fetch(`/services/star-citizen/logslice?${q}&bytes=65536`);
      if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`);
      const j = await r.json();
      this.setState({ logSlice: j.data, logBrowserOpen: true });
    } catch (e) {
      this.setState({ logSlice: { error: e.message }, logBrowserOpen: true });
    }
  }

  async startReparse () {
    try { await fetch('/services/star-citizen/reparse', { method: 'POST' }); this.poll(); } catch (_) { /* offline */ }
  }

  fetchAnalytics () {
    this.setState({ azLoading: true });
    fetch('/services/star-citizen/analytics')
      .then((r) => r.json())
      .then((j) => {
        this.setState({
          analytics: j,
          azMonths: this.state.azMonths || new Set(j.availableMonths || []),
          azLoading: false
        });
      })
      .catch(() => this.setState({ azLoading: false }));
  }

  showTab (tab, { fromHash = false } = {}) {
    if (!fromHash) {
      const hash = tab === 'home' ? '' : `#${tab}`;
      if (window.location.hash !== hash) {
        history.replaceState(null, '', window.location.pathname + window.location.search + hash);
      }
    }
    this.setState({ tab }, () => {
      if (tab === 'analyze' && !this.state.analytics) this.fetchAnalytics();
    });
  }

  copyRaw (raw, key) {
    navigator.clipboard.writeText(raw);
    this.setState({ [key]: 'copied' });
    clearTimeout(this._copiedTimers[key]);
    this._copiedTimers[key] = setTimeout(() => {
      this.setState({ [key]: key === 'copyAllLabel' ? 'Copy all' : 'copy' });
    }, key === 'copyAllLabel' ? 1200 : 1000);
  }

  copyAll () {
    const kws = keywordsFrom(this.state.filter);
    const text = this.state.flagged.filter((ev) => matches(ev.raw, kws)).map((ev) => ev.raw).join('\n');
    this.copyRaw(text, 'copyAllLabel');
  }

  // ---- analyze helpers ----
  mSel (ym) { return this.state.azMonths ? this.state.azMonths.has(ym) : true; }
  pSel (p) { return has(this.state.azPlayers, p); }
  tSel (t) { return has(this.state.azTypes, t); }
  oSel (o) { return has(this.state.azOutcomes, o); }
  fSel (f) { return has(this.state.azFactions, f); }

  tog (key, v) {
    const cur = this.state[key];
    const next = cur ? new Set(cur) : new Set();
    if (next.has(v)) next.delete(v); else next.add(v);
    this.setState({ [key]: next.size ? next : null });
  }

  baseM () {
    const D = this.state.analytics;
    return (D && D.missions || []).filter((m) => this.mSel(ymOf(m.ts)) && this.pSel(m.player));
  }

  baseD () {
    const D = this.state.analytics;
    return (D && D.deaths || []).filter((d) => this.mSel(ymOf(d.ts)) && this.pSel(d.player));
  }

  aggMonths (set) {
    const D = this.state.analytics;
    const ms = (D.missions || []).filter((m) => this.pSel(m.player) && set.has(ymOf(m.ts)) && this.tSel(m.type) && this.fSel(facOf(m)));
    return {
      done: ms.filter((m) => m.outcome === 'Complete').length,
      deaths: (D.deaths || []).filter((d) => this.pSel(d.player) && set.has(ymOf(d.ts))).length,
      sessions: (D.sessions || []).filter((s) => this.pSel(s.player) && set.has(ymOf(s.ts))).length
    };
  }

  // ---- render helpers ----
  renderLine (ev, kws, idx, regexes) {
    const [cls, label] = badge(ev);
    const copyKey = 'copy_' + idx;
    const hit = regexes && regexes.length && regexes.some((re) => re.test(ev.raw));
    return React.createElement('div', { className: 'line' + (hit ? ' rulehit' : ''), key: idx },
      React.createElement('span', { className: 'time' }, shortTime(ev.timestamp)),
      React.createElement('span', { className: 'badge ' + cls }, label),
      React.createElement('span', { className: 'raw', dangerouslySetInnerHTML: { __html: highlight(ev.raw, kws) } }),
      React.createElement('button', {
        className: 'copy',
        type: 'button',
        onClick: () => this.copyRaw(ev.raw, copyKey)
      }, this.state[copyKey] || 'copy')
    );
  }

  renderFeed (items, kws, empty) {
    if (!items.length) return React.createElement('div', { className: 'empty' }, empty || 'nothing yet');
    const regexes = this.activeRegexes();
    return items.map((ev, i) => this.renderLine(ev, kws, i, regexes));
  }

  renderKills () {
    const kills = this.state.kills;
    if (!kills.length) {
      return React.createElement('div', { className: 'empty' }, 'no kills yet — appear the moment a member gets or takes a kill');
    }
    const who = (n, npc) => React.createElement(React.Fragment, null,
      n || '?',
      npc ? React.createElement('span', { className: 'mid' }, ' (NPC)') : null
    );
    return kills.map((k, i) => {
      const cls = k.involves === 'kill' ? 'b-good' : k.involves === 'death' ? 'b-kill' : 'b-warn';
      const label = k.involves === 'death' ? 'death' : 'kill';
      return React.createElement('div', { className: 'line', key: i },
        React.createElement('span', { className: 'time' }, shortTime(k.timestamp)),
        React.createElement('span', { className: 'badge ' + cls }, label),
        React.createElement('span', { className: 'raw' },
          who(k.killer, k.killerNpc), ' → ', who(k.victim, k.victimNpc), ' ',
          React.createElement('span', { className: 'mid' },
            (k.weapon || '') + (k.damageType ? ' · ' + k.damageType : '')
          )
        )
      );
    });
  }

  renderMissions () {
    const missions = this.state.missions;
    if (!missions.length) {
      return React.createElement('div', { className: 'empty' }, 'no missions yet — take a contract in-game');
    }
    return missions.slice().reverse().map((m, i) => {
      const objs = (m.objectives || []).map((o, j) =>
        React.createElement('div', { className: 'obj', key: j }, (o.combat ? '⚔️ ' : '• ') + (o.text || o.id))
      );
      const st = MISSION_STATUS[m.status];
      return React.createElement('div', { className: 'mission', key: i },
        React.createElement('div', { className: 'mhead' },
          React.createElement('span', { className: 'badge b-good' }, m.type || 'mission'),
          st ? React.createElement('span', { className: 'badge ' + st[0] }, st[1]) : null,
          React.createElement('span', { className: 'mtitle' }, m.title || '(mission)'),
          React.createElement('span', { className: 'time' }, shortTime(m.endedAt || m.lastSeen))
        ),
        React.createElement('div', { className: 'mid' }, m.id),
        objs.length ? objs : React.createElement('div', { className: 'obj muted' }, '(no objectives yet)')
      );
    });
  }

  // ---- analyze SVG (string HTML kept for chart density) ----
  rHeatHtml () {
    const D = this.state.analytics;
    const H = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let mx = 0;
    (D.heatcells || []).forEach((c) => { if (this.mSel(c.ym)) H[c.d][c.h] += c.n; });
    H.forEach((r) => r.forEach((v) => { if (v > mx) mx = v; }));
    if (!mx) return '<div class="empty">no activity in the selected months</div>';
    const lw = 30; const cw = 22; const ch = 15; const top = 16;
    const W = lw + 24 * cw; const Ht = top + 7 * ch + 4;
    let s = '<svg width="100%" viewBox="0 0 ' + W + ' ' + Ht + '" style="max-width:' + W + 'px">';
    [0, 6, 12, 18].forEach((h) => {
      s += '<text x="' + (lw + h * cw) + '" y="11" font-size="10" fill="' + GRAY + '">' + h + ':00</text>';
    });
    for (let r = 0; r < 7; r++) {
      s += '<text x="0" y="' + (top + r * ch + 11) + '" font-size="10.5" fill="var(--muted)">' + DAYS[r] + '</text>';
      for (let h = 0; h < 24; h++) {
        const v = H[r][h];
        const op = v ? (0.15 + 0.85 * v / mx).toFixed(2) : 0;
        s += '<rect x="' + (lw + h * cw) + '" y="' + (top + r * ch) + '" width="' + (cw - 2) + '" height="' + (ch - 2) + '" rx="2" fill="' + ACC + '" fill-opacity="' + op + '" stroke="var(--line)" stroke-width="0.5"/>';
      }
    }
    return s + '</svg>';
  }

  rDonutHtml (ms) {
    const co = {}; let tot = 0;
    ms.forEach((m) => { if (m.outcome) { co[m.outcome] = (co[m.outcome] || 0) + 1; tot++; } });
    if (!tot) return '<div class="empty">no ended missions in range yet</div>';
    const cx = 70; const cy = 72; const r = 56;
    let a = -Math.PI / 2;
    let s = '<svg width="100%" viewBox="0 0 280 150" style="max-width:280px">';
    OCK.forEach((o) => {
      const n = co[o] || 0; if (!n) return;
      const f = n / tot; const a1 = a + f * Math.PI * 2;
      const x0 = cx + r * Math.cos(a); const y0 = cy + r * Math.sin(a);
      const x1 = cx + r * Math.cos(a1); const y1 = cy + r * Math.sin(a1);
      const lg = (a1 - a) > Math.PI ? 1 : 0;
      const op = this.oSel(o) ? 1 : 0.3;
      s += '<path d="M' + cx + ' ' + cy + ' L' + x0.toFixed(1) + ' ' + y0.toFixed(1) + ' A' + r + ' ' + r + ' 0 ' + lg + ' 1 ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' Z" fill="' + OC[o].c + '" fill-opacity="' + op + '" data-oc="' + o + '" style="cursor:pointer"/>';
      a = a1;
    });
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="34" fill="var(--panel)"/><text x="' + cx + '" y="' + (cy - 1) + '" text-anchor="middle" font-size="21" font-weight="650" fill="var(--text)">' + tot + '</text><text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" font-size="10" fill="var(--muted)">missions</text>';
    let i = 0;
    OCK.forEach((o) => {
      const n = co[o] || 0; if (!n) return;
      const y = 32 + i * 25; i++;
      s += '<rect x="156" y="' + y + '" width="11" height="11" rx="2" fill="' + OC[o].c + '"/><text x="173" y="' + (y + 10) + '" font-size="12" fill="var(--muted)">' + OC[o].t + '</text><text x="270" y="' + (y + 10) + '" text-anchor="end" font-size="12" font-weight="650" fill="var(--text)">' + n + '</text>';
    });
    return s + '</svg>';
  }

  rBarsHtml (ms) {
    const types = [];
    ms.forEach((m) => { if (types.indexOf(m.type) < 0) types.push(m.type); });
    if (!types.length) return '<div class="empty">no missions in range yet</div>';
    const by = {};
    types.forEach((t) => { by[t] = { Complete: 0, Abandon: 0, Fail: 0, Deactivate: 0, tot: 0 }; });
    ms.forEach((m) => { if (m.outcome) by[m.type][m.outcome]++; by[m.type].tot++; });
    let mx = 1;
    types.forEach((t) => { if (by[t].tot > mx) mx = by[t].tot; });
    const bw = 150; const x0 = 104; const rh = 26;
    let s = '<svg width="100%" viewBox="0 0 280 ' + (types.length * rh + 6) + '" style="max-width:280px">';
    types.forEach((t, i) => {
      const y = i * rh + 6; const rop = this.tSel(t) ? 1 : 0.4;
      s += '<g opacity="' + rop + '" data-ty="' + t + '" style="cursor:pointer"><text x="0" y="' + (y + 13) + '" font-size="10.5" fill="var(--muted)">' + t + '</text>';
      let cxp = x0;
      OCK.forEach((o) => {
        const w = (by[t][o] || 0) / mx * bw;
        if (w > 0) {
          const op = this.oSel(o) ? 1 : 0.4;
          s += '<rect x="' + cxp.toFixed(1) + '" y="' + (y + 3) + '" width="' + w.toFixed(1) + '" height="13" fill="' + OC[o].c + '" fill-opacity="' + op + '"/>';
          cxp += w;
        }
      });
      s += '<text x="' + (x0 + bw + 6) + '" y="' + (y + 13) + '" font-size="11" font-weight="650" fill="var(--text)">' + by[t].tot + '</text></g>';
    });
    return s + '</svg>';
  }

  rFactionHtml (ms) {
    const facs = [];
    ms.forEach((m) => { const f = facOf(m); if (facs.indexOf(f) < 0) facs.push(f); });
    if (!facs.length) return '<div class="empty">no missions in range yet</div>';
    const by = {};
    facs.forEach((f) => { by[f] = { Complete: 0, Abandon: 0, Fail: 0, Deactivate: 0, tot: 0 }; });
    ms.forEach((m) => { const f = facOf(m); if (m.outcome) by[f][m.outcome]++; by[f].tot++; });
    const order = facs.slice().sort((a, b) => by[b].tot - by[a].tot);
    let mx = 1;
    order.forEach((f) => { if (by[f].tot > mx) mx = by[f].tot; });
    const bw = 96; const x0 = 150; const rh = 24;
    let s = '<svg width="100%" viewBox="0 0 300 ' + (order.length * rh + 6) + '" style="max-width:300px">';
    order.forEach((f, i) => {
      const y = i * rh + 6; const rop = this.fSel(f) ? 1 : 0.4;
      s += '<g opacity="' + rop + '" data-fac="' + f.replace(/"/g, '') + '" style="cursor:pointer"><text x="0" y="' + (y + 12) + '" font-size="10.5" fill="var(--muted)">' + f + '</text>';
      let cxp = x0;
      OCK.forEach((o) => {
        const w = (by[f][o] || 0) / mx * bw;
        if (w > 0) {
          const op = this.oSel(o) ? 1 : 0.4;
          s += '<rect x="' + cxp.toFixed(1) + '" y="' + (y + 2) + '" width="' + w.toFixed(1) + '" height="13" fill="' + OC[o].c + '" fill-opacity="' + op + '"/>';
          cxp += w;
        }
      });
      s += '<text x="' + (x0 + bw + 6) + '" y="' + (y + 12) + '" font-size="11" font-weight="650" fill="var(--text)">' + by[f].tot + '</text></g>';
    });
    return s + '</svg>';
  }

  renderChips (label, opts, key) {
    const sel = this.state[key];
    const all = !sel || !sel.size;
    return React.createElement('div', { className: 'slrow' },
      React.createElement('span', { className: 'flab' }, label),
      React.createElement('button', {
        type: 'button',
        className: 'chip ' + (all ? 'on' : ''),
        onClick: () => this.setState({ [key]: null })
      }, 'All'),
      opts.map((o) => React.createElement('button', {
        type: 'button',
        key: o.v,
        className: 'chip ' + (!all && sel.has(o.v) ? 'on' : ''),
        onClick: () => this.tog(key, o.v)
      }, o.t))
    );
  }

  renderAnalyze () {
    const D = this.state.analytics;
    const { azLoading } = this.state;

    if (!D) {
      return React.createElement('main', null,
        React.createElement('section', { className: 'panel full' },
          React.createElement('div', { className: 'kpis' },
            React.createElement('div', { className: 'empty', style: { gridColumn: '1 / -1' } },
              azLoading ? 'loading…' : 'open to load')
          )
        )
      );
    }

    const months = D.availableMonths || [];
    const asc = months.slice().sort();
    const selArr = this.state.azMonths ? [...this.state.azMonths].sort() : [];
    const lo = selArr[0] || '';
    const hi = selArr[selArr.length - 1] || '';
    const ss = { background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 6, padding: '3px 6px', fontSize: 12 };

    const years = []; const byY = {};
    months.forEach((m) => {
      const y = m.slice(0, 4);
      if (years.indexOf(y) < 0) { years.push(y); byY[y] = []; }
      byY[y].push(m);
    });

    const msType = this.baseM().filter((m) => this.tSel(m.type) && this.fSel(facOf(m)));
    const ds = this.baseD();
    const done = msType.filter((m) => m.outcome === 'Complete').length;
    const rate = msType.length ? Math.round(100 * done / msType.length) : 0;
    const pil = new Set();
    msType.forEach((m) => pil.add(m.player));
    ds.forEach((x) => pil.add(x.player));
    const n = selArr.length;
    const curSessions = this.state.azMonths
      ? this.aggMonths(this.state.azMonths).sessions
      : (D.sessions || []).filter((s) => this.pSel(s.player)).length;
    let prev = null;
    if (n) {
      const pset = new Set();
      for (let i = 1; i <= n; i++) pset.add(monthMinus(selArr[0], i));
      prev = this.aggMonths(pset);
    }
    const dl = (c, pv) => React.createElement('div', { className: 'd' },
      pv ? ((c - pv >= 0 ? '+' : '') + Math.round((c - pv) / pv * 100) + '% vs prior ' + n + 'mo') : (c ? 'new' : '—')
    );
    const cards = [
      ['Active pilots', pil.size, null],
      ['Sessions', curSessions, prev ? dl(curSessions, prev.sessions) : null],
      ['Missions done', done, prev ? dl(done, prev.done) : null],
      ['Completion', rate + '%', null],
      ['Deaths', ds.length, prev ? dl(ds.length, prev.deaths) : null]
    ];

    const base = this.baseM();
    const msMain = base.filter((m) => this.tSel(m.type) && this.fSel(facOf(m)));
    const msBars = base.filter((m) => this.oSel(m.outcome) && this.fSel(facOf(m)));
    const msFac = base.filter((m) => this.oSel(m.outcome) && this.tSel(m.type));

    // leaderboard
    const by = {};
    msMain.forEach((m) => {
      const b = by[m.player] || (by[m.player] = { tot: 0, done: 0, deaths: 0 });
      b.tot++; if (m.outcome === 'Complete') b.done++;
    });
    ds.forEach((d) => {
      const b = by[d.player] || (by[d.player] = { tot: 0, done: 0, deaths: 0 });
      b.deaths++;
    });
    const rows = Object.keys(by).map((k) => Object.assign({ n: k }, by[k])).sort((a, b) => b.done - a.done);

    // compare
    const cby = {};
    const get = (p) => cby[p] || (cby[p] = { done: 0, tot: 0, deaths: 0, sess: 0 });
    this.baseM().forEach((m) => {
      if (!this.tSel(m.type) || !this.fSel(facOf(m))) return;
      const b = get(m.player); b.tot++; if (m.outcome === 'Complete') b.done++;
    });
    this.baseD().forEach((d) => { get(d.player).deaths++; });
    (D.sessions || []).forEach((s) => {
      if (this.mSel(ymOf(s.ts)) && this.pSel(s.player)) get(s.player).sess++;
    });
    const cmpRows = Object.keys(cby).map((k) => {
      const b = cby[k];
      return { n: k, rate: b.tot ? Math.round(100 * b.done / b.tot) : 0, tot: b.tot, deaths: b.deaths, sess: b.sess, dps: b.sess ? b.deaths / b.sess : 0 };
    }).filter((r) => r.tot || r.sess).sort((a, b) => b.rate - a.rate);

    const af = [];
    if (this.state.azPlayers && this.state.azPlayers.size) af.push(['azPlayers', 'pilots: ' + [...this.state.azPlayers].join(', ')]);
    if (this.state.azTypes && this.state.azTypes.size) af.push(['azTypes', 'type: ' + [...this.state.azTypes].join(', ')]);
    if (this.state.azFactions && this.state.azFactions.size) af.push(['azFactions', 'faction: ' + [...this.state.azFactions].join(', ')]);
    if (this.state.azOutcomes && this.state.azOutcomes.size) af.push(['azOutcomes', 'outcome: ' + [...this.state.azOutcomes].map((o) => OC[o].t).join(', ')]);
    const monthsAll = this.state.azMonths && this.state.azMonths.size === D.availableMonths.length;
    if (this.state.azMonths && !monthsAll) af.push(['azMonths', this.state.azMonths.size + ' month' + (this.state.azMonths.size === 1 ? '' : 's') + ' selected']);

    const ts = [];
    (D.missions || []).forEach((m) => { if (ts.indexOf(m.type) < 0) ts.push(m.type); });
    const fs = [];
    (D.missions || []).forEach((m) => { const f = facOf(m); if (fs.indexOf(f) < 0) fs.push(f); });
    fs.sort();

    const onAzClick = (e) => {
      const t = e.target.closest('[data-oc],[data-ty],[data-fac]');
      if (!t) return;
      if (t.dataset.oc) this.tog('azOutcomes', t.dataset.oc);
      else if (t.dataset.ty) this.tog('azTypes', t.dataset.ty);
      else if (t.dataset.fac) this.tog('azFactions', t.dataset.fac);
    };

    return React.createElement('main', { onClick: onAzClick },
      React.createElement('section', { className: 'panel full' },
        React.createElement('h2', null, '🔎 Analyze ',
          React.createElement('span', { className: 'sub' }, '— cumulative history (all scanned logs); every filter cross-filters all panels')
        ),
        React.createElement('div', { style: { padding: '12px 14px' } },
          React.createElement('div', { className: 'slrow' },
            React.createElement('span', { className: 'flab' }, 'period'),
            React.createElement('button', { type: 'button', className: 'chip', onClick: () => this.setState({ azMonths: new Set(D.availableMonths) }) }, 'All'),
            React.createElement('button', { type: 'button', className: 'chip', onClick: () => this.setState({ azMonths: new Set() }) }, 'None'),
            React.createElement('span', { className: 'flab', style: { marginLeft: 8 } }, 'range'),
            React.createElement('select', {
              style: ss,
              value: lo,
              onChange: (e) => {
                let f = e.target.value; let t = hi || f;
                if (f > t) { const x = f; f = t; t = x; }
                this.setState({ azMonths: new Set((D.availableMonths || []).filter((m) => m >= f && m <= t)) });
              }
            }, asc.map((m) => React.createElement('option', { key: m, value: m }, m))),
            React.createElement('span', { className: 'flab', style: { minWidth: 0 } }, 'to'),
            React.createElement('select', {
              style: ss,
              value: hi,
              onChange: (e) => {
                let f = lo || e.target.value; let t = e.target.value;
                if (f > t) { const x = f; f = t; t = x; }
                this.setState({ azMonths: new Set((D.availableMonths || []).filter((m) => m >= f && m <= t)) });
              }
            }, asc.map((m) => React.createElement('option', { key: m, value: m }, m))),
            React.createElement('span', { style: { flexBasis: '100%', height: 0 } }),
            years.map((y) => React.createElement(React.Fragment, { key: y },
              React.createElement('span', { className: 'flab', style: { minWidth: 0 } }, y),
              byY[y].map((m) => React.createElement('button', {
                type: 'button',
                key: m,
                className: 'chip ' + (this.mSel(m) ? 'on' : ''),
                onClick: () => {
                  const next = this.state.azMonths ? new Set(this.state.azMonths) : new Set(D.availableMonths);
                  if (next.has(m)) next.delete(m); else next.add(m);
                  this.setState({ azMonths: next });
                }
              }, MON[+m.split('-')[1] - 1]))
            ))
          ),
          this.renderChips('pilot', (D.players || []).map((n) => ({ t: n, v: n })), 'azPlayers'),
          this.renderChips('mission', ts.map((t) => ({ t, v: t })), 'azTypes'),
          this.renderChips('faction', fs.map((f) => ({ t: f, v: f })), 'azFactions'),
          this.renderChips('outcome', OCK.map((o) => ({ t: OC[o].t, v: o })), 'azOutcomes'),
          React.createElement('div', { className: 'slrow', style: { marginBottom: 0 } },
            af.length
              ? af.map((f) => React.createElement('button', {
                type: 'button',
                key: f[0],
                className: 'chip on',
                onClick: () => {
                  if (f[0] === 'azMonths') this.setState({ azMonths: new Set(D.availableMonths) });
                  else this.setState({ [f[0]]: null });
                }
              }, f[1] + ' ✕')).concat([
                React.createElement('button', {
                  type: 'button',
                  key: 'reset',
                  className: 'chip',
                  onClick: () => this.setState({
                    azMonths: new Set(D.availableMonths),
                    azPlayers: null,
                    azTypes: null,
                    azOutcomes: null,
                    azFactions: null
                  })
                }, '↺ reset')
              ])
              : null
          )
        )
      ),
      React.createElement('section', { className: 'panel full' },
        React.createElement('div', { className: 'kpis' },
          cards.map((k) => React.createElement('div', { className: 'mc', key: k[0] },
            React.createElement('div', { className: 'l' }, k[0]),
            React.createElement('div', { className: 'v' }, k[1]),
            k[2]
          ))
        )
      ),
      React.createElement('section', { className: 'panel full' },
        React.createElement('h2', null, '🗓️ When you fly ',
          React.createElement('span', { className: 'sub' }, "— this relay's activity by day & hour (local time); darker = busier")
        ),
        React.createElement('div', { style: { padding: '12px 14px', overflow: 'auto' }, dangerouslySetInnerHTML: { __html: this.rHeatHtml() } })
      ),
      React.createElement('section', { className: 'panel' },
        React.createElement('h2', null, '🎯 Mission outcomes ',
          React.createElement('span', { className: 'sub' }, '— click a slice to filter')
        ),
        React.createElement('div', { style: { padding: '12px 14px' }, dangerouslySetInnerHTML: { __html: this.rDonutHtml(msMain) } })
      ),
      React.createElement('section', { className: 'panel' },
        React.createElement('h2', null, '📊 By mission type ',
          React.createElement('span', { className: 'sub' }, '— what you do; click a bar to focus')
        ),
        React.createElement('div', { style: { padding: '12px 14px' }, dangerouslySetInnerHTML: { __html: this.rBarsHtml(msBars) } })
      ),
      React.createElement('section', { className: 'panel full' },
        React.createElement('h2', null, '🏷️ By faction ',
          React.createElement('span', { className: 'sub' }, '— who issued the contract; click a row to filter')
        ),
        React.createElement('div', { style: { padding: '12px 14px', overflow: 'auto' }, dangerouslySetInnerHTML: { __html: this.rFactionHtml(msFac) } })
      ),
      React.createElement('section', { className: 'panel full' },
        React.createElement('h2', null, '🏅 Pilots ',
          React.createElement('span', { className: 'sub' }, '— click a row to filter; grows as you play and as peers share events')
        ),
        React.createElement('div', { style: { padding: '6px 14px 12px' } },
          !rows.length
            ? React.createElement('div', { className: 'empty' }, 'no pilot activity in range yet — cumulative history fills as logs are scanned on startup')
            : [
              React.createElement('div', { className: 'lbr', key: 'h', style: { color: 'var(--muted)', fontSize: 11 } },
                React.createElement('span', null, 'pilot'),
                React.createElement('span', { style: { textAlign: 'right' } }, 'missions'),
                React.createElement('span', { style: { textAlign: 'right' } }, 'completion'),
                React.createElement('span', { style: { textAlign: 'right' } }, 'deaths')
              ),
              ...rows.map((r) => {
                const pc = r.tot ? Math.round(100 * r.done / r.tot) : 0;
                return React.createElement('div', {
                  className: 'lbr click',
                  key: r.n,
                  onClick: () => this.tog('azPlayers', r.n)
                },
                React.createElement('span', null, r.n),
                React.createElement('span', { style: { textAlign: 'right' } }, r.tot),
                React.createElement('span', { style: { textAlign: 'right' } }, pc + '%'),
                React.createElement('span', { style: { textAlign: 'right' } }, r.deaths)
                );
              })
            ]
        )
      ),
      React.createElement('section', { className: 'panel full' },
        React.createElement('h2', null, '⚖️ Pilot comparison ',
          React.createElement('span', { className: 'sub' }, '— side-by-side over the selected period (ignores the pilot filter)')
        ),
        React.createElement('div', { style: { padding: '12px 14px' } },
          cmpRows.length < 2
            ? React.createElement('div', { className: 'empty' }, 'needs ≥2 pilots with activity — run "npm run backfill" or wait for shared peer relays (M4)')
            : React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 } },
              cmpRows.map((r) => React.createElement('div', { className: 'mc', key: r.n },
                React.createElement('div', { className: 'l' }, r.n),
                React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6, margin: '2px 0 6px' } },
                  React.createElement('span', { className: 'v', style: { fontSize: 20 } }, r.rate + '%'),
                  React.createElement('span', { className: 'd' }, 'completion')
                ),
                React.createElement('div', { style: { height: 7, background: 'var(--panel)', borderRadius: 999, overflow: 'hidden', marginBottom: 8 } },
                  React.createElement('span', { style: { display: 'block', height: '100%', width: r.rate + '%', background: GOOD } })
                ),
                React.createElement('div', { className: 'd' }, r.tot + ' missions · ' + r.sess + ' sessions'),
                React.createElement('div', { className: 'd' }, r.deaths + ' deaths · ' + r.dps.toFixed(2) + '/session')
              ))
            )
        )
      )
    );
  }

  renderLogPanel () {
    const info = this.state.loginfo;
    const rp = this.state.reparse;
    const slice = this.state.logSlice;
    const regexes = this.activeRegexes();
    const fmt = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB');

    const sliceLines = (slice && slice.text)
      ? slice.text.split('\n').slice(slice.start > 0 ? 1 : 0) // drop the partial first line mid-file
      : [];

    return React.createElement('section', { className: 'panel full' },
      React.createElement('h2', null, '🗂 Game.log ',
        React.createElement('span', { className: 'sub' },
          info
            ? (info.exists
              ? `${info.path} — ${fmt(info.size)} · ${info.channel || '?'} · touched ${shortTime(info.mtime)}`
              : (info.path ? `${info.path} — NOT FOUND` : 'no Game.log located — set the path in Settings ⚙ or SC_LOGFILE'))
            : 'locating…'),
        React.createElement('button', {
          className: 'btn', type: 'button',
          disabled: !(info && info.exists),
          onClick: () => (this.state.logBrowserOpen
            ? this.setState({ logBrowserOpen: false, logSlice: null })
            : this.fetchLogSlice())
        }, this.state.logBrowserOpen ? 'Close browser' : 'Browse raw log')
      ),
      info && info.path && !info.exists
        ? React.createElement('div', { className: 'logwarn' },
          '⚠ The configured Game.log is not visible — check the path in Settings ⚙, or that the game has started at least once.')
        : null,
      this.state.logBrowserOpen && slice
        ? React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'lognav' },
            React.createElement('button', { className: 'btn', disabled: !slice.start, onClick: () => this.fetchLogSlice(0) }, '⇤ oldest'),
            React.createElement('button', { className: 'btn', disabled: !slice.start, onClick: () => this.fetchLogSlice(Math.max(0, slice.start - 65536)) }, '← older'),
            React.createElement('span', { className: 'sub' },
              slice.error ? slice.error : `bytes ${Number(slice.start).toLocaleString()}–${Number(slice.end).toLocaleString()} of ${Number(slice.size).toLocaleString()}`),
            React.createElement('button', { className: 'btn', disabled: slice.end >= slice.size, onClick: () => this.fetchLogSlice(slice.end) }, 'newer →'),
            React.createElement('button', { className: 'btn', onClick: () => this.fetchLogSlice() }, 'newest ⇥')
          ),
          React.createElement('div', { className: 'feed logbrowse' },
            sliceLines.map((line, i) => React.createElement('div', {
              className: 'logline' + (regexes.length && regexes.some((re) => re.test(line)) ? ' rulehit' : ''),
              key: i
            }, line || ' '))
          )
        )
        : null,
      React.createElement('div', { className: 'reparse' },
        React.createElement('button', {
          className: 'btn', type: 'button',
          disabled: !!(rp && rp.status === 'running'),
          onClick: () => this.startReparse()
        }, rp && rp.status === 'running' ? 'Re-parsing…' : '⟲ Re-parse history (oldest → newest)'),
        rp && rp.status !== 'idle'
          ? React.createElement('span', { className: 'sub' },
            rp.status === 'running'
              ? `file ${rp.fileIndex}/${rp.files} (${rp.currentFile || '…'}) · ${Number(rp.lines).toLocaleString()} lines · ${Number(rp.entries).toLocaleString()} entries`
              : rp.status === 'done'
                ? `done — ${rp.files} files · ${Number(rp.lines).toLocaleString()} lines · ${Number(rp.entries).toLocaleString()} entries · digest ${String(rp.digest).slice(0, 16)}…`
                : `error: ${rp.error}`)
          : React.createElement('span', { className: 'sub' },
            'counts every line across all logbackups; each entry gets a deterministic Fabric message id, chained into one reproducible digest'),
        rp && rp.status === 'done' && rp.byKind
          ? React.createElement('div', { className: 'rpkinds' },
            Object.entries(rp.byKind).sort((a, b) => b[1] - a[1]).map(([kind, n]) =>
              React.createElement('span', { className: 'chip on', key: kind }, `${kind} ${Number(n).toLocaleString()}`))
          )
          : null
      )
    );
  }

  renderRulesPanel () {
    if (!this.state.rules.length) return null;
    return React.createElement('section', { className: 'panel full' },
      React.createElement('h2', null, '🧩 Parser rules ',
        React.createElement('span', { className: 'sub' },
          '— the configured regular expressions, all highlighting by default. Toggle any off to declutter the live feeds and raw log browser.'),
        this.state.activeRules.size
          ? React.createElement('button', { className: 'btn', onClick: () => this.setState({ activeRules: new Set() }) }, 'Clear highlights')
          : React.createElement('button', { className: 'btn', onClick: () => this.setState({ activeRules: new Set(this.state.rules.map((r) => r.id)) }) }, 'Enable all')
      ),
      React.createElement('div', { className: 'rules' },
        React.createElement('div', { className: 'rule head' },
          React.createElement('span', null, ''),
          React.createElement('span', null, 'event'),
          React.createElement('span', null, 'pattern'),
          React.createElement('span', null, 'status')
        ),
        this.state.rules.map((r) => React.createElement('div', { className: 'rule' + (this.state.activeRules.has(r.id) ? ' on' : ''), key: r.id },
          React.createElement('button', {
            className: 'chip' + (this.state.activeRules.has(r.id) ? ' on' : ''),
            title: 'highlight lines matching this rule',
            onClick: () => this.toggleRule(r.id)
          }, this.state.activeRules.has(r.id) ? '● on' : '○ off'),
          React.createElement('span', { className: 'rkind' }, r.kind,
            r.tag ? React.createElement('span', { className: 'mid' }, ' <' + r.tag + '>') : null),
          React.createElement('code', { className: 'rpat', title: r.pattern }, r.pattern),
          React.createElement('span', { className: 'badge ' + (r.verified ? 'b-good' : 'b-warn') }, r.verified ? 'VERIFIED' : 'UNVERIFIED')
        ))
      )
    );
  }

  renderLive () {
    const kws = keywordsFrom(this.state.filter);
    let flagged = this.state.flagged.filter((ev) => matches(ev.raw, kws));
    if (this.state.hideKnown) flagged = flagged.filter((ev) => !ev.recognized);
    const ms = this.state.missionStats || {};
    const mstats = '— accepted ' + (ms.accepted || 0) +
      ' · ✅ ' + (ms.completed || 0) +
      ' · ⤺ ' + (ms.abandoned || 0) +
      ' · ✖ ' + (ms.failed || 0) +
      ' · ● ' + (ms.active || 0) + ' active';

    return React.createElement('main', null,
      this.renderLogPanel(),
      this.renderRulesPanel(),
      React.createElement('section', { className: 'panel full' },
        React.createElement('h2', null, '⭐ Mission & combat activity ',
          React.createElement('span', { className: 'sub' }, '— objectives, contracts & any combat lines. Hit Copy all to send me new formats.'),
          React.createElement('button', {
            className: 'btn',
            type: 'button',
            onClick: () => this.copyAll()
          }, this.state.copyAllLabel)
        ),
        React.createElement('div', { className: 'feed' }, this.renderFeed(flagged, kws))
      ),
      React.createElement('section', { className: 'panel full' },
        React.createElement('h2', null, '💀 Kills ',
          React.createElement('span', { className: 'sub' }, '— kills involving the running player (yours + your deaths). Third-party kills are not logged.')
        ),
        React.createElement('div', { className: 'feed' }, this.renderKills())
      ),
      React.createElement('section', { className: 'panel full' },
        React.createElement('h2', null, '🎯 Missions ',
          React.createElement('span', { className: 'sub' }, mstats)
        ),
        React.createElement('div', { className: 'feed' }, this.renderMissions())
      ),
      React.createElement('section', { className: 'panel' },
        React.createElement('h2', null, '✅ Recognized events ',
          React.createElement('span', { className: 'sub' }, '— what the parser understands')
        ),
        React.createElement('div', { className: 'feed' },
          this.renderFeed(this.state.recent.filter((ev) => ev.recognized).filter((ev) => matches(ev.raw, kws)), kws)
        )
      ),
      React.createElement('section', { className: 'panel' },
        React.createElement('h2', null, '📜 Recent log ',
          React.createElement('span', { className: 'sub' }, '— every line, newest first')
        ),
        React.createElement('div', { className: 'feed' },
          this.renderFeed(this.state.recent.filter((ev) => matches(ev.raw, kws)), kws)
        )
      )
    );
  }

  renderHome () {
    const c = this.state.counts;
    const sess = c.session || {};
    const cards = [
      ['live', '📡 Live Feed', 'Watch Game.log events as they happen — missions, objectives, combat and deaths, parsed in real time.',
        `${sess.missions || 0} missions · ${sess.deaths || 0} deaths this session`],
      ['analyze', '📊 Analyze', 'Cumulative activity across every scanned Game.log and logbackup — heatmap, outcomes, pilots.',
        `${c.missions || 0} missions · ${c.deaths || 0} deaths all-time`],
      ['library', '📸 Library', 'Periodic reduced-size snapshots of your play sessions — browsable history, ready for image analysis.',
        'opt-in · configurable interval · auto-purge'],
      ['missions', '⭐ Missions', 'Post contracts with Bitcoin rewards — submit completion, authorities approve with Schnorr signatures, coins unlock.',
        'k-of-n approval · escrowed sats'],
      ['wallet', '₿ Wallet', 'Group multisig addresses and mission escrows — deterministic k-of-n P2WSH from each group\'s roster.',
        'ledger or bitcoind · regtest first'],
      ['chat', '💬 Chat', 'Org chat with Hub message types — a global channel plus a dedicated channel for every group.',
        'ChatMessage · signed · synced via your peers'],
      ['groups', '👥 Groups', 'Member-created squads with k-of-n Schnorr decisions. Share a public group page; others apply to join.',
        'pages at /groups/:id (or a custom URL)'],
      ['peers', '🌐 Peers', 'Fabric Network peer management — push your signed event batches to org hubs like goon.vc.',
        'Fabric Protocol · idempotent delivery']
    ].filter(([tab]) => featureEnabled(tab) && (this.state.advancedMode || !ADVANCED_TABS.has(tab)));
    return React.createElement('main', null,
      React.createElement('section', { className: 'panel full' },
        React.createElement('h2', null, '🛰️ Welcome to GoonCitizen ',
          React.createElement('span', { className: 'sub' }, '— cumulative verified logs from your installs, live Game.log monitoring, and an officer-validated mission register on the Fabric Network.')
        ),
        React.createElement('div', { className: 'home-grid' },
          cards.map(([tab, title, desc, stat]) => React.createElement('button', {
            key: tab,
            type: 'button',
            className: 'home-card',
            onClick: () => this.showTab(tab)
          },
          React.createElement('div', { className: 'hc-title' }, title),
          React.createElement('div', { className: 'hc-desc' }, desc),
          React.createElement('div', { className: 'hc-stat' }, stat)
          ))
        )
      )
    );
  }

  renderTab () {
    switch (this.state.tab) {
      case 'live': return this.renderLive();
      case 'analyze': return this.renderAnalyze();
      case 'missions': return React.createElement(Missions, { identityPubkey: this.state.identityPubkey });
      case 'wallet': return featureEnabled('wallet') ? React.createElement(Wallet, null) : this.renderHome();
      case 'library': return featureEnabled('library') ? React.createElement(Library, null) : this.renderHome();
      case 'chat': return React.createElement(Chat, {
        identityPubkey: this.state.identityPubkey,
        nickname: this.state.nickname
      });
      case 'groups': return React.createElement(Groups, { identityPubkey: this.state.identityPubkey });
      case 'peers': return this.state.advancedMode ? React.createElement(Peers, null) : this.renderHome();
      case 'notifications': return React.createElement(Notifications, {
        onPendingCount: (n) => {
          if (n !== this.state.notifyPending) this.setState({ notifyPending: n });
        }
      });
      default: return this.renderHome();
    }
  }

  render () {
    const c = this.state.counts;
    const D = this.state.analytics;
    const sel = this.state.azMonths ? this.state.azMonths.size : (D ? D.availableMonths.length : 0);
    const tot = D ? D.availableMonths.length : 0;
    const np = (this.state.azPlayers && this.state.azPlayers.size) ? this.state.azPlayers.size + ' pilots' : 'all pilots';
    const scope = D
      ? (sel + '/' + tot + ' months · ' + np + (D.cumulative || D.generatedAt ? ' · cumulative' : ''))
      : '';
    const sess = c.session || {};

    return React.createElement(React.Fragment, null,
      React.createElement(Onboarding, {
        onReady: (pubkey) => this.setState({ identityPubkey: pubkey, identityExists: !!pubkey, identityLocked: false })
      }),
      React.createElement(FabricLoginModal, null),
      this.state.showSettings
        ? React.createElement(Settings, {
          onClose: () => this.setState({ showSettings: false }),
          onNicknameChange: (n) => this.setState({ nickname: n || null }),
          advancedMode: this.state.advancedMode,
          onAdvancedModeChange: (on) => {
            writeAdvancedMode(on);
            this.setState((s) => {
              const next = { advancedMode: on };
              // Leaving advanced mode while on an advanced-only tab → go home.
              if (!on && ADVANCED_TABS.has(s.tab)) {
                next.tab = 'home';
                try { if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search); } catch (_) { /* ignore */ }
              }
              return next;
            });
          }
        })
        : null,
      this.state.showIdentity
        ? React.createElement(Identity, {
          onClose: () => this.setState({ showIdentity: false }),
          onForget: () => this.setState({ identityPubkey: null, identityExists: false, identityLocked: false }),
          onNicknameChange: (n) => this.setState({ nickname: n || null })
        })
        : null,
      React.createElement('header', null,
        React.createElement('div', { className: 'row' },
          React.createElement('h1', null, '🛰️ GoonCitizen'),
          React.createElement('span', { className: 'pill ' + (this.state.online ? 'on' : 'off') }, this.state.status),
          // Compact stat strip — cumulative by default (Analyze has the full breakdown).
          React.createElement('div', { className: 'counts' },
            React.createElement('span', {
              title: `all-time ended missions · ${c.completed || 0} complete · ${c.abandoned || 0} abandoned · session now: ${sess.missions || 0}`
            }, 'missions ', React.createElement('b', null, c.missions)),
            React.createElement('span', {
              className: 'k',
              title: `all-time deaths (corpse-recovery) · session now: ${sess.deaths || 0} · ${c.kills || 0} logged kills · ${c.incaps || 0} downs`
            }, 'deaths ', React.createElement('b', null, c.deaths)),
            React.createElement('span', {
              title: `pilots in cumulative history · ${c.sessions || 0} sessions · session logins: ${sess.logins || 0}`
            }, 'players ', React.createElement('b', null, c.players))
          ),
          React.createElement('div', { className: 'ctrl' },
            React.createElement('span', { title: 'game build / version' }, this.state.build),
            React.createElement('span', null, this.state.updated),
            React.createElement('label', null,
              React.createElement('input', {
                type: 'checkbox',
                checked: this.state.auto,
                onChange: (e) => this.setState({ auto: e.target.checked })
              }),
              ' auto-refresh'
            ),
            React.createElement('button', {
              type: 'button',
              className: 'bell' + (this.state.tab === 'notifications' ? ' on' : ''),
              title: this.state.notifyPending
                ? `${this.state.notifyPending} pending notification${this.state.notifyPending === 1 ? '' : 's'} — open history`
                : 'Notifications — mission broadcasts and inbox history',
              onClick: () => this.showTab('notifications')
            },
            '🔔',
            this.state.notifyPending
              ? React.createElement('span', { className: 'dot' },
                this.state.notifyPending > 99 ? '99+' : this.state.notifyPending)
              : null
            ),
            (window.electronAPI && window.electronAPI.identity)
              ? React.createElement('button', {
                className: 'pill idchip ' + (this.state.identityPubkey ? 'on' : 'off'),
                title: this.state.identityPubkey
                  ? ((this.state.nickname ? this.state.nickname + ' · ' : '') +
                    this.state.identityPubkey +
                    ' — click to manage identity (nickname, lock, backup)')
                  : (this.state.identityExists ? 'identity locked — click to unlock or manage' : 'identity — click to manage'),
                onClick: () => this.setState({ showIdentity: true })
              }, this.state.identityPubkey
                ? ('🔑 ' + (this.state.nickname
                  ? (this.state.nickname + ' · ' + this.state.identityPubkey.slice(0, 8) + '…')
                  : (this.state.identityPubkey.slice(0, 8) + '…')))
                : (this.state.identityExists ? '🔒 locked' : '🔑 identity'))
              : null,
            React.createElement('button', {
              type: 'button',
              className: 'gear',
              title: 'Settings — log path, Discord, runtime',
              onClick: () => this.setState({ showSettings: true })
            }, '⚙️')
          )
        ),
        React.createElement('div', { className: 'row', style: { marginTop: 10, gap: 8 } },
          TABS.filter(([key]) => this.state.advancedMode || !ADVANCED_TABS.has(key)).map(([key, label]) => React.createElement('button', {
            key,
            type: 'button',
            className: 'tab ' + (this.state.tab === key ? 'on' : ''),
            onClick: () => this.showTab(key)
          },
          label,
          (key === 'chat' && this.state.chatUnread)
            ? React.createElement('span', { className: 'tab-badge' },
              this.state.chatUnread > 99 ? '99+' : this.state.chatUnread)
            : null
          )),
          this.state.tab === 'analyze'
            ? React.createElement('span', { className: 'sub', style: { color: 'var(--muted)', fontSize: 12 } }, scope)
            : null
        ),
        this.state.tab === 'live'
          ? React.createElement('div', { className: 'row', style: { marginTop: 10 } },
            React.createElement('input', {
              type: 'text',
              value: this.state.filter,
              placeholder: 'filter lines by keyword(s), comma-separated… e.g. kill, death, ship',
              onChange: (e) => this.setState({ filter: e.target.value })
            }),
            React.createElement('label', null,
              React.createElement('input', {
                type: 'checkbox',
                checked: this.state.hideKnown,
                onChange: (e) => this.setState({ hideKnown: e.target.checked })
              }),
              ' hide already-recognized in candidates'
            )
          )
          : null
      ),
      this.renderTab(),
      React.createElement(GlobalChatDock, {
        identityPubkey: this.state.identityPubkey,
        nickname: this.state.nickname,
        hide: this.state.tab === 'chat',
        onUnread: (n) => {
          if (n !== this.state.chatUnread) this.setState({ chatUnread: n });
        }
      }),
      React.createElement(MissionBroadcastBanner, {
        hide: this.state.tab === 'notifications',
        onResolved: () => {
          if (this.state.tab === 'missions') this.showTab('missions');
        },
        onPendingCount: (n) => {
          if (n !== this.state.notifyPending) this.setState({ notifyPending: n });
        }
      })
    );
  }
}

Dashboard.TITLE = TITLE;
Dashboard.CSS = CSS;

module.exports = Dashboard;
