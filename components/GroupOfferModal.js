'use strict';

/**
 * Modal for opaque fabric:<hex> GroupOffer / FederationContractInvite —
 * desktop protocol prompts and manual paste Import….
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
      pubkey: null
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
      this.setState({ pasteText: '', error: null, notice: null });
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
    this.setState({ pasteText: '', error: null });
  }

  async dismiss () {
    this.setState({ prompt: null, error: null, notice: null, busy: false });
    if (window.electronAPI && window.electronAPI.groupShare) {
      try { await window.electronAPI.groupShare.resolve({ dismiss: true }); } catch (_) { /* ignore */ }
    }
  }

  async ingestEncoded (raw) {
    await this.ensureSession();
    const text = String(raw || '').trim();
    if (!text) throw new Error('Paste a fabric: hex or base64 message');
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
        return `Applied to “${data.group.name || data.group.id}”.`;
      }
      return `Group “${data.group.name || data.group.id}” imported (private — membership requires an invite).`;
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
        ? `Joined “${g.name || g.id}”.`
        : 'Invite accepted — you are a local member.';
    }

    if (data.kind === 'GroupPublish' && data.group) {
      return `Group “${data.group.name || data.group.id}” imported.`;
    }
    if (data.group) return `Group “${data.group.name || data.group.id}” imported.`;
    return 'Fabric message ingested.';
  }

  async accept () {
    const p = this.state.prompt;
    if (!p || this.state.busy) return;
    this.setState({ busy: true, error: null });
    try {
      if (p.protocolUrl || p.messageHex) {
        const data = await this.ingestEncoded(p.protocolUrl || p.messageHex);
        const notice = await this.handleIngestResult(data);
        this.setState({ busy: false, notice, prompt: null });
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
      const data = await this.ingestEncoded(this.state.pasteText);
      const notice = await this.handleIngestResult(data);
      this.setState({ busy: false, notice, pasteText: '' });
      if (typeof this.props.onPasteClose === 'function') this.props.onPasteClose();
      if (typeof this.props.onImported === 'function') this.props.onImported(data);
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
        React.createElement('h2', null, 'Import Fabric message'),
        React.createElement('p', null,
          'Paste an encoded Fabric message (',
          React.createElement('code', null, 'fabric:<hex>'),
          ' or ',
          React.createElement('code', null, 'fabric:base64,…'),
          '). Public group offers apply with your publishing identity; federation invites join locally.'),
        React.createElement('textarea', {
          value: this.state.pasteText,
          placeholder: 'fabric:<hex> or fabric:base64,…',
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

  render () {
    if (this.props.pasteOpen && !this.state.prompt) {
      return this.renderPaste();
    }

    const p = this.state.prompt;
    if (!p && !this.state.notice) return null;
    if (!p && this.state.notice) {
      return React.createElement('div', {
        className: 'group-offer-modal-backdrop',
        onClick: () => this.setState({ notice: null })
      },
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
