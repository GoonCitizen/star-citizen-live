'use strict';

/**
 * Groups tab — create and manage k-of-n Schnorr multisig groups.
 *
 * Talks to the relay's group API (`/services/star-citizen/groups`). When the
 * Electron identity is unlocked, the panel logs in via a Schnorr envelope
 * (`POST …/auth`) and acts as that pubkey; mutations are attributed to the
 * authenticated session. Without an identity (browser mode / locked), the
 * panel is read-only and shows how to enable management.
 */

const React = require('react');
const Chat = require('./Chat');
const GroupFabricInspector = require('./GroupFabricInspector');
const LocalGroups = require('./LocalGroups');
const GroupBitcoinPanel = require('./GroupBitcoinPanel');
const { readAppHash, setAppHash } = require('../functions/appHash');
const {
  sanitizePinnedChannels
} = require('../functions/groupPinnedChannels');
const {
  shareClipboardText,
  shareNotice,
  createdNotice
} = require('../functions/groupJoinFlow');
const {
  readPinnedGroupIds,
  writePinnedGroupIds,
  togglePinnedGroupId,
  orderGroupsWithPins
} = require('../functions/groupSidebarPins');
const { fabricMessageHref } = require('../functions/collectionRecords');
const { fetchPresenceRoster } = require('../functions/presenceClient');
const groupPresence = require('../functions/groupPresence');
const GroupComposition = require('./GroupComposition');
const StarMap = require('./StarMap');

const BASE = '/services/star-citizen';
const PUBKEY_RE = /^0[23][0-9a-f]{64}$/;

const CSS = `
  .gp-wrap{display:grid;gap:16px;grid-template-columns:minmax(280px,340px) 1fr;align-items:start;transition:grid-template-columns .18s ease}
  .gp-wrap.collapsed{grid-template-columns:52px 1fr}
  @media(max-width:900px){
    .gp-wrap,.gp-wrap.collapsed{grid-template-columns:1fr}
    .gp-wrap.collapsed .gp-side-body{display:block}
    .gp-rail{display:none}
  }
  .gp-side{position:relative;min-width:0}
  .gp-side-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .gp-side-head h2{flex:1;min-width:0}
  .gp-collapse{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:7px;
    padding:4px 10px;font-size:12px;cursor:pointer;white-space:nowrap}
  .gp-collapse:hover{border-color:var(--accent)}
  .gp-wrap.collapsed .gp-side-body{display:none}
  .gp-wrap.collapsed .gp-side{padding:0;overflow:hidden}
  .gp-side-head h2{margin:0;font-size:inherit;flex:1}
  .gp-side-head .btn{flex-shrink:0}
  .gp-rail{display:none;flex-direction:column;align-items:center;gap:10px;padding:12px 8px;min-height:120px}
  .gp-wrap.collapsed .gp-rail{display:flex}
  .gp-rail-btn{writing-mode:vertical-rl;transform:rotate(180deg);background:var(--panel2);border:1px solid var(--line);
    color:var(--text);border-radius:7px;padding:12px 6px;font-size:12px;font-weight:600;cursor:pointer;letter-spacing:.3px}
  .gp-rail-btn:hover{border-color:var(--accent)}
  .gp-me{display:flex;gap:8px;align-items:center;font-size:12px;color:var(--muted);
    padding:8px 14px;border-bottom:1px solid var(--line)}
  .gp-me code{font-family:'Cascadia Code',Consolas,monospace;font-size:11px;color:var(--text);
    word-break:break-all}
  .gp-row{display:flex;gap:10px;align-items:center;padding:9px 14px;border-bottom:1px solid #20262f;
    cursor:pointer}
  .gp-row:hover{background:var(--panel2)}
  .gp-row.on{background:var(--panel2);box-shadow:inset 2px 0 0 var(--accent)}
  .gp-row .n{font-weight:600;flex:1}
  .gp-row .d{color:var(--muted);font-size:11.5px;white-space:nowrap}
  .gp-row .pin{background:none;border:none;color:var(--muted);cursor:pointer;padding:0 4px;font-size:13px;line-height:1}
  .gp-row .pin.on{color:#f7931a}
  .gp-row .pin:hover{color:#f7931a}
  .gp-chat-tools{padding:10px 14px;display:grid;gap:10px;border-bottom:1px solid var(--line);
    background:rgba(59,130,246,.05)}
  .gp-chat-tools h4{margin:0;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted)}
  .gp-chat-tools .hint{font-size:11.5px;color:var(--muted);line-height:1.45}
  .gp-log{padding:4px 0 12px}
  .gp-log-row{padding:8px 14px;border-bottom:1px solid #20262f;display:grid;gap:6px}
  .gp-log-row.open{background:rgba(56,139,253,.05)}
  .gp-log-row .t{font-size:12.5px;font-weight:600}
  .gp-log-row .m{font-size:11.5px;color:var(--muted)}
  .gp-log-head{display:flex;align-items:flex-start;gap:8px}
  .gp-log-copy{flex:1;min-width:0;display:grid;gap:2px}
  .gp-log-actions{display:flex;gap:6px;flex-shrink:0}
  .gp-log-actions .gp-btn{padding:2px 9px;font-size:11px;justify-self:auto;text-decoration:none}
  .gp-log-json{margin:0;padding:10px;background:var(--bg);border:1px solid var(--line);border-radius:7px;
    font-family:'Cascadia Code',Consolas,monospace;font-size:11px;overflow:auto;max-height:280px;
    white-space:pre-wrap;word-break:break-all}
  .gp-form{padding:12px 14px;display:grid;gap:10px}
  .gp-form label{font-size:12px;color:var(--muted)}
  .gp-form input,.gp-form textarea{width:100%;background:var(--bg);border:1px solid var(--line);
    color:var(--text);border-radius:7px;padding:8px 10px;font-size:13px;box-sizing:border-box}
  .gp-form textarea{min-height:64px;font-family:'Cascadia Code',Consolas,monospace;font-size:11.5px;resize:vertical}
  .gp-btn{background:var(--accent);border:none;color:#fff;border-radius:7px;padding:8px 16px;
    font-size:13px;font-weight:600;cursor:pointer;justify-self:start}
  .gp-btn:disabled{opacity:.45;cursor:default}
  .gp-btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
  .gp-btn.danger{background:transparent;border:1px solid var(--line);color:var(--kill);
    padding:2px 9px;font-size:11px;font-weight:500}
  .gp-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:8px 11px;font-size:12.5px;margin:0 14px 10px}
  .gp-ok{background:rgba(63,185,80,.12);color:var(--good);border-radius:7px;padding:8px 11px;font-size:12.5px;margin:0 14px 10px}
  .gp-member{display:flex;gap:10px;align-items:center;padding:7px 14px;border-bottom:1px solid #20262f}
  .gp-member code{font-family:'Cascadia Code',Consolas,monospace;font-size:11px;word-break:break-all;flex:1}
  .gp-tag{font-size:10px;font-weight:700;padding:1px 7px;border-radius:5px;white-space:nowrap}
  .gp-tag.creator{background:rgba(59,130,246,.18);color:var(--accent)}
  .gp-tag.you{background:rgba(63,185,80,.15);color:var(--good)}
  .gp-meta{padding:10px 14px;color:var(--muted);font-size:12px;display:flex;gap:16px;flex-wrap:wrap}
  .gp-meta b{color:var(--text)}
  .gp-add{display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--line)}
  .gp-add input{flex:1;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:7px 10px;font-size:12px;font-family:'Cascadia Code',Consolas,monospace}
  .gp-invite{display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--line);flex-wrap:wrap}
  .gp-invite input{flex:1;min-width:180px;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:7px 10px;font-size:12px;font-family:'Cascadia Code',Consolas,monospace}
  .gp-share{padding:12px 14px;display:grid;gap:8px;border-top:1px solid var(--line);
    background:rgba(59,130,246,.07)}
  .gp-share .hint{font-size:12.5px;line-height:1.5;color:var(--text)}
  .gp-toggle{display:flex;gap:8px;align-items:center;font-size:13px;color:var(--text)}
  .gp-toggle input{accent-color:var(--accent)}
  .gp-hint{color:var(--muted);padding:20px 14px;font-size:13px;line-height:1.6}
  .gp-tag.primary{background:rgba(59,130,246,.2);color:var(--accent)}
  .gp-tag.public{background:rgba(63,185,80,.15);color:var(--good)}
  .gp-tag.private{background:rgba(110,118,129,.18);color:var(--muted)}
  .gp-actions{display:flex;flex-wrap:wrap;gap:8px;padding:10px 14px;border-top:1px solid var(--line)}
  .gp-tabs{display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px;border-bottom:1px solid var(--line)}
  .gp-tab{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:7px;
    padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer}
  .gp-tab:hover{border-color:var(--accent)}
  .gp-tab.on{background:rgba(59,130,246,.16);border-color:var(--accent);color:var(--accent)}
  .gp-section{padding:0 0 8px}
  .gp-wallet{padding:12px 14px;display:grid;gap:10px}
  .gp-wallet .addr{font-family:'Cascadia Code',Consolas,monospace;font-size:11px;word-break:break-all;color:var(--text)}
  .gp-prop{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid #20262f}
  .gp-app{display:grid;gap:6px;padding:10px 14px;border-bottom:1px solid #20262f}
  .gp-detail-wrap{position:relative;overflow:hidden;min-height:480px}
  .gp-detail{display:flex;flex-direction:column;min-height:480px}
  .gp-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line);
    flex:none;position:relative;z-index:7;background:var(--panel)}
  .gp-head h2{margin:0;font-size:16px;font-weight:650;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .gp-head .sub{color:var(--muted);font-weight:400;font-size:12px}
  .gp-cog{margin-left:auto;background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:8px;width:34px;height:34px;flex:none;cursor:pointer;font-size:15px;line-height:1;
    display:inline-flex;align-items:center;justify-content:center}
  .gp-cog:hover,.gp-cog.on{border-color:var(--accent);background:rgba(56,139,253,.1)}
  .gp-body-wrap{position:relative;flex:1 1 auto;min-height:360px}
  .gp-settings{position:relative;inset:auto;z-index:auto;background:var(--panel);border-left:none;
    box-shadow:none;display:flex;flex-direction:column;overflow:auto;flex:1;min-height:480px;width:auto;max-width:none}
  @media(min-width:720px){
    .gp-settings{left:auto;width:auto}
  }
  .gp-settings-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line);flex:none}
  .gp-settings-head h3{margin:0;flex:1;font-size:14px;font-weight:650}
  .gp-settings-body{padding:12px 14px 20px;display:grid;gap:14px}
  .gp-set-sec{display:grid;gap:8px}
  .gp-set-sec h4{margin:0;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted)}
  .gp-set-sec .hint{font-size:11.5px;color:var(--muted);line-height:1.45}
  .gp-set-actions{display:flex;flex-wrap:wrap;gap:8px}
  .gp-settings .gp-form{padding:0}
  .gp-chat{border-top:none}
  .gp-chat h3{font-size:12px;color:var(--muted);margin:0;padding:12px 14px 6px;text-transform:uppercase;letter-spacing:.4px}
  .gp-chat .chat-wrap{border-radius:0}
  .gp-mode{display:flex;gap:6px;padding:8px 14px;border-bottom:1px solid var(--line)}
  .gp-mode button{flex:1;background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer}
  .gp-mode button.on{background:rgba(59,130,246,.16);border-color:var(--accent);color:var(--accent)}
`;

