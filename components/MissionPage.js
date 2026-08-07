'use strict';

/**
 * Dedicated mission page — `/missions/:id`.
 * Opened from the Missions register list (and broadcasts / deep links).
 */

const React = require('react');
const RegisterEventLog = require('./RegisterEventLog');

const BASE = '/services/star-citizen';

const CSS = `
  .mpage{width:100%;max-width:none;margin:0;padding:12px 14px;display:grid;gap:16px;box-sizing:border-box}
  ${RegisterEventLog.CSS || ''}
  .mpage-back{color:var(--muted);font-size:13px;text-decoration:none;cursor:pointer;background:none;border:none;padding:0;font:inherit;text-align:left}
  .mpage-back:hover{color:var(--accent)}
  .mpage-hero{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:22px 24px}
  .mpage-hero h1{margin:0 0 8px;font-size:20px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .mpage-hero .sub{color:var(--muted);font-size:12.5px;line-height:1.5;word-break:break-all}
  .mpage-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .mpage-panel h2{font-size:13px;margin:0;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:600}
  .mpage-panel .body{padding:14px 16px;display:grid;gap:10px}
  .mpage-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:9px 12px;font-size:13px}
  .mpage-ok{background:rgba(63,185,80,.12);color:var(--good);border-radius:7px;padding:9px 12px;font-size:13px}
  .mpage-tag{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:5px;letter-spacing:.02em}
  .mpage-tag.open{background:rgba(56,139,253,.15);color:var(--accent)}
  .mpage-tag.assigned{background:rgba(210,153,34,.18);color:var(--warn)}
  .mpage-tag.completed{background:rgba(63,185,80,.15);color:var(--good)}
  .mpage-tag.cancelled,.mpage-tag.rejected{background:rgba(110,118,129,.18);color:var(--muted)}
  .mpage-tag.btc{background:rgba(210,153,34,.18);color:#d29922}
  .mpage-btn{background:var(--accent);border:none;color:#fff;border-radius:7px;padding:8px 14px;
    font-size:12.5px;font-weight:600;cursor:pointer}
  .mpage-btn:disabled{opacity:.45;cursor:default}
  .mpage-btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
  .mpage-btn.good{background:var(--good)}
  .mpage-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .mpage-kv{font-size:12.5px;color:var(--muted)}
  .mpage-kv b{color:var(--text);font-weight:600}
  .mpage-code{font-family:'Cascadia Code',Consolas,monospace;font-size:11.5px;word-break:break-all}
  .mpage-esc{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font-size:12.5px;display:grid;gap:6px}
  .mpage-esc code{font-size:11px;word-break:break-all}
`;

const SATS = (n) => Number(n || 0).toLocaleString();

function identityBridge () {
  return (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.identity) || null;
}

function shortKey (pk) {
  return pk ? pk.slice(0, 12) + '…' : '—';
}

