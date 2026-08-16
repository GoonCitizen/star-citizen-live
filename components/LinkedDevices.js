'use strict';

/**
 * Dedicated identity-cluster / linked-devices manager.
 *
 * Pairing stays fabric://link (QR). After that: IdentityCrossSign Fabric
 * Messages, Hub WebRTC coordinator for LAN discovery, Fabric TCP mesh,
 * DeviceDataShare as the account-sync payload.
 */

const React = require('react');
const DataSyncStatus = require('./DataSyncStatus');
const { mergeDeviceRows, stageLabel } = require('../functions/clusterDevices');
const { chipsFor, relativeTime } = require('../functions/clusterInventory');
const { fetchClusterSync, publishClusterSync, meshClusterSync, nudgeCrossSign } = require('../functions/clusterSyncClient');

const CSS = `
  .ld-wrap{display:grid;gap:12px}
  .ld-hero{display:grid;gap:6px}
  .ld-hero h3{margin:0;font-size:15px}
  .ld-hero .d{margin:0;color:var(--muted);font-size:12.5px;line-height:1.5}
  .ld-steps{display:flex;flex-wrap:wrap;gap:6px}
  .ld-step{font-size:11px;font-weight:650;padding:3px 8px;border-radius:999px;
    border:1px solid var(--line);color:var(--muted)}
  .ld-step.on{border-color:var(--accent);color:var(--text);background:rgba(59,130,246,.12)}
  .ld-step.good{border-color:var(--good);color:var(--good)}
  .ld-card{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px 14px;display:grid;gap:8px}
  .ld-card.this{border-color:var(--accent)}
  .ld-row{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap}
  .ld-name{font-size:13.5px;font-weight:650}
  .ld-tag{font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:5px;margin-left:8px;vertical-align:middle}
  .ld-tag.good{background:rgba(63,185,80,.15);color:var(--good)}
  .ld-tag.warn{background:rgba(210,153,34,.15);color:var(--warn)}
  .ld-tag.muted{background:rgba(110,118,129,.18);color:var(--muted)}
  .ld-kv{font-family:'Cascadia Code',Consolas,monospace;font-size:11px;word-break:break-all;color:var(--muted)}
  .ld-meta{font-size:12px;color:var(--muted);line-height:1.45}
  .ld-stats-cap{font-size:11px;color:var(--muted);margin:2px 0 0}
  .ld-stats{display:flex;flex-wrap:wrap;gap:6px}
  .ld-chip{font-size:11px;font-weight:650;padding:3px 7px;border-radius:6px;
    border:1px solid var(--line);background:var(--panel);color:var(--text);
    font-variant-numeric:tabular-nums}
  .ld-chip.zero{color:var(--muted);font-weight:550}
  .ld-chip b{font-weight:700;margin-left:4px}
  .ld-actions{display:flex;flex-wrap:wrap;gap:8px}
  .ld-empty{color:var(--muted);font-size:13px;line-height:1.5;padding:8px 0}
`;

function originOf () {
  try {
    return (typeof window !== 'undefined' && window.location && window.location.origin) || '';
  } catch (_) {
    return '';
  }
}

function shortPk (pk) {
  const s = String(pk || '');
  if (s.length <= 16) return s;
  return s.slice(0, 8) + '…' + s.slice(-6);
}

const STEPS = [
  ['pairing', '1 Pair'],
  ['waiting-cross-sign', '2 Fabric sign'],
  ['lan', '3 LAN / Hub'],
  ['synced', '4 Sync']
];

function stepOn (stage, key) {
  const order = ['unpaired', 'waiting-cross-sign', 'waiting-sync', 'lan', 'webrtc', 'synced'];
  const i = order.indexOf(stage);
  if (key === 'pairing') return i >= 0 && stage !== 'unpaired';
  if (key === 'waiting-cross-sign') return i >= order.indexOf('waiting-cross-sign');
  if (key === 'lan') return i >= order.indexOf('lan');
  if (key === 'synced') return stage === 'synced';
  return false;
}

