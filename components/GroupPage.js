'use strict';

/**
 * Dedicated group page — `/groups/:id` (or `/groups/:slug`).
 *
 * Public groups: anyone can view a summary and apply to join (with an unlocked
 * identity). Private groups: members only. Creators can toggle visibility,
 * set a custom URL slug, share the page, and decide join applications.
 */

const React = require('react');
const Chat = require('./Chat');
const GroupFabricInspector = require('./GroupFabricInspector');
const RegisterEventLog = require('./RegisterEventLog');

const BASE = '/services/star-citizen';
const ADVANCED_MODE_KEY = 'gooncitizen.advancedMode';

function readAdvancedMode () {
  try {
    return (typeof localStorage !== 'undefined') && localStorage.getItem(ADVANCED_MODE_KEY) === '1';
  } catch (_) {
    return false;
  }
}

const CSS = `
  .gpage{width:100%;max-width:none;margin:0;padding:12px 14px;display:grid;gap:16px;box-sizing:border-box}
  .gpage-back{color:var(--muted);font-size:13px;text-decoration:none}
  .gpage-back:hover{color:var(--accent)}
  .gpage-hero{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:22px 24px}
  .gpage-hero h1{margin:0 0 6px;font-size:22px}
  .gpage-hero .sub{color:var(--muted);font-size:13px;line-height:1.5}
  .gpage-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
  .gpage-btn{background:var(--accent);border:none;color:#fff;border-radius:7px;padding:8px 14px;
    font-size:13px;font-weight:600;cursor:pointer}
  .gpage-btn:disabled{opacity:.45;cursor:default}
  .gpage-btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
  .gpage-btn.danger{background:transparent;border:1px solid var(--line);color:var(--kill)}
  .gpage-tag{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:5px;margin-left:8px;vertical-align:middle}
  .gpage-tag.public{background:rgba(63,185,80,.15);color:var(--good)}
  .gpage-tag.private{background:rgba(110,118,129,.18);color:var(--muted)}
  .gpage-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .gpage-panel h2{font-size:13px;margin:0;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:600}
  .gpage-panel .body{padding:14px 16px}
  .gpage-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:9px 12px;font-size:13px}
  .gpage-ok{background:rgba(63,185,80,.12);color:var(--good);border-radius:7px;padding:9px 12px;font-size:13px}
  .gpage-field{margin-bottom:10px}
  .gpage-field label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}
  .gpage-field input,.gpage-field textarea{width:100%;background:var(--bg);border:1px solid var(--line);
    color:var(--text);border-radius:7px;padding:8px 10px;font-size:13px;box-sizing:border-box}
  .gpage-field textarea{min-height:70px;resize:vertical}
  .gpage-member{display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid #20262f;
    font-family:'Cascadia Code',Consolas,monospace;font-size:11.5px;word-break:break-all}
  .gpage-member:last-child{border-bottom:none}
  .gpage-app{display:grid;gap:6px;padding:10px 0;border-bottom:1px solid #20262f}
  .gpage-app:last-child{border-bottom:none}
  .gpage-app code{font-size:11px;word-break:break-all}
  .gpage-toggle{display:flex;align-items:center;gap:10px;font-size:13px}
  .gpage-toggle input{accent-color:var(--accent)}
  .gpage-chat .body{padding:0}
  .gpage-chat .chat-wrap{border-radius:0}
  ${RegisterEventLog.CSS || ''}
`;

function identityBridge () {
  return (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.identity) || null;
}

function shortKey (pubkey) {
  return pubkey ? pubkey.slice(0, 10) + '…' + pubkey.slice(-6) : '—';
}

