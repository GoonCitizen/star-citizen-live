'use strict';

/**
 * Advanced-mode group Fabric inspector — wire Messages scoped to a group
 * contract, Statechain journal, Activity Tree, and hex/base64 message codec.
 */

const React = require('react');
const FabricMessages = require('./FabricMessages');

const BASE = '/services/star-citizen';

const CSS = `
  .gfi-wrap{display:grid;gap:14px;margin-top:12px;padding:0 0 8px}
  .gfi-wrap.embedded{margin-top:0;padding:0 0 8px;gap:0}
  .gfi-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .gfi-wrap.embedded .gfi-panel{background:transparent;border:none;border-radius:0}
  .gfi-panel h3{font-size:13px;margin:0;padding:11px 14px;border-bottom:1px solid var(--line);font-weight:600;
    display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .gfi-wrap.embedded .gfi-panel>h3{display:none}
  .gfi-panel h3 .sub{font-weight:500;color:var(--muted);font-size:12px}
  .gfi-panel .body{padding:12px 14px}
  .gfi-wrap.embedded .gfi-panel .body{padding:10px 0 0}
  .gfi-hint{color:var(--muted);font-size:12.5px;line-height:1.55;margin:0 0 10px}
  .gfi-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:8px 11px;font-size:12.5px;margin-bottom:10px}
  .gfi-ok{background:rgba(63,185,80,.12);color:var(--good);border-radius:7px;padding:8px 11px;font-size:12.5px;margin-bottom:10px}
  .gfi-meta{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--muted);margin-bottom:10px}
  .gfi-meta b{color:var(--text);font-weight:600;font-family:'Cascadia Code',Consolas,monospace;font-size:11.5px;word-break:break-all}
  .gfi-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
  .gfi-btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:7px;
    padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer}
  .gfi-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  .gfi-btn:disabled{opacity:.45;cursor:default}
  .gfi-feed{max-height:280px;overflow:auto;border:1px solid var(--line);border-radius:8px;background:var(--bg);
    font-family:'Cascadia Code',Consolas,monospace;font-size:11.5px}
  .gfi-row{padding:7px 10px;border-bottom:1px solid #20262f;cursor:pointer}
  .gfi-row:hover,.gfi-row.open{background:rgba(56,139,253,.06)}
  .gfi-row .top{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
  .gfi-type{font-weight:600;color:var(--text)}
  .gfi-ts{color:var(--muted);margin-left:auto;font-size:11px}
  .gfi-detail{margin-top:6px;padding:8px;background:var(--panel);border:1px solid var(--line);border-radius:6px;
    white-space:pre-wrap;word-break:break-word;max-height:200px;overflow:auto}
  .gfi-leaf{display:grid;grid-template-columns:72px 1fr 90px 1.2fr;gap:8px;padding:6px 10px;
    border-bottom:1px solid #20262f;font-size:11.5px;align-items:baseline}
  .gfi-leaf.head{color:var(--muted);font-weight:600;position:sticky;top:0;background:var(--bg)}
  .gfi-empty{padding:20px;text-align:center;color:var(--muted);font-size:13px}
  .gfi-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
  .gfi-tab{background:var(--panel2);border:1px solid var(--line);color:var(--muted);border-radius:999px;
    padding:4px 12px;font-size:12px;cursor:pointer;font-weight:600}
  .gfi-tab.on{background:rgba(56,139,253,.15);border-color:var(--accent);color:var(--accent)}
  .gfi-codec textarea{width:100%;min-height:96px;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:8px 10px;font-size:11.5px;font-family:'Cascadia Code',Consolas,monospace;
    box-sizing:border-box;resize:vertical}
  .gfi-codec .out{margin-top:10px}
  .gfi-codec pre{margin:0;padding:8px 10px;background:var(--bg);border:1px solid var(--line);border-radius:7px;
    font-size:11.5px;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto}
`;

function short (hex, n = 16) {
  const s = String(hex || '');
  return s.length > n ? s.slice(0, n) + '…' : (s || '—');
}

function shortTime (iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return String(iso).slice(0, 19);
  }
}

