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
  .gp-chat{border-top:1px solid var(--line)}
  .gp-chat h3{font-size:12px;color:var(--muted);margin:0;padding:12px 14px 6px;text-transform:uppercase;letter-spacing:.4px}
  .gp-chat .chat-wrap{border-radius:0}
`;

const SIDEBAR_KEY = 'gooncitizen.groups.sidebarCollapsed';
const DETAIL_TABS = [
  ['members', 'Members'],
  ['fleets', 'Fleets'],
  ['wallet', 'Wallet'],
  ['proposals', 'Proposals'],
  ['applications', 'Applications'],
  ['chat', 'Chat'],
  ['fabric', 'Fabric']
];

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

function identityBridge () {
  return (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.identity) || null;
}

function shortKey (pubkey) {
  return pubkey ? pubkey.slice(0, 10) + '…' + pubkey.slice(-6) : '—';
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
      creating: false,
      showCreate: false,
      // manage
      addKey: '',
      busy: false,
      sidebarCollapsed: readSidebarCollapsed(),
      detailTab: 'members',
      groupWallet: null,
      proposals: [],
      applications: [],
      groupFleets: [],
      detailLoading: false,
      colorEdit: '#3b82f6'
    };
  }

  componentDidMount () {
    this.connect();
  }

  componentDidUpdate (prev) {
    if (prev.identityPubkey !== this.props.identityPubkey && this.props.identityPubkey) {
      this.setState({ pubkey: this.props.identityPubkey, token: null }, () => this.connect());
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
      this.setState((s) => {
        nextId = s.selectedId && groups.some((g) => g.id === s.selectedId)
          ? s.selectedId
          : (groups[0] && groups[0].id) || null;
        return {
          groups,
          primaryGroupId,
          loading: false,
          selectedId: nextId
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
          creator: this.state.pubkey // local relay fallback; ignored when a session exists
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({
        creating: false, showCreate: false, name: '', membersText: '', threshold: 1, parentId: '',
        notice: `Group "${json.data.name}" created.`, selectedId: json.data.id
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
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/groups/${encodeURIComponent(g.id)}/share`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ relay: true })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const data = json.data || {};
      const url = data.protocolUrl || '';
      if (!url) throw new Error('no protocolUrl in share response');
      const messageId = data.messageId || null;
      const mesh = data.relayed
        ? `Broadcast to network (${data.peers || 0} peer connection(s)). `
        : (`Mesh broadcast failed` + (data.relayError ? `: ${data.relayError}` : '') + '. ');
      // Prefer copying the AMP message id when present — paste into Settings /
      // settings/local.js as defaultGroupMessageId. Full fabric:<hex> remains available.
      const clipboard = messageId || url;
      try {
        await navigator.clipboard.writeText(clipboard);
        this.setState({
          busy: false,
          lastShare: data,
          notice: mesh +
            (messageId
              ? ('Fabric message id copied — paste into Settings → Primary group, or settings/local.js as defaultGroupMessageId. ')
              : 'fabric:<hex> offer copied. ') +
            'Page: ' + this.shareUrl(g),
          error: data.relayed ? null : (data.relayError || 'Share copied locally but not broadcast')
        });
      } catch (_) {
        this.setState({
          busy: false,
          lastShare: data,
          notice: mesh + clipboard,
          error: data.relayed ? null : (data.relayError || null)
        });
      }
    } catch (e) {
      // Fallback to HTTP page URL if Fabric share fails entirely
      const url = this.shareUrl(g);
      try {
        await navigator.clipboard.writeText(url);
        this.setState({ busy: false, notice: 'Page link copied (Fabric share failed: ' + e.message + ').', error: e.message });
      } catch (_) {
        this.setState({ busy: false, error: e.message, notice: url });
      }
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
      this.setState({ busy: false, notice: next === 'public' ? 'Group is now public — share the link so others can apply.' : 'Group is now private.' });
      await this.refresh();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  copy (text) {
    try { navigator.clipboard.writeText(text); this.setState({ notice: 'Copied to clipboard.' }); } catch (_) { /* ignore */ }
  }

  setSidebarCollapsed (collapsed) {
    writeSidebarCollapsed(!!collapsed);
    this.setState({ sidebarCollapsed: !!collapsed });
  }

  selectGroup (id) {
    const g = (this.state.groups || []).find((x) => x.id === id);
    this.setState({
      selectedId: id,
      detailTab: 'members',
      groupWallet: null,
      proposals: [],
      applications: [],
      groupFleets: [],
      colorEdit: (g && g.primaryColor) || '#3b82f6',
      error: null
    }, () => this.loadGroupExtras(id));
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

  async loadGroupExtras (groupId) {
    const id = groupId || this.state.selectedId;
    if (!id) return;
    this.setState({ detailLoading: true });
    const headers = this.headers();
    let groupWallet = null;
    let proposals = [];
    let applications = [];
    let groupFleets = [];
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
    if (this.state.selectedId !== id) return;
    this.setState({ groupWallet, proposals, applications, groupFleets, detailLoading: false });
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

  renderCreate () {
    const extras = this.parseMembers();
    const badKey = extras.find((k) => !PUBKEY_RE.test(k));
    const total = new Set([this.state.pubkey].concat(extras)).size;
    return React.createElement('div', { className: 'gp-form' },
      React.createElement('div', null,
        React.createElement('label', null, 'Group name'),
        React.createElement('input', {
          type: 'text', value: this.state.name, placeholder: 'e.g. Salvage Wing',
          onChange: (e) => this.setState({ name: e.target.value })
        })
      ),
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
      ),
      React.createElement('div', null,
        React.createElement('label', null, 'Parent group (optional — nest as a subgroup)'),
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
        }, this.state.creating ? 'Creating…' : 'Create group'),
        React.createElement('button', {
          className: 'gp-btn ghost',
          onClick: () => this.setState({ showCreate: false, error: null, parentId: '' })
        }, 'Cancel')
      )
    );
  }

  renderMembersTab (g, me, isCreator, canManage) {
    const addValid = PUBKEY_RE.test(this.state.addKey.trim()) && canManage && !g.members.includes(this.state.addKey.trim());
    const memberList = Array.isArray(g.members) ? g.members : null;
    return React.createElement('div', { className: 'gp-section' },
      memberList
        ? React.createElement('div', null,
          memberList.map((m) => React.createElement('div', { className: 'gp-member', key: m },
            React.createElement('code', null, m),
            m === g.creator ? React.createElement('span', { className: 'gp-tag creator' }, 'creator') : null,
            m === me ? React.createElement('span', { className: 'gp-tag you' }, 'you') : null,
            (isCreator && m !== g.creator)
              ? React.createElement('button', {
                className: 'gp-btn danger', disabled: this.state.busy,
                onClick: () => this.member(g.id, m, true)
              }, 'remove')
              : null
          ))
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
          : null)
    );
  }

  renderFleetsTab () {
    const list = this.state.groupFleets || [];
    if (this.state.detailLoading && !list.length) {
      return React.createElement('div', { className: 'gp-hint' }, 'Loading fleets…');
    }
    if (!list.length) {
      return React.createElement('div', { className: 'gp-hint' },
        'No fleets shared to this group yet. From Fleets, share with visibility “groups”.');
    }
    return React.createElement('div', null,
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
            if (typeof window !== 'undefined') {
              window.location.hash = id ? `fleets?id=${encodeURIComponent(id)}` : 'fleets';
            }
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
    if (gw.error) {
      return React.createElement('div', { className: 'gp-err', style: { margin: '10px 14px' } }, gw.error);
    }
    const nSigners = (g.validators || g.members || []).length;
    return React.createElement('div', { className: 'gp-wallet' },
      React.createElement('div', { className: 'gp-meta', style: { padding: 0 } },
        React.createElement('span', null, 'mode ', React.createElement('b', null, gw.mode || '—')),
        React.createElement('span', null, 'signers ', React.createElement('b', null, `${g.threshold}-of-${nSigners || 'n'}`))
      ),
      gw.address
        ? React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'addr', title: gw.address }, gw.address),
          React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            React.createElement('button', {
              className: 'gp-btn ghost',
              onClick: () => this.copy(gw.address)
            }, 'Copy address'),
            isCreator
              ? React.createElement('button', {
                className: 'gp-btn',
                disabled: this.state.busy,
                title: 'Propose publisher withdrawal (active non-expired tier)',
                onClick: () => this.proposeWithdraw()
              }, this.state.busy ? 'Working…' : 'Propose withdraw')
              : null
          )
        )
        : React.createElement('div', { className: 'gp-hint', style: { padding: 0 } },
          'No Taproot address yet — group needs signer keys.'
        ),
      Array.isArray(gw.leaves) && gw.leaves.length
        ? React.createElement('div', { style: { color: 'var(--muted)', fontSize: 12, lineHeight: 1.5 } },
          gw.leaves.map((leaf, i) => React.createElement('div', { key: i },
            (leaf.id || leaf.script || 'leaf') +
            (leaf.threshold != null ? ` · ${leaf.threshold}-of-n` : '') +
            (leaf.locktime != null ? ` · lock ${leaf.locktime}` : '')
          ))
        )
        : null
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

  renderDetail () {
    const g = this.state.groups.find((x) => x.id === this.state.selectedId);
    if (!g) {
      return React.createElement('div', { className: 'gp-hint' },
        this.state.groups.length
          ? 'Select a group to manage it.'
          : 'No groups yet — create one to share missions with a squad. Make it public and Share the page so others can apply to join.');
    }
    const me = this.state.pubkey;
    const isCreator = me && g.creator === me;
    const canManage = me && Array.isArray(g.members) && g.members.includes(me);
    const memberList = Array.isArray(g.members) ? g.members : null;
    const tab = this.state.detailTab || 'members';
    const tabs = DETAIL_TABS.filter(([id]) => id !== 'fabric' || this.props.advancedMode);
    const tabCounts = {
      fleets: (this.state.groupFleets || []).length,
      proposals: (this.state.proposals || []).length,
      applications: (this.state.applications || []).length
    };

    let body = null;
    if (tab === 'fleets') body = this.renderFleetsTab();
    else if (tab === 'wallet') body = this.renderWalletTab(g, isCreator);
    else if (tab === 'proposals') body = this.renderProposalsTab(canManage);
    else if (tab === 'applications') body = this.renderApplicationsTab(isCreator);
    else if (tab === 'chat') body = this.renderChat(g, canManage);
    else if (tab === 'fabric') body = this.renderFabricTab(g);
    else body = this.renderMembersTab(g, me, isCreator, canManage);

    return React.createElement(React.Fragment, null,
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
      React.createElement('div', { className: 'gp-actions' },
        React.createElement('button', { className: 'gp-btn', onClick: () => this.openPage(g) }, 'Open page'),
        React.createElement('button', { className: 'gp-btn ghost', onClick: () => this.share(g) }, 'Share'),
        canManage
          ? React.createElement('button', {
            className: 'gp-btn ghost',
            disabled: this.state.busy,
            title: this.state.primaryGroupId === g.id
              ? 'Clear primary group'
              : 'Use this group for the desktop member/ship overlay',
            onClick: () => this.setPrimaryGroup(g.id)
          }, this.state.primaryGroupId === g.id ? 'Clear primary' : 'Set as primary')
          : null,
        isCreator
          ? React.createElement('button', {
            className: 'gp-btn ghost', disabled: this.state.busy,
            onClick: () => this.toggleVisibility(g)
          }, g.visibility === 'public' ? 'Make private' : 'Make public')
          : null
      ),
      isCreator
        ? React.createElement('div', {
          className: 'gp-actions',
          style: { alignItems: 'center', marginTop: -4 }
        },
          React.createElement('label', {
            style: { display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--muted)' }
          },
            'Primary color',
            React.createElement('input', {
              type: 'color',
              value: /^#[0-9a-fA-F]{6}$/.test(this.state.colorEdit) ? this.state.colorEdit : '#3b82f6',
              disabled: this.state.busy,
              title: 'Brand accent for members who set this as their primary group',
              onChange: (e) => this.setState({ colorEdit: e.target.value })
            }),
            React.createElement('code', { style: { fontSize: 11 } }, this.state.colorEdit || '—')
          ),
          React.createElement('button', {
            className: 'gp-btn ghost',
            disabled: this.state.busy,
            onClick: () => this.savePrimaryColor(g)
          }, 'Save color'),
          g.primaryColor
            ? React.createElement('button', {
              className: 'gp-btn ghost',
              disabled: this.state.busy,
              onClick: () => this.setState({ colorEdit: '' }, () => this.savePrimaryColor(g))
            }, 'Clear color')
            : null
        )
        : (g.primaryColor
          ? React.createElement('div', { className: 'gp-meta' },
            React.createElement('span', null, 'accent ',
              React.createElement('b', { style: { color: g.primaryColor } }, g.primaryColor)))
          : null),
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
            onClick: () => this.setState({ detailTab: id })
          }, text);
        })
      ),
      body
    );
  }

  renderChat (g, canManage) {
    if (!g) return null;
    if (!canManage) {
      return React.createElement('div', { className: 'gp-chat' },
        React.createElement('h3', null, 'Chat'),
        React.createElement('div', { className: 'gp-hint' },
          'Group chat is for members. Join the group to read and post here.')
      );
    }
    return React.createElement('div', { className: 'gp-chat' },
      React.createElement('h3', null, 'Chat'),
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
              React.createElement('h2', null, '👥 Your groups ',
                React.createElement('span', { className: 'sub' }, '— k-of-n multisig squads & subgroups')
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
                onClick: () => this.setState({ showCreate: !this.state.showCreate, error: null, notice: null })
              }, this.state.showCreate ? 'Close' : '+ New group')
            ),
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
                ? this.state.groups.map((g) => React.createElement('div', {
                  className: 'gp-row' + (g.id === this.state.selectedId ? ' on' : ''),
                  key: g.id,
                  onClick: () => this.selectGroup(g.id),
                  onDoubleClick: () => this.openPage(g)
                },
                  React.createElement('span', { className: 'n', style: g.parentId ? { paddingLeft: 14 } : null },
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
                      ? React.createElement('span', { className: 'gp-tag', style: { marginLeft: 6 } }, 'subgroup')
                      : null
                  ),
                  React.createElement('span', { className: 'd' },
                    (g.members ? `${g.members.length} member${g.members.length === 1 ? '' : 's'}` : `${g.memberCount || 0} members`) +
                    ` · ${g.threshold}-of-${g.members ? g.members.length : 'n'}`)
                ))
                : React.createElement('div', { className: 'empty' }, 'no groups yet'))
          )
        ),
        React.createElement('section', { className: 'panel' },
          React.createElement('h2', null, '🛠️ Manage ',
            React.createElement('span', { className: 'sub' }, '— members, wallet, proposals, chat & Fabric')
          ),
          this.state.error ? React.createElement('div', { className: 'gp-err' }, this.state.error) : null,
          this.state.notice ? React.createElement('div', { className: 'gp-ok' }, this.state.notice) : null,
          this.renderDetail()
        )
      )
    );
  }
}

Groups.CSS = CSS;

module.exports = Groups;
