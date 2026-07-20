'use strict';

/**
 * Missions — the officer-validated register with Bitcoin-unlocked rewards.
 *
 * Flow surfaced here (backed by MissionManager + PayoutManager):
 *   create (reward sats, optional group authorities + escrow)
 *     → apply → accept → SUBMIT COMPLETION (claim)
 *     → APPROVE COMPLETION (k-of-n Schnorr over the acceptance message)
 *     → escrow flips payable → payout PSBT for the authorities to sign.
 *
 * Approval signatures come from the desktop identity (BIP340 via
 * `identity.signMessage`); the coins unlock only when the mission's
 * authority threshold is met — the server never holds keys.
 */

const React = require('react');

const BASE = '/services/star-citizen';

const CSS = `
  .mi-wrap{max-width:980px;margin:0 auto;padding:18px;display:grid;gap:14px}
  .mi-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .mi-panel h2{font-size:13px;margin:0;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:600;display:flex;gap:8px;align-items:center}
  .mi-panel h2 .sub{color:var(--muted);font-weight:400;font-size:12px;flex:1}
  .mi-body{padding:14px 16px}
  .mi-btn{background:var(--accent);border:none;color:#fff;border-radius:7px;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}
  .mi-btn:disabled{opacity:.45;cursor:default}
  .mi-btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
  .mi-btn.good{background:var(--good)}
  .mi-field{display:grid;gap:4px;margin-bottom:10px}
  .mi-field label{font-size:12px;color:var(--muted)}
  .mi-field input,.mi-field select{background:var(--bg);border:1px solid var(--line);color:var(--text);border-radius:7px;padding:8px 10px;font-size:13px}
  .mi-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .mi-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:8px 11px;font-size:12.5px;margin-top:8px}
  .mi-ok{background:rgba(63,185,80,.12);color:var(--good);border-radius:7px;padding:8px 11px;font-size:12.5px;margin-top:8px}
  .mi-m{border-bottom:1px solid #20262f;padding:12px 16px;display:grid;gap:8px}
  .mi-m:last-child{border-bottom:none}
  .mi-mh{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .mi-title{font-weight:600;font-size:14px;flex:1;min-width:140px}
  .mi-tag{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:5px}
  .mi-tag.open{background:rgba(59,130,246,.18);color:var(--accent)}
  .mi-tag.assigned{background:rgba(210,153,34,.18);color:var(--warn)}
  .mi-tag.completed{background:rgba(63,185,80,.15);color:var(--good)}
  .mi-tag.cancelled{background:rgba(110,118,129,.18);color:var(--muted)}
  .mi-tag.btc{background:rgba(247,147,26,.16);color:#f7931a}
  .mi-meta{color:var(--muted);font-size:11.5px;font-family:'Cascadia Code',Consolas,monospace;word-break:break-all}
  .mi-esc{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px 12px;display:grid;gap:6px;font-size:12.5px}
  .mi-esc code{font-size:11px;word-break:break-all}
  .mi-psbt{width:100%;min-height:64px;background:var(--bg);border:1px solid var(--line);color:var(--text);border-radius:7px;padding:8px;font-family:'Cascadia Code',Consolas,monospace;font-size:10.5px}
`;

const SATS = (n) => Number(n || 0).toLocaleString() + ' sats';

function bridge () {
  return (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.identity) || null;
}

