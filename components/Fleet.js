'use strict';

/**
 * Fleet — personal Starjump / FleetViewer exports and custom editable rosters.
 *
 * Import JSON, create fleets from a known-ship catalog, add/remove ships, share.
 */

const React = require('react');
const { readAppHash, setAppHash } = require('../functions/appHash');

const BASE = '/services/star-citizen';

const CSS = `
  /* Fill the window canvas (Dashboard toggles body.chat-fill for Fleet + Chat). */
  .fl-wrap{width:100%;max-width:none;margin:0;padding:12px 14px;display:grid;
    grid-template-rows:auto minmax(0,1fr);gap:12px;height:100%;min-height:0;overflow:hidden;box-sizing:border-box}
  .fl-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;
    display:flex;flex-direction:column;min-height:0;min-width:0;max-width:100%}
  .fl-panel h2{font-size:13px;margin:0;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:600;display:flex;flex-wrap:wrap;gap:8px;align-items:center;
    flex:0 0 auto;min-width:0}
  .fl-panel h2 .sub{font-weight:500;color:var(--muted);font-size:12px}
  .fl-panel .body{padding:14px 16px;flex:1 1 auto;min-height:0;min-width:0;overflow-x:hidden;overflow-y:auto}
  .fl-toolbar .body{flex:0 0 auto;overflow:visible}
  .fl-hint{color:var(--muted);font-size:12.5px;line-height:1.55;margin:0 0 12px}
  .fl-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:9px 12px;font-size:13px;margin-bottom:10px}
  .fl-ok{background:rgba(63,185,80,.12);color:var(--good);border-radius:7px;padding:9px 12px;font-size:13px;margin-bottom:10px}
  .fl-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
  .fl-btn{background:var(--accent);border:none;color:#fff;border-radius:7px;padding:7px 14px;
    font-size:12.5px;font-weight:600;cursor:pointer}
  .fl-btn:disabled{opacity:.45;cursor:default}
  .fl-btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
  .fl-btn.danger{background:transparent;border:1px solid var(--line);color:var(--kill)}
  .fl-btn.mini{padding:3px 8px;font-size:11px}
  .fl-chip{background:var(--panel2);border:1px solid var(--line);color:var(--muted);border-radius:999px;
    padding:3px 10px;font-size:11.5px;cursor:pointer}
  .fl-chip.on{background:rgba(56,139,253,.15);border-color:var(--accent);color:var(--accent)}
  .fl-list{display:grid;gap:10px;min-width:0;max-width:100%}
  .fl-card{border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--panel2);
    display:grid;gap:8px;cursor:pointer;min-width:0;max-width:100%;overflow:hidden;box-sizing:border-box}
  .fl-card:hover,.fl-card.on{border-color:var(--accent)}
  .fl-card .title{font-size:14px;font-weight:600;display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;
    min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word}
  .fl-card .meta{font-size:12px;color:var(--muted);display:flex;flex-wrap:wrap;gap:8px;
    min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word}
  .fl-tag{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:5px;letter-spacing:.02em}
  .fl-tag.private{background:rgba(110,118,129,.18);color:var(--muted)}
  .fl-tag.peers{background:rgba(56,139,253,.15);color:var(--accent)}
  .fl-tag.groups{background:rgba(210,153,34,.15);color:var(--warn,#d29922)}
  .fl-tag.public{background:rgba(63,185,80,.15);color:var(--good)}
  .fl-tag.remote{background:rgba(163,113,247,.15);color:#a371f7}
  .fl-tag.custom{background:rgba(56,139,253,.12);color:var(--accent)}
  .fl-ships{display:grid;gap:6px;margin-top:4px}
  .fl-ship{font-size:12px;background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px 10px;
    display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center}
  .fl-ship .n{font-weight:600}
  .fl-ship .s{color:var(--muted);font-size:11px;font-family:'Cascadia Code',Consolas,monospace;word-break:break-all}
  .fl-ship .ops{display:flex;gap:6px;align-items:center}
  .fl-ship .ops input{width:52px;background:var(--panel);border:1px solid var(--line);color:var(--text);
    border-radius:5px;padding:3px 6px;font-size:12px}
  .fl-form{display:grid;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid var(--line)}
  .fl-form label{display:grid;gap:4px;font-size:12px;color:var(--muted)}
  .fl-form input,.fl-form select{background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:7px 10px;font-size:12.5px}
  .fl-groups{display:flex;flex-wrap:wrap;gap:8px}
  .fl-groups label{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text);cursor:pointer}
  .fl-empty{color:var(--muted);text-align:center;font-style:italic;padding:28px 0;font-size:13px;line-height:1.7}
  .fl-samples{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .fl-split{display:grid;grid-template-columns:minmax(0,320px) minmax(0,1fr);gap:12px;min-height:0;overflow:hidden}
  .fl-split > .fl-panel{min-width:0;max-width:100%}
  @media (max-width:840px){
    .fl-wrap{grid-template-rows:auto minmax(0,1fr);overflow:auto}
    .fl-split{grid-template-columns:1fr;grid-template-rows:minmax(160px,32%) minmax(0,1fr);min-height:min(60vh,480px)}
  }
  .fl-search{display:grid;gap:8px}
  .fl-search input{background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:8px 10px;font-size:12.5px;width:100%;box-sizing:border-box}
  .fl-hits{max-height:180px;overflow:auto;border:1px solid var(--line);border-radius:8px;background:var(--bg)}
  .fl-hit{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:7px 10px;
    border-bottom:1px solid #20262f;font-size:12px;cursor:pointer}
  .fl-hit:last-child{border-bottom:none}
  .fl-hit:hover{background:rgba(56,139,253,.08)}
  .fl-hit .meta{color:var(--muted);font-size:11px}
`;