class GroupPage extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      token: null,
      pubkey: null,
      nickname: null,
      group: null,
      applications: [],
      proposals: [],
      groupWallet: null,
      presenceRoster: {},
      events: [],
      fleets: [],
      loading: true,
      error: null,
      notice: null,
      applyMessage: '',
      applying: false,
      slugEdit: '',
      colorEdit: '#3b82f6',
      busy: false
    };
  }

  get pathKey () {
    const m = String(window.location.pathname || '').match(/^\/groups\/([^/]+)/);
    return (m && m[1]) || this.props.pathKey || null;
  }

  componentDidMount () {
    this.boot();
    window.addEventListener('popstate', this._onPop);
  }

  componentWillUnmount () {
    window.removeEventListener('popstate', this._onPop);
  }

  _onPop = () => { this.boot(); };

  headers (token) {
    const h = { 'Content-Type': 'application/json' };
    const t = token || this.state.token;
    if (t) h.Authorization = `Bearer ${t}`;
    return h;
  }

  async login () {
    const bridge = identityBridge();
    if (!bridge) return null;
    try {
      const info = await bridge.get();
      if (!info || !info.unlocked) return null;
      const envelope = await bridge.signEnvelope({ intent: 'login', ts: new Date().toISOString() });
      if (!envelope || envelope.error) return null;
      const res = await fetch(`${BASE}/auth`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope)
      });
      if (!res.ok) return null;
      const json = await res.json();
      this.setState({
        token: json.data.token,
        pubkey: json.data.pubkey,
        nickname: (info && info.nickname) || null
      });
      return json.data.token;
    } catch (_) { return null; }
  }

  async boot () {
    this.setState({ loading: true, error: null });
    const token = await this.login();
    await this.load(token);
  }

  async load (token) {
    const key = this.pathKey;
    if (!key) {
      this.setState({ loading: false, error: 'Missing group id' });
      return;
    }
    try {
      const res = await fetch(`${BASE}/groups/${encodeURIComponent(key)}`, { headers: this.headers(token) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const group = json.data;
      let applications = [];
      if (group.role === 'creator') {
        const ar = await fetch(`${BASE}/groups/${encodeURIComponent(group.id)}/applications`, { headers: this.headers(token) });
        if (ar.ok) applications = ((await ar.json()).data || []).filter((a) => a.status === 'pending');
      }
      let presenceRoster = {};
      try {
        const pr = await fetch(`${BASE}/presence/roster`, { headers: this.headers(token) });
        if (pr.ok) presenceRoster = ((await pr.json()).data) || {};
      } catch (_) { /* optional */ }
      let events = [];
      try {
        const er = await fetch(`${BASE}/inbox?groupId=${encodeURIComponent(group.id)}`, {
          headers: this.headers(token)
        });
        if (er.ok) events = ((await er.json()).data) || [];
      } catch (_) { /* optional */ }
      let proposals = [];
      if (group.role === 'member' || group.role === 'creator') {
        try {
          const pr = await fetch(`${BASE}/groups/${encodeURIComponent(group.id)}/proposals`, {
            headers: this.headers(token)
          });
          if (pr.ok) proposals = ((await pr.json()).data) || [];
        } catch (_) { /* optional */ }
      }
      let groupWallet = null;
      if (group.role === 'member' || group.role === 'creator') {
        try {
          const wr = await fetch(`${BASE}/groups/${encodeURIComponent(group.id)}/wallet`, {
            headers: this.headers(token)
          });
          const wj = await wr.json().catch(() => ({}));
          groupWallet = wr.ok ? (wj.data || wj) : { error: (wj && wj.error) || `HTTP ${wr.status}` };
        } catch (e) {
          groupWallet = { error: e.message || String(e) };
        }
      }
      let fleets = [];
      try {
        const fr = await fetch(`${BASE}/groups/${encodeURIComponent(group.id)}/fleets`, {
          headers: this.headers(token)
        });
        if (fr.ok) fleets = ((await fr.json()).data) || [];
      } catch (_) { /* optional */ }
      this.setState({
        group, applications, proposals, groupWallet, presenceRoster, events, fleets, loading: false,
        slugEdit: group.slug || '',
        colorEdit: group.primaryColor || '#3b82f6',
        notice: null
      });
      document.title = `${group.name} — GoonCitizen`;
    } catch (e) {
      this.setState({ loading: false, group: null, error: e.message });
    }
  }

  shareUrl () {
    const g = this.state.group;
    if (!g) return '';
    const path = g.path || `/groups/${g.slug || g.id}`;
    return `${window.location.origin}${path}`;
  }

  async share () {
    const g = this.state.group;
    if (!g) return;
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/groups/${encodeURIComponent(g.id)}/share`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ relay: true })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const data = json.data || {};
      const url = data.protocolUrl || '';
      if (!url) throw new Error('no protocolUrl');
      const mesh = data.relayed
        ? `Broadcast to network (${data.peers || 0} peer connection(s)). `
        : (`Mesh broadcast failed` + (data.relayError ? `: ${data.relayError}` : '') + '. ');
      try {
        await navigator.clipboard.writeText(url);
        this.setState({
          busy: false,
          notice: mesh + 'fabric:… offer copied. Page: ' + this.shareUrl(),
          error: data.relayed ? null : (data.relayError || 'Share copied locally but not broadcast')
        });
      } catch (_) {
        this.setState({
          busy: false,
          notice: mesh + url,
          error: data.relayed ? null : (data.relayError || null)
        });
      }
    } catch (e) {
      const url = this.shareUrl();
      try {
        await navigator.clipboard.writeText(url);
        this.setState({ busy: false, notice: 'Page link copied (Fabric share failed: ' + e.message + ').', error: e.message });
      } catch (_) {
        this.setState({ busy: false, error: e.message, notice: url });
      }
    }
  }

  async apply () {
    if (this.state.applying || !this.state.group) return;
    this.setState({ applying: true, error: null, notice: null });
    try {
      if (!this.state.token) throw new Error('Unlock your identity to apply');
      const res = await fetch(`${BASE}/groups/${encodeURIComponent(this.state.group.id)}/applications`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ message: this.state.applyMessage })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({ applying: false, applyMessage: '', notice: 'Application submitted — wait for the creator to accept.' });
    } catch (e) {
      this.setState({ applying: false, error: e.message });
    }
  }

  async patch (body) {
    if (this.state.busy || !this.state.group) return;
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/groups/${encodeURIComponent(this.state.group.id)}`, {
        method: 'PUT', headers: this.headers(), body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      // If slug changed, navigate to the new URL.
      const next = json.data;
      const nextKey = next.slug || next.id;
      if (nextKey !== this.pathKey) {
        window.history.replaceState({}, '', next.path || `/groups/${nextKey}`);
      }
      this.setState({
        busy: false,
        notice: 'Settings saved.',
        slugEdit: next.slug || '',
        colorEdit: next.primaryColor || this.state.colorEdit || '#3b82f6'
      });
      await this.load();
      if (typeof this.props.onPrimaryGroupTheme === 'function' && next.primaryColor !== undefined) {
        // Parent may refresh theme if this is the user's primary group.
        this.props.onPrimaryGroupTheme(next.primaryColor || null);
      }
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async decide (applicationId, decision) {
    this.setState({ busy: true, error: null });
    try {
      const res = await fetch(`${BASE}/group-applications/${encodeURIComponent(applicationId)}/decision`, {
        method: 'POST', headers: this.headers(), body: JSON.stringify({ decision })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({ busy: false, notice: decision === 'accept' ? 'Member added.' : 'Application rejected.' });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async voteProposal (proposalId) {
    if (this.state.busy || !this.state.group) return;
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(
        `${BASE}/groups/${encodeURIComponent(this.state.group.id)}/proposals/${encodeURIComponent(proposalId)}/votes`,
        { method: 'POST', headers: this.headers(), body: JSON.stringify({}) }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({
        busy: false,
        notice: json.adopted ? 'Proposal adopted.' : 'Vote recorded — waiting for more signatures.'
      });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async proposeWithdraw () {
    const g = this.state.group;
    if (!g || this.state.busy || g.role !== 'creator') return;
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/groups/${encodeURIComponent(g.id)}/withdrawals`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ action: 'spend', utxoAgeBlocks: 0 })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      const pref = json.data && json.data.prepared && json.data.prepared.preferredTierId;
      const tiers = (json.data && json.data.prepared && json.data.prepared.activeTiers) || [];
      const tip = tiers.length
        ? `Active tier: ${tiers[0].id} (${tiers[0].threshold}-of-n). Address ready — fund UTXO then complete withdrawal.`
        : 'Withdrawal proposed.';
      this.setState({
        busy: false,
        notice: tip + (pref ? ` Preferred: ${pref}` : '')
      });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message || String(e) });
    }
  }

  renderWallet () {
    const g = this.state.group;
    const gw = this.state.groupWallet;
    if (!g || (g.role !== 'member' && g.role !== 'creator')) return null;
    if (!gw) return null;
    const isCreator = g.role === 'creator';
    return React.createElement('div', { className: 'gpage-panel' },
      React.createElement('h2', null, 'Wallet'),
      React.createElement('div', { className: 'body' },
        gw.error
          ? React.createElement('div', { className: 'gpage-err' }, gw.error)
          : React.createElement(React.Fragment, null,
            React.createElement('div', { style: { fontSize: 13, color: 'var(--muted)', marginBottom: 8 } },
              'Taproot multisig · mode ', React.createElement('b', { style: { color: 'var(--text)' } }, gw.mode || '—'),
              ` · ${g.threshold}-of-${(g.validators || g.members || []).length}`
            ),
            gw.address
              ? React.createElement(React.Fragment, null,
                React.createElement('code', {
                  style: { display: 'block', fontSize: 11, wordBreak: 'break-all', marginBottom: 10 }
                }, gw.address),
                React.createElement('div', { className: 'gpage-actions', style: { marginTop: 0 } },
                  React.createElement('button', {
                    className: 'gpage-btn ghost',
                    onClick: () => {
                      try {
                        navigator.clipboard.writeText(gw.address);
                        this.setState({ notice: 'Address copied.' });
                      } catch (_) { /* ignore */ }
                    }
                  }, 'Copy address'),
                  isCreator
                    ? React.createElement('button', {
                      className: 'gpage-btn',
                      disabled: this.state.busy,
                      onClick: () => this.proposeWithdraw()
                    }, this.state.busy ? 'Working…' : 'Propose withdraw')
                    : null
                )
              )
              : React.createElement('p', { style: { color: 'var(--muted)', fontSize: 13, margin: 0 } },
                'No Taproot address yet — group needs signer keys.')
          )
      )
    );
  }

  renderFleets () {
    const g = this.state.group;
    if (!g) return null;
    const list = this.state.fleets || [];
    return React.createElement('div', { className: 'gpage-panel' },
      React.createElement('h2', null, `Fleets${list.length ? ` (${list.length})` : ''}`),
      React.createElement('div', { className: 'body' },
        !list.length
          ? React.createElement('p', { style: { color: 'var(--muted)', fontSize: 13, margin: 0 } },
            'No fleets shared to this group yet. Share from Fleets with visibility “groups”.')
          : list.map((f) => React.createElement('div', {
            key: f.fleetId || f.id,
            className: 'gpage-member',
            style: { flexWrap: 'wrap' }
          },
            React.createElement('span', { style: { flex: 1, fontFamily: 'inherit', fontSize: 13 } },
              f.name || shortKey(f.fleetId || f.id)),
            React.createElement('span', { className: 'gpage-tag private' },
              `${Number(f.shipCount) || 0} ships` + (f.uniqueShips ? ` · ${f.uniqueShips} types` : '')),
            f.ownerPubkey
              ? React.createElement('span', { className: 'gpage-tag private', title: f.ownerPubkey },
                shortKey(f.ownerPubkey))
              : null,
            f.sharedAt
              ? React.createElement('span', { style: { color: 'var(--muted)', fontSize: 11 } },
                String(f.sharedAt).slice(0, 10))
              : null,
            React.createElement('button', {
              className: 'gpage-btn ghost',
              style: { padding: '4px 10px', fontSize: 12 },
              onClick: () => {
                const id = f.fleetId || f.id;
                window.location.href = `/#fleets${id ? `?id=${encodeURIComponent(id)}` : ''}`;
              }
            }, 'Open')
          ))
      )
    );
  }

  renderProposals () {
    const g = this.state.group;
    if (!g || (g.role !== 'member' && g.role !== 'creator')) return null;
    const list = this.state.proposals || [];
    const me = this.state.pubkey;
    return React.createElement('div', { className: 'gpage-panel' },
      React.createElement('h2', null, `Proposals${list.length ? ` (${list.length})` : ''}`),
      React.createElement('div', { className: 'body' },
        !list.length
          ? React.createElement('p', { style: { color: 'var(--muted)', fontSize: 13, margin: 0 } },
            'No open proposals.')
          : list.map((p) => {
            const sigs = p.signatures ? Object.keys(p.signatures).length : 0;
            const need = Math.max(1, Number(p.threshold) || 1);
            const voted = !!(me && p.signatures && (p.signatures[me] || p.signatures[String(me).toLowerCase()]));
            return React.createElement('div', {
              key: p.id,
              style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid #20262f' }
            },
              React.createElement('span', { className: 'gpage-tag private' }, p.action || 'change'),
              React.createElement('span', { style: { flex: 1, fontSize: 13 } },
                (p.member ? shortKey(p.member) + ' · ' : '') + `${sigs}/${need} votes`
              ),
              !voted
                ? React.createElement('button', {
                  className: 'gpage-btn',
                  disabled: this.state.busy,
                  onClick: () => this.voteProposal(p.id)
                }, 'Sign')
                : React.createElement('span', { className: 'gpage-tag public' }, 'signed')
            );
          })
      )
    );
  }

  renderVisitorApply () {
    const g = this.state.group;
    if (!g || g.role !== 'visitor' || !g.canApply) return null;
    const locked = !this.state.pubkey;
    return React.createElement('div', { className: 'gpage-panel' },
      React.createElement('h2', null, 'Join this group'),
      React.createElement('div', { className: 'body' },
        locked
          ? React.createElement('p', { style: { color: 'var(--muted)', fontSize: 13, margin: 0 } },
            'Unlock your GoonCitizen identity to apply — open the app (or set up identity) then return to this link.')
          : React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'gpage-field' },
              React.createElement('label', null, 'Message (optional)'),
              React.createElement('textarea', {
                value: this.state.applyMessage,
                placeholder: 'Why you want to join…',
                onChange: (e) => this.setState({ applyMessage: e.target.value })
              })
            ),
            React.createElement('button', {
              className: 'gpage-btn', disabled: this.state.applying,
              onClick: () => this.apply()
            }, this.state.applying ? 'Submitting…' : 'Apply to join')
          )
      )
    );
  }

  renderCreatorSettings () {
    const g = this.state.group;
    if (!g || g.role !== 'creator') return null;
    const isPublic = g.visibility === 'public';
    return React.createElement('div', { className: 'gpage-panel' },
      React.createElement('h2', null, 'Group settings'),
      React.createElement('div', { className: 'body' },
        React.createElement('label', { className: 'gpage-toggle' },
          React.createElement('input', {
            type: 'checkbox',
            checked: isPublic,
            disabled: this.state.busy,
            onChange: (e) => this.patch({ visibility: e.target.checked ? 'public' : 'private' })
          }),
          React.createElement('span', null, isPublic
            ? 'Public — anyone with the link can view and apply to join'
            : 'Private — only members can open this page')
        ),
        React.createElement('div', { className: 'gpage-field', style: { marginTop: 14 } },
          React.createElement('label', null, 'Custom URL (optional)'),
          React.createElement('div', { style: { display: 'flex', gap: 8 } },
            React.createElement('span', { style: { color: 'var(--muted)', fontSize: 12, alignSelf: 'center', whiteSpace: 'nowrap' } }, '/groups/'),
            React.createElement('input', {
              type: 'text', value: this.state.slugEdit,
              placeholder: g.id,
              onChange: (e) => this.setState({ slugEdit: e.target.value })
            }),
            React.createElement('button', {
              className: 'gpage-btn ghost', disabled: this.state.busy,
              onClick: () => this.patch({ slug: this.state.slugEdit.trim() || null })
            }, 'Save')
          ),
          React.createElement('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginTop: 5 } },
            'Leave blank to use the group id. Lowercase letters, digits, and hyphens only.')
        ),
        React.createElement('div', { className: 'gpage-field', style: { marginTop: 14 } },
          React.createElement('label', null, 'Primary color'),
          React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            React.createElement('input', {
              type: 'color',
              value: /^#[0-9a-fA-F]{6}$/.test(this.state.colorEdit || '') ? this.state.colorEdit : '#3b82f6',
              disabled: this.state.busy,
              onChange: (e) => this.setState({ colorEdit: e.target.value })
            }),
            React.createElement('code', { style: { fontSize: 12 } }, this.state.colorEdit || g.primaryColor || '—'),
            React.createElement('button', {
              className: 'gpage-btn ghost', disabled: this.state.busy,
              onClick: () => this.patch({ primaryColor: this.state.colorEdit || null })
            }, 'Save'),
            g.primaryColor
              ? React.createElement('button', {
                className: 'gpage-btn danger', disabled: this.state.busy,
                onClick: () => this.setState({ colorEdit: '' }, () => this.patch({ primaryColor: null }))
              }, 'Clear')
              : null
          ),
          React.createElement('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginTop: 5 } },
            'Members who set this group as primary use this accent to theme their dashboard.')
        )
      )
    );
  }

  renderApplications () {
    const apps = this.state.applications;
    if (!apps.length || this.state.group.role !== 'creator') return null;
    return React.createElement('div', { className: 'gpage-panel' },
      React.createElement('h2', null, 'Join applications'),
      React.createElement('div', { className: 'body' },
        apps.map((a) => React.createElement('div', { className: 'gpage-app', key: a.id },
          React.createElement('code', null, a.applicantId),
          a.message ? React.createElement('div', { style: { fontSize: 13 } }, a.message) : null,
          React.createElement('div', { style: { display: 'flex', gap: 8 } },
            React.createElement('button', { className: 'gpage-btn', disabled: this.state.busy, onClick: () => this.decide(a.id, 'accept') }, 'Accept'),
            React.createElement('button', { className: 'gpage-btn danger', disabled: this.state.busy, onClick: () => this.decide(a.id, 'reject') }, 'Reject')
          )
        ))
      )
    );
  }

  renderMembers () {
    const g = this.state.group;
    if (!g || !g.members) return null;
    const roster = this.state.presenceRoster || {};
    return React.createElement('div', { className: 'gpage-panel' },
      React.createElement('h2', null, `Members (${g.members.length}) · ${g.threshold}-of-${(g.validators || g.members).length} signers`),
      React.createElement('div', { className: 'body' },
        g.members.map((m) => {
          const p = roster[m];
          const ship = p && p.ship && (p.ship.name || p.ship.slug);
          const signers = g.validators || g.members;
          const isSigner = signers.includes(m);
          return React.createElement('div', { className: 'gpage-member', key: m },
            React.createElement('span', { style: { flex: 1 } },
              shortKey(m),
              p && p.nickname ? React.createElement('span', {
                style: { color: 'var(--muted)', marginLeft: 8, fontFamily: 'inherit' }
              }, p.nickname) : null
            ),
            p
              ? React.createElement('span', {
                className: 'gpage-tag ' + (p.online ? 'public' : 'private'),
                title: p.lastEventAt || ''
              }, p.online ? (ship ? `online · ${ship}` : 'online') : 'offline')
              : React.createElement('span', { className: 'gpage-tag private', title: 'No PeerPresence shared' }, '—'),
            React.createElement('span', { className: 'gpage-tag ' + (isSigner ? 'public' : 'private') }, isSigner ? 'signer' : 'reader'),
            m === g.creator ? React.createElement('span', { className: 'gpage-tag public' }, 'creator') : null,
            m === this.state.pubkey ? React.createElement('span', { className: 'gpage-tag private' }, 'you') : null
          );
        })
      )
    );
  }

  render () {
    if (this.state.loading) {
      return React.createElement('div', { className: 'gpage' }, React.createElement('div', { style: { color: 'var(--muted)' } }, 'Loading group…'));
    }
    if (this.state.error && !this.state.group) {
      return React.createElement('div', { className: 'gpage' },
        React.createElement('a', { className: 'gpage-back', href: '/#groups' }, '← Back to groups'),
        React.createElement('div', { className: 'gpage-err' }, this.state.error)
      );
    }
    const g = this.state.group;
    const isPublic = g.visibility === 'public';
    return React.createElement('div', { className: 'gpage' },
      React.createElement('a', { className: 'gpage-back', href: '/#groups', onClick: (e) => { e.preventDefault(); window.location.href = '/#groups'; } }, '← Back to groups'),
      React.createElement('div', { className: 'gpage-hero' },
        React.createElement('h1', null,
          g.name,
          React.createElement('span', { className: 'gpage-tag ' + (isPublic ? 'public' : 'private') }, isPublic ? 'public' : 'private')
        ),
        React.createElement('div', { className: 'sub' },
          isPublic
            ? `${g.memberCount != null ? g.memberCount : (g.members || []).length} members · ${g.threshold}-of-n decisions · shareable join page`
            : 'Private group — members only',
          g.role === 'member' || g.role === 'creator' ? ` · you are a ${g.role}` : null
        ),
        React.createElement('div', { className: 'gpage-actions' },
          React.createElement('button', { className: 'gpage-btn', onClick: () => this.share() }, 'Share'),
          g.role === 'creator' || g.role === 'member'
            ? React.createElement('button', {
              className: 'gpage-btn ghost',
              onClick: () => { window.location.href = '/#groups'; }
            }, 'Manage in dashboard')
            : null
        )
      ),
      this.state.error ? React.createElement('div', { className: 'gpage-err' }, this.state.error) : null,
      this.state.notice ? React.createElement('div', { className: 'gpage-ok' }, this.state.notice) : null,
      this.renderVisitorApply(),
      this.renderCreatorSettings(),
      this.renderWallet(),
      this.renderFleets(),
      this.renderChat(),
      this.renderApplications(),
      this.renderProposals(),
      this.renderMembers(),
      this.renderActivity(),
      this.renderFabricInspector()
    );
  }

  renderChat () {
    const g = this.state.group;
    if (!g) return null;
    if (g.role !== 'member' && g.role !== 'creator') {
      return React.createElement('div', { className: 'gpage-panel gpage-chat' },
        React.createElement('h2', null, 'Chat'),
        React.createElement('div', { className: 'body', style: { padding: '14px 16px', color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 } },
          'Group chat is for members. Apply to join to read and post here.')
      );
    }
    return React.createElement('div', { className: 'gpage-panel gpage-chat' },
      React.createElement('h2', null, 'Chat'),
      React.createElement('div', { className: 'body' },
        React.createElement(Chat, {
          groupId: g.id,
          embedded: true,
          identityPubkey: this.state.pubkey,
          nickname: this.state.nickname
        })
      )
    );
  }

  renderActivity () {
    return React.createElement('div', { className: 'gpage-panel' },
      React.createElement('h2', null, 'Activity'),
      React.createElement('div', { className: 'body' },
        React.createElement(RegisterEventLog, {
          items: this.state.events,
          empty: 'No group events yet — proposals, votes, join applications, and membership changes will appear here.'
        })
      )
    );
  }

  renderFabricInspector () {
    const g = this.state.group;
    if (!g || !readAdvancedMode()) return null;
    if (g.role !== 'member' && g.role !== 'creator') return null;
    const headers = {};
    if (this.state.token) headers.Authorization = `Bearer ${this.state.token}`;
    return React.createElement(GroupFabricInspector, {
      groupId: g.id,
      contractId: g.contractId || null,
      headers,
      embedded: false
    });
  }
}

GroupPage.CSS = CSS;
GroupPage.pathKeyFromLocation = function () {
  const m = String((typeof window !== 'undefined' && window.location.pathname) || '').match(/^\/groups\/([^/]+)/);
  return m ? m[1] : null;
};

module.exports = GroupPage;
