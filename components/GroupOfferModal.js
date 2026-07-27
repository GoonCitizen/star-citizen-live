'use strict';

/**
 * Modal for opaque fabric:<hex> GroupOffer / FederationContractInvite paste-open.
 */

const React = require('react');

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
  border-radius: 8px; max-width: 440px; width: 100%; padding: 20px 22px;
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
`;

class GroupOfferModal extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      prompt: null,
      busy: false,
      error: null,
      notice: null
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
  }

  componentWillUnmount () {
    if (this._unsub) this._unsub();
    if (typeof window !== 'undefined') {
      window.removeEventListener('gooncitizen:group-offer', this._onDomOffer);
    }
  }

  _onDomOffer = (ev) => {
    if (ev && ev.detail) this.setState({ prompt: ev.detail, error: null, notice: null });
  };

  headers () {
    const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
    try {
      const t = window.localStorage && window.localStorage.getItem('sc_delegation_token');
      if (t) h.Authorization = 'Bearer ' + t;
    } catch (_) { /* ignore */ }
    return h;
  }

  async dismiss () {
    this.setState({ prompt: null, error: null, notice: null, busy: false });
    if (window.electronAPI && window.electronAPI.groupShare) {
      try { await window.electronAPI.groupShare.resolve({ dismiss: true }); } catch (_) { /* ignore */ }
    }
  }

  async accept () {
    const p = this.state.prompt;
    if (!p || this.state.busy) return;
    this.setState({ busy: true, error: null });
    try {
      if (p.protocolUrl || p.messageHex) {
        const res = await fetch(`${BASE}/groups/share/ingest`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ protocolUrl: p.protocolUrl || null, messageHex: p.messageHex || null })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        const data = json.data || {};
        if (data.kind === 'GroupOffer' && data.group && data.group.visibility === 'public') {
          const apply = await fetch(`${BASE}/groups/${encodeURIComponent(data.group.id)}/applications`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({ message: 'Applied via Fabric GroupOffer' })
          });
          const aj = await apply.json();
          if (!apply.ok) throw new Error(aj.error || `HTTP ${apply.status}`);
          this.setState({ busy: false, notice: 'Application submitted.', prompt: null });
        } else if (data.kind === 'FederationContractInvite' && data.invite) {
          const inv = data.invite;
          const groupKey = (data.group && data.group.id) || inv.contractId;
          if (groupKey && inv.inviteId) {
            const r = await fetch(`${BASE}/groups/${encodeURIComponent(groupKey)}/invites/${encodeURIComponent(inv.inviteId)}/accept`, {
              method: 'POST',
              headers: this.headers(),
              body: '{}'
            });
            const rj = await r.json();
            if (!r.ok) throw new Error(rj.error || `HTTP ${r.status}`);
          }
          this.setState({ busy: false, notice: 'Invite accepted.', prompt: null });
        } else {
          this.setState({
            busy: false,
            notice: data.group ? `Group “${data.group.name || data.group.id}” imported.` : 'Share ingested.',
            prompt: null
          });
        }
      }
      if (window.electronAPI && window.electronAPI.groupShare) {
        try { await window.electronAPI.groupShare.resolve({ approve: true }); } catch (_) { /* ignore */ }
      }
    } catch (e) {
      this.setState({ busy: false, error: e.message || String(e) });
    }
  }

  render () {
    const p = this.state.prompt;
    if (!p && !this.state.notice) return null;
    if (!p && this.state.notice) {
      return React.createElement('div', { className: 'group-offer-modal-backdrop', onClick: () => this.setState({ notice: null }) },
        React.createElement('div', { className: 'group-offer-modal', onClick: (e) => e.stopPropagation() },
          React.createElement('p', null, this.state.notice),
          React.createElement('div', { className: 'actions' },
            React.createElement('button', { type: 'button', onClick: () => this.setState({ notice: null }) }, 'OK')
          )
        )
      );
    }
    const title = p.kind === 'FederationContractInvite' ? 'Federation invite' : 'Group share';
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
          }, this.state.busy ? 'Working…' : (p.kind === 'FederationContractInvite' ? 'Accept invite' : 'Accept / Apply'))
        )
      )
    );
  }
}

GroupOfferModal.CSS = CSS;
module.exports = GroupOfferModal;
