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
  .chat-wrap{max-width:1100px;margin:0 auto;padding:18px;display:grid;grid-template-columns:230px 1fr;gap:14px;
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
  @media(max-width:820px){.chat-wrap{grid-template-columns:1fr;height:auto}.chat-side{max-height:180px}}
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
      loading: true
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
      const el = this._msgsRef.current;
      const pinned = el && (el.scrollHeight - el.scrollTop - el.clientHeight < 60);
      this.setState({ channels: chRes.data || [], messages: msgRes.data || [], loading: false }, () => {
        if (pinned && this._msgsRef.current) this._msgsRef.current.scrollTop = this._msgsRef.current.scrollHeight;
      });
    } catch (_) {
      this.setState({ loading: false });
    }
  }

  pick (key) {
    this.setState({ channel: key, messages: [], loading: true }, () => this.refresh());
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
            active && active.kind === 'group' ? 'members only' : 'org-wide — relayed via your peer hubs')
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
      )
    );
  }
}

Chat.CSS = CSS;

module.exports = Chat;