class MissionPage extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      token: null,
      pubkey: null,
      mission: null,
      applications: [],
      claims: [],
      loading: true,
      error: null,
      notice: null,
      busy: false,
      payoutAddr: '',
      psbt: null,
      events: [],
      groups: [],
      claimGroup: '',
      claimNote: '',
      claimOpen: false
    };
  }

  get missionId () {
    const m = String((typeof window !== 'undefined' && window.location.pathname) || '').match(/^\/missions\/([^/]+)/);
    return (m && decodeURIComponent(m[1])) || this.props.missionId || null;
  }

  componentDidMount () {
    this.boot();
  }

  headers () {
    const h = { 'Content-Type': 'application/json' };
    if (this.state.token) h.Authorization = `Bearer ${this.state.token}`;
    return h;
  }

  async boot () {
    const b = identityBridge();
    if (b) {
      try {
        const info = await b.get();
        if (info && info.unlocked) {
          const envelope = await b.signEnvelope({ intent: 'login', ts: new Date().toISOString() });
          if (envelope && !envelope.error) {
            const res = await fetch(`${BASE}/auth`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(envelope)
            });
            if (res.ok) {
              const json = await res.json();
              this.setState({ token: json.data.token, pubkey: json.data.pubkey });
            }
          }
        }
      } catch (_) { /* locked */ }
    }
    await this.load();
  }

  async load () {
    const id = this.missionId;
    if (!id) {
      this.setState({ loading: false, error: 'Missing mission id' });
      return;
    }
    this.setState({ loading: true, error: null });
    try {
      const [mRes, aRes, cRes, eRes, gRes] = await Promise.all([
        fetch(`${BASE}/missions/${encodeURIComponent(id)}`, { headers: this.headers() })
          .then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
        fetch(`${BASE}/missions/${encodeURIComponent(id)}/applications`).then((r) => r.json()).catch(() => ({ data: [] })),
        fetch(`${BASE}/claims`).then((r) => r.json()).catch(() => ({ data: [] })),
        fetch(`${BASE}/inbox?missionId=${encodeURIComponent(id)}`).then((r) => r.json()).catch(() => ({ data: [] })),
        fetch(`${BASE}/groups`, { headers: this.headers() }).then((r) => r.json()).catch(() => ({ data: [] }))
      ]);
      if (!mRes.ok) throw new Error((mRes.j && mRes.j.error) || 'Mission not found');
      const claims = (cRes.data || []).filter((c) => c.missionId === id);
      this.setState({
        loading: false,
        mission: mRes.j.data,
        applications: aRes.data || [],
        claims,
        events: eRes.data || [],
        groups: gRes.data || [],
        error: null
      });
    } catch (e) {
      this.setState({ loading: false, error: e.message || String(e) });
    }
  }

  async post (path, payload) {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload || {})
    });
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
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  approve (claim) {
    const m = this.state.mission;
    if (!m || !claim) return;
    return this.act(async () => {
      const b = identityBridge();
      if (!b || !b.signMessage) throw new Error('Approval needs the desktop app (identity signing)');
      const message = JSON.stringify({
        action: 'mission.accept',
        missionId: m.id,
        claimId: claim.id,
        claimantId: claim.claimantId,
        completionGroupId: claim.completionGroupId || null
      });
      const signed = await b.signMessage(message);
      if (signed.error) throw new Error(signed.error);
      await this.post(`/claims/${claim.id}/validate`, {
        decision: 'approve',
        signatures: { [signed.pubkey]: signed.signature },
        officerId: this.state.pubkey
      });
    }, 'Completion approved — reward unlocked.');
  }

  goBack () {
    if (typeof window === 'undefined') return;
    if (window.history.length > 1) window.history.back();
    else window.location.href = '/#missions';
  }

  renderEscrow () {
    const m = this.state.mission;
    const e = m && m.escrow;
    if (!e) return null;
    const groupPayee = e.payeeKind === 'group';
    return React.createElement('div', { className: 'mpage-esc' },
      React.createElement('div', null, React.createElement('b', null, 'Escrow'), ' · ', e.status || 'pending'),
      e.address ? React.createElement('div', null, 'address ', React.createElement('code', null, e.address)) : null,
      e.amountSats != null ? React.createElement('div', null, SATS(e.amountSats), ' sats') : null,
      e.status === 'payable' && groupPayee
        ? React.createElement('div', null,
          'payee: group wallet ',
          e.payeeAddress
            ? React.createElement('code', null, e.payeeAddress)
            : React.createElement('span', { style: { color: 'var(--muted)' } }, '(unavailable)'))
        : null,
      e.status === 'payable'
        ? React.createElement('div', { className: 'mpage-row' },
          groupPayee
            ? null
            : React.createElement('input', {
              type: 'text',
              placeholder: 'payout address (optional)',
              value: this.state.payoutAddr,
              onChange: (ev) => this.setState({ payoutAddr: ev.target.value }),
              style: {
                flex: 1, background: 'var(--panel)', border: '1px solid var(--line)',
                color: 'var(--text)', borderRadius: 7, padding: '7px 10px', fontSize: 12
              }
            }),
          React.createElement('button', {
            className: 'mpage-btn ghost',
            disabled: this.state.busy || (groupPayee && !e.payeeAddress),
            onClick: () => this.act(async () => {
              const toAddress = groupPayee
                ? (e.payeeAddress || undefined)
                : (this.state.payoutAddr.trim() || e.payeeAddress || undefined);
              const built = await this.post(`/missions/${m.id}/payout`, { toAddress });
              this.setState({ psbt: built.psbt || null });
            }, 'Payout PSBT ready.')
          }, groupPayee ? 'Build payout (group)' : 'Build payout')
        )
        : null,
      this.state.psbt
        ? React.createElement('div', { className: 'mpage-code' }, 'PSBT: ', String(this.state.psbt).slice(0, 80), '…')
        : null,
      e.status === 'paid' ? React.createElement('div', null, 'paid — txid ', React.createElement('code', null, e.payoutTxid)) : null
    );
  }

  render () {
    if (this.state.loading) {
      return React.createElement('div', { className: 'mpage' },
        React.createElement('div', { style: { color: 'var(--muted)' } }, 'Loading mission…'));
    }
    if (this.state.error && !this.state.mission) {
      return React.createElement('div', { className: 'mpage' },
        React.createElement('button', { type: 'button', className: 'mpage-back', onClick: () => this.goBack() }, '← Back to missions'),
        React.createElement('div', { className: 'mpage-err' }, this.state.error)
      );
    }
    const m = this.state.mission;
    const me = this.state.pubkey;
    const apps = this.state.applications.filter((a) => a.status === 'pending');
    const pendingClaims = this.state.claims.filter((c) => c.status === 'pending');
    const participants = Array.isArray(m.participantIds) && m.participantIds.length
      ? m.participantIds
      : (m.assigneeId ? [m.assigneeId] : []);
    const isCreator = me && m.createdBy === me;
    const isParticipant = me && participants.includes(me);
    const isAuthority = me && m.authorities && (m.authorities.keys || []).includes(me);
    const applied = this.state.applications.some((a) => a.applicantId === me && a.status === 'pending');
    const joinable = m.status === 'open' || m.status === 'assigned' || m.status === 'in_progress';
    const myPendingClaim = pendingClaims.find((c) => c.claimantId === me);
    const myGroups = (this.state.groups || []).filter((g) => me && Array.isArray(g.members) && g.members.includes(me));

    return React.createElement('div', { className: 'mpage' },
      React.createElement('button', { type: 'button', className: 'mpage-back', onClick: () => this.goBack() }, '← Back to missions'),
      React.createElement('div', { className: 'mpage-hero' },
        React.createElement('h1', null,
          m.title || '(untitled)',
          React.createElement('span', { className: 'mpage-tag ' + (m.status || 'open') }, m.status || 'open'),
          m.reward ? React.createElement('span', { className: 'mpage-tag btc' }, '₿ ' + SATS(m.reward)) : null
        ),
        React.createElement('div', { className: 'sub' }, m.id)
      ),
      this.state.error ? React.createElement('div', { className: 'mpage-err' }, this.state.error) : null,
      this.state.notice ? React.createElement('div', { className: 'mpage-ok' }, this.state.notice) : null,
      React.createElement('div', { className: 'mpage-panel' },
        React.createElement('h2', null, 'Details'),
        React.createElement('div', { className: 'body' },
          React.createElement('div', { className: 'mpage-kv' },
            'Created by ', React.createElement('b', { className: 'mpage-code' }, shortKey(m.createdBy))),
          participants.length
            ? React.createElement('div', { className: 'mpage-kv' },
              'Participants ', React.createElement('b', null, String(participants.length)),
              isParticipant ? ' (you’re in)' : '')
            : null,
          m.groupId
            ? React.createElement('div', { className: 'mpage-kv' },
              'Group ', React.createElement('b', { className: 'mpage-code' }, m.groupId),
              m.authorities
                ? ` · ${m.authorities.threshold}-of-${(m.authorities.keys || []).length} authorities`
                : null)
            : null,
          m.createdAt
            ? React.createElement('div', { className: 'mpage-kv' }, 'Opened ', React.createElement('b', null, String(m.createdAt).slice(0, 19)))
            : null,
          this.renderEscrow()
        )
      ),
      React.createElement('div', { className: 'mpage-panel' },
        React.createElement('h2', null, 'Actions'),
        React.createElement('div', { className: 'body' },
          React.createElement('div', { className: 'mpage-row' },
            joinable && isCreator
              ? React.createElement(React.Fragment, null,
                React.createElement('button', {
                  className: 'mpage-btn ghost',
                  disabled: this.state.busy,
                  onClick: () => this.act(
                    () => this.post(`/missions/${m.id}/broadcast`, { scope: 'global' }),
                    'Shared to the network.'
                  )
                }, 'Share to network'),
                m.groupId
                  ? React.createElement('button', {
                    className: 'mpage-btn ghost',
                    disabled: this.state.busy,
                    onClick: () => this.act(
                      () => this.post(`/missions/${m.id}/broadcast`, { scope: 'group', groupId: m.groupId }),
                      'Shared to the group.'
                    )
                  }, 'Share to group')
                  : null
              )
              : null,
            joinable && me && !isCreator && !applied && !isParticipant
              ? React.createElement('button', {
                className: 'mpage-btn ghost',
                disabled: this.state.busy,
                onClick: () => this.act(
                  () => this.post(`/missions/${m.id}/apply`, { applicantId: me }),
                  'Applied.'
                )
              }, 'Apply')
              : null,
            applied ? React.createElement('span', { style: { color: 'var(--muted)', fontSize: 12 } }, 'application pending') : null,
            isParticipant && joinable
              ? React.createElement('span', { style: { color: 'var(--good)', fontSize: 12 } }, 'You’re in')
              : null,
            ...apps.map((a) => (isCreator || isAuthority)
              ? React.createElement('button', {
                className: 'mpage-btn',
                key: a.id,
                disabled: this.state.busy,
                onClick: () => this.act(
                  () => this.post(`/applications/${a.id}/decision`, { decision: 'accept', officerId: me }),
                  'Participant accepted.'
                )
              }, `Accept ${shortKey(a.applicantId)}`)
              : null),
            joinable && isParticipant && !myPendingClaim && m.status !== 'completed'
              ? React.createElement('button', {
                className: 'mpage-btn',
                disabled: this.state.busy,
                onClick: () => this.setState({ claimOpen: true })
              }, '✔ Submit completion')
              : null,
            ...pendingClaims.map((c) => (isAuthority
              ? React.createElement('button', {
                className: 'mpage-btn good',
                key: c.id,
                disabled: this.state.busy,
                onClick: () => this.approve(c)
              }, `✓ Approve ${shortKey(c.claimantId)}${c.completionGroupId ? ' (group)' : ''}`)
              : null)),
            pendingClaims.length && !isAuthority
              ? React.createElement('span', { style: { color: 'var(--muted)', fontSize: 12 } },
                `${pendingClaims.length} completion(s) awaiting authority signatures`)
              : null
          ),
          this.state.claimOpen
            ? React.createElement('div', { className: 'mpage-esc' },
              React.createElement('div', { className: 'mpage-kv' }, 'Note'),
              React.createElement('input', {
                value: this.state.claimNote,
                onChange: (e) => this.setState({ claimNote: e.target.value }),
                placeholder: 'Optional note',
                style: {
                  background: 'var(--panel)', border: '1px solid var(--line)',
                  color: 'var(--text)', borderRadius: 7, padding: '7px 10px', fontSize: 12
                }
              }),
              React.createElement('div', { className: 'mpage-kv' }, 'Completion group (optional)'),
              React.createElement('select', {
                value: this.state.claimGroup,
                onChange: (e) => this.setState({ claimGroup: e.target.value }),
                style: {
                  background: 'var(--panel)', border: '1px solid var(--line)',
                  color: 'var(--text)', borderRadius: 7, padding: '7px 10px', fontSize: 12
                }
              },
                React.createElement('option', { value: '' }, 'Individual — pay me'),
                myGroups.map((g) => React.createElement('option', { key: g.id, value: g.id },
                  `${g.name || g.id}`))
              ),
              React.createElement('div', { className: 'mpage-row' },
                React.createElement('button', {
                  className: 'mpage-btn',
                  disabled: this.state.busy,
                  onClick: () => this.act(async () => {
                    await this.post(`/missions/${m.id}/claim`, {
                      claimantId: me,
                      note: this.state.claimNote.trim() || undefined,
                      completionGroupId: this.state.claimGroup.trim() || undefined
                    });
                    this.setState({ claimOpen: false, claimGroup: '', claimNote: '' });
                  }, 'Completion submitted — awaiting approval.')
                }, 'Submit'),
                React.createElement('button', {
                  className: 'mpage-btn ghost',
                  onClick: () => this.setState({ claimOpen: false })
                }, 'Cancel')
              )
            )
            : null
        )
      ),
      apps.length
        ? React.createElement('div', { className: 'mpage-panel' },
          React.createElement('h2', null, 'Pending applications'),
          React.createElement('div', { className: 'body' },
            apps.map((a) => React.createElement('div', {
              key: a.id,
              className: 'mpage-code',
              style: { marginBottom: 4 }
            }, a.applicantId, a.message ? ` — ${a.message}` : ''))
          )
        )
        : null,
      React.createElement('div', { className: 'mpage-panel' },
        React.createElement('h2', null, 'Activity'),
        React.createElement('div', { className: 'body' },
          React.createElement(RegisterEventLog, {
            items: this.state.events,
            empty: 'No mission events yet — applications, acceptances, and claims will appear here.'
          })
        )
      )
    );
  }
}

MissionPage.CSS = CSS;
MissionPage.missionIdFromLocation = function () {
  const m = String((typeof window !== 'undefined' && window.location.pathname) || '').match(/^\/missions\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

module.exports = MissionPage;
