'use strict';

/**
 * Dedicated player profile page — `/profiles/:id`.
 * Fabric compressed pubkeys, `discord:<id>`, and other `platform:id` actors
 * share this page. Linked identities roll up onto one actor.
 */

const React = require('react');
const ActivityHeatmap = require('./ActivityHeatmap');
const Identity = require('./Identity');
const Settings = require('./Settings');
const IdentityNotePanel = require('./IdentityNotePanel');
const {
  peeringInfoForGoonCitizen,
  copyPeeringString
} = require('../functions/peerPeeringString');
const { androidSurface } = require('../functions/androidSurface');

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
  .ppage-plats{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
  .ppage-plat{display:inline-flex;gap:6px;align-items:center;background:var(--panel2);border:1px solid var(--line);
    border-radius:999px;padding:3px 10px;font-size:11.5px;color:var(--text);text-decoration:none}
  .ppage-plat:hover{border-color:var(--accent);color:var(--accent)}
  .ppage-plat b{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700}
  .ppage-btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:7px;
    padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;margin-top:10px}
  .ppage-btn:hover{border-color:var(--accent);color:var(--accent)}
  .ppage-files{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:6px}
  .ppage-file{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline;
    background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px 10px}
  .ppage-file .name{font-size:13px;font-weight:600}
  .ppage-file .meta{color:var(--muted);font-size:11.5px;font-family:'Cascadia Code',Consolas,monospace}
  .ppage-notes{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:6px}
  .ppage-note{background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px 10px;
    font-size:13px;line-height:1.45}
  .ppage-note .meta{color:var(--muted);font-size:11.5px;margin-top:4px}
