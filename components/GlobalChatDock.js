'use strict';

/**
 * Always-available public mesh shoutbox dock + desktop notification watcher.
 *
 * The dedicated Chat tab remains the full channel browser (global + groups).
 * This dock keeps the network `global` channel (cleartext `P2P_CHAT_MESSAGE`
 * flood) one click away on every other tab, and polls for new messages so
 * desktop notifications can fire per operator settings
 * (Settings → Desktop notifications).
 */

const React = require('react');
const { showDesktopNotification } = require('../functions/desktopNotify');
const {
  displayCaption,
  messageAttachment,
  DEFAULT_CHAT_ATTACH_PRICE_SATS
} = require('../functions/chatAttachment');

const BASE = '/services/star-citizen';
const LS_OPEN = 'gc.chatDock.open';
const LS_ACKED = 'gc.chatDock.acked';
const LS_NOTIFIED = 'gc.chatNotify.seen';

const CSS = `
  .gcdock{position:fixed;right:16px;bottom:var(--chrome-inset,16px);z-index:30;width:min(380px,calc(100vw - 28px));
    font-family:inherit;pointer-events:none}
  .gcdock *{pointer-events:auto}
  .gcdock-toggle{display:flex;align-items:center;gap:8px;width:100%;background:var(--panel);
    border:1px solid var(--line);border-radius:12px;color:var(--text);padding:10px 14px;
    font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.35)}
  .gcdock-toggle:hover{border-color:var(--accent)}
  .gcdock-toggle .badge{background:var(--accent);color:#fff;border-radius:999px;font-size:11px;
    font-weight:700;min-width:20px;padding:1px 7px;text-align:center}
  .gcdock-toggle .hint{color:var(--muted);font-weight:400;font-size:12px;margin-left:auto}
  .gcdock-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;
    box-shadow:0 12px 40px rgba(0,0,0,.45);display:flex;flex-direction:column;height:min(420px,55vh);
    overflow:hidden}
  .gcdock-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line);
    font-size:13px;font-weight:600}
  .gcdock-head .sub{color:var(--muted);font-weight:400;font-size:11.5px;flex:1}
  .gcdock-head button{background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:6px;padding:3px 9px;font-size:11.5px;cursor:pointer}
  .gcdock-head button:hover{border-color:var(--accent)}
  .gcdock-msgs{flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
  .gcdock-msg .m{display:flex;gap:6px;align-items:baseline}
  .gcdock-msg .who{font-weight:600;font-size:12px}
  .gcdock-msg .who.me{color:var(--accent)}
  .gcdock-msg .key{color:var(--muted);font-size:10px;font-family:'Cascadia Code',Consolas,monospace;cursor:help}
  .gcdock-msg .t{color:var(--muted);font-size:10.5px;font-variant-numeric:tabular-nums}
  .gcdock-msg .b{font-size:13px;line-height:1.45;word-break:break-word;white-space:pre-wrap}
  .gcdock-empty{color:var(--muted);font-style:italic;text-align:center;margin:auto;font-size:12.5px}
  .gcdock-compose{display:flex;gap:6px;padding:10px 12px;border-top:1px solid var(--line);align-items:center}
  .gcdock-compose input{flex:1;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:8px;padding:8px 10px;font-size:13px;min-width:0}
  .gcdock-tool{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:8px;
    width:34px;height:34px;flex:none;cursor:pointer;font-size:14px}
  .gcdock-tool:disabled{opacity:.45;cursor:default}
  .gcdock-send{background:var(--accent);border:none;color:#fff;border-radius:8px;padding:0 14px;height:34px;
    font-size:12.5px;font-weight:600;cursor:pointer}
  .gcdock-send:disabled{opacity:.45;cursor:default}
  .gcdock-chip{font-size:11px;color:var(--muted);padding:0 12px 6px;display:flex;gap:6px;align-items:center}
  .gcdock-chip button{background:none;border:none;color:var(--kill);cursor:pointer;font-size:11px;padding:0}
  .gcdock-err{background:rgba(248,81,73,.12);color:var(--kill);margin:0 12px 8px;padding:7px 10px;
    border-radius:7px;font-size:12px}
`;

