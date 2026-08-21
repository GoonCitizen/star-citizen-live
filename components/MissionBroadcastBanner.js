'use strict';

/**
 * Pending peer mission broadcasts — in-app Accept / Ignore plus desktop
 * notifications (Electron actions on macOS when available).
 */

const React = require('react');
const { showDesktopNotification } = require('../functions/desktopNotify');
const {
  shouldDesktopToast,
  desktopNotifyMeta
} = require('../functions/desktopInboxKinds');

const BASE = '/services/star-citizen';
const LS_SEEN = 'gc.missionBroadcast.seen';
const LS_INBOX_SEEN = 'gc.inboxNotify.seen';

const CSS = `
  .mbb-stack{position:fixed;left:16px;bottom:var(--chrome-inset,16px);z-index:32;display:flex;flex-direction:column;gap:10px;
    width:min(400px,calc(100vw - 28px));pointer-events:none}
  .mbb-stack.raised{bottom:calc(var(--chrome-inset,16px) + 88px)}
  .mbb-card{pointer-events:auto;background:var(--panel);border:1px solid var(--line);border-radius:12px;
    box-shadow:0 12px 40px rgba(0,0,0,.45);padding:12px 14px;display:grid;gap:8px}
  .mbb-card h4{margin:0;font-size:13px;font-weight:650}
  .mbb-card .sub{color:var(--muted);font-size:12px;line-height:1.45}
  .mbb-card .meta{font-family:'Cascadia Code',Consolas,monospace;font-size:10.5px;color:var(--muted);word-break:break-all}
  .mbb-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .mbb-btn{background:var(--accent);border:none;color:#fff;border-radius:7px;padding:7px 14px;
    font-size:12.5px;font-weight:600;cursor:pointer}
  .mbb-btn:disabled{opacity:.45;cursor:default}
  .mbb-btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
  .mbb-btn.good{background:var(--good)}
  .mbb-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:6px 9px;font-size:12px}
`;

function loadSeen () {
  try {
    return new Set(JSON.parse(localStorage.getItem(LS_SEEN) || '[]'));
  } catch (_) {
    return new Set();
  }
}

function saveSeen (set) {
  try { localStorage.setItem(LS_SEEN, JSON.stringify(Array.from(set).slice(-100))); } catch (_) { /* ignore */ }
}

function loadInboxSeen () {
  try {
    return new Set(JSON.parse(localStorage.getItem(LS_INBOX_SEEN) || '[]'));
  } catch (_) {
    return new Set();
  }
}

function saveInboxSeen (set) {
  try { localStorage.setItem(LS_INBOX_SEEN, JSON.stringify(Array.from(set).slice(-200))); } catch (_) { /* ignore */ }
}

function shortKey (pk) {
  return pk ? pk.slice(0, 8) + '…' : '?';
}

function identityBridge () {
  return (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.identity) || null;
}

class MissionBroadcastBanner extends React.Component {
  constructor (props) {
    super(props);
    this.state = { pending: [], busyId: null, error: null, token: null };
    this._timer = null;
    this._seen = loadSeen();
    this._inboxSeen = loadInboxSeen();
    this._bootstrapped = false;
    this._unsubAction = null;
  }

  componentDidMount () {
    this.ensureSession().then(() => this.tick());
    this._timer = setInterval(() => this.tick(), 4000);
    if (window.electronAPI && typeof window.electronAPI.onNotifyAction === 'function') {
      this._unsubAction = window.electronAPI.onNotifyAction((data) => {
        if (!data) return;
        if (data.kind === 'missionbroadcast') {
          if (data.action === 'accept' || data.index === 0) this.accept(data.id);
          else if (data.action === 'ignore' || data.index === 1) this.ignore(data.id);
          return;
        }
        if (data.kind === 'federationinvite' || data.kind === 'groupoffer') {
          if (typeof window !== 'undefined') window.location.hash = 'notifications';
        }
      });
    }
    if (window.electronAPI && typeof window.electronAPI.onNotifyClick === 'function') {
      this._unsubClick = window.electronAPI.onNotifyClick((data) => {
        if (!data || typeof window === 'undefined') return;
        if (data.kind === 'missionbroadcast' || data.kind === 'federationinvite' || data.kind === 'groupoffer') {
          window.location.hash = 'notifications';
        }
      });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('gooncitizen:inbox', this._onInbox);
      window.addEventListener('gooncitizen:group-imported', this._onInbox);
    }
  }

  _onInbox = () => {
    this.tick();
  };

