'use strict';

/**
 * Dedicated group page — `/groups/:id` (or `/groups/:slug`).
 *
 * Public groups: anyone can view a summary and apply to join (with an unlocked
 * identity). Private groups: members only. Creators can toggle visibility,
 * set a custom URL slug, share the page, and decide join applications.
 */

const React = require('react');

const BASE = '/services/star-citizen';

const CSS = `
  .gpage{max-width:820px;margin:0 auto;padding:18px;display:grid;gap:16px}
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
      group: null,
      applications: [],
      loading: true,
      error: null,
      notice: null,
      applyMessage: '',
      applying: false,
      slugEdit: '',
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
      this.setState({ token: json.data.token, pubkey: json.data.pubkey });
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
      this.setState({
        group, applications, loading: false,
        slugEdit: group.slug || '',
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
      const url = (json.data && json.data.protocolUrl) || '';
      if (!url) throw new Error('no protocolUrl');
      try {
        await navigator.clipboard.writeText(url);
        this.setState({
          busy: false,
          notice: 'Fabric GroupOffer copied. Page URL (secondary): ' + this.shareUrl()
        });
      } catch (_) {
        this.setState({ busy: false, notice: url });
      }
    } catch (e) {
      const url = this.shareUrl();
      try {
        await navigator.clipboard.writeText(url);
        this.setState({ busy: false, notice: 'Page link copied (Fabric share failed: ' + e.message + ').' });
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
      this.setState({ busy: false, notice: 'Settings saved.', slugEdit: next.slug || '' });
      await this.load();
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
    return React.createElement('div', { className: 'gpage-panel' },
      React.createElement('h2', null, `Members (${g.members.length}) · ${g.threshold}-of-${g.members.length} decisions`),
      React.createElement('div', { className: 'body' },
        g.members.map((m) => React.createElement('div', { className: 'gpage-member', key: m },
          React.createElement('span', { style: { flex: 1 } }, m),
          m === g.creator ? React.createElement('span', { className: 'gpage-tag public' }, 'creator') : null,
          m === this.state.pubkey ? React.createElement('span', { className: 'gpage-tag private' }, 'you') : null
        ))
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
      this.renderApplications(),
      this.renderMembers()
    );
  }
}

GroupPage.CSS = CSS;
GroupPage.pathKeyFromLocation = function () {
  const m = String((typeof window !== 'undefined' && window.location.pathname) || '').match(/^\/groups\/([^/]+)/);
  return m ? m[1] : null;
};

module.exports = GroupPage;