function shortKey (pk) {
  return pk ? pk.slice(0, 8) + '…' : '?';
}

function shortTime (ts) {
  const m = String(ts || '').match(/T(\d{2}:\d{2})/);
  return m ? m[1] : '';
}

/** Persist a map of channel → recent message ids (content hashes are unordered). */
function loadIdMap (key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '{}') || {};
    const out = {};
    for (const [ch, ids] of Object.entries(raw)) {
      out[ch] = new Set(Array.isArray(ids) ? ids : []);
    }
    return out;
  } catch (_) {
    return {};
  }
}

function saveIdMap (key, map) {
  try {
    const raw = {};
    for (const [ch, set] of Object.entries(map)) {
      raw[ch] = Array.from(set).slice(-200);
    }
    localStorage.setItem(key, JSON.stringify(raw));
  } catch (_) { /* ignore */ }
}

function idSet (map, channel) {
  if (!map[channel]) map[channel] = new Set();
  return map[channel];
}

class GlobalChatDock extends React.Component {
  constructor (props) {
    super(props);
    let open = false;
    try { open = localStorage.getItem(LS_OPEN) === '1'; } catch (_) { /* ignore */ }
    this.state = {
      open,
      messages: [],
      draft: '',
      error: null,
      sending: false,
      loading: true,
      unread: 0,
      notifyPrefs: {
        notifyDesktop: true,
        notifyChatGlobal: true,
        notifyChatGroups: true,
        notifyWhenFocused: false
      },
      pendingFile: null
    };
    this._timer = null;
    this._msgsRef = React.createRef();
    this._fileRef = React.createRef();
    this._acked = loadIdMap(LS_ACKED);       // dock unread cursor
    this._notified = loadIdMap(LS_NOTIFIED); // OS notification cursor
    this._bootstrapped = false;
    this._focused = (typeof document !== 'undefined' && typeof document.hasFocus === 'function')
      ? document.hasFocus()
      : true;
    this._onFocus = () => { this._focused = true; };
    this._onBlur = () => { this._focused = false; };
  }

  componentDidMount () {
    window.addEventListener('focus', this._onFocus);
    window.addEventListener('blur', this._onBlur);
    this.tick();
    this._timer = setInterval(() => this.tick(), 3000);
  }

  componentWillUnmount () {
    if (this._timer) clearInterval(this._timer);
    window.removeEventListener('focus', this._onFocus);
    window.removeEventListener('blur', this._onBlur);
  }

  componentDidUpdate (prev) {
    if (!prev.hide && this.props.hide) this.acknowledgeGlobal();
  }

  acknowledgeGlobal () {
    const seen = idSet(this._acked, 'global');
    for (const m of this.state.messages) seen.add(m.id);
    saveIdMap(LS_ACKED, this._acked);
    this.setState({ unread: 0 }, () => {
      if (typeof this.props.onUnread === 'function') this.props.onUnread(0);
    });
  }

  setOpen (open) {
    try { localStorage.setItem(LS_OPEN, open ? '1' : '0'); } catch (_) { /* ignore */ }
    if (open) this.acknowledgeGlobal();
    this.setState({ open }, () => {
      if (open && this._msgsRef.current) {
        this._msgsRef.current.scrollTop = this._msgsRef.current.scrollHeight;
      }
    });
  }

  async loadPrefs () {
    try {
      const res = await fetch('/settings').then((r) => r.json());
      const s = res.settings || {};
      this.setState({
        notifyPrefs: {
          notifyDesktop: s.notifyDesktop !== false,
          notifyChatGlobal: s.notifyChatGlobal !== false,
          notifyChatGroups: s.notifyChatGroups !== false,
          notifyWhenFocused: !!s.notifyWhenFocused
        }
      });
    } catch (_) { /* keep defaults */ }
  }

  async tick () {
    await this.loadPrefs();
    await this.refreshGlobal();
    await this.watchNotifications();
  }

