'use strict';

/**
 * Document Exchange — this node's file catalog plus peer inventories.
 * Gated by settings.documents.enable (see settings/local.js). Chat 📎 attach
 * writes the local catalog. LiveRelay `/services/star-citizen/documents/*`.
 */

const React = require('react');
const {
  DOCUMENT_TYPE_FILTERS,
  DOCUMENT_STATUS_FILTERS,
  filterDocuments,
  documentTypeCounts,
  documentTypeKey
} = require('../functions/documentSearch');

const BASE = '/services/star-citizen/documents';

const CSS = `
  .dx-wrap{width:100%;max-width:none;margin:0;padding:12px 14px;display:grid;gap:14px;box-sizing:border-box}
  .dx-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .dx-panel h2{font-size:13px;margin:0;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:600;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .dx-panel h2 .sub{color:var(--muted);font-weight:400;font-size:12px;flex:1}
  .dx-body{padding:14px 16px;display:grid;gap:12px}
  .dx-form{display:grid;gap:10px;max-width:640px}
  .dx-form label{display:grid;gap:4px;font-size:12px;color:var(--muted)}
  .dx-form input,.dx-form textarea,.dx-form select{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:7px;padding:8px 10px;font-size:13px}
  .dx-form textarea{min-height:110px;font-family:'Cascadia Code',Consolas,monospace;font-size:12px;resize:vertical}
  .dx-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .dx-btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:7px;padding:6px 12px;font-size:12px;cursor:pointer}
  .dx-btn:hover{border-color:var(--accent)}
  .dx-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  .dx-btn.pin-on{border-color:#f7931a;background:rgba(247,147,26,.12)}
  .dx-btn:disabled{opacity:.5;cursor:not-allowed}
  .dx-table{width:100%;border-collapse:collapse;font-size:12px}
  .dx-table th,.dx-table td{text-align:left;padding:8px 10px;border-bottom:1px solid #20262f;vertical-align:top}
  .dx-table th{color:var(--muted);font-weight:600}
  .dx-mono{font-family:'Cascadia Code',Consolas,monospace;font-size:11px;word-break:break-all}
  .dx-err{color:var(--bad,#f85149);font-size:12.5px;line-height:1.5}
  .dx-ok{color:var(--good);font-size:12.5px;line-height:1.5}
  .dx-note{color:var(--muted);font-size:12px;line-height:1.55;margin:0}
  .dx-tag{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:5px;display:inline-block}
  .dx-tag.pub{background:rgba(63,185,80,.15);color:var(--good)}
  .dx-tag.price{background:rgba(247,147,26,.16);color:#f7931a}
  .dx-tag.mut{background:rgba(110,118,129,.18);color:var(--muted)}
  .dx-detail{display:grid;gap:8px;padding:10px 12px;background:var(--panel2);border:1px solid var(--line);border-radius:8px}
  .dx-search{display:grid;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--panel)}
  .dx-search-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .dx-search input[type="search"]{flex:1;min-width:160px;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:8px 10px;font-size:13px}
  .dx-search input[type="search"]:focus{outline:none;border-color:var(--accent)}
  .dx-search-clear{background:var(--panel2);border:1px solid var(--line);color:var(--muted);border-radius:7px;
    width:32px;height:32px;cursor:pointer;font-size:15px;line-height:1}
  .dx-search-clear:hover{color:var(--text);border-color:var(--accent)}
  .dx-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  .dx-chip{font-size:11.5px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);background:transparent;
    color:var(--muted);cursor:pointer}
  .dx-chip.on{background:rgba(59,130,246,.15);color:var(--accent);border-color:var(--accent)}
  .dx-chip .n{opacity:.75;margin-left:4px;font-variant-numeric:tabular-nums}
  .dx-type{font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;margin-left:6px;
    background:rgba(110,118,129,.18);color:var(--muted);text-transform:uppercase;letter-spacing:.3px}
  .dx-panel h2 .dx-head-actions{margin-left:auto;display:flex;gap:6px;align-items:center;flex:none}
  .dx-create{padding:12px 16px;border-bottom:1px solid var(--line);background:var(--panel2)}
  .dx-offers{display:grid;gap:6px;margin-top:4px}
  .dx-offers h3{margin:0;font-size:12px;font-weight:650;color:var(--muted);text-transform:uppercase;letter-spacing:.3px}
  .dx-offers table{width:100%;border-collapse:collapse;font-size:12px}
  .dx-offers th,.dx-offers td{text-align:left;padding:6px 8px;border-bottom:1px solid #20262f}
  .dx-offers th{color:var(--muted);font-weight:600}
  .dx-tag.peer{background:rgba(56,139,253,.14);color:var(--accent)}
  .dx-type.bitcoin-block,.dx-type.bitcoin-tx{background:rgba(247,147,26,.16);color:#f7931a}
  .dx-type.text{background:rgba(63,185,80,.12);color:var(--good)}
  .dx-type.image{background:rgba(56,139,253,.14);color:var(--accent)}
  .dx-type.json{background:rgba(163,113,247,.14);color:#a371f7}
`;

