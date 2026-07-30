'use strict';

/**
 * Chat — org chat brought forward from the Hub (ChatMessage types).
 *
 * Channel list on the left: Global, group channels, and DM threads.
 * Member list (right) and message authors: hover for profile preview + Message
 * (DM); click opens the peer profile page. Messages sync over the Fabric Peer.
 */

const React = require('react');

const BASE = '/services/star-citizen';

const CSS = `
  /* Fill the window canvas (Dashboard toggles body.chat-fill). Sidebars + messages scroll internally. */
  .chat-wrap{width:100%;max-width:none;margin:0;padding:12px 14px;display:grid;
    grid-template-columns:minmax(180px,220px) minmax(0,1fr) minmax(180px,220px);gap:12px;
    height:100%;min-height:0;overflow:hidden;box-sizing:border-box}
  .chat-side{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:auto;
    min-height:0;min-width:0}
  .chat-side h3{font-size:12px;color:var(--muted);margin:0;padding:12px 14px 6px;text-transform:uppercase;letter-spacing:.4px;
    position:sticky;top:0;background:var(--panel);z-index:1}
  .chat-ch{display:flex;gap:8px;align-items:center;width:100%;text-align:left;background:none;border:none;
    color:var(--text);padding:9px 14px;font-size:13px;cursor:pointer;border-left:3px solid transparent}
  .chat-ch:hover{background:var(--panel2)}
  .chat-ch.on{background:var(--panel2);border-left-color:var(--accent)}
  .chat-ch .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .chat-ch .c{color:var(--muted);font-size:11px}
  .chat-main{background:var(--panel);border:1px solid var(--line);border-radius:12px;display:flex;flex-direction:column;
    min-width:0;min-height:0;overflow:hidden}
  .chat-head{padding:12px 16px;border-bottom:1px solid var(--line);font-size:13px;font-weight:600;display:flex;gap:10px;align-items:center;
    flex:0 0 auto}
  .chat-head .sub{color:var(--muted);font-weight:400;font-size:12px}
  .chat-msgs{flex:1 1 auto;min-height:0;overflow:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px}
  .chat-msg .m{display:flex;gap:8px;align-items:baseline}
  .chat-msg .chat-author{display:inline-flex;gap:8px;align-items:baseline;cursor:pointer;
    border-radius:4px;padding:1px 3px;margin:-1px -3px}
  .chat-msg .chat-author:hover{background:rgba(56,139,253,.08)}
  .chat-msg .chat-author:focus{outline:1px solid var(--accent);outline-offset:1px}
  .chat-msg .who{font-weight:600;font-size:12.5px}
  .chat-msg .who.me{color:var(--accent)}
  .chat-msg .key{color:var(--muted);font-size:10.5px;font-family:'Cascadia Code',Consolas,monospace}
  .chat-msg .t{color:var(--muted);font-size:10.5px;font-variant-numeric:tabular-nums}
  .chat-msg .b{font-size:13.5px;line-height:1.5;word-break:break-word;white-space:pre-wrap}
  .chat-empty{color:var(--muted);font-style:italic;text-align:center;margin:auto;font-size:13px;line-height:1.7}
  .chat-compose{display:flex;gap:8px;padding:12px 14px;border-top:1px solid var(--line);flex:0 0 auto}
  .chat-compose input{flex:1;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:8px;padding:10px 12px;font-size:13.5px;min-width:0}
  .chat-send{background:var(--accent);border:none;color:#fff;border-radius:8px;padding:0 18px;
    font-size:13px;font-weight:600;cursor:pointer}
  .chat-send:disabled{opacity:.45;cursor:default}
  .chat-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;margin:0 14px 10px;padding:8px 11px;font-size:12.5px;
    flex:0 0 auto}
  .chat-members{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:auto;display:flex;
    flex-direction:column;min-height:0;min-width:0}
  .chat-members h3{font-size:12px;color:var(--muted);margin:0;padding:12px 14px 6px;text-transform:uppercase;letter-spacing:.4px;
    position:sticky;top:0;background:var(--panel);z-index:1}
  .chat-mem{display:grid;gap:2px;padding:8px 12px;border-bottom:1px solid #20262f;cursor:pointer}
  .chat-mem:hover{background:rgba(56,139,253,.06)}
  .chat-mem:last-child{border-bottom:none}
  .chat-mem .row{display:flex;gap:8px;align-items:center;min-width:0}
  .chat-mem .dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--muted)}
  .chat-mem .dot.on{background:var(--good);box-shadow:0 0 0 2px rgba(63,185,80,.25)}
  .chat-mem .nm{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
  .chat-mem .nm.me{color:var(--accent)}
  .chat-mem .pk{font-size:10.5px;color:var(--muted);font-family:'Cascadia Code',Consolas,monospace}
  .chat-mem .ship{font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .chat-mem .ship b{color:var(--text);font-weight:600}
  .chat-mem .tag{font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(56,139,253,.12);color:var(--accent)}
  .chat-mem-hint{color:var(--muted);font-size:11.5px;padding:10px 14px;line-height:1.5}
  .chat-mem-wrap{position:relative}
  /* Fixed so overflow:auto on .chat-members cannot clip the popover. */
  .chat-mem-card{position:fixed;z-index:40;width:280px;
    background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 13px;
    box-shadow:0 12px 28px rgba(0,0,0,.45);display:grid;gap:8px;cursor:default;pointer-events:auto}
  .chat-mem-card .nm{font-size:14px;font-weight:650}
  .chat-mem-card .pk{font-size:10.5px;color:var(--muted);font-family:'Cascadia Code',Consolas,monospace;word-break:break-all}
  .chat-mem-card .bio{font-size:12.5px;line-height:1.45;color:var(--text);max-height:4.2em;overflow:hidden}
  .chat-mem-card .meta{font-size:12px;color:var(--muted);line-height:1.4;display:flex;flex-wrap:wrap;gap:4px;align-items:center}
  .chat-mem-card .meta b{color:var(--text);font-weight:600}
  .chat-mem-card .dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--muted)}
  .chat-mem-card .dot.on{background:var(--good);box-shadow:0 0 0 2px rgba(63,185,80,.25)}
  .chat-mem-card .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
  .chat-mem-card .btn{background:var(--accent);border:none;color:#fff;border-radius:7px;padding:6px 11px;
    font-size:12px;font-weight:600;cursor:pointer}
  .chat-mem-card .btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
  .chat-mem-card .btn:disabled{opacity:.45;cursor:default}
  .chat-mem-card .invite{display:grid;gap:6px;padding-top:4px;border-top:1px solid var(--line)}
  .chat-mem-card .invite label{font-size:11px;color:var(--muted)}
  .chat-mem-card .invite select{width:100%;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:6px 8px;font-size:12px}
  .chat-mem-card .invite .hint{font-size:11px;color:var(--muted);line-height:1.4}
  .chat-mem-card .invite .ok{font-size:11.5px;color:var(--good)}
  .chat-mem-card .invite .err{font-size:11.5px;color:var(--kill)}
  /* Group page (and similar): messages + compose only, no channel/member rails. */
  .chat-wrap.chat-embedded{grid-template-columns:1fr;height:min(440px,55vh);padding:0;gap:0}
  .chat-wrap.chat-embedded .chat-side,
  .chat-wrap.chat-embedded .chat-members{display:none}
  .chat-wrap.chat-embedded .chat-main{border-radius:0;border:none;min-height:0}
  @media(max-width:980px){
    .chat-wrap{grid-template-columns:1fr;grid-template-rows:minmax(120px,22%) minmax(0,1fr) minmax(120px,22%);gap:10px}
    .chat-wrap.chat-embedded{grid-template-rows:minmax(0,1fr);height:min(440px,55vh)}
    .chat-side,.chat-members{max-height:none}
    .chat-mem-card{width:min(260px,calc(100vw - 24px))}
  }
`;

