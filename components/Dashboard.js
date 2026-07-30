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
const GroupOfferModal = require('./GroupOfferModal');
const SiteLogin = require('./SiteLogin');
const Chat = require('./Chat');
const GlobalChatDock = require('./GlobalChatDock');
const MissionBroadcastBanner = require('./MissionBroadcastBanner');
const Notifications = require('./Notifications');
const Groups = require('./Groups');
const Library = require('./Library');
const Missions = require('./Missions');
const Peers = require('./Peers');
const FabricMessages = require('./FabricMessages');
const Fleet = require('./Fleet');
const Settings = require('./Settings');
const Wallet = require('./Wallet');
const LogBrowser = require('./LogBrowser');
const ActivityHeatmap = require('./ActivityHeatmap');
const ShipPicker = require('./ShipPicker');
const activityHeat = require('../functions/activityHeat');
const missionCharts = require('../functions/missionCharts');

const { FEATURES } = require('../constants');
const { FEED_CATEGORIES, FEED_SOURCES, filterLiveFeed } = require('../functions/liveFeed');
const featureEnabled = (key) => FEATURES[key] !== false;

// Top-level features, listed along the top of the dashboard (Hub-style).
// Feature-flagged tabs (see constants.FEATURES) are filtered out when disabled.
const TABS = [
  ['home', 'Home'],
  ['live', 'Feed'],
  ['missions', 'Missions'],
  ['wallet', 'Wallet'],
  ['library', 'Library'],
  ['fleet', 'Fleet'],
  ['chat', 'Chat'],
  ['groups', 'Groups'],
  ['peers', 'Peers'],
  ['messages', 'Messages']
].filter(([k]) => featureEnabled(k));
// Advanced-only tabs — hidden unless "Advanced mode" is enabled in Settings.
const ADVANCED_TABS = new Set(['peers', 'messages']);

// Notifications is opened from the header bell (not a primary feature tab).
// Legacy #analyze hash redirects to Home (activity panels live there now).
const TAB_KEYS = TABS.map(([k]) => k).concat(['notifications', 'analyze']);

