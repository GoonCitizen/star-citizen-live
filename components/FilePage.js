'use strict';

/**
 * Dedicated file page — `/files/:id`.
 * Local catalog rows, gossiped profile.files listings, and peer inventory
 * offers share this page. Operators pin a local file to their profile with 📌.
 */

const React = require('react');
const { fileHref } = require('../functions/profileFiles');
const { profileHref } = require('../functions/identityActor');

const BASE = '/services/star-citizen';

const CSS = `
  .fpage{width:100%;max-width:none;margin:0;padding:12px 14px;display:grid;gap:16px;box-sizing:border-box}
  .fpage-back{color:var(--muted);font-size:13px;text-decoration:none;cursor:pointer;background:none;border:none;padding:0;font:inherit;text-align:left}
  .fpage-back:hover{color:var(--accent)}
  .fpage-hero{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:22px 24px}
  .fpage-hero h1{margin:0 0 8px;font-size:20px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding-right:52px}
  .fpage-hero .sub{color:var(--muted);font-size:12.5px;line-height:1.5;word-break:break-all;
    font-family:'Cascadia Code',Consolas,monospace}
  .fpage-pin{position:absolute;top:14px;right:14px;background:var(--panel2);border:1px solid var(--line);
    border-radius:8px;padding:5px 9px;cursor:pointer;font-size:16px;line-height:1}
  .fpage-pin:hover{border-color:#f7931a}
  .fpage-pin.on{border-color:#f7931a;background:rgba(247,147,26,.12)}
  .fpage-pin:disabled{opacity:.45;cursor:default}
  .fpage-tag{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:5px;letter-spacing:.02em}
  .fpage-tag.pub{background:rgba(63,185,80,.15);color:var(--good)}
  .fpage-tag.pin{background:rgba(247,147,26,.16);color:#f7931a}
  .fpage-tag.peer{background:rgba(56,139,253,.15);color:var(--accent)}
  .fpage-tag.sync{background:rgba(56,139,253,.15);color:var(--accent)}
  .fpage-toggle{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);
    border-radius:8px;background:var(--panel2)}
  .fpage-toggle label{display:grid;gap:4px;font-size:13px;font-weight:600;cursor:pointer}
  .fpage-toggle .hint{font-weight:400;color:var(--muted);font-size:12px;line-height:1.45}
  .fpage-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .fpage-panel h2{font-size:13px;margin:0;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:600}
  .fpage-panel .body{padding:14px 16px;display:grid;gap:10px}
  .fpage-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:9px 12px;font-size:13px}
  .fpage-ok{background:rgba(63,185,80,.12);color:var(--good);border-radius:7px;padding:9px 12px;font-size:13px}
  .fpage-hint{color:var(--muted);font-size:12.5px;line-height:1.55}
  .fpage-kv{font-family:'Cascadia Code',Consolas,monospace;font-size:11.5px;word-break:break-all;
    background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px 10px}
  .fpage-kv b{color:var(--muted);font-weight:600;font-family:'Segoe UI',system-ui,sans-serif;font-size:11px}
  .fpage-btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:7px;
    padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block}
  .fpage-btn:hover{border-color:var(--accent);color:var(--accent)}
  .fpage-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
`;

function formatBytes (n) {
  const size = Number(n);
  if (!Number.isFinite(size) || size < 0) return '—';
  if (size >= 1048576) return (size / 1048576).toFixed(1) + ' MB';
  if (size >= 1024) return Math.round(size / 1024) + ' KB';
  return size + ' B';
}

function shortKey (pk) {
  return pk ? (pk.slice(0, 10) + '…' + pk.slice(-6)) : '—';
}

