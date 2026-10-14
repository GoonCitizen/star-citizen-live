'use strict';

/**
 * Personal Bitcoin panel — Hub-backed via LiveRelay /bitcoin/* proxy.
 * Watch: identity xpub. Send: Hub faucet wallet (admin token on server).
 */

const React = require('react');
const { constructHref } = require('../functions/transactionConstruct');

const BASE = '/services/star-citizen/bitcoin';

const CSS = `
  .bwp-form{display:grid;gap:10px;max-width:520px}
  .bwp-form label{display:grid;gap:4px;font-size:12px;color:var(--muted)}
  .bwp-form input{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:7px;padding:8px 10px;font-size:13px}
  .bwp-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .bwp-table{width:100%;border-collapse:collapse;font-size:12px}
  .bwp-table th,.bwp-table td{text-align:left;padding:8px 10px;border-bottom:1px solid #20262f;vertical-align:top}
  .bwp-table th{color:var(--muted);font-weight:600}
  .bwp-mono{font-family:'Cascadia Code',Consolas,monospace;font-size:11px;word-break:break-all}
  .bwp-err{color:var(--bad,#f85149);font-size:12.5px;line-height:1.5}
  .bwp-ok{color:var(--good);font-size:12.5px;line-height:1.5}
  .bwp-note{color:var(--muted);font-size:12px;line-height:1.55;margin:0}
  .bwp-link{color:var(--accent);font-size:12.5px;font-weight:600;text-decoration:none}
  .bwp-link:hover{text-decoration:underline}
`;

const SATS = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString() + ' sats';
};

function pickBalanceSats (summary) {
  if (!summary || typeof summary !== 'object') return null;
  const raw = summary.wallet || summary.data || summary;
  if (raw.balanceSats != null) return Number(raw.balanceSats);
  if (raw.confirmedSats != null) return Number(raw.confirmedSats);
  if (raw.balance != null && Number.isFinite(Number(raw.balance))) {
    return Math.round(Number(raw.balance) * 1e8);
  }
  if (raw.summary && raw.summary.trusted != null) {
    return Math.round(Number(raw.summary.trusted) * 1e8);
  }
  return null;
}

function pickTxList (payload) {
  if (!payload) return [];
  const raw = payload.transactions || payload.data || payload;
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.transactions)) return raw.transactions;
  return [];
}

