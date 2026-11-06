'use strict';

/**
 * Linked signers: the apps and wallets this player has linked
 * (`@fabric/core` docs/DELEGATION.md).
 *
 * Each app keeps its own key. Pairing goes through a Hub: one side shows an
 * invitation, the other takes it, and both confirm the same six-digit code
 * before either grants anything. Grants are signed Fabric Messages; an
 * `identity` grant both ways makes the two keys one player, and account data
 * then replays as DeviceDataShare over Fabric.
 */

const React = require('react');
const DataSyncStatus = require('./DataSyncStatus');
const { mergeDeviceRows, stageLabel } = require('../functions/clusterDevices');
const { chipsFor, relativeTime } = require('../functions/clusterInventory');
const { fetchClusterSync, publishClusterSync, meshClusterSync } = require('../functions/clusterSyncClient');
const client = require('../functions/delegationClient');
const { protocolQrDataUrl } = require('../functions/protocolQr');

const SCOPES = [
  ['identity', 'Act as this player', 'Share your account data both ways and treat the two keys as one player.'],
  ['passport', 'Sign in to websites', 'Answer Passport sign-ins for you; each one still asks here first.'],
  ['message', 'Ask you to sign messages', 'Send signing requests that show up in your notifications.']
];

const SCOPE_LABEL = Object.fromEntries(SCOPES.map(([id, label]) => [id, label]));

