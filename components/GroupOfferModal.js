'use strict';

/**
 * Modal for opaque fabric: GroupOffer / FederationContractInvite —
 * desktop protocol prompts and manual paste Import….
 */

const React = require('react');
const {
  dispatchGroupImported,
  dispatchInboxRefresh
} = require('../functions/groupJoinFlow');

const BASE = '/services/star-citizen';

const CSS = `
.group-offer-modal-backdrop {
  position: fixed; inset: 0; z-index: 10050;
  background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.group-offer-modal {
  background: #1a1f2a; color: #e8ecf4; border: 1px solid #3a4558;
  border-radius: 8px; max-width: 480px; width: 100%; padding: 20px 22px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.45);
  font-family: system-ui, sans-serif;
}
.group-offer-modal h2 { margin: 0 0 8px; font-size: 1.15rem; }
.group-offer-modal p { margin: 0 0 10px; font-size: 0.92rem; color: #b8c0d0; line-height: 1.45; }
.group-offer-modal .meta { font-size: 0.8rem; color: #8a94a8; word-break: break-all; margin-bottom: 14px; }
.group-offer-modal .actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.group-offer-modal button {
  cursor: pointer; border-radius: 4px; border: 1px solid #4a5568;
  background: #2a3344; color: #e8ecf4; padding: 8px 14px; font-size: 0.9rem;
}
.group-offer-modal button.primary { background: #3d6ea5; border-color: #4a7eb8; }
.group-offer-modal button:disabled { opacity: 0.5; cursor: default; }
.group-offer-modal .err { color: #f08080; font-size: 0.85rem; margin-bottom: 10px; }
.group-offer-modal textarea {
  width: 100%; min-height: 110px; box-sizing: border-box;
  background: #0e1218; color: #e8ecf4; border: 1px solid #3a4558;
  border-radius: 6px; padding: 10px 12px; font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  resize: vertical; margin: 0 0 12px;
}
.group-offer-modal textarea:focus { outline: none; border-color: #4a7eb8; }
`;

function identityBridge () {
  return (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.identity) || null;
}

