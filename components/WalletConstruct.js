'use strict';

/**
 * Dedicated transaction constructor — `/wallet/construct`.
 * Drafts Hub-wallet sends (one destination per POST) with extra outputs,
 * fee preview, change address, and identity-watch UTXOs.
 */

const React = require('react');
const {
  blankOutput,
  constructHref,
  fromLocation,
  parseConstructQuery,
  pickUtxoList,
  previewDraft
} = require('../functions/transactionConstruct');

const BASE = '/services/star-citizen/bitcoin';

const CSS = `
  .wpage{width:100%;max-width:none;margin:0;padding:12px 14px;display:grid;gap:16px;box-sizing:border-box}
  .wpage-back{color:var(--muted);font-size:13px;text-decoration:none;cursor:pointer;background:none;border:none;padding:0;font:inherit;text-align:left}
  .wpage-back:hover{color:var(--accent)}
  .wpage-hero{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:22px 24px}
  .wpage-hero h1{margin:0 0 8px;font-size:20px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .wpage-hero .sub{color:var(--muted);font-size:12.5px;line-height:1.5}
  .wpage-tag{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:5px;letter-spacing:.02em;
    background:rgba(247,147,26,.16);color:#f7931a}
  .wpage-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .wpage-panel h2{font-size:13px;margin:0;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:600}
  .wpage-panel .body{padding:14px 16px;display:grid;gap:12px}
  .wpage-form{display:grid;gap:10px}
  .wpage-form label{display:grid;gap:4px;font-size:12px;color:var(--muted)}
  .wpage-form input,.wpage-form textarea{background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:8px 10px;font-size:13px;font:inherit}
  .wpage-out{display:grid;grid-template-columns:1fr 140px auto;gap:8px;align-items:end}
  @media (max-width:720px){.wpage-out{grid-template-columns:1fr}}
  .wpage-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .wpage-btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:7px;
    padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block}
  .wpage-btn:hover{border-color:var(--accent);color:var(--accent)}
  .wpage-btn.primary{background:rgba(247,147,26,.14);border-color:rgba(247,147,26,.45);color:#f7931a}
  .wpage-btn:disabled{opacity:.55;cursor:default}
  .wpage-err{background:rgba(248,81,73,.12);color:var(--kill,#f85149);border-radius:7px;padding:9px 12px;font-size:13px}
  .wpage-ok{background:rgba(63,185,80,.12);color:var(--good);border-radius:7px;padding:9px 12px;font-size:13px}
  .wpage-hint{color:var(--muted);font-size:12.5px;line-height:1.55;margin:0}
  .wpage-kv{display:flex;gap:14px;flex-wrap:wrap;color:var(--muted);font-size:12.5px}
  .wpage-kv b{color:var(--text)}
  .wpage-mono{font-family:'Cascadia Code',Consolas,monospace;font-size:11px;word-break:break-all}
  .wpage-table{width:100%;border-collapse:collapse;font-size:12px}
  .wpage-table th,.wpage-table td{text-align:left;padding:7px 8px;border-bottom:1px solid #20262f;vertical-align:top}
  .wpage-table th{color:var(--muted);font-weight:600}
  .wpage-json{margin:0;padding:10px 12px;background:var(--bg);border:1px solid var(--line);border-radius:8px;
    font-family:'Cascadia Code',Consolas,monospace;font-size:11px;overflow:auto;max-height:280px;
    white-space:pre-wrap;word-break:break-all}
`;

const SATS = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString() + ' sats';
};

function identityBridge () {
  return (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.identity) || null;
}

class WalletConstruct extends React.Component {
  constructor (props) {
    super(props);
    const q = parseConstructQuery(
      (typeof window !== 'undefined' && window.location && window.location.search) ||
      this.props.search ||
      ''
    );
    const first = blankOutput({
      to: this.props.to || q.to,
      amountSats: this.props.amountSats != null ? this.props.amountSats : q.amountSats
    });
    this.state = {
      loading: false,
      broadcasting: false,
      xpub: null,
      status: null,
      receive: null,
      utxos: [],
      outputs: [first.to || first.amountSats ? first : blankOutput()],
      feeSats: '',
      memo: this.props.memo != null ? String(this.props.memo) : q.memo,
      error: null,
      notice: null
    };
  }

  componentDidMount () {
    this.bootstrap();
  }

  async resolveXpub () {
    const bridge = identityBridge();
    if (!bridge || typeof bridge.get !== 'function') return null;
    try {
      const summary = await bridge.get();
      if (summary && summary.unlocked && summary.xpub) return String(summary.xpub).trim();
    } catch (_) { /* ignore */ }
    return null;
  }

  async bootstrap () {
    const xpub = await this.resolveXpub();
    this.setState({ xpub }, () => this.refresh());
  }