const CSS = `
  .ls-wrap{display:grid;gap:12px}
  .ls-hero{display:grid;gap:6px}
  .ls-hero h3{margin:0;font-size:15px}
  .ls-hero .d,.ls-d{margin:0;color:var(--muted);font-size:12.5px;line-height:1.5}
  .ls-card{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px 14px;display:grid;gap:8px}
  .ls-card.this{border-color:var(--accent)}
  .ls-card h4{margin:0;font-size:13.5px}
  .ls-row{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap}
  .ls-name{font-size:13.5px;font-weight:650}
  .ls-tag{font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:5px;margin-left:8px;vertical-align:middle}
  .ls-tag.good{background:rgba(63,185,80,.15);color:var(--good)}
  .ls-tag.warn{background:rgba(210,153,34,.15);color:var(--warn)}
  .ls-tag.muted{background:rgba(110,118,129,.18);color:var(--muted)}
  .ls-kv{font-family:'Cascadia Code',Consolas,monospace;font-size:11px;word-break:break-all;color:var(--muted)}
  .ls-meta{font-size:12px;color:var(--muted);line-height:1.45}
  .ls-code{font-family:'Cascadia Code',Consolas,monospace;font-size:28px;font-weight:700;letter-spacing:.18em}
  .ls-qr{width:196px;height:196px;border-radius:8px;background:#fff}
  .ls-grants{display:grid;gap:4px}
  .ls-grant{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px}
  .ls-grant.revoked{color:var(--muted);text-decoration:line-through}
  .ls-scopes{display:grid;gap:6px}
  .ls-scope{display:flex;gap:8px;align-items:flex-start;font-size:12.5px}
  .ls-scope small{display:block;color:var(--muted)}
  .ls-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .ls-input{flex:1;min-width:220px;background:var(--panel);border:1px solid var(--line);border-radius:6px;color:var(--text);padding:6px 8px;font-size:12px}
  .ls-stats-cap{font-size:11px;color:var(--muted);margin:2px 0 0}
  .ls-stats{display:flex;flex-wrap:wrap;gap:6px}
  .ls-chip{font-size:11px;font-weight:650;padding:3px 7px;border-radius:6px;
    border:1px solid var(--line);background:var(--panel);color:var(--text);
    font-variant-numeric:tabular-nums}
  .ls-chip.zero{color:var(--muted);font-weight:550}
  .ls-chip b{font-weight:700;margin-left:4px}
  .ls-empty{color:var(--muted);font-size:13px;line-height:1.5;padding:8px 0}
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

function hostOf (origin) {
  try { return new URL(origin).host; } catch (_) { return String(origin || ''); }
}

class LinkedSigners extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      view: null,
      sync: null,
      error: null,
      busy: false,
      hub: '',
      invitationInput: '',
      scopes: ['identity'],
      qr: null,
      qrFor: null
    };
  }

  componentDidMount () {
    this.refresh();
    const ms = Number(this.props.pollMs);
    this._timer = setInterval(() => this.refresh(), Number.isFinite(ms) && ms > 0 ? ms : 4000);
    if (this.props.invitation) this.takeInvitation(this.props.invitation);
  }

  componentDidUpdate (prevProps) {
    if (this.props.invitation && this.props.invitation !== prevProps.invitation) this.takeInvitation(this.props.invitation);
  }

  componentWillUnmount () {
    if (this._timer) clearInterval(this._timer);
  }

  origin () {
    return this.props.origin || originOf();
  }

  opts () {
    return { authToken: this.props.authToken };
  }

  takeInvitation (invitation) {
    const value = String(invitation || '').trim();
    if (value) this.setState({ invitationInput: value });
  }

  async refresh () {
    const [view, sync] = await Promise.all([
      client.fetchLinkedSigners(this.origin(), this.opts()),
      fetchClusterSync(this.origin(), this.opts())
    ]);
    const next = { sync: sync && sync.ok ? sync.data : this.state.sync };
    if (view && view.ok) {
      next.view = view.data;
      next.error = null;
      if (!this.state.hub && view.data.mailboxes && view.data.mailboxes.length) next.hub = view.data.mailboxes[0];
    } else {
      next.view = null;
      next.error = (view && view.error) || 'linked signers unavailable';
    }
    this.setState(next);
    const invitation = next.view && next.view.pairing && next.view.pairing.invitation;
    if (invitation && invitation !== this.state.qrFor) {
      this.setState({ qrFor: invitation, qr: null });
      protocolQrDataUrl(invitation).then((qr) => {
        if (this.state.qrFor === invitation) this.setState({ qr });
      });
    }
  }

  async act (fn, okState = {}) {
    this.setState({ busy: true, error: null });
    const out = await fn();
    this.setState(Object.assign({ busy: false }, out && out.ok ? okState : { error: (out && out.error) || 'that did not work' }));
    await this.refresh();
    return out;
  }

  invite () {
    return this.act(() => client.inviteSigner(this.origin(), this.state.hub, this.opts()));
  }

  accept () {
    return this.act(() => client.acceptInvitation(this.origin(), this.state.invitationInput, this.opts()), { invitationInput: '' });
  }

  confirm () {
    return this.act(() => client.confirmPairing(this.origin(), this.state.scopes, this.opts()));
  }

  cancel () {
    return this.act(() => client.cancelPairing(this.origin(), this.opts()));
  }

  revoke (hash) {
    return this.act(() => client.revokeGrant(this.origin(), hash, this.opts()));
  }

  unlink (pubkey) {
    return this.act(() => client.unlinkSigner(this.origin(), pubkey, this.opts()));
  }

  answer (hash, action) {
    return this.act(() => client.answerRequest(this.origin(), hash, action, this.opts()));
  }

  async syncNow () {
    this.setState({ busy: true, error: null });
    await meshClusterSync(this.origin(), this.opts());
    const out = await publishClusterSync(this.origin(), this.opts());
    this.setState({
      busy: false,
      sync: (out && out.ok && out.data) || this.state.sync,
      error: (out && out.ok) ? null : ((out && out.error) || 'could not publish')
    });
  }

  toggleScope (id) {
    const set = new Set(this.state.scopes);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.setState({ scopes: SCOPES.map(([s]) => s).filter((s) => set.has(s)) });
  }

  button (label, onClick, opts = {}) {
    return React.createElement('button', {
      type: 'button',
      className: 'id-btn' + (opts.ghost ? ' ghost' : ''),
      disabled: this.state.busy || opts.disabled,
      onClick
    }, label);
  }

  renderPairing (pairing) {
    const e = React.createElement;
    if (pairing.status === 'waiting' && pairing.mode !== 'invitation') {
      return e('div', { className: 'ls-card' },
        e('h4', null, 'Waiting for the other side'),
        e('p', { className: 'ls-d' },
          'Open Add a signer on the other app (Passport, another GoonCitizen, or Hub) and scan or paste this invitation. It goes through ' + hostOf(pairing.rendezvous) + '.'),
        this.state.qr && this.state.qrFor === pairing.invitation
          ? e('img', { className: 'ls-qr', src: this.state.qr, alt: 'Invitation QR code' })
          : null,
        e('div', { className: 'ls-kv' }, pairing.invitation),
        e('div', { className: 'ls-actions' },
          this.button('Copy invitation', () => {
            try { navigator.clipboard.writeText(pairing.invitation); } catch (_) {}
          }, { ghost: true }),
          this.button('Cancel', () => this.cancel(), { ghost: true }))
      );
    }
    if (pairing.status === 'waiting') {
      return e('div', { className: 'ls-card' },
        e('h4', null, 'Connecting…'),
        e('p', { className: 'ls-d' }, 'Waiting for the app that showed the invitation to answer through ' + hostOf(pairing.rendezvous) + '.'),
        e('div', { className: 'ls-actions' }, this.button('Cancel', () => this.cancel(), { ghost: true })));
    }
    if (pairing.status === 'confirm') {
      return e('div', { className: 'ls-card' },
        e('h4', null, 'Do both screens show this code?'),
        e('div', { className: 'ls-code', 'aria-label': 'Pairing code' }, pairing.sas),
        e('p', { className: 'ls-d' },
          'Only continue if ' + (pairing.peerLabel || 'the other app') + ' shows the same six digits. A different code means someone else is in the middle: cancel.'),
        e('div', { className: 'ls-scopes' },
          e('div', { className: 'ls-d' }, 'What may ' + (pairing.peerLabel || 'it') + ' do for you?'),
          SCOPES.map(([id, label, hint]) => e('label', { key: id, className: 'ls-scope' },
            e('input', {
              type: 'checkbox',
              checked: this.state.scopes.includes(id),
              onChange: () => this.toggleScope(id)
            }),
            e('span', null, label, e('small', null, hint))))
        ),
        e('div', { className: 'ls-actions' },
          this.button('The codes match', () => this.confirm(), { disabled: !this.state.scopes.length }),
          this.button('Cancel', () => this.cancel(), { ghost: true }))
      );
    }
    if (pairing.status === 'granting') {
      return e('div', { className: 'ls-card' },
        e('h4', null, 'Linking…'),
        e('div', { className: 'ls-code' }, pairing.sas),
        e('p', { className: 'ls-d' }, 'Waiting for ' + (pairing.peerLabel || 'the other app') + ' to confirm the code too.'),
        e('div', { className: 'ls-actions' }, this.button('Cancel', () => this.cancel(), { ghost: true })));
    }
    if (pairing.status === 'done' || pairing.status === 'failed' || pairing.status === 'cancelled') {
      const text = pairing.status === 'done'
        ? (pairing.error ? 'Linked. ' + pairing.error + '.' : 'Linked.')
        : (pairing.status === 'cancelled' ? 'Cancelled.' : 'Linking failed: ' + (pairing.error || 'unknown error') + '.');
      return e('div', { className: 'ls-card' }, e('p', { className: 'ls-d' }, text));
    }
    return null;
  }

  renderAdd () {
    const e = React.createElement;
    const view = this.state.view || {};
    const hubs = view.mailboxes || [];
    return e('div', { className: 'ls-card' },
      e('h4', null, 'Add a signer'),
      e('p', { className: 'ls-d' },
        'Show an invitation here and take it on the other app, or paste an invitation the other app shows.'),
      e('div', { className: 'ls-actions' },
        hubs.length > 1
          ? e('select', {
            className: 'ls-input',
            value: this.state.hub,
            onChange: (ev) => this.setState({ hub: ev.target.value }),
            'aria-label': 'Hub'
          }, hubs.map((h) => e('option', { key: h, value: h }, hostOf(h))))
          : null,
        this.button('Show an invitation', () => this.invite(), { disabled: !this.state.hub })),
      e('div', { className: 'ls-actions' },
        e('input', {
          className: 'ls-input',
          placeholder: 'fabric:… invitation',
          value: this.state.invitationInput,
          onChange: (ev) => this.setState({ invitationInput: ev.target.value }),
          'aria-label': 'Invitation'
        }),
        this.button('Use invitation', () => this.accept(), { disabled: !this.state.invitationInput.trim(), ghost: true }))
    );
  }

  renderRequests (pending) {
    const e = React.createElement;
    if (!pending.length) return null;
    return e('div', { className: 'ls-card' },
      e('h4', null, 'Waiting for you'),
      pending.map((r) => e('div', { key: r.hash, className: 'ls-row' },
        e('div', null,
          e('div', { className: 'ls-name' }, r.title),
          e('div', { className: 'ls-meta' }, (r.from && r.from.label ? r.from.label + ' · ' : '') + (r.summary || ''))),
        e('div', { className: 'ls-actions' },
          this.button('Sign', () => this.answer(r.hash, 'sign')),
          this.button('Decline', () => this.answer(r.hash, 'decline'), { ghost: true }))
      ))
    );
  }

  renderGrant (g) {
    const e = React.createElement;
    const what = (g.scopes || []).map((s) => SCOPE_LABEL[s] || s).join(', ') || 'nothing';
    return e('div', { key: g.hash, className: 'ls-grant' + (g.revoked ? ' revoked' : '') },
      e('span', null, (g.direction === 'given' ? 'You allow: ' : 'It allows you: ') + what),
      g.direction === 'given' && !g.revoked
        ? this.button('Revoke', () => this.revoke(g.hash), { ghost: true })
        : null);
  }

  renderSigner (s) {
    const e = React.createElement;
    const live = s.given.some((g) => !g.revoked);
    return e('div', { key: s.pubkey, className: 'ls-card' },
      e('div', { className: 'ls-row' },
        e('div', null,
          e('span', { className: 'ls-name' }, s.label || 'Linked signer'),
          s.sameIdentity ? e('span', { className: 'ls-tag good' }, 'Same player') : null),
        live ? this.button('Unlink', () => this.unlink(s.pubkey), { ghost: true }) : null),
      e('div', { className: 'ls-kv' }, shortPk(s.pubkey)),
      s.linkedAt ? e('div', { className: 'ls-meta' }, 'Linked ' + relativeTime(s.linkedAt)) : null,
      e('div', { className: 'ls-grants' }, s.given.concat(s.received).map((g) => this.renderGrant(g)))
    );
  }

  renderSyncRow (row) {
    const e = React.createElement;
    const tag = row.stage === 'synced' || row.kind === 'this'
      ? 'good'
      : (row.stage === 'waiting-grant' || row.stage === 'waiting-sync' ? 'warn' : 'muted');
    const stats = row.inventory;
    const chips = chipsFor(stats, { includeZero: true });
    const when = stats && stats.generatedAt ? relativeTime(stats.generatedAt) : null;
    const published = row.published && row.published.generatedAt ? relativeTime(row.published.generatedAt) : null;
    return e('div', { className: 'ls-card' + (row.kind === 'this' ? ' this' : ''), key: row.xonly || row.pubkey },
      e('div', null,
        e('span', { className: 'ls-name' }, row.label),
        e('span', { className: 'ls-tag ' + tag }, stageLabel(row.stage))),
      e('div', { className: 'ls-meta' },
        row.kind === 'this'
          ? ((row.fabricReady ? 'Fabric peer up' : 'Fabric peer idle') +
            (row.fabricConnected ? (' · ' + row.fabricConnected + ' TCP peer' + (row.fabricConnected === 1 ? '' : 's')) : '') +
            (published ? ' · last published ' + published : ''))
          : ((row.cluster ? 'Same player' : 'Waiting for it to grant identity') +
            (row.webrtc ? ' · seen on Hub WebRTC' : '') +
            (row.candidates.length ? (' · LAN ' + row.candidates.slice(0, 2).join(', ')) : '') +
            (when ? ' · last share ' + when : ''))),
      e('div', { className: 'ls-stats', 'aria-label': 'Account data' },
        chips.map((chip) => e('span', { key: chip.key, className: 'ls-chip' + (chip.count ? '' : ' zero') },
          chip.label, e('b', null, chip.count == null ? '—' : String(chip.count)))))
    );
  }

  syncModel () {
    const snap = this.state.sync || {};
    return mergeDeviceRows({
      localPubkey: this.props.localPubkey || (snap.local && snap.local.pubkey) || '',
      linkedDevices: snap.linkedDevices || [],
      cluster: { members: snap.members || [], edges: snap.edges || [], pending: snap.pending || [] },
      sync: snap,
      mesh: snap.mesh || {}
    });
  }

  render () {
    const e = React.createElement;
    const page = this.props.variant !== 'embed';
    const view = this.state.view;
    const pairing = view && view.pairing;
    const pairingOpen = pairing && ['waiting', 'confirm', 'granting'].includes(pairing.status);
    const signers = (view && view.signers) || [];
    const rows = (this.syncModel().devices || []).filter((r) => r.kind !== 'this' || signers.length);
    return e('div', { className: 'ls-wrap' },
      page
        ? e('div', { className: 'ls-hero' },
          e('h3', null, 'Linked signers'),
          e('p', { className: 'd' },
            'Apps and wallets you have linked: Passport, GoonCitizen on another computer or your phone, a Hub. Each keeps its own key; you choose what each may do, and signing requests from them show up in your notifications.'))
        : null,
      view
        ? [
          e(React.Fragment, { key: 'pairing' }, pairing ? this.renderPairing(pairing) : null),
          pairingOpen ? null : e(React.Fragment, { key: 'add' }, this.renderAdd()),
          e(React.Fragment, { key: 'requests' }, this.renderRequests(view.pending || [])),
          e(React.Fragment, { key: 'signers' }, signers.length
            ? signers.map((s) => this.renderSigner(s))
            : e('div', { className: 'ls-empty' }, 'Nothing linked yet.'))
        ]
        : null,
      page && rows.length
        ? e('div', { className: 'ls-hero' },
          e('h3', null, 'Account sync'),
          e('p', { className: 'd' }, 'Apps that act as this player share notes, groups, tags, and recent chat over Fabric (local network first, a Hub when needed).'))
        : null,
      page ? rows.map((row) => this.renderSyncRow(row)) : null,
      page && rows.length
        ? e('div', { className: 'ls-actions' }, this.button(this.state.busy ? 'Syncing…' : 'Sync account now', () => this.syncNow()))
        : null,
      this.state.error ? e('div', { className: 'id-err' }, this.state.error) : null,
      page ? e(DataSyncStatus, { variant: 'panel', origin: this.origin() }) : null
    );
  }
}

LinkedSigners.CSS = CSS;
LinkedSigners.SCOPES = SCOPES;

module.exports = LinkedSigners;