const SIDEBAR_KEY = 'gooncitizen.groups.sidebarCollapsed';
const ROSTER_KEY = 'gooncitizen.groups.rosterMode';
const DETAIL_TABS = [
  ['chat', 'Chat'],
  ['members', 'Members'],
  ['log', 'Log'],
  ['fleets', 'Fleets'],
  ['wallet', 'Wallet'],
  ['proposals', 'Proposals'],
  ['applications', 'Applications'],
  ['fabric', 'Fabric']
];
const DETAIL_TAB_IDS = new Set(DETAIL_TABS.map(([id]) => id));

function readSidebarCollapsed () {
  try {
    return (typeof localStorage !== 'undefined') && localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch (_) {
    return false;
  }
}

function writeSidebarCollapsed (collapsed) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
    }
  } catch (_) { /* ignore */ }
}

function readRosterMode () {
  try {
    const v = (typeof localStorage !== 'undefined') && localStorage.getItem(ROSTER_KEY);
    return v === 'local' ? 'local' : 'federation';
  } catch (_) {
    return 'federation';
  }
}

function writeRosterMode (mode) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ROSTER_KEY, mode === 'local' ? 'local' : 'federation');
    }
  } catch (_) { /* ignore */ }
}

function identityBridge () {
  return (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.identity) || null;
}

function shortKey (pubkey) {
  return pubkey ? pubkey.slice(0, 10) + '…' + pubkey.slice(-6) : '—';
}

function journalEntryLabel (entry) {
  const type = String((entry && entry.type) || '');
  const msg = (entry && entry.message) || {};
  if (type === 'FleetShare') {
    return 'Fleet shared' + (msg.name ? ': ' + msg.name : '');
  }
  if (type === 'GroupChange') {
    const action = String(msg.action || '');
    const patch = msg.patch && typeof msg.patch === 'object' ? msg.patch : null;
    if (action === 'update' && patch && Object.prototype.hasOwnProperty.call(patch, 'pinnedMessages')) {
      const n = Array.isArray(patch.pinnedMessages) ? patch.pinnedMessages.length : 0;
      return n ? ('Pinned messages updated (' + n + ')') : 'Pinned messages cleared';
    }
    if (action === 'update' && patch && Object.prototype.hasOwnProperty.call(patch, 'pinnedChannels')) {
      const n = Array.isArray(patch.pinnedChannels) ? patch.pinnedChannels.length : 0;
      return n ? ('Pinned chats updated (' + n + ')') : 'Pinned chats cleared';
    }
    if (action === 'update') return 'Group settings updated';
    if (action === 'member.add') return 'Member added';
    if (action === 'member.remove') return 'Member removed';
    return 'Group change';
  }
  if (type === 'GroupChangeProposal') return 'Proposal opened';
  if (type === 'GroupChangeVote') return 'Proposal vote';
  if (type === 'GroupApplication') return 'Join application';
  if (type === 'GroupApplicationDecision') return 'Application decided';
  if (type === 'GroupActivityTree') return 'Activity tree published';
  if (type === 'FederationContractInviteResponse') return 'Invite response';
  return type || 'Event';
}

