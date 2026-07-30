'use strict';

/**
 * Dedicated player profile page — `/profiles/:pubkey`.
 * Opened from chat member list (and anywhere else that links by Fabric id).
 */

const React = require('react');
const ActivityHeatmap = require('./ActivityHeatmap');

const BASE = '/services/star-citizen';

const CSS = `
  .ppage{max-width:720px;margin:0 auto;padding:18px;display:grid;gap:16px}
  .ppage-back{color:var(--muted);font-size:13px;text-decoration:none;cursor:pointer;background:none;border:none;padding:0;font:inherit;text-align:left}
  .ppage-back:hover{color:var(--accent)}
  .ppage-hero{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:22px 24px}
  .ppage-hero h1{margin:0 0 6px;font-size:20px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .ppage-hero .sub{color:var(--muted);font-size:13px;line-height:1.5;word-break:break-all;
    font-family:'Cascadia Code',Consolas,monospace}
  .ppage-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .ppage-panel h2{font-size:13px;margin:0;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:600}
  .ppage-panel .body{padding:14px 16px}
  .ppage-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:9px 12px;font-size:13px}
  .ppage-kv{font-family:'Cascadia Code',Consolas,monospace;font-size:11.5px;word-break:break-all;
    background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px 10px;margin-bottom:8px}
  .ppage-kv b{color:var(--muted);font-weight:600;font-family:'Segoe UI',system-ui,sans-serif;font-size:11px}
  .ppage-bio{font-size:13px;line-height:1.5;color:var(--text);white-space:pre-wrap}
  .ppage-tag{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:5px;letter-spacing:.02em}
  .ppage-tag.on{background:rgba(63,185,80,.15);color:var(--good)}
  .ppage-tag.off{background:rgba(110,118,129,.18);color:var(--muted)}
  .ppage-tag.you{background:rgba(56,139,253,.18);color:var(--accent)}
  .ppage-hint{color:var(--muted);font-size:12.5px;line-height:1.55}
`;

function shortKey (pubkey) {
  return pubkey ? pubkey.slice(0, 10) + '…' + pubkey.slice(-6) : '—';
}

class ProfilePage extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      loading: true,
      error: null,
      detail: null,
      analytics: null
    };
  }

  get pubkey () {
    const m = String((typeof window !== 'undefined' && window.location.pathname) || '').match(/^\/profiles\/([^/]+)/);
    return (m && decodeURIComponent(m[1])) || this.props.pubkey || null;
  }

  componentDidMount () {
    this.load();
  }

  async load () {
    const pubkey = this.pubkey;
    if (!pubkey) {
      this.setState({ loading: false, error: 'Missing pubkey' });
      return;
    }
    this.setState({ loading: true, error: null });
    try {
      const [profRes, azRes] = await Promise.all([
        fetch(`${BASE}/profiles/${encodeURIComponent(pubkey)}`).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
        fetch(`${BASE}/analytics`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      ]);
      if (!profRes.ok) throw new Error((profRes.j && profRes.j.error) || 'Profile unavailable');
      this.setState({
        loading: false,
        detail: profRes.j.data || null,
        analytics: azRes,
        error: null
      });
    } catch (e) {
      this.setState({ loading: false, error: e.message || String(e) });
    }
  }

  goBack () {
    if (typeof window === 'undefined') return;
    if (window.history.length > 1) window.history.back();
    else window.location.href = '/#chat';
  }

  renderActivity (d) {
    if (!ActivityHeatmap.readShowProfileActivity() || !d) return null;
    const handle = (d.profile && d.profile.scHandle) || null;
    if (!d.self && !handle) {
      return React.createElement('div', { className: 'ppage-hint' },
        'No Star Citizen handle on this profile — activity graph needs a handle match in local history.');
    }
    return React.createElement(ActivityHeatmap, {
      title: d.self ? 'When you fly' : 'When they fly (local history)',
      subtitle: d.self
        ? 'Your cumulative activity heatmap.'
        : `Filtered to handle ${handle} from this machine’s cumulative logs.`,
      analytics: this.state.analytics,
      player: d.self ? null : handle
    });
  }

  render () {
    if (this.state.loading) {
      return React.createElement('div', { className: 'ppage' },
        React.createElement('div', { className: 'ppage-hint' }, 'Loading profile…'));
    }
    if (this.state.error && !this.state.detail) {
      return React.createElement('div', { className: 'ppage' },
        React.createElement('button', { type: 'button', className: 'ppage-back', onClick: () => this.goBack() }, '← Back'),
        React.createElement('div', { className: 'ppage-err' }, this.state.error)
      );
    }
    const d = this.state.detail;
    const profile = d.profile || {};
    const peer = d.peer;
    const name = profile.nickname || d.meshAlias || shortKey(d.pubkey);
    const presence = d.presence;
    const ship = presence && presence.ship;

    return React.createElement('div', { className: 'ppage' },
      React.createElement('button', { type: 'button', className: 'ppage-back', onClick: () => this.goBack() }, '← Back'),
      React.createElement('div', { className: 'ppage-hero' },
        React.createElement('h1', null,
          name,
          d.self ? React.createElement('span', { className: 'ppage-tag you' }, 'you') : null,
          presence
            ? React.createElement('span', { className: 'ppage-tag ' + (presence.online ? 'on' : 'off') },
              presence.online ? 'online' : 'offline')
            : null
        ),
        React.createElement('div', { className: 'sub' }, d.pubkey)
      ),
      React.createElement('div', { className: 'ppage-panel' },
        React.createElement('h2', null, 'Profile'),
        React.createElement('div', { className: 'body' },
          React.createElement('div', { className: 'ppage-kv' },
            React.createElement('b', null, 'nickname '), React.createElement('br'),
            profile.nickname || d.meshAlias || '—'),
          React.createElement('div', { className: 'ppage-kv' },
            React.createElement('b', null, 'Star Citizen handle '), React.createElement('br'),
            profile.scHandle || '—'),
          peer && peer.address
            ? React.createElement('div', { className: 'ppage-kv' },
              React.createElement('b', null, 'peer address '), React.createElement('br'), peer.address)
            : null,
          profile.bio
            ? React.createElement('div', null,
              React.createElement('div', { className: 'ppage-hint', style: { marginBottom: 4 } }, 'Bio'),
              React.createElement('div', { className: 'ppage-bio' }, profile.bio))
            : React.createElement('div', { className: 'ppage-hint' }, 'No bio published yet.'),
          presence
            ? React.createElement('div', { className: 'ppage-kv', style: { marginTop: 10 } },
              React.createElement('b', null, 'presence '), React.createElement('br'),
              presence.online ? 'online' : 'offline',
              presence.statusText ? ` · ${presence.statusText}` : '',
              ship
                ? React.createElement('div', { style: { marginTop: 4 } },
                  'ship ', ship.name || ship.slug,
                  ship.type ? ` · ${ship.type}` : '',
                  ship.source === 'override' ? ' (manual)' : '')
                : null)
            : React.createElement('div', { className: 'ppage-hint', style: { marginTop: 10 } },
              'No online status shared (opt-in PeerPresence).'),
          d.linkedDevice
            ? React.createElement('div', { className: 'ppage-hint', style: { marginTop: 8 } },
              'Linked device: ', d.linkedDevice.label || d.linkedDevice.peerFabricId)
            : null,
          this.renderActivity(d)
        )
      )
    );
  }
}

ProfilePage.CSS = CSS;
ProfilePage.pubkeyFromLocation = function () {
  const m = String((typeof window !== 'undefined' && window.location.pathname) || '').match(/^\/profiles\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

module.exports = ProfilePage;