class FilePage extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      loading: true,
      error: null,
      notice: null,
      detail: null,
      pinBusy: false,
      clusterBusy: false
    };
  }

  get fileId () {
    return FilePage.idFromLocation() || this.props.fileId || this.props.id || null;
  }

  componentDidMount () {
    this.load();
  }

  async load () {
    const id = this.fileId;
    if (!id) {
      this.setState({ loading: false, error: 'Missing file' });
      return;
    }
    this.setState({ loading: true, error: null });
    try {
      const res = await fetch(`${BASE}/files/${encodeURIComponent(id)}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j && j.error) || 'File unavailable');
      this.setState({ loading: false, detail: j.data || j, error: null });
    } catch (e) {
      this.setState({ loading: false, error: e.message || String(e) });
    }
  }

  goBack () {
    if (typeof window === 'undefined') return;
    if (window.history.length > 1) window.history.back();
    else window.location.href = '/#files';
  }

  async putPin (on) {
    const id = this.fileId;
    if (!id) return;
    this.setState({ pinBusy: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/files/${encodeURIComponent(id)}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: on === true })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j && j.error) || res.statusText);
      this.setState({
        pinBusy: false,
        notice: on ? 'Pinned to your profile for Federation groups.' : 'Unpinned from your profile.',
        detail: (j && j.data) || this.state.detail
      });
      await this.load();
    } catch (e) {
      this.setState({ pinBusy: false, error: e.message || String(e) });
    }
  }

  async putClusterSync (on) {
    const id = this.fileId;
    if (!id) return;
    this.setState({ clusterBusy: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/files/${encodeURIComponent(id)}/cluster-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusterSync: on === true })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j && j.error) || res.statusText);
      this.setState({
        clusterBusy: false,
        notice: on
          ? 'This file will copy to your other linked devices over Fabric.'
          : 'Stopped syncing this file to other devices.',
        detail: (j && j.data) || this.state.detail
      });
      await this.load();
    } catch (e) {
      this.setState({ clusterBusy: false, error: e.message || String(e) });
    }
  }

  render () {
    if (this.state.loading) {
      return React.createElement('div', { className: 'fpage' },
        React.createElement('div', { className: 'fpage-hint' }, 'Loading file…'));
    }
    if (this.state.error && !this.state.detail) {
      return React.createElement('div', { className: 'fpage' },
        React.createElement('button', { type: 'button', className: 'fpage-back', onClick: () => this.goBack() }, '← Back'),
        React.createElement('div', { className: 'fpage-err' }, this.state.error)
      );
    }
    const d = this.state.detail || {};
    const rec = d.record || d.file || {};
    const id = rec.id || d.id || this.fileId;
    const pinned = d.profilePinned === true || rec.profilePinned === true;
    const clusterSync = d.clusterSync === true || rec.clusterSync === true;
    const canPin = d.self === true && d.local !== false;
    const canCluster = canPin;
    const publisher = d.publisher || rec.publisher || null;
    const publisherHref = publisher ? (profileHref(publisher) || ('/profiles/' + encodeURIComponent(publisher))) : null;
    const offers = Array.isArray(d.offers) ? d.offers : [];

    return React.createElement('div', { className: 'fpage' },
      React.createElement('button', { type: 'button', className: 'fpage-back', onClick: () => this.goBack() }, '← Back'),
      React.createElement('div', { className: 'fpage-hero' },
        canPin
          ? React.createElement('button', {
            type: 'button',
            className: 'fpage-pin' + (pinned ? ' on' : ''),
            title: pinned ? 'Unpin from profile' : 'Pin to profile',
            disabled: this.state.pinBusy,
            onClick: () => this.putPin(!pinned)
          }, '📌')
          : null,
        React.createElement('h1', null,
          rec.name || d.title || 'File',
          rec.published
            ? React.createElement('span', { className: 'fpage-tag pub' }, 'published')
            : null,
          pinned
            ? React.createElement('span', { className: 'fpage-tag pin' }, 'on profile')
            : null,
          clusterSync
            ? React.createElement('span', { className: 'fpage-tag sync' },
              rec.clusterPending ? 'sync pending' : 'device sync')
            : null,
          d.local === false
            ? React.createElement('span', { className: 'fpage-tag peer' }, 'peer listing')
            : null
        ),
        React.createElement('div', { className: 'sub' }, id)
      ),
      this.state.error
        ? React.createElement('div', { className: 'fpage-err' }, this.state.error)
        : null,
      this.state.notice
        ? React.createElement('div', { className: 'fpage-ok' }, this.state.notice)
        : null,
      React.createElement('div', { className: 'fpage-row' },
        publisherHref
          ? React.createElement('a', { className: 'fpage-btn', href: publisherHref }, 'Publisher profile')
          : null,
        React.createElement('a', { className: 'fpage-btn', href: '/#files' }, 'Files catalog')
      ),
      React.createElement('div', { className: 'fpage-panel' },
        React.createElement('h2', null, 'Listing'),
        React.createElement('div', { className: 'body' },
          React.createElement('div', { className: 'fpage-hint' },
            canPin
              ? (pinned
                ? 'Pinned — Federation groups you belong to see this listing on your profile (name, size, price — not the bytes).'
                : 'Pin to profile to list this file for group members. A local developer install uses the same pin to share GoonCitizen builds over Fabric.')
              : 'Metadata only on this page. Bytes stay with the offering node until a Fabric inventory transfer.'),
          canCluster
            ? React.createElement('div', { className: 'fpage-toggle' },
              React.createElement('input', {
                type: 'checkbox',
                id: 'fpage-cluster-sync',
                checked: clusterSync,
                disabled: this.state.clusterBusy,
                onChange: () => this.putClusterSync(!clusterSync)
              }),
              React.createElement('label', { htmlFor: 'fpage-cluster-sync' },
                'Sync to my other devices',
                React.createElement('span', { className: 'hint' },
                  'Copies this file to phones and desktops in your identity cluster over Fabric. Not a public listing, and not the same as pinning to your profile.')
              )
            )
            : null,
          React.createElement('div', { className: 'fpage-kv' },
            React.createElement('b', null, 'type '), React.createElement('br'),
            rec.mime || 'application/octet-stream'),
          React.createElement('div', { className: 'fpage-kv' },
            React.createElement('b', null, 'size '), React.createElement('br'),
            formatBytes(rec.size)),
          React.createElement('div', { className: 'fpage-kv' },
            React.createElement('b', null, 'price '), React.createElement('br'),
            rec.purchasePriceSats
              ? (Number(rec.purchasePriceSats).toLocaleString() + ' sats')
              : 'free'),
          rec.merkleRootHex
            ? React.createElement('div', { className: 'fpage-kv' },
              React.createElement('b', null, 'merkle '), React.createElement('br'),
              rec.merkleRootHex)
            : null,
          rec.blobTotal != null
            ? React.createElement('div', { className: 'fpage-kv' },
              React.createElement('b', null, 'blobs '), React.createElement('br'),
              String(rec.blobTotal) + (rec.chunkBytes ? (' × ' + rec.chunkBytes + ' B') : ''))
            : null,
          publisher
            ? React.createElement('div', { className: 'fpage-kv' },
              React.createElement('b', null, 'publisher '), React.createElement('br'),
              shortKey(publisher))
            : null
        )
      ),
      offers.length
        ? React.createElement('div', { className: 'fpage-panel' },
          React.createElement('h2', null, 'Offers'),
          React.createElement('div', { className: 'body' },
            offers.slice(0, 12).map((o, i) => React.createElement('div', {
              key: (o.id || i) + '-o',
              className: 'fpage-kv'
            },
            (o.peerAlias || shortKey(o.peerPubkey) || 'peer'),
            ' · ',
            o.purchasePriceSats != null ? (Number(o.purchasePriceSats).toLocaleString() + ' sats') : '—'
            ))
          ))
        : null
    );
  }
}

FilePage.CSS = CSS;
FilePage.fileHref = fileHref;
FilePage.idFromLocation = function () {
  const m = String((typeof window !== 'undefined' && window.location.pathname) || '')
    .match(/^\/files\/([^/]+)/);
  return (m && decodeURIComponent(m[1])) || null;
};

module.exports = FilePage;