class GroupFabricInspector extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      tab: 'messages', // messages | statechain | tree | codec
      chain: null,
      tree: null,
      error: null,
      notice: null,
      loading: false,
      busy: false,
      openJournalId: null,
      showLeaves: false,
      codecInput: '',
      codecEncoding: 'hex',
      codecResult: null,
      codecError: null
    };
  }

  componentDidMount () {
    this.reload();
  }

  componentDidUpdate (prev) {
    if (prev.groupId !== this.props.groupId || prev.contractId !== this.props.contractId) {
      this.reload();
    }
  }

  async reload () {
    const groupId = this.props.groupId;
    if (!groupId) return;
    this.setState({ loading: true, error: null });
    try {
      const headers = this.props.headers || {};
      const [chainRes, treeRes] = await Promise.all([
        fetch(`${BASE}/groups/${encodeURIComponent(groupId)}/statechain?limit=200`, { headers })
          .then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
        fetch(`${BASE}/activity-tree`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      ]);
      if (!chainRes.ok) throw new Error((chainRes.j && chainRes.j.error) || 'statechain unavailable');
      this.setState({
        loading: false,
        chain: chainRes.j.data || null,
        tree: treeRes,
        error: null
      });
    } catch (e) {
      this.setState({ loading: false, error: e.message || String(e) });
    }
  }

  async publishTree () {
    const groupId = this.props.groupId;
    if (!groupId || this.state.busy) return;
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/activity-tree/publish`, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, this.props.headers || {}),
        body: JSON.stringify({ groupId, publish: true })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      this.setState({
        busy: false,
        notice: `Published Activity Tree · root ${short(j.root || (j.tree && j.tree.root), 24)}`
      });
      await this.reload();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async decodeCodec () {
    const raw = String(this.state.codecInput || '').trim();
    if (!raw) {
      this.setState({ codecError: 'Paste a fabric:<hex>, fabric:base64,…, or raw hex/base64 payload.', codecResult: null });
      return;
    }
    this.setState({ busy: true, codecError: null, codecResult: null, notice: null });
    try {
      const res = await fetch(`${BASE}/fabric/messages/decode`, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, this.props.headers || {}),
        body: JSON.stringify({ protocolUrl: raw, message: raw })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j && j.error) || `HTTP ${res.status}`);
      const data = j.data || j;
      this.setState({
        busy: false,
        codecResult: data,
        codecEncoding: data.encoding || 'hex',
        codecError: null
      });
    } catch (e) {
      this.setState({ busy: false, codecError: e.message || String(e) });
    }
  }

  async reencodeCodec (encoding) {
    const result = this.state.codecResult;
    if (!result || (!result.hex && !result.base64 && !result.messageHex && !result.messageBase64)) {
      this.setState({ codecError: 'Decode a message first, then re-encode.' });
      return;
    }
    const hex = result.hex || result.messageHex;
    const b64 = result.base64 || result.messageBase64;
    const enc = encoding === 'base64' ? 'base64' : 'hex';
    const protocolUrl = enc === 'base64'
      ? ('fabric:base64,' + (b64 || ''))
      : ('fabric:' + (hex || ''));
    if ((enc === 'hex' && !hex) || (enc === 'base64' && !b64)) {
      this.setState({ codecError: 'Decoded payload is missing ' + enc + ' bytes.' });
      return;
    }
    const next = Object.assign({}, result, {
      encoding: enc,
      protocolUrl,
      protocolUrlHex: hex ? ('fabric:' + hex) : (result.protocolUrlHex || null),
      protocolUrlBase64: b64 ? ('fabric:base64,' + b64) : (result.protocolUrlBase64 || null)
    });
    this.setState({
      codecEncoding: enc,
      codecResult: next,
      codecInput: protocolUrl,
      notice: `Encoded as ${enc}.`
    });
    try {
      await navigator.clipboard.writeText(protocolUrl);
      this.setState({ notice: `Copied fabric:${enc === 'base64' ? 'base64,…' : '<hex>'} to clipboard.` });
    } catch (_) { /* ignore */ }
  }

  renderMessages () {
    const contractId = this.props.contractId || (this.state.chain && this.state.chain.contractId);
    if (!contractId) {
      return React.createElement('div', { className: 'gfi-empty' },
        'This group has no Fabric contract id yet — create/share the group with an unlocked identity.');
    }
    return React.createElement(FabricMessages, {
      contract: contractId,
      title: 'Group Fabric messages',
      subtitle: 'CONTRACT_MESSAGE / GroupChat / GroupShare scoped to this group’s contract',
      embedded: true,
      hideCaptureControls: true
    });
  }

  renderStatechain () {
    const chain = this.state.chain;
    if (!chain) {
      return React.createElement('div', { className: 'gfi-empty' },
        this.state.loading ? 'Loading statechain…' : 'No statechain loaded.');
    }
    const entries = (chain.journal && chain.journal.entries) || [];
    return React.createElement(React.Fragment, null,
      React.createElement('p', { className: 'gfi-hint' },
        'Accepted Statechain journal for this group’s Federation contract. Folded content includes membership and the latest Activity Tree tip.'),
      React.createElement('div', { className: 'gfi-meta' },
        React.createElement('span', null, 'clock ', React.createElement('b', null, String(chain.clock))),
        React.createElement('span', null, 'digest ', React.createElement('b', null, short(chain.stateDigest, 20))),
        React.createElement('span', null, 'contract ', React.createElement('b', null, short(chain.contractId, 20))),
        chain.activityTree && chain.activityTree.root
          ? React.createElement('span', null, 'tree tip ', React.createElement('b', null, short(chain.activityTree.root, 16)))
          : null
      ),
      React.createElement('div', { className: 'gfi-feed' },
        !entries.length
          ? React.createElement('div', { className: 'gfi-empty' }, 'Journal empty — applications, decisions, and published trees appear here.')
          : entries.map((e, i) => {
            const key = e.id || String(i);
            const open = this.state.openJournalId === key;
            return React.createElement('div', {
              key,
              className: 'gfi-row' + (open ? ' open' : ''),
              onClick: () => this.setState({ openJournalId: open ? null : key })
            },
            React.createElement('div', { className: 'top' },
              React.createElement('span', { className: 'gfi-type' }, e.type || 'Entry'),
              e.clock != null ? React.createElement('span', { style: { color: 'var(--muted)' } }, `c${e.clock}`) : null,
              React.createElement('span', { className: 'gfi-ts' }, shortTime(e.acceptedAt))
            ),
            open
              ? React.createElement('pre', { className: 'gfi-detail' },
                JSON.stringify(e, null, 2))
              : null
            );
          })
      )
    );
  }

  renderTree () {
    const local = this.state.tree;
    const sealed = this.state.chain && this.state.chain.activityTree;
    const leaves = (local && Array.isArray(local.leaves)) ? local.leaves : [];
    const digests = (local && Array.isArray(local.digests)) ? local.digests : [];
    return React.createElement(React.Fragment, null,
      React.createElement('p', { className: 'gfi-hint' },
        'Composed Activity Tree over cumulative local history (Merkle root). Publish seals it into this group’s Statechain and optionally gossips GroupActivityTree on the contract. Provenance: leaves are content-addressed local records; the sealed tip carries ownerPubkey + journal acceptance.'),
      React.createElement('div', { className: 'gfi-meta' },
        React.createElement('span', null, 'local leaves ', React.createElement('b', null, String((local && local.leafCount) || 0))),
        React.createElement('span', null, 'local root ', React.createElement('b', null, short(local && local.root, 24))),
        sealed && sealed.root
          ? React.createElement('span', null, 'sealed tip ', React.createElement('b', null, short(sealed.root, 24)))
          : React.createElement('span', null, 'sealed tip ', React.createElement('b', null, '—')),
        sealed && sealed.ownerPubkey
          ? React.createElement('span', null, 'publisher ', React.createElement('b', null, short(sealed.ownerPubkey, 14)))
          : null,
        sealed && sealed.generatedAt
          ? React.createElement('span', null, 'sealed at ', React.createElement('b', null, shortTime(sealed.generatedAt)))
          : null
      ),
      React.createElement('div', { className: 'gfi-bar' },
        React.createElement('button', {
          type: 'button', className: 'gfi-btn',
          disabled: this.state.busy,
          onClick: () => this.reload()
        }, 'Refresh'),
        React.createElement('button', {
          type: 'button', className: 'gfi-btn primary',
          disabled: this.state.busy || !this.props.groupId,
          onClick: () => this.publishTree()
        }, this.state.busy ? 'Publishing…' : 'Publish tree to group'),
        React.createElement('button', {
          type: 'button', className: 'gfi-btn',
          onClick: () => this.setState({ showLeaves: !this.state.showLeaves })
        }, this.state.showLeaves ? 'Hide leaves' : 'Inspect leaves')
      ),
      this.state.showLeaves
        ? React.createElement('div', { className: 'gfi-feed' },
          React.createElement('div', { className: 'gfi-leaf head' },
            React.createElement('span', null, 'kind'),
            React.createElement('span', null, 'id / player'),
            React.createElement('span', null, 'when'),
            React.createElement('span', null, 'digest · provenance')
          ),
          !leaves.length
            ? React.createElement('div', { className: 'gfi-empty' }, 'No history leaves yet — play or import Game.logs.')
            : leaves.slice(0, 200).map((leaf, i) => React.createElement('div', {
              key: leaf.id || i,
              className: 'gfi-leaf',
              title: digests[i] || ''
            },
            React.createElement('span', null, leaf.kind || '—'),
            React.createElement('span', null,
              short(leaf.id, 18),
              leaf.player ? ` · ${leaf.player}` : ''),
            React.createElement('span', null, shortTime(leaf.ts)),
            React.createElement('span', { style: { color: 'var(--muted)' } },
              short(digests[i], 12),
              ' · local cumulative history')
            ))
        )
        : null,
      sealed && Array.isArray(sealed.digests) && sealed.digests.length
        ? React.createElement('div', { className: 'gfi-hint', style: { marginTop: 10, marginBottom: 0 } },
          `Sealed tip stores ${sealed.digests.length} digests` +
          (sealed.leafCount != null ? ` (leafCount ${sealed.leafCount})` : '') +
          ' — journal entry type GroupActivityTree.')
        : null
    );
  }

  renderCodec () {
    const result = this.state.codecResult;
    return React.createElement('div', { className: 'gfi-codec' },
      React.createElement('p', { className: 'gfi-hint' },
        'Decode opaque Fabric Messages from ',
        React.createElement('code', null, 'fabric:<hex>'),
        ' or ',
        React.createElement('code', null, 'fabric:base64,…'),
        ' (raw hex/base64 also works). Re-encode and copy either form.'),
      React.createElement('textarea', {
        value: this.state.codecInput,
        placeholder: 'fabric:<hex> or fabric:base64,…',
        spellCheck: false,
        onChange: (e) => this.setState({ codecInput: e.target.value, codecError: null })
      }),
      React.createElement('div', { className: 'gfi-bar', style: { marginTop: 10 } },
        React.createElement('button', {
          type: 'button',
          className: 'gfi-btn primary',
          disabled: this.state.busy || !String(this.state.codecInput || '').trim(),
          onClick: () => this.decodeCodec()
        }, this.state.busy ? 'Decoding…' : 'Decode'),
        React.createElement('button', {
          type: 'button',
          className: 'gfi-btn' + (this.state.codecEncoding === 'hex' ? ' primary' : ''),
          disabled: !result,
          onClick: () => this.reencodeCodec('hex')
        }, 'Encode hex'),
        React.createElement('button', {
          type: 'button',
          className: 'gfi-btn' + (this.state.codecEncoding === 'base64' ? ' primary' : ''),
          disabled: !result,
          onClick: () => this.reencodeCodec('base64')
        }, 'Encode base64')
      ),
      this.state.codecError
        ? React.createElement('div', { className: 'gfi-err' }, this.state.codecError)
        : null,
      result
        ? React.createElement('div', { className: 'out' },
          React.createElement('div', { className: 'gfi-meta' },
            React.createElement('span', null, 'type ', React.createElement('b', null, result.type || result.wireType || '—')),
            result.kind
              ? React.createElement('span', null, 'kind ', React.createElement('b', null, result.kind))
              : null,
            React.createElement('span', null, 'encoding ', React.createElement('b', null, result.encoding || this.state.codecEncoding)),
            (result.hex || result.messageHex)
              ? React.createElement('span', null, 'bytes ', React.createElement('b', null,
                String(Math.floor(String(result.hex || result.messageHex).length / 2))))
              : null
          ),
          React.createElement('pre', null, JSON.stringify({
            protocolUrl: result.protocolUrl || null,
            protocolUrlHex: result.protocolUrlHex || (result.hex || result.messageHex ? ('fabric:' + (result.hex || result.messageHex)) : null),
            protocolUrlBase64: result.protocolUrlBase64 || (result.base64 || result.messageBase64 ? ('fabric:base64,' + (result.base64 || result.messageBase64)) : null),
            kind: result.kind || null,
            type: result.type || result.wireType || null,
            contractId: result.contractId || null,
            groupId: result.groupId || null,
            hash: result.hash || null
          }, null, 2))
        )
        : null
    );
  }

  render () {
    if (!this.props.groupId) return null;
    const tab = this.state.tab;
    const embedded = !!this.props.embedded;
    return React.createElement('div', { className: 'gfi-wrap' + (embedded ? ' embedded' : '') },
      React.createElement('section', { className: 'gfi-panel' },
        React.createElement('h3', null, 'Advanced · Fabric history ',
          React.createElement('span', { className: 'sub' },
            '— messages, Statechain journal, Activity Tree, codec')),
        React.createElement('div', { className: 'body' },
          this.state.error ? React.createElement('div', { className: 'gfi-err' }, this.state.error) : null,
          this.state.notice ? React.createElement('div', { className: 'gfi-ok' }, this.state.notice) : null,
          React.createElement('div', { className: 'gfi-tabs' },
            [
              ['messages', 'Messages'],
              ['statechain', 'Statechain'],
              ['tree', 'Activity Tree'],
              ['codec', 'Codec']
            ].map(([id, label]) =>
              React.createElement('button', {
                key: id,
                type: 'button',
                className: 'gfi-tab' + (tab === id ? ' on' : ''),
                onClick: () => this.setState({ tab: id })
              }, label)
            )
          ),
          tab === 'messages' ? this.renderMessages() : null,
          tab === 'statechain' ? this.renderStatechain() : null,
          tab === 'tree' ? this.renderTree() : null,
          tab === 'codec' ? this.renderCodec() : null
        )
      )
    );
  }
}

GroupFabricInspector.CSS = CSS;

module.exports = GroupFabricInspector;