  async refreshGlobal () {
    try {
      const msgRes = await fetch(`${BASE}/chat/messages?channel=global&limit=80`).then((r) => r.json());
      const messages = msgRes.data || [];
      const el = this._msgsRef.current;
      const pinned = el && (el.scrollHeight - el.scrollTop - el.clientHeight < 60);
      const acked = idSet(this._acked, 'global');
      const me = this.props.identityPubkey;

      if (!this._bootstrapped || this.state.open || this.props.hide) {
        for (const m of messages) acked.add(m.id);
        saveIdMap(LS_ACKED, this._acked);
      }

      const unread = (this.state.open || this.props.hide)
        ? 0
        : messages.filter((m) => !acked.has(m.id) && !(me && m.author === me)).length;

      this.setState({ messages, loading: false, unread }, () => {
        if (pinned && this._msgsRef.current) this._msgsRef.current.scrollTop = this._msgsRef.current.scrollHeight;
      });
      if (typeof this.props.onUnread === 'function') this.props.onUnread(unread);
    } catch (_) {
      this.setState({ loading: false });
    }
  }

  async watchNotifications () {
    const prefs = this.state.notifyPrefs;
    const suppressOs = !prefs.notifyDesktop || (this._focused && !prefs.notifyWhenFocused);

    try {
      const chRes = await fetch(`${BASE}/chat/channels`).then((r) => r.json());
      const channels = (chRes.data || []).filter((ch) => {
        if (ch.kind === 'global') return prefs.notifyChatGlobal !== false;
        if (ch.kind === 'group') return prefs.notifyChatGroups !== false;
        return false;
      });

      for (const ch of channels) {
        const msgRes = await fetch(
          `${BASE}/chat/messages?channel=${encodeURIComponent(ch.key)}&limit=30`
        ).then((r) => r.json());
        const messages = msgRes.data || [];
        if (!messages.length) continue;
        const notified = idSet(this._notified, ch.key);
        if (!this._bootstrapped) {
          for (const m of messages) notified.add(m.id);
          continue;
        }
        const me = this.props.identityPubkey;
        const fresh = messages.filter((m) => !notified.has(m.id) && !(me && m.author === me));
        for (const m of messages) notified.add(m.id);

        const viewingGlobal = ch.key === 'global' && (this.state.open || this.props.hide);
        if (suppressOs || viewingGlobal || !fresh.length) continue;

        for (const m of fresh.slice(-3)) {
          const who = m.handle || shortKey(m.author);
          const label = ch.kind === 'global' ? 'Public shoutbox' : (ch.label || 'Group chat');
          const body = String(m.body || '').slice(0, 180);
          await showDesktopNotification({
            title: `${label} · ${who}`,
            body,
            onClick: () => {
              if (ch.kind === 'global') this.setOpen(true);
              else if (typeof window !== 'undefined') window.location.hash = 'chat';
            }
          });
        }
      }
      saveIdMap(LS_NOTIFIED, this._notified);
    } catch (_) { /* ignore */ }
    this._bootstrapped = true;
  }

