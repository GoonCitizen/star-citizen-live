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
  .gp-wrap{display:grid;gap:16px;grid-template-columns:minmax(280px,340px) 1fr;align-items:start}
  @media(max-width:900px){.gp-wrap{grid-template-columns:1fr}}
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
  .gp-tag.public{background:rgba(63,185,80,.15);color:var(--good)}
  .gp-tag.private{background:rgba(110,118,129,.18);color:var(--muted)}
  .gp-actions{display:flex;flex-wrap:wrap;gap:8px;padding:10px 14px;border-top:1px solid var(--line)}
  .gp-chat{border-top:1px solid var(--line)}
  .gp-chat h3{font-size:12px;color:var(--muted);margin:0;padding:12px 14px 6px;text-transform:uppercase;letter-spacing:.4px}
  .gp-chat .chat-wrap{border-radius:0}
`;

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
      busy: false
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
      const res = await fetch(`${BASE}/groups`, { headers: this.headers(token) });
      const json = await res.json();
      const groups = (json && json.data) || [];
      this.setState((s) => ({
        groups,
        loading: false,
        selectedId: s.selectedId && groups.some((g) => g.id === s.selectedId) ? s.selectedId : (groups[0] ? groups[0].id : null)
      }));
    } catch (e) {
      this.setState({ loading: false, error: 'Could not load groups: ' + e.message });
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
      const mesh = data.relayed
        ? `Broadcast to network (${data.peers || 0} peer connection(s)). `
        : (`Mesh broadcast failed` + (data.relayError ? `: ${data.relayError}` : '') + '. ');
      try {
        await navigator.clipboard.writeText(url);
        this.setState({
          busy: false,
          notice: mesh + 'fabric:… offer copied. Page: ' + this.shareUrl(g),
          error: data.relayed ? null : (data.relayError || 'Share copied locally but not broadcast')
        });
      } catch (_) {
        this.setState({
          busy: false,
          notice: mesh + url,
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
    const addValid = PUBKEY_RE.test(this.state.addKey.trim()) && canManage && !g.members.includes(this.state.addKey.trim());
    const memberList = Array.isArray(g.members) ? g.members : null;

    return React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'gp-meta' },
        React.createElement('span', null, 'decisions ', React.createElement('b', null, `${g.threshold}-of-${memberList ? memberList.length : 'n'}`)),
        React.createElement('span', null, 'created ', React.createElement('b', null, String(g.createdAt || '').slice(0, 10))),
        React.createElement('span', { className: 'gp-tag ' + (g.visibility === 'public' ? 'public' : 'private') }, g.visibility || 'private'),
        g.parentId
          ? React.createElement('span', null, 'subgroup of ', React.createElement('b', null,
            (this.state.groups.find((x) => x.id === g.parentId) || {}).name || g.parentId.slice(0, 8) + '…'))
          : null,
        React.createElement('span', { title: g.path }, 'page ', React.createElement('b', null, g.path || `/groups/${g.id}`))
      ),
      React.createElement('div', { className: 'gp-actions' },
        React.createElement('button', { className: 'gp-btn', onClick: () => this.openPage(g) }, 'Open page'),
        React.createElement('button', { className: 'gp-btn ghost', onClick: () => this.share(g) }, 'Share'),
        isCreator
          ? React.createElement('button', {
            className: 'gp-btn ghost', disabled: this.state.busy,
            onClick: () => this.toggleVisibility(g)
          }, g.visibility === 'public' ? 'Make private' : 'Make public')
          : null
      ),
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
          : null),
      this.renderChat(g, canManage)
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

  renderInspector () {
    if (!this.props.advancedMode || !this.state.selectedId) return null;
    const g = this.state.groups.find((x) => x.id === this.state.selectedId);
    if (!g) return null;
    const headers = {};
    if (this.state.token) headers.Authorization = `Bearer ${this.state.token}`;
    return React.createElement(GroupFabricInspector, {
      groupId: g.id,
      contractId: g.contractId || null,
      headers
    });
  }

  render () {
    const me = this.state.pubkey;
    return React.createElement('main', null,
      React.createElement('div', { className: 'gp-wrap', style: { gridColumn: '1 / -1' } },
        React.createElement('section', { className: 'panel' },
          React.createElement('h2', null, '👥 Your groups ',
            React.createElement('span', { className: 'sub' }, '— k-of-n multisig squads & subgroups'),
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
                React.createElement('button', { className: 'gp-btn ghost', style: { padding: '2px 10px', fontSize: 11 }, onClick: () => this.copy(me) }, 'Copy pubkey'))
              : React.createElement('span', null, 'no identity — unlock it to manage groups')
          ),
          this.state.showCreate ? this.renderCreate() : null,
          this.state.loading
            ? React.createElement('div', { className: 'empty' }, 'loading…')
            : (this.state.groups.length
              ? this.state.groups.map((g) => React.createElement('div', {
                className: 'gp-row' + (g.id === this.state.selectedId ? ' on' : ''),
                key: g.id,
                onClick: () => this.setState({ selectedId: g.id }),
                onDoubleClick: () => this.openPage(g)
              },
                React.createElement('span', { className: 'n', style: g.parentId ? { paddingLeft: 14 } : null },
                  g.parentId ? '↳ ' : '',
                  g.name,
                  React.createElement('span', { className: 'gp-tag ' + (g.visibility === 'public' ? 'public' : 'private'), style: { marginLeft: 8 } }, g.visibility || 'private'),
                  g.parentId
                    ? React.createElement('span', { className: 'gp-tag', style: { marginLeft: 6 } }, 'subgroup')
                    : null
                ),
                React.createElement('span', { className: 'd' },
                  (g.members ? `${g.members.length} member${g.members.length === 1 ? '' : 's'}` : `${g.memberCount || 0} members`) +
                  ` · ${g.threshold}-of-${g.members ? g.members.length : 'n'}`)
              ))
              : React.createElement('div', { className: 'empty' }, 'no groups yet'))
        ),
        React.createElement('section', { className: 'panel' },
          React.createElement('h2', null, '🛠️ Manage ',
            React.createElement('span', { className: 'sub' }, '— members, thresholds & sharing')
          ),
          this.state.error ? React.createElement('div', { className: 'gp-err' }, this.state.error) : null,
          this.state.notice ? React.createElement('div', { className: 'gp-ok' }, this.state.notice) : null,
          this.renderDetail()
        )
      ),
      this.renderInspector()
    );
  }
}

Groups.CSS = CSS;

module.exports = Groups;