  componentWillUnmount () {
    if (this._timer) clearInterval(this._timer);
    if (this._unsubAction) this._unsubAction();
    if (this._unsubClick) this._unsubClick();
    if (typeof window !== 'undefined') {
      window.removeEventListener('gooncitizen:inbox', this._onInbox);
      window.removeEventListener('gooncitizen:group-imported', this._onInbox);
    }
  }

  headers () {
    const h = { 'Content-Type': 'application/json' };
    if (this.state.token) h.Authorization = `Bearer ${this.state.token}`;
    return h;
  }

  async ensureSession () {
    const b = identityBridge();
    if (!b) return;
    try {
      const info = await b.get();
      if (!info || !info.unlocked || !b.signEnvelope) return;
      const envelope = await b.signEnvelope({ intent: 'login', ts: new Date().toISOString() });
      if (!envelope || envelope.error) return;
      const res = await fetch(`${BASE}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope)
      });
      if (!res.ok) return;
      const json = await res.json();
      this.setState({ token: json.data.token });
    } catch (_) { /* locked */ }
  }

  reportPending (n) {
    if (typeof this.props.onPendingCount === 'function') this.props.onPendingCount(n);
  }

  async tick () {
    try {
      const [res, inboxRes, settingsRes] = await Promise.all([
        fetch(`${BASE}/missionbroadcasts?pending=1`).then((r) => r.json()),
        fetch(`${BASE}/inbox?scope=notifications&pending=1`).then((r) => r.json()).catch(() => null),
        fetch('/settings').then((r) => (r.ok ? r.json() : null)).catch(() => null)
      ]);
      const pending = res.data || [];
      // Mission broadcasts keep their dedicated toggle; group invites/offers
      // only need desktop notifications enabled (spoke invites are easy to miss).
      const missionNotify = res.notify !== false;
      const settings = (settingsRes && settingsRes.settings) || settingsRes || {};
      const desktopNotify = settings.notifyDesktop !== false;
      const inboxItems = (inboxRes && inboxRes.data) || [];
      this.setState({ pending });
      // Bell badge uses the full register inbox (broadcasts + apps + invites).
      const inboxPending = typeof (inboxRes && inboxRes.pending) === 'number'
        ? inboxRes.pending
        : inboxItems.filter((i) => i.actionable).length || pending.length;
      this.reportPending(inboxPending);

      const freshCutoff = Date.now() - (5 * 60 * 1000);
      const isFreshInbox = (row) => {
        const t = Date.parse(row && row.ts);
        return Number.isFinite(t) && t >= freshCutoff;
      };

      if (!this._bootstrapped) {
        for (const b of pending) this._seen.add(b.id);
        // Still toast brand-new invites that arrived while the app was starting
        // (bootstrap would otherwise swallow them forever).
        for (const row of inboxItems) {
          if (shouldDesktopToast(row) && isFreshInbox(row)) {
            continue; // leave unseen for the notify loop below
          }
          this._inboxSeen.add(row.id);
        }
        saveSeen(this._seen);
        saveInboxSeen(this._inboxSeen);
        this._bootstrapped = true;
        // Fall through so fresh invites can notify on first tick.
      }

      if (missionNotify) {
        for (const b of pending) {
          if (this._seen.has(b.id)) continue;
          this._seen.add(b.id);
          const m = b.mission || {};
          const who = b.handle || shortKey(b.source);
          const reward = m.reward ? ` · ${Number(m.reward).toLocaleString()} sats` : '';
          await showDesktopNotification({
            id: b.id,
            kind: 'missionbroadcast',
            title: 'Mission broadcast',
            body: `${who}: ${m.title || 'Untitled'}${reward}`,
            actions: [
              { id: 'accept', text: 'Join' },
              { id: 'ignore', text: 'Ignore' }
            ],
            onClick: () => {
              if (typeof window !== 'undefined') window.location.hash = 'notifications';
            }
          });
        }
        saveSeen(this._seen);
      } else {
        for (const b of pending) this._seen.add(b.id);
        saveSeen(this._seen);
      }

      if (!desktopNotify) {
        for (const row of inboxItems) this._inboxSeen.add(row.id);
        saveInboxSeen(this._inboxSeen);
        return;
      }

      for (const row of inboxItems) {
        if (!shouldDesktopToast(row)) continue;
        if (this._inboxSeen.has(row.id)) continue;
        this._inboxSeen.add(row.id);
        const who = row.handle || shortKey(row.source);
        const meta = desktopNotifyMeta(row.kind);
        const isClaim = row.kind === 'MissionClaim' || row.kind === 'MissionClaimDecision';
        const isWallet = String(row.kind || '').indexOf('Wallet') === 0;
        await showDesktopNotification({
          id: row.id,
          kind: meta.notifyKind,
          title: meta.title,
          body: `${who}: ${row.title || meta.title}`,
          actions: [
            { id: 'open', text: 'Open' }
          ],
          onClick: () => {
            if (typeof window === 'undefined') return;
            if (isClaim && row.refs && row.refs.missionId) {
              window.location.href = `/missions/${encodeURIComponent(row.refs.missionId)}`;
            } else if (isWallet && row.refs && row.refs.missionId) {
              window.location.hash = 'wallet';
            } else if ((row.kind === 'GroupChangeProposal' || row.kind === 'MultisigWalletInvite' ||
                row.kind === 'FederationInvite' || row.kind === 'FederationInviteDecision' ||
                row.kind === 'GroupApplication' || row.kind === 'GroupApplicationDecision' ||
                row.kind === 'WalletWithdrawal') &&
                row.refs && row.refs.groupId) {
              window.location.href = `/groups/${encodeURIComponent(row.refs.groupId)}`;
            } else if (isWallet) {
              window.location.hash = 'wallet';
            } else {
              window.location.hash = 'notifications';
            }
          }
        });
      }
      saveInboxSeen(this._inboxSeen);
    } catch (_) { /* offline */ }
  }

  async accept (id) {
    if (this.state.busyId) return;
    this.setState({ busyId: id, error: null });
    try {
      if (!this.state.token) await this.ensureSession();
      const res = await fetch(`${BASE}/missionbroadcasts/${encodeURIComponent(id)}/accept`, {
        method: 'POST',
        headers: this.headers(),
        body: '{}'
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({ busyId: null });
      if (typeof window !== 'undefined') window.location.hash = 'missions';
      if (typeof this.props.onResolved === 'function') this.props.onResolved('accepted', json.data);
      await this.tick();
    } catch (e) {
      this.setState({ busyId: null, error: e.message });
    }
  }

  async ignore (id) {
    if (this.state.busyId) return;
    this.setState({ busyId: id, error: null });
    try {
      if (!this.state.token) await this.ensureSession();
      const res = await fetch(`${BASE}/missionbroadcasts/${encodeURIComponent(id)}/ignore`, {
        method: 'POST',
        headers: this.headers(),
        body: '{}'
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({ busyId: null });
      if (typeof this.props.onResolved === 'function') this.props.onResolved('ignored', json.data);
      await this.tick();
    } catch (e) {
      this.setState({ busyId: null, error: e.message });
    }
  }

  render () {
    if (this.props.hide) return null;
    const cards = this.state.pending.slice(0, 3);
    if (!cards.length && !this.state.error) return null;

    return React.createElement('div', { className: 'mbb-stack' + (this.props.raised ? ' raised' : '') },
      this.state.error ? React.createElement('div', { className: 'mbb-card' },
        React.createElement('div', { className: 'mbb-err' }, this.state.error)
      ) : null,
      cards.map((b) => {
        const m = b.mission || {};
        return React.createElement('div', { className: 'mbb-card', key: b.id },
          React.createElement('h4', null, '📡 Mission offer'),
          React.createElement('div', { className: 'sub' },
            React.createElement('b', null, m.title || 'Untitled'),
            m.reward ? ` · ${Number(m.reward).toLocaleString()} sats` : '',
            m.description ? React.createElement('div', null, String(m.description).slice(0, 140)) : null
          ),
          React.createElement('div', { className: 'meta' },
            (b.handle || shortKey(b.source)) + ' · ' + shortKey(b.source) +
            (m.createdBy && m.createdBy !== b.source ? ' · creator ' + shortKey(m.createdBy) : '')
          ),
          React.createElement('div', { className: 'mbb-row' },
            React.createElement('button', {
              className: 'mbb-btn good',
              disabled: this.state.busyId === b.id,
              onClick: () => this.accept(b.id)
            }, this.state.busyId === b.id ? '…' : 'Join mission'),
            React.createElement('button', {
              className: 'mbb-btn ghost',
              disabled: this.state.busyId === b.id,
              onClick: () => this.ignore(b.id)
            }, 'Ignore'),
            React.createElement('button', {
              className: 'mbb-btn ghost',
              onClick: () => {
                if (m.id) window.location.href = `/missions/${encodeURIComponent(m.id)}`;
                else window.location.hash = 'missions';
              }
            }, 'View')
          )
        );
      })
    );
  }
}

MissionBroadcastBanner.CSS = CSS;

module.exports = MissionBroadcastBanner;
