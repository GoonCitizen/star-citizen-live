'use strict';

/**
 * Document Exchange — Hub-backed catalog brought forward from Hub UI / Fabric TUI.
 * Gated by settings.documents.enable (see settings/local.js). Proxies Hub
 * ListDocuments / CreateDocument / PublishDocument / CreatePurchaseInvoice /
 * ClaimPurchase via LiveRelay `/services/star-citizen/documents/*`.
 */

const React = require('react');

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

class DocumentExchange extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      loading: false,
      busy: false,
      documents: [],
      hub: null,
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
      inventoryPeerId: ''
    };
  }

  componentDidMount () {
    this.refresh();
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
        hub: (res.j && res.j.hub) || null,
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

  async buyInvoice () {
    const id = this.state.selectedId;
    if (!id) return;
    this.setState({ busy: true, error: null, notice: null, invoice: null });
    try {
      const res = await fetch(`${BASE}/${encodeURIComponent(id)}/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }).then((r) => r.json().then((j) => ({ ok: r.ok, j })));
      if (!res.ok) throw new Error((res.j && res.j.error) || 'Purchase invoice failed');
      this.setState({
        busy: false,
        invoice: res.j.data || res.j,
        notice: 'Invoice created — pay the address, then claim with txid.'
      });
    } catch (e) {
      this.setState({ busy: false, error: e && e.message ? e.message : String(e) });
    }
  }

  async claimPurchase () {
    const id = this.state.selectedId;
    const txid = String(this.state.claimTxid || '').trim();
    if (!id || !txid) {
      this.setState({ error: 'Select a document and enter the payment txid' });
      return;
    }
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/${encodeURIComponent(id)}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txid })
      }).then((r) => r.json().then((j) => ({ ok: r.ok, j })));
      if (!res.ok) throw new Error((res.j && res.j.error) || 'Claim failed');
      this.setState({
        busy: false,
        claimResult: res.j.data || res.j,
        notice: 'Purchase claimed — content unlocked when Hub verified payment.'
      });
      await this.selectDoc(id);
    } catch (e) {
      this.setState({ busy: false, error: e && e.message ? e.message : String(e) });
    }
  }

  async requestInventory () {
    const peerId = String(this.state.inventoryPeerId || '').trim();
    if (!peerId) {
      this.setState({ error: 'Fabric peer id required for inventory request' });
      return;
    }
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId })
      }).then((r) => r.json().then((j) => ({ ok: r.ok, j })));
      if (!res.ok) throw new Error((res.j && res.j.error) || 'Inventory request failed');
      this.setState({
        busy: false,
        notice: 'Inventory request sent via Hub — watch peers / Hub activity for offers.'
      });
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
            'Set documents.enable: true in settings/local.js (and enable Advanced mode) to use Hub-backed Files ',
            '(list / create / publish / purchase — same surface as Hub UI and Fabric TUI documents packs).')
        )
      )
    );
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
    const inv = this.state.invoice;
    const claim = this.state.claimResult;
    const claimDoc = claim && (claim.document || claim);
    const claimPreview = claimDoc && claimDoc.contentBase64
      ? base64ToUtf8(claimDoc.contentBase64)
      : null;

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
          ? React.createElement('p', { className: 'dx-note' }, 'Binary / sealed content (base64 present).')
          : React.createElement('p', { className: 'dx-note' },
            'Metadata only — GetDocument may omit content until purchase / unlock.')),
      React.createElement('div', { className: 'dx-form' },
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
            disabled: this.state.busy || !(published && price > 0),
            onClick: () => this.buyInvoice()
          }, 'Purchase invoice'),
          React.createElement('button', {
            type: 'button',
            className: 'dx-btn',
            disabled: this.state.busy,
            onClick: () => this.selectDoc(id)
          }, 'Reload')
        ),
        inv
          ? React.createElement('div', { className: 'dx-note' },
            React.createElement('div', null, 'Pay ',
              React.createElement('b', null, `${Number(inv.amountSats || 0).toLocaleString()} sats`),
              ' to'),
            React.createElement('div', { className: 'dx-mono' }, inv.address || '—'))
          : null,
        React.createElement('label', null, 'Claim txid (after payment)',
          React.createElement('input', {
            value: this.state.claimTxid,
            onChange: (e) => this.setState({ claimTxid: e.target.value }),
            placeholder: 'txid…'
          })
        ),
        React.createElement('div', { className: 'dx-actions' },
          React.createElement('button', {
            type: 'button',
            className: 'dx-btn',
            disabled: this.state.busy || !this.state.claimTxid.trim(),
            onClick: () => this.claimPurchase()
          }, 'Claim purchase')
        ),
        claimPreview != null
          ? React.createElement('pre', {
            className: 'dx-mono',
            style: { whiteSpace: 'pre-wrap', margin: 0, maxHeight: 160, overflow: 'auto' }
          }, claimPreview.slice(0, 4000))
          : null
      )
    );
  }

  render () {
    if (this.props.documentsEnable === false) return this.renderDisabled();

    const docs = this.state.documents || [];
    return React.createElement('div', { className: 'dx-wrap' },
      React.createElement('style', null, CSS),
      React.createElement('section', { className: 'dx-panel' },
        React.createElement('h2', null, '📁 Files ',
          React.createElement('span', { className: 'sub' },
            this.state.hub
              ? `Hub ${this.state.hub}`
              : 'Hub-backed L1 publish / purchase')),
        React.createElement('div', { className: 'dx-body' },
          React.createElement('p', { className: 'dx-note' },
            'Same Document Exchange surface as Hub ',
            React.createElement('code', null, '/documents'),
            ' and Fabric TUI ',
            React.createElement('code', null, 'documents'),
            ' / ',
            React.createElement('code', null, 'documents-market'),
            ' packs. Create locally on the Hub, publish free or priced, then purchase + claim.'),
          this.state.error
            ? React.createElement('div', { className: 'dx-err' }, this.state.error)
            : null,
          this.state.notice
            ? React.createElement('div', { className: 'dx-ok' }, this.state.notice)
            : null,
          React.createElement('div', { className: 'dx-actions' },
            React.createElement('button', {
              type: 'button',
              className: 'dx-btn',
              disabled: this.state.loading || this.state.busy,
              onClick: () => this.refresh()
            }, this.state.loading ? 'Loading…' : 'Refresh catalog')
          )
        )
      ),
      React.createElement('section', { className: 'dx-panel' },
        React.createElement('h2', null, 'Create'),
        React.createElement('div', { className: 'dx-body' },
          React.createElement('div', { className: 'dx-form' },
            React.createElement('label', null, 'Name',
              React.createElement('input', {
                value: this.state.createName,
                onChange: (e) => this.setState({ createName: e.target.value }),
                placeholder: 'note.txt'
              })
            ),
            React.createElement('label', null, 'MIME',
              React.createElement('input', {
                value: this.state.createMime,
                onChange: (e) => this.setState({ createMime: e.target.value })
              })
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
              }, 'Create on Hub')
            )
          )
        )
      ),
      React.createElement('section', { className: 'dx-panel' },
        React.createElement('h2', null, 'Catalog ',
          React.createElement('span', { className: 'sub' }, `${docs.length} document${docs.length === 1 ? '' : 's'}`)),
        React.createElement('div', { className: 'dx-body' },
          docs.length === 0
            ? React.createElement('p', { className: 'dx-note' },
              this.state.loading ? 'Loading…' : 'No documents on this Hub yet.')
            : React.createElement('table', { className: 'dx-table' },
              React.createElement('thead', null,
                React.createElement('tr', null,
                  React.createElement('th', null, 'Name'),
                  React.createElement('th', null, 'Id'),
                  React.createElement('th', null, 'Price'),
                  React.createElement('th', null, '')
                )
              ),
              React.createElement('tbody', null,
                docs.map((d) => {
                  const id = d.id || d.sha256 || d.document;
                  const price = Number(d.purchasePriceSats || 0);
                  const pub = !!(d.published);
                  return React.createElement('tr', { key: id },
                    React.createElement('td', null,
                      d.name || '—',
                      ' ',
                      pub
                        ? React.createElement('span', { className: 'dx-tag pub' }, 'pub')
                        : React.createElement('span', { className: 'dx-tag mut' }, 'local')
                    ),
                    React.createElement('td', { className: 'dx-mono' }, shortId(id)),
                    React.createElement('td', null,
                      price > 0 ? `${price.toLocaleString()} sats` : '—'),
                    React.createElement('td', null,
                      React.createElement('button', {
                        type: 'button',
                        className: 'dx-btn',
                        disabled: this.state.busy,
                        onClick: () => this.selectDoc(id)
                      }, 'Open')
                    )
                  );
                })
              )
            ),
          this.renderDetail()
        )
      ),
      React.createElement('section', { className: 'dx-panel' },
        React.createElement('h2', null, 'Peer inventory'),
        React.createElement('div', { className: 'dx-body' },
          React.createElement('p', { className: 'dx-note' },
            'Optional: ask Hub to ',
            React.createElement('code', null, 'RequestPeerInventory'),
            ' from a Fabric peer (same as Hub peer inventory / TUI ',
            React.createElement('code', null, '/request'),
            ').'),
          React.createElement('div', { className: 'dx-form' },
            React.createElement('label', null, 'Peer Fabric id (hex)',
              React.createElement('input', {
                value: this.state.inventoryPeerId,
                onChange: (e) => this.setState({ inventoryPeerId: e.target.value }),
                placeholder: 'compressed pubkey…'
              })
            ),
            React.createElement('div', { className: 'dx-actions' },
              React.createElement('button', {
                type: 'button',
                className: 'dx-btn',
                disabled: this.state.busy || !this.state.inventoryPeerId.trim(),
                onClick: () => this.requestInventory()
              }, 'Request inventory')
            )
          )
        )
      )
    );
  }
}

DocumentExchange.CSS = CSS;

module.exports = DocumentExchange;