class BitcoinWalletPanel extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      loading: false,
      status: null,
      summary: null,
      receive: null,
      receiveIndex: 0,
      txs: [],
      faucet: null,
      faucetAmountSats: '10000',
      sendOpen: false,
      to: '',
      amountSats: '10000',
      memo: '',
      error: null,
      notice: null,
      xpub: null
    };
  }

  componentDidMount () {
    this.bootstrap();
  }

  componentDidUpdate (prev) {
    if (prev.identityPubkey !== this.props.identityPubkey ||
        prev.identityLocked !== this.props.identityLocked) {
      this.bootstrap();
    }
  }

  async resolveXpub () {
    const bridge = (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.identity) || null;
    if (!bridge || typeof bridge.get !== 'function') return null;
    try {
      const summary = await bridge.get();
      if (summary && summary.unlocked && summary.xpub) return String(summary.xpub).trim();
    } catch (_) { /* ignore */ }
    return null;
  }

  async bootstrap () {
    if (this.props.bitcoinEnable === false) {
      this.setState({ error: null, summary: null, status: null, txs: [], receive: null, xpub: null });
      return;
    }
    if (this.props.identityLocked || !this.props.identityPubkey) {
      this.setState({
        error: null,
        notice: null,
        summary: null,
        receive: null,
        txs: [],
        xpub: null
      });
      return;
    }
    const xpub = await this.resolveXpub();
    this.setState({ xpub }, () => this.refresh());
  }

  async refresh () {
    const xpub = this.state.xpub;
    if (!xpub) {
      this.setState({
        error: this.props.identityPubkey
          ? 'Unlocked identity has no xpub — unlock or restore identity.'
          : null
      });
      return;
    }
    this.setState({ loading: true, error: null, notice: null });
    try {
      const q = encodeURIComponent(xpub);
      const idx = this.state.receiveIndex || 0;
      const [statusRes, walletRes, recvRes, txRes, faucetRes] = await Promise.all([
        fetch(`${BASE}/status`).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
        fetch(`${BASE}/wallet?xpub=${q}`).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
        fetch(`${BASE}/receive?xpub=${q}&index=${idx}`).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
        fetch(`${BASE}/transactions?xpub=${q}&limit=25`).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
        fetch(`${BASE}/faucet`).then((r) => r.json().then((j) => ({ ok: r.ok, j }))).catch(() => ({ ok: false, j: null }))
      ]);
      if (!statusRes.ok) throw new Error((statusRes.j && statusRes.j.error) || 'Hub status failed');
      if (!walletRes.ok) throw new Error((walletRes.j && walletRes.j.error) || 'Wallet summary failed');
      if (!recvRes.ok) throw new Error((recvRes.j && recvRes.j.error) || 'Receive address failed');
      if (!txRes.ok) throw new Error((txRes.j && txRes.j.error) || 'Transactions failed');
      const faucetPayload = faucetRes.ok ? (faucetRes.j.data || faucetRes.j) : null;
      const faucet = (faucetPayload && faucetPayload.available && faucetPayload.faucet)
        ? faucetPayload.faucet
        : null;
      this.setState({
        loading: false,
        status: statusRes.j.data || statusRes.j,
        summary: walletRes.j.data || walletRes.j,
        receive: recvRes.j.data || recvRes.j,
        txs: pickTxList(txRes.j.data || txRes.j),
        faucet,
        faucetAmountSats: faucet && faucet.defaultAmountSats
          ? String(faucet.defaultAmountSats)
          : this.state.faucetAmountSats,
        error: null
      });
    } catch (e) {
      this.setState({ loading: false, error: e.message || String(e) });
    }
  }

  async nextReceive () {
    const next = (this.state.receiveIndex || 0) + 1;
    this.setState({ receiveIndex: next }, () => this.refresh());
  }

  copy (text) {
    try {
      navigator.clipboard.writeText(text);
      this.setState({ notice: 'Copied.' });
    } catch (_) {
      this.setState({ notice: 'Copy failed.' });
    }
  }

  async send () {
    const xpub = this.state.xpub;
    const to = String(this.state.to || '').trim();
    const amountSats = Math.round(Number(this.state.amountSats || 0));
    if (!to || amountSats <= 0) {
      this.setState({ error: 'Enter a destination address and positive amountSats.' });
      return;
    }
    this.setState({ loading: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          amountSats,
          memo: this.state.memo || '',
          xpub
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      const txid = (json.data && (json.data.txid || json.data.payment && json.data.payment.txid)) || null;
      this.setState({
        loading: false,
        notice: txid ? `Sent — ${txid}` : 'Send submitted.',
        to: '',
        amountSats: '10000'
      });
      await this.refresh();
    } catch (e) {
      this.setState({ loading: false, error: e.message || String(e) });
    }
  }

  async requestFaucet () {
    const faucet = this.state.faucet;
    const address = this.state.receive && this.state.receive.address;
    if (!faucet || !address) {
      this.setState({ error: 'Faucet unavailable or no receive address yet.' });
      return;
    }
    const amountSats = Math.round(Number(this.state.faucetAmountSats || faucet.defaultAmountSats || 10000));
    this.setState({ loading: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/faucet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, amountSats })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      const data = json.data || json;
      const txid = (data.faucet && data.faucet.txid) || data.txid || null;
      this.setState({
        loading: false,
        notice: txid
          ? `Faucet funded ${amountSats} sats — ${txid}`
          : `Faucet request accepted (${amountSats} sats).`
      });
      await this.refresh();
    } catch (e) {
      this.setState({ loading: false, error: e.message || String(e) });
    }
  }

  renderSend () {
    if (!this.state.sendOpen) {
      return React.createElement('div', {
        className: 'bwp-actions',
        style: { marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)' }
      },
        React.createElement('button', {
          className: 'wa-btn',
          type: 'button',
          onClick: () => this.setState({ sendOpen: true, error: null, notice: null })
        }, 'Send')
      );
    }
    return React.createElement('div', { className: 'bwp-form', style: { marginTop: 16 } },
      React.createElement('label', null, 'Send to',
        React.createElement('input', {
          value: this.state.to,
          placeholder: 'bcrt1…',
          onChange: (e) => this.setState({ to: e.target.value })
        })
      ),
      React.createElement('label', null, 'Amount (sats)',
        React.createElement('input', {
          value: this.state.amountSats,
          onChange: (e) => this.setState({ amountSats: e.target.value })
        })
      ),
      React.createElement('label', null, 'Memo (optional)',
        React.createElement('input', {
          value: this.state.memo,
          onChange: (e) => this.setState({ memo: e.target.value })
        })
      ),
      React.createElement('div', { className: 'bwp-actions' },
        React.createElement('button', {
          className: 'wa-btn',
          disabled: this.state.loading,
          onClick: () => this.send()
        }, 'Send'),
        React.createElement('button', {
          className: 'wa-btn',
          type: 'button',
          onClick: () => this.setState({ sendOpen: false })
        }, 'Cancel'),
        React.createElement('a', {
          className: 'bwp-link',
          href: constructHref({
            to: this.state.to,
            amountSats: this.state.amountSats,
            memo: this.state.memo
          })
        }, 'Advanced constructor')
      )
    );
  }

  renderLocked () {
    return React.createElement('div', { className: 'wa-body' },
      React.createElement('p', { className: 'bwp-note' },
        'Unlock your Fabric identity to load the personal watch wallet (xpub balance, receive, history).')
    );
  }

  render () {
    if (this.props.bitcoinEnable === false) {
      return React.createElement('div', { className: 'wa-panel' },
        React.createElement('h2', null, '₿ Personal wallet ',
          React.createElement('span', { className: 'sub' }, '— disabled')),
        React.createElement('div', { className: 'wa-note' },
          'Set bitcoin.enable: true in settings/local.js to use Hub-backed L1 wallet tools.')
      );
    }

    const bal = pickBalanceSats(this.state.summary);
    const st = this.state.status || {};
    const network = st.network || (this.props.network) || '—';
    const hubOnline = st.available === true || st.status === 'ONLINE';

    return React.createElement('div', { className: 'wa-panel' },
      React.createElement('h2', null, '₿ Personal wallet ',
        React.createElement('span', { className: 'sub' },
          '— identity watch + Hub faucet send'),
        React.createElement('button', {
          className: 'wa-btn',
          disabled: this.state.loading,
          onClick: () => this.refresh()
        }, this.state.loading ? '…' : 'Refresh')
      ),
      (!this.props.identityPubkey || this.props.identityLocked)
        ? this.renderLocked()
        : React.createElement('div', { className: 'wa-body' },
          React.createElement('div', { className: 'wa-kv' },
            React.createElement('span', null, 'Hub ',
              React.createElement('b', null, hubOnline ? 'online' : 'offline')),
            React.createElement('span', null, 'network ', React.createElement('b', null, network)),
            React.createElement('span', null, 'balance ',
              React.createElement('b', null, SATS(bal)))
          ),
          React.createElement('p', { className: 'bwp-note', style: { marginTop: 10 } },
            'Send goes through this app’s Hub-shaped API (LiveRelay → Hub HTTP). ',
            'The operator admin token stays in the desktop process — never in the browser. ',
            'Balance / history watch your identity xpub. ',
            'Beacon faucet appears only when the Hub OPTIONS contract advertises it (regtest/playnet).'),
          this.state.receive && this.state.receive.address
            ? React.createElement('div', { style: { marginTop: 12 } },
              React.createElement('div', { className: 'wa-kv' },
                React.createElement('span', null, 'receive ',
                  React.createElement('span', { className: 'bwp-mono' }, this.state.receive.address)),
                React.createElement('button', {
                  className: 'wa-btn',
                  onClick: () => this.copy(this.state.receive.address)
                }, 'Copy'),
                React.createElement('button', {
                  className: 'wa-btn',
                  onClick: () => this.nextReceive()
                }, 'Next address')
              ),
              React.createElement('div', {
                style: { color: 'var(--muted)', fontSize: 11, marginTop: 4 }
              }, this.state.receive.path || `index ${this.state.receive.index}`)
            )
            : null,
          this.state.faucet
            ? React.createElement('div', {
              className: 'bwp-form',
              style: { marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)' }
            },
              React.createElement('div', { className: 'wa-kv' },
                React.createElement('span', null, 'Beacon faucet ',
                  React.createElement('b', null, this.state.faucet.funded === false ? 'dry' : 'available')),
                this.state.faucet.balanceSats != null
                  ? React.createElement('span', null, 'hub ',
                    React.createElement('b', null, SATS(this.state.faucet.balanceSats)))
                  : null
              ),
              React.createElement('label', null, 'Faucet amount (sats)',
                React.createElement('input', {
                  value: this.state.faucetAmountSats,
                  onChange: (e) => this.setState({ faucetAmountSats: e.target.value })
                })
              ),
              React.createElement('div', { className: 'bwp-actions' },
                React.createElement('button', {
                  className: 'wa-btn',
                  disabled: this.state.loading || !this.state.receive || !this.state.receive.address,
                  onClick: () => this.requestFaucet()
                }, 'Request from faucet')
              )
            )
            : null,
          this.renderSend(),
          React.createElement('h3', {
            style: { fontSize: 12, margin: '18px 0 8px', color: 'var(--muted)' }
          }, 'Recent activity'),
          this.state.txs.length
            ? React.createElement('table', { className: 'bwp-table' },
              React.createElement('thead', null,
                React.createElement('tr', null,
                  React.createElement('th', null, 'txid'),
                  React.createElement('th', null, 'conf'),
                  React.createElement('th', null, 'amount')
                )
              ),
              React.createElement('tbody', null,
                this.state.txs.slice(0, 25).map((tx) => React.createElement('tr', {
                  key: tx.txid || JSON.stringify(tx)
                },
                React.createElement('td', { className: 'bwp-mono' },
                  tx.txid ? String(tx.txid).slice(0, 16) + '…' : '—'),
                React.createElement('td', null, tx.confirmations != null ? tx.confirmations : '—'),
                React.createElement('td', null,
                  tx.ourAmount != null
                    ? SATS(Math.round(Number(tx.ourAmount) * 1e8))
                    : (tx.amountSats != null ? SATS(tx.amountSats) : '—'))
                ))
              )
            )
            : React.createElement('div', { className: 'wa-note' }, 'No transactions yet for this xpub.'),
          this.state.error
            ? React.createElement('div', { className: 'bwp-err', style: { marginTop: 10 } }, this.state.error)
            : null,
          this.state.notice
            ? React.createElement('div', { className: 'bwp-ok', style: { marginTop: 10 } }, this.state.notice)
            : null
        )
    );
  }
}

BitcoinWalletPanel.CSS = CSS;

module.exports = BitcoinWalletPanel;