class Missions extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      token: null,
      pubkey: null,
      missions: [],
      groups: [],
      applications: [],
      claims: [],
      loading: true,
      error: null,
      notice: null,
      busy: false,
      showCreate: false,
      // create form
      title: '',
      reward: '',
      groupId: '',
      attachEscrow: false,
      // payout inputs keyed by mission id
      payoutAddr: {},
      signedTx: {},
      psbt: {}
    };
    this._timer = null;
  }

  componentDidMount () {
    this.connect();
    this._timer = setInterval(() => this.refresh(), 8000);
  }

  componentWillUnmount () {
    if (this._timer) clearInterval(this._timer);
  }

  headers () {
    const h = { 'Content-Type': 'application/json' };
    if (this.state.token) h.Authorization = `Bearer ${this.state.token}`;
    return h;
  }

  async connect () {
    const b = bridge();
    if (b) {
      try {
        const info = await b.get();
        if (info && info.unlocked) {
          const envelope = await b.signEnvelope({ intent: 'login', ts: new Date().toISOString() });
          if (envelope && !envelope.error) {
            const res = await fetch(`${BASE}/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope) });
            if (res.ok) {
              const json = await res.json();
              this.setState({ token: json.data.token, pubkey: json.data.pubkey });
            }
          }
        }
      } catch (_) { /* locked */ }
    }
    await this.refresh();
  }

  async refresh () {
    try {
      const [m, g, a, c] = await Promise.all([
        fetch(`${BASE}/missions`, { headers: this.headers() }).then((r) => r.json()),
        fetch(`${BASE}/groups`, { headers: this.headers() }).then((r) => r.json()).catch(() => ({ data: [] })),
        fetch(`${BASE}/applications`).then((r) => r.json()).catch(() => ({ data: [] })),
        fetch(`${BASE}/claims`).then((r) => r.json()).catch(() => ({ data: [] }))
      ]);
      this.setState({ missions: m.data || [], groups: g.data || [], applications: a.data || [], claims: c.data || [], loading: false });
    } catch (e) {
      this.setState({ loading: false, error: e.message });
    }
  }

  async post (path, payload) {
    const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(payload || {}) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json.data;
  }

  async act (fn, okMsg) {
    if (this.state.busy) return;
    this.setState({ busy: true, error: null, notice: null });
    try {
      await fn();
      this.setState({ busy: false, notice: okMsg || 'Done.' });
      await this.refresh();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  create () {
    return this.act(async () => {
      const group = this.state.groups.find((g) => g.id === this.state.groupId);
      const payload = {
        title: this.state.title.trim(),
        reward: Math.max(0, Math.floor(Number(this.state.reward) || 0)),
        groupId: group ? group.id : null,
        createdBy: this.state.pubkey || undefined,
        // Group missions: the GROUP is the authority — its k-of-n multisig
        // both approves completion and controls the escrow address.
        authorities: (group && Array.isArray(group.members))
          ? { keys: group.members, threshold: group.threshold || 1 }
          : undefined
      };
      const mission = await this.post('/missions', payload);
      if (this.state.attachEscrow && payload.reward > 0) {
        await this.post(`/missions/${mission.id}/escrow`, { amountSats: payload.reward, actor: this.state.pubkey });
      }
      this.setState({ showCreate: false, title: '', reward: '', groupId: '', attachEscrow: false });
    }, 'Mission created.');
  }

  /** Approve completion: sign the canonical acceptance message (BIP340). */
  approve (mission, claim) {
    return this.act(async () => {
      const b = bridge();
      if (!b || !b.signMessage) throw new Error('Approval needs the desktop app (identity signing)');
      const message = JSON.stringify({ action: 'mission.accept', missionId: mission.id, claimId: claim.id, claimantId: claim.claimantId });
      const signed = await b.signMessage(message);
      if (signed.error) throw new Error(signed.error);
      await this.post(`/claims/${claim.id}/validate`, {
        decision: 'approve',
        signatures: { [signed.pubkey]: signed.signature },
        officerId: this.state.pubkey
      });
    }, 'Completion approved — reward unlocked.');
  }

  async buildPayout (mission) {
    return this.act(async () => {
      const toAddress = (this.state.payoutAddr[mission.id] || '').trim() || undefined;
      const built = await this.post(`/missions/${mission.id}/payout`, { toAddress });
      this.setState({ psbt: Object.assign({}, this.state.psbt, { [mission.id]: built.psbt }) });
    }, 'Payout PSBT built — authorities sign it with their own wallets.');
  }

  renderEscrow (m) {
    const e = m.escrow;
    if (!e) return null;
    const claim = this.state.claims.find((c) => c.missionId === m.id && c.status === 'accepted');
    return React.createElement('div', { className: 'mi-esc' },
      React.createElement('div', { className: 'mi-row' },
        React.createElement('span', { className: 'mi-tag btc' }, '₿ escrow ' + e.status),
        React.createElement('span', null, SATS(e.amountSats)),
        React.createElement('span', { style: { color: 'var(--muted)' } }, `${e.threshold}-of-${(e.keys || []).length} · ${e.network} · ${e.mode}`)
      ),
      e.address
        ? React.createElement('div', null, 'fund: ', React.createElement('code', null, e.address))
        : React.createElement('div', { style: { color: 'var(--muted)' } }, 'ledger obligation — settles out-of-band (connect bitcoind for on-chain escrow)'),
      e.status === 'payable' && e.mode === 'bitcoin'
        ? React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'mi-row' },
            React.createElement('input', {
              style: { flex: 1, background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 7, padding: '7px 9px', fontSize: 12 },
              placeholder: claim ? `payout address for ${claim.claimantId.slice(0, 10)}…` : 'payout address',
              value: this.state.payoutAddr[m.id] || '',
              onChange: (ev) => this.setState({ payoutAddr: Object.assign({}, this.state.payoutAddr, { [m.id]: ev.target.value }) })
            }),
            React.createElement('button', { className: 'mi-btn good', disabled: this.state.busy, onClick: () => this.buildPayout(m) }, 'Build payout PSBT')
          ),
          this.state.psbt[m.id]
            ? React.createElement('textarea', { className: 'mi-psbt', readOnly: true, value: this.state.psbt[m.id] })
            : null
        )
        : null,
      e.status === 'paid' ? React.createElement('div', null, 'paid — txid ', React.createElement('code', null, e.payoutTxid)) : null
    );
  }

  renderMission (m) {
    const me = this.state.pubkey;
    const apps = this.state.applications.filter((a) => a.missionId === m.id && a.status === 'pending');
    const claim = this.state.claims.find((c) => c.missionId === m.id && c.status === 'pending');
    const isCreator = me && m.createdBy === me;
    const isAssignee = me && m.assigneeId === me;
    const isAuthority = me && m.authorities && (m.authorities.keys || []).includes(me);
    const applied = this.state.applications.some((a) => a.missionId === m.id && a.applicantId === me && a.status === 'pending');

    return React.createElement('div', { className: 'mi-m', key: m.id },
      React.createElement('div', { className: 'mi-mh' },
        React.createElement('span', { className: 'mi-tag ' + (m.status || 'open') }, m.status),
        React.createElement('span', { className: 'mi-title' }, m.title),
        m.reward ? React.createElement('span', { className: 'mi-tag btc' }, '₿ ' + SATS(m.reward)) : null,
        m.groupId ? React.createElement('span', { className: 'mi-tag open' }, 'group') : null,
        m.authorities ? React.createElement('span', { style: { color: 'var(--muted)', fontSize: 11 } }, `${m.authorities.threshold}-of-${m.authorities.keys.length} authorities`) : null
      ),
      React.createElement('div', { className: 'mi-meta' }, m.id + (m.assigneeId ? ` · assignee ${m.assigneeId.slice(0, 12)}…` : '')),
      React.createElement('div', { className: 'mi-row' },
        m.status === 'open' && me && !isCreator && !applied
          ? React.createElement('button', { className: 'mi-btn ghost', disabled: this.state.busy, onClick: () => this.act(() => this.post(`/missions/${m.id}/apply`, { applicantId: me }), 'Applied.') }, 'Apply')
          : null,
        applied ? React.createElement('span', { style: { color: 'var(--muted)', fontSize: 12 } }, 'application pending') : null,
        ...apps.map((a) => (isCreator || isAuthority)
          ? React.createElement('button', {
            className: 'mi-btn', key: a.id, disabled: this.state.busy,
            onClick: () => this.act(() => this.post(`/applications/${a.id}/decision`, { decision: 'accept', officerId: me }), 'Assigned.')
          }, `Accept ${a.applicantId.slice(0, 10)}…`)
          : null),
        m.status === 'assigned' && isAssignee && !claim
          ? React.createElement('button', { className: 'mi-btn', disabled: this.state.busy, onClick: () => this.act(() => this.post(`/missions/${m.id}/claim`, { claimantId: me }), 'Completion submitted — awaiting approval.') }, '✔ Submit completion')
          : null,
        claim && isAuthority
          ? React.createElement('button', { className: 'mi-btn good', disabled: this.state.busy, onClick: () => this.approve(m, claim) }, '✓ Approve completion (sign)')
          : null,
        claim && !isAuthority
          ? React.createElement('span', { style: { color: 'var(--muted)', fontSize: 12 } }, 'completion submitted — awaiting authority signatures')
          : null
      ),
      this.renderEscrow(m)
    );
  }

  renderCreate () {
    if (!this.state.showCreate) return null;
    const rewardSats = Math.floor(Number(this.state.reward) || 0);
    return React.createElement('div', { className: 'mi-body', style: { borderBottom: '1px solid var(--line)' } },
      React.createElement('div', { className: 'mi-field' },
        React.createElement('label', null, 'Title'),
        React.createElement('input', { value: this.state.title, placeholder: 'Escort the Hull-C from Crusader…', onChange: (e) => this.setState({ title: e.target.value }) })
      ),
      React.createElement('div', { className: 'mi-row' },
        React.createElement('div', { className: 'mi-field', style: { flex: 1 } },
          React.createElement('label', null, 'Bitcoin reward (sats, optional)'),
          React.createElement('input', { type: 'number', min: 0, value: this.state.reward, placeholder: '50000', onChange: (e) => this.setState({ reward: e.target.value }) })
        ),
        React.createElement('div', { className: 'mi-field', style: { flex: 1 } },
          React.createElement('label', null, 'Group (authorities = group k-of-n)'),
          React.createElement('select', { value: this.state.groupId, onChange: (e) => this.setState({ groupId: e.target.value }) },
            React.createElement('option', { value: '' }, 'none — I approve alone (1-of-1)'),
            this.state.groups.filter((g) => Array.isArray(g.members)).map((g) =>
              React.createElement('option', { key: g.id, value: g.id }, `${g.name} (${g.threshold}-of-${g.members.length})`))
          )
        )
      ),
      React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, cursor: 'pointer', marginBottom: 10 } },
        React.createElement('input', { type: 'checkbox', checked: this.state.attachEscrow, disabled: !rewardSats, onChange: (e) => this.setState({ attachEscrow: e.target.checked }) }),
        'Escrow the reward — derive the authorities\' multisig address now'
      ),
      React.createElement('div', { className: 'mi-row' },
        React.createElement('button', { className: 'mi-btn', disabled: !this.state.title.trim() || this.state.busy, onClick: () => this.create() }, 'Create mission'),
        React.createElement('button', { className: 'mi-btn ghost', onClick: () => this.setState({ showCreate: false }) }, 'Cancel')
      )
    );
  }

  render () {
    return React.createElement('div', { className: 'mi-wrap' },
      React.createElement('div', { className: 'mi-panel' },
        React.createElement('h2', null, '⭐ Mission register',
          React.createElement('span', { className: 'sub' }, '— post work, attach a Bitcoin reward, and unlock it with authority signatures on completion'),
          React.createElement('button', { className: 'mi-btn', onClick: () => this.setState({ showCreate: !this.state.showCreate }) },
            this.state.showCreate ? 'Close' : '+ New mission')
        ),
        this.renderCreate(),
        this.state.error ? React.createElement('div', { className: 'mi-body' }, React.createElement('div', { className: 'mi-err' }, this.state.error)) : null,
        this.state.notice ? React.createElement('div', { className: 'mi-body' }, React.createElement('div', { className: 'mi-ok' }, this.state.notice)) : null,
        this.state.missions.length
          ? this.state.missions.slice().reverse().map((m) => this.renderMission(m))
          : React.createElement('div', { className: 'mi-body', style: { color: 'var(--muted)', fontStyle: 'italic' } },
            this.state.loading ? 'loading…' : 'No missions yet — post the first contract.')
      )
    );
  }
}

Missions.CSS = CSS;

module.exports = Missions;
