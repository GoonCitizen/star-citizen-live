'use strict';

/**
 * Chat — org chat brought forward from the Hub (ChatMessage types).
 *
 * Channel list on the left: Global plus a dedicated channel per group.
 * Messages sync over the Fabric Peer: local posts are Schnorr-attributed to
 * your identity and published as `P2P_CHAT_MESSAGE` wire Messages; remote
 * messages arrive via the Peer ingest handlers (D-010).
 *
 * Global chat is also always available via `GlobalChatDock` on other tabs;
 * this page remains the full channel browser (global + groups).
 */

const React = require('react');

const BASE = '/services/star-citizen';

const CSS = `
  .chat-wrap{max-width:1280px;margin:0 auto;padding:18px;display:grid;grid-template-columns:220px 1fr 220px;gap:14px;
    height:calc(100vh - 170px);min-height:420px}
  .chat-side{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:auto}
  .chat-side h3{font-size:12px;color:var(--muted);margin:0;padding:12px 14px 6px;text-transform:uppercase;letter-spacing:.4px}
  .chat-ch{display:flex;gap:8px;align-items:center;width:100%;text-align:left;background:none;border:none;
    color:var(--text);padding:9px 14px;font-size:13px;cursor:pointer;border-left:3px solid transparent}
  .chat-ch:hover{background:var(--panel2)}
  .chat-ch.on{background:var(--panel2);border-left-color:var(--accent)}
  .chat-ch .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .chat-ch .c{color:var(--muted);font-size:11px}
  .chat-main{background:var(--panel);border:1px solid var(--line);border-radius:12px;display:flex;flex-direction:column;min-width:0}
  .chat-head{padding:12px 16px;border-bottom:1px solid var(--line);font-size:13px;font-weight:600;display:flex;gap:10px;align-items:center}
  .chat-head .sub{color:var(--muted);font-weight:400;font-size:12px}
  .chat-msgs{flex:1;overflow:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px}
  .chat-msg .m{display:flex;gap:8px;align-items:baseline}
  .chat-msg .who{font-weight:600;font-size:12.5px}
  .chat-msg .who.me{color:var(--accent)}
  .chat-msg .key{color:var(--muted);font-size:10.5px;font-family:'Cascadia Code',Consolas,monospace;cursor:help}
  .chat-msg .t{color:var(--muted);font-size:10.5px;font-variant-numeric:tabular-nums}
  .chat-msg .b{font-size:13.5px;line-height:1.5;word-break:break-word;white-space:pre-wrap}
  .chat-empty{color:var(--muted);font-style:italic;text-align:center;margin:auto;font-size:13px;line-height:1.7}
  .chat-compose{display:flex;gap:8px;padding:12px 14px;border-top:1px solid var(--line)}
  .chat-compose input{flex:1;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:8px;padding:10px 12px;font-size:13.5px}
  .chat-send{background:var(--accent);border:none;color:#fff;border-radius:8px;padding:0 18px;
    font-size:13px;font-weight:600;cursor:pointer}
  .chat-send:disabled{opacity:.45;cursor:default}
  .chat-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;margin:0 14px 10px;padding:8px 11px;font-size:12.5px}
  .chat-members{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:auto;display:flex;flex-direction:column}
  .chat-members h3{font-size:12px;color:var(--muted);margin:0;padding:12px 14px 6px;text-transform:uppercase;letter-spacing:.4px}
  .chat-mem{display:grid;gap:2px;padding:8px 12px;border-bottom:1px solid #20262f}
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
  @media(max-width:980px){.chat-wrap{grid-template-columns:1fr;height:auto}.chat-side,.chat-members{max-height:180px}}
`;

function shortKey (pk) {
  return pk ? pk.slice(0, 8) + '…' : '?';
}

function shortTime (ts) {
  const m = String(ts || '').match(/T(\d{2}:\d{2})/);
  return m ? m[1] : '';
}

class Chat extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      channels: [],
      channel: 'global',
      messages: [],
      draft: '',
      error: null,
      sending: false,
      loading: true,
      members: [],
      membersLabel: 'Members'
    };
    this._timer = null;
    this._msgsRef = React.createRef();
  }

  componentDidMount () {
    this.refresh();
    this._timer = setInterval(() => this.refresh(), 3000);
  }

  componentWillUnmount () {
    if (this._timer) clearInterval(this._timer);
  }

  async refresh () {
    try {
      const [chRes, msgRes] = await Promise.all([
        fetch(`${BASE}/chat/channels`).then((r) => r.json()),
        fetch(`${BASE}/chat/messages?channel=${encodeURIComponent(this.state.channel)}&limit=200`).then((r) => r.json())
      ]);
      const channels = chRes.data || [];
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
          return React.createElement('div', { className: 'chat-mem', key: m.pubkey },
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
          );
        })
        : React.createElement('div', { className: 'chat-mem-hint' },
          this.state.channel === 'global'
            ? 'Peers sharing presence (and recent chat authors) appear here.'
            : 'Group members appear here once the group is loaded.')
    );
  }

  render () {
    const me = this.props.identityPubkey || null;
    const active = this.state.channels.find((c) => c.key === this.state.channel);

    return React.createElement('div', { className: 'chat-wrap' },
      React.createElement('div', { className: 'chat-side' },
        React.createElement('h3', null, 'Channels'),
        this.state.channels.map((ch) => React.createElement('button', {
          className: 'chat-ch' + (ch.key === this.state.channel ? ' on' : ''),
          key: ch.key,
          onClick: () => this.pick(ch.key)
        },
        React.createElement('span', null, ch.kind === 'global' ? '🌐' : '👥'),
        React.createElement('span', { className: 'n' }, ch.label),
        ch.count ? React.createElement('span', { className: 'c' }, ch.count) : null
        )),
        !this.state.channels.some((c) => c.kind === 'group')
          ? React.createElement('div', { style: { color: 'var(--muted)', fontSize: 11.5, padding: '8px 14px', lineHeight: 1.5 } },
            'Each group gets its own channel — create or join one on the Groups tab.')
          : null
      ),
      React.createElement('div', { className: 'chat-main' },
        React.createElement('div', { className: 'chat-head' },
          active ? (active.kind === 'global' ? '🌐 Global' : '👥 ' + active.label) : this.state.channel,
          React.createElement('span', { className: 'sub' },
            active && active.kind === 'group' ? 'members only' : 'network — relayed via your Fabric peers')
        ),
        React.createElement('div', { className: 'chat-msgs', ref: this._msgsRef },
          this.state.messages.length
            ? this.state.messages.map((m) => React.createElement('div', { className: 'chat-msg', key: m.id },
              React.createElement('div', { className: 'm' },
                React.createElement('span', { className: 'who' + (me && m.author === me ? ' me' : '') },
                  m.handle || shortKey(m.author)),
                // Pubkey always visible — nickname is a label, never a substitute for the actor id.
                React.createElement('span', { className: 'key', title: m.author }, shortKey(m.author)),
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
      this.renderMembers()
    );
  }
}

Chat.CSS = CSS;

module.exports = Chat;
