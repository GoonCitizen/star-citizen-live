'use strict';

/**
 * Dedicated group page — `/groups/:id` (or `/groups/:slug`).
 *
 * Public groups: anyone can view a summary and apply to join (with an unlocked
 * identity). Private groups: members only. Creators can toggle visibility,
 * set a custom URL slug, share the page, and decide join applications.
 */

const React = require('react');
const Chat = require('./Chat');
const { JoinVoiceButton } = require('./ActiveVoicePanel');
const GroupFabricInspector = require('./GroupFabricInspector');
const RegisterEventLog = require('./RegisterEventLog');
const GroupBitcoinPanel = require('./GroupBitcoinPanel');
const { setAppHash } = require('../functions/appHash');
const {
  shareClipboardText,
  shareNotice
} = require('../functions/groupJoinFlow');
const {
  chatChannelsFromCatalog,
  parseDiscordChatChannel
} = require('../functions/discordGuildCatalog');
const {
  sanitizePinnedChannels,
  MAX_PINNED_CHANNELS
} = require('../functions/groupPinnedChannels');
const { fetchPresenceRoster } = require('../functions/presenceClient');
const groupPresence = require('../functions/groupPresence');
const GroupComposition = require('./GroupComposition');
const GroupContractSummary = require('./GroupContractSummary');
const StarMap = require('./StarMap');

const BASE = '/services/star-citizen';
const ADVANCED_MODE_KEY = 'gooncitizen.advancedMode';

function readAdvancedMode () {
  try {
    return (typeof localStorage !== 'undefined') && localStorage.getItem(ADVANCED_MODE_KEY) === '1';
  } catch (_) {
    return false;
  }
}

const CSS = `
  .gpage{width:100%;max-width:none;margin:0;padding:12px 14px;display:grid;gap:12px;box-sizing:border-box}
  .gpage-back{color:var(--muted);font-size:13px;text-decoration:none}
  .gpage-back:hover{color:var(--accent)}
  .gpage-shell{display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,280px);gap:12px;align-items:start;min-width:0}
  .gpage-main{display:grid;gap:16px;min-width:0}
  .gpage-rail{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;
    display:flex;flex-direction:column;min-width:0;min-height:280px;max-height:calc(100vh - 48px);
    position:sticky;top:12px}
  .gpage-rail .chat-wrap.chat-people-only{flex:1 1 auto;min-height:0}
  .gpage-rail-invite{padding:10px 12px;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:6px}
  .gpage-rail-invite input{flex:1;min-width:120px;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:7px 10px;font-size:12px;font-family:'Cascadia Code',Consolas,monospace}
  .gpage-rail .gcomp{border-bottom:1px solid var(--line)}
  @media(max-width:900px){
    .gpage-shell{grid-template-columns:1fr}
    .gpage-rail{position:static;max-height:min(50vh,420px);order:-1}
  }
  .gpage-hero{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 20px}
  .gpage-hero h1{margin:0 0 8px;font-size:22px}
  .gpage-hero .gcs{margin:0 0 4px}
  .gpage-hero .sub{color:var(--muted);font-size:13px;line-height:1.5;margin-top:4px}
  .gpage-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  .gpage-btn{background:var(--accent);border:none;color:#fff;border-radius:7px;padding:8px 14px;
    font-size:13px;font-weight:600;cursor:pointer}
  .gpage-btn:disabled{opacity:.45;cursor:default}
  .gpage-btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
  .gpage-btn.danger{background:transparent;border:1px solid var(--line);color:var(--kill)}
  .gpage-tag{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:5px;margin-left:8px;vertical-align:middle}
  .gpage-tag.public{background:rgba(63,185,80,.15);color:var(--good)}
  .gpage-tag.private{background:rgba(110,118,129,.18);color:var(--muted)}
  .gpage-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .gpage-panel h2{font-size:13px;margin:0;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:600}
  .gpage-panel .body{padding:14px 16px}
  .gpage-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:9px 12px;font-size:13px}
  .gpage-ok{background:rgba(63,185,80,.12);color:var(--good);border-radius:7px;padding:9px 12px;font-size:13px}
  .gpage-field{margin-bottom:10px}
  .gpage-field label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}
  .gpage-field input,.gpage-field textarea{width:100%;background:var(--bg);border:1px solid var(--line);
    color:var(--text);border-radius:7px;padding:8px 10px;font-size:13px;box-sizing:border-box}
  .gpage-field textarea{min-height:70px;resize:vertical}
  .gpage-member{display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid #20262f;
    font-family:'Cascadia Code',Consolas,monospace;font-size:11.5px;word-break:break-all}
  .gpage-member:last-child{border-bottom:none}
  .gpage-app{display:grid;gap:6px;padding:10px 0;border-bottom:1px solid #20262f}
  .gpage-app:last-child{border-bottom:none}
  .gpage-app code{font-size:11px;word-break:break-all}
  .gpage-toggle{display:flex;align-items:center;gap:10px;font-size:13px}
  .gpage-toggle input{accent-color:var(--accent)}
  .gpage-chat .body{padding:0}
  .gpage-chat .chat-wrap{border-radius:0}
  ${RegisterEventLog.CSS || ''}
`;