  async refresh () {
    const xpub = this.state.xpub;
    if (!xpub) {
      this.setState({
        error: 'Unlock your Fabric identity to load receive address and watch UTXOs.'
      });
      return;
    }
    this.setState({ loading: true, error: null, notice: null });
    try {
      const q = encodeURIComponent(xpub);
      const [statusRes, recvRes, utxoRes] = await Promise.all([
        fetch(`${BASE}/status`).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
        fetch(`${BASE}/receive?xpub=${q}&index=0`).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
        fetch(`${BASE}/utxos?xpub=${q}`).then((r) => r.json().then((j) => ({ ok: r.ok, j }))).catch(() => ({ ok: false, j: null }))
      ]);
      if (!statusRes.ok) throw new Error((statusRes.j && statusRes.j.error) || 'Hub status failed');
      if (!recvRes.ok) throw new Error((recvRes.j && recvRes.j.error) || 'Receive address failed');
      const utxos = utxoRes.ok ? pickUtxoList(utxoRes.j.data || utxoRes.j) : [];
      this.setState({
        loading: false,
        status: statusRes.j.data || statusRes.j,
        receive: recvRes.j.data || recvRes.j,
        utxos,
        error: utxoRes.ok ? null : ((utxoRes.j && utxoRes.j.error) || null)
      });
    } catch (e) {
      this.setState({ loading: false, error: e.message || String(e) });
    }
  }

  patchOutput (i, patch) {
    const outputs = this.state.outputs.slice();
    outputs[i] = Object.assign({}, outputs[i], patch);
    this.setState({ outputs });
  }

  addOutput () {
    this.setState({ outputs: this.state.outputs.concat([blankOutput()]) });
  }

  removeOutput (i) {
    const outputs = this.state.outputs.slice();
    if (outputs.length <= 1) {
      this.setState({ outputs: [blankOutput()] });
      return;
    }
    outputs.splice(i, 1);
    this.setState({ outputs });
  }

  draft () {
    const changeAddress = (this.state.receive && this.state.receive.address) || '';
    return {
      outputs: this.state.outputs,
      feeSats: this.state.feeSats,
      changeAddress,
      memo: this.state.memo
    };
  }