// Exclusive activity views on Home (tab-like). Filters is a separate flyover.
const HOME_VIEWS = [
  ['heatmap', 'When you fly'],
  ['charts', 'Missions'],
  ['quantum', 'Quantum'],
  ['pilots', 'Pilots']
];
// Advanced-only Home views (Settings → Advanced mode).
const HOME_ADVANCED_VIEWS = [
  ['tree', 'Activity Tree'],
  ['rules', 'Parser rules']
];

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
  .idchip-wrap{position:relative}
  .idchip{border:1px solid transparent;cursor:pointer;font-family:inherit;
    display:inline-flex;align-items:center;gap:6px;max-width:min(280px,42vw)}
  .idchip.off{background:rgba(210,153,34,.15);color:var(--warn)}
  .idchip:hover,.idchip.open{border-color:var(--accent)}
  .idchip .id-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--muted)}
  .idchip .id-dot.on{background:var(--good);box-shadow:0 0 0 2px rgba(63,185,80,.25)}
  .idchip .id-dot.share{outline:1px solid rgba(56,139,253,.55);outline-offset:1px}
  .idchip .id-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .idchip .id-ship{color:var(--muted);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px}
  .id-flyout{position:absolute;right:0;top:calc(100% + 8px);z-index:30;width:min(360px,94vw);
    background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px;
    box-shadow:0 12px 32px rgba(0,0,0,.45);display:grid;gap:10px}
  .id-flyout .ff{display:grid;gap:4px}
  .id-flyout .ff label{font-size:11.5px;color:var(--muted)}
  .id-flyout select,.id-flyout input{width:100%;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:7px 9px;font-size:12.5px;box-sizing:border-box}
  .id-flyout .hint{font-size:11.5px;color:var(--muted);line-height:1.4}
  .id-flyout .meta{font-size:12px;color:var(--text)}
  .id-flyout .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:2px}
  .id-flyout .actions .btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:6px 11px;font-size:12px;cursor:pointer;font-weight:600}
  .id-flyout .actions .btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
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
  .home-tools{display:flex;flex-wrap:wrap;gap:8px;padding:12px 14px;align-items:center}
  .home-tools .btn.on,.live-bar .btn.on{border-color:var(--accent);color:var(--accent)}
  .home-tools .sub{margin-left:auto}
  .home-views{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 12px;align-items:center}
  .home-flyover{border-top:1px solid var(--line)}
  .gc-modal-backdrop{position:fixed;inset:0;z-index:10040;background:rgba(0,0,0,.55);
    display:flex;align-items:center;justify-content:center;padding:16px}
  .gc-modal{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:10px;
    max-width:720px;width:100%;max-height:min(86vh,900px);overflow:auto;
    box-shadow:0 12px 40px rgba(0,0,0,.45)}
  .gc-modal > .panel{border:none;border-radius:0;min-height:0}
  .gc-modal > .panel + .panel{border-top:1px solid var(--line)}
  .live-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 14px}
  .live-bar .sub{flex:1;color:var(--muted);font-size:12px}
  .live-stream{display:flex;flex-direction:column;max-height:calc(100vh - 220px);min-height:420px}
  .live-filters{padding:10px 14px;border-bottom:1px solid var(--line);display:grid;gap:6px}
  .live-filters input[type=text]{min-width:0;width:100%;max-width:480px}
  .live-msgs{flex:1;overflow:auto;padding:10px 14px;display:flex;flex-direction:column;gap:8px}
  .live-msg{display:grid;gap:2px;padding:8px 10px;border-radius:8px;background:var(--panel2);border:1px solid transparent}
  .live-msg:hover{border-color:var(--line)}
  .live-msg.peer{box-shadow:inset 3px 0 0 var(--accent)}
  .live-msg .m{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
  .live-msg .who{font-weight:600;font-size:12.5px}
  .live-msg .who.peer{color:var(--accent)}
  .live-msg .t{color:var(--muted);font-size:10.5px;font-variant-numeric:tabular-nums;margin-left:auto}
  .live-msg .b{font-size:13.5px;line-height:1.45;word-break:break-word;white-space:pre-wrap}
  .live-msg .meta{color:var(--muted);font-size:11px}
  .live-msg .tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px;align-items:center}
  .live-msg .fb{font-size:10.5px;font-weight:600;padding:1px 7px;border-radius:999px;border:1px solid var(--line);
    color:var(--muted);background:transparent;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .live-msg .fb .fk{opacity:.75;font-weight:500;margin-right:4px;text-transform:uppercase;font-size:9.5px;letter-spacing:.03em}
  .live-msg .fb-player{color:#7ee787;border-color:rgba(126,231,135,.35);background:rgba(126,231,135,.08)}
  .live-msg .fb-mission{color:#79c0ff;border-color:rgba(121,192,255,.35);background:rgba(121,192,255,.08)}
  .live-msg .fb-type{color:#d2a8ff;border-color:rgba(210,168,255,.35);background:rgba(210,168,255,.08)}
  .live-msg .fb-faction{color:#ffa657;border-color:rgba(255,166,87,.35);background:rgba(255,166,87,.08)}
  .live-msg .fb-outcome{color:#3fb950;border-color:rgba(63,185,80,.35);background:rgba(63,185,80,.08)}
  .live-msg .fb-weapon,.live-msg .fb-ship{color:#ff7b72;border-color:rgba(255,123,114,.35);background:rgba(255,123,114,.08)}
  .live-msg .fb-zone,.live-msg .fb-destination{color:#a5d6ff;border-color:rgba(165,214,255,.35);background:rgba(165,214,255,.08)}
  .live-msg .fb-channel,.live-msg .fb-status{color:var(--muted);border-color:var(--line)}
  .live-msg .fb-npc{color:var(--warn);border-color:rgba(210,153,34,.35);background:rgba(210,153,34,.1)}
  .live-msg .prov{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:5px;font-size:11px;color:var(--muted)}
  .live-msg .prov .plabel{font-weight:600}
  .live-msg .prov .plabel.peer{color:var(--accent)}
  .live-msg .prov .plabel.self{color:var(--good)}
  .live-msg .prov code{font-size:10.5px;color:var(--text)}
  .live-msg .copy,.live-msg .rawtog{font-size:11px;background:none;border:none;color:var(--accent);cursor:pointer;padding:0}
  .live-msg .copy{opacity:0}
  .live-msg:hover .copy{opacity:1}
  .live-msg .rawtog{color:var(--muted)}
  .live-msg .rawtog:hover,.live-msg .rawtog.on{color:var(--accent)}
  .live-msg .rawline{margin-top:6px;padding:8px 10px;border-radius:6px;background:var(--bg);border:1px solid var(--line);
    font-family:'Cascadia Code',Consolas,monospace;font-size:11px;line-height:1.45;color:var(--muted);
    word-break:break-word;white-space:pre-wrap}
  .b-chat{background:rgba(59,130,246,.18);color:var(--accent)}
  .b-bcast{background:rgba(163,113,247,.18);color:#a371f7}
  .b-peer{background:rgba(59,130,246,.12);color:var(--accent)}
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
    const initialTab = (hashTab === 'analyze')
      ? 'home'
      : (tabAllowed(hashTab) ? hashTab : 'home');
    this.state = {
      advancedMode,
      tab: initialTab,
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
      auto: true,
      flagged: [],
      recent: [],
      missions: [],
      kills: [],
      feed: [],
      feedCategories: FEED_CATEGORIES,
      feedSourcesMeta: FEED_SOURCES,
      feedCats: null,      // null = all categories
      feedSources: null,   // null = local + peer
      feedRawOpen: null,   // Set of item ids with raw log expanded
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
      presenceOnline: false,
      presenceSharing: false,
      presenceShip: null,
      shipOverrideSlug: null,
      shipOverride: null,
      detectedShip: null,
      showProfileActivity: ActivityHeatmap.readShowProfileActivity(),
      presenceAvailability: 'auto',
      presenceStatusText: null,
      statusDraft: '',
      showIdFlyout: false,
      presenceBusy: false,
      // Game.log visibility + rules + re-parse
      loginfo: null,
      corpus: null,
      reparse: null,
      rules: [],
      activeRules: new Set(), // rule ids toggled for highlighting
      logSlice: null,         // { start, end, size, text } from the raw browser
      logBrowserOpen: false,
      showFabricImport: false,
      homeView: null,          // exclusive activity tab: heatmap|charts|quantum|pilots|tree|rules
      homeFiltersOpen: false,  // flyover toggle
      showMyLogs: false,       // My logs + import modal
      azGroups: [],
      azPublishGroupId: '',
      azPublishBusy: false,
      azPublishStatus: null,
      azTree: null,
      azTreeShowLeaves: false,
      azGroupTreeTip: null
    };
    this._timer = null;
    this._copiedTimers = {};
    this._identityUnsub = null;
    this._feedRef = React.createRef();
  }

  componentDidMount () {
    this.poll();
    this.fetchAnalytics(); // cumulative stats available on every tab by default
    this.fetchRules();
    this.loadNickname();
    this.loadPresenceChip();
    this._timer = setInterval(() => {
      if (this.state.auto) this.poll();
    }, 2000);
    this._analyticsTimer = setInterval(() => {
      if (this.state.auto) this.fetchAnalytics();
    }, 15000);
    this._presenceTimer = setInterval(() => this.loadPresenceChip(), 15000);
    this._onHash = () => {
      const h = String(window.location.hash || '').replace(/^#/, '');
      if (h === 'analyze') {
        try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (_) { /* ignore */ }
        if (this.state.tab !== 'home') this.showTab('home', { fromHash: true });
        return;
      }
      const allowed = TAB_KEYS.includes(h) && (this.state.advancedMode || !ADVANCED_TABS.has(h));
      const tab = allowed ? h : 'home';
      if (tab !== this.state.tab) this.showTab(tab, { fromHash: true });
    };
    window.addEventListener('hashchange', this._onHash);
    this._onDocClick = () => {
      if (this.state.showIdFlyout) this.setState({ showIdFlyout: false });
    };
    document.addEventListener('click', this._onDocClick);
    // Live lock-state from the desktop shell (auto-lock, manual lock, forget).
    const idBridge = (window.electronAPI && window.electronAPI.identity) || null;
    if (idBridge && idBridge.onChanged) {
      this._identityUnsub = idBridge.onChanged((summary) => {
        const locked = !!(summary && summary.exists && !summary.unlocked);
        this.setState((s) => ({
          identityExists: !!(summary && summary.exists),
          identityLocked: locked,
          identityPubkey: (summary && summary.unlocked) ? summary.pubkey : null,
          // Auto-lock / lock: dismiss Identity modal so Onboarding unlock owns the UI.
          showIdentity: locked ? false : s.showIdentity,
          showIdFlyout: locked ? false : s.showIdFlyout
        }));
      });
    }
  }

  componentWillUnmount () {
    if (this._onHash) window.removeEventListener('hashchange', this._onHash);
    if (this._onDocClick) document.removeEventListener('click', this._onDocClick);
    if (this._identityUnsub) this._identityUnsub();
    if (this._timer) clearInterval(this._timer);
    if (this._analyticsTimer) clearInterval(this._analyticsTimer);
    if (this._presenceTimer) clearInterval(this._presenceTimer);
    Object.values(this._copiedTimers).forEach(clearTimeout);
  }

  async loadNickname () {
    try {
      const res = await fetch('/settings').then((r) => r.json());
      this.setState({ nickname: (res.settings && res.settings.nickname) || null });
    } catch (_) { /* ignore */ }
  }

  async loadPresenceChip () {
    try {
      const res = await fetch('/services/star-citizen/presence').then((r) => (r.ok ? r.json() : null));
      const pd = res && res.data;
      if (!pd) return;
      const ship = (pd.presence && pd.presence.ship) || null;
      const statusText = (pd.settings && pd.settings.presenceStatusText) ||
        (pd.presence && pd.presence.statusText) || null;
      const ps = pd.settings || {};
      this.setState({
        presenceOnline: pd.online === true,
        presenceSharing: !!(ps.sharePresence),
        presenceAvailability: ps.presenceAvailability || 'auto',
        presenceStatusText: statusText,
        statusDraft: statusText || '',
        presenceShip: ship && (ship.name || ship.slug) ? (ship.name || ship.slug) : null,
        shipOverrideSlug: ps.shipOverrideSlug || null,
        shipOverride: pd.shipOverride || null,
        detectedShip: pd.detectedShip || null
      });
    } catch (_) { /* ignore */ }
  }

  applyPresenceChip (p) {
    if (!p) return;
    const ship = p.ship && (p.ship.name || p.ship.slug) ? (p.ship.name || p.ship.slug) : null;
    const next = {
      presenceOnline: p.online === true,
      presenceSharing: p.sharePresence === true,
      presenceAvailability: p.availability || this.state.presenceAvailability || 'auto',
      presenceStatusText: p.statusText || null,
      statusDraft: p.statusText || '',
      presenceShip: ship
    };
    if (p.shipOverride !== undefined) {
      next.shipOverride = p.shipOverride || null;
      next.shipOverrideSlug = p.shipOverride ? (p.shipOverride.slug || null) : null;
    }
    if (p.detectedShip !== undefined) next.detectedShip = p.detectedShip;
    this.setState(next);
  }

  async setPublishedShipQuick (slug) {
    this.setState({ presenceBusy: true });
    try {
      const autodetect = !slug;
      const res = await fetch('/services/star-citizen/presence/ship', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(autodetect ? { autodetect: true } : { slug })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      this.setState({ presenceBusy: false });
      const pd = j.data;
      if (pd) {
        const ship = (pd.presence && pd.presence.ship) || null;
        const ps = pd.settings || {};
        this.setState({
          presenceShip: ship && (ship.name || ship.slug) ? (ship.name || ship.slug) : null,
          shipOverrideSlug: ps.shipOverrideSlug || null,
          shipOverride: pd.shipOverride || null,
          detectedShip: pd.detectedShip || null
        });
      }
    } catch (_) {
      this.setState({ presenceBusy: false });
    }
  }

  async putPresenceQuick (patch) {
    this.setState({ presenceBusy: true });
    try {
      const res = await fetch('/services/star-citizen/presence', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      this.setState({ presenceBusy: false });
      const pd = j.data;
      if (pd) {
        const ship = (pd.presence && pd.presence.ship) || null;
        const statusText = (pd.settings && pd.settings.presenceStatusText) ||
          (pd.presence && pd.presence.statusText) || null;
        const ps = pd.settings || {};
        this.setState({
          presenceOnline: pd.online === true,
          presenceSharing: !!ps.sharePresence,
          presenceAvailability: ps.presenceAvailability || 'auto',
          presenceStatusText: statusText,
          statusDraft: statusText || '',
          presenceShip: ship && (ship.name || ship.slug) ? (ship.name || ship.slug) : null,
          shipOverrideSlug: ps.shipOverrideSlug || null,
          shipOverride: pd.shipOverride || null,
          detectedShip: pd.detectedShip || null
        });
      }
    } catch (_) {
      this.setState({ presenceBusy: false });
    }
  }

  renderIdentityFlyout () {
    if (!this.state.showIdFlyout) return null;
    const busy = this.state.presenceBusy;
    return React.createElement('div', {
      className: 'id-flyout',
      onClick: (e) => e.stopPropagation()
    },
    React.createElement('div', { className: 'ff' },
      React.createElement('label', null, 'Online status'),
      React.createElement('select', {
        value: this.state.presenceAvailability || 'auto',
        disabled: busy || !this.state.identityPubkey,
        onChange: (e) => {
          const availability = e.target.value;
          const patch = { presenceAvailability: availability };
          // Going Online/Offline from the chip implies sharing so peers can see it.
          if (availability === 'online' || availability === 'offline') {
            patch.sharePresence = true;
            patch.presenceVisibility = 'peers';
          }
          this.putPresenceQuick(patch);
        }
      },
      React.createElement('option', { value: 'auto' }, 'Auto (Game.log)'),
      React.createElement('option', { value: 'online' }, 'Online'),
      React.createElement('option', { value: 'offline' }, 'Offline')
      )
    ),
    React.createElement(ShipPicker, {
      compact: true,
      disabled: busy || !this.state.identityPubkey,
      overrideShip: this.state.shipOverride,
      detectedShip: this.state.detectedShip,
      onSelect: (slug) => this.setPublishedShipQuick(slug)
    }),
    React.createElement('div', { className: 'ff' },
      React.createElement('label', null, 'Status'),
      React.createElement('input', {
        type: 'text',
        maxLength: 64,
        placeholder: 'Short status…',
        value: this.state.statusDraft || '',
        disabled: busy || !this.state.identityPubkey,
        onChange: (e) => this.setState({ statusDraft: e.target.value }),
        onKeyDown: (e) => {
          if (e.key === 'Enter') this.putPresenceQuick({ presenceStatusText: this.state.statusDraft });
        }
      })
    ),
    React.createElement('div', { className: 'hint' },
      this.state.presenceSharing
        ? 'Sharing presence on the mesh.'
        : 'Presence is local until you share (Online/Offline enables sharing).'),
    React.createElement('div', { className: 'actions' },
      React.createElement('button', {
        type: 'button',
        className: 'btn',
        disabled: busy || !this.state.identityPubkey,
        onClick: () => this.putPresenceQuick({ presenceStatusText: this.state.statusDraft })
      }, 'Set status'),
      React.createElement('button', {
        type: 'button',
        className: 'btn primary',
        onClick: () => this.setState({ showIdFlyout: false, showIdentity: true })
      }, 'Identity…')
    )
    );
  }

  async poll () {
    try {
      const r = await fetch('/services/star-citizen/monitor?limit=300');
      const d = await r.json();
      const s = d.session || {};
      const parts = [d.channel, s.branch, s.changelist].filter(Boolean);
      const el = this._feedRef.current;
      const pinned = el && (el.scrollHeight - el.scrollTop - el.clientHeight < 80);
      const feedPayload = d.feed || null;
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
        feed: (feedPayload && feedPayload.items) || this.state.feed,
        feedCategories: (feedPayload && feedPayload.categories) || this.state.feedCategories,
        feedSourcesMeta: (feedPayload && feedPayload.sources) || this.state.feedSourcesMeta,
        loginfo: d.loginfo || null,
        corpus: d.corpus || this.state.corpus,
        reparse: d.reparse || null
      }, () => {
        if (pinned && this._feedRef.current) {
          this._feedRef.current.scrollTop = this._feedRef.current.scrollHeight;
        }
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
          corpus: j.corpus || this.state.corpus,
          azMonths: this.state.azMonths || new Set(j.availableMonths || []),
          azLoading: false
        });
      })
      .catch(() => this.setState({ azLoading: false }));
  }

  async syncCorpus () {
    try {
      await fetch('/services/star-citizen/corpus/sync', { method: 'POST' });
      await this.poll();
      this.fetchAnalytics();
    } catch (_) { /* offline */ }
  }

  onCorpusImported (payload) {
    if (payload && payload.corpus) {
      this.setState({ corpus: payload.corpus });
    }
    this.poll();
    this.fetchAnalytics();
  }

  renderMyLogsBody () {
    const corpus = this.state.corpus || (this.state.analytics && this.state.analytics.corpus) || null;
    const fmt = (b) => {
      if (!Number.isFinite(b) || b <= 0) return '0 B';
      if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
      if (b >= 1024) return Math.round(b / 1024) + ' KB';
      return b + ' B';
    };
    const shortPath = (p) => {
      if (!p) return '';
      const parts = String(p).split(/[\\/]+/);
      if (parts.length <= 4) return p;
      return '…/' + parts.slice(-4).join('/');
    };
    if (!corpus) {
      return React.createElement('div', { style: { padding: '8px 14px 14px' } },
        React.createElement('div', { className: 'empty' }, 'locating Game.log + logbackups…'));
    }
    const files = corpus.files || [];
    const pending = corpus.pendingFiles || 0;
    return React.createElement('div', { style: { padding: '8px 14px 14px' } },
      React.createElement('div', { className: 'slrow', style: { marginBottom: 8 } },
        React.createElement('span', { className: 'sub' },
          `${corpus.fileCount || 0} files · ${fmt(corpus.totalSize)} · ${pending ? pending + ' pending sync' : 'cursors up to date'}`),
        React.createElement('button', {
          className: 'btn', type: 'button',
          onClick: () => this.syncCorpus()
        }, 'Re-scan logs')
      ),
      corpus.ownerPubkey
        ? React.createElement('div', { className: 'sub', style: { marginBottom: 8 } },
          'Owner key ', React.createElement('code', null, String(corpus.ownerPubkey).slice(0, 16) + '…'))
        : React.createElement('div', { className: 'sub', style: { marginBottom: 8 } },
          'Unlock identity to stamp this corpus as yours (local analyze works either way).'),
      files.length === 0
        ? React.createElement('div', { className: 'empty' },
          'No Game.log or logbackups found yet. Import folders/files below, set the path in Settings, or start the game once.')
        : React.createElement('div', { style: { maxHeight: 200, overflow: 'auto' } },
          files.map((f) => React.createElement('div', {
            key: f.path,
            style: {
              display: 'flex', gap: 10, alignItems: 'baseline',
              fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--line)'
            }
          },
          React.createElement('span', { className: 'chip ' + (f.synced ? 'on' : ''), style: { minWidth: 64, textAlign: 'center' } },
            f.role === 'live' ? 'live' : (f.synced ? 'synced' : 'pending')),
          React.createElement('span', { className: 'sub', title: f.path, style: { flex: 1 } }, shortPath(f.path)),
          f.channel ? React.createElement('span', { className: 'chip' }, f.channel) : null,
          React.createElement('span', { className: 'sub' }, fmt(f.size))
          ))
        ),
      corpus.historyCounts
        ? React.createElement('div', { className: 'sub', style: { marginTop: 10 } },
          `History: ${corpus.historyCounts.missions} missions · ${corpus.historyCounts.deaths} deaths · ${corpus.historyCounts.sessions} sessions · ${corpus.historyCounts.players} pilots`
          + (corpus.lastSyncAt ? ` · flushed ${shortTime(corpus.lastSyncAt)}` : ''))
        : null
    );
  }

  renderMyLogsModal () {
    if (!this.state.showMyLogs) return null;
    const corpus = this.state.corpus || (this.state.analytics && this.state.analytics.corpus) || null;
    return React.createElement('div', {
      className: 'gc-modal-backdrop',
      onClick: (e) => { if (e.target === e.currentTarget) this.closeMyLogs(); }
    },
      React.createElement('div', { className: 'gc-modal', onClick: (e) => e.stopPropagation() },
        React.createElement('section', { className: 'panel full' },
          React.createElement('h2', null, 'My logs ',
            React.createElement('span', { className: 'sub' }, '— corpus feeding cumulative history'),
            React.createElement('button', {
              className: 'btn', type: 'button',
              onClick: () => this.closeMyLogs()
            }, 'Close')
          ),
          this.renderMyLogsBody()
        ),
        React.createElement('section', { className: 'panel full' },
          React.createElement('h2', null, '📂 Import logs ',
            React.createElement('span', { className: 'sub' },
              '— folders and/or individually selected *.log files')),
          React.createElement(LogBrowser, {
            importedDirs: (corpus && corpus.importedDirs) || [],
            importedFiles: (corpus && corpus.importedFiles) || [],
            onImported: (j) => this.onCorpusImported(j)
          })
        ),
        this.state.advancedMode ? this.renderLogPanel() : null
      )
    );
  }

  showTab (tab, { fromHash = false } = {}) {
    if (tab === 'analyze') tab = 'home';
    if (!fromHash) {
      const hash = tab === 'home' ? '' : `#${tab}`;
      if (window.location.hash !== hash) {
        history.replaceState(null, '', window.location.pathname + window.location.search + hash);
      }
    }
    this.setState({ tab }, () => {
      if (tab === 'home' && !this.state.analytics) this.fetchAnalytics();
    });
  }

  setHomeView (key) {
    const next = this.state.homeView === key ? null : key;
    this.setState({ homeView: next }, () => {
      if (next === 'tree') this.loadAnalyzeExtras();
    });
  }

  toggleHomeFilters () {
    this.setState({ homeFiltersOpen: !this.state.homeFiltersOpen });
  }

  openMyLogs () {
    this.setState({ showMyLogs: true });
  }

  closeMyLogs () {
    this.setState({ showMyLogs: false, logBrowserOpen: false, logSlice: null });
  }

  homeViewList () {
    const views = HOME_VIEWS.slice();
    if (this.state.advancedMode) {
      for (const v of HOME_ADVANCED_VIEWS) views.push(v);
    }
    return views;
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
    const items = this.filteredFeedItems();
    const text = items.map((it) => it.raw || it.body || '').filter(Boolean).join('\n');
    this.copyRaw(text, 'copyAllLabel');
  }

  filteredFeedItems () {
    return filterLiveFeed(this.state.feed || [], {
      categories: this.state.feedCats,
      sources: this.state.feedSources,
      keywords: keywordsFrom(this.state.filter)
    });
  }

  feedBadge (it) {
    if (it.category === 'chat') return ['b-chat', 'chat'];
    if (it.category === 'broadcast') return ['b-bcast', 'broadcast'];
    if (it.category === 'combat') {
      if (it.label === 'death' || it.kind === 'player:death') return ['b-kill', it.label || 'death'];
      if (it.label === 'kill') return ['b-kill', 'kill'];
      return ['b-warn', it.label || 'combat'];
    }
    if (it.category === 'mission') return ['b-good', it.label || 'mission'];
    if (it.category === 'quantum') return ['b-acc', it.label || 'quantum'];
    if (it.category === 'player') return ['b-acc', it.label || 'player'];
    if (it.category === 'notify') return ['b-warn', 'hud'];
    if (it.recognized === false || it.category === 'log') {
      return ['b-raw', it.label || 'log'];
    }
    return ['b-good', it.label || it.kind || 'event'];
  }

  toggleFeedRaw (id) {
    const key = String(id || '');
    if (!key) return;
    const cur = this.state.feedRawOpen ? new Set(this.state.feedRawOpen) : new Set();
    if (cur.has(key)) cur.delete(key); else cur.add(key);
    this.setState({ feedRawOpen: cur.size ? cur : null });
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

  baseQ () {
    const D = this.state.analytics;
    return (D && D.quantum || []).filter((q) => this.mSel(ymOf(q.ts)) && this.pSel(q.player));
  }

  baseI () {
    const D = this.state.analytics;
    return (D && D.incap || []).filter((i) => this.mSel(ymOf(i.ts)) && this.pSel(i.player));
  }

  baseC () {
    const D = this.state.analytics;
    return (D && D.crimestat || []).filter((c) => this.mSel(ymOf(c.ts)) && this.pSel(c.player));
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

  async loadAnalyzeExtras () {
    try {
      const [groupsRes, treeRes] = await Promise.all([
        fetch('/services/star-citizen/groups').then((r) => (r.ok ? r.json() : { data: [] })),
        fetch('/services/star-citizen/activity-tree').then((r) => (r.ok ? r.json() : null))
      ]);
      const groups = Array.isArray(groupsRes.data) ? groupsRes.data : (Array.isArray(groupsRes) ? groupsRes : []);
      const publishId = this.state.azPublishGroupId || (groups[0] && groups[0].id) || '';
      this.setState({
        azGroups: groups,
        azTree: treeRes,
        azPublishGroupId: publishId
      }, () => this.loadGroupTreeTip(publishId));
    } catch (_) { /* offline */ }
  }

  async loadGroupTreeTip (groupId) {
    if (!groupId) {
      this.setState({ azGroupTreeTip: null });
      return;
    }
    try {
      const res = await fetch(`/services/star-citizen/groups/${encodeURIComponent(groupId)}/statechain?limit=20`);
      if (!res.ok) {
        this.setState({ azGroupTreeTip: null });
        return;
      }
      const j = await res.json();
      const tip = (j.data && j.data.activityTree) || null;
      this.setState({
        azGroupTreeTip: tip
          ? Object.assign({ groupId, stateDigest: j.data.stateDigest, clock: j.data.clock }, tip)
          : { groupId, empty: true, stateDigest: j.data && j.data.stateDigest, clock: j.data && j.data.clock }
      });
    } catch (_) {
      this.setState({ azGroupTreeTip: null });
    }
  }

  async publishActivityTree () {
    const groupId = this.state.azPublishGroupId;
    if (!groupId || this.state.azPublishBusy) return;
    this.setState({ azPublishBusy: true, azPublishStatus: null });
    try {
      const res = await fetch('/services/star-citizen/activity-tree/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, publish: true })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      this.setState({
        azPublishBusy: false,
        azPublishStatus: `Published tree root ${String(j.tree && j.tree.root).slice(0, 16)}… (${(j.tree && j.tree.leafCount) || 0} leaves) to group`,
        azTree: j.tree || this.state.azTree
      });
      await this.loadGroupTreeTip(groupId);
    } catch (e) {
      this.setState({ azPublishBusy: false, azPublishStatus: e.message || String(e) });
    }
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
    const D = this.state.analytics || {};
    const months = new Set();
    // Preserve month filter from Home slicer (empty set = all months via mSel).
    (D.heatcells || []).forEach((c) => { if (this.mSel(c.ym)) months.add(c.ym); });
    const cells = activityHeat.resolveHeatcells(D, {
      months: months.size ? months : null
    }).filter((c) => this.mSel(c.ym));
    return activityHeat.renderHeatSvg(cells, {
      accent: ACC,
      gray: GRAY,
      emptyHtml: '<div class="empty">no activity in the selected months</div>'
    });
  }

  rDonutHtml (ms) {
    return missionCharts.renderOutcomesDonut(ms, {
      selected: this.state.azOutcomes
    });
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

  /** Shared cumulative-history view model for Home activity panels. */
  buildAnalyzeModel () {
    const D = this.state.analytics;
    if (!D) return null;

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
    const qs = this.baseQ();
    const is = this.baseI();
    const cs = this.baseC();
    const src = D.sources || {};
    const kpis = [
      ['Active pilots', pil.size, null],
      ['Sessions', curSessions, prev ? dl(curSessions, prev.sessions) : null],
      ['Missions done', done, prev ? dl(done, prev.done) : null],
      ['Completion', rate + '%', null],
      ['Deaths', ds.length, prev ? dl(ds.length, prev.deaths) : null],
      ['QT hops', qs.filter((q) => q.phase === 'select').length, React.createElement('div', { className: 'd' }, qs.filter((q) => q.phase === 'arrive').length + ' arrivals')],
      ['Incapacitated', is.length, null],
      ['CrimeStat', cs.length, null]
    ];

    const base = this.baseM();
    const msMain = base.filter((m) => this.tSel(m.type) && this.fSel(facOf(m)));
    const msBars = base.filter((m) => this.oSel(m.outcome) && this.fSel(facOf(m)));
    const msFac = base.filter((m) => this.oSel(m.outcome) && this.tSel(m.type));

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

    const destCounts = {};
    qs.filter((q) => q.phase === 'select' && q.destination).forEach((q) => {
      destCounts[q.destination] = (destCounts[q.destination] || 0) + 1;
    });
    const destRows = Object.keys(destCounts).map((k) => ({ n: k, c: destCounts[k] }))
      .sort((a, b) => b.c - a.c).slice(0, 12);

    return {
      D, months, asc, selArr, lo, hi, ss, years, byY, src, kpis,
      msMain, msBars, msFac, rows, cmpRows, af, ts, fs, destRows
    };
  }

  renderHomeFilters (m) {
    const { D, asc, lo, hi, ss, years, byY, src, af, ts, fs } = m;
    return React.createElement('div', { className: 'home-flyover' },
      React.createElement('div', { style: { padding: '10px 14px 4px', fontSize: 12, color: 'var(--muted)' } },
        'Filters cross-cut KPIs and the selected view · ' +
        `${src.fileCount || 0} log files` +
        (src.importedDirs || src.importedFiles
          ? ` · ${src.importedDirs || 0} folders · ${src.importedFiles || 0} files imported`
          : '') +
        (src.pendingFiles ? ` · ${src.pendingFiles} pending` : '') +
        ' · import via My logs…'),
      React.createElement('div', { style: { padding: '8px 14px 14px' } },
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
              this.setState({ azMonths: new Set((D.availableMonths || []).filter((mo) => mo >= f && mo <= t)) });
            }
          }, asc.map((mo) => React.createElement('option', { key: mo, value: mo }, mo))),
          React.createElement('span', { className: 'flab', style: { minWidth: 0 } }, 'to'),
          React.createElement('select', {
            style: ss,
            value: hi,
            onChange: (e) => {
              let f = lo || e.target.value; let t = e.target.value;
              if (f > t) { const x = f; f = t; t = x; }
              this.setState({ azMonths: new Set((D.availableMonths || []).filter((mo) => mo >= f && mo <= t)) });
            }
          }, asc.map((mo) => React.createElement('option', { key: mo, value: mo }, mo))),
          React.createElement('span', { style: { flexBasis: '100%', height: 0 } }),
          years.map((y) => React.createElement(React.Fragment, { key: y },
            React.createElement('span', { className: 'flab', style: { minWidth: 0 } }, y),
            byY[y].map((mo) => React.createElement('button', {
              type: 'button',
              key: mo,
              className: 'chip ' + (this.mSel(mo) ? 'on' : ''),
              onClick: () => {
                const next = this.state.azMonths ? new Set(this.state.azMonths) : new Set(D.availableMonths);
                if (next.has(mo)) next.delete(mo); else next.add(mo);
                this.setState({ azMonths: next });
              }
            }, MON[+mo.split('-')[1] - 1]))
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
    );
  }

  renderHomeTree (m) {
    const { ss } = m;
    const tree = this.state.azTree;
    const leaves = (tree && Array.isArray(tree.leaves)) ? tree.leaves : [];
    const digests = (tree && Array.isArray(tree.digests)) ? tree.digests : [];
    const tip = this.state.azGroupTreeTip;
    const shortHex = (h, n = 16) => {
      const s = String(h || '');
      return s.length > n ? s.slice(0, n) + '…' : (s || '—');
    };
    const shortTs = (iso) => {
      if (!iso) return '—';
      try {
        return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      } catch (_) {
        return String(iso).slice(0, 19);
      }
    };
    return React.createElement('section', { className: 'panel full' },
      React.createElement('h2', null, '🌳 Activity Tree ',
        React.createElement('span', { className: 'sub' },
          '— composed history Merkle root, leaf provenance, and sealed Group tip')
      ),
      React.createElement('div', { style: { padding: '12px 14px' } },
        React.createElement('div', { className: 'sub', style: { marginBottom: 10, lineHeight: 1.55 } },
          'Local tree is built from cumulative history leaves (content-addressed). ',
          'Publishing seals the tip into the group Statechain (GroupActivityTree) with ownerPubkey provenance.'),
        tree
          ? React.createElement('div', {
            className: 'sub',
            style: { marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 14 }
          },
          React.createElement('span', null, 'local leaves ', React.createElement('b', null, String(tree.leafCount || 0))),
          React.createElement('span', null, 'local root ',
            React.createElement('code', null, shortHex(tree.root, 24))),
          tip && tip.root
            ? React.createElement('span', null, 'sealed tip ',
              React.createElement('code', null, shortHex(tip.root, 24)))
            : React.createElement('span', null, 'sealed tip ', React.createElement('b', null, tip && tip.empty ? 'none yet' : '—')),
          tip && tip.ownerPubkey
            ? React.createElement('span', null, 'publisher ',
              React.createElement('code', null, shortHex(tip.ownerPubkey, 14)))
            : null,
          tip && tip.clock != null
            ? React.createElement('span', null, 'statechain clock ', React.createElement('b', null, String(tip.clock)))
            : null
          )
          : React.createElement('div', { className: 'sub', style: { marginBottom: 8 } }, 'Building tree preview…'),
        React.createElement('div', { className: 'slrow' },
          React.createElement('select', {
            style: ss,
            value: this.state.azPublishGroupId,
            onChange: (e) => {
              const id = e.target.value;
              this.setState({ azPublishGroupId: id }, () => this.loadGroupTreeTip(id));
            }
          },
          React.createElement('option', { value: '' }, 'Select a group…'),
          (this.state.azGroups || []).map((g) => React.createElement('option', {
            key: g.id,
            value: g.id
          }, g.name || g.slug || g.id))),
          React.createElement('button', {
            type: 'button', className: 'btn',
            disabled: this.state.azPublishBusy || !this.state.azPublishGroupId,
            onClick: () => this.publishActivityTree()
          }, this.state.azPublishBusy ? 'Publishing…' : 'Publish to Group'),
          React.createElement('button', {
            type: 'button', className: 'btn',
            onClick: () => this.loadAnalyzeExtras()
          }, 'Refresh tree'),
          React.createElement('button', {
            type: 'button', className: 'btn',
            onClick: () => this.setState({ azTreeShowLeaves: !this.state.azTreeShowLeaves })
          }, this.state.azTreeShowLeaves ? 'Hide leaves' : 'Inspect leaves')
        ),
        this.state.azPublishStatus
          ? React.createElement('div', { className: 'sub', style: { marginTop: 8 } }, this.state.azPublishStatus)
          : React.createElement('div', { className: 'sub', style: { marginTop: 8 } },
            'Leaves are content-addressed mission/death/QT/incap/CrimeStat/session records — not raw log lines.'),
        this.state.azTreeShowLeaves
          ? React.createElement('div', {
            style: {
              marginTop: 12, maxHeight: 320, overflow: 'auto',
              border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg)',
              fontFamily: "'Cascadia Code',Consolas,monospace", fontSize: 11.5
            }
          },
          React.createElement('div', {
            style: {
              display: 'grid', gridTemplateColumns: '72px 1fr 90px 1.2fr', gap: 8,
              padding: '6px 10px', color: 'var(--muted)', fontWeight: 600,
              position: 'sticky', top: 0, background: 'var(--bg)', borderBottom: '1px solid #20262f'
            }
          },
          React.createElement('span', null, 'kind'),
          React.createElement('span', null, 'id / player'),
          React.createElement('span', null, 'when'),
          React.createElement('span', null, 'digest · provenance')
          ),
          !leaves.length
            ? React.createElement('div', {
              style: { padding: 20, textAlign: 'center', color: 'var(--muted)' }
            }, 'No history leaves yet — play or import Game.logs.')
            : leaves.slice(0, 200).map((leaf, i) => React.createElement('div', {
              key: leaf.id || i,
              title: digests[i] || '',
              style: {
                display: 'grid', gridTemplateColumns: '72px 1fr 90px 1.2fr', gap: 8,
                padding: '6px 10px', borderBottom: '1px solid #20262f', alignItems: 'baseline'
              }
            },
            React.createElement('span', null, leaf.kind || '—'),
            React.createElement('span', null,
              shortHex(leaf.id, 18),
              leaf.player ? ` · ${leaf.player}` : ''),
            React.createElement('span', null, shortTs(leaf.ts)),
            React.createElement('span', { style: { color: 'var(--muted)' } },
              shortHex(digests[i], 12),
              ' · local cumulative history')
            ))
          )
          : null,
        tip && Array.isArray(tip.digests) && tip.digests.length
          ? React.createElement('div', { className: 'sub', style: { marginTop: 10 } },
            `Selected group sealed tip stores ${tip.digests.length} digests` +
            (tip.leafCount != null ? ` (leafCount ${tip.leafCount})` : '') +
            (tip.generatedAt ? ` · sealed ${shortTs(tip.generatedAt)}` : '') +
            '.')
          : null
      )
    );
  }

  renderHomePilots (m) {
    const { rows, cmpRows } = m;
    return React.createElement(React.Fragment, null,
      React.createElement('section', { className: 'panel full' },
        React.createElement('h2', null, '🏅 Pilots ',
          React.createElement('span', { className: 'sub' }, '— click a row to filter')
        ),
        React.createElement('div', { style: { padding: '6px 14px 12px' } },
          !rows.length
            ? React.createElement('div', { className: 'empty' }, 'no pilot activity in range yet')
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
          React.createElement('span', { className: 'sub' }, '— side-by-side (ignores pilot filter)')
        ),
        React.createElement('div', { style: { padding: '12px 14px' } },
          cmpRows.length < 2
            ? React.createElement('div', { className: 'empty' }, 'needs ≥2 pilots with activity')
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

    const logSub = !info
      ? 'locating…'
      : (info.exists
        ? `${info.channel || 'log'} · ${fmt(info.size)} · ${shortTime(info.mtime)}`
        : 'not found — set path in Settings');

    return React.createElement('section', { className: 'panel full' },
      React.createElement('h2', null, '🗂 Game.log ',
        React.createElement('span', {
          className: 'sub',
          title: (info && info.path) || undefined
        }, logSub),
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
    const ms = this.state.missionStats || {};
    const info = this.state.loginfo;
    const fmt = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB');
    const liveSub = !info
      ? 'locating Game.log…'
      : (info.exists
        ? `${info.channel || 'log'} · ${fmt(info.size)} · ${shortTime(info.mtime)}`
        : 'Game.log not found — set path in Settings');
    const items = this.filteredFeedItems();
    const cats = this.state.feedCategories || FEED_CATEGORIES;
    const sources = this.state.feedSourcesMeta || FEED_SOURCES;
    const peerCount = (this.state.feed || []).filter((it) => it.source === 'peer').length;
    const mstats = `missions ✅${ms.completed || 0} · ⤺${ms.abandoned || 0} · ✖${ms.failed || 0} · ●${ms.active || 0}` +
      (peerCount ? ` · ${peerCount} from peers` : '');

    return React.createElement('main', null,
      React.createElement('section', { className: 'panel full live-stream' },
        React.createElement('h2', null, '📡 Live feed ',
          React.createElement('span', { className: 'sub' },
            '— chat-style stream of parsed Game.log events, peer shares, chat & broadcasts. ',
            mstats),
          React.createElement('button', {
            className: 'btn',
            type: 'button',
            onClick: () => this.copyAll()
          }, this.state.copyAllLabel)
        ),
        React.createElement('div', { className: 'live-bar' },
          React.createElement('span', {
            className: 'sub',
            title: (info && info.path) || undefined
          }, liveSub),
          React.createElement('button', {
            type: 'button', className: 'btn',
            onClick: () => this.openMyLogs()
          }, 'My logs…')
        ),
        React.createElement('div', { className: 'live-filters' },
          this.renderChips('type', cats.map(([v, t]) => ({ v, t })), 'feedCats'),
          this.renderChips('from', sources.map(([v, t]) => ({ v, t })), 'feedSources'),
          React.createElement('div', { className: 'slrow', style: { marginBottom: 0 } },
            React.createElement('input', {
              type: 'text',
              value: this.state.filter,
              placeholder: 'filter by keyword(s), comma-separated…',
              onChange: (e) => this.setState({ filter: e.target.value })
            }),
            React.createElement('span', { className: 'sub' },
              `${items.length} shown` +
              ((this.state.feed || []).length !== items.length
                ? ` / ${(this.state.feed || []).length}`
                : ''))
          )
        ),
        React.createElement('div', { className: 'live-msgs', ref: this._feedRef },
          items.length
            ? items.map((it, i) => {
              const [cls, label] = this.feedBadge(it);
              const id = it.id || String(i);
              const rawOpen = !!(this.state.feedRawOpen && this.state.feedRawOpen.has(id));
              const showRaw = !!(it.hasRaw && it.raw);
              const kws = keywordsFrom(this.state.filter);
              const prov = it.provenance || {
                origin: it.source === 'peer' ? 'peer' : 'local',
                label: it.source === 'peer' ? 'peer' : 'local',
                peerId: it.sourceId || null
              };
              const fieldBadges = Array.isArray(it.badges) ? it.badges : [];
              return React.createElement('div', {
                className: 'live-msg' + (prov.origin === 'peer' ? ' peer' : ''),
                key: id
              },
              React.createElement('div', { className: 'm' },
                React.createElement('span', { className: 'badge ' + cls }, label),
                React.createElement('span', { className: 't' }, shortTime(it.ts)),
                showRaw
                  ? React.createElement('button', {
                    className: 'rawtog' + (rawOpen ? ' on' : ''),
                    type: 'button',
                    title: rawOpen ? 'Hide Game.log line' : 'Show Game.log line',
                    onClick: () => this.toggleFeedRaw(id)
                  }, rawOpen ? 'Hide raw' : 'Raw log')
                  : null,
                React.createElement('button', {
                  className: 'copy',
                  type: 'button',
                  onClick: () => this.copyRaw(it.raw || it.body, 'copy_' + id)
                }, this.state['copy_' + id] || 'copy')
              ),
              React.createElement('div', {
                className: 'b',
                dangerouslySetInnerHTML: {
                  __html: highlight(it.body || '', kws)
                }
              }),
              (fieldBadges.length || it.meta)
                ? React.createElement('div', { className: 'tags' },
                  fieldBadges.map((b, bi) => React.createElement('span', {
                    key: (b.kind || 't') + ':' + b.value + ':' + bi,
                    className: 'fb fb-' + (b.kind || 'type'),
                    title: (b.label || b.kind || '') + ': ' + b.value
                  },
                  React.createElement('span', { className: 'fk' }, b.label || b.kind),
                  b.value
                  )),
                  it.meta && !fieldBadges.some((b) => b.value === it.meta)
                    ? React.createElement('span', { className: 'fb', title: String(it.meta) },
                      React.createElement('span', { className: 'fk' }, 'id'),
                      String(it.meta).length > 28 ? String(it.meta).slice(0, 12) + '…' : it.meta)
                    : null
                )
                : null,
              React.createElement('div', { className: 'prov' },
                React.createElement('span', null, 'from'),
                React.createElement('span', {
                  className: 'plabel ' + (prov.origin || 'local'),
                  title: prov.peerId || prov.detail || undefined
                }, prov.label || prov.origin || 'local'),
                prov.origin === 'peer' && prov.peerId
                  ? React.createElement('code', { title: prov.peerId },
                    prov.peerAlias
                      ? String(prov.peerId).slice(0, 12) + '…'
                      : (String(prov.peerId).slice(0, 16) + (String(prov.peerId).length > 16 ? '…' : '')))
                  : null,
                prov.detail && prov.origin === 'local'
                  ? React.createElement('span', null, '· ' + prov.detail)
                  : null
              ),
              showRaw && rawOpen
                ? React.createElement('div', {
                  className: 'rawline',
                  dangerouslySetInnerHTML: { __html: highlight(it.raw, kws) }
                })
                : null
              );
            })
            : React.createElement('div', { className: 'empty' },
              (this.state.feed || []).length
                ? 'nothing matches these filters — click All on type/from, or clear keywords'
                : 'nothing yet — play, chat, or wait for peer events on the Fabric mesh')
        )
      )
    );
  }

  renderHomeView (m) {
    const view = this.state.homeView;
    if (!view) return null;
    if (view === 'heatmap' && m) {
      return React.createElement('section', { className: 'panel full' },
        React.createElement('h2', null, '🗓️ When you fly ',
          React.createElement('span', { className: 'sub' }, '— day & hour (local); darker = busier')),
        React.createElement('div', {
          style: { padding: '12px 14px', overflow: 'auto' },
          dangerouslySetInnerHTML: { __html: this.rHeatHtml() }
        })
      );
    }
    if (view === 'charts' && m) {
      return React.createElement(React.Fragment, null,
        React.createElement('section', { className: 'panel' },
          React.createElement('h2', null, '🎯 Mission outcomes ',
            React.createElement('span', { className: 'sub' }, '— click a slice to filter')),
          React.createElement('div', { style: { padding: '12px 14px' }, dangerouslySetInnerHTML: { __html: this.rDonutHtml(m.msMain) } })
        ),
        React.createElement('section', { className: 'panel' },
          React.createElement('h2', null, '📊 By mission type ',
            React.createElement('span', { className: 'sub' }, '— click a bar to focus')),
          React.createElement('div', { style: { padding: '12px 14px' }, dangerouslySetInnerHTML: { __html: this.rBarsHtml(m.msBars) } })
        ),
        React.createElement('section', { className: 'panel full' },
          React.createElement('h2', null, '🏷️ By faction ',
            React.createElement('span', { className: 'sub' }, '— click a row to filter')),
          React.createElement('div', { style: { padding: '12px 14px', overflow: 'auto' }, dangerouslySetInnerHTML: { __html: this.rFactionHtml(m.msFac) } })
        )
      );
    }
    if (view === 'quantum' && m) {
      return m.destRows.length
        ? React.createElement('section', { className: 'panel full' },
          React.createElement('h2', null, '🚀 Quantum destinations ',
            React.createElement('span', { className: 'sub' }, '— QT targets in the filtered period')),
          React.createElement('div', { style: { padding: '12px 14px' } },
            m.destRows.map((r) => React.createElement('div', {
              key: r.n,
              style: { display: 'flex', gap: 10, fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--line)' }
            },
            React.createElement('span', { style: { flex: 1 } }, r.n),
            React.createElement('span', { className: 'chip on' }, r.c)))
          )
        )
        : React.createElement('section', { className: 'panel full' },
          React.createElement('h2', null, '🚀 Quantum destinations'),
          React.createElement('div', { className: 'empty' }, 'no QT hops in the filtered period')
        );
    }
    if (view === 'pilots' && m) return this.renderHomePilots(m);
    if (view === 'tree' && m && this.state.advancedMode) return this.renderHomeTree(m);
    if (view === 'rules' && this.state.advancedMode) return this.renderRulesPanel();
    return null;
  }

  renderHome () {
    const c = this.state.counts;
    const sess = c.session || {};
    const m = this.buildAnalyzeModel();
    const view = this.state.homeView;

    const onAzClick = (e) => {
      const t = e.target.closest('[data-oc],[data-ty],[data-fac]');
      if (!t) return;
      if (t.dataset.oc) this.tog('azOutcomes', t.dataset.oc);
      else if (t.dataset.ty) this.tog('azTypes', t.dataset.ty);
      else if (t.dataset.fac) this.tog('azFactions', t.dataset.fac);
    };

    const cards = [
      ['live', '📡 Live Feed', 'Watch Game.log events as they happen — missions, objectives, combat and deaths, parsed in real time.',
        `${sess.missions || 0} missions · ${sess.deaths || 0} deaths this session`],
      ['library', '📸 Library', 'Periodic reduced-size snapshots of your play sessions — browsable history, ready for image analysis.',
        'opt-in · configurable interval · auto-purge'],
      ['fleet', '🚀 Fleet', 'Import Starjump / FleetViewer JSON, browse your ships, share to peers, groups, or public.',
        'personal roster · Fabric FleetShare'],
      ['missions', '⭐ Missions', 'Post contracts with Bitcoin rewards — submit completion, authorities approve with Schnorr signatures, coins unlock.',
        'k-of-n approval · escrowed sats'],
      ['wallet', '₿ Wallet', 'Group multisig addresses and mission escrows — deterministic k-of-n P2WSH from each group\'s roster.',
        'ledger or bitcoind · regtest first'],
      ['chat', '💬 Chat', 'Org chat with Hub message types — a global channel plus a dedicated channel for every group.',
        'ChatMessage · signed · synced via your peers'],
      ['groups', '👥 Groups', 'Member-created squads with k-of-n Schnorr decisions. Share a public group page; others apply to join.',
        'pages at /groups/:id (or a custom URL)'],
      ['peers', '🌐 Peers', 'Fabric Network peer management — push your signed event batches to org hubs like goon.vc.',
        'Fabric Protocol · idempotent delivery'],
      ['messages', '📨 Messages', 'Complete Fabric AMP Message log — every signed wire Message in or out. Not Game.log.',
        'advanced · filter · pause · clear']
    ].filter(([tab]) => featureEnabled(tab) && (this.state.advancedMode || !ADVANCED_TABS.has(tab)));

    const activeFilters = m && m.af && m.af.length
      ? m.af.length + ' filter' + (m.af.length === 1 ? '' : 's') + ' active'
      : null;

    return React.createElement('main', { onClick: onAzClick },
      React.createElement('section', { className: 'panel full' },
        React.createElement('h2', null, '🛰️ GoonCitizen ',
          React.createElement('span', { className: 'sub' },
            '— cumulative history from your logs')
        ),
        React.createElement('div', { className: 'home-tools' },
          React.createElement('button', {
            type: 'button',
            className: 'btn' + (this.state.homeFiltersOpen ? ' on' : ''),
            onClick: () => this.toggleHomeFilters()
          }, activeFilters || 'Filters'),
          React.createElement('button', {
            type: 'button',
            className: 'btn',
            onClick: () => this.openMyLogs()
          }, 'My logs…'),
          React.createElement('span', { className: 'sub' },
            m
              ? `${c.missions || 0} missions · ${c.deaths || 0} deaths all-time`
              : (this.state.azLoading ? 'loading activity…' : 'activity loading…'))
        ),
        React.createElement('div', { className: 'home-views' },
          this.homeViewList().map(([key, label]) => React.createElement('button', {
            key,
            type: 'button',
            className: 'tab ' + (view === key ? 'on' : ''),
            onClick: () => this.setHomeView(key)
          }, label))
        ),
        this.state.homeFiltersOpen && m ? this.renderHomeFilters(m) : null,
        m
          ? React.createElement('div', { className: 'kpis' },
            m.kpis.map((k) => React.createElement('div', { className: 'mc', key: k[0] },
              React.createElement('div', { className: 'l' }, k[0]),
              React.createElement('div', { className: 'v' }, k[1]),
              k[2]
            ))
          )
          : React.createElement('div', { className: 'empty' },
            this.state.azLoading ? 'loading cumulative activity…' : 'no activity history yet — open My logs… to import, or start the game')
      ),
      this.renderHomeView(m),
      !view
        ? React.createElement('section', { className: 'panel full' },
          React.createElement('h2', null, 'Features ',
            React.createElement('span', { className: 'sub' }, '— jump to Feed, Missions, Groups, and the rest')
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
        : null
    );
  }

  renderTab () {
    switch (this.state.tab) {
      case 'live': return this.renderLive();
      case 'missions': return React.createElement(Missions, {
        identityPubkey: this.state.identityPubkey,
        analytics: this.state.analytics
      });
      case 'wallet': return featureEnabled('wallet') ? React.createElement(Wallet, null) : this.renderHome();
      case 'library': return featureEnabled('library') ? React.createElement(Library, null) : this.renderHome();
      case 'fleet': return React.createElement(Fleet, {
        identityPubkey: this.state.identityPubkey,
        onOpenIdentity: () => this.setState({ showIdentity: true })
      });
      case 'chat': return React.createElement(Chat, {
        identityPubkey: this.state.identityPubkey,
        nickname: this.state.nickname
      });
      case 'groups': return React.createElement(Groups, {
        identityPubkey: this.state.identityPubkey,
        advancedMode: this.state.advancedMode
      });
      case 'peers': return this.state.advancedMode
        ? React.createElement(Peers, {
          showProfileActivity: this.state.showProfileActivity,
          analytics: this.state.analytics
        })
        : this.renderHome();
      case 'messages': return this.state.advancedMode ? React.createElement(FabricMessages, null) : this.renderHome();
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
    const sess = c.session || {};

    return React.createElement(React.Fragment, null,
      React.createElement(Onboarding, {
        onReady: (pubkey) => this.setState({
          identityPubkey: pubkey || null,
          identityExists: pubkey ? true : this.state.identityExists,
          identityLocked: !pubkey
        }),
        onLocked: () => this.setState({
          identityPubkey: null,
          identityLocked: true,
          showIdentity: false
        })
      }),
      React.createElement(FabricLoginModal, null),
      React.createElement(GroupOfferModal, {
        pasteOpen: this.state.showFabricImport,
        onPasteClose: () => this.setState({ showFabricImport: false })
      }),
      this.renderMyLogsModal(),
      this.state.showSettings
        ? React.createElement(Settings, {
          onClose: () => this.setState({ showSettings: false }),
          onOpenIdentity: () => this.setState({ showSettings: false, showIdentity: true }),
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
              // Drop advanced-only Home views when leaving advanced mode.
              if (!on && (s.homeView === 'tree' || s.homeView === 'rules')) {
                next.homeView = null;
              }
              return next;
            });
          },
          showProfileActivity: this.state.showProfileActivity,
          onShowProfileActivityChange: (on) => {
            ActivityHeatmap.writeShowProfileActivity(on);
            this.setState({ showProfileActivity: on });
          }
        })
        : null,
      this.state.showIdentity
        ? React.createElement(Identity, {
          onClose: () => {
            this.setState({ showIdentity: false });
            this.loadPresenceChip();
          },
          onForget: () => this.setState({ identityPubkey: null, identityExists: false, identityLocked: false }),
          onNicknameChange: (n) => this.setState({ nickname: n || null }),
          onPresenceChange: (p) => this.applyPresenceChip(p),
          showProfileActivity: this.state.showProfileActivity,
          analytics: this.state.analytics
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
            React.createElement('button', {
              type: 'button',
              className: 'btn',
              title: 'Paste an encoded fabric:<hex> message (group offer, invite, …)',
              onClick: () => this.setState({ showFabricImport: true })
            }, 'Import…'),
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
              ? React.createElement('div', { className: 'idchip-wrap' },
                React.createElement('button', {
                  className: 'pill idchip ' +
                    (this.state.identityPubkey ? 'on' : 'off') +
                    (this.state.showIdFlyout ? ' open' : ''),
                  title: this.state.identityPubkey
                    ? ((this.state.nickname ? this.state.nickname + ' · ' : '') +
                      (this.state.presenceStatusText ? this.state.presenceStatusText + ' · ' : '') +
                      (this.state.presenceShip ? this.state.presenceShip + ' · ' : '') +
                      (this.state.presenceOnline ? 'online' : 'offline') +
                      ' — quick presence; Identity for profile & keys')
                    : (this.state.identityExists ? 'identity locked — click for flyout' : 'identity — click for flyout'),
                  onClick: (e) => {
                    e.stopPropagation();
                    if (!this.state.identityPubkey && this.state.identityExists) {
                      this.setState({ showIdFlyout: false, showIdentity: true });
                      return;
                    }
                    this.setState((s) => ({ showIdFlyout: !s.showIdFlyout }));
                  }
                },
                this.state.identityPubkey
                  ? React.createElement(React.Fragment, null,
                    React.createElement('span', {
                      className: 'id-dot' +
                        (this.state.presenceOnline ? ' on' : '') +
                        (this.state.presenceSharing ? ' share' : '')
                    }),
                    React.createElement('span', { className: 'id-label' },
                      '🔑 ' + (this.state.nickname
                        ? this.state.nickname
                        : (this.state.identityPubkey.slice(0, 8) + '…'))),
                    this.state.presenceStatusText
                      ? React.createElement('span', { className: 'id-ship', title: this.state.presenceStatusText },
                        '· ' + this.state.presenceStatusText)
                      : (this.state.presenceShip
                        ? React.createElement('span', { className: 'id-ship', title: this.state.presenceShip },
                          '· ' + this.state.presenceShip)
                        : null)
                  )
                  : (this.state.identityExists ? '🔒 locked' : '🔑 identity')
                ),
                this.renderIdentityFlyout()
              )
              : React.createElement(SiteLogin, null),
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
          ))
        ),
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
Dashboard.CSS = CSS + '\n' + (LogBrowser.CSS || '');

module.exports = Dashboard;