function shortId (id) {
  const s = String(id || '');
  if (s.length <= 18) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
}

function utf8ToBase64 (text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToUtf8 (b64) {
  try {
    const binary = atob(String(b64 || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch (_) {
    return null;
  }
}

function pickDocuments (payload) {
  if (!payload) return [];
  const raw = payload.documents || payload.data || payload;
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.documents)) return raw.documents;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.keys(raw).map((id) => Object.assign({ id }, raw[id]));
  }
  return [];
}

function sourceLabel (doc) {
  if (!doc) return 'this node';
  if (doc.local === false || doc.source === 'peer') {
    const n = Number(doc.peerCount || 0);
    const who = doc.peerAlias || (doc.peerPubkey ? shortId(doc.peerPubkey) : 'peer');
    if (n > 1) return `${n} peers · from ${who}`;
    return who;
  }
  const extra = Number(doc.peerCount || 0);
  if (extra > 0) return `this node + ${extra} peer${extra === 1 ? '' : 's'}`;
  return 'this node';
}

function priceLabel (doc) {
  const n = Number(doc && (doc.bestPriceSats != null ? doc.bestPriceSats : doc.purchasePriceSats) || 0);
  if (!Number.isFinite(n) || n <= 0) return 'free';
  return `${n.toLocaleString()} sats`;
}

class DocumentExchange extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      loading: false,
      busy: false,
      documents: [],
      hub: null,
      local: true,
      error: null,
      notice: null,
      selectedId: null,
      detail: null,
      createName: '',
      createMime: 'text/plain',
      createText: '',
      publishPrice: '25',
      claimTxid: '',
      invoice: null,
      claimResult: null,
      inventoryBusy: false,
      createOpen: false,
      searchQuery: '',
      searchType: 'all',
      searchStatus: 'all'
    };
    this._inventoryTimer = null;
    this._inventoryPolls = 0;
  }

  componentDidMount () {
    this.refresh();
  }

  componentWillUnmount () {
    if (this._inventoryTimer) clearTimeout(this._inventoryTimer);
  }

  componentDidUpdate (prev) {
    if (prev.documentsEnable !== this.props.documentsEnable) {
      this.refresh();
    }
  }

  async refresh () {
    if (this.props.documentsEnable === false) {
      this.setState({ documents: [], detail: null, error: null, loading: false });
      return;
    }
    this.setState({ loading: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}`).then((r) => r.json().then((j) => ({ ok: r.ok, j })));
      if (!res.ok) throw new Error((res.j && res.j.error) || 'List documents failed');
      const docs = pickDocuments(res.j.data || res.j);
      this.setState({
        documents: docs,
        hub: null,
        local: !!(res.j && res.j.local !== false),
        loading: false
      });
    } catch (e) {
      this.setState({
        loading: false,
        error: e && e.message ? e.message : String(e),
        documents: []
      });
    }
  }

  async selectDoc (id) {
    const documentId = String(id || '').trim();
    if (!documentId) return;
    this.setState({ selectedId: documentId, busy: true, error: null, invoice: null, claimResult: null });
    try {
      const res = await fetch(`${BASE}/${encodeURIComponent(documentId)}`)
        .then((r) => r.json().then((j) => ({ ok: r.ok, j })));
      if (!res.ok) throw new Error((res.j && res.j.error) || 'Get document failed');
      this.setState({ detail: res.j.data || res.j, busy: false });
    } catch (e) {
      this.setState({ busy: false, error: e && e.message ? e.message : String(e), detail: null });
    }
  }

  async createDoc () {
    const name = String(this.state.createName || '').trim() || 'note.txt';
    const mime = String(this.state.createMime || 'text/plain').trim();
    const text = String(this.state.createText || '');
    if (!text) {
      this.setState({ error: 'Content is required' });
      return;
    }
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          mime,
          contentBase64: utf8ToBase64(text)
        })
      }).then((r) => r.json().then((j) => ({ ok: r.ok, j })));
      if (!res.ok) throw new Error((res.j && res.j.error) || 'Create failed');
      const doc = (res.j.data && res.j.data.document) || (res.j.data) || null;
      const id = doc && (doc.id || doc.sha256);
      this.setState({
        busy: false,
        createOpen: false,
        notice: id ? `Created ${shortId(id)}` : 'Created',
        createText: '',
        createName: ''
      });
      await this.refresh();
      if (id) await this.selectDoc(id);
    } catch (e) {
      this.setState({ busy: false, error: e && e.message ? e.message : String(e) });
    }
  }

  async queryPeers () {
    this.setState({ inventoryBusy: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/inventory`, { method: 'POST' })
        .then((r) => r.json().then((j) => ({ ok: r.ok, j })));
      if (!res.ok) throw new Error((res.j && res.j.error) || 'Inventory query failed');
      const data = (res.j && res.j.data) || res.j || {};
      const requested = Number(data.requested) || 0;
      this.setState({
        inventoryBusy: false,
        notice: requested
          ? `Asked ${requested} peer${requested === 1 ? '' : 's'} for inventories…`
          : (data.ready === false
            ? 'Fabric peer is not up — showing cached offers'
            : 'No connected peers — showing cached offers')
      });
      await this.refresh();
      if (requested > 0) {
        this._inventoryPolls = 0;
        if (this._inventoryTimer) clearTimeout(this._inventoryTimer);
        this._inventoryTimer = setTimeout(() => this.pollInventory(), 800);
      }
    } catch (e) {
      this.setState({
        inventoryBusy: false,
        error: e && e.message ? e.message : String(e)
      });
    }
  }

  async pollInventory () {
    await this.refresh();
    if (this.state.selectedId) await this.selectDoc(this.state.selectedId);
    this._inventoryPolls += 1;
    if (this._inventoryPolls < 4) {
      this._inventoryTimer = setTimeout(() => this.pollInventory(), 1000);
    }
  }

  async publishSelected () {
    const id = this.state.selectedId;
    if (!id) return;
    const purchasePriceSats = Math.max(0, Math.floor(Number(this.state.publishPrice) || 0));
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/${encodeURIComponent(id)}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchasePriceSats })
      }).then((r) => r.json().then((j) => ({ ok: r.ok, j })));
      if (!res.ok) throw new Error((res.j && res.j.error) || 'Publish failed');
      this.setState({
        busy: false,
        notice: purchasePriceSats > 0
          ? `Published at ${purchasePriceSats.toLocaleString()} sats`
          : 'Published (free)'
      });
      await this.refresh();
      await this.selectDoc(id);
    } catch (e) {
      this.setState({ busy: false, error: e && e.message ? e.message : String(e) });
    }
  }

  async pinDoc (id, pinned) {
    if (!id) return;
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(`/services/star-citizen/files/${encodeURIComponent(id)}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: pinned === true })
      }).then((r) => r.json().then((j) => ({ ok: r.ok, j })));
      if (!res.ok) throw new Error((res.j && res.j.error) || 'Pin failed');
      this.setState({
        busy: false,
        notice: pinned ? 'Pinned to your profile' : 'Unpinned from your profile'
      });
      await this.refresh();
    } catch (e) {
      this.setState({ busy: false, error: e && e.message ? e.message : String(e) });
    }
  }

  renderDisabled () {
    return React.createElement('div', { className: 'dx-wrap' },
      React.createElement('style', null, CSS),
      React.createElement('section', { className: 'dx-panel' },
        React.createElement('h2', null, '📁 Files'),
        React.createElement('div', { className: 'dx-body' },
          React.createElement('p', { className: 'dx-note' },
            'Set documents.enable: true in settings/local.js (and enable Advanced mode) to browse this node\'s file catalog. Chat 📎 attach still writes files here when the tab is hidden.')
        )
      )
    );
  }

  clearSearch () {
    this.setState({ searchQuery: '', searchType: 'all', searchStatus: 'all' });
  }

  visibleDocuments () {
    return filterDocuments(this.state.documents, {
      query: this.state.searchQuery,
      type: this.state.searchType,
      status: this.state.searchStatus
    });
  }

  renderSearchControls (docs) {
    const counts = documentTypeCounts(docs);
    const q = this.state.searchQuery || '';
    const type = this.state.searchType || 'all';
    const status = this.state.searchStatus || 'all';
    const filtered = this.visibleDocuments();
    const active = !!(q.trim() || type !== 'all' || status !== 'all');
    return React.createElement('div', { className: 'dx-search' },
      React.createElement('div', { className: 'dx-search-row' },
        React.createElement('input', {
          type: 'search',
          value: q,
          placeholder: 'Search name, id, MIME, sha…',
          'aria-label': 'Search documents',
          autoComplete: 'off',
          spellCheck: false,
          onChange: (e) => this.setState({ searchQuery: e.target.value })
        }),
        active
          ? React.createElement('button', {
            type: 'button',
            className: 'dx-search-clear',
            title: 'Clear search',
            'aria-label': 'Clear document search',
            onClick: () => this.clearSearch()
          }, '×')
          : null,
        React.createElement('span', { className: 'dx-note' },
          `${filtered.length} shown` + (filtered.length !== docs.length ? ` / ${docs.length}` : ''))
      ),
      React.createElement('div', { className: 'dx-chips', role: 'group', 'aria-label': 'Document type' },
        DOCUMENT_TYPE_FILTERS.map(([key, label]) => {
          const n = counts[key] || 0;
          if (key !== 'all' && n === 0 && type !== key) return null;
          return React.createElement('button', {
            key: key,
            type: 'button',
            className: 'dx-chip' + (type === key ? ' on' : ''),
            onClick: () => this.setState({ searchType: key })
          },
          label,
          React.createElement('span', { className: 'n' }, n)
          );
        })
      ),
      React.createElement('div', { className: 'dx-chips', role: 'group', 'aria-label': 'Document status' },
        DOCUMENT_STATUS_FILTERS.map(([key, label]) => React.createElement('button', {
          key: key,
          type: 'button',
          className: 'dx-chip' + (status === key ? ' on' : ''),
          onClick: () => this.setState({ searchStatus: key })
        }, label))
      )
    );
  }

  typeLabel (key) {
    const row = DOCUMENT_TYPE_FILTERS.find(([k]) => k === key);
    return (row && row[1]) || key;
  }

  renderDetail () {
    const detail = this.state.detail;
    if (!detail) return null;
    const doc = detail.document || detail;
    if (!doc) return null;
    const id = doc.id || this.state.selectedId;
    const published = !!(doc.published || (detail.published));
    const price = Number(doc.purchasePriceSats || 0);
    const contentB64 = doc.contentBase64 || null;
    const preview = contentB64 ? base64ToUtf8(contentB64) : null;
    const isLocal = doc.local !== false && detail.local !== false;

    return React.createElement('div', { className: 'dx-detail' },
      React.createElement('div', null,
        React.createElement('b', null, doc.name || 'document'),
        ' ',
        published
          ? React.createElement('span', { className: 'dx-tag pub' }, 'published')
          : React.createElement('span', { className: 'dx-tag mut' }, 'local'),
        price > 0
          ? React.createElement('span', { className: 'dx-tag price', style: { marginLeft: 6 } },
            `${price.toLocaleString()} sats`)
          : null
      ),
      React.createElement('div', { className: 'dx-mono' }, id),
      React.createElement('div', { className: 'dx-note' },
        (doc.mime || 'application/octet-stream'),
        doc.size != null ? ` · ${Number(doc.size).toLocaleString()} bytes` : ''
      ),
      preview != null
        ? React.createElement('pre', {
          className: 'dx-mono',
          style: { whiteSpace: 'pre-wrap', margin: 0, maxHeight: 180, overflow: 'auto' }
        }, preview.slice(0, 4000))
        : (contentB64
          ? React.createElement('p', { className: 'dx-note' }, 'Binary content (base64 present).')
          : React.createElement('p', { className: 'dx-note' },
            isLocal ? 'No content on this node.' : 'Content lives on the offering peer — this listing is metadata only.')),
      this.renderOffers(detail.offers || [], id),
      React.createElement('div', { className: 'dx-actions' },
        React.createElement('a', {
          className: 'dx-btn',
          href: '/files/' + encodeURIComponent(id)
        }, 'Open page'),
        isLocal
          ? React.createElement('button', {
            type: 'button',
            className: 'dx-btn' + (doc.profilePinned ? ' primary' : ''),
            disabled: this.state.busy,
            title: doc.profilePinned ? 'Unpin from profile' : 'Pin to profile',
            onClick: () => this.pinDoc(id, !doc.profilePinned)
          }, '📌 ' + (doc.profilePinned ? 'Unpin' : 'Pin to profile'))
          : null
      ),
      isLocal
        ? React.createElement('div', { className: 'dx-form' },
          React.createElement('label', null, 'Publish price (sats, 0 = free)',
            React.createElement('input', {
              type: 'number',
              min: 0,
              value: this.state.publishPrice,
              onChange: (e) => this.setState({ publishPrice: e.target.value })
            })
          ),
          React.createElement('div', { className: 'dx-actions' },
            React.createElement('button', {
              type: 'button',
              className: 'dx-btn primary',
              disabled: this.state.busy,
              onClick: () => this.publishSelected()
            }, 'Publish'),
            React.createElement('button', {
              type: 'button',
              className: 'dx-btn',
              disabled: this.state.busy,
              onClick: () => this.selectDoc(id)
            }, 'Reload')
          )
        )
        : React.createElement('div', { className: 'dx-actions' },
          React.createElement('button', {
            type: 'button',
            className: 'dx-btn',
            disabled: this.state.busy,
            onClick: () => this.selectDoc(id)
          }, 'Reload')
        )
    );
  }

  renderOffers (offers) {
    const rows = Array.isArray(offers) ? offers : [];
    return React.createElement('div', { className: 'dx-offers' },
      React.createElement('h3', null, 'Offers'),
      rows.length
        ? React.createElement('table', null,
          React.createElement('thead', null,
            React.createElement('tr', null,
              React.createElement('th', null, 'Peer'),
              React.createElement('th', null, 'Price'),
              React.createElement('th', null, '')
            )
          ),
          React.createElement('tbody', null,
            rows.map((o, i) => React.createElement('tr', { key: o.id || ((o.peerPubkey || 'p') + ':' + i) },
              React.createElement('td', null,
                o.local
                  ? React.createElement('span', { className: 'dx-tag mut' }, 'this node')
                  : React.createElement('span', { className: 'dx-tag peer' },
                    o.peerAlias || shortId(o.peerPubkey || o.peerAddress || 'peer'))
              ),
              React.createElement('td', { className: i === 0 ? 'dx-ok' : null },
                priceLabel(o)),
              React.createElement('td', { className: 'dx-note' },
                o.published === false ? 'unpublished' : (i === 0 ? 'lowest' : ''))
            ))
          )
        )
        : React.createElement('p', { className: 'dx-note' },
          'No other peer listings for this file yet — Query peers to refresh inventories.')
    );
  }

  renderCreateForm () {
    if (!this.state.createOpen) return null;
    return React.createElement('div', { className: 'dx-create' },
      React.createElement('div', { className: 'dx-form' },
        React.createElement('label', null, 'Name',
          React.createElement('input', {
            value: this.state.createName,
            onChange: (e) => this.setState({ createName: e.target.value }),
            placeholder: 'note.txt'
          })
        ),
        React.createElement('label', null, 'MIME',
          React.createElement('select', {
            value: this.state.createMime,
            onChange: (e) => this.setState({ createMime: e.target.value })
          },
          React.createElement('option', { value: 'text/plain' }, 'text/plain'),
          React.createElement('option', { value: 'text/markdown' }, 'text/markdown'),
          React.createElement('option', { value: 'application/json' }, 'application/json'),
          React.createElement('option', { value: 'text/html' }, 'text/html'),
          React.createElement('option', { value: 'application/octet-stream' }, 'application/octet-stream')
          )
        ),
        React.createElement('label', null, 'Content (UTF-8 text)',
          React.createElement('textarea', {
            value: this.state.createText,
            onChange: (e) => this.setState({ createText: e.target.value }),
            placeholder: 'Paste text to publish…'
          })
        ),
        React.createElement('div', { className: 'dx-actions' },
          React.createElement('button', {
            type: 'button',
            className: 'dx-btn primary',
            disabled: this.state.busy || !this.state.createText,
            onClick: () => this.createDoc()
          }, 'Create on this node'),
          React.createElement('button', {
            type: 'button',
            className: 'dx-btn',
            onClick: () => this.setState({ createOpen: false })
          }, 'Cancel')
        )
      )
    );
  }

  render () {
    if (this.props.documentsEnable === false) return this.renderDisabled();

    const docs = this.state.documents || [];
    const visible = this.visibleDocuments();
    return React.createElement('div', { className: 'dx-wrap' },
      React.createElement('style', null, CSS),
      React.createElement('section', { className: 'dx-panel' },
        React.createElement('h2', null, '📁 Files ',
          React.createElement('span', { className: 'sub' },
            `${docs.length} listing${docs.length === 1 ? '' : 's'}`),
          React.createElement('div', { className: 'dx-head-actions' },
            React.createElement('button', {
              type: 'button',
              className: 'dx-btn',
              disabled: this.state.loading || this.state.busy,
              onClick: () => this.refresh()
            }, this.state.loading ? 'Loading…' : 'Refresh'),
            React.createElement('button', {
              type: 'button',
              className: 'dx-btn',
              disabled: this.state.inventoryBusy || this.state.busy,
              onClick: () => this.queryPeers()
            }, this.state.inventoryBusy ? 'Querying…' : 'Query peers'),
            React.createElement('button', {
              type: 'button',
              className: 'dx-btn' + (this.state.createOpen ? ' primary' : ''),
              'aria-pressed': !!this.state.createOpen,
              onClick: () => this.setState({ createOpen: !this.state.createOpen })
            }, this.state.createOpen ? 'Close' : 'New file')
          )
        ),
        React.createElement('div', { className: 'dx-body', style: { paddingBottom: 0 } },
          React.createElement('p', { className: 'dx-note' },
            'This node\'s catalog plus published listings from connected Fabric peers. Publish marks a local file listed (optional sats on the ',
            React.createElement('code', null, 'fabric-doc:'),
            ' chat wire). Pin a file to your profile with 📌 on its page so Federation groups see the listing (metadata only).'),
          this.state.error
            ? React.createElement('div', { className: 'dx-err' }, this.state.error)
            : null,
          this.state.notice
            ? React.createElement('div', { className: 'dx-ok' }, this.state.notice)
            : null
        ),
        this.renderCreateForm(),
        docs.length || this.state.searchQuery || this.state.searchType !== 'all' || this.state.searchStatus !== 'all'
          ? this.renderSearchControls(docs)
          : null,
        React.createElement('div', { className: 'dx-body' },
          docs.length === 0
            ? React.createElement('p', { className: 'dx-note' },
              this.state.loading ? 'Loading…' : 'No files yet — New file, or Query peers for listings on the mesh.')
            : (visible.length === 0
              ? React.createElement('p', { className: 'dx-note' },
                'No documents match these search criteria — clear filters or try another type.')
              : React.createElement('table', { className: 'dx-table' },
                React.createElement('thead', null,
                  React.createElement('tr', null,
                    React.createElement('th', null, 'Name'),
                    React.createElement('th', null, 'Type'),
                    React.createElement('th', null, 'From'),
                    React.createElement('th', null, 'Price'),
                    React.createElement('th', null, '')
                  )
                ),
                React.createElement('tbody', null,
                  visible.map((d) => {
                    const id = d.id || d.sha256 || d.document;
                    const pub = !!(d.published);
                    const typeKey = documentTypeKey(d);
                    const isPeer = d.local === false || d.source === 'peer';
                    return React.createElement('tr', { key: id },
                      React.createElement('td', null,
                        d.name || '—',
                        ' ',
                        isPeer
                          ? React.createElement('span', { className: 'dx-tag peer' }, 'peer')
                          : (pub
                            ? React.createElement('span', { className: 'dx-tag pub' }, 'pub')
                            : React.createElement('span', { className: 'dx-tag mut' }, 'local'))
                      ),
                      React.createElement('td', null,
                        React.createElement('span', {
                          className: 'dx-type ' + typeKey,
                          title: d.mime || 'application/octet-stream'
                        }, this.typeLabel(typeKey))
                      ),
                      React.createElement('td', null, sourceLabel(d)),
                      React.createElement('td', null, priceLabel(d)),
                      React.createElement('td', null,
                        React.createElement('a', {
                          className: 'dx-btn',
                          href: '/files/' + encodeURIComponent(id)
                        }, 'Open'),
                        !isPeer
                          ? React.createElement('button', {
                            type: 'button',
                            className: 'dx-btn' + (d.profilePinned ? ' pin-on' : ''),
                            disabled: this.state.busy,
                            title: d.profilePinned ? 'Unpin from profile' : 'Pin to profile',
                            onClick: () => this.pinDoc(id, !d.profilePinned)
                          }, '📌')
                          : null
                      )
                    );
                  })
                )
              )),
          this.renderDetail()
        )
      )
    );
  }
}

DocumentExchange.CSS = CSS;

module.exports = DocumentExchange;