  async broadcast () {
    const preview = previewDraft(this.draft());
    if (!preview.ok) {
      this.setState({ error: preview.errors.join(' ') });
      return;
    }
    const xpub = this.state.xpub;
    this.setState({ broadcasting: true, error: null, notice: null });
    const txids = [];
    try {
      for (const payment of preview.hubSends) {
        const res = await fetch(`${BASE}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: payment.to,
            amountSats: payment.amountSats,
            memo: payment.memo || '',
            xpub
          })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || res.statusText);
        const txid = (json.data && (json.data.txid || (json.data.payment && json.data.payment.txid))) || null;
        if (txid) txids.push(txid);
      }
      this.setState({
        broadcasting: false,
        notice: txids.length
          ? `Broadcast ${txids.length} Hub payment${txids.length === 1 ? '' : 's'} — ${txids.join(', ')}`
          : 'Send submitted.',
        outputs: [blankOutput()]
      });
      await this.refresh();
    } catch (e) {
      this.setState({
        broadcasting: false,
        error: (txids.length ? `Partial send (${txids.length} ok). ` : '') + (e.message || String(e))
      });
    }
  }

  render () {
    const preview = previewDraft(this.draft());
    const st = this.state.status || {};
    const network = st.network || '—';
    const changeAddress = (this.state.receive && this.state.receive.address) || '';

    return React.createElement('div', { className: 'wpage' },
      React.createElement('a', { className: 'wpage-back', href: '/#wallet' }, '← Wallet'),
      React.createElement('div', { className: 'wpage-hero' },
        React.createElement('h1', null, 'Transaction constructor',
          React.createElement('span', { className: 'wpage-tag' }, 'advanced')),
        React.createElement('p', { className: 'sub' },
          'Draft Hub-wallet payments with multiple outputs, a fee preview, and your identity change address. ',
          'Each output broadcasts as one Hub send (`to` + amountSats). The operator admin token stays on the server.')
      ),
      React.createElement('div', { className: 'wpage-panel' },
        React.createElement('h2', null, 'Outputs'),
        React.createElement('div', { className: 'body' },
          React.createElement('p', { className: 'wpage-hint' },
            'Hub HTTP send is one destination per call. Extra rows become sequential payments.'),
          this.state.outputs.map((row, i) => React.createElement('div', {
            key: 'out-' + i,
            className: 'wpage-out'
          },
            React.createElement('label', null, i === 0 ? 'Send to' : `Output ${i + 1}`,
              React.createElement('input', {
                value: row.to,
                placeholder: 'bcrt1…',
                onChange: (e) => this.patchOutput(i, { to: e.target.value })
              })
            ),
            React.createElement('label', null, 'Amount (sats)',
              React.createElement('input', {
                value: row.amountSats,
                onChange: (e) => this.patchOutput(i, { amountSats: e.target.value })
              })
            ),
            React.createElement('button', {
              className: 'wpage-btn',
              type: 'button',
              onClick: () => this.removeOutput(i)
            }, 'Remove')
          )),
          React.createElement('div', { className: 'wpage-actions' },
            React.createElement('button', {
              className: 'wpage-btn',
              type: 'button',
              onClick: () => this.addOutput()
            }, 'Add output')
          )
        )
      ),
      React.createElement('div', { className: 'wpage-panel' },
        React.createElement('h2', null, 'Fee, change, memo'),
        React.createElement('div', { className: 'body' },
          React.createElement('div', { className: 'wpage-form' },
            React.createElement('label', null, 'Fee sats (preview only)',
              React.createElement('input', {
                value: this.state.feeSats,
                placeholder: 'Hub bitcoind chooses the actual fee',
                onChange: (e) => this.setState({ feeSats: e.target.value })
              })
            ),
            React.createElement('label', null, 'Change address (identity receive)',
              React.createElement('input', {
                value: changeAddress,
                readOnly: true
              })
            ),
            React.createElement('label', null, 'Memo (optional, applied to each Hub send)',
              React.createElement('input', {
                value: this.state.memo,
                onChange: (e) => this.setState({ memo: e.target.value })
              })
            )
          ),
          React.createElement('p', { className: 'wpage-hint' }, preview.feeNote)
        )
      ),
      React.createElement('div', { className: 'wpage-panel' },
        React.createElement('h2', null, 'Preview'),
        React.createElement('div', { className: 'body' },
          React.createElement('div', { className: 'wpage-kv' },
            React.createElement('span', null, 'network ', React.createElement('b', null, network)),
            React.createElement('span', null, 'outputs ', React.createElement('b', null, preview.outputCount)),
            React.createElement('span', null, 'total ', React.createElement('b', null, SATS(preview.totalSats))),
            React.createElement('span', null, 'fee preview ', React.createElement('b', null, SATS(preview.feeSats)))
          ),
          React.createElement('pre', { className: 'wpage-json' }, JSON.stringify({
            outputs: preview.outputs,
            totalSats: preview.totalSats,
            feeSats: preview.feeSats,
            changeAddress: preview.changeAddress,
            memo: preview.memo,
            hubSends: preview.hubSends
          }, null, 2)),
          preview.errors.length
            ? React.createElement('div', { className: 'wpage-err' }, preview.errors.join(' '))
            : null,
          React.createElement('div', { className: 'wpage-actions' },
            React.createElement('button', {
              className: 'wpage-btn primary',
              type: 'button',
              disabled: this.state.broadcasting || !preview.ok,
              onClick: () => this.broadcast()
            }, this.state.broadcasting
              ? 'Broadcasting…'
              : (preview.outputCount > 1
                ? `Broadcast ${preview.outputCount} Hub payments`
                : 'Broadcast'))
          )
        )
      ),
      React.createElement('div', { className: 'wpage-panel' },
        React.createElement('h2', null, 'Watch UTXOs'),
        React.createElement('div', { className: 'body' },
          React.createElement('p', { className: 'wpage-hint' },
            'Identity xpub coins (watch-only). Hub send spends the Hub bitcoind wallet, not these UTXOs.'),
          this.state.utxos.length
            ? React.createElement('table', { className: 'wpage-table' },
              React.createElement('thead', null,
                React.createElement('tr', null,
                  React.createElement('th', null, 'txid'),
                  React.createElement('th', null, 'vout'),
                  React.createElement('th', null, 'amount')
                )
              ),
              React.createElement('tbody', null,
                this.state.utxos.slice(0, 50).map((u) => React.createElement('tr', {
                  key: String(u.txid) + ':' + String(u.vout)
                },
                React.createElement('td', { className: 'wpage-mono' },
                  u.txid ? String(u.txid).slice(0, 16) + '…' : '—'),
                React.createElement('td', null, u.vout != null ? u.vout : '—'),
                React.createElement('td', null, SATS(u.amountSats != null ? u.amountSats : Math.round(Number(u.amount || 0) * 1e8)))
                ))
              )
            )
            : React.createElement('p', { className: 'wpage-hint' },
              this.state.loading ? 'Loading UTXOs…' : 'No watch UTXOs for this xpub.')
        )
      ),
      this.state.error
        ? React.createElement('div', { className: 'wpage-err' }, this.state.error)
        : null,
      this.state.notice
        ? React.createElement('div', { className: 'wpage-ok' }, this.state.notice)
        : null
    );
  }
}

WalletConstruct.CSS = CSS;
WalletConstruct.fromLocation = function () {
  const path = String((typeof window !== 'undefined' && window.location && window.location.pathname) || '');
  const search = String((typeof window !== 'undefined' && window.location && window.location.search) || '');
  return fromLocation(path, search) ? { href: constructHref(parseConstructQuery(search)) } : null;
};

module.exports = WalletConstruct;