`;

function shortKey (pubkey) {
  return pubkey ? pubkey.slice(0, 10) + '…' + pubkey.slice(-6) : '—';
}

function formatBytes (n) {
  const size = Number(n);
  if (!Number.isFinite(size) || size < 0) return '';
  if (size >= 1048576) return (size / 1048576).toFixed(1) + ' MB';
  if (size >= 1024) return Math.round(size / 1024) + ' KB';
  return size + ' B';
}

function formatSats (n) {
  const sats = Math.max(0, Math.floor(Number(n) || 0));
  return sats ? (sats + ' sats') : 'free';
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
      sharePlaytimes: false
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
      this.setState({ loading: false, error: 'Missing identity' });
      return;
    }
    this.setState({ loading: true, error: null });
    try {
      const [profRes, azRes] = await Promise.all([
        fetch(`${BASE}/profiles/${encodeURIComponent(pubkey)}`).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
        androidSurface('heatmap')
          ? fetch(`${BASE}/analytics`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
          : Promise.resolve(null)
      ]);
      if (!profRes.ok) throw new Error((profRes.j && profRes.j.error) || 'Profile unavailable');
      this.setState({
        loading: false,
        detail: profRes.j.data || null,
        analytics: azRes,
        sharePlaytimes: !!(profRes.j.data && profRes.j.data.sharePlaytimes),
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
    if (d && d.peering && typeof d.peering.string === 'string') return d.peering;
    if (d && d.self) {
      const sig = typeof window !== 'undefined' ? window.location.host : '';
      return peeringInfoForGoonCitizen({
        peer: d && d.peer,
        profile: d && d.profile,
        pubkey: d && d.pubkey,
        signalingHostPort: sig
      });
    }
    return { string: '', endpoint: '', signaling: false };
  }

  copyPeering (str) {
    if (!copyPeeringString(str)) return;
    this.setState({ peeringCopied: true });
    window.setTimeout(() => this.setState({ peeringCopied: false }), 1500);
  }

  async putSharePlaytimes (on) {
    const prev = this.state.sharePlaytimes;
    this.setState({ sharePlaytimes: on === true });
    try {
      const res = await fetch('/settings/sharePlaytimes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: on === true })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      await this.load();
    } catch (e) {
      this.setState({ sharePlaytimes: prev, error: e.message || String(e) });
    }
  }

  openInChat (query) {
    const q = String(query || '').trim();
    if (!q) return;
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('gc.chat.people', q);
    } catch (_) { /* ignore */ }
    window.location.href = '/#chat';
  }

  displayName (d) {
    const profile = (d && d.profile) || {};
    const discord = (d && d.discord) || (d && d.actor && d.actor.discord);
    return profile.nickname
      || d.meshAlias
      || (discord && (discord.displayName || discord.username))
      || shortKey(d.pubkey);
  }

  renderIdentities (d) {
    const actor = d && d.actor;
    const platforms = (actor && actor.platforms) || [];
    const discord = d.discord || (actor && actor.discord);
    const cluster = actor && actor.cluster;
    if (!platforms.length && !discord && !cluster) return null;
    return React.createElement('div', { style: { marginTop: 12 } },
      React.createElement('div', { className: 'ppage-hint', style: { marginBottom: 6 } },
        'Identities across Fabric, Discord, and other chat networks roll up here.'),
      platforms.length
        ? React.createElement('div', { className: 'ppage-plats' },
          platforms.map((p) => React.createElement('a', {
            key: p.key,
            className: 'ppage-plat',
            href: p.href || ('/profiles/' + encodeURIComponent(p.key)),
            title: p.key
          },
          React.createElement('b', null, p.platform),
          p.handle || (p.platform === 'fabric' ? shortKey(p.nativeId) : p.nativeId)
          )))
        : null,
      discord && Array.isArray(discord.guilds) && discord.guilds.length
        ? React.createElement('div', { className: 'ppage-hint', style: { marginTop: 8 } },
          'Discord servers: ' + discord.guilds.map((g) => g.name || g.id).join(', '))
        : null,
      cluster && cluster.members && cluster.members.length > 1
        ? React.createElement('div', { className: 'ppage-hint', style: { marginTop: 8 } },
          'Device cluster (' + cluster.members.length + ')',
          React.createElement('div', {
            style: { marginTop: 4, fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 11 }
          }, cluster.members.map((pk) => String(pk).slice(0, 16) + '…').join(' · ')))
        : null
    );
  }

  renderActivity (d) {
    if (!d) return null;
    if (d.self) {
      if (!androidSurface('heatmap')) return null;
      return React.createElement('div', { style: { marginTop: 10 } },
        React.createElement(ActivityHeatmap, {
          title: 'When you play',
          subtitle: 'Your local cumulative heatmap. Sharing publishes a weekday × hour grid to Federation groups — not full history.',
          analytics: this.state.analytics
        }),
        React.createElement('label', {
          style: { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, cursor: 'pointer', marginTop: 10 }
        },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.sharePlaytimes === true,
          onChange: (e) => this.putSharePlaytimes(e.target.checked),
          style: { marginTop: 3 }
        }),
        React.createElement('span', null,
          'Share when I play with Federation groups I belong to',
          React.createElement('div', { className: 'ppage-hint', style: { marginTop: 4 } },
            this.state.sharePlaytimes
              ? 'Group members can see common play times on this profile.'
              : 'Off — play times stay on this machine.')
        ))
      );
    }
    const cells = d.playtimes && Array.isArray(d.playtimes.cells) ? d.playtimes.cells : null;
    if (!cells || !cells.length) {
      const hasFabric = !!(d.actor && d.actor.platforms
        && d.actor.platforms.some((p) => p.platform === 'fabric'));
      if (!hasFabric && d.pubkey && String(d.pubkey).indexOf('discord:') === 0) return null;
      return React.createElement('div', { className: 'ppage-hint', style: { marginTop: 10 } },
        'This player has not shared when they play.');
    }
    return React.createElement(ActivityHeatmap, {
      title: 'When they play',
      subtitle: 'Common play times they opted to share with a Federation group.',
      heatcells: cells
    });
  }

  renderSharedStats (d, peering) {
    const files = d.files && Array.isArray(d.files.files) ? d.files.files : [];
    const play = d.playtimes && Array.isArray(d.playtimes.cells) && d.playtimes.cells.length
      ? d.playtimes
      : null;
    const bits = [];
    if (peering && peering.string) bits.push('connection');
    if (play) {
      const n = play.sampleCount != null ? Number(play.sampleCount) : play.cells.length;
      bits.push(Number.isFinite(n) && n > 0
        ? ('play times (' + n + ' samples)')
        : 'play times');
    }
    if (files.length) {
      bits.push(files.length + ' pinned file' + (files.length === 1 ? '' : 's'));
    }
    const notes = d.notes && Array.isArray(d.notes.notes) ? d.notes.notes : [];
    if (notes.length) {
      bits.push(notes.length + ' public note' + (notes.length === 1 ? '' : 's'));
    }
    if (!bits.length) return null;
    return React.createElement('div', { className: 'ppage-kv' },
      React.createElement('b', null, 'shared '), React.createElement('br'),
      bits.join(' · '));
  }

  renderFileRows (files) {
    const rows = Array.isArray(files) ? files : [];
    if (!rows.length) return null;
    return React.createElement('ul', { className: 'ppage-files' },
      rows.map((f) => {
        const href = f.href || (f.id ? ('/files/' + encodeURIComponent(f.id)) : null);
        const name = React.createElement(href ? 'a' : 'span', {
          className: 'name',
          href: href || undefined,
          style: href ? { color: 'inherit', textDecoration: 'none' } : undefined
        }, f.name || 'file');
        return React.createElement('li', {
          key: f.id || f.sha256 || f.name,
          className: 'ppage-file'
        },
        name,
        React.createElement('span', { className: 'meta' },
          [formatBytes(f.size), formatSats(f.purchasePriceSats), f.mime].filter(Boolean).join(' · ')
        )
        );
      })
    );
  }

  renderFiles (d) {
    if (!d) return null;
    if (d.self) {
      const files = d.files && Array.isArray(d.files.files) ? d.files.files : [];
      return React.createElement('div', { style: { marginTop: 16 } },
        React.createElement('div', { style: { fontSize: 13, fontWeight: 600 } }, 'Pinned files'),
        files.length
          ? this.renderFileRows(files)
          : React.createElement('div', { className: 'ppage-hint', style: { marginTop: 8 } },
            'Nothing pinned yet. Open a file and use 📌 Pin to profile — that is how a local developer install lists GoonCitizen builds for Federation groups.'),
        React.createElement('div', { className: 'ppage-hint', style: { marginTop: 8 } },
          'Listings are names, sizes, and prices — not the file bytes.')
      );
    }
    const files = d.files && Array.isArray(d.files.files) ? d.files.files : null;
    if (!files || !files.length) {
      const hasFabric = !!(d.actor && d.actor.platforms
        && d.actor.platforms.some((p) => p.platform === 'fabric'));
      if (!hasFabric && d.pubkey && String(d.pubkey).indexOf('discord:') === 0) return null;
      return React.createElement('div', { className: 'ppage-hint', style: { marginTop: 10 } },
        'This player has not pinned files to their profile.');
    }
    return React.createElement('div', { style: { marginTop: 16 } },
      React.createElement('div', { style: { fontSize: 13, fontWeight: 600 } }, 'Pinned files'),
      React.createElement('div', { className: 'ppage-hint', style: { marginTop: 4 } },
        'Files they pinned to this profile for a Federation group.'),
      this.renderFileRows(files)
    );
  }

  publicNotes (d) {
    if (!d || !d.notes) return [];
    if (Array.isArray(d.notes.notes)) return d.notes.notes;
    return Array.isArray(d.notes) ? d.notes : [];
  }

  renderPublicNotes (d) {
    if (!d) return null;
    const notes = this.publicNotes(d);
    if (d.self) {
      return React.createElement('div', { style: { marginTop: 16 } },
        React.createElement('div', { style: { fontSize: 13, fontWeight: 600 } }, 'Public notes'),
        notes.length
          ? React.createElement('ul', { className: 'ppage-notes' },
            notes.map((n) => React.createElement('li', {
              key: n.id,
              className: 'ppage-note'
            },
            n.body,
            React.createElement('div', { className: 'meta' },
              [n.subjectHandle, n.author ? String(n.author).slice(0, 10) + '…' : null]
                .filter(Boolean).join(' · ')
            )
            )))
          : React.createElement('div', { className: 'ppage-hint', style: { marginTop: 8 } },
            'Nothing pinned yet. Use 📌 on a note to publish a warning, note, or comment on this profile for Federation groups.'),
        React.createElement('div', { className: 'ppage-hint', style: { marginTop: 8 } },
          'Pinned notes gossip with groups you belong to — not the whole mesh.')
      );
    }
    if (!notes.length) {
      const hasFabric = !!(d.actor && d.actor.platforms
        && d.actor.platforms.some((p) => p.platform === 'fabric'));
      if (!hasFabric && d.pubkey && String(d.pubkey).indexOf('discord:') === 0) return null;
      return React.createElement('div', { className: 'ppage-hint', style: { marginTop: 10 } },
        'No public notes on this profile.');
    }
    return React.createElement('div', { style: { marginTop: 16 } },
      React.createElement('div', { style: { fontSize: 13, fontWeight: 600 } }, 'Public notes'),
      React.createElement('div', { className: 'ppage-hint', style: { marginTop: 4 } },
        'Warnings, notes, and comments pinned to this profile.'),
      React.createElement('ul', { className: 'ppage-notes' },
        notes.map((n) => React.createElement('li', {
          key: n.id,
          className: 'ppage-note'
        }, n.body))
      )
    );
  }

  renderMyNotes (d) {
    if (!d || !d.self) return null;
    return React.createElement('div', { className: 'ppage-panel' },
      React.createElement('h2', null, 'My notes'),
      React.createElement('div', { className: 'body' },
        React.createElement('div', { className: 'ppage-hint', style: { marginBottom: 8 } },
          'Browse notes you authored. 📌 pins one to a profile for public warnings and comments; 👥 shares it to a Federation group.'),
        React.createElement(IdentityNotePanel, {
          actor: d.pubkey,
          handle: this.displayName(d),
          mine: true,
          compact: false,
          hideTags: true,
          identityPubkey: d.pubkey
        })
      )
    );
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
    const actor = d.actor || null;
    const discord = d.discord || (actor && actor.discord) || null;
    const fabricPlat = actor && Array.isArray(actor.platforms)
      ? actor.platforms.find((p) => p.platform === 'fabric')
      : null;
    const hasFabric = !!(fabricPlat || (d.pubkey && /^0[23][0-9a-fA-F]{64}$/.test(d.pubkey)) || d.self);
    const name = this.displayName(d);
    const presence = d.presence;
    const ship = presence && presence.ship;
    const peering = this.peeringInfo(d);
    const identityKey = (actor && actor.requested && actor.requested.key) || d.pubkey;

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
          discord && !fabricPlat
            ? React.createElement('span', { className: 'ppage-tag off' }, 'discord')
            : null,
          presence
            ? React.createElement('span', { className: 'ppage-tag ' + (presence.online ? 'on' : 'off') },
              presence.online ? 'online' : 'offline')
            : null
        ),
        React.createElement('div', { className: 'sub' }, identityKey),
        React.createElement('button', {
          type: 'button',
          className: 'ppage-btn',
          onClick: () => this.openInChat(name)
        }, 'Open in Chat')
      ),
      React.createElement('div', { className: 'ppage-panel' },
        React.createElement('h2', null, 'Profile'),
        React.createElement('div', { className: 'body' },
          React.createElement('div', { className: 'ppage-kv' },
            React.createElement('b', null, 'nickname '), React.createElement('br'),
            profile.nickname || d.meshAlias || (discord && discord.displayName) || '—'),
          hasFabric
            ? React.createElement('div', { className: 'ppage-kv' },
              React.createElement('b', null, 'Star Citizen handle '), React.createElement('br'),
              profile.scHandle || '—')
            : null,
          this.renderSharedStats(d, peering),
          peering.string
            ? React.createElement('div', { className: 'ppage-kv' },
              React.createElement('b', null, 'connection '), React.createElement('br'),
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
                  ? 'Shared connection string for browsers (WebRTC on this site). Native nodes dial Fabric TCP when advertised.'
                  : 'Shared connection string for native Fabric dial (pubkey@host:port).'))
            : (d.self
              ? React.createElement('div', { className: 'ppage-hint' },
                'No dialable peering string yet — set fabricAdvertiseHost in Settings so others can dial you as pubkey@host:port.')
              : (hasFabric
                ? React.createElement('div', { className: 'ppage-hint' },
                  'No connection string shared.')
                : null)),
          profile.bio
            ? React.createElement('div', null,
              React.createElement('div', { className: 'ppage-hint', style: { marginBottom: 4 } }, 'Bio'),
              React.createElement('div', { className: 'ppage-bio' }, profile.bio))
            : (hasFabric
              ? React.createElement('div', { className: 'ppage-hint' }, 'No bio published yet.')
              : null),
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
                : null,
              presence.location
                ? React.createElement('div', { style: { marginTop: 4 } },
                  'location ', presence.location.name || presence.location.slug,
                  presence.location.system ? ` · ${presence.location.system}` : '')
                : null,
              presence.destination
                ? React.createElement('div', { style: { marginTop: 4 } },
                  'destination ', presence.destination.name || presence.destination.slug)
                : null)
            : (hasFabric
              ? React.createElement('div', { className: 'ppage-hint', style: { marginTop: 10 } },
                'No online status shared (opt-in PeerPresence).')
              : null),
          this.renderIdentities(d),
          d.linkedDevice
            ? React.createElement('div', { className: 'ppage-hint', style: { marginTop: 8 } },
              'Identity cluster',
              d.linkedDevice.members && d.linkedDevice.members.length
                ? (': ' + d.linkedDevice.members.length + ' devices')
                : (': ' + (d.linkedDevice.label || d.linkedDevice.peerFabricId)),
              d.linkedDevice.members
                ? React.createElement('div', { style: { marginTop: 4, fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 11 } },
                  d.linkedDevice.members.map((pk) => String(pk).slice(0, 16) + '…').join(' · '))
                : null)
            : null,
          this.renderActivity(d),
          this.renderFiles(d),
          this.renderPublicNotes(d)
        )
      ),
      this.renderMyNotes(d),
      this.state.showSettings
        ? React.createElement(Settings, {
          onClose: () => this.setState({ showSettings: false }),
          onOpenIdentity: () => this.setState({ showSettings: false, showIdentity: true }),
          advancedMode: this.state.advancedMode,
          onAdvancedModeChange: (on) => {
            writeAdvancedMode(on);
            this.setState({ advancedMode: on });
          }
        })
        : null,
      this.state.showIdentity
        ? React.createElement(Identity, {
          onClose: () => {
            this.setState({ showIdentity: false });
            this.load();
          },
          onNicknameChange: () => this.load(),
          analytics: this.state.analytics
        })
        : null
    );
  }
}

ProfilePage.CSS = CSS + '\n' + (IdentityNotePanel.CSS || '');
ProfilePage.pubkeyFromLocation = function () {
  const m = String((typeof window !== 'undefined' && window.location.pathname) || '').match(/^\/profiles\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

module.exports = ProfilePage;