  async send () {
    const body = this.state.draft.trim();
    const pending = this.state.pendingFile;
    if ((!body && !pending) || this.state.sending) return;
    this.setState({ sending: true, error: null });
    try {
      const price = Number(this.props.documentsDefaultPriceSats) || DEFAULT_CHAT_ATTACH_PRICE_SATS;
      const payload = {
        channel: 'global',
        body: body || (pending ? `📎 ${pending.name}` : '')
      };
      if (pending) {
        payload.file = {
          name: pending.name,
          mime: pending.mime,
          size: pending.size,
          contentBase64: pending.contentBase64
        };
        payload.purchasePriceSats = price;
      }
      const res = await fetch(`${BASE}/chat/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({ draft: '', sending: false, pendingFile: null });
      await this.refreshGlobal();
      if (this._msgsRef.current) this._msgsRef.current.scrollTop = this._msgsRef.current.scrollHeight;
    } catch (e) {
      this.setState({ sending: false, error: e.message });
    }
  }

  openFilePicker () {
    const el = this._fileRef.current;
    if (el) el.click();
  }

  onFilePicked (ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      const contentBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      this.setState({
        pendingFile: {
          name: file.name || 'attachment',
          mime: file.type || 'application/octet-stream',
          size: file.size,
          contentBase64
        },
        error: null
      });
    };
    reader.onerror = () => this.setState({ error: 'Failed to read file' });
    reader.readAsDataURL(file);
  }

  render () {
    if (this.props.hide) return null;
    const me = this.props.identityPubkey || null;

    if (!this.state.open) {
      return React.createElement('div', { className: 'gcdock' },
        React.createElement('button', {
          type: 'button',
          className: 'gcdock-toggle',
          onClick: () => this.setOpen(true)
        },
        React.createElement('span', null, '💬 Public shoutbox'),
        this.state.unread
          ? React.createElement('span', { className: 'badge' }, this.state.unread > 99 ? '99+' : this.state.unread)
          : null,
        React.createElement('span', { className: 'hint' }, 'open')
        )
      );
    }

    return React.createElement('div', { className: 'gcdock' },
      React.createElement('div', { className: 'gcdock-panel' },
        React.createElement('div', { className: 'gcdock-head' },
          React.createElement('span', null, '💬 Public shoutbox'),
          React.createElement('span', { className: 'sub' }, 'cleartext mesh · always on'),
          React.createElement('button', {
            type: 'button',
            title: 'Open full Chat (global + groups)',
            onClick: () => { window.location.hash = 'chat'; }
          }, 'Full'),
          React.createElement('button', {
            type: 'button',
            title: 'Minimize',
            onClick: () => this.setOpen(false)
          }, '–')
        ),
        React.createElement('div', { className: 'gcdock-msgs', ref: this._msgsRef },
          this.state.messages.length
            ? this.state.messages.map((m) => React.createElement('div', { className: 'gcdock-msg', key: m.id },
              React.createElement('div', { className: 'm' },
                React.createElement('span', {
                  className: 'who' + (me && m.author === me ? ' me' : ''),
                  title: m.author || undefined
                },
                m.handle || shortKey(m.author)),
                // Only show the muted key chip when a nickname is present —
                // otherwise who already is the short pubkey.
                (m.handle && String(m.handle).trim())
                  ? React.createElement('span', { className: 'key', title: m.author }, shortKey(m.author))
                  : null,
                React.createElement('span', { className: 't' }, shortTime(m.ts))
              ),
              React.createElement('div', { className: 'b' }, displayCaption(m)),
              (() => {
                const att = messageAttachment(m);
                if (!att) return null;
                const price = Number(att.purchasePriceSats || 0);
                return React.createElement('div', {
                  style: { fontSize: 11, color: 'var(--muted)', marginTop: 4 }
                }, `📎 ${att.name} · ${price > 0 ? `${price} sats` : 'free'}`);
              })()
            ))
            : React.createElement('div', { className: 'gcdock-empty' },
              this.state.loading ? 'loading…' : 'No messages yet — say hello.')
        ),
        this.state.error ? React.createElement('div', { className: 'gcdock-err' }, this.state.error) : null,
        this.state.pendingFile
          ? React.createElement('div', { className: 'gcdock-chip' },
            React.createElement('span', null, this.state.pendingFile.name),
            React.createElement('button', {
              type: 'button',
              onClick: () => this.setState({ pendingFile: null })
            }, 'remove')
          )
          : null,
        React.createElement('input', {
          ref: this._fileRef,
          type: 'file',
          style: { display: 'none' },
          onChange: (e) => this.onFilePicked(e)
        }),
        React.createElement('div', { className: 'gcdock-compose' },
          React.createElement('button', {
            type: 'button',
            className: 'gcdock-tool',
            title: 'Attach file',
            disabled: !me || this.state.sending,
            onClick: () => this.openFilePicker()
          }, '📎'),
          React.createElement('input', {
            type: 'text',
            value: this.state.draft,
            placeholder: me
              ? ('Message as ' + (this.props.nickname || shortKey(me)) + '…')
              : 'Unlock identity (Desktop / Passport) to chat…',
            onChange: (e) => this.setState({ draft: e.target.value }),
            onKeyDown: (e) => { if (e.key === 'Enter') this.send(); }
          }),
          React.createElement('button', {
            className: 'gcdock-send',
            disabled: (!this.state.draft.trim() && !this.state.pendingFile) || this.state.sending,
            onClick: () => this.send()
          }, this.state.sending ? '…' : 'Send')
        )
      )
    );
  }
}

GlobalChatDock.CSS = CSS;

module.exports = GlobalChatDock;
