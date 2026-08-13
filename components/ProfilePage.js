'use strict';

/**
 * Dedicated player profile page — `/profiles/:pubkey`.
 * Opened from chat member list (and anywhere else that links by Fabric id).
 */

const React = require('react');
const ActivityHeatmap = require('./ActivityHeatmap');
const Identity = require('./Identity');
const Settings = require('./Settings');
const {
  peeringInfoForGoonCitizen,
  copyPeeringString
} = require('../functions/peerPeeringString');

const BASE = '/services/star-citizen';
const ADVANCED_MODE_KEY = 'gooncitizen.advancedMode';

function readAdvancedMode () {
  try {
    return (typeof localStorage !== 'undefined') && localStorage.getItem(ADVANCED_MODE_KEY) === '1';
  } catch (_) {
    return false;
  }
}

function writeAdvancedMode (on) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (on) localStorage.setItem(ADVANCED_MODE_KEY, '1');
    else localStorage.removeItem(ADVANCED_MODE_KEY);
  } catch (_) { /* ignore */ }
}

const CSS = `
  .ppage{width:100%;max-width:none;margin:0;padding:12px 14px;display:grid;gap:16px;box-sizing:border-box}
  .ppage-back{color:var(--muted);font-size:13px;text-decoration:none;cursor:pointer;background:none;border:none;padding:0;font:inherit;text-align:left}
  .ppage-back:hover{color:var(--accent)}
  .ppage-hero{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:22px 24px}
  .ppage-hero h1{margin:0 0 6px;font-size:20px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding-right:44px}
  .ppage-hero .sub{color:var(--muted);font-size:13px;line-height:1.5;word-break:break-all;
    font-family:'Cascadia Code',Consolas,monospace}
  .ppage-gear{position:absolute;top:14px;right:14px;background:var(--panel2);border:1px solid var(--line);
    border-radius:8px;padding:5px 8px;cursor:pointer;font-size:15px;line-height:1}
  .ppage-gear:hover{border-color:var(--accent)}
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
  .ppage-copy{margin-top:8px;background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer}
  .ppage-copy:hover{border-color:var(--accent);color:var(--accent)}
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
      analytics: null,
      peeringCopied: false,
      showSettings: false,
      showIdentity: false,
      advancedMode: readAdvancedMode(),
      showProfileActivity: ActivityHeatmap.readShowProfileActivity()
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

  peeringInfo (d) {
    if (d && d.peering && d.peering.string) return d.peering;
    const sig = typeof window !== 'undefined' ? window.location.host : '';
    return peeringInfoForGoonCitizen({
      peer: d && d.peer,
      profile: d && d.profile,
      pubkey: d && d.pubkey,
      signalingHostPort: sig
    });
  }

  copyPeering (str) {
    if (!copyPeeringString(str)) return;
    this.setState({ peeringCopied: true });
    window.setTimeout(() => this.setState({ peeringCopied: false }), 1500);
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
    const peering = this.peeringInfo(d);

    return React.createElement('div', { className: 'ppage' },
      React.createElement('button', { type: 'button', className: 'ppage-back', onClick: () => this.goBack() }, '← Back'),
      React.createElement('div', { className: 'ppage-hero' },
        d.self
          ? React.createElement('button', {
            type: 'button',
            className: 'ppage-gear',
            title: 'Settings — log path, Discord, runtime',
            onClick: () => this.setState({ showSettings: true })
          }, '⚙️')
          : null,
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
          peering.string
            ? React.createElement('div', { className: 'ppage-kv' },
              React.createElement('b', null, 'peering '), React.createElement('br'),
              peering.string,
              React.createElement('div', null,
                React.createElement('button', {
                  type: 'button',
                  className: 'ppage-copy',
                  title: 'Copy pubkey@host:port for native Fabric dial',
                  onClick: () => this.copyPeering(peering.string)
                }, this.state.peeringCopied ? 'Copied' : 'Copy peering string')),
              React.createElement('div', { className: 'ppage-hint', style: { marginTop: 6 } },
                peering.signaling
                  ? 'WebRTC signaling host (this site) — browsers will peer here; native nodes use Fabric TCP when advertised.'
                  : 'Native Fabric dial pin (pubkey@host:port).'))
            : (peer && peer.address
              ? React.createElement('div', { className: 'ppage-kv' },
                React.createElement('b', null, 'peer address '), React.createElement('br'), peer.address)
              : (d.self
                ? React.createElement('div', { className: 'ppage-hint' },
                  'No dialable peering string yet — set fabricAdvertiseHost in Settings so others can dial you as pubkey@host:port.')
                : React.createElement('div', { className: 'ppage-hint' },
                  'No Fabric TCP address known for this peer yet.'))),
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
      ),
      this.state.showSettings
        ? React.createElement(Settings, {
          onClose: () => this.setState({ showSettings: false }),
          onOpenIdentity: () => this.setState({ showSettings: false, showIdentity: true }),
          advancedMode: this.state.advancedMode,
          onAdvancedModeChange: (on) => {
            writeAdvancedMode(on);
            this.setState({ advancedMode: on });
          },
          showProfileActivity: this.state.showProfileActivity,
          onShowProfileActivityChange: (on) => {
            ActivityHeatmap.writeShowProfileActivity(on);
            this.setState({ showProfileActivity: on });
          }
        })
        : null,
      this.state.showIdentity
        ? React.createElement(Identity, {
          onClose: () => {
            this.setState({ showIdentity: false });
            this.load();
          },
          showProfileActivity: this.state.showProfileActivity,
          analytics: this.state.analytics,
          onNicknameChange: () => this.load()
        })
        : null
    );
  }
}

ProfilePage.CSS = CSS;
ProfilePage.pubkeyFromLocation = function () {
  const m = String((typeof window !== 'undefined' && window.location.pathname) || '').match(/^\/profiles\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

module.exports = ProfilePage;
