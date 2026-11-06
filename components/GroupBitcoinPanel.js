'use strict';

/**
 * Group Bitcoin panel — the group's named-federation vault (core
 * `@fabric/core/types/federation`): receive address, optional balance + UTXOs,
 * earlier vaults, and k-of-n withdrawals (request, sign, status).
 * Reused on Groups detail, GroupPage, and Wallet.
 * Balance/history only when settings.bitcoin.enable (wallet.bitcoinEnable).
 */

const React = require('react');

const BASE = '/services/star-citizen';

const CSS = `
  .gbp{display:grid;gap:10px}
  .gbp-meta{display:flex;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:12.5px}
  .gbp-meta b{color:var(--text)}
  .gbp-bal{font-size:18px;font-weight:700;color:var(--text);letter-spacing:-0.02em}
  .gbp-bal .unit{font-size:12px;font-weight:500;color:var(--muted);margin-left:6px}
  .gbp-addr{font-family:'Cascadia Code',Consolas,monospace;font-size:11px;word-break:break-all;color:var(--text);line-height:1.45}
  .gbp-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .gbp-btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:7px;padding:5px 12px;font-size:12px;cursor:pointer}
  .gbp-btn:hover{border-color:var(--accent)}
  .gbp-btn.primary{background:rgba(247,147,26,.14);border-color:rgba(247,147,26,.45);color:#f7931a}
  .gbp-btn:disabled{opacity:.55;cursor:default}
  .gbp-hint{color:var(--muted);font-size:12.5px;line-height:1.55;margin:0}
  .gbp-err{color:var(--bad,#f85149);font-size:12.5px;line-height:1.5;margin:0}
  .gbp-ok{color:var(--good);font-size:12.5px;line-height:1.5;margin:0}
  .gbp-table{width:100%;border-collapse:collapse;font-size:12px}
  .gbp-table th,.gbp-table td{text-align:left;padding:7px 8px;border-bottom:1px solid #20262f;vertical-align:top}
  .gbp-table th{color:var(--muted);font-weight:600}
  .gbp-mono{font-family:'Cascadia Code',Consolas,monospace;font-size:11px;word-break:break-all}
  .gbp-h{font-size:12px;font-weight:600;color:var(--muted);margin:4px 0 0}
  .gbp-form{display:grid;gap:8px;grid-template-columns:minmax(200px,2fr) minmax(110px,1fr) minmax(90px,1fr) auto;align-items:end}
  .gbp-form label{display:grid;gap:4px;font-size:11.5px;color:var(--muted)}
  .gbp-form input{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:6px;padding:5px 8px;font-size:12px;min-width:0}
`;

const SATS = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString() + ' sats';
};

function shortTx (txid) {
  const s = String(txid || '');
  if (s.length <= 16) return s || '—';
  return s.slice(0, 8) + '…' + s.slice(-6);
}

const STATUS_LABEL = {
  pending: 'waiting for signatures',
  signed: 'signed — not broadcast',
  broadcast: 'broadcast',
  failed: 'broadcast failed'
};

/**
 * @param {object} props
 * @param {object|null} props.wallet GroupWallet payload
 * @param {boolean} [props.bitcoinEnable] Override; defaults to wallet.bitcoinEnable
 * @param {Function} [props.headers] `() => object` request headers (session auth)
 * @param {Function} [props.onCopy]
 * @param {Function} [props.onRefresh]
 * @param {string} [props.className]
 */
