'use strict';

/**
 * Wallet — Bitcoin components brought forward from the Hub, group-aware.
 * Shows the payout backend (ledger vs bitcoind, network), each group's
 * deterministic Taproot (P2TR) spend-ladder address (same on every member's
 * relay — sorted keys; legacy P2WSH kept under legacyP2wsh), and mission
 * escrows with status.
 */

const React = require('react');

const BASE = '/services/star-citizen';

const CSS = `
  .wa-wrap{width:100%;max-width:none;margin:0;padding:12px 14px;display:grid;gap:14px;box-sizing:border-box}
  .wa-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .wa-panel h2{font-size:13px;margin:0;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:600;display:flex;gap:8px;align-items:center}
  .wa-panel h2 .sub{color:var(--muted);font-weight:400;font-size:12px;flex:1}
  .wa-body{padding:14px 16px}
  .wa-kv{display:flex;gap:14px;flex-wrap:wrap;color:var(--muted);font-size:12.5px}
  .wa-kv b{color:var(--text)}
  .wa-row{display:flex;gap:10px;align-items:center;padding:10px 16px;border-bottom:1px solid #20262f;flex-wrap:wrap}
  .wa-row:last-child{border-bottom:none}
  .wa-name{font-weight:600;font-size:13px;min-width:140px}
  .wa-addr{font-family:'Cascadia Code',Consolas,monospace;font-size:11px;word-break:break-all;flex:1;min-width:200px;color:var(--text)}
  .wa-tag{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:5px}
  .wa-tag.btc{background:rgba(247,147,26,.16);color:#f7931a}
  .wa-tag.ok{background:rgba(63,185,80,.15);color:var(--good)}
  .wa-tag.warn{background:rgba(210,153,34,.18);color:var(--warn)}
  .wa-tag.mut{background:rgba(110,118,129,.18);color:var(--muted)}
  .wa-btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:7px;padding:4px 11px;font-size:11.5px;cursor:pointer}
  .wa-btn:hover{border-color:var(--accent)}
  .wa-note{color:var(--muted);font-size:12px;padding:12px 16px;line-height:1.6}
`;

const SATS = (n) => Number(n || 0).toLocaleString() + ' sats';