class GroupOfferModal extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      prompt: null,
      busy: false,
      error: null,
      notice: null,
      pasteText: '',
      token: null,
      pubkey: null,
      lastImport: null,
      pendingJoin: null
    };
    this._unsub = null;
  }

  componentDidMount () {
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.groupShare) {
      this._unsub = window.electronAPI.groupShare.onPrompt((payload) => {
        this.setState({ prompt: payload, error: null, notice: null });
      });
      window.electronAPI.groupShare.pullPending().then((p) => {
        if (p) this.setState({ prompt: p });
      }).catch(() => {});
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('gooncitizen:group-offer', this._onDomOffer);
    }
    this.ensureSession().catch(() => {});
  }

  componentWillUnmount () {
    if (this._unsub) this._unsub();
    if (typeof window !== 'undefined') {
      window.removeEventListener('gooncitizen:group-offer', this._onDomOffer);
    }
  }

  componentDidUpdate (prevProps) {
    if (this.props.pasteOpen && !prevProps.pasteOpen) {
      this.setState({ pasteText: '', error: null, notice: null, pendingJoin: null });
      this.ensureSession().catch(() => {});
    }
  }

  _onDomOffer = (ev) => {
    if (ev && ev.detail) this.setState({ prompt: ev.detail, error: null, notice: null });
  };

  /**
   * Schnorr session via Electron identity bridge (same as Groups tab).
   * Falls back to fabric.delegation SiteLogin token when present.
   */
  async ensureSession () {
    const bridge = identityBridge();
    if (bridge) {
      try {
        const info = await bridge.get();
        if (info && info.unlocked) {
          const envelope = await bridge.signEnvelope({ intent: 'login', ts: new Date().toISOString() });
          if (envelope && !envelope.error) {
            const res = await fetch(`${BASE}/auth`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(envelope)
            });
            if (res.ok) {
              const json = await res.json();
              const token = json.data && json.data.token;
              const pubkey = json.data && json.data.pubkey;
              this.setState({ token, pubkey });
              return { token, pubkey };
            }
          }
        }
      } catch (_) { /* fall through */ }
    }
    try {
      const raw = window.localStorage && window.localStorage.getItem('fabric.delegation');
      if (raw) {
        const parsed = JSON.parse(raw);
        const token = parsed && (parsed.token || parsed.delegationToken);
        if (token) {
          this.setState({ token, pubkey: (parsed && parsed.pubkey) || this.state.pubkey });
          return { token, pubkey: parsed.pubkey || null };
        }
      }
    } catch (_) { /* ignore */ }
    return { token: this.state.token, pubkey: this.state.pubkey };
  }

  headers () {
    const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.state.token) h.Authorization = 'Bearer ' + this.state.token;
    return h;
  }

  closePaste () {
    if (typeof this.props.onPasteClose === 'function') this.props.onPasteClose();
    this.setState({ pasteText: '', error: null, pendingJoin: null });
  }

  async dismiss () {
    this.setState({ prompt: null, error: null, notice: null, busy: false, pendingJoin: null });
    if (window.electronAPI && window.electronAPI.groupShare) {
      try { await window.electronAPI.groupShare.resolve({ dismiss: true }); } catch (_) { /* ignore */ }
    }
  }

  async ingestEncoded (raw) {
    await this.ensureSession();
    const text = String(raw || '').trim();
    if (!text) throw new Error('Paste a fabric: message');
    const cleaned = text.replace(/\s+/g, '');
    let body;
    if (/^fabric:/i.test(text)) {
      body = { protocolUrl: text };
    } else if (/^[0-9a-fA-F]+$/.test(cleaned) && cleaned.length % 2 === 0) {
      body = { messageHex: cleaned };
    } else {
      body = { messageBase64: cleaned };
    }
    const res = await fetch(`${BASE}/groups/share/ingest`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json.data || {};
  }

  afterIngest (data) {
    dispatchInboxRefresh(data);
    dispatchGroupImported(data);
    return data;
  }

  async handleIngestResult (data) {
    await this.ensureSession();
    const applicantId = this.state.pubkey || undefined;

    if (data.kind === 'GroupOffer' && data.group) {
      if (data.group.visibility === 'public') {
        const apply = await fetch(`${BASE}/groups/${encodeURIComponent(data.group.id)}/applications`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({
            message: 'Applied via Fabric GroupOffer',
            applicantId
          })
        });
        const aj = await apply.json();
        if (!apply.ok) throw new Error(aj.error || `HTTP ${apply.status}`);
        return `Applied to “${data.group.name || data.group.id}”. The creator will get a notification to accept.`;
      }
      return `“${data.group.name || data.group.id}” is private — ask them to Share a join invite, then paste it here and Accept.`;
    }

    if (data.kind === 'FederationContractInvite' && data.invite) {
      const inv = data.invite;
      const groupKey = (data.group && data.group.id) || inv.contractId;
      if (!groupKey || !inv.inviteId) {
        throw new Error('Invite ingested but group id is missing — try again after FABRIC_XPRV identity is loaded');
      }
      const r = await fetch(`${BASE}/groups/${encodeURIComponent(groupKey)}/invites/${encodeURIComponent(inv.inviteId)}/accept`, {
        method: 'POST',
        headers: this.headers(),
        body: '{}'
      });
      const rj = await r.json();
      if (!r.ok) throw new Error(rj.error || `HTTP ${r.status}`);
      const g = (rj.data && rj.data.group) || data.group;
      return g
        ? `Joined “${g.name || g.id}”. Open Groups to chat and manage.`
        : 'Invite accepted — you are a member.';
    }

    if (data.kind === 'GroupPublish' && data.group) {
      return `Group “${data.group.name || data.group.id}” imported.`;
    }
    if (data.group) return `Group “${data.group.name || data.group.id}” imported.`;
    return 'Fabric message ingested.';
  }

  finishImport (data, notice) {
    dispatchGroupImported(data);
    dispatchInboxRefresh(data);
    if (typeof this.props.onImported === 'function') this.props.onImported(data);
    this.setState({
      busy: false,
      notice,
      prompt: null,
      pasteText: '',
      pendingJoin: null,
      lastImport: data || null
    });
    if (typeof this.props.onPasteClose === 'function') this.props.onPasteClose();
  }

  async accept () {
    const p = this.state.prompt;
    if (!p || this.state.busy) return;
    this.setState({ busy: true, error: null });
    try {
      if (p.protocolUrl || p.messageHex) {
        const data = this.afterIngest(await this.ingestEncoded(p.protocolUrl || p.messageHex));
        const notice = await this.handleIngestResult(data);
        this.finishImport(data, notice);
      }
      if (window.electronAPI && window.electronAPI.groupShare) {
        try { await window.electronAPI.groupShare.resolve({ approve: true }); } catch (_) { /* ignore */ }
      }
    } catch (e) {
      this.setState({ busy: false, error: e.message || String(e) });
    }
  }

  async submitPaste () {
    if (this.state.busy) return;
    this.setState({ busy: true, error: null });
    try {
      const data = this.afterIngest(await this.ingestEncoded(this.state.pasteText));
      if (data.kind === 'GroupPublish' && data.group) {
        this.finishImport(data, `Group “${data.group.name || data.group.id}” imported.`);
        return;
      }
      if (data.kind === 'FederationContractInvite' && data.skipped) {
        throw new Error(
          data.skipped === 'identity-locked'
            ? 'Unlock your identity, then import this invite again.'
            : 'This invite is not for this identity.'
        );
      }
      if (!data.group && !(data.invite && data.invite.inviteId)) {
        throw new Error('That Fabric message did not include a group you can join.');
      }
      this.setState({
        busy: false,
        pendingJoin: data,
        pasteText: '',
        error: null
      });
    } catch (e) {
      this.setState({ busy: false, error: e.message || String(e) });
    }
  }

  renderPaste () {
    return React.createElement('div', {
      className: 'group-offer-modal-backdrop',
      onClick: (e) => { if (e.target === e.currentTarget && !this.state.busy) this.closePaste(); }
    },
      React.createElement('div', { className: 'group-offer-modal', onClick: (e) => e.stopPropagation() },
        React.createElement('h2', null, 'Join a group'),
        React.createElement('p', null,
          'Paste the invite someone shared (',
          React.createElement('code', null, 'fabric:…'),
          '). Import sniffs hex vs base64 from the body, then Join or Apply from Notifications.'),
        React.createElement('textarea', {
          value: this.state.pasteText,
          placeholder: 'fabric:… join invite or group share',
          spellCheck: false,
          autoFocus: true,
          onChange: (e) => this.setState({ pasteText: e.target.value }),
          onKeyDown: (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') this.submitPaste();
          }
        }),
        this.state.error ? React.createElement('div', { className: 'err' }, this.state.error) : null,
        React.createElement('div', { className: 'actions' },
          React.createElement('button', {
            type: 'button', disabled: this.state.busy, onClick: () => this.closePaste()
          }, 'Cancel'),
          React.createElement('button', {
            type: 'button',
            className: 'primary',
            disabled: this.state.busy || !String(this.state.pasteText || '').trim(),
            onClick: () => this.submitPaste()
          }, this.state.busy ? 'Importing…' : 'Import')
        )
      )
    );
  }

  pendingJoinLabel (data) {
    if (!data) return 'Group';
    return (data.group && (data.group.name || data.group.id)) ||
      (data.invite && data.invite.groupName) ||
      data.groupId ||
      'Group';
  }

  async confirmPendingJoin () {
    const data = this.state.pendingJoin;
    if (!data || this.state.busy) return;
    this.setState({ busy: true, error: null });
    try {
      const notice = await this.handleIngestResult(data);
      this.finishImport(data, notice);
    } catch (e) {
      this.setState({ busy: false, error: e.message || String(e) });
    }
  }

  viewPendingNotifications () {
    const data = this.state.pendingJoin;
    dispatchInboxRefresh(data);
    dispatchGroupImported(data);
    this.setState({ pendingJoin: null, pasteText: '', error: null });
    if (typeof this.props.onPasteClose === 'function') this.props.onPasteClose();
    if (typeof window !== 'undefined') {
      try {
        const { setAppHash } = require('../functions/appHash');
        setAppHash('notifications');
      } catch (_) {
        window.location.hash = 'notifications';
      }
    }
  }

  renderPendingJoin () {
    const data = this.state.pendingJoin || {};
    const name = this.pendingJoinLabel(data);
    const isInvite = data.kind === 'FederationContractInvite';
    const isPrivateOffer = data.kind === 'GroupOffer' && data.group && data.group.visibility === 'private';
    const canJoin = isInvite || (data.kind === 'GroupOffer' && !isPrivateOffer);
    const body = isInvite
      ? `“${name}” is in Notifications. Join now, or Accept from the bell.`
      : (isPrivateOffer
        ? `“${name}” is private — ask them to Share a join invite.`
        : `“${name}” is in Notifications. Apply to join, or do it later from the bell.`);
    return React.createElement('div', {
      className: 'group-offer-modal-backdrop',
      onClick: (e) => { if (e.target === e.currentTarget && !this.state.busy) this.closePaste(); }
    },
      React.createElement('div', { className: 'group-offer-modal', onClick: (e) => e.stopPropagation() },
        React.createElement('h2', null, isInvite ? 'Group invite' : 'Group share'),
        React.createElement('p', null, body),
        this.state.error ? React.createElement('div', { className: 'err' }, this.state.error) : null,
        React.createElement('div', { className: 'actions' },
          React.createElement('button', {
            type: 'button', disabled: this.state.busy, onClick: () => this.closePaste()
          }, 'Later'),
          React.createElement('button', {
            type: 'button', disabled: this.state.busy, onClick: () => this.viewPendingNotifications()
          }, 'View notifications'),
          canJoin
            ? React.createElement('button', {
              type: 'button',
              className: 'primary',
              disabled: this.state.busy,
              onClick: () => this.confirmPendingJoin()
            }, this.state.busy ? 'Working…' : (isInvite ? 'Join group' : 'Apply to join'))
            : null
        )
      )
    );
  }

  closeNotice () {
    const data = this.state.lastImport;
    this.setState({ notice: null, lastImport: null });
    const id = data && data.group && (data.group.id || data.groupId);
    const fallback = data && data.invite && (data.invite.groupId || data.groupId);
    const groupId = id || fallback;
    if (groupId && typeof window !== 'undefined') {
      window.location.hash = 'groups?id=' + encodeURIComponent(groupId);
    }
  }

  render () {
    if (this.state.notice && !this.state.prompt) {
      return React.createElement('div', {
        className: 'group-offer-modal-backdrop',
        onClick: () => this.closeNotice()
      },
        React.createElement('div', { className: 'group-offer-modal', onClick: (e) => e.stopPropagation() },
          React.createElement('p', null, this.state.notice),
          React.createElement('div', { className: 'actions' },
            React.createElement('button', { type: 'button', onClick: () => this.closeNotice() }, 'Open group')
          )
        )
      );
    }

    if (this.state.pendingJoin) {
      return this.renderPendingJoin();
    }

    if (this.props.pasteOpen && !this.state.prompt) {
      return this.renderPaste();
    }

    const p = this.state.prompt;
    if (!p) return null;
    const title = p.kind === 'FederationContractInvite' ? 'Group invite' : 'Group share';
    const name = (p.group && p.group.name) || (p.offer && p.offer.meta && p.offer.meta.name) || p.groupId || 'Group';
    const note = (p.offer && p.offer.note) || (p.invite && p.invite.note) || null;
    return React.createElement('div', { className: 'group-offer-modal-backdrop' },
      React.createElement('div', { className: 'group-offer-modal' },
        React.createElement('h2', null, title),
        React.createElement('p', null, name),
        note ? React.createElement('p', null, note) : null,
        p.contractId ? React.createElement('div', { className: 'meta' }, 'contract ', p.contractId.slice(0, 16), '…') : null,
        this.state.error ? React.createElement('div', { className: 'err' }, this.state.error) : null,
        React.createElement('div', { className: 'actions' },
          React.createElement('button', { type: 'button', disabled: this.state.busy, onClick: () => this.dismiss() }, 'Ignore'),
          React.createElement('button', {
            type: 'button',
            className: 'primary',
            disabled: this.state.busy,
            onClick: () => this.accept()
          }, this.state.busy ? 'Working…' : (p.kind === 'FederationContractInvite' ? 'Join group' : 'Apply to join'))
        )
      )
    );
  }
}

GroupOfferModal.CSS = CSS;
module.exports = GroupOfferModal;