class GroupBitcoinPanel extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      withdrawals: [],
      form: null, // { destinationAddress, amountSats, feeSats } while open
      busy: false,
      error: null,
      notice: null
    };
  }

  componentDidMount () {
    this.loadWithdrawals();
  }

  componentDidUpdate (prev) {
    const a = prev.wallet && prev.wallet.groupId;
    const b = this.props.wallet && this.props.wallet.groupId;
    if (a !== b) this.loadWithdrawals();
  }

  bitcoinOn () {
    if (this.props.bitcoinEnable === false) return false;
    if (this.props.bitcoinEnable === true) return true;
    const w = this.props.wallet;
    return !!(w && w.bitcoinEnable === true);
  }

  headers () {
    const h = typeof this.props.headers === 'function' ? this.props.headers() : {};
    return Object.assign({ 'Content-Type': 'application/json' }, h || {});
  }

  withdrawalsPath () {
    const gw = this.props.wallet;
    return `${BASE}/groups/${encodeURIComponent(gw.groupId)}/withdrawals`;
  }

  async loadWithdrawals () {
    const gw = this.props.wallet;
    if (!gw || !gw.groupId || !gw.federationId || typeof fetch !== 'function') return;
    try {
      const res = await fetch(this.withdrawalsPath(), { headers: this.headers() });
      if (!res.ok) return;
      const json = await res.json();
      this.setState({ withdrawals: Array.isArray(json.data) ? json.data : [] });
    } catch (_) { /* offline */ }
  }

  async post (path, body, notice) {
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(path, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const w = json.data || {};
      this.setState({ busy: false, form: null, notice: w.status === 'broadcast' ? `Broadcast ${shortTx(w.broadcastTxid)}.` : notice });
      await this.loadWithdrawals();
      if (typeof this.props.onRefresh === 'function') this.props.onRefresh();
    } catch (e) {
      this.setState({ busy: false, error: e.message || String(e) });
    }
  }

  requestWithdrawal () {
    const f = this.state.form || {};
    this.post(this.withdrawalsPath(), {
      federationId: f.federationId || undefined,
      destinationAddress: String(f.destinationAddress || '').trim(),
      amountSats: Number(f.amountSats),
      feeSats: Number(f.feeSats)
    }, 'Withdrawal requested — signed by you; waiting for the other signers.');
  }

  sign (w) {
    this.post(`${this.withdrawalsPath()}/${encodeURIComponent(w.id)}/signatures`, {}, 'Signed.');
  }

  /** Whether the viewer is a signer of that vault (current or earlier). */
  viewerSigns (federationId) {
    const gw = this.props.wallet;
    if (!gw || !gw.viewerKey) return false;
    if (federationId === gw.federationId) return !!gw.viewerIsSigner;
    const p = (gw.previous || []).find((x) => x.federationId === federationId);
    return !!(p && (p.keys || []).some((k) => String(k).slice(-64) === gw.viewerKey));
  }

  openForm (federationId) {
    this.setState({ form: { federationId, destinationAddress: '', amountSats: '', feeSats: '1000' }, error: null, notice: null });
  }

  setField (name, value) {
    this.setState((s) => ({ form: Object.assign({}, s.form, { [name]: value }) }));
  }

  renderForm () {
    const f = this.state.form;
    if (!f) return null;
    const input = (name, label, type, placeholder) => React.createElement('label', null, label,
      React.createElement('input', {
        type,
        value: f[name] == null ? '' : f[name],
        placeholder,
        onChange: (e) => this.setField(name, e.target.value)
      }));
    return React.createElement('div', { className: 'gbp-form' },
      input('destinationAddress', 'Pay to address', 'text', 'bcrt1…'),
      input('amountSats', 'Amount (sats)', 'number', '10000'),
      input('feeSats', 'Fee (sats)', 'number', '1000'),
      React.createElement('div', { className: 'gbp-actions' },
        React.createElement('button', {
          type: 'button',
          className: 'gbp-btn primary',
          disabled: this.state.busy || !f.destinationAddress || !(Number(f.amountSats) > 0),
          onClick: () => this.requestWithdrawal()
        }, this.state.busy ? 'Working…' : 'Request'),
        React.createElement('button', {
          type: 'button',
          className: 'gbp-btn',
          disabled: this.state.busy,
          onClick: () => this.setState({ form: null })
        }, 'Cancel')
      )
    );
  }

  renderWithdrawals () {
    const gw = this.props.wallet;
    const list = this.state.withdrawals;
    if (!list.length) return null;
    return React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'gbp-h' }, 'Withdrawals'),
      React.createElement('table', { className: 'gbp-table' },
        React.createElement('thead', null,
          React.createElement('tr', null,
            React.createElement('th', null, 'Amount'),
            React.createElement('th', null, 'To'),
            React.createElement('th', null, 'Signatures'),
            React.createElement('th', null, 'Status')
          )
        ),
        React.createElement('tbody', null,
          list.slice(0, 40).map((w) => {
            const signers = Array.isArray(w.signers) ? w.signers : [];
            const canSign = w.status === 'pending' && this.viewerSigns(w.federationId) &&
              !signers.includes(gw.viewerKey);
            const txid = w.broadcastTxid || w.finalTxid || w.reportedTxid;
            return React.createElement('tr', { key: w.id },
              React.createElement('td', null, SATS(w.amountSats)),
              React.createElement('td', { className: 'gbp-mono', title: w.destinationAddress }, w.destinationAddress),
              React.createElement('td', null, `${signers.length} of ${w.threshold != null ? w.threshold : '?'}`),
              React.createElement('td', null,
                STATUS_LABEL[w.status] || w.status,
                txid ? React.createElement('div', { className: 'gbp-mono', title: txid }, shortTx(txid)) : null,
                w.error ? React.createElement('div', { className: 'gbp-err' }, w.error) : null,
                canSign
                  ? React.createElement('button', {
                    type: 'button',
                    className: 'gbp-btn primary',
                    disabled: this.state.busy,
                    onClick: () => this.sign(w)
                  }, 'Sign')
                  : null
              )
            );
          })
        )
      )
    );
  }

  render () {
    const gw = this.props.wallet;
    if (!gw) {
      return React.createElement('p', { className: 'gbp-hint' }, 'Wallet unavailable.');
    }
    if (gw.error) {
      return React.createElement('p', { className: 'gbp-err' }, gw.error);
    }

    const bitcoinOn = this.bitcoinOn();
    const nKeys = Array.isArray(gw.keys) ? gw.keys.length : null;
    const threshold = gw.threshold != null ? gw.threshold : null;
    const history = Array.isArray(gw.history) && gw.history.length
      ? gw.history
      : (Array.isArray(gw.utxos) ? gw.utxos : []);
    const previous = (Array.isArray(gw.previous) ? gw.previous : []).filter((p) => !bitcoinOn || p.balanceSats == null || p.balanceSats > 0);

    return React.createElement('div', {
      className: ['gbp', this.props.className].filter(Boolean).join(' ')
    },
      React.createElement('div', { className: 'gbp-meta' },
        React.createElement('span', null, 'mode ', React.createElement('b', null, gw.mode || '—')),
        threshold != null && nKeys != null
          ? React.createElement('span', null, 'signers ', React.createElement('b', null, `${threshold}-of-${nKeys}`))
          : null,
        gw.federationId
          ? React.createElement('span', { title: gw.federationId }, 'federation ', React.createElement('b', { className: 'gbp-mono' }, shortTx(gw.federationId)))
          : null,
        bitcoinOn && gw.balanceSource
          ? React.createElement('span', null, 'scan ', React.createElement('b', null, gw.balanceSource))
          : null
      ),

      bitcoinOn
        ? React.createElement('div', { className: 'gbp-bal' },
          SATS(gw.balanceSats),
          React.createElement('span', { className: 'unit' }, 'balance')
        )
        : null,

      gw.balanceError && bitcoinOn
        ? React.createElement('p', { className: 'gbp-err' }, gw.balanceError)
        : null,

      gw.address
        ? React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'gbp-addr', title: gw.address }, gw.address),
          React.createElement('div', { className: 'gbp-actions' },
            typeof this.props.onCopy === 'function'
              ? React.createElement('button', {
                type: 'button',
                className: 'gbp-btn',
                onClick: () => this.props.onCopy(gw.address)
              }, 'Copy address')
              : null,
            gw.viewerIsSigner && !this.state.form
              ? React.createElement('button', {
                type: 'button',
                className: 'gbp-btn primary',
                disabled: this.state.busy,
                title: `Request a payment from the vault; ${threshold != null ? threshold : 'k'} signers must sign`,
                onClick: () => this.openForm(null)
              }, 'Withdraw…')
              : null,
            typeof this.props.onRefresh === 'function'
              ? React.createElement('button', {
                type: 'button',
                className: 'gbp-btn',
                disabled: this.state.busy,
                onClick: () => { this.loadWithdrawals(); this.props.onRefresh(); }
              }, 'Refresh')
              : null
          )
        )
        : React.createElement('p', { className: 'gbp-hint' },
          gw.note || 'No vault address yet — the group needs signer keys. This vault is the group\'s own k-of-n federation, not a Hub wallet.'),

      this.renderForm(),
      this.state.error ? React.createElement('p', { className: 'gbp-err' }, this.state.error) : null,
      this.state.notice ? React.createElement('p', { className: 'gbp-ok' }, this.state.notice) : null,

      bitcoinOn && gw.address
        ? (history.length
          ? React.createElement('table', { className: 'gbp-table' },
            React.createElement('thead', null,
              React.createElement('tr', null,
                React.createElement('th', null, 'UTXO / receive'),
                React.createElement('th', null, 'Amount'),
                React.createElement('th', null, 'Height')
              )
            ),
            React.createElement('tbody', null,
              history.slice(0, 40).map((row, i) => React.createElement('tr', {
                key: (row.txid || '') + ':' + (row.vout != null ? row.vout : i)
              },
                React.createElement('td', { className: 'gbp-mono', title: row.txid },
                  shortTx(row.txid) + (row.vout != null ? `:${row.vout}` : '')),
                React.createElement('td', null, SATS(row.amountSats)),
                React.createElement('td', null, row.height != null ? String(row.height) : '—')
              ))
            )
          )
          : React.createElement('p', { className: 'gbp-hint' },
            'No UTXOs yet — send to the vault address above. Coins stay in the group\'s federation vault, not in a Hub wallet.'))
        : (!bitcoinOn
          ? React.createElement('p', { className: 'gbp-hint' },
            'Enable settings.bitcoin.enable to show on-chain balance and receive history.')
          : null),

      this.renderWithdrawals(),

      previous.length
        ? React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'gbp-h' }, 'Earlier vaults (before a signer change)'),
          previous.map((p) => React.createElement('div', { key: p.federationId, className: 'gbp-meta' },
            React.createElement('span', { className: 'gbp-mono', title: p.address }, p.address),
            React.createElement('span', null, `${p.threshold}-of-${(p.keys || []).length}`),
            bitcoinOn && p.balanceSats != null ? React.createElement('b', null, SATS(p.balanceSats)) : null,
            this.viewerSigns(p.federationId) && !this.state.form
              ? React.createElement('button', {
                type: 'button',
                className: 'gbp-btn',
                disabled: this.state.busy,
                onClick: () => this.openForm(p.federationId)
              }, 'Withdraw…')
              : null
          ))
        )
        : null
    );
  }
}

GroupBitcoinPanel.CSS = CSS;
GroupBitcoinPanel.SATS = SATS;

module.exports = GroupBitcoinPanel;