function shortKey (pub) {
  if (!pub) return '—';
  const s = String(pub);
  return s.length > 12 ? s.slice(0, 8) + '…' : s;
}

class Fleet extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      fleets: [],
      samples: [],
      groups: [],
      catalogMeta: null,
      scope: 'all',
      selected: null,
      detail: null,
      loading: true,
      busy: false,
      error: null,
      notice: null,
      name: '',
      visibility: 'private',
      groupIds: [],
      shipQuery: '',
      shipHits: [],
      newFleetName: 'My fleet',
      presence: null,
      presenceRoster: {},
      browseGroupIds: []
    };
    this._fileRef = React.createRef();
    this._searchTimer = null;
    this._presenceTimer = null;
    this._pendingSelectId = null;
  }

  componentDidMount () {
    this._onHash = () => this.applyHashSelection();
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', this._onHash);
    }
    this.reload().then(() => this.applyHashSelection());
    this.searchShips('');
    this._presenceTimer = setInterval(() => this.loadPresence(), 30000);
  }

  componentWillUnmount () {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    if (this._presenceTimer) clearInterval(this._presenceTimer);
    if (this._onHash && typeof window !== 'undefined') {
      window.removeEventListener('hashchange', this._onHash);
    }
  }

  /** Deep link `#fleet?id=<fleetId>` (and legacy `#fleets?id=`). */
  applyHashSelection () {
    const { path, query } = readAppHash();
    if (path !== 'fleet') return;
    const id = query.id || null;
    if (!id || id === this.state.selected) return;
    const row = (this.state.fleets || []).find((f) => f.id === id);
    if (row) {
      this._pendingSelectId = null;
      this.selectFleet(row);
      return;
    }
    // List may still be loading / filtered — try direct fetch.
    this._pendingSelectId = id;
    this.selectFleet({ id });
  }

  async loadPresence () {
    try {
      const [localRes, rosterRes] = await Promise.all([
        fetch(`${BASE}/presence`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`${BASE}/presence/roster`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      ]);
      this.setState({
        presence: localRes && localRes.data ? localRes.data : null,
        presenceRoster: (rosterRes && rosterRes.data) || {}
      });
    } catch (_) { /* ignore */ }
  }

  async reload () {
    this.setState({ loading: true, error: null });
    try {
      const [fleetsRes, samplesRes, groupsRes, shipsRes] = await Promise.all([
        fetch(`${BASE}/fleets?scope=${encodeURIComponent(this.state.scope)}`).then((r) => r.json()),
        fetch(`${BASE}/fleets/samples`).then((r) => r.json()),
        fetch(`${BASE}/groups`).then((r) => r.json()).catch(() => ({ data: [] })),
        fetch(`${BASE}/ships?limit=1`).then((r) => r.json()).catch(() => null)
      ]);
      this.setState({
        loading: false,
        fleets: Array.isArray(fleetsRes.data) ? fleetsRes.data : [],
        samples: Array.isArray(samplesRes.data) ? samplesRes.data : [],
        groups: Array.isArray(groupsRes.data) ? groupsRes.data : (Array.isArray(groupsRes) ? groupsRes : []),
        catalogMeta: shipsRes && shipsRes.meta ? shipsRes.meta : null
      });
      this.loadPresence();
    } catch (e) {
      this.setState({ loading: false, error: e.message || String(e) });
    }
  }

  setScope (scope) {
    this.setState({ scope }, () => this.reload());
  }

  searchShips (q) {
    this.setState({ shipQuery: q });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set('q', q.trim());
        params.set('limit', '30');
        const res = await fetch(`${BASE}/ships?${params}`);
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || res.statusText);
        this.setState({
          shipHits: Array.isArray(j.data) ? j.data : [],
          catalogMeta: j.meta || this.state.catalogMeta
        });
      } catch (_) { /* ignore search blips */ }
    }, 180);
  }

  async selectFleet (row) {
    if (!row) {
      this.setState({ selected: null, detail: null });
      return;
    }
    this.setState({ selected: row.id, busy: true, error: null });
    try {
      const res = await fetch(`${BASE}/fleets/${encodeURIComponent(row.id)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      const d = j.data || row;
      this.setState({
        busy: false,
        detail: d,
        name: d.name || '',
        visibility: d.visibility || 'private',
        groupIds: Array.isArray(d.groupIds) ? d.groupIds.slice() : []
      });
    } catch (e) {
      this.setState({ busy: false, error: e.message, detail: row });
    }
  }

  async importPayload (payload) {
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/fleets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      this.setState({
        busy: false,
        notice: `Imported “${j.data.name}” · ${j.data.shipCount} ships`
      });
      await this.reload();
      if (j.data) await this.selectFleet(j.data);
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async createCustom () {
    const name = String(this.state.newFleetName || 'My fleet').trim() || 'My fleet';
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/fleets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom: true, name, ships: [], visibility: 'private' })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      this.setState({ busy: false, notice: `Created “${j.data.name}” — add ships from the catalog` });
      await this.reload();
      if (j.data) await this.selectFleet(j.data);
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async pickNative () {
    const api = window.electronAPI && window.electronAPI.dialog;
    if (api && typeof api.openFleetJson === 'function') {
      const result = await api.openFleetJson();
      if (!result || result.canceled) return;
      if (result.path) return this.importPayload({ path: result.path });
      if (result.json) return this.importPayload({ json: result.json, sourceFile: result.name || null });
    }
    if (this._fileRef.current) this._fileRef.current.click();
  }

  onFileChange (e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result || ''));
        this.importPayload({ json, sourceFile: file.name, name: file.name.replace(/\.json$/i, '') });
      } catch (err) {
        this.setState({ error: 'Invalid JSON: ' + (err.message || err) });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async shipOp (op) {
    if (!this.state.selected) return;
    this.setState({ busy: true, error: null });
    try {
      const res = await fetch(`${BASE}/fleets/${encodeURIComponent(this.state.selected)}/ships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(op)
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      this.setState({ busy: false, detail: j.data, notice: null });
      await this.reload();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  addShip (ship) {
    if (!ship) return;
    const existing = (this.state.detail && this.state.detail.ships || [])
      .find((s) => s.slug === ship.slug);
    const count = existing ? (existing.count || 1) + 1 : 1;
    return this.shipOp({
      slug: ship.slug,
      name: ship.name,
      manufacturer: ship.manufacturer || null,
      type: ship.type || null,
      size: ship.size || null,
      count
    });
  }

  async saveMeta () {
    if (!this.state.selected) return;
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/fleets/${encodeURIComponent(this.state.selected)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: this.state.name,
          visibility: this.state.visibility,
          groupIds: this.state.groupIds
        })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      this.setState({ busy: false, notice: 'Fleet updated', detail: j.data });
      await this.reload();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async share () {
    if (!this.state.selected) return;
    if (this.state.visibility === 'groups' && !(this.state.groupIds || []).length) {
      this.setState({ error: 'Select at least one group to share into' });
      return;
    }
    this.setState({ busy: true, error: null, notice: null, browseGroupIds: [] });
    try {
      const patchRes = await fetch(`${BASE}/fleets/${encodeURIComponent(this.state.selected)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: this.state.name,
          visibility: this.state.visibility,
          groupIds: this.state.groupIds
        })
      });
      const patchJ = await patchRes.json();
      if (!patchRes.ok) throw new Error(patchJ.error || patchRes.statusText);

      const res = await fetch(`${BASE}/fleets/${encodeURIComponent(this.state.selected)}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visibility: this.state.visibility,
          groupIds: this.state.groupIds,
          includeExport: true
        })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      const p = j.data && j.data.published;
      const bits = [];
      if (p && p.peers) bits.push('peers');
      if (p && p.public) bits.push('public');
      const publishedGroups = (p && Array.isArray(p.groups)) ? p.groups.slice() : [];
      if (publishedGroups.length) bits.push(`${publishedGroups.length} group(s)`);
      this.setState({
        busy: false,
        notice: bits.length
          ? `Shared to ${bits.join(' · ')}`
          : (this.state.visibility === 'private' ? 'Saved as private (not published)' : 'Share recorded'),
        browseGroupIds: publishedGroups,
        detail: (j.data && j.data.fleet) || patchJ.data || this.state.detail
      });
      await this.reload();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  /** Jump to Groups → Fleets for a group that just received this share. */
  browseSharedGroup (groupId) {
    if (!groupId) return;
    setAppHash('groups', { id: groupId, tab: 'fleets' });
  }

  async remove () {
    if (!this.state.selected) return;
    if (!window.confirm('Delete this fleet from local storage?')) return;
    this.setState({ busy: true, error: null });
    try {
      const res = await fetch(`${BASE}/fleets/${encodeURIComponent(this.state.selected)}`, { method: 'DELETE' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText);
      this.setState({ busy: false, selected: null, detail: null, notice: 'Fleet deleted' });
      await this.reload();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  toggleGroup (id) {
    const set = new Set(this.state.groupIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.setState({ groupIds: [...set] });
  }

  renderShipEditor () {
    const d = this.state.detail;
    if (!d || d.remote) return null;
    const ships = Array.isArray(d.ships) ? d.ships : [];
    return React.createElement('div', { className: 'fl-form' },
      React.createElement('div', { className: 'fl-hint', style: { margin: 0 } },
        'Roster — add from the known-ship catalog or remove arbitrarily.'),
      React.createElement('div', { className: 'fl-ships' },
        !ships.length
          ? React.createElement('div', { className: 'fl-empty', style: { padding: 12 } }, 'No ships yet')
          : ships.map((s) => React.createElement('div', {
            className: 'fl-ship',
            key: s.slug + (s.variant || '')
          },
          React.createElement('div', null,
            React.createElement('div', { className: 'n' },
              s.name || s.slug,
              s.type
                ? React.createElement('span', {
                  className: 'fl-tag peers',
                  style: { marginLeft: 8, verticalAlign: 'middle' }
                }, s.type)
                : null
            ),
            React.createElement('div', { className: 's' },
              [
                s.slug + (s.variant ? ` (${s.variant})` : ''),
                s.size || null,
                s.manufacturer || null
              ].filter(Boolean).join(' · '))
          ),
          React.createElement('div', { className: 'ops' },
            React.createElement('input', {
              type: 'number',
              min: 1,
              max: 9999,
              value: s.count || 1,
              disabled: this.state.busy,
              onChange: (e) => {
                const count = Math.max(1, Math.floor(Number(e.target.value) || 1));
                this.shipOp({ slug: s.slug, variant: s.variant, name: s.name, count });
              }
            }),
            React.createElement('button', {
              type: 'button',
              className: 'fl-btn danger mini',
              disabled: this.state.busy,
              onClick: () => this.shipOp({ slug: s.slug, variant: s.variant, remove: true })
            }, 'Remove')
          )
          ))
      ),
      React.createElement('div', { className: 'fl-search' },
        React.createElement('label', null,
          'Add ship' +
          (this.state.catalogMeta ? ` (${this.state.catalogMeta.count} known)` : ''),
          React.createElement('input', {
            type: 'text',
            value: this.state.shipQuery,
            placeholder: 'Search catalog — polaris, cutlass, anvil…',
            onChange: (e) => this.searchShips(e.target.value)
          })
        ),
        this.state.shipHits.length
          ? React.createElement('div', { className: 'fl-hits' },
            this.state.shipHits.map((s) => React.createElement('div', {
              key: s.slug,
              className: 'fl-hit',
              onClick: () => this.addShip(s)
            },
            React.createElement('div', null,
              React.createElement('div', null,
                s.name,
                s.type
                  ? React.createElement('span', {
                    className: 'fl-tag peers',
                    style: { marginLeft: 8 }
                  }, s.type)
                  : null
              ),
              React.createElement('div', { className: 'meta' },
                [
                  s.slug,
                  s.size || null,
                  s.manufacturer || null
                ].filter(Boolean).join(' · '))
            ),
            React.createElement('button', {
              type: 'button',
              className: 'fl-btn mini',
              disabled: this.state.busy || !this.state.selected,
              onClick: (e) => { e.stopPropagation(); this.addShip(s); }
            }, 'Add')
            ))
          )
          : React.createElement('div', { className: 'fl-hint', style: { margin: 0 } },
            this.state.shipQuery ? 'No catalog matches' : 'Type to filter the catalog')
      )
    );
  }

  renderDetail () {
    const d = this.state.detail;
    if (!d) {
      return React.createElement('div', { className: 'fl-empty' },
        'Select a fleet, create a custom one, or import a Starjump export.');
    }
    const ships = Array.isArray(d.ships) ? d.ships : [];
    return React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'fl-card on', style: { cursor: 'default' } },
        React.createElement('div', { className: 'title' },
          d.name,
          React.createElement('span', { className: 'fl-tag ' + (d.visibility || 'private') }, d.visibility || 'private'),
          d.source === 'custom'
            ? React.createElement('span', { className: 'fl-tag custom' }, 'custom')
            : null,
          d.remote ? React.createElement('span', { className: 'fl-tag remote' }, 'from peer') : null
        ),
        React.createElement('div', { className: 'meta' },
          `${d.shipCount || ships.length} ships · ${d.uniqueShips || ships.length} unique`,
          d.sourceFile ? ` · ${d.sourceFile}` : null,
          d.ownerPubkey ? ` · ${shortKey(d.ownerPubkey)}` : null
        )
      ),
      this.renderShipEditor(),
      d.remote
        ? React.createElement('div', { className: 'fl-hint' },
          'This fleet arrived from a peer. Create your own to edit and share.')
        : React.createElement('div', { className: 'fl-form' },
          React.createElement('label', null, 'Name',
            React.createElement('input', {
              type: 'text',
              value: this.state.name,
              onChange: (e) => this.setState({ name: e.target.value })
            })
          ),
          React.createElement('label', null, 'Visibility',
            React.createElement('select', {
              value: this.state.visibility,
              onChange: (e) => this.setState({ visibility: e.target.value })
            },
            React.createElement('option', { value: 'private' }, 'Private (local only)'),
            React.createElement('option', { value: 'peers' }, 'Peers (Fabric mesh)'),
            React.createElement('option', { value: 'groups' }, 'Groups'),
            React.createElement('option', { value: 'public' }, 'Public (mesh + optional groups)')
            )
          ),
          (this.state.visibility === 'groups' || this.state.visibility === 'public')
            ? React.createElement('div', null,
              React.createElement('div', { className: 'fl-hint', style: { marginBottom: 6 } },
                this.state.visibility === 'groups'
                  ? 'Pick one or more groups to journal this FleetShare (you must be a member).'
                  : 'Optional: also journal into these groups (you must be a member):'),
              React.createElement('div', { className: 'fl-groups' },
                !(this.state.groups || []).length
                  ? React.createElement('span', { className: 'fl-hint' }, 'No groups yet — create one under Groups')
                  : this.state.groups.map((g) => React.createElement('label', { key: g.id },
                    React.createElement('input', {
                      type: 'checkbox',
                      checked: this.state.groupIds.includes(g.id),
                      onChange: () => this.toggleGroup(g.id)
                    }),
                    g.name || g.id
                  ))
              )
            )
            : null,
          React.createElement('div', { className: 'fl-bar', style: { marginBottom: 0 } },
            React.createElement('button', {
              type: 'button', className: 'fl-btn ghost', disabled: this.state.busy,
              onClick: () => this.saveMeta()
            }, 'Save'),
            React.createElement('button', {
              type: 'button',
              className: 'fl-btn',
              disabled: this.state.busy ||
                (this.state.visibility === 'groups' && !(this.state.groupIds || []).length),
              onClick: () => this.share()
            }, this.state.visibility === 'private' ? 'Save private' : 'Share now'),
            React.createElement('button', {
              type: 'button', className: 'fl-btn danger', disabled: this.state.busy,
              onClick: () => this.remove()
            }, 'Delete')
          )
        )
    );
  }

  renderPresence () {
    const p = this.state.presence;
    if (!p) return null;
    const settings = p.settings || {};
    const ship = (p.presence && p.presence.ship) || null;
    const roster = this.state.presenceRoster || {};
    const others = Object.entries(roster).filter(([, v]) => v && v.online);
    return React.createElement('div', {
      style: {
        marginBottom: 12, padding: '10px 12px', borderRadius: 8,
        border: '1px solid var(--line)', background: 'var(--bg)',
        display: 'grid', gap: 6, fontSize: 12.5
      }
    },
    React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' } },
      React.createElement('span', {
        className: 'fl-tag ' + (p.online ? 'public' : 'private')
      }, p.online ? 'you · online' : 'you · offline'),
      ship
        ? React.createElement('span', { style: { color: 'var(--text)' } },
          'Flying ', React.createElement('b', null, ship.name || ship.slug),
          ship.type
            ? React.createElement('span', { className: 'fl-tag peers', style: { marginLeft: 6 } }, ship.type)
            : null,
          ship.source === 'override' ? ' (manual)' : ' (autodetect)')
        : React.createElement('span', { className: 'fl-hint', style: { margin: 0 } }, 'No ship published yet'),
      React.createElement('span', { className: 'fl-tag ' + (settings.sharePresence ? 'peers' : 'private') },
        settings.sharePresence
          ? `sharing → ${settings.presenceVisibility || 'peers'}`
          : 'presence private'),
      React.createElement('a', {
        href: '#',
        style: { color: 'var(--accent)', fontSize: 12 },
        onClick: (e) => {
          e.preventDefault();
          if (typeof this.props.onOpenIdentity === 'function') this.props.onOpenIdentity();
        }
      }, 'Identity')
    ),
    others.length
      ? React.createElement('div', { style: { color: 'var(--muted)' } },
        `${others.length} mesh peer${others.length === 1 ? '' : 's'} online`,
        others.slice(0, 6).map(([pk, v]) => {
          const label = (v.nickname || shortKey(pk)) +
            (v.ship && (v.ship.name || v.ship.slug) ? ` · ${v.ship.name || v.ship.slug}` : '') +
            (v.ship && v.ship.type ? ` · ${v.ship.type}` : '');
          return React.createElement('span', {
            key: pk,
            className: 'fl-chip on',
            style: { marginLeft: 6, cursor: 'default' }
          }, label);
        })
      )
      : React.createElement('div', { className: 'fl-hint', style: { margin: 0 } },
        'Opt-in online status from Identity lets group / fleet mates see when you are in-game.')
    );
  }

  render () {
    return React.createElement('div', { className: 'fl-wrap' },
      React.createElement('section', { className: 'fl-panel fl-toolbar' },
        React.createElement('h2', null, 'Fleet ',
          React.createElement('span', { className: 'sub' },
            '— custom rosters + Starjump / FleetViewer imports')),
        React.createElement('div', { className: 'body' },
          this.renderPresence(),
          this.state.error ? React.createElement('div', { className: 'fl-err' }, this.state.error) : null,
          this.state.notice
            ? React.createElement('div', { className: 'fl-ok' },
              this.state.notice,
              (this.state.browseGroupIds || []).length
                ? React.createElement('div', {
                  className: 'fl-bar',
                  style: { marginTop: 8, marginBottom: 0 }
                },
                ...(this.state.browseGroupIds.slice(0, 3).map((gid) => {
                  const g = (this.state.groups || []).find((x) => x.id === gid);
                  return React.createElement('button', {
                    key: gid,
                    type: 'button',
                    className: 'fl-btn ghost mini',
                    onClick: () => this.browseSharedGroup(gid)
                  }, `Browse ${g && g.name ? g.name : 'group'} fleets`);
                })),
                this.state.browseGroupIds.length > 3
                  ? React.createElement('span', { className: 'fl-hint', style: { margin: 0 } },
                    `+${this.state.browseGroupIds.length - 3} more`)
                  : null
                )
                : null
            )
            : null,
          React.createElement('div', { className: 'fl-bar', style: { marginBottom: this.state.samples.length ? 8 : 0 } },
            React.createElement('input', {
              type: 'text',
              value: this.state.newFleetName,
              placeholder: 'New fleet name',
              style: { background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--text)',
                borderRadius: 7, padding: '7px 10px', fontSize: 12.5, minWidth: 140 },
              onChange: (e) => this.setState({ newFleetName: e.target.value })
            }),
            React.createElement('button', {
              type: 'button', className: 'fl-btn', disabled: this.state.busy,
              onClick: () => this.createCustom()
            }, 'New fleet'),
            React.createElement('button', {
              type: 'button', className: 'fl-btn ghost', disabled: this.state.busy,
              onClick: () => this.pickNative()
            }, 'Import JSON…'),
            React.createElement('input', {
              ref: this._fileRef,
              type: 'file',
              accept: 'application/json,.json',
              style: { display: 'none' },
              onChange: (e) => this.onFileChange(e)
            }),
            React.createElement('button', {
              type: 'button', className: 'fl-chip' + (this.state.scope === 'all' ? ' on' : ''),
              onClick: () => this.setScope('all')
            }, 'All'),
            React.createElement('button', {
              type: 'button', className: 'fl-chip' + (this.state.scope === 'mine' ? ' on' : ''),
              onClick: () => this.setScope('mine')
            }, 'Mine'),
            React.createElement('button', {
              type: 'button', className: 'fl-chip' + (this.state.scope === 'shared' ? ' on' : ''),
              onClick: () => this.setScope('shared')
            }, 'Shared'),
            React.createElement('button', {
              type: 'button', className: 'fl-chip' + (this.state.scope === 'public' ? ' on' : ''),
              onClick: () => this.setScope('public')
            }, 'Public'),
            React.createElement('button', {
              type: 'button', className: 'fl-btn ghost', disabled: this.state.busy,
              onClick: () => this.reload()
            }, 'Refresh')
          ),
          this.state.samples.length
            ? React.createElement('div', { className: 'fl-samples' },
              this.state.samples.map((s) => React.createElement('button', {
                key: s.name,
                type: 'button',
                className: 'fl-chip',
                disabled: this.state.busy,
                title: `${s.uniqueShips} unique / ${s.shipCount} ships`,
                onClick: () => this.importPayload({ sample: s.name })
              }, s.name.replace(/\.json$/i, '')))
            )
            : null
        )
      ),
      React.createElement('div', { className: 'fl-split' },
        React.createElement('section', { className: 'fl-panel' },
          React.createElement('h2', null, 'Your fleets'),
          React.createElement('div', { className: 'body' },
            this.state.loading
              ? React.createElement('div', { className: 'fl-empty' }, 'Loading…')
              : (!this.state.fleets.length
                ? React.createElement('div', { className: 'fl-empty' },
                  'No fleets yet — create one or import a Starjump JSON.')
                : React.createElement('div', { className: 'fl-list' },
                  this.state.fleets.map((f) => React.createElement('div', {
                    key: f.id,
                    className: 'fl-card' + (this.state.selected === f.id ? ' on' : ''),
                    onClick: () => this.selectFleet(f)
                  },
                  React.createElement('div', { className: 'title' },
                    f.name,
                    React.createElement('span', { className: 'fl-tag ' + (f.visibility || 'private') }, f.visibility || 'private'),
                    f.source === 'custom'
                      ? React.createElement('span', { className: 'fl-tag custom' }, 'custom')
                      : null,
                    f.remote ? React.createElement('span', { className: 'fl-tag remote' }, 'peer') : null
                  ),
                  React.createElement('div', { className: 'meta' },
                    `${f.shipCount || 0} ships`,
                    f.sourceFile ? ` · ${f.sourceFile}` : null
                  )
                  ))
                ))
          )
        ),
        React.createElement('section', { className: 'fl-panel' },
          React.createElement('h2', null, 'Details'),
          React.createElement('div', { className: 'body' }, this.renderDetail())
        )
      )
    );
  }
}

Fleet.CSS = CSS;

module.exports = Fleet;