function shortKey (pk) {
  return pk ? pk.slice(0, 8) + '…' : '?';
}

function identityBridge () {
  return (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.identity) || null;
}

function shortTime (ts) {
  const m = String(ts || '').match(/T(\d{2}:\d{2})/);
  return m ? m[1] : '';
}

/** Match ChatManager.dmChannelKey (sorted pubkey pair). */
function dmChannelKey (a, b) {
  const x = String(a || '').trim();
  const y = String(b || '').trim();
  if (!x || !y || x === y) return null;
  const [lo, hi] = [x, y].sort((p, q) => p.localeCompare(q));
  return `dm:${lo}:${hi}`;
}

const PREFERRED_CHANNEL_KEY = 'gc.chat.channel';

function initialChannel (props) {
  if (props && props.groupId) return 'group:' + props.groupId;
  if (props && props.channel) return props.channel;
  try {
    const pref = sessionStorage.getItem(PREFERRED_CHANNEL_KEY);
    if (pref) {
      sessionStorage.removeItem(PREFERRED_CHANNEL_KEY);
      return pref;
    }
  } catch (_) { /* ignore */ }
  return 'global';
}

class Chat extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      channels: [],
      channel: initialChannel(props),
      messages: [],
      draft: '',
      error: null,
      sending: false,
      loading: true,
      members: [],
      membersLabel: 'Members',
      hoverPubkey: null,
      hoverRect: null, // DOMRect-like for fixed popover placement
      profileCache: {},
      openDmChannels: [], // { key, label, kind, peerPubkey } opened from the member card
      inviteOpen: false,
      inviteGroups: [],
      inviteGroupId: '',
      inviteLoading: false,
      inviteBusy: false,
      inviteError: null,
      inviteOk: null,
      authToken: null
    };
    this._timer = null;
    this._hoverTimer = null;
    this._msgsRef = React.createRef();
    this._memRefs = {};
  }

  lockedChannel () {
    if (this.props.groupId) return 'group:' + this.props.groupId;
    if (this.props.channel) return this.props.channel;
    return null;
  }

  componentDidMount () {
    this.refresh();
    this._timer = setInterval(() => this.refresh(), 3000);
  }

  componentDidUpdate (prevProps) {
    const next = this.lockedChannel();
    const prev = prevProps.groupId
      ? 'group:' + prevProps.groupId
      : (prevProps.channel || null);
    if (next && next !== prev && next !== this.state.channel) {
      this.setState({ channel: next, messages: [], members: [], loading: true }, () => this.refresh());
    }
  }

  componentWillUnmount () {
    if (this._timer) clearInterval(this._timer);
    if (this._hoverTimer) clearTimeout(this._hoverTimer);
  }

  async refresh () {
    try {
      const [chRes, msgRes] = await Promise.all([
        fetch(`${BASE}/chat/channels`).then((r) => r.json()),
        fetch(`${BASE}/chat/messages?channel=${encodeURIComponent(this.state.channel)}&limit=200`).then((r) => r.json())
      ]);
      const fromApi = chRes.data || [];
      const keys = new Set(fromApi.map((c) => c.key));
      const channels = fromApi.concat(
        (this.state.openDmChannels || []).filter((c) => c && c.key && !keys.has(c.key))
      );
      const messages = msgRes.data || [];
      const el = this._msgsRef.current;
      const pinned = el && (el.scrollHeight - el.scrollTop - el.clientHeight < 60);
      this.setState({ channels, messages, loading: false }, () => {
        if (pinned && this._msgsRef.current) this._msgsRef.current.scrollTop = this._msgsRef.current.scrollHeight;
      });
      await this.refreshMembers(channels, messages);
    } catch (_) {
      this.setState({ loading: false });
    }
  }

  openProfile (pubkey) {
    if (!pubkey) return;
    window.location.href = `/profiles/${encodeURIComponent(pubkey)}`;
  }

  async ensureAuth () {
    if (this.state.authToken) return this.state.authToken;
    const bridge = identityBridge();
    if (!bridge) return null;
    try {
      const info = await bridge.get();
      if (!info || !info.unlocked || !bridge.signEnvelope) return null;
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
      if (token) this.setState({ authToken: token });
      return token || null;
    } catch (_) {
      return null;
    }
  }

  async openInvitePicker () {
    const me = this.props.identityPubkey;
    if (!me || !this.state.hoverPubkey || this.state.hoverPubkey === me) return;
    this.setState({
      inviteOpen: true,
      inviteLoading: true,
      inviteError: null,
      inviteOk: null,
      inviteGroups: [],
      inviteGroupId: ''
    });
    try {
      const token = await this.ensureAuth();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${BASE}/groups`, { headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const target = this.state.hoverPubkey;
      const groups = (json.data || []).filter((g) => {
        if (!Array.isArray(g.members) || !g.members.includes(me)) return false;
        if (target && g.members.includes(target)) return false;
        return true;
      });
      const preferred = this.props.groupId && groups.some((g) => g.id === this.props.groupId)
        ? this.props.groupId
        : (groups[0] ? groups[0].id : '');
      this.setState({
        inviteLoading: false,
        inviteGroups: groups,
        inviteGroupId: preferred
      });
    } catch (e) {
      this.setState({ inviteLoading: false, inviteError: e.message || String(e) });
    }
  }

  async sendGroupInvite () {
    const groupId = this.state.inviteGroupId;
    const invitee = this.state.hoverPubkey;
    const me = this.props.identityPubkey;
    if (!groupId || !invitee || !me || this.state.inviteBusy) return;
    this.setState({ inviteBusy: true, inviteError: null, inviteOk: null });
    try {
      const token = await this.ensureAuth();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const g = (this.state.inviteGroups || []).find((x) => x.id === groupId);
      const res = await fetch(`${BASE}/groups/${encodeURIComponent(groupId)}/invites`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          inviteePubkey: invitee,
          note: `You're invited to join ${(g && g.name) || 'our group'}`
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const data = json.data || {};
      const mesh = data.relayed
        ? `Invite sent to the network (${data.peers || 0} peer connection(s)).`
        : (`Invite saved` + (data.relayError ? ` — mesh: ${data.relayError}` : ''));
      this.setState({ inviteBusy: false, inviteOk: mesh });
    } catch (e) {
      this.setState({ inviteBusy: false, inviteError: e.message || String(e) });
    }
  }

  scheduleHover (pubkey, el) {
    if (this._hoverTimer) clearTimeout(this._hoverTimer);
    const rect = el && el.getBoundingClientRect
      ? el.getBoundingClientRect()
      : (this._memRefs[pubkey] && this._memRefs[pubkey].getBoundingClientRect
        ? this._memRefs[pubkey].getBoundingClientRect()
        : null);
    this._hoverTimer = setTimeout(() => {
      this.setState({
        hoverPubkey: pubkey,
        hoverRect: rect
          ? { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
          : null,
        inviteOpen: false,
        inviteError: null,
        inviteOk: null
      });
      this.ensureProfile(pubkey);
    }, 120);
  }

  scheduleHoverLeave () {
    if (this._hoverTimer) clearTimeout(this._hoverTimer);
    this._hoverTimer = setTimeout(() => {
      this.setState({ hoverPubkey: null, hoverRect: null });
    }, 280);
  }

  cancelHoverLeave () {
    if (this._hoverTimer) clearTimeout(this._hoverTimer);
  }

  cardStyle () {
    const r = this.state.hoverRect;
    if (!r) return { top: 80, right: 16 };
    const cardW = 260;
    const gap = 8;
    // Prefer to the right of message authors (left of the pane); fall back left of members rail.
    let left = r.right + gap;
    if (left + cardW > window.innerWidth - 8) {
      left = r.left - cardW - gap;
    }
    if (left < 8) left = Math.min(r.right + gap, window.innerWidth - cardW - 8);
    let top = r.top;
    const maxTop = window.innerHeight - 220;
    if (top > maxTop) top = Math.max(8, maxTop);
    return { top, left };
  }

  renderAuthor (author, handle) {
    if (!author) return null;
    const me = this.props.identityPubkey || null;
    return React.createElement('span', {
      className: 'chat-author',
      title: 'Hover for preview · click for profile',
      role: 'link',
      tabIndex: 0,
      onMouseEnter: (e) => this.scheduleHover(author, e.currentTarget),
      onMouseLeave: () => this.scheduleHoverLeave(),
      onClick: () => this.openProfile(author),
      onKeyDown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.openProfile(author);
        }
      }
    },
    React.createElement('span', { className: 'who' + (me && author === me ? ' me' : '') },
      handle || shortKey(author)),
    // Pubkey always visible — nickname is a label, never a substitute for the actor id.
    React.createElement('span', { className: 'key', title: author }, shortKey(author))
    );
  }

  async ensureProfile (pubkey) {
    if (!pubkey || this.state.profileCache[pubkey]) return;
    try {
      const res = await fetch(`${BASE}/profiles/${encodeURIComponent(pubkey)}`);
      const json = await res.json();
      if (!res.ok) return;
      this.setState((s) => ({
        profileCache: Object.assign({}, s.profileCache, { [pubkey]: json.data || null })
      }));
    } catch (_) { /* ignore */ }
  }

  openDm (peerPubkey, handle) {
    const me = this.props.identityPubkey;
    if (!me || !peerPubkey || me === peerPubkey) return;
    const key = dmChannelKey(me, peerPubkey);
    if (!key) return;
    // Embedded group chat has no channel rail — hand off to the Chat tab.
    if (this.props.embedded) {
      try { sessionStorage.setItem(PREFERRED_CHANNEL_KEY, key); } catch (_) { /* ignore */ }
      window.location.href = '/#chat';
      return;
    }
    const ch = {
      key,
      label: 'DM ' + (handle || shortKey(peerPubkey)),
      kind: 'dm',
      peerPubkey
    };
    this.setState((s) => {
      const openDmChannels = (s.openDmChannels || []).some((c) => c.key === key)
        ? s.openDmChannels
        : (s.openDmChannels || []).concat([ch]);
      return { openDmChannels, hoverPubkey: null, channel: key, messages: [], loading: true };
    }, () => this.refresh());
  }

  async refreshMembers (channels, messages) {
    const active = (channels || this.state.channels).find((c) => c.key === this.state.channel);
    const msgs = messages || this.state.messages || [];
    const me = this.props.identityPubkey || null;
    let roster = {};
    try {
      const r = await fetch(`${BASE}/presence/roster`).then((res) => (res.ok ? res.json() : null));
      roster = (r && r.data) || {};
    } catch (_) { /* ignore */ }

    const byPk = new Map();
    const upsert = (pubkey, patch = {}) => {
      if (!pubkey) return;
      const prev = byPk.get(pubkey) || { pubkey, handle: null, online: false, ship: null, role: null };
      byPk.set(pubkey, Object.assign(prev, patch));
    };

    // Recent chat authors (handles from messages).
    for (const m of msgs) {
      upsert(m.author, { handle: m.handle || null });
    }

    if (active && active.kind === 'group' && active.groupId) {
      try {
        const gRes = await fetch(`${BASE}/groups/${encodeURIComponent(active.groupId)}`);
        const gJson = await gRes.json();
        const g = gJson && gJson.data;
        if (g && Array.isArray(g.members)) {
          for (const pk of g.members) {
            upsert(pk, {
              role: pk === g.creator ? 'creator' : 'member'
            });
          }
        }
      } catch (_) { /* private / unavailable */ }
    } else {
      // Global: mesh presence roster + anyone who has spoken.
      for (const [pk, p] of Object.entries(roster)) {
        upsert(pk, {
          handle: (p && p.nickname) || null,
          online: !!(p && p.online),
          ship: (p && p.ship) || null
        });
      }
    }

    // Overlay presence for everyone we already listed.
    for (const [pk, row] of byPk) {
      const p = roster[pk];
      if (!p) continue;
      byPk.set(pk, Object.assign({}, row, {
        handle: row.handle || p.nickname || null,
        online: p.online === true,
        ship: p.ship || row.ship || null
      }));
    }

    if (me && !byPk.has(me)) {
      upsert(me, { handle: this.props.nickname || null, role: active && active.kind === 'group' ? 'you' : null });
    }

    const members = [...byPk.values()].sort((a, b) => {
      if (!!b.online !== !!a.online) return b.online ? 1 : -1;
      const an = (a.handle || a.pubkey || '').toLowerCase();
      const bn = (b.handle || b.pubkey || '').toLowerCase();
      return an.localeCompare(bn);
    });

    this.setState({
      members,
      membersLabel: active && active.kind === 'group' ? 'Members' : 'On channel'
    });
  }

  pick (key) {
    if (this.lockedChannel()) return;
    this.setState({ channel: key, messages: [], members: [], loading: true }, () => this.refresh());
  }

  async send () {
    const body = this.state.draft.trim();
    if (!body || this.state.sending) return;
    this.setState({ sending: true, error: null });
    try {
      const res = await fetch(`${BASE}/chat/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: this.state.channel, body })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({ draft: '', sending: false });
      await this.refresh();
      if (this._msgsRef.current) this._msgsRef.current.scrollTop = this._msgsRef.current.scrollHeight;
    } catch (e) {
      this.setState({ sending: false, error: e.message });
    }
  }

  renderMemberCard () {
    const pubkey = this.state.hoverPubkey;
    if (!pubkey) return null;
    const m = (this.state.members || []).find((row) => row.pubkey === pubkey) || { pubkey };
    const me = this.props.identityPubkey || null;
    const detail = this.state.profileCache[pubkey] || null;
    const profile = (detail && detail.profile) || {};
    const presence = (detail && detail.presence) || null;
    const ship = (presence && presence.ship) || m.ship;
    const shipLabel = ship && (ship.name || ship.slug);
    const online = presence ? !!presence.online : !!m.online;
    const nickname = profile.nickname || m.handle || null;
    const scHandle = profile.scHandle || null;
    const bio = profile.bio || null;
    const isSelf = !!(me && pubkey === me);

    return React.createElement('div', {
      className: 'chat-mem-card',
      style: this.cardStyle(),
      onMouseEnter: () => this.cancelHoverLeave(),
      onMouseLeave: () => this.scheduleHoverLeave(),
      onClick: (e) => e.stopPropagation()
    },
    React.createElement('div', { className: 'nm' }, nickname || shortKey(pubkey)),
    React.createElement('div', { className: 'pk', title: pubkey }, pubkey),
    React.createElement('div', { className: 'meta' },
      React.createElement('span', { className: 'dot' + (online ? ' on' : '') }),
      React.createElement('span', null, online ? 'online' : 'offline'),
      scHandle ? React.createElement('span', null, '· SC ', React.createElement('b', null, scHandle)) : null,
      shipLabel
        ? React.createElement('span', null, '· ', React.createElement('b', null, shipLabel),
          ship.type ? ` (${ship.type})` : '')
        : null,
      m.role === 'creator' ? React.createElement('span', null, '· creator') : null
    ),
    bio ? React.createElement('div', { className: 'bio' }, bio) : null,
    !detail
      ? React.createElement('div', { className: 'meta' }, 'loading profile…')
      : null,
    React.createElement('div', { className: 'actions' },
      React.createElement('button', {
        type: 'button',
        className: 'btn',
        disabled: isSelf || !me,
        title: isSelf ? 'That\'s you' : (me ? 'Open a direct message' : 'Unlock identity to DM'),
        onClick: (e) => {
          e.stopPropagation();
          this.openDm(pubkey, nickname || m.handle);
        }
      }, isSelf ? 'You' : 'Message'),
      React.createElement('button', {
        type: 'button',
        className: 'btn ghost',
        onClick: (e) => {
          e.stopPropagation();
          this.openProfile(pubkey);
        }
      }, 'Profile'),
      !isSelf && me
        ? React.createElement('button', {
          type: 'button',
          className: 'btn ghost',
          title: 'Send a direct group invitation',
          onClick: (e) => {
            e.stopPropagation();
            this.openInvitePicker();
          }
        }, this.state.inviteOpen ? 'Invite ▾' : 'Invite to group')
        : null
    ),
    this.state.inviteOpen && !isSelf
      ? React.createElement('div', { className: 'invite' },
        React.createElement('label', null, 'Choose a group'),
        this.state.inviteLoading
          ? React.createElement('div', { className: 'hint' }, 'loading your groups…')
          : (this.state.inviteGroups.length
            ? React.createElement(React.Fragment, null,
              React.createElement('select', {
                value: this.state.inviteGroupId,
                onChange: (e) => this.setState({ inviteGroupId: e.target.value, inviteOk: null, inviteError: null }),
                onClick: (e) => e.stopPropagation()
              }, this.state.inviteGroups.map((g) => React.createElement('option', { key: g.id, value: g.id }, g.name))),
              React.createElement('button', {
                type: 'button',
                className: 'btn',
                disabled: !this.state.inviteGroupId || this.state.inviteBusy,
                onClick: (e) => {
                  e.stopPropagation();
                  this.sendGroupInvite();
                }
              }, this.state.inviteBusy ? 'Sending…' : 'Send invite')
            )
            : React.createElement('div', { className: 'hint' },
              'No groups available — create one on the Groups tab, or they may already be a member.')),
        this.state.inviteOk ? React.createElement('div', { className: 'ok' }, this.state.inviteOk) : null,
        this.state.inviteError ? React.createElement('div', { className: 'err' }, this.state.inviteError) : null
      )
      : null
    );
  }

  renderMembers () {
    const me = this.props.identityPubkey || null;
    const members = this.state.members || [];
    return React.createElement('div', { className: 'chat-members' },
      React.createElement('h3', null, this.state.membersLabel,
        members.length ? ` · ${members.length}` : ''),
      members.length
        ? members.map((m) => {
          const ship = m.ship;
          const shipLabel = ship && (ship.name || ship.slug);
          return React.createElement('div', {
            className: 'chat-mem-wrap',
            key: m.pubkey,
            ref: (el) => { this._memRefs[m.pubkey] = el; },
            onMouseEnter: (e) => this.scheduleHover(m.pubkey, e.currentTarget),
            onMouseLeave: () => this.scheduleHoverLeave()
          },
          React.createElement('div', {
            className: 'chat-mem',
            title: 'Hover for preview · click for profile',
            role: 'link',
            tabIndex: 0,
            onClick: () => this.openProfile(m.pubkey),
            onKeyDown: (e) => {
              if ((e.key === 'Enter' || e.key === ' ') && m.pubkey) {
                e.preventDefault();
                this.openProfile(m.pubkey);
              }
            }
          },
          React.createElement('div', { className: 'row' },
            React.createElement('span', { className: 'dot' + (m.online ? ' on' : '') }),
            React.createElement('span', {
              className: 'nm' + (me && m.pubkey === me ? ' me' : ''),
              title: m.pubkey
            }, m.handle || shortKey(m.pubkey)),
            m.role === 'creator'
              ? React.createElement('span', { className: 'tag' }, 'creator')
              : null
          ),
          React.createElement('div', { className: 'pk', title: m.pubkey }, shortKey(m.pubkey)),
          shipLabel
            ? React.createElement('div', { className: 'ship' },
              React.createElement('b', null, shipLabel),
              ship.type ? ` · ${ship.type}` : '')
            : null
          )
          );
        })
        : React.createElement('div', { className: 'chat-mem-hint' },
          this.state.channel === 'global'
            ? 'Peers sharing presence (and recent chat authors) appear here — hover for profile / DM, click for full page.'
            : 'Group members appear here once the group is loaded — hover for profile / DM, click for full page.')
    );
  }

  render () {
    const me = this.props.identityPubkey || null;
    const active = this.state.channels.find((c) => c.key === this.state.channel);

    const embedded = !!this.props.embedded;
    const headLabel = embedded
      ? 'Group chat'
      : (active
        ? (active.kind === 'global'
          ? '🌐 Global'
          : (active.kind === 'dm' ? '✉️ ' + active.label : '👥 ' + active.label))
        : this.state.channel);
    const headSub = embedded
      ? 'members only · same channel as Chat tab'
      : (active && active.kind === 'group'
        ? 'members only'
        : (active && active.kind === 'dm'
          ? 'direct — only you and them'
          : 'network — relayed via your Fabric peers'));

    return React.createElement('div', { className: 'chat-wrap' + (embedded ? ' chat-embedded' : '') },
      embedded
        ? null
        : React.createElement('div', { className: 'chat-side' },
          React.createElement('h3', null, 'Channels'),
          this.state.channels.map((ch) => React.createElement('button', {
            className: 'chat-ch' + (ch.key === this.state.channel ? ' on' : ''),
            key: ch.key,
            onClick: () => this.pick(ch.key)
          },
          React.createElement('span', null,
            ch.kind === 'global' ? '🌐' : (ch.kind === 'dm' ? '✉️' : '👥')),
          React.createElement('span', { className: 'n' }, ch.label),
          ch.count ? React.createElement('span', { className: 'c' }, ch.count) : null
          )),
          !this.state.channels.some((c) => c.kind === 'group')
            ? React.createElement('div', { style: { color: 'var(--muted)', fontSize: 11.5, padding: '8px 14px', lineHeight: 1.5 } },
              'Each group gets its own channel — create or join one on the Groups tab. Hover a member to start a DM.')
            : null
        ),
      React.createElement('div', { className: 'chat-main' },
        React.createElement('div', { className: 'chat-head' },
          headLabel,
          React.createElement('span', { className: 'sub' }, headSub)
        ),
        React.createElement('div', { className: 'chat-msgs', ref: this._msgsRef },
          this.state.messages.length
            ? this.state.messages.map((m) => React.createElement('div', { className: 'chat-msg', key: m.id },
              React.createElement('div', { className: 'm' },
                this.renderAuthor(m.author, m.handle),
                React.createElement('span', { className: 't' }, shortTime(m.ts))
              ),
              React.createElement('div', { className: 'b' }, m.body)
            ))
            : React.createElement('div', { className: 'chat-empty' },
              this.state.loading ? 'loading…' : 'No messages yet — say hello, Citizen.')
        ),
        this.state.error ? React.createElement('div', { className: 'chat-err' }, this.state.error) : null,
        React.createElement('div', { className: 'chat-compose' },
          React.createElement('input', {
            type: 'text',
            value: this.state.draft,
            placeholder: me
              ? ('Message as ' + (this.props.nickname || shortKey(me)) + '…')
              : 'Unlock your identity to chat…',
            onChange: (e) => this.setState({ draft: e.target.value }),
            onKeyDown: (e) => { if (e.key === 'Enter') this.send(); }
          }),
          React.createElement('button', {
            className: 'chat-send',
            disabled: !this.state.draft.trim() || this.state.sending,
            onClick: () => this.send()
          }, this.state.sending ? '…' : 'Send')
        )
      ),
      embedded ? null : this.renderMembers(),
      this.renderMemberCard()
    );
  }
}

Chat.CSS = CSS;

module.exports = Chat;