class Groups extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      token: null,
      pubkey: props.identityPubkey || null,
      groups: [],
      selectedId: null,
      primaryGroupId: null,
      loading: true,
      error: null,
      notice: null,
      // create form
      name: '',
      membersText: '',
      threshold: 1,
      parentId: '',
      visibility: 'private',
      showCreateMembers: false,
      creating: false,
      showCreate: false,
      createKind: 'group',
      inviteKey: '',
      lastShare: null,
      // manage
      addKey: '',
      busy: false,
      sidebarCollapsed: readSidebarCollapsed(),
      rosterMode: readRosterMode(),
      detailTab: 'chat',
      groupWallet: null,
      proposals: [],
      applications: [],
      groupFleets: [],
      groupJournal: [],
      localFleets: [],
      presenceRoster: {},
      shareFleetId: '',
      newFleetName: '',
      pinnedGroupIds: readPinnedGroupIds(),
      detailLoading: false,
      colorEdit: '#3b82f6',
      settingsOpen: false,
      settingsView: 'main',
      logOpenId: null
    };
  }

  componentDidMount () {
    this._onHash = () => this.applyHashSelection();
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', this._onHash);
    }
    this.connect();
    if (typeof window !== 'undefined') {
      window.addEventListener('gooncitizen:group-imported', this._onImported);
    }
  }

  componentWillUnmount () {
    if (this._onHash && typeof window !== 'undefined') {
      window.removeEventListener('hashchange', this._onHash);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('gooncitizen:group-imported', this._onImported);
    }
  }

  _onImported = () => {
    this.refresh().catch(() => {});
  };

  componentDidUpdate (prev) {
    if (prev.identityPubkey !== this.props.identityPubkey && this.props.identityPubkey) {
      this.setState({ pubkey: this.props.identityPubkey, token: null }, () => this.connect());
    }
  }

  /** Deep link `#groups?id=<groupId>&tab=fleets` (from Fleet share browse). */
  applyHashSelection () {
    const { path, query } = readAppHash();
    if (path !== 'groups') return;
    const groups = this.state.groups || [];
    if (!groups.length) return;
    const id = query.id || null;
    let tab = query.tab || null;
    if (tab === 'fleet') tab = 'fleets';
    const settings = tab === 'settings';
    if (tab && !DETAIL_TAB_IDS.has(tab) && !settings) tab = null;
    if (tab === 'fabric' && !this.props.advancedMode) tab = null;
    if (id && groups.some((g) => g.id === id)) {
      if (id !== this.state.selectedId) {
        this.selectGroup(id, {
          detailTab: settings ? (this.state.detailTab || 'chat') : (tab || this.state.detailTab || 'chat'),
          skipHash: true,
          settingsOpen: settings
        });
      } else {
        const patch = {};
        if (settings !== !!this.state.settingsOpen) {
          patch.settingsOpen = settings;
          if (!settings) patch.settingsView = 'main';
        }
        if (!settings && tab && tab !== this.state.detailTab) patch.detailTab = tab;
        if (Object.keys(patch).length) this.setState(patch);
      }
      return;
    }
    if (tab && tab !== this.state.detailTab && this.state.selectedId) {
      this.setState({ detailTab: tab });
    }
  }

  async connect () {
    this.setState({ loading: true, error: null });
    const token = await this.login();
    await this.refresh(token);
  }

  /** Schnorr login via the Electron identity bridge; null when unavailable. */
  async login () {
    const bridge = identityBridge();
    if (!bridge) return null;
    try {
      const info = await bridge.get();
      if (!info || !info.unlocked) return null;
      const envelope = await bridge.signEnvelope({ intent: 'login', ts: new Date().toISOString() });
      if (!envelope || envelope.error) return null;
      const res = await fetch(`${BASE}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope)
      });
      if (!res.ok) return null;
      const json = await res.json();
      const token = json.data && json.data.token;
      this.setState({ token, pubkey: json.data && json.data.pubkey });
      return token;
    } catch (_) {
      return null;
    }
  }

  headers (token) {
    const h = { 'Content-Type': 'application/json' };
    const t = token || this.state.token;
    if (t) h.Authorization = `Bearer ${t}`;
    return h;
  }

  async refresh (token) {
    try {
      const [groupsRes, settingsRes] = await Promise.all([
        fetch(`${BASE}/groups`, { headers: this.headers(token) }),
        fetch('/settings').then((r) => (r.ok ? r.json() : null)).catch(() => null)
      ]);
      const json = await groupsRes.json();
      const groups = (json && json.data) || [];
      const primaryGroupId = (settingsRes && settingsRes.settings && settingsRes.settings.primaryGroupId)
        || (settingsRes && settingsRes.runtime && settingsRes.runtime.primaryGroupId)
        || null;
      let nextId = null;
      let hashTab = null;
      this.setState((s) => {
        const { path, query } = readAppHash();
        const hashId = (path === 'groups' && query.id) || null;
        hashTab = (path === 'groups' && query.tab) || null;
        if (hashTab === 'fleet') hashTab = 'fleets';
        if (hashTab && !DETAIL_TAB_IDS.has(hashTab)) hashTab = null;
        if (hashTab === 'fabric' && !this.props.advancedMode) hashTab = null;
        nextId = (hashId && groups.some((g) => g.id === hashId))
          ? hashId
          : (s.selectedId && groups.some((g) => g.id === s.selectedId)
            ? s.selectedId
            : (groups[0] && groups[0].id) || null);
        return {
          groups,
          primaryGroupId,
          loading: false,
          selectedId: nextId,
          detailTab: hashTab || s.detailTab || 'chat'
        };
      }, () => {
        if (nextId) this.loadGroupExtras(nextId);
      });
    } catch (e) {
      this.setState({ loading: false, error: e.message });
    }
  }

  async setPrimaryGroup (groupId) {
    if (this.state.busy) return;
    this.setState({ busy: true, error: null, notice: null });
    try {
      const value = groupId && groupId === this.state.primaryGroupId ? null : groupId;
      const res = await fetch('/settings/primaryGroupId', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const next = (json.settings && json.settings.primaryGroupId) || null;
      const color = (json.runtime && json.runtime.primaryGroupColor) || null;
      this.setState({
        busy: false,
        primaryGroupId: next,
        notice: next ? 'Primary group updated — enable the desktop overlay in Settings to pin members & ships.' : 'Primary group cleared.'
      });
      if (typeof this.props.onPrimaryGroupTheme === 'function') {
        this.props.onPrimaryGroupTheme(next ? color : null);
      }
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  parseMembers () {
    return this.state.membersText
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  createValid () {
    const extras = this.parseMembers();
    if (!this.state.name.trim()) return false;
    if (extras.some((k) => !PUBKEY_RE.test(k))) return false;
    const total = new Set([this.state.pubkey].concat(extras)).size;
    const t = Number(this.state.threshold) || 1;
    return t >= 1 && t <= total;
  }

  async create () {
    if (!this.createValid() || this.state.creating) return;
    this.setState({ creating: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/groups`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          name: this.state.name.trim(),
          members: this.parseMembers(),
          threshold: Number(this.state.threshold) || 1,
          parentId: this.state.parentId || undefined,
          visibility: this.state.visibility === 'public' ? 'public' : 'private',
          creator: this.state.pubkey // local relay fallback; ignored when a session exists
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const created = json.data || json;
      const parentId = this.state.parentId || '';
      const asChannel = this.state.createKind === 'channel';
      if (asChannel && parentId && created && created.id && this.state.pubkey) {
        const parent = (this.state.groups || []).find((g) => g.id === parentId);
        if (parent && parent.creator === this.state.pubkey) {
          const next = sanitizePinnedChannels(parent.pinnedChannels).concat(['group:' + created.id]);
          await fetch(`${BASE}/groups/${encodeURIComponent(parentId)}`, {
            method: 'PUT',
            headers: this.headers(),
            body: JSON.stringify({ pinnedChannels: next })
          }).catch(() => null);
        }
      }
      this.setState({
        creating: false, showCreate: false, name: '', membersText: '', threshold: 1, parentId: '',
        visibility: 'private', showCreateMembers: false, createKind: 'group',
        settingsView: 'main',
        settingsOpen: false,
        notice: asChannel
          ? ('Channel created — it is a Federation group with its own chat and log.')
          : createdNotice(created),
        selectedId: created.id,
        detailTab: 'chat'
      });
      await this.refresh();
    } catch (e) {
      this.setState({ creating: false, error: e.message });
    }
  }

  async member (groupId, pubkey, remove) {
    if (this.state.busy) return;
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/groups/${groupId}/members`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ pubkey, remove: !!remove, actor: this.state.pubkey })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({ busy: false, addKey: '', notice: remove ? 'Member removed.' : 'Member added.' });
      await this.refresh();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  shareUrl (g) {
    const path = g.path || `/groups/${g.slug || g.id}`;
    return `${window.location.origin}${path}`;
  }

  async share (g) {
    this.setState({ busy: true, error: null, notice: null, lastShare: null });
    try {
      const publicShare = g.visibility === 'public';
      const path = publicShare
        ? `${BASE}/groups/${encodeURIComponent(g.id)}/share`
        : `${BASE}/groups/${encodeURIComponent(g.id)}/invites`;
      const body = publicShare
        ? { relay: true }
        : { relay: false, note: `Join ${g.name}` };
      const res = await fetch(path, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const data = Object.assign({ visibility: g.visibility }, json.data || {});
      const url = shareClipboardText(data);
      if (!url) throw new Error('no protocolUrl in share response');
      const page = this.shareUrl(g);
      try {
        await navigator.clipboard.writeText(url);
        this.setState({
          busy: false,
          lastShare: Object.assign({}, data, { pageUrl: page }),
          notice: shareNotice(data, page),
          error: data.relayed || !publicShare ? null : (data.relayError || null)
        });
      } catch (_) {
        this.setState({
          busy: false,
          lastShare: Object.assign({}, data, { pageUrl: page }),
          notice: shareNotice(data, page) + ' (copy the invite below)',
          error: data.relayed || !publicShare ? null : (data.relayError || null)
        });
      }
    } catch (e) {
      const url = this.shareUrl(g);
      try {
        await navigator.clipboard.writeText(url);
        this.setState({ busy: false, notice: 'Page link copied (Fabric share failed: ' + e.message + ').', error: e.message });
      } catch (_) {
        this.setState({ busy: false, error: e.message, notice: url });
      }
    }
  }

  async inviteMember (g) {
    const pubkey = this.state.inviteKey.trim();
    if (!g || !PUBKEY_RE.test(pubkey) || this.state.busy) return;
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/groups/${encodeURIComponent(g.id)}/invites`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          inviteePubkey: pubkey,
          note: `You're invited to join ${g.name}`
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const data = json.data || {};
      const url = shareClipboardText(data);
      if (url) {
        try { await navigator.clipboard.writeText(url); } catch (_) { /* ignore */ }
      }
      const mesh = data.relayed
        ? `Invite sent to the network (${data.peers || 0} peer connection(s)).`
        : 'Invite copied — they paste it via Import… and Accept.';
      this.setState({
        busy: false,
        inviteKey: '',
        lastShare: data,
        notice: mesh
      });
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  openPage (g) {
    const path = g.path || `/groups/${g.slug || g.id}`;
    window.location.href = path;
  }

  async toggleVisibility (g) {
    if (this.state.busy) return;
    this.setState({ busy: true, error: null, notice: null });
    try {
      const next = g.visibility === 'public' ? 'private' : 'public';
      const res = await fetch(`${BASE}/groups/${encodeURIComponent(g.id)}`, {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify({ visibility: next })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({ busy: false, notice: next === 'public' ? 'Group is now public — Share so others can apply. Join requests land in Notifications.' : 'Group is now private — Share copies a join invite.' });
      await this.refresh();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  copy (text) {
    try { navigator.clipboard.writeText(text); this.setState({ notice: 'Copied to clipboard.' }); } catch (_) { /* ignore */ }
  }

  renderSharePanel () {
    const data = this.state.lastShare;
    const clip = shareClipboardText(data);
    if (!data || !clip) return null;
    const page = data.pageUrl || null;
    return React.createElement('div', { className: 'gp-share' },
      React.createElement('div', { className: 'hint' },
        data.kind === 'FederationContractInvite' || data.visibility === 'private'
          ? 'Send this invite privately. They open GoonCitizen → Import…, paste, and Join from Notifications.'
          : 'They paste this via Import… to apply. You will see the join request in Notifications.'
      ),
      React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
        React.createElement('button', {
          className: 'gp-btn',
          type: 'button',
          onClick: () => this.copy(clip)
        }, 'Copy invite again'),
        page
          ? React.createElement('button', {
            className: 'gp-btn ghost',
            type: 'button',
            onClick: () => this.copy(page)
          }, 'Copy page link')
          : null,
        React.createElement('button', {
          className: 'gp-btn ghost',
          type: 'button',
          onClick: () => this.setState({ lastShare: null })
        }, 'Done')
      )
    );
  }

  setSidebarCollapsed (collapsed) {
    writeSidebarCollapsed(!!collapsed);
    this.setState({ sidebarCollapsed: !!collapsed });
  }

  setRosterMode (mode) {
    const next = mode === 'local' ? 'local' : 'federation';
    writeRosterMode(next);
    this.setState({ rosterMode: next, error: null, notice: null });
  }

  renderRosterToggle () {
    const mode = this.state.rosterMode === 'local' ? 'local' : 'federation';
    return React.createElement('div', { className: 'gp-mode' },
      React.createElement('button', {
        type: 'button',
        className: mode === 'federation' ? 'on' : '',
        onClick: () => this.setRosterMode('federation')
      }, 'Federation'),
      React.createElement('button', {
        type: 'button',
        className: mode === 'local' ? 'on' : '',
        onClick: () => this.setRosterMode('local')
      }, 'Local tags')
    );
  }

  selectGroup (id, opts = {}) {
    const g = (this.state.groups || []).find((x) => x.id === id);
    const detailTab = opts.detailTab && DETAIL_TAB_IDS.has(opts.detailTab)
      ? opts.detailTab
      : 'chat';
    const settingsOpen = opts.settingsOpen === true;
    this.setState({
      selectedId: id,
      detailTab,
      groupWallet: null,
      proposals: [],
      applications: [],
      groupFleets: [],
      groupJournal: [],
      colorEdit: (g && g.primaryColor) || '#3b82f6',
      settingsOpen,
      settingsView: 'main',
      error: null
    }, () => {
      this.loadGroupExtras(id);
      if (!opts.skipHash) this.syncGroupHash();
    });
  }

  setDetailTab (tab) {
    if (!DETAIL_TAB_IDS.has(tab)) return;
    if (tab === 'fabric' && !this.props.advancedMode) return;
    this.setState({ detailTab: tab, settingsOpen: false, settingsView: 'main' }, () => {
      this.syncGroupHash();
    });
  }

  syncGroupHash () {
    if (!this.state.selectedId) return;
    const query = { id: this.state.selectedId };
    if (this.state.settingsOpen) query.tab = 'settings';
    else if (this.state.detailTab && this.state.detailTab !== 'chat') query.tab = this.state.detailTab;
    setAppHash('groups', query);
  }

  async savePrimaryColor (g) {
    if (!g || this.state.busy) return;
    this.setState({ busy: true, error: null, notice: null });
    try {
      const value = this.state.colorEdit === '' || this.state.colorEdit == null
        ? null
        : this.state.colorEdit;
      const res = await fetch(`${BASE}/groups/${encodeURIComponent(g.id)}`, {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify({ primaryColor: value })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({
        busy: false,
        notice: value
          ? ('Primary color set to ' + value + (g.id === this.state.primaryGroupId ? ' — theming the app.' : ' — set as primary to theme the app.'))
          : 'Primary color cleared.'
      });
      await this.refresh();
      if (g.id === this.state.primaryGroupId && typeof this.props.onPrimaryGroupTheme === 'function') {
        this.props.onPrimaryGroupTheme(value);
      }
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  togglePinnedGroup (groupId, ev) {
    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
    const next = writePinnedGroupIds(togglePinnedGroupId(this.state.pinnedGroupIds, groupId));
    this.setState({ pinnedGroupIds: next });
  }

  async shareFleetToGroup (g) {
    if (!g || this.state.busy) return;
    const fleetId = String(this.state.shareFleetId || '').trim();
    if (!fleetId) return;
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/fleets/${encodeURIComponent(fleetId)}/share`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ visibility: 'groups', groupIds: [g.id], includeExport: true })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json && json.error) || `HTTP ${res.status}`);
      this.setState({
        busy: false,
        notice: 'Fleet shared to this group — members see it in Fleets and the group log.'
      });
      await this.loadGroupExtras(g.id);
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async createFleetOnGroup (g) {
    if (!g || this.state.busy) return;
    const name = String(this.state.newFleetName || '').trim() || (g.name + ' fleet');
    this.setState({ busy: true, error: null, notice: null });
    try {
      const created = await fetch(`${BASE}/fleets`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          custom: true,
          name,
          ships: [],
          visibility: 'groups',
          groupIds: [g.id]
        })
      });
      const cj = await created.json().catch(() => ({}));
      if (!created.ok) throw new Error((cj && cj.error) || `HTTP ${created.status}`);
      const fleetId = cj.data && (cj.data.id || cj.data.fleetId);
      if (fleetId) {
        const shared = await fetch(`${BASE}/fleets/${encodeURIComponent(fleetId)}/share`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ visibility: 'groups', groupIds: [g.id], includeExport: true })
        });
        const sj = await shared.json().catch(() => ({}));
        if (!shared.ok) throw new Error((sj && sj.error) || `HTTP ${shared.status}`);
      }
      this.setState({
        busy: false,
        newFleetName: '',
        notice: 'Created “' + ((cj.data && cj.data.name) || name) +
          '” on this group — members see it in Fleets and the group log.'
      });
      await this.loadGroupExtras(g.id);
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async loadGroupExtras (groupId) {
    const id = groupId || this.state.selectedId;
    if (!id) return;
    this.setState({ detailLoading: true });
    const headers = this.headers();
    let groupWallet = null;
    let proposals = [];
    let applications = [];
    let groupFleets = [];
    let groupJournal = [];
    let localFleets = [];
    let presenceRoster = {};
    try {
      const wr = await fetch(`${BASE}/groups/${encodeURIComponent(id)}/wallet`, { headers });
      const wj = await wr.json().catch(() => ({}));
      groupWallet = wr.ok ? (wj.data || wj) : { error: (wj && wj.error) || `HTTP ${wr.status}` };
    } catch (e) {
      groupWallet = { error: e.message || String(e) };
    }
    try {
      const pr = await fetch(`${BASE}/groups/${encodeURIComponent(id)}/proposals`, { headers });
      if (pr.ok) proposals = ((await pr.json()).data) || [];
    } catch (_) { /* optional */ }
    try {
      const ar = await fetch(`${BASE}/groups/${encodeURIComponent(id)}/applications`, { headers });
      if (ar.ok) {
        applications = (((await ar.json()).data) || []).filter((a) => a.status === 'pending');
      }
    } catch (_) { /* optional */ }
    try {
      const fr = await fetch(`${BASE}/groups/${encodeURIComponent(id)}/fleets`, { headers });
      if (fr.ok) groupFleets = ((await fr.json()).data) || [];
    } catch (_) { /* optional */ }
    try {
      const jr = await fetch(`${BASE}/groups/${encodeURIComponent(id)}/statechain?limit=80`, { headers });
      if (jr.ok) {
        const body = await jr.json();
        const data = (body && body.data) || body || {};
        groupJournal = ((data.journal && data.journal.entries) || []).slice();
      }
    } catch (_) { /* optional */ }
    try {
      const lf = await fetch(`${BASE}/fleets?scope=mine`, { headers });
      if (lf.ok) localFleets = ((await lf.json()).data) || [];
    } catch (_) { /* optional */ }
    try {
      const pr = await fetchPresenceRoster();
      if (pr.ok) presenceRoster = pr.data || {};
    } catch (_) { /* optional */ }
    if (this.state.selectedId !== id) return;
    this.setState({
      groupWallet, proposals, applications, groupFleets, groupJournal, localFleets, presenceRoster, detailLoading: false
    });
  }

  async voteProposal (proposalId) {
    const g = this.state.groups.find((x) => x.id === this.state.selectedId);
    if (!g || this.state.busy) return;
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(
        `${BASE}/groups/${encodeURIComponent(g.id)}/proposals/${encodeURIComponent(proposalId)}/votes`,
        { method: 'POST', headers: this.headers(), body: JSON.stringify({}) }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({
        busy: false,
        notice: json.adopted ? 'Proposal adopted.' : 'Vote recorded — waiting for more signatures.'
      });
      await this.loadGroupExtras(g.id);
      await this.refresh();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async decideApplication (applicationId, decision) {
    const g = this.state.groups.find((x) => x.id === this.state.selectedId);
    if (!g || this.state.busy) return;
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(
        `${BASE}/group-applications/${encodeURIComponent(applicationId)}/decision`,
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ decision })
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({
        busy: false,
        notice: decision === 'accept' ? 'Application accepted.' : 'Application rejected.'
      });
      await this.loadGroupExtras(g.id);
      await this.refresh();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async proposeWithdraw () {
    const g = this.state.groups.find((x) => x.id === this.state.selectedId);
    if (!g || this.state.busy) return;
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/groups/${encodeURIComponent(g.id)}/withdrawals`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ action: 'spend', utxoAgeBlocks: 0 })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      const pref = json.data && json.data.prepared && json.data.prepared.preferredTierId;
      const tiers = (json.data && json.data.prepared && json.data.prepared.activeTiers) || [];
      const tip = tiers.length
        ? `Active tier: ${tiers[0].id} (${tiers[0].threshold}-of-n). Address ready — fund UTXO then complete withdrawal.`
        : 'Withdrawal proposed.';
      this.setState({
        busy: false,
        notice: tip + (pref ? ` Preferred: ${pref}` : '')
      });
      await this.loadGroupExtras(g.id);
    } catch (e) {
      this.setState({ busy: false, error: e.message || String(e) });
    }
  }

  renderCreate (opts = {}) {
    const extras = this.parseMembers();
    const badKey = extras.find((k) => !PUBKEY_RE.test(k));
    const total = new Set([this.state.pubkey].concat(extras)).size;
    const asChannel = this.state.createKind === 'channel';
    const nestGroup = opts.nestGroup || null;
    const inSettings = !!opts.inSettings;
    return React.createElement('div', { className: 'gp-form' },
      React.createElement('div', {
        className: 'hint',
        style: { fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }
      }, asChannel
        ? (nestGroup
          ? ('Nested under ' + (nestGroup.name || 'this group') +
            ' — a Federation group with its own chat and log.')
          : 'A chat channel is a Federation group — members get a shared log, pins, and the same Chat thread.')
        : null),
      React.createElement('div', null,
        React.createElement('label', null, asChannel ? 'Channel name' : 'Group name'),
        React.createElement('input', {
          type: 'text', value: this.state.name,
          placeholder: asChannel ? 'e.g. ops-bridge' : 'e.g. Salvage Wing',
          onChange: (e) => this.setState({ name: e.target.value })
        })
      ),
      React.createElement('label', { className: 'gp-toggle' },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.visibility === 'public',
          onChange: (e) => this.setState({ visibility: e.target.checked ? 'public' : 'private' })
        }),
        this.state.visibility === 'public'
          ? 'Public — anyone with the share or page can apply to join'
          : 'Private — join by invite (Share copies a join invite)'
      ),
      React.createElement('button', {
        type: 'button',
        className: 'gp-btn ghost',
        style: { justifySelf: 'start', padding: '4px 10px' },
        onClick: () => this.setState({ showCreateMembers: !this.state.showCreateMembers })
      }, this.state.showCreateMembers ? 'Hide extra signers' : 'Add signers now (optional)'),
      this.state.showCreateMembers
        ? React.createElement(React.Fragment, null,
          React.createElement('div', null,
            React.createElement('label', null, 'Member pubkeys (one per line — you are included automatically)'),
            React.createElement('textarea', {
              value: this.state.membersText,
              placeholder: '02ab…\n03cd…',
              onChange: (e) => this.setState({ membersText: e.target.value })
            })
          ),
          badKey ? React.createElement('div', { className: 'gp-err', style: { margin: 0 } }, 'Not a valid compressed pubkey: ' + badKey) : null,
          React.createElement('div', null,
            React.createElement('label', null, `Signatures required for group decisions (1–${total})`),
            React.createElement('input', {
              type: 'number', min: 1, max: total, value: this.state.threshold,
              style: { width: 90 },
              onChange: (e) => this.setState({ threshold: e.target.value })
            })
          )
        )
        : null,
      nestGroup
        ? null
        : React.createElement('div', null,
          React.createElement('label', null, asChannel
            ? 'Parent group (optional — nest this channel)'
            : 'Parent group (optional — nest as a subgroup)'),
          React.createElement('select', {
            value: this.state.parentId,
            onChange: (e) => this.setState({ parentId: e.target.value })
          },
            React.createElement('option', { value: '' }, '— none (top-level) —'),
            this.state.groups
              .filter((g) => Array.isArray(g.members) && this.state.pubkey && g.members.includes(this.state.pubkey))
              .map((g) => React.createElement('option', { key: g.id, value: g.id }, g.name))
          )
        ),
      React.createElement('div', { style: { display: 'flex', gap: 8 } },
        React.createElement('button', {
          className: 'gp-btn', disabled: !this.createValid() || this.state.creating,
          onClick: () => this.create()
        }, this.state.creating
          ? 'Creating…'
          : (asChannel ? 'Create channel' : 'Create group')),
        React.createElement('button', {
          className: 'gp-btn ghost',
          onClick: () => {
            if (inSettings) {
              this.setState({
                settingsView: 'main', error: null, name: '', membersText: '',
                showCreateMembers: false, createKind: 'group'
              });
              return;
            }
            this.setState({
              showCreate: false, error: null, parentId: '', visibility: 'private',
              showCreateMembers: false, createKind: 'group'
            });
          }
        }, 'Cancel')
      )
    );
  }

  renderMembersTab (g, me, isCreator, canManage) {
    const addValid = PUBKEY_RE.test(this.state.addKey.trim()) && canManage && !g.members.includes(this.state.addKey.trim());
    const memberList = Array.isArray(g.members) ? g.members : null;
    const roster = this.state.presenceRoster || {};
    const owner = isCreator || groupPresence.isGroupOwner(g, me);
    const composition = owner && memberList
      ? groupPresence.summarizeOnlineMembers(memberList, roster)
      : null;
    return React.createElement('div', { className: 'gp-section' },
      composition
        ? React.createElement(GroupComposition, { composition, showMap: true })
        : null,
      memberList
        ? React.createElement('div', null,
          memberList.map((m) => {
            const p = groupPresence.presenceFor(roster, m);
            const chip = groupPresence.presenceChipLabel(p);
            return React.createElement('div', { className: 'gp-member', key: m },
              React.createElement('code', null, m),
              p && p.nickname
                ? React.createElement('span', { className: 'gp-tag you' }, p.nickname)
                : null,
              React.createElement('span', {
                className: 'gp-tag ' + (p && p.online ? 'public' : 'private'),
                title: p && p.lastEventAt || ''
              }, chip),
              m === g.creator ? React.createElement('span', { className: 'gp-tag creator' }, 'creator') : null,
              m === me ? React.createElement('span', { className: 'gp-tag you' }, 'you') : null,
              (isCreator && m !== g.creator)
                ? React.createElement('button', {
                  className: 'gp-btn danger', disabled: this.state.busy,
                  onClick: () => this.member(g.id, m, true)
                }, 'remove')
                : null
            );
          })
        )
        : React.createElement('div', { className: 'gp-hint' },
          'Public group — open the page to apply to join.'
        ),
      canManage
        ? React.createElement('div', { className: 'gp-add' },
          React.createElement('input', {
            type: 'text', value: this.state.addKey, placeholder: 'add member — paste a compressed pubkey (02…/03…)',
            onChange: (e) => this.setState({ addKey: e.target.value })
          }),
          React.createElement('button', {
            className: 'gp-btn', disabled: !addValid || this.state.busy,
            onClick: () => this.member(g.id, this.state.addKey.trim(), false)
          }, 'Add')
        )
        : (memberList
          ? React.createElement('div', { className: 'gp-hint' }, 'Only members can manage this group.')
          : null),
      canManage
        ? React.createElement('div', { className: 'gp-invite' },
          React.createElement('input', {
            type: 'text',
            value: this.state.inviteKey,
            placeholder: 'Invite — paste their compressed pubkey (02…/03…)',
            onChange: (e) => this.setState({ inviteKey: e.target.value })
          }),
          React.createElement('button', {
            className: 'gp-btn',
            disabled: this.state.busy || !PUBKEY_RE.test(this.state.inviteKey.trim()),
            onClick: () => this.inviteMember(g)
          }, 'Send invite')
        )
        : null
    );
  }

  renderFleetsTab () {
    const g = this.state.groups.find((x) => x.id === this.state.selectedId);
    const list = this.state.groupFleets || [];
    const mine = this.state.localFleets || [];
    const shareBox = g
      ? React.createElement('div', {
        className: 'gp-chat-tools',
        style: { borderBottom: list.length ? '1px solid var(--line)' : 'none' }
      },
        React.createElement('h4', null, 'Create a fleet'),
        React.createElement('div', { className: 'hint' },
          'Makes an empty roster on this group (FleetShare). Open it to add ships.'),
        React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 } },
          React.createElement('input', {
            type: 'text',
            value: this.state.newFleetName,
            placeholder: 'New fleet name',
            style: {
              flex: 1, minWidth: 140, background: 'var(--bg)', border: '1px solid var(--line)',
              color: 'var(--text)', borderRadius: 7, padding: '6px 8px', fontSize: 12
            },
            onChange: (e) => this.setState({ newFleetName: e.target.value }),
            onKeyDown: (e) => { if (e.key === 'Enter') void this.createFleetOnGroup(g); }
          }),
          React.createElement('button', {
            type: 'button',
            className: 'gp-btn',
            disabled: this.state.busy,
            onClick: () => this.createFleetOnGroup(g)
          }, 'Create fleet')
        ),
        mine.length
          ? React.createElement(React.Fragment, null,
            React.createElement('h4', null, 'Share a fleet'),
            React.createElement('div', { className: 'hint' },
              'Publishes a FleetShare into this group’s log so every member’s Fleets view updates.'),
            React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
              React.createElement('select', {
                value: this.state.shareFleetId,
                onChange: (e) => this.setState({ shareFleetId: e.target.value }),
                style: {
                  flex: 1, minWidth: 160, background: 'var(--bg)', border: '1px solid var(--line)',
                  color: 'var(--text)', borderRadius: 7, padding: '6px 8px', fontSize: 12
                }
              },
                React.createElement('option', { value: '' }, 'Choose a fleet…'),
                mine.map((f) => React.createElement('option', {
                  key: f.id, value: f.id
                }, (f.name || f.id) + ' · ' + (Number(f.shipCount) || 0) + ' ships'))
              ),
              React.createElement('button', {
                type: 'button',
                className: 'gp-btn',
                disabled: this.state.busy || !this.state.shareFleetId,
                onClick: () => this.shareFleetToGroup(g)
              }, 'Share to group')
            )
          )
          : null
      )
      : null;
    if (this.state.detailLoading && !list.length) {
      return React.createElement('div', { className: 'gp-hint' }, 'Loading fleets…');
    }
    if (!list.length) {
      return React.createElement('div', null,
        shareBox,
        React.createElement('div', { className: 'gp-hint' },
          'No fleets in this group log yet. Create one above, share an existing roster, or open Fleets and pick this group.')
      );
    }
    return React.createElement('div', null,
      shareBox,
      list.map((f) => React.createElement('div', {
        key: f.fleetId || f.id,
        className: 'gp-member',
        style: { flexWrap: 'wrap', gap: 8 }
      },
        React.createElement('span', { style: { flex: 1 } }, f.name || shortKey(f.fleetId || f.id)),
        React.createElement('span', { className: 'gp-tag private' },
          `${Number(f.shipCount) || 0} ships`),
        f.ownerPubkey
          ? React.createElement('span', { className: 'gp-tag private', title: f.ownerPubkey }, shortKey(f.ownerPubkey))
          : null,
        React.createElement('button', {
          className: 'gp-btn ghost',
          style: { padding: '4px 10px' },
          onClick: () => {
            const id = f.fleetId || f.id;
            setAppHash('fleet', id ? { id } : {});
          }
        }, 'Open')
      ))
    );
  }

  renderWalletTab (g, isCreator) {
    const gw = this.state.groupWallet;
    if (this.state.detailLoading && !gw) {
      return React.createElement('div', { className: 'gp-hint' }, 'Loading wallet…');
    }
    if (!gw) {
      return React.createElement('div', { className: 'gp-hint' }, 'Wallet unavailable.');
    }
    return React.createElement('div', { className: 'gp-wallet' },
      React.createElement(GroupBitcoinPanel, {
        wallet: gw,
        bitcoinEnable: this.props.bitcoinEnable,
        isCreator,
        busy: this.state.busy,
        onCopy: (addr) => this.copy(addr),
        onProposeWithdraw: () => this.proposeWithdraw(),
        onRefresh: () => this.loadGroupExtras(g.id)
      })
    );
  }

  renderProposalsTab (canManage) {
    const list = this.state.proposals || [];
    if (this.state.detailLoading && !list.length) {
      return React.createElement('div', { className: 'gp-hint' }, 'Loading proposals…');
    }
    if (!canManage) {
      return React.createElement('div', { className: 'gp-hint' }, 'Join the group to view and sign proposals.');
    }
    if (!list.length) {
      return React.createElement('div', { className: 'gp-hint' }, 'No open proposals.');
    }
    const me = this.state.pubkey;
    return React.createElement('div', { className: 'gp-section' },
      list.map((p) => {
        const sigs = p.signatures ? Object.keys(p.signatures).length : 0;
        const need = Math.max(1, Number(p.threshold) || 1);
        const voted = !!(me && p.signatures && (p.signatures[me] || p.signatures[String(me).toLowerCase()]));
        return React.createElement('div', { className: 'gp-prop', key: p.id },
          React.createElement('span', { className: 'gp-tag private' }, p.action || 'change'),
          React.createElement('span', { style: { flex: 1, fontSize: 13 } },
            (p.member ? shortKey(p.member) + ' · ' : '') + `${sigs}/${need} votes`
          ),
          !voted
            ? React.createElement('button', {
              className: 'gp-btn',
              disabled: this.state.busy,
              onClick: () => this.voteProposal(p.id)
            }, 'Sign')
            : React.createElement('span', { className: 'gp-tag public' }, 'signed')
        );
      })
    );
  }

  renderApplicationsTab (isCreator) {
    const apps = this.state.applications || [];
    if (!isCreator) {
      return React.createElement('div', { className: 'gp-hint' },
        'Only the group creator reviews join applications.');
    }
    if (this.state.detailLoading && !apps.length) {
      return React.createElement('div', { className: 'gp-hint' }, 'Loading applications…');
    }
    if (!apps.length) {
      return React.createElement('div', { className: 'gp-hint' }, 'No pending applications.');
    }
    return React.createElement('div', { className: 'gp-section' },
      apps.map((a) => React.createElement('div', { className: 'gp-app', key: a.id },
        React.createElement('code', null, a.pubkey || a.applicantId || a.applicant || a.id),
        a.message
          ? React.createElement('div', { style: { color: 'var(--muted)', fontSize: 12 } }, a.message)
          : null,
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          React.createElement('button', {
            className: 'gp-btn',
            disabled: this.state.busy,
            onClick: () => this.decideApplication(a.id, 'accept')
          }, 'Accept'),
          React.createElement('button', {
            className: 'gp-btn ghost',
            disabled: this.state.busy,
            onClick: () => this.decideApplication(a.id, 'reject')
          }, 'Reject')
        )
      ))
    );
  }

  renderFabricTab (g) {
    if (!this.props.advancedMode) {
      return React.createElement('div', { className: 'gp-hint' },
        'Enable Advanced mode in Settings to inspect Fabric messages, Statechain history, and encode/decode opaque shares (hex + base64).');
    }
    const headers = {};
    if (this.state.token) headers.Authorization = `Bearer ${this.state.token}`;
    return React.createElement(GroupFabricInspector, {
      key: g.id,
      groupId: g.id,
      contractId: g.contractId || null,
      headers,
      embedded: true
    });
  }

  toggleSettings () {
    this.setState((s) => ({
      settingsOpen: !s.settingsOpen,
      settingsView: 'main'
    }), () => this.syncGroupHash());
  }

  closeSettings () {
    this.setState({ settingsOpen: false, settingsView: 'main' }, () => this.syncGroupHash());
  }

  openNestedChannel (g) {
    if (!g) return;
    this.setState({
      settingsOpen: true,
      settingsView: 'nested',
      showCreate: false,
      createKind: 'channel',
      parentId: g.id,
      visibility: 'private',
      name: '',
      membersText: '',
      threshold: 1,
      showCreateMembers: false,
      error: null,
      notice: null
    });
  }

  renderGroupSettings (g, canManage, isCreator) {
    if (!g || !this.state.settingsOpen) return null;
    const nested = this.state.settingsView === 'nested';
    const mine = this.state.localFleets || [];
    const close = () => this.closeSettings();
    return React.createElement('div', {
      className: 'gp-settings',
      role: 'region',
      'aria-label': nested ? 'Create nested channel' : 'Group settings'
    },
      React.createElement('div', { className: 'gp-settings-head' },
        nested
          ? React.createElement('button', {
            type: 'button',
            className: 'gp-btn ghost',
            style: { padding: '4px 10px' },
            onClick: () => this.setState({
              settingsView: 'main', createKind: 'group', name: '',
              showCreateMembers: false, error: null
            })
          }, '← Back')
          : React.createElement('button', {
            type: 'button',
            className: 'gp-btn ghost',
            style: { padding: '4px 10px' },
            title: 'Close settings',
            'aria-label': 'Back to group',
            onClick: close
          }, '← Back to group'),
        React.createElement('h3', null, nested ? 'Nested channel' : 'Group settings'),
        nested
          ? React.createElement('button', {
            type: 'button',
            className: 'gp-btn ghost',
            style: { padding: '4px 10px' },
            title: 'Close settings',
            'aria-label': 'Back to group',
            onClick: close
          }, '← Back to group')
          : null
      ),
      React.createElement('div', { className: 'gp-settings-body' },
        nested
          ? this.renderCreate({ inSettings: true, nestGroup: g })
          : React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'gp-set-sec' },
              React.createElement('h4', null, 'Channel & share'),
              React.createElement('div', { className: 'hint' },
                'Nested channels are Federation groups under this one. Share copies a join invite or public offer.'),
              React.createElement('div', { className: 'gp-set-actions' },
                React.createElement('button', {
                  type: 'button',
                  className: 'gp-btn ghost',
                  disabled: !canManage,
                  onClick: () => this.openNestedChannel(g)
                }, '+ Nested channel'),
                React.createElement('button', {
                  type: 'button',
                  className: 'gp-btn ghost',
                  disabled: this.state.busy || !canManage,
                  title: g.visibility === 'public'
                    ? 'Copy a share others paste via Import… to apply'
                    : 'Copy a join invite — they paste Import… and Accept',
                  onClick: () => this.share(g)
                }, 'Share this group'),
                React.createElement('button', {
                  type: 'button',
                  className: 'gp-btn ghost',
                  onClick: () => this.openPage(g)
                }, 'Open page')
              )
            ),
            mine.length
              ? React.createElement('div', { className: 'gp-set-sec' },
                React.createElement('h4', null, 'Share a fleet'),
                React.createElement('div', { className: 'hint' },
                  'Writes a FleetShare into this group’s log so members see it on Fleets.'),
                React.createElement('div', { className: 'gp-set-actions' },
                  React.createElement('select', {
                    value: this.state.shareFleetId,
                    onChange: (e) => this.setState({ shareFleetId: e.target.value }),
                    style: {
                      flex: 1, minWidth: 160, background: 'var(--bg)', border: '1px solid var(--line)',
                      color: 'var(--text)', borderRadius: 7, padding: '6px 8px', fontSize: 12
                    }
                  },
                    React.createElement('option', { value: '' }, 'Choose a fleet…'),
                    mine.map((f) => React.createElement('option', {
                      key: f.id, value: f.id
                    }, f.name || f.id))
                  ),
                  React.createElement('button', {
                    type: 'button',
                    className: 'gp-btn',
                    disabled: this.state.busy || !this.state.shareFleetId || !canManage,
                    onClick: () => this.shareFleetToGroup(g)
                  }, 'Share fleet')
                )
              )
              : null,
            canManage
              ? React.createElement('div', { className: 'gp-set-sec' },
                React.createElement('h4', null, 'This node'),
                React.createElement('div', { className: 'hint' },
                  'Primary group themes the dashboard and can pin members & ships on the desktop overlay.'),
                React.createElement('div', { className: 'gp-set-actions' },
                  React.createElement('button', {
                    type: 'button',
                    className: 'gp-btn ghost',
                    disabled: this.state.busy,
                    title: this.state.primaryGroupId === g.id
                      ? 'Clear primary group'
                      : 'Use this group for the desktop member/ship overlay',
                    onClick: () => this.setPrimaryGroup(g.id)
                  }, this.state.primaryGroupId === g.id ? 'Clear primary' : 'Set as primary')
                )
              )
              : null,
            isCreator
              ? React.createElement('div', { className: 'gp-set-sec' },
                React.createElement('h4', null, 'Visibility'),
                React.createElement('div', { className: 'gp-set-actions' },
                  React.createElement('button', {
                    type: 'button',
                    className: 'gp-btn ghost',
                    disabled: this.state.busy,
                    onClick: () => this.toggleVisibility(g)
                  }, g.visibility === 'public' ? 'Make private' : 'Make public')
                )
              )
              : null,
            isCreator
              ? React.createElement('div', { className: 'gp-set-sec' },
                React.createElement('h4', null, 'Primary color'),
                React.createElement('div', { className: 'hint' },
                  'Brand accent for members who set this as their primary group.'),
                React.createElement('label', {
                  style: { display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--muted)' }
                },
                  React.createElement('input', {
                    type: 'color',
                    value: /^#[0-9a-fA-F]{6}$/.test(this.state.colorEdit) ? this.state.colorEdit : '#3b82f6',
                    disabled: this.state.busy,
                    title: 'Brand accent for members who set this as their primary group',
                    onChange: (e) => this.setState({ colorEdit: e.target.value })
                  }),
                  React.createElement('code', { style: { fontSize: 11 } }, this.state.colorEdit || '—')
                ),
                React.createElement('div', { className: 'gp-set-actions' },
                  React.createElement('button', {
                    type: 'button',
                    className: 'gp-btn ghost',
                    disabled: this.state.busy,
                    onClick: () => this.savePrimaryColor(g)
                  }, 'Save color'),
                  g.primaryColor
                    ? React.createElement('button', {
                      type: 'button',
                      className: 'gp-btn ghost',
                      disabled: this.state.busy,
                      onClick: () => this.setState({ colorEdit: '' }, () => this.savePrimaryColor(g))
                    }, 'Clear color')
                    : null
                )
              )
              : (g.primaryColor
                ? React.createElement('div', { className: 'gp-set-sec' },
                  React.createElement('h4', null, 'Accent'),
                  React.createElement('span', null,
                    React.createElement('b', { style: { color: g.primaryColor } }, g.primaryColor)))
                : null)
          )
      )
    );
  }

  renderDetail () {
    const g = this.state.groups.find((x) => x.id === this.state.selectedId);
    if (!g) {
      return React.createElement('div', { className: 'gp-hint' },
        this.state.groups.length
          ? 'Select a group to manage it.'
          : 'No groups yet — create one to share missions with a squad, or Import… a join invite.');
    }
    const me = this.state.pubkey;
    const isCreator = me && g.creator === me;
    const canManage = me && Array.isArray(g.members) && g.members.includes(me);
    const memberList = Array.isArray(g.members) ? g.members : null;
    const tab = this.state.detailTab || 'chat';
    const tabs = DETAIL_TABS.filter(([id]) => id !== 'fabric' || this.props.advancedMode);
    const tabCounts = {
      fleets: (this.state.groupFleets || []).length,
      proposals: (this.state.proposals || []).length,
      applications: (this.state.applications || []).length,
      log: (this.state.groupJournal || []).length
    };

    let body = null;
    if (tab === 'fleets') body = this.renderFleetsTab();
    else if (tab === 'wallet') body = this.renderWalletTab(g, isCreator);
    else if (tab === 'proposals') body = this.renderProposalsTab(canManage);
    else if (tab === 'applications') body = this.renderApplicationsTab(isCreator);
    else if (tab === 'chat') body = this.renderChat(g, canManage);
    else if (tab === 'log') body = this.renderLogTab();
    else if (tab === 'fabric') body = this.renderFabricTab(g);
    else body = this.renderMembersTab(g, me, isCreator, canManage);

    if (this.state.settingsOpen) {
      return React.createElement('div', { className: 'gp-detail' },
        this.renderGroupSettings(g, canManage, isCreator)
      );
    }

    return React.createElement('div', { className: 'gp-detail' },
      React.createElement('div', { className: 'gp-head' },
        React.createElement('h2', { title: g.name }, g.name,
          React.createElement('span', { className: 'sub' },
            ' · ' + (g.visibility || 'private'))
        ),
        React.createElement('button', {
          type: 'button',
          className: 'gp-cog' + (this.state.settingsOpen ? ' on' : ''),
          title: 'Group settings',
          'aria-label': 'Group settings',
          'aria-pressed': this.state.settingsOpen,
          onClick: () => this.toggleSettings()
        }, '⚙️')
      ),
      React.createElement('div', { className: 'gp-body-wrap' },
        React.createElement('div', { className: 'gp-meta' },
          React.createElement('span', null, 'decisions ', React.createElement('b', null, `${g.threshold}-of-${memberList ? memberList.length : 'n'}`)),
          React.createElement('span', null, 'created ', React.createElement('b', null, String(g.createdAt || '').slice(0, 10))),
          React.createElement('span', { className: 'gp-tag ' + (g.visibility === 'public' ? 'public' : 'private') }, g.visibility || 'private'),
          g.id === this.state.primaryGroupId
            ? React.createElement('span', { className: 'gp-tag primary' }, 'primary')
            : null,
          g.parentId
            ? React.createElement('span', null, 'subgroup of ', React.createElement('b', null,
              (this.state.groups.find((x) => x.id === g.parentId) || {}).name || g.parentId.slice(0, 8) + '…'))
            : null,
          React.createElement('span', { title: g.path }, 'page ', React.createElement('b', null, g.path || `/groups/${g.id}`))
        ),
        React.createElement('div', { className: 'gp-tabs', role: 'tablist' },
          tabs.map(([id, label]) => {
            const count = tabCounts[id];
            const text = count ? `${label} (${count})` : label;
            return React.createElement('button', {
              key: id,
              type: 'button',
              role: 'tab',
              className: 'gp-tab' + (tab === id ? ' on' : ''),
              'aria-selected': tab === id,
              onClick: () => this.setDetailTab(id)
            }, text);
          })
        ),
        body
      )
    );
  }

  renderLogTab () {
    const list = this.state.groupJournal || [];
    if (this.state.detailLoading && !list.length) {
      return React.createElement('div', { className: 'gp-hint' }, 'Loading group log…');
    }
    if (!list.length) {
      return React.createElement('div', { className: 'gp-hint' },
        'No synchronized events yet. Pin a message in Chat, share a fleet, or change membership — those GroupChange / FleetShare rows land here for every member.');
    }
    return React.createElement('div', { className: 'gp-log' },
      list.map((entry, i) => {
        const key = (entry && entry.id) || ('j' + i);
        const open = this.state.logOpenId === key;
        const hash = entry && entry.fabricMessage && entry.fabricMessage.hash;
        const fabricHref = fabricMessageHref(hash);
        return React.createElement('div', {
          key,
          className: 'gp-log-row' + (open ? ' open' : '')
        },
          React.createElement('div', { className: 'gp-log-head' },
            React.createElement('div', { className: 'gp-log-copy' },
              React.createElement('span', { className: 't' }, journalEntryLabel(entry)),
              React.createElement('span', { className: 'm' },
                [entry && entry.type, entry && (entry.acceptedAt || entry.ts)]
                  .filter(Boolean).join(' · '))
            ),
            React.createElement('div', { className: 'gp-log-actions' },
              React.createElement('button', {
                type: 'button',
                className: 'gp-btn ghost',
                title: 'Show the journal payload for this row',
                onClick: () => this.setState({ logOpenId: open ? null : key })
              }, open ? 'Hide' : 'Data'),
              fabricHref
                ? React.createElement('a', {
                  className: 'gp-btn ghost',
                  href: fabricHref,
                  title: 'Open the corresponding Fabric AMP message'
                }, 'Fabric')
                : React.createElement('button', {
                  type: 'button',
                  className: 'gp-btn ghost',
                  disabled: true,
                  title: 'No Fabric message hash on this journal row yet'
                }, 'Fabric')
            )
          ),
          open
            ? React.createElement('pre', { className: 'gp-log-json' },
              JSON.stringify(entry, null, 2))
            : null
        );
      })
    );
  }

  renderChat (g, canManage) {
    if (!g) return null;
    if (!canManage) {
      return React.createElement('div', { className: 'gp-chat' },
        React.createElement('div', { className: 'gp-hint' },
          'Group chat is for members. Join the group to read and post here.')
      );
    }
    return React.createElement('div', { className: 'gp-chat' },
      React.createElement(Chat, {
        key: g.id,
        groupId: g.id,
        embedded: true,
        identityPubkey: this.state.pubkey || this.props.identityPubkey || null,
        nickname: this.props.nickname || null
      })
    );
  }

  render () {
    const me = this.state.pubkey;
    if (this.state.rosterMode === 'local') {
      return React.createElement('main', null,
        React.createElement(LocalGroups, {
          identityPubkey: me || this.props.identityPubkey,
          nickname: this.props.nickname,
          authToken: this.state.token,
          shareGroups: this.state.groups || [],
          rosterToggle: this.renderRosterToggle(),
          sidebarCollapsed: this.state.sidebarCollapsed,
          setSidebarCollapsed: (v) => this.setSidebarCollapsed(v)
        })
      );
    }
    const collapsed = !!this.state.sidebarCollapsed;
    return React.createElement('main', null,
      React.createElement('div', {
        className: 'gp-wrap' + (collapsed ? ' collapsed' : ''),
        style: { gridColumn: '1 / -1' }
      },
        React.createElement('section', { className: 'panel gp-side' },
          React.createElement('div', { className: 'gp-rail' },
            React.createElement('button', {
              type: 'button',
              className: 'gp-rail-btn',
              title: 'Expand group list',
              onClick: () => this.setSidebarCollapsed(false)
            }, 'Groups')
          ),
          React.createElement('div', { className: 'gp-side-body' },
            React.createElement('div', { className: 'gp-side-head' },
              React.createElement('h2', null, '👥 Groups ',
                React.createElement('span', { className: 'sub' }, '— chat, pins, and shared logs')
              ),
              React.createElement('button', {
                type: 'button',
                className: 'gp-collapse',
                title: 'Collapse group list',
                onClick: () => this.setSidebarCollapsed(true)
              }, '⟨'),
              React.createElement('button', {
                className: 'btn', type: 'button',
                disabled: !me,
                title: me ? 'Create a new group' : 'Unlock your identity to create groups',
                onClick: () => this.setState({
                  showCreate: !this.state.showCreate || this.state.createKind !== 'group',
                  createKind: 'group',
                  error: null,
                  notice: null
                })
              }, this.state.showCreate && this.state.createKind === 'group' ? 'Close' : '+ New group'),
              React.createElement('button', {
                className: 'btn', type: 'button',
                disabled: !me,
                title: me
                  ? 'Create a chat channel (a Federation group)'
                  : 'Unlock your identity to create a channel',
                onClick: () => this.setState({
                  showCreate: true,
                  createKind: 'channel',
                  parentId: this.state.selectedId || this.state.parentId || '',
                  visibility: 'private',
                  error: null,
                  notice: null
                })
              }, '+ Channel'),
              React.createElement('button', {
                className: 'btn', type: 'button',
                title: 'Paste a fabric: join invite or group share',
                onClick: () => {
                  if (typeof this.props.onRequestImport === 'function') this.props.onRequestImport();
                }
              }, 'Import…')
            ),
            this.renderRosterToggle(),
            React.createElement('div', { className: 'gp-me' },
              React.createElement('span', null, 'you:'),
              me
                ? React.createElement(React.Fragment, null,
                  React.createElement('code', { title: me }, shortKey(me)),
                  React.createElement('button', {
                    className: 'gp-btn ghost',
                    style: { padding: '2px 10px', fontSize: 11 },
                    onClick: () => this.copy(me)
                  }, 'Copy pubkey'))
                : React.createElement('span', null, 'no identity — unlock it to manage groups')
            ),
            this.state.showCreate ? this.renderCreate() : null,
            this.state.loading
              ? React.createElement('div', { className: 'empty' }, 'loading…')
              : (this.state.groups.length
                ? orderGroupsWithPins(this.state.groups, this.state.pinnedGroupIds).map((g) => {
                  const pinned = (this.state.pinnedGroupIds || []).includes(g.id);
                  return React.createElement('div', {
                    className: 'gp-row' + (g.id === this.state.selectedId ? ' on' : ''),
                    key: g.id,
                    onClick: () => this.selectGroup(g.id),
                    onDoubleClick: () => this.openPage(g)
                  },
                    React.createElement('button', {
                      type: 'button',
                      className: 'pin' + (pinned ? ' on' : ''),
                      title: pinned ? 'Unpin from your list' : 'Pin this group in your list',
                      onClick: (e) => this.togglePinnedGroup(g.id, e)
                    }, '📌'),
                    React.createElement('span', { className: 'n', style: g.parentId ? { paddingLeft: 8 } : null },
                      g.parentId ? '↳ ' : '',
                      g.name,
                      React.createElement('span', {
                        className: 'gp-tag ' + (g.visibility === 'public' ? 'public' : 'private'),
                        style: { marginLeft: 8 }
                      }, g.visibility || 'private'),
                      g.id === this.state.primaryGroupId
                        ? React.createElement('span', { className: 'gp-tag primary', style: { marginLeft: 6 } }, 'primary')
                        : null,
                      g.parentId
                        ? React.createElement('span', { className: 'gp-tag', style: { marginLeft: 6 } }, 'channel')
                        : null
                    ),
                    React.createElement('span', { className: 'd' },
                      (g.members ? `${g.members.length} member${g.members.length === 1 ? '' : 's'}` : `${g.memberCount || 0} members`) +
                      ` · ${g.threshold}-of-${g.members ? g.members.length : 'n'}`)
                  );
                })
                : React.createElement('div', { className: 'empty' },
                  'No groups yet. Create a group or + Channel, or Import… a join invite.'))
          )
        ),
        React.createElement('section', { className: 'panel gp-detail-wrap' },
          this.state.error ? React.createElement('div', { className: 'gp-err' }, this.state.error) : null,
          this.state.notice ? React.createElement('div', { className: 'gp-ok' }, this.state.notice) : null,
          this.renderSharePanel(),
          this.renderDetail()
        )
      )
    );
  }
}

Groups.CSS = CSS + '\n' + (LocalGroups.CSS || '') + '\n' + (GroupBitcoinPanel.CSS || '') +
  '\n' + (GroupComposition.CSS || '') + '\n' + (StarMap.CSS || '');

module.exports = Groups;