class LinkedDevices extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      snapshot: null,
      error: null,
      busy: false
    };
  }

  componentDidMount () {
    this.refresh();
    const ms = Number(this.props.pollMs);
    this._timer = setInterval(() => this.refresh(), Number.isFinite(ms) && ms > 0 ? ms : 8000);
  }

  componentWillUnmount () {
    if (this._timer) clearInterval(this._timer);
  }

  origin () {
    return this.props.origin || originOf();
  }

  async refresh () {
    const out = await fetchClusterSync(this.origin(), { authToken: this.props.authToken });
    if (out && out.ok) {
      this.setState({ snapshot: out.data, error: null });
      return;
    }
    this.setState({ error: (out && out.error) || 'sync unavailable' });
  }

  model () {
    const snap = this.state.snapshot || {};
    return mergeDeviceRows({
      localPubkey: this.props.localPubkey || (snap.local && snap.local.pubkey) || '',
      linkedDevices: this.props.linkedDevices || snap.linkedDevices || [],
      cluster: {
        members: snap.members || [],
        edges: snap.edges || [],
        pending: snap.pending || []
      },
      sync: snap,
      mesh: snap.mesh || {}
    });
  }

  async retryCrossSign () {
    this.setState({ busy: true, error: null });
    const origin = this.origin();
    const out = await nudgeCrossSign(origin, { authToken: this.props.authToken });
    this.setState({
      busy: false,
      snapshot: (out && out.ok && out.data) || this.state.snapshot,
      error: (out && out.ok) ? null : ((out && out.error) || 'could not publish IdentityCrossSign')
    });
  }

  async syncNow () {
    this.setState({ busy: true, error: null });
    const origin = this.origin();
    await meshClusterSync(origin, { authToken: this.props.authToken });
    const out = await publishClusterSync(origin, { authToken: this.props.authToken });
    this.setState({
      busy: false,
      snapshot: (out && out.ok && out.data) || this.state.snapshot,
      error: (out && out.ok) ? null : ((out && out.error) || 'could not publish')
    });
  }

  renderDevice (row) {
    const tag = row.stage === 'synced' || row.kind === 'this'
      ? 'good'
      : (row.stage === 'waiting-cross-sign' || row.stage === 'waiting-sync' ? 'warn' : 'muted');
    return React.createElement('div', {
      className: 'ld-card' + (row.kind === 'this' ? ' this' : ''),
      key: row.xonly || row.pubkey
    },
    React.createElement('div', { className: 'ld-row' },
      React.createElement('div', null,
        React.createElement('span', { className: 'ld-name' }, row.label),
        React.createElement('span', { className: 'ld-tag ' + tag }, stageLabel(row.stage))
      ),
      row.kind !== 'this' && typeof this.props.onRevoke === 'function'
        ? React.createElement('button', {
          type: 'button',
          className: 'id-btn ghost',
          disabled: this.props.busy,
          onClick: () => this.props.onRevoke(row)
        }, row.nonce ? 'Revoke' : 'Remove')
        : null
    ),
    React.createElement('div', { className: 'ld-kv' }, shortPk(row.pubkey)),
    React.createElement('div', { className: 'ld-meta' },
      row.kind === 'this'
        ? (
          (row.fabricReady ? 'Fabric peer up' : 'Fabric peer idle') +
          (row.fabricConnected ? (' · ' + row.fabricConnected + ' TCP peer' + (row.fabricConnected === 1 ? '' : 's')) : '') +
          (row.webrtc ? ' · Hub coordinator registered' : ' · Hub coordinator pending')
        )
        : (
          (row.pairing ? 'Paired' : 'Not paired') +
          (row.cluster ? ' · cluster member' : ' · waiting for the other device to Fabric-sign') +
          (row.webrtc ? ' · seen on Hub WebRTC' : '') +
          (row.candidates.length ? (' · LAN ' + row.candidates.slice(0, 2).join(', ')) : '')
        )
    ),
    this.renderInventory(row)
    );
  }

  renderInventory (row) {
    const stats = row.inventory;
    const chips = chipsFor(stats, { includeZero: true });
    const when = stats && stats.generatedAt ? relativeTime(stats.generatedAt) : null;
    const published = row.published && row.published.generatedAt
      ? relativeTime(row.published.generatedAt)
      : null;
    const caption = row.kind === 'this'
      ? ('On this device' + (published ? ' · last published ' + published : ''))
      : (stats
        ? ('Last share from them' + (when ? ' · ' + when : ''))
        : 'No DeviceDataShare counts yet');
    const applied = stats && Array.isArray(stats.applied) && stats.applied.length
      ? ('Applied ' + stats.applied.join(', '))
      : null;
    const pending = stats && Number(stats.filesPending) > 0
      ? (stats.filesPending + ' file' + (stats.filesPending === 1 ? '' : 's') + ' waiting on bytes')
      : null;
    return React.createElement('div', { className: 'ld-inv' },
      React.createElement('div', { className: 'ld-stats-cap' }, caption),
      React.createElement('div', { className: 'ld-stats', 'aria-label': 'Device inventory' },
        chips.map((chip) => React.createElement('span', {
          key: chip.key,
          className: 'ld-chip' + (chip.count ? '' : ' zero')
        }, chip.label,
        React.createElement('b', null, chip.count == null ? '—' : String(chip.count)))
        )
      ),
      applied || pending
        ? React.createElement('div', { className: 'ld-stats-cap' },
          [applied, pending].filter(Boolean).join(' · '))
        : null
    );
  }

  render () {
    const model = this.model();
    const stage = model.stage;
    const page = this.props.variant !== 'embed';
    return React.createElement('div', { className: 'ld-wrap' },
      page
        ? React.createElement('div', { className: 'ld-hero' },
          React.createElement('h3', null, 'Your devices'),
          React.createElement('p', { className: 'd' },
            'Each app keeps its own seed. Scan fabric://link (phone camera or the header QR). After both approve, this desktop must countersign the hub session — that continues in the background even if you leave this page. Matching IdentityCrossSign on both devices joins the cluster, then chat replays as DeviceDataShare over Fabric (LAN first, Hub WebRTC coordinator if NAT is in the way).')
        )
        : React.createElement('p', { className: 'd' },
          'Revoke publishes IdentityCrossSignRevoke as a Fabric Message. Pairing is local; the mesh proof is the cross-sign.'),
      page
        ? React.createElement('div', { className: 'ld-steps', 'aria-label': 'Device link stages' },
          STEPS.map(([key, label]) => React.createElement('span', {
            key,
            className: 'ld-step' + (stepOn(stage, key) ? (key === 'synced' && stage === 'synced' ? ' good' : ' on') : '')
          }, label))
        )
        : null,
      this.props.addDevice || null,
      (model.devices || []).length
        ? model.devices.map((row) => this.renderDevice(row))
        : React.createElement('div', { className: 'ld-empty' },
          'No linked devices yet. Add a device above, or approve a fabric://link from Passport or another node.'),
      React.createElement('div', { className: 'ld-actions' },
        React.createElement('button', {
          type: 'button',
          className: 'id-btn',
          disabled: this.state.busy,
          onClick: () => this.syncNow()
        }, this.state.busy ? 'Syncing…' : 'Sync account now'),
        stage === 'waiting-cross-sign'
          ? React.createElement('button', {
            type: 'button',
            className: 'id-btn ghost',
            disabled: this.state.busy,
            onClick: () => this.retryCrossSign()
          }, 'Retry Fabric sign')
          : null,
        typeof this.props.onAddDevice === 'function'
          ? React.createElement('button', {
            type: 'button',
            className: 'id-btn ghost',
            onClick: () => this.props.onAddDevice()
          }, 'Add a device')
          : null
      ),
      this.state.error
        ? React.createElement('div', { className: 'id-err' }, this.state.error)
        : null,
      page ? React.createElement(DataSyncStatus, { variant: 'panel', origin: this.origin() }) : null
    );
  }
}

LinkedDevices.CSS = CSS;

module.exports = LinkedDevices;
