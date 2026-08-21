'use strict';

/**
 * Group Bitcoin panel — Taproot receive address, optional balance + UTXO history.
 * Reused on Groups detail, GroupPage, and Wallet.
 * Balance/history only when settings.bitcoin.enable (wallet.bitcoinEnable).
 */

const React = require('react');

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
  .gbp-table{width:100%;border-collapse:collapse;font-size:12px}
  .gbp-table th,.gbp-table td{text-align:left;padding:7px 8px;border-bottom:1px solid #20262f;vertical-align:top}
  .gbp-table th{color:var(--muted);font-weight:600}
  .gbp-mono{font-family:'Cascadia Code',Consolas,monospace;font-size:11px;word-break:break-all}
  .gbp-leaves{color:var(--muted);font-size:12px;line-height:1.5}
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

/**
 * @param {object} props
 * @param {object|null} props.wallet GroupWallet payload
 * @param {boolean} [props.bitcoinEnable] Override; defaults to wallet.bitcoinEnable
 * @param {boolean} [props.isCreator]
 * @param {boolean} [props.busy]
 * @param {boolean} [props.showLeaves]
 * @param {Function} [props.onCopy]
 * @param {Function} [props.onProposeWithdraw]
 * @param {Function} [props.onRefresh]
 * @param {string} [props.className]
 */
class GroupBitcoinPanel extends React.Component {
  bitcoinOn () {
    if (this.props.bitcoinEnable === false) return false;
    if (this.props.bitcoinEnable === true) return true;
    const w = this.props.wallet;
    return !!(w && w.bitcoinEnable === true);
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

    return React.createElement('div', {
      className: ['gbp', this.props.className].filter(Boolean).join(' ')
    },
      React.createElement('div', { className: 'gbp-meta' },
        React.createElement('span', null, 'mode ', React.createElement('b', null, gw.mode || '—')),
        threshold != null && nKeys != null
          ? React.createElement('span', null, 'signers ', React.createElement('b', null, `${threshold}-of-${nKeys}`))
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
            this.props.isCreator && typeof this.props.onProposeWithdraw === 'function'
              ? React.createElement('button', {
                type: 'button',
                className: 'gbp-btn primary',
                disabled: !!this.props.busy,
                title: 'Propose publisher withdrawal (active non-expired tier)',
                onClick: () => this.props.onProposeWithdraw()
              }, this.props.busy ? 'Working…' : 'Propose withdraw')
              : null,
            typeof this.props.onRefresh === 'function'
              ? React.createElement('button', {
                type: 'button',
                className: 'gbp-btn',
                disabled: !!this.props.busy,
                onClick: () => this.props.onRefresh()
              }, 'Refresh')
              : null
          )
        )
        : React.createElement('p', { className: 'gbp-hint' },
          gw.note || 'No Taproot address yet — group needs signer keys. This address is the org treasury on this node, not Hub.'),

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
            'No UTXOs yet — send to the receive address above. Coins stay on this Group Taproot, not in a Hub wallet.'))
        : (!bitcoinOn
          ? React.createElement('p', { className: 'gbp-hint' },
            'Enable settings.bitcoin.enable to show on-chain balance and receive history.')
          : null),

      this.props.showLeaves !== false && Array.isArray(gw.leaves) && gw.leaves.length
        ? React.createElement('div', { className: 'gbp-leaves' },
          gw.leaves.map((leaf, i) => React.createElement('div', { key: i },
            (leaf.id || leaf.script || 'leaf') +
            (leaf.threshold != null ? ` · ${leaf.threshold}-of-n` : '') +
            (leaf.locktime != null ? ` · lock ${leaf.locktime}` : '') +
            (leaf.kind ? ` · ${leaf.kind}` : '')
          ))
        )
        : null
    );
  }
}

GroupBitcoinPanel.CSS = CSS;
GroupBitcoinPanel.SATS = SATS;

module.exports = GroupBitcoinPanel;