class Wallet extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      wallet: null,
      groups: [],
      groupWallets: {}, // groupId → wallet | { error }
      loading: true,
      notice: null
    };
  }

  componentDidMount () {
    this.load();
  }

  async load () {
    try {
      const [w, g] = await Promise.all([
        fetch(`${BASE}/wallet`).then((r) => r.json()),
        fetch(`${BASE}/groups`).then((r) => r.json()).catch(() => ({ data: [] }))
      ]);
      const groups = (g.data || []).filter((x) => Array.isArray(x.members));
      this.setState({ wallet: w.data, groups, loading: false });
      for (const group of groups) {
        try {
          const res = await fetch(`${BASE}/groups/${encodeURIComponent(group.id)}/wallet`);
          const json = await res.json();
          this.setState((s) => ({ groupWallets: Object.assign({}, s.groupWallets, { [group.id]: res.ok ? json.data : { error: json.error } }) }));
        } catch (e) {
          this.setState((s) => ({ groupWallets: Object.assign({}, s.groupWallets, { [group.id]: { error: e.message } }) }));
        }
      }
    } catch (_) {
      this.setState({ loading: false });
    }
  }

  copy (text) {
    try { navigator.clipboard.writeText(text); this.setState({ notice: 'Copied.' }); } catch (_) { /* no clipboard */ }
  }

  async proposeWithdraw (groupId) {
    try {
      const res = await fetch(`${BASE}/groups/${encodeURIComponent(groupId)}/withdrawals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'spend', utxoAgeBlocks: 0 })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      const pref = json.data && json.data.prepared && json.data.prepared.preferredTierId;
      const tiers = (json.data && json.data.prepared && json.data.prepared.activeTiers) || [];
      const tip = tiers.length
        ? `Active tier: ${tiers[0].id} (${tiers[0].threshold}-of-n). Address ready — fund UTXO then POST fundedTxHex + destinationAddress.`
        : 'Withdrawal proposed.';
      this.setState({ notice: tip + (pref ? ` Preferred: ${pref}` : '') });
    } catch (e) {
      this.setState({ notice: e.message || String(e) });
    }
  }

  render () {
    const w = this.state.wallet;
    return React.createElement('div', { className: 'wa-wrap' },
      React.createElement('div', { className: 'wa-panel' },
        React.createElement('h2', null, '₿ Wallet ',
          React.createElement('span', { className: 'sub' }, '— mission escrow backend and group multisig'),
          React.createElement('button', { className: 'wa-btn', onClick: () => this.load() }, 'Refresh')
        ),
        React.createElement('div', { className: 'wa-body' },
          w
            ? React.createElement('div', { className: 'wa-kv' },
              React.createElement('span', null, 'mode ', React.createElement('b', null, w.mode)),
              React.createElement('span', null, 'network ', React.createElement('b', null, w.network || '—')),
              React.createElement('span', null, 'fee ', React.createElement('b', null, w.feeSats != null ? w.feeSats + ' sats' : '—')),
              React.createElement('span', null, 'escrows ', React.createElement('b', null, (w.escrows || []).length))
            )
            : (this.state.loading ? 'loading…' : 'wallet unavailable'),
          w && w.mode === 'ledger'
            ? React.createElement('div', { style: { color: 'var(--muted)', fontSize: 12, marginTop: 8, lineHeight: 1.6 } },
              'Ledger mode: obligations are recorded and auditable; connect a bitcoind RPC (settings/local.js → payouts.rpc) for on-chain regtest/signet escrow addresses.')
            : null
        )
      ),

      React.createElement('div', { className: 'wa-panel' },
        React.createElement('h2', null, '👥 Group Taproot ',
          React.createElement('span', { className: 'sub' }, '— failover ladder P2TR from signer keys (readers do not change the address)')
        ),
        this.state.groups.length
          ? this.state.groups.map((g) => {
            const gw = this.state.groupWallets[g.id];
            const nSigners = (g.validators || g.members || []).length;
            const isCreator = this.props.pubkey && g.creator === this.props.pubkey;
            return React.createElement('div', { className: 'wa-row', key: g.id },
              React.createElement('span', { className: 'wa-name' }, g.name),
              React.createElement('span', { className: 'wa-tag btc' }, `${g.threshold}-of-${nSigners}`),
              gw && gw.mode ? React.createElement('span', { className: 'wa-tag ok' }, gw.mode) : null,
              gw && gw.address
                ? React.createElement(React.Fragment, null,
                  React.createElement('span', { className: 'wa-addr' }, gw.address),
                  React.createElement('button', { className: 'wa-btn', onClick: () => this.copy(gw.address) }, 'Copy'),
                  isCreator ? React.createElement('button', {
                    className: 'wa-btn',
                    title: 'Propose publisher withdrawal (active non-expired tier)',
                    onClick: () => this.proposeWithdraw(g.id)
                  }, 'Withdraw') : null
                )
                : React.createElement('span', { className: 'wa-addr', style: { color: 'var(--muted)' } },
                  gw ? (gw.error || gw.note || '…') : 'deriving…')
            );
          })
          : React.createElement('div', { className: 'wa-note' }, 'No groups yet — group wallets appear here once you create or join one.')
      ),

      React.createElement('div', { className: 'wa-panel' },
        React.createElement('h2', null, '⭐ Mission escrows ',
          React.createElement('span', { className: 'sub' }, '— rewards locked to the mission authorities; approval signatures release them')
        ),
        w && (w.escrows || []).length
          ? w.escrows.map((e) => React.createElement('div', { className: 'wa-row', key: e.missionId },
            React.createElement('span', { className: 'wa-name' }, e.title),
            React.createElement('span', { className: 'wa-tag ' + (e.escrow.status === 'paid' ? 'ok' : e.escrow.status === 'payable' ? 'warn' : 'mut') }, e.escrow.status),
            React.createElement('span', { className: 'wa-tag btc' }, SATS(e.escrow.amountSats)),
            e.escrow.address
              ? React.createElement('span', { className: 'wa-addr' }, e.escrow.address)
              : React.createElement('span', { className: 'wa-addr', style: { color: 'var(--muted)' } }, 'ledger obligation'),
            e.escrow.address ? React.createElement('button', { className: 'wa-btn', onClick: () => this.copy(e.escrow.address) }, 'Copy') : null
          ))
          : React.createElement('div', { className: 'wa-note' }, 'No escrows yet — attach a Bitcoin reward when creating a mission on the Missions tab.')
      ),
      this.state.notice ? React.createElement('div', { style: { color: 'var(--good)', fontSize: 12 } }, this.state.notice) : null
    );
  }
}

Wallet.CSS = CSS;

module.exports = Wallet;