function identityBridge () {
  return (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.identity) || null;
}

function shortKey (pubkey) {
  return pubkey ? pubkey.slice(0, 10) + '…' + pubkey.slice(-6) : '—';
}

class GroupPage extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      token: null,
      pubkey: null,
      nickname: null,
      group: null,
      applications: [],
      proposals: [],
      groupWallet: null,
      presenceRoster: {},
      events: [],
      fleets: [],
      loading: true,
      error: null,
      notice: null,
      applyMessage: '',
      applying: false,
      inviteKey: '',
      slugEdit: '',
      colorEdit: '#3b82f6',
      discordChannels: [],
      busy: false,
      newFleetName: ''
    };
  }

  get pathKey () {
    const m = String(window.location.pathname || '').match(/^\/groups\/([^/]+)/);
    return (m && m[1]) || this.props.pathKey || null;
  }

  componentDidMount () {
    this.boot();
    this.loadDiscordCatalog();
    window.addEventListener('popstate', this._onPop);
  }

  componentWillUnmount () {
    window.removeEventListener('popstate', this._onPop);
  }

  _onPop = () => { this.boot(); };

  headers (token) {
    const h = { 'Content-Type': 'application/json' };
    const t = token || this.state.token;
    if (t) h.Authorization = `Bearer ${t}`;
    return h;
  }

  async login () {
    const bridge = identityBridge();
    if (!bridge) return null;
    try {
      const info = await bridge.get();
      if (!info || !info.unlocked) return null;
      const envelope = await bridge.signEnvelope({ intent: 'login', ts: new Date().toISOString() });
      if (!envelope || envelope.error) return null;
      const res = await fetch(`${BASE}/auth`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope)
      });
      if (!res.ok) return null;
      const json = await res.json();
      this.setState({
        token: json.data.token,
        pubkey: json.data.pubkey,
        nickname: (info && info.nickname) || null
      });
      return json.data.token;
    } catch (_) { return null; }
  }

  async boot () {
    this.setState({ loading: true, error: null });
    const token = await this.login();
    await this.load(token);
  }

  async load (token) {
    const key = this.pathKey;
    if (!key) {
      this.setState({ loading: false, error: 'Missing group id' });
      return;
    }
    try {
      const res = await fetch(`${BASE}/groups/${encodeURIComponent(key)}`, { headers: this.headers(token) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const group = json.data;
      let applications = [];
      if (group.role === 'creator') {
        const ar = await fetch(`${BASE}/groups/${encodeURIComponent(group.id)}/applications`, { headers: this.headers(token) });
        if (ar.ok) applications = ((await ar.json()).data || []).filter((a) => a.status === 'pending');
      }
      let presenceRoster = {};
      try {
        const pr = await fetchPresenceRoster({ authToken: token });
        if (pr.ok) presenceRoster = pr.data || {};
      } catch (_) { /* optional */ }
      let events = [];
      try {
        const er = await fetch(`${BASE}/inbox?groupId=${encodeURIComponent(group.id)}`, {
          headers: this.headers(token)
        });
        if (er.ok) events = ((await er.json()).data) || [];
      } catch (_) { /* optional */ }
      let proposals = [];
      if (group.role === 'member' || group.role === 'creator') {
        try {
          const pr = await fetch(`${BASE}/groups/${encodeURIComponent(group.id)}/proposals`, {
            headers: this.headers(token)
          });
          if (pr.ok) proposals = ((await pr.json()).data) || [];
        } catch (_) { /* optional */ }
      }
      let groupWallet = null;
      if (group.role === 'member' || group.role === 'creator') {
        try {
          const wr = await fetch(`${BASE}/groups/${encodeURIComponent(group.id)}/wallet`, {
            headers: this.headers(token)
          });
          const wj = await wr.json().catch(() => ({}));
          groupWallet = wr.ok ? (wj.data || wj) : { error: (wj && wj.error) || `HTTP ${wr.status}` };
        } catch (e) {
          groupWallet = { error: e.message || String(e) };
        }
      }
      let fleets = [];
      try {
        const fr = await fetch(`${BASE}/groups/${encodeURIComponent(group.id)}/fleets`, {
          headers: this.headers(token)
        });
        if (fr.ok) fleets = ((await fr.json()).data) || [];
      } catch (_) { /* optional */ }
      this.setState({
        group, applications, proposals, groupWallet, presenceRoster, events, fleets, loading: false,
        slugEdit: group.slug || '',
        colorEdit: group.primaryColor || '#3b82f6',
        notice: null
      });
      document.title = `${group.name} — GoonCitizen`;
    } catch (e) {
      this.setState({ loading: false, group: null, error: e.message });
    }
  }

  async createFleetOnGroup () {
    const g = this.state.group;
    if (!g || this.state.busy) return;
    if (g.role !== 'member' && g.role !== 'creator') return;
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
      let fleets = this.state.fleets || [];
      try {
        const fr = await fetch(`${BASE}/groups/${encodeURIComponent(g.id)}/fleets`, {
          headers: this.headers()
        });
        if (fr.ok) fleets = ((await fr.json()).data) || fleets;
      } catch (_) { /* keep prior list */ }
      this.setState({
        busy: false,
        newFleetName: '',
        fleets,
        notice: 'Created “' + ((cj.data && cj.data.name) || name) +
          '” on this group. Open it to add ships.'
      });
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  shareUrl () {
    const g = this.state.group;
    if (!g) return '';
    const path = g.path || `/groups/${g.slug || g.id}`;
    return `${window.location.origin}${path}`;
  }

  async share () {
    const g = this.state.group;
    if (!g) return;
    this.setState({ busy: true, error: null, notice: null });
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
      if (!url) throw new Error('no protocolUrl');
      const page = this.shareUrl();
      try {
        await navigator.clipboard.writeText(url);
        this.setState({
          busy: false,
          notice: shareNotice(data, page),
          error: data.relayed || !publicShare ? null : (data.relayError || null)
        });
      } catch (_) {
        this.setState({
          busy: false,
          notice: shareNotice(data, page) + ' ' + url,
          error: data.relayed || !publicShare ? null : (data.relayError || null)
        });
      }
    } catch (e) {
      const url = this.shareUrl();
      try {
        await navigator.clipboard.writeText(url);
        this.setState({ busy: false, notice: 'Page link copied (Fabric share failed: ' + e.message + ').', error: e.message });
      } catch (_) {
        this.setState({ busy: false, error: e.message, notice: url });
      }
    }
  }

  async inviteMember () {
    const g = this.state.group;
    const pubkey = String(this.state.inviteKey || '').trim();
    if (!g || this.state.busy || !/^0[23][0-9a-f]{64}$/.test(pubkey)) return;
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
      this.setState({
        busy: false,
        inviteKey: '',
        notice: shareNotice(Object.assign({ visibility: 'private' }, data), null)
      });
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async apply () {
    if (this.state.applying || !this.state.group) return;
    this.setState({ applying: true, error: null, notice: null });
    try {
      if (!this.state.token) throw new Error('Unlock your identity to apply');
      const res = await fetch(`${BASE}/groups/${encodeURIComponent(this.state.group.id)}/applications`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ message: this.state.applyMessage })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({ applying: false, applyMessage: '', notice: 'Application submitted — you will get a notification when the creator accepts.' });
    } catch (e) {
      this.setState({ applying: false, error: e.message });
    }
  }

  async loadDiscordCatalog () {
    try {
      const res = await fetch(BASE + '/discord/guilds', {
        headers: { Accept: 'application/json' }
      });
      const body = await res.json().catch(() => ({}));
      const catalog = (body && body.data) || body || {};
      this.setState({ discordChannels: chatChannelsFromCatalog(catalog) });
    } catch (_) { /* optional */ }
  }

  async togglePinnedChannel (channelKey) {
    const g = this.state.group;
    if (!g || g.role !== 'creator' || this.state.busy) return;
    const key = String(channelKey || '');
    if (!key) return;
    const current = sanitizePinnedChannels(g.pinnedChannels);
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : current.concat([key]).slice(0, MAX_PINNED_CHANNELS);
    await this.patch({ pinnedChannels: next });
  }

  async patch (body) {
    if (this.state.busy || !this.state.group) return;
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/groups/${encodeURIComponent(this.state.group.id)}`, {
        method: 'PUT', headers: this.headers(), body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      // If slug changed, navigate to the new URL.
      const next = json.data;
      const nextKey = next.slug || next.id;
      if (nextKey !== this.pathKey) {
        window.history.replaceState({}, '', next.path || `/groups/${nextKey}`);
      }
      this.setState({
        busy: false,
        notice: 'Settings saved.',
        slugEdit: next.slug || '',
        colorEdit: next.primaryColor || this.state.colorEdit || '#3b82f6'
      });
      await this.load();
      if (typeof this.props.onPrimaryGroupTheme === 'function' && next.primaryColor !== undefined) {
        // Parent may refresh theme if this is the user's primary group.
        this.props.onPrimaryGroupTheme(next.primaryColor || null);
      }
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async decide (applicationId, decision) {
    this.setState({ busy: true, error: null });
    try {
      const res = await fetch(`${BASE}/group-applications/${encodeURIComponent(applicationId)}/decision`, {
        method: 'POST', headers: this.headers(), body: JSON.stringify({ decision })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({ busy: false, notice: decision === 'accept' ? 'Member added.' : 'Application rejected.' });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async voteProposal (proposalId) {
    if (this.state.busy || !this.state.group) return;
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(
        `${BASE}/groups/${encodeURIComponent(this.state.group.id)}/proposals/${encodeURIComponent(proposalId)}/votes`,
        { method: 'POST', headers: this.headers(), body: JSON.stringify({}) }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({
        busy: false,
        notice: json.adopted ? 'Proposal adopted.' : 'Vote recorded — waiting for more signatures.'
      });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async proposeWithdraw () {
    const g = this.state.group;
    if (!g || this.state.busy || g.role !== 'creator') return;
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
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message || String(e) });
    }
  }

  renderWallet () {
    const g = this.state.group;
    const gw = this.state.groupWallet;
    if (!g || (g.role !== 'member' && g.role !== 'creator')) return null;
    if (!gw) return null;
    const isCreator = g.role === 'creator';
    return React.createElement('div', { className: 'gpage-panel' },
      React.createElement('h2', null, 'Wallet'),
      React.createElement('div', { className: 'body' },
        React.createElement(GroupBitcoinPanel, {
          wallet: gw,
          bitcoinEnable: this.props.bitcoinEnable,
          isCreator,
          busy: this.state.busy,
          onCopy: (addr) => {
            try {
              navigator.clipboard.writeText(addr);
              this.setState({ notice: 'Address copied.' });
            } catch (_) { /* ignore */ }
          },
          onProposeWithdraw: () => this.proposeWithdraw(),
          onRefresh: () => this.load()
        })
      )
    );
  }

  renderFleets () {
    const g = this.state.group;
    if (!g) return null;
    const list = this.state.fleets || [];
    const canCreate = g.role === 'member' || g.role === 'creator';
    const createRow = canCreate
      ? React.createElement('div', {
        className: 'gpage-actions',
        style: { marginTop: 0, marginBottom: list.length ? 12 : 0 }
      },
        React.createElement('input', {
          type: 'text',
          value: this.state.newFleetName,
          placeholder: 'New fleet name',
          style: {
            flex: 1, minWidth: 140, background: 'var(--bg)', border: '1px solid var(--line)',
            color: 'var(--text)', borderRadius: 7, padding: '8px 10px', fontSize: 13
          },
          onChange: (e) => this.setState({ newFleetName: e.target.value }),
          onKeyDown: (e) => { if (e.key === 'Enter') void this.createFleetOnGroup(); }
        }),
        React.createElement('button', {
          type: 'button',
          className: 'gpage-btn',
          disabled: this.state.busy,
          onClick: () => this.createFleetOnGroup()
        }, 'Create fleet')
      )
      : null;
    return React.createElement('div', { className: 'gpage-panel' },
      React.createElement('h2', null, `Fleets${list.length ? ` (${list.length})` : ''}`),
      React.createElement('div', { className: 'body' },
        createRow,
        !list.length
          ? React.createElement('p', { style: { color: 'var(--muted)', fontSize: 13, margin: 0 } },
            canCreate
              ? 'No fleets on this group yet. Create one here, or share an existing roster from Fleets.'
              : 'No fleets shared to this group yet.')
          : list.map((f) => React.createElement('div', {
            key: f.fleetId || f.id,
            className: 'gpage-member',
            style: { flexWrap: 'wrap' }
          },
            React.createElement('span', { style: { flex: 1, fontFamily: 'inherit', fontSize: 13 } },
              f.name || shortKey(f.fleetId || f.id)),
            React.createElement('span', { className: 'gpage-tag private' },
              `${Number(f.shipCount) || 0} ships` + (f.uniqueShips ? ` · ${f.uniqueShips} types` : '')),
            f.ownerPubkey
              ? React.createElement('span', { className: 'gpage-tag private', title: f.ownerPubkey },
                shortKey(f.ownerPubkey))
              : null,
            f.sharedAt
              ? React.createElement('span', { style: { color: 'var(--muted)', fontSize: 11 } },
                String(f.sharedAt).slice(0, 10))
              : null,
            React.createElement('button', {
              className: 'gpage-btn ghost',
              style: { padding: '4px 10px', fontSize: 12 },
              onClick: () => {
                const id = f.fleetId || f.id;
                setAppHash('fleet', id ? { id } : {});
              }
            }, 'Open')
          ))
      )
    );
  }

  renderProposals () {
    const g = this.state.group;
    if (!g || (g.role !== 'member' && g.role !== 'creator')) return null;
    const list = this.state.proposals || [];
    const me = this.state.pubkey;
    return React.createElement('div', { className: 'gpage-panel' },
      React.createElement('h2', null, `Proposals${list.length ? ` (${list.length})` : ''}`),
      React.createElement('div', { className: 'body' },
        !list.length
          ? React.createElement('p', { style: { color: 'var(--muted)', fontSize: 13, margin: 0 } },
            'No open proposals.')
          : list.map((p) => {
            const sigs = p.signatures ? Object.keys(p.signatures).length : 0;
            const need = Math.max(1, Number(p.threshold) || 1);
            const voted = !!(me && p.signatures && (p.signatures[me] || p.signatures[String(me).toLowerCase()]));
            return React.createElement('div', {
              key: p.id,
              style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid #20262f' }
            },
              React.createElement('span', { className: 'gpage-tag private' }, p.action || 'change'),
              React.createElement('span', { style: { flex: 1, fontSize: 13 } },
                (p.member ? shortKey(p.member) + ' · ' : '') + `${sigs}/${need} votes`
              ),
              !voted
                ? React.createElement('button', {
                  className: 'gpage-btn',
                  disabled: this.state.busy,
                  onClick: () => this.voteProposal(p.id)
                }, 'Sign')
                : React.createElement('span', { className: 'gpage-tag public' }, 'signed')
            );
          })
      )
    );
  }

  renderVisitorApply () {
    const g = this.state.group;
    if (!g || g.role !== 'visitor' || !g.canApply) return null;
    const locked = !this.state.pubkey;
    return React.createElement('div', { className: 'gpage-panel' },
      React.createElement('h2', null, 'Join this group'),
      React.createElement('div', { className: 'body' },
        locked
          ? React.createElement('p', { style: { color: 'var(--muted)', fontSize: 13, margin: 0 } },
            'Unlock your GoonCitizen identity to apply — open the app (or set up identity) then return to this link.')
          : React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'gpage-field' },
              React.createElement('label', null, 'Message (optional)'),
              React.createElement('textarea', {
                value: this.state.applyMessage,
                placeholder: 'Why you want to join…',
                onChange: (e) => this.setState({ applyMessage: e.target.value })
              })
            ),
            React.createElement('button', {
              className: 'gpage-btn', disabled: this.state.applying,
              onClick: () => this.apply()
            }, this.state.applying ? 'Submitting…' : 'Apply to join'),
            React.createElement('p', { style: { color: 'var(--muted)', fontSize: 12, margin: '10px 0 0' } },
              'The creator reviews join requests in Notifications.')
          )
      )
    );
  }

  renderCreatorSettings () {
    const g = this.state.group;
    if (!g || g.role !== 'creator') return null;
    const isPublic = g.visibility === 'public';
    return React.createElement('div', { className: 'gpage-panel' },
      React.createElement('h2', null, 'Group settings'),
      React.createElement('div', { className: 'body' },
        React.createElement('label', { className: 'gpage-toggle' },
          React.createElement('input', {
            type: 'checkbox',
            checked: isPublic,
            disabled: this.state.busy,
            onChange: (e) => this.patch({ visibility: e.target.checked ? 'public' : 'private' })
          }),
          React.createElement('span', null, isPublic
            ? 'Public — anyone with the link can view and apply to join'
            : 'Private — only members can open this page')
        ),
        React.createElement('div', { className: 'gpage-field', style: { marginTop: 14 } },
          React.createElement('label', null, 'Custom URL (optional)'),
          React.createElement('div', { style: { display: 'flex', gap: 8 } },
            React.createElement('span', { style: { color: 'var(--muted)', fontSize: 12, alignSelf: 'center', whiteSpace: 'nowrap' } }, '/groups/'),
            React.createElement('input', {
              type: 'text', value: this.state.slugEdit,
              placeholder: g.id,
              onChange: (e) => this.setState({ slugEdit: e.target.value })
            }),
            React.createElement('button', {
              className: 'gpage-btn ghost', disabled: this.state.busy,
              onClick: () => this.patch({ slug: this.state.slugEdit.trim() || null })
            }, 'Save')
          ),
          React.createElement('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginTop: 5 } },
            'Leave blank to use the group id. Lowercase letters, digits, and hyphens only.')
        ),
        React.createElement('div', { className: 'gpage-field', style: { marginTop: 14 } },
          React.createElement('label', null, 'Primary color'),
          React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            React.createElement('input', {
              type: 'color',
              value: /^#[0-9a-fA-F]{6}$/.test(this.state.colorEdit || '') ? this.state.colorEdit : '#3b82f6',
              disabled: this.state.busy,
              onChange: (e) => this.setState({ colorEdit: e.target.value })
            }),
            React.createElement('code', { style: { fontSize: 12 } }, this.state.colorEdit || g.primaryColor || '—'),
            React.createElement('button', {
              className: 'gpage-btn ghost', disabled: this.state.busy,
              onClick: () => this.patch({ primaryColor: this.state.colorEdit || null })
            }, 'Save'),
            g.primaryColor
              ? React.createElement('button', {
                className: 'gpage-btn danger', disabled: this.state.busy,
                onClick: () => this.setState({ colorEdit: '' }, () => this.patch({ primaryColor: null }))
              }, 'Clear')
              : null
          ),
          React.createElement('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginTop: 5 } },
            'Members who set this group as primary use this accent to theme their dashboard.')
        ),
        this.renderPinnedChannelsEditor()
      )
    );
  }

  renderPinnedChannelsEditor () {
    const g = this.state.group;
    if (!g || g.role !== 'creator') return null;
    const pins = sanitizePinnedChannels(g.pinnedChannels);
    const pinSet = new Set(pins);
    const catalog = this.state.discordChannels || [];
    const groupKey = 'group:' + g.id;
    return React.createElement('div', { className: 'gpage-field', style: { marginTop: 14 } },
      React.createElement('label', null, 'Pinned channels'),
      React.createElement('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.45 } },
        'Pin Discord (or this group’s Fabric) channels so members see them at the top of Chat. Up to ' +
        MAX_PINNED_CHANNELS + '.'),
      React.createElement('label', {
        className: 'gpage-toggle',
        style: { marginBottom: 8 }
      },
        React.createElement('input', {
          type: 'checkbox',
          checked: pinSet.has(groupKey),
          disabled: this.state.busy,
          onChange: () => this.togglePinnedChannel(groupKey)
        }),
        React.createElement('span', null, 'Pin this group’s Fabric chat')
      ),
      catalog.length
        ? React.createElement('div', {
          style: {
            maxHeight: 220,
            overflow: 'auto',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: '6px 8px'
          }
        },
          catalog.slice(0, 80).map((ch) => React.createElement('label', {
            key: ch.key,
            className: 'gpage-toggle',
            style: { marginBottom: 6, alignItems: 'flex-start' }
          },
            React.createElement('input', {
              type: 'checkbox',
              checked: pinSet.has(ch.key),
              disabled: this.state.busy || (!pinSet.has(ch.key) && pins.length >= MAX_PINNED_CHANNELS),
              onChange: () => this.togglePinnedChannel(ch.key)
            }),
            React.createElement('span', null,
              (ch.guildName ? ch.guildName + ' · ' : '') + String(ch.label || '').replace(/^#/, ''),
              React.createElement('code', {
                style: { display: 'block', fontSize: 10, color: 'var(--muted)', marginTop: 2 }
              }, ch.key)
            )
          ))
        )
        : React.createElement('div', { style: { fontSize: 12, color: 'var(--muted)' } },
          'No Discord text channels listed yet — enable the bot under Chat → Bot settings, then refresh.'),
      pins.length
        ? React.createElement('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginTop: 8 } },
          pins.length + ' pinned: ',
          pins.map((k) => {
            const id = parseDiscordChatChannel(k);
            return id ? ('#' + id) : k;
          }).join(', '))
        : null
    );
  }

  renderApplications () {
    const apps = this.state.applications;
    if (!apps.length || this.state.group.role !== 'creator') return null;
    return React.createElement('div', { className: 'gpage-panel' },
      React.createElement('h2', null, 'Join applications'),
      React.createElement('div', { className: 'body' },
        apps.map((a) => React.createElement('div', { className: 'gpage-app', key: a.id },
          React.createElement('code', null, a.applicantId),
          a.message ? React.createElement('div', { style: { fontSize: 13 } }, a.message) : null,
          React.createElement('div', { style: { display: 'flex', gap: 8 } },
            React.createElement('button', { className: 'gpage-btn', disabled: this.state.busy, onClick: () => this.decide(a.id, 'accept') }, 'Accept'),
            React.createElement('button', { className: 'gpage-btn danger', disabled: this.state.busy, onClick: () => this.decide(a.id, 'reject') }, 'Reject')
          )
        ))
      )
    );
  }

  renderMembersRail () {
    const g = this.state.group;
    if (!g) return null;
    const roster = this.state.presenceRoster || {};
    const owner = g.role === 'creator' || groupPresence.isGroupOwner(g, this.state.pubkey);
    const composition = owner && Array.isArray(g.members) && g.members.length
      ? groupPresence.summarizeOnlineMembers(g.members, roster)
      : null;
    const canSeeMembers = Array.isArray(g.members) && g.members.length;
    const nMembers = GroupContractSummary.memberCount(g);
    return React.createElement('aside', { className: 'gpage-rail' },
      composition ? React.createElement(GroupComposition, { composition, showMap: false }) : null,
      canSeeMembers
        ? React.createElement(Chat, {
          groupId: g.id,
          peopleOnly: true,
          identityPubkey: this.state.pubkey,
          nickname: this.state.nickname
        })
        : React.createElement('div', { className: 'chat-mem-hint' },
          nMembers
            ? nMembers + ' members — join to see the roster.'
            : 'No members listed yet.'),
      (g.role === 'creator' || g.role === 'member')
        ? React.createElement('div', { className: 'gpage-rail-invite' },
          React.createElement('input', {
            type: 'text',
            value: this.state.inviteKey,
            placeholder: 'Invite — paste a compressed pubkey (02…/03…)',
            onChange: (e) => this.setState({ inviteKey: e.target.value })
          }),
          React.createElement('button', {
            className: 'gpage-btn',
            disabled: this.state.busy || !/^0[23][0-9a-f]{64}$/.test(String(this.state.inviteKey || '').trim()),
            onClick: () => this.inviteMember()
          }, 'Send invite')
        )
        : null
    );
  }

  render () {
    if (this.state.loading) {
      return React.createElement('div', { className: 'gpage' }, React.createElement('div', { style: { color: 'var(--muted)' } }, 'Loading group…'));
    }
    if (this.state.error && !this.state.group) {
      return React.createElement('div', { className: 'gpage' },
        React.createElement('a', { className: 'gpage-back', href: '/#groups' }, '← Back to groups'),
        React.createElement('div', { className: 'gpage-err' }, this.state.error)
      );
    }
    const g = this.state.group;
    const isPublic = g.visibility === 'public';
    return React.createElement('div', { className: 'gpage' },
      React.createElement('a', { className: 'gpage-back', href: '/#groups', onClick: (e) => { e.preventDefault(); window.location.href = '/#groups'; } }, '← Back to groups'),
      this.state.error ? React.createElement('div', { className: 'gpage-err' }, this.state.error) : null,
      this.state.notice ? React.createElement('div', { className: 'gpage-ok' }, this.state.notice) : null,
      React.createElement('div', { className: 'gpage-shell' },
        React.createElement('div', { className: 'gpage-main' },
          React.createElement('div', { className: 'gpage-hero' },
            React.createElement('h1', null,
              g.name,
              React.createElement('span', { className: 'gpage-tag ' + (isPublic ? 'public' : 'private') }, isPublic ? 'public' : 'private')
            ),
            GroupContractSummary({
              group: g,
              presenceRoster: this.state.presenceRoster,
              viewerPubkey: this.state.pubkey
            }),
            React.createElement('div', { className: 'sub' },
              isPublic ? 'Shareable join page' : 'Members only',
              g.role === 'member' || g.role === 'creator' ? ` · you are a ${g.role}` : null
            ),
            React.createElement('div', { className: 'gpage-actions' },
              React.createElement('button', {
                className: 'gpage-btn',
                title: g.visibility === 'public'
                  ? 'Copy a share others paste via Import… to apply'
                  : 'Copy a join invite — they paste Import… and Accept',
                onClick: () => this.share()
              }, 'Share'),
              g.role === 'creator' || g.role === 'member'
                ? React.createElement(JoinVoiceButton, {
                  className: 'gpage-btn ghost',
                  groupId: g.id,
                  handle: this.state.nickname || null,
                  identityPubkey: this.state.pubkey,
                  authToken: this.state.token
                })
                : null,
              g.role === 'creator' || g.role === 'member'
                ? React.createElement('button', {
                  className: 'gpage-btn ghost',
                  onClick: () => { window.location.href = '/#groups'; }
                }, 'Manage in dashboard')
                : null
            )
          ),
          this.renderVisitorApply(),
          this.renderCreatorSettings(),
          this.renderWallet(),
          this.renderFleets(),
          this.renderChat(),
          this.renderApplications(),
          this.renderProposals(),
          this.renderActivity(),
          this.renderFabricInspector()
        ),
        this.renderMembersRail()
      )
    );
  }

  renderChat () {
    const g = this.state.group;
    if (!g) return null;
    if (g.role !== 'member' && g.role !== 'creator') {
      return React.createElement('div', { className: 'gpage-panel gpage-chat' },
        React.createElement('h2', null, 'Chat'),
        React.createElement('div', { className: 'body', style: { padding: '14px 16px', color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 } },
          'Group chat is for members. Apply to join to read and post here.')
      );
    }
    return React.createElement('div', { className: 'gpage-panel gpage-chat' },
      React.createElement('h2', null, 'Chat'),
      React.createElement('div', { className: 'body' },
        React.createElement(Chat, {
          groupId: g.id,
          embedded: true,
          identityPubkey: this.state.pubkey,
          nickname: this.state.nickname,
          authToken: this.state.token
        })
      )
    );
  }

  renderActivity () {
    return React.createElement('div', { className: 'gpage-panel' },
      React.createElement('h2', null, 'Activity'),
      React.createElement('div', { className: 'body' },
        React.createElement(RegisterEventLog, {
          items: this.state.events,
          empty: 'No group events yet — proposals, votes, join applications, and membership changes will appear here.'
        })
      )
    );
  }

  renderFabricInspector () {
    const g = this.state.group;
    if (!g || !readAdvancedMode()) return null;
    if (g.role !== 'member' && g.role !== 'creator') return null;
    const headers = {};
    if (this.state.token) headers.Authorization = `Bearer ${this.state.token}`;
    return React.createElement(GroupFabricInspector, {
      groupId: g.id,
      contractId: g.contractId || null,
      headers,
      embedded: false
    });
  }
}

GroupPage.CSS = CSS + '\n' + (GroupBitcoinPanel.CSS || '') + '\n' +
  (GroupComposition.CSS || '') + '\n' + (StarMap.CSS || '') + '\n' +
  (GroupContractSummary.CSS || '') + '\n' + (Chat.CSS || '');
GroupPage.pathKeyFromLocation = function () {
  const m = String((typeof window !== 'undefined' && window.location.pathname) || '').match(/^\/groups\/([^/]+)/);
  return m ? m[1] : null;
};

module.exports = GroupPage;
