'use strict';

/**
 * Missions — the officer-validated register with Bitcoin-unlocked rewards.
 *
 * Flow surfaced here (backed by MissionManager + PayoutManager):
 *   create (reward sats, optional group authorities + escrow)
 *     → apply / broadcast join (many participants)
 *     → SUBMIT COMPLETION (individual or completion-group payee)
 *     → APPROVE ONE claim (k-of-n Schnorr) → other pending claims superseded
 *     → escrow flips payable → payout PSBT (claimant address or group wallet)
 *
 * Approval signatures come from the desktop identity (BIP340 via
 * `identity.signMessage`); the coins unlock only when the mission's
 * authority threshold is met — the server never holds keys.
 */

const React = require('react');
const MissionOutcomesChart = require('./MissionOutcomesChart');
const { isMissionApprover, isMyMission } = require('../functions/missionRole');
const { topPilots } = require('../functions/missionCharts');

const BASE = '/services/star-citizen';

const CSS = `
  .mi-wrap{width:100%;max-width:none;margin:0;padding:12px 14px 72px;display:grid;gap:14px;box-sizing:border-box}
  .mi-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .mi-panel h2{font-size:13px;margin:0;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:600;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .mi-panel h2 .sub{color:var(--muted);font-weight:400;font-size:12px;flex:1;min-width:120px}
  .mi-body{padding:14px 16px}
  .mi-btn{background:var(--accent);border:none;color:#fff;border-radius:7px;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}
  .mi-btn:disabled{opacity:.45;cursor:default}
  .mi-btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
  .mi-btn.good{background:var(--good)}
  .mi-btn.warn{background:transparent;border:1px solid rgba(248,81,73,.45);color:var(--kill)}
  .mi-field{display:grid;gap:4px;margin-bottom:10px}
  .mi-field label{font-size:12px;color:var(--muted)}
  .mi-field input,.mi-field select{background:var(--bg);border:1px solid var(--line);color:var(--text);border-radius:7px;padding:8px 10px;font-size:13px}
  .mi-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .mi-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:8px 11px;font-size:12.5px;margin-top:8px}
  .mi-ok{background:rgba(63,185,80,.12);color:var(--good);border-radius:7px;padding:8px 11px;font-size:12.5px;margin-top:8px}
  .mi-m{border-bottom:1px solid #20262f;padding:12px 16px;display:grid;gap:8px}
  .mi-m:last-child{border-bottom:none}
  .mi-m.cancelled{opacity:.72}
  .mi-mh{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .mi-title{font-weight:600;font-size:14px;flex:1;min-width:140px;cursor:pointer;color:var(--text);text-decoration:none;background:none;border:none;padding:0;font:inherit;text-align:left}
  .mi-title:hover{color:var(--accent)}
  .mi-tag{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:5px}
  .mi-tag.open{background:rgba(59,130,246,.18);color:var(--accent)}
  .mi-tag.assigned,.mi-tag.in_progress{background:rgba(210,153,34,.18);color:var(--warn)}
  .mi-tag.completed{background:rgba(63,185,80,.15);color:var(--good)}
  .mi-tag.cancelled{background:rgba(110,118,129,.18);color:var(--muted)}
  .mi-tag.btc{background:rgba(247,147,26,.16);color:#f7931a}
  .mi-tag.log{background:rgba(139,148,158,.16);color:var(--muted)}
  .mi-meta{color:var(--muted);font-size:11.5px;font-family:'Cascadia Code',Consolas,monospace;word-break:break-all}
  .mi-esc{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px 12px;display:grid;gap:6px;font-size:12.5px}
  .mi-esc code{font-size:11px;word-break:break-all}
  .mi-esc input{background:var(--bg);border:1px solid var(--line);color:var(--text);border-radius:7px;padding:7px 9px;font-size:12px}
  .mi-psbt{width:100%;min-height:64px;background:var(--bg);border:1px solid var(--line);color:var(--text);border-radius:7px;padding:8px;font-family:'Cascadia Code',Consolas,monospace;font-size:10.5px}
  .mi-filter{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 16px;border-bottom:1px solid var(--line);font-size:12px;color:var(--muted)}
  .mi-filter button{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:999px;padding:3px 10px;font-size:11.5px;cursor:pointer}
  .mi-filter button.on{border-color:var(--accent);color:var(--accent)}
  .mi-lbr{display:grid;grid-template-columns:1fr 72px 86px 56px;gap:8px;align-items:center;padding:6px 8px;font-size:12.5px;border-radius:6px}
  .mi-lbr.head{color:var(--muted);font-size:11px}
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
      psbt: {},
      // claim form keyed by mission id
      claimGroup: {},
      claimNote: {},
      claimOpen: {},
      reviewNote: {},
      // Hide cancelled register rows by default — clutter from probes / abandoned drafts.
      showCancelled: false,
      // all | mine | posted | gamelog
      sourceFilter: 'all'
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

  me () {
    return this.state.pubkey || this.props.identityPubkey || null;
  }

  /** Approve completion: sign the canonical acceptance message (BIP340). */
  approve (mission, claim) {
    return this.act(async () => {
      const b = bridge();
      if (!b || !b.signMessage) throw new Error('Approval needs the desktop app (identity signing)');
      const message = JSON.stringify({
        action: 'mission.accept',
        missionId: mission.id,
        claimId: claim.id,
        claimantId: claim.claimantId,
        completionGroupId: claim.completionGroupId || null
      });
      const signed = await b.signMessage(message);
      if (signed.error) throw new Error(signed.error);
      await this.post(`/claims/${claim.id}/validate`, {
        decision: 'approve',
        signatures: { [signed.pubkey]: signed.signature },
        officerId: this.me(),
        note: (this.state.reviewNote[claim.id] || '').trim() || undefined
      });
    }, 'Completion approved — reward unlocked.');
  }

  reject (mission, claim) {
    return this.act(async () => {
      await this.post(`/claims/${claim.id}/validate`, {
        decision: 'reject',
        note: (this.state.reviewNote[claim.id] || '').trim() || undefined,
        officerId: this.me()
      });
    }, 'Completion rejected — claimant may resubmit.');
  }

  submitCompletion (mission) {
    const me = this.me();
    return this.act(async () => {
      const completionGroupId = (this.state.claimGroup[mission.id] || '').trim() || undefined;
      const note = (this.state.claimNote[mission.id] || '').trim();
      await this.post(`/missions/${mission.id}/claim`, {
        claimantId: me,
        note: note || undefined,
        completionGroupId
      });
      this.setState({
        claimOpen: Object.assign({}, this.state.claimOpen, { [mission.id]: false }),
        claimGroup: Object.assign({}, this.state.claimGroup, { [mission.id]: '' }),
        claimNote: Object.assign({}, this.state.claimNote, { [mission.id]: '' })
      });
    }, 'Completion submitted — awaiting authority approval.');
  }

  async buildPayout (mission) {
    return this.act(async () => {
      const e = mission.escrow || {};
      const toAddress = e.payeeKind === 'group'
        ? (e.payeeAddress || undefined)
        : ((this.state.payoutAddr[mission.id] || '').trim() || e.payeeAddress || undefined);
      const built = await this.post(`/missions/${mission.id}/payout`, { toAddress });
      this.setState({ psbt: Object.assign({}, this.state.psbt, { [mission.id]: built.psbt }) });
    }, 'Payout PSBT built — authorities sign it with their own wallets.');
  }

  myGroups () {
    const me = this.me();
    if (!me) return [];
    return (this.state.groups || []).filter((g) => Array.isArray(g.members) && g.members.includes(me));
  }

  renderEscrow (m) {
    const e = m.escrow;
    if (!e) return null;
    const claim = this.state.claims.find((c) => c.missionId === m.id && (c.status === 'validated' || c.id === e.claimId));
    const groupPayee = e.payeeKind === 'group';
    return React.createElement('div', { className: 'mi-esc' },
      React.createElement('div', { className: 'mi-row' },
        React.createElement('span', { className: 'mi-tag btc' }, '₿ escrow ' + e.status),
        React.createElement('span', null, SATS(e.amountSats)),
        React.createElement('span', { style: { color: 'var(--muted)' } }, `${e.threshold}-of-${(e.keys || []).length} · ${e.network} · ${e.mode}`)
      ),
      e.address
        ? React.createElement('div', null, 'fund: ', React.createElement('code', null, e.address))
        : React.createElement('div', { style: { color: 'var(--muted)' } }, 'ledger obligation — settles out-of-band (connect bitcoind for on-chain escrow)'),
      e.status === 'payable' && groupPayee
        ? React.createElement('div', null,
          'payee: group wallet',
          e.payeeAddress
            ? React.createElement('code', null, ' ' + e.payeeAddress)
            : React.createElement('span', { style: { color: 'var(--muted)' } }, ' (deriving…)'),
          e.completionGroupId
            ? React.createElement('span', { style: { color: 'var(--muted)' } }, ` · ${e.completionGroupId.slice(0, 12)}…`)
            : null
        )
        : null,
      e.status === 'payable' && e.mode === 'bitcoin'
        ? React.createElement(React.Fragment, null,
          groupPayee
            ? React.createElement('div', { className: 'mi-row' },
              React.createElement('button', {
                className: 'mi-btn good',
                disabled: this.state.busy || !e.payeeAddress,
                onClick: () => this.buildPayout(m)
              }, 'Build payout PSBT (group wallet)')
            )
            : React.createElement('div', { className: 'mi-row' },
              React.createElement('input', {
                style: { flex: 1, background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 7, padding: '7px 9px', fontSize: 12 },
                placeholder: claim ? `payout address for ${String(claim.claimantId).slice(0, 10)}…` : 'payout address',
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

  renderClaimForm (m) {
    if (!this.state.claimOpen[m.id]) return null;
    const myGroups = this.myGroups();
    return React.createElement('div', { className: 'mi-esc', style: { marginTop: 4 } },
      React.createElement('div', { className: 'mi-field' },
        React.createElement('label', null, 'Note (optional)'),
        React.createElement('input', {
          value: this.state.claimNote[m.id] || '',
          placeholder: 'Done — evidence in session…',
          onChange: (e) => this.setState({ claimNote: Object.assign({}, this.state.claimNote, { [m.id]: e.target.value }) })
        })
      ),
      React.createElement('div', { className: 'mi-field' },
        React.createElement('label', null, 'Completion group (optional — payout to group wallet)'),
        React.createElement('select', {
          value: this.state.claimGroup[m.id] || '',
          onChange: (e) => this.setState({ claimGroup: Object.assign({}, this.state.claimGroup, { [m.id]: e.target.value }) })
        },
          React.createElement('option', { value: '' }, 'Individual — pay me'),
          myGroups.map((g) => React.createElement('option', { key: g.id, value: g.id },
            `${g.name || g.id} (${g.threshold || 1}-of-${(g.members || []).length})`))
        )
      ),
      React.createElement('div', { className: 'mi-row' },
        React.createElement('button', {
          className: 'mi-btn',
          disabled: this.state.busy,
          onClick: () => this.submitCompletion(m)
        }, 'Submit completion'),
        React.createElement('button', {
          className: 'mi-btn ghost',
          onClick: () => this.setState({ claimOpen: Object.assign({}, this.state.claimOpen, { [m.id]: false }) })
        }, 'Cancel')
      )
    );
  }

  renderMission (m) {
    const me = this.me();
    const apps = this.state.applications.filter((a) => a.missionId === m.id && a.status === 'pending');
    const pendingClaims = this.state.claims.filter((c) => c.missionId === m.id && c.status === 'pending');
    const participants = Array.isArray(m.participantIds) && m.participantIds.length
      ? m.participantIds
      : (m.assigneeId ? [m.assigneeId] : []);
    const isCreator = me && m.createdBy === me;
    const fromLog = m.source === 'gamelog';
    // Orphan rows (createdBy null) — e.g. unauthenticated LAN creates — anyone
    // with an unlocked local identity can cancel in bootstrap officer mode.
    // Game.log rows are also cancellable locally (does not rewrite the log).
    const canCancel = !!me && m.status !== 'cancelled' && m.status !== 'completed' &&
      (isCreator || !m.createdBy || fromLog);
    const isParticipant = me && participants.includes(me);
    const isApprover = isMissionApprover(m, me);
    const applied = this.state.applications.some((a) => a.missionId === m.id && a.applicantId === me && a.status === 'pending');
    const joinable = !fromLog && (m.status === 'open' || m.status === 'assigned' || m.status === 'in_progress');
    const myPendingClaim = pendingClaims.find((c) => c.claimantId === me);
    const canSubmit = joinable && me && !myPendingClaim && m.status !== 'completed' &&
      (isParticipant || isCreator);

    return React.createElement('div', {
      className: 'mi-m' + (m.status === 'cancelled' ? ' cancelled' : ''),
      key: m.id
    },
      React.createElement('div', { className: 'mi-mh' },
        React.createElement('span', { className: 'mi-tag ' + (m.status || 'open') }, m.status),
        React.createElement('button', {
          type: 'button',
          className: 'mi-title',
          title: 'Open mission page',
          onClick: () => { window.location.href = `/missions/${encodeURIComponent(m.id)}`; }
        }, m.title),
        m.reward ? React.createElement('span', { className: 'mi-tag btc' }, '₿ ' + SATS(m.reward)) : null,
        m.groupId ? React.createElement('span', { className: 'mi-tag open' }, 'group') : null,
        fromLog
          ? React.createElement('span', {
            className: 'mi-tag log',
            title: m.generator
              ? ('Tracked from Game.log · ' + m.generator)
              : 'Tracked from Game.log (evidence — not an officer post)'
          }, m.outcome ? ('log · ' + m.outcome) : 'from log')
          : null,
        !fromLog && !m.createdBy && m.status !== 'cancelled'
          ? React.createElement('span', {
            className: 'mi-tag cancelled',
            title: 'No creator on record (often from unauthenticated LAN create)'
          }, 'orphan')
          : null,
        m.faction && fromLog
          ? React.createElement('span', { style: { color: 'var(--muted)', fontSize: 11 } }, m.faction)
          : null,
        participants.length
          ? React.createElement('span', { style: { color: 'var(--muted)', fontSize: 11 } }, `${participants.length} in`)
          : null,
        m.authorities ? React.createElement('span', { style: { color: 'var(--muted)', fontSize: 11 } }, `${m.authorities.threshold}-of-${m.authorities.keys.length} authorities`) : null
      ),
      React.createElement('div', {
        className: 'mi-meta',
        style: { cursor: 'pointer' },
        title: 'Open mission page',
        onClick: () => { window.location.href = `/missions/${encodeURIComponent(m.id)}`; }
      }, m.id + (isParticipant || isCreator ? ' · you’re in' : '')),
      React.createElement('div', { className: 'mi-row' },
        joinable && isCreator
          ? React.createElement(React.Fragment, { key: 'bcast' },
            React.createElement('button', {
              className: 'mi-btn ghost',
              disabled: this.state.busy,
              title: 'Notify all connected Fabric peers that this mission is open',
              onClick: () => this.act(
                () => this.post(`/missions/${m.id}/broadcast`, { scope: 'global' }),
                'Shared to the network.'
              )
            }, 'Share to network'),
            m.groupId
              ? React.createElement('button', {
                className: 'mi-btn ghost',
                disabled: this.state.busy,
                title: 'Notify members of this mission\'s group and its subgroups',
                onClick: () => this.act(
                  () => this.post(`/missions/${m.id}/broadcast`, { scope: 'group', groupId: m.groupId }),
                  'Shared to the group.'
                )
              }, 'Share to group')
              : null
          )
          : null,
        canCancel
          ? React.createElement('button', {
            className: 'mi-btn warn',
            disabled: this.state.busy,
            title: isCreator
              ? 'Cancel this mission'
              : 'Cancel orphan mission (no creator on record)',
            onClick: () => this.act(
              () => this.post(`/missions/${m.id}/cancel`, { officerId: me }),
              'Mission cancelled.'
            )
          }, 'Cancel')
          : null,
        joinable && me && !isCreator && !applied && !isParticipant
          ? React.createElement('button', {
            className: 'mi-btn ghost',
            disabled: this.state.busy,
            onClick: () => this.act(() => this.post(`/missions/${m.id}/apply`, { applicantId: me }), 'Applied.')
          }, 'Apply')
          : null,
        applied ? React.createElement('span', { style: { color: 'var(--muted)', fontSize: 12 } }, 'application pending') : null,
        (isParticipant || isCreator) && joinable
          ? React.createElement('span', { style: { color: 'var(--good)', fontSize: 12 } }, 'You’re in')
          : null,
        ...apps.map((a) => (isCreator || isApprover)
          ? React.createElement('button', {
            className: 'mi-btn', key: a.id, disabled: this.state.busy,
            onClick: () => this.act(() => this.post(`/applications/${a.id}/decision`, { decision: 'accept', officerId: me }), 'Participant accepted.')
          }, `Accept ${a.applicantId.slice(0, 10)}…`)
          : null),
        canSubmit
          ? React.createElement('button', {
            className: 'mi-btn',
            disabled: this.state.busy,
            onClick: () => this.setState({ claimOpen: Object.assign({}, this.state.claimOpen, { [m.id]: true }) })
          }, '✔ Submit completion')
          : null,
        myPendingClaim
          ? React.createElement('span', { style: { color: 'var(--warn)', fontSize: 12 } }, 'Completion submitted — awaiting review')
          : null
      ),
      this.renderClaimForm(m),
      this.renderClaimReview(m, pendingClaims, isApprover),
      this.renderEscrow(m)
    );
  }

  renderClaimReview (m, pendingClaims, isApprover) {
    if (!pendingClaims || !pendingClaims.length) return null;
    return React.createElement('div', { className: 'mi-esc', style: { marginTop: 4 } },
      React.createElement('div', { style: { fontWeight: 600, fontSize: 12.5 } },
        isApprover ? 'Review completions' : 'Pending completions'),
      ...pendingClaims.map((c) => React.createElement('div', { key: c.id, style: { display: 'grid', gap: 6 } },
        React.createElement('div', { className: 'mi-meta' },
          String(c.claimantId).slice(0, 16) + '…' +
          (c.completionGroupId ? ' · group payee' : '') +
          (c.note ? (' · “' + String(c.note).slice(0, 120) + '”') : ' · (no note)')
        ),
        isApprover
          ? React.createElement(React.Fragment, null,
            React.createElement('input', {
              value: this.state.reviewNote[c.id] || '',
              placeholder: 'Review note (optional)',
              onChange: (e) => this.setState({
                reviewNote: Object.assign({}, this.state.reviewNote, { [c.id]: e.target.value })
              })
            }),
            React.createElement('div', { className: 'mi-row' },
              React.createElement('button', {
                className: 'mi-btn good',
                disabled: this.state.busy,
                onClick: () => this.approve(m, c)
              }, 'Approve'),
              React.createElement('button', {
                className: 'mi-btn warn',
                disabled: this.state.busy,
                onClick: () => this.reject(m, c)
              }, 'Reject')
            )
          )
          : React.createElement('div', { style: { color: 'var(--muted)', fontSize: 12 } },
            'Awaiting authority review')
      ))
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

  renderTopPilots () {
    const analytics = this.props.analytics || null;
    const rows = topPilots(
      analytics && analytics.missions,
      analytics && analytics.deaths,
      { limit: 10 }
    );
    return React.createElement('div', { className: 'mi-panel' },
      React.createElement('h2', null, '🏅 Top pilots ',
        React.createElement('span', { className: 'sub' }, '— from Game.log cumulative history')),
      React.createElement('div', { className: 'mi-body' },
        !analytics
          ? React.createElement('div', { style: { color: 'var(--muted)', fontStyle: 'italic' } },
            'Loading activity…')
          : (!rows.length
            ? React.createElement('div', { style: { color: 'var(--muted)', fontStyle: 'italic' } },
              'No pilot activity yet — import logs on Home or fly to accumulate missions.')
            : React.createElement(React.Fragment, null,
              React.createElement('div', { className: 'mi-lbr head' },
                React.createElement('span', null, 'pilot'),
                React.createElement('span', { style: { textAlign: 'right' } }, 'missions'),
                React.createElement('span', { style: { textAlign: 'right' } }, 'completion'),
                React.createElement('span', { style: { textAlign: 'right' } }, 'deaths')
              ),
              rows.map((r) => {
                const pc = r.tot ? Math.round(100 * r.done / r.tot) : 0;
                return React.createElement('div', { className: 'mi-lbr', key: r.n },
                  React.createElement('span', null, r.n),
                  React.createElement('span', { style: { textAlign: 'right' } }, r.tot),
                  React.createElement('span', { style: { textAlign: 'right' } }, pc + '%'),
                  React.createElement('span', { style: { textAlign: 'right' } }, r.deaths)
                );
              })
            ))
      )
    );
  }

  render () {
    const me = this.me();
    const cancelled = (this.state.missions || []).filter((m) => m && m.status === 'cancelled');
    const fromLog = (this.state.missions || []).filter((m) => m && m.source === 'gamelog');
    const posted = (this.state.missions || []).filter((m) => m && m.source !== 'gamelog');
    const mineOf = (m) => isMyMission(m, me, {
      hasPendingApplication: (this.state.applications || []).some((a) => a.missionId === m.id && a.applicantId === me && a.status === 'pending'),
      hasPendingClaim: (this.state.claims || []).some((c) => c.missionId === m.id && c.status === 'pending')
    });
    const mine = (this.state.missions || []).filter((m) => m && mineOf(m));
    const sourceFilter = this.state.sourceFilter || 'all';
    const visible = (this.state.missions || []).filter((m) => {
      if (!m) return false;
      if (m.status === 'cancelled' && !this.state.showCancelled) return false;
      if (sourceFilter === 'gamelog' && m.source !== 'gamelog') return false;
      if (sourceFilter === 'posted' && m.source === 'gamelog') return false;
      if (sourceFilter === 'mine' && !mineOf(m)) return false;
      return true;
    });
    return React.createElement('div', { className: 'mi-wrap' },
      React.createElement('div', { className: 'mi-panel' },
        React.createElement('h2', null, '🎯 Game.log outcomes ',
          React.createElement('span', { className: 'sub' }, '— cumulative from Home → Missions stats')),
        React.createElement('div', { className: 'mi-body' },
          React.createElement(MissionOutcomesChart, {
            analytics: this.props.analytics || null,
            subtitle: 'Parsed in-game mission ends (not the officer register below).'
          })
        )
      ),
      this.renderTopPilots(),
      React.createElement('div', { className: 'mi-panel' },
        React.createElement('h2', null, '⭐ Mission register',
          React.createElement('span', { className: 'sub' },
            '— officer posts plus Game.log missions (log rows are evidence; rewards still need authority approval)'),
          React.createElement('button', { className: 'mi-btn', onClick: () => this.setState({ showCreate: !this.state.showCreate }) },
            this.state.showCreate ? 'Close' : '+ New mission')
        ),
        React.createElement('div', { className: 'mi-filter' },
          React.createElement('button', {
            type: 'button',
            className: sourceFilter === 'all' ? 'on' : '',
            onClick: () => this.setState({ sourceFilter: 'all' })
          }, `All (${posted.length + fromLog.length})`),
          React.createElement('button', {
            type: 'button',
            className: sourceFilter === 'mine' ? 'on' : '',
            onClick: () => this.setState({ sourceFilter: 'mine' })
          }, `My missions (${mine.length})`),
          React.createElement('button', {
            type: 'button',
            className: sourceFilter === 'posted' ? 'on' : '',
            onClick: () => this.setState({ sourceFilter: 'posted' })
          }, `Posted (${posted.length})`),
          React.createElement('button', {
            type: 'button',
            className: sourceFilter === 'gamelog' ? 'on' : '',
            onClick: () => this.setState({ sourceFilter: 'gamelog' })
          }, `From log (${fromLog.length})`),
          cancelled.length
            ? React.createElement('button', {
              type: 'button',
              className: this.state.showCancelled ? 'on' : '',
              onClick: () => this.setState({ showCancelled: !this.state.showCancelled })
            }, this.state.showCancelled
              ? `Hide cancelled (${cancelled.length})`
              : `Show cancelled (${cancelled.length})`)
            : null
        ),
        this.renderCreate(),
        this.state.error ? React.createElement('div', { className: 'mi-body' }, React.createElement('div', { className: 'mi-err' }, this.state.error)) : null,
        this.state.notice ? React.createElement('div', { className: 'mi-body' }, React.createElement('div', { className: 'mi-ok' }, this.state.notice)) : null,
        visible.length
          ? visible.slice().reverse().map((m) => this.renderMission(m))
          : React.createElement('div', { className: 'mi-body', style: { color: 'var(--muted)', fontStyle: 'italic' } },
            this.state.loading
              ? 'loading…'
              : (cancelled.length && !this.state.showCancelled
                ? 'No open missions — show cancelled to review closed ones.'
                : (sourceFilter === 'mine'
                  ? 'No missions of yours in this list — create one, apply, or wait for a completion to review.'
                  : 'No missions yet — fly to collect Game.log missions, or post the first contract.')))
      )
    );
  }
}

Missions.CSS = CSS + (MissionOutcomesChart.CSS || '');

module.exports = Missions;
