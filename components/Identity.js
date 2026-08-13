'use strict';

/**
 * Identity — key management modal (Hub IdentityManager brought forward).
 *
 * Adapts hub.fabric.pub's identity safety model to the GoonCitizen desktop
 * shell (plain React + IPC bridge instead of Semantic UI + localStorage):
 *   - lock / unlock with the encryption password; idle auto-lock timer
 *   - reveal recovery phrase / xprv only after re-entering the password
 *     (even while unlocked), hidden by default, copy gated on reveal
 *   - encrypted backup export + import (password-sealed JSON file)
 *   - forget requires an explicit typed confirmation
 *
 * The plaintext key never enters the renderer: all operations go through
 * `window.electronAPI.identity` and secrets live only in main-process
 * memory while unlocked.
 */

const React = require('react');
const ActivityHeatmap = require('./ActivityHeatmap');
const ShipPicker = require('./ShipPicker');

const CSS = `
  .id-overlay{position:fixed;inset:0;z-index:45;background:rgba(8,10,14,.75);
    display:flex;align-items:flex-start;justify-content:center;padding:54px 16px 30px;backdrop-filter:blur(2px)}
  .id-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;
    width:min(620px,94vw);max-height:86vh;overflow:auto}
  .id-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);
    position:sticky;top:0;background:var(--panel);z-index:1}
  .id-head h2{margin:0;font-size:16px;flex:1}
  .id-x{background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;padding:2px 8px}
  .id-x:hover{color:var(--text)}
  .id-sec{padding:14px 18px;border-bottom:1px solid var(--line)}
  .id-sec:last-child{border-bottom:none}
  .id-sec h3{margin:0 0 4px;font-size:13px}
  .id-sec .d{color:var(--muted);font-size:12px;margin-bottom:10px;line-height:1.5}
  .id-kv{font-family:'Cascadia Code',Consolas,monospace;font-size:11.5px;word-break:break-all;
    background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px 10px;margin:6px 0}
  .id-kv b{color:var(--muted);font-weight:600;font-family:'Segoe UI',system-ui,sans-serif;font-size:11px}
  .id-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}
  .id-btn{background:var(--accent);border:none;color:#fff;border-radius:7px;padding:7px 14px;
    font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}
  .id-btn:disabled{opacity:.45;cursor:default}
  .id-btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
  .id-btn.danger{background:transparent;border:1px solid var(--line);color:var(--kill)}
  .id-input{background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:8px 10px;font-size:13px;box-sizing:border-box;flex:1;min-width:180px}
  .id-select{background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:7px 10px;font-size:12.5px}
  .id-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:8px 11px;font-size:12.5px;margin-top:8px}
  .id-ok{background:rgba(63,185,80,.12);color:var(--good);border-radius:7px;padding:8px 11px;font-size:12.5px;margin-top:8px}
  .id-warn{background:rgba(210,153,34,.12);color:var(--warn);border-radius:7px;padding:9px 12px;font-size:12.5px;line-height:1.5;margin-bottom:8px}
  .id-secret{background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:10px 12px;
    font-family:'Cascadia Code',Consolas,monospace;font-size:12.5px;word-break:break-all;margin:8px 0}
  .id-secret.hidden{color:var(--muted);font-style:italic;font-family:'Segoe UI',system-ui,sans-serif}
  .id-tag{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:5px;margin-left:8px;vertical-align:middle}
  .id-tag.on{background:rgba(63,185,80,.15);color:var(--good)}
  .id-tag.off{background:rgba(110,118,129,.18);color:var(--muted)}
  .id-field{display:grid;gap:4px;margin-bottom:10px}
  .id-field label{font-size:12px;color:var(--muted)}
  .id-field select,.id-field input,.id-field textarea{width:100%;background:var(--bg);border:1px solid var(--line);
    color:var(--text);border-radius:7px;padding:8px 10px;font-size:13px;box-sizing:border-box}
  .id-groups{display:flex;flex-wrap:wrap;gap:8px}
  .id-groups label{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text);cursor:pointer}
`;

const AUTOLOCK_OPTIONS = [
  [0, 'Off — lock manually only'],
  [5, '5 minutes'],
  [15, '15 minutes'],
  [30, '30 minutes'],
  [60, '1 hour'],
  [120, '2 hours'],
  [240, '4 hours'],
  [480, '8 hours']
];

function bridge () {
  return (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.identity) || null;
}

class Identity extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      info: null,           // identity summary from the bridge
      busy: false,
      error: null,
      notice: null,
      unlockPassword: '',
      // reveal
      revealPassword: '',
      revealed: null,       // { mnemonic, xprv }
      showMnemonic: false,
      showXprv: false,
      // backup
      backupPassword: '',
      importPassword: '',
      importReplace: false,
      // forget
      confirmForget: false,
      forgetText: '',
      // display nickname + profile (Fabric Store; not the key)
      nickname: '',
      bio: '',
      scHandle: '',
      nicknameBusy: false,
      // opt-in PeerPresence
      sharePresence: false,
      presenceVisibility: 'private',
      presenceGroupIds: [],
      shipOverrideSlug: null,
      presenceOnline: false,
      detectedShip: null,
      shipOverride: null,
      groups: [],
      presenceBusy: false,
      presenceAvailability: 'auto',
      presenceStatusText: '',
      statusDraft: '',
      showKeyTools: false
    };
    this._unsub = null;
    this._presenceTimer = null;
  }

  componentDidMount () {
    this.load();
    this.loadProfile();
    this.loadPresence();
    this._presenceTimer = setInterval(() => this.loadPresence(), 15000);
    const b = bridge();
    if (b && b.onChanged) {
      this._unsub = b.onChanged((summary) => this.setState({ info: summary, revealed: null }));
    }
  }

  async loadProfile () {
    try {
      const res = await fetch('/settings').then((r) => r.json());
      const profile = (res.settings && res.settings.profile) || {};
      this.setState({
        nickname: (res.settings && res.settings.nickname) || '',
        bio: profile.bio || '',
        scHandle: profile.scHandle || ''
      });
    } catch (_) { /* settings unavailable */ }
  }

  applyPresenceData (pd) {
    if (!pd || typeof pd !== 'object') return;
    const ps = pd.settings || {};
    const statusText = ps.presenceStatusText || (pd.presence && pd.presence.statusText) || '';
    const next = {
      sharePresence: ps.sharePresence === true,
      presenceVisibility: ps.presenceVisibility || 'private',
      presenceGroupIds: Array.isArray(ps.presenceGroupIds) ? ps.presenceGroupIds.slice() : [],
      shipOverrideSlug: ps.shipOverrideSlug || null,
      presenceAvailability: ps.presenceAvailability || 'auto',
      presenceStatusText: statusText || '',
      statusDraft: statusText || '',
      presenceOnline: pd.online === true,
      detectedShip: pd.detectedShip || null,
      shipOverride: pd.shipOverride || null
    };
    this.setState(next);
    if (typeof this.props.onPresenceChange === 'function') {
      this.props.onPresenceChange({
        online: next.presenceOnline,
        sharePresence: next.sharePresence,
        availability: next.presenceAvailability,
        statusText: next.presenceStatusText || null,
        ship: (pd.presence && pd.presence.ship) || null,
        detectedShip: next.detectedShip,
        shipOverride: next.shipOverride
      });
    }
  }

  async loadPresence () {
    try {
      const [presenceRes, groupsRes] = await Promise.all([
        fetch('/services/star-citizen/presence').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/services/star-citizen/groups').then((r) => (r.ok ? r.json() : { data: [] })).catch(() => ({ data: [] }))
      ]);
      const groups = Array.isArray(groupsRes.data) ? groupsRes.data : (Array.isArray(groupsRes) ? groupsRes : []);
      this.setState({ groups });
      if (presenceRes && presenceRes.data) this.applyPresenceData(presenceRes.data);
    } catch (_) { /* ignore */ }
  }

  async putPresence (patch) {
    this.setState({ presenceBusy: true, error: null, notice: null });
    try {
      const res = await fetch('/services/star-citizen/presence', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      this.setState({ presenceBusy: false });
      this.applyPresenceData(j.data || {});
    } catch (e) {
      this.setState({ presenceBusy: false, error: e.message });
    }
  }

  async setPublishedShip (slug) {
    const clearing = slug === '__none__' || slug === 'none' || slug === 'clear';
    const autodetect = slug === null || slug === undefined || slug === '';
    if (!autodetect && !clearing && this.state.shipOverrideSlug !== slug) {
      const detected = this.state.detectedShip;
      const autoLabel = detected && (detected.name || detected.slug)
        ? (detected.name || detected.slug)
        : 'autodetect from Game.log';
      const ok = window.confirm(
        'Publish a different ship than Game.log autodetection?\n\n' +
        'Autodetect: ' + autoLabel + '\n' +
        'You chose: ' + slug + '\n\n' +
        'Peers will see this override until you Clear or switch back to Autodetect.'
      );
      if (!ok) return;
    }
    this.setState({ presenceBusy: true, error: null, notice: null });
    try {
      const body = autodetect
        ? { autodetect: true }
        : (clearing ? { clear: true } : { slug });
      const res = await fetch('/services/star-citizen/presence/ship', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      this.setState({ presenceBusy: false });
      this.applyPresenceData(j.data || {});
    } catch (e) {
      this.setState({ presenceBusy: false, error: e.message });
    }
  }

  async saveProfile () {
    if (this.state.nicknameBusy) return;
    this.setState({ nicknameBusy: true, error: null, notice: null });
    try {
      const nickRes = await fetch('/settings/nickname', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: this.state.nickname.trim() || null })
      });
      const nickJson = await nickRes.json();
      if (!nickRes.ok) throw new Error(nickJson.error || `HTTP ${nickRes.status}`);
      const profileRes = await fetch('/settings/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: {
            bio: this.state.bio.trim() || null,
            scHandle: this.state.scHandle.trim() || null
          }
        })
      });
      const profileJson = await profileRes.json();
      if (!profileRes.ok) throw new Error(profileJson.error || `HTTP ${profileRes.status}`);
      const savedNick = (nickJson.settings && nickJson.settings.nickname) || '';
      const savedProfile = (profileJson.settings && profileJson.settings.profile) || {};
      this.setState({
        nickname: savedNick,
        bio: savedProfile.bio || '',
        scHandle: savedProfile.scHandle || '',
        nicknameBusy: false,
        notice: 'Profile saved — published to the Fabric mesh when unlocked.'
      });
      if (typeof this.props.onNicknameChange === 'function') this.props.onNicknameChange(savedNick || null);
    } catch (e) {
      this.setState({ nicknameBusy: false, error: e.message });
    }
  }

  componentWillUnmount () {
    if (this._unsub) this._unsub();
    if (this._presenceTimer) clearInterval(this._presenceTimer);
    // Never keep secrets in component state after close.
    this.setState({ revealed: null, revealPassword: '', unlockPassword: '', backupPassword: '' });
  }

  async load () {
    const b = bridge();
    if (!b) { this.setState({ info: null }); return; }
    try { this.setState({ info: await b.get() }); } catch (_) { /* bridge gone */ }
  }

  async unlock () {
    if (!this.state.unlockPassword || this.state.busy) return;
    this.setState({ busy: true, error: null, notice: null });
    const res = await bridge().unlock(this.state.unlockPassword);
    if (res.error) return this.setState({ busy: false, error: res.error });
    this.setState({ busy: false, unlockPassword: '', notice: 'Unlocked — signing enabled.' });
    this.load();
  }

  async lock () {
    await bridge().lock();
    this.setState({ notice: 'Locked — the key was cleared from memory.', revealed: null });
    this.load();
  }

  async setAutoLock (minutes) {
    const res = await bridge().setAutoLock(minutes);
    if (res && !res.error) this.setState({ info: res });
  }

  async reveal () {
    if (!this.state.revealPassword || this.state.busy) return;
    this.setState({ busy: true, error: null, notice: null });
    const res = await bridge().reveal(this.state.revealPassword);
    if (res.error) return this.setState({ busy: false, error: res.error });
    this.setState({
      busy: false,
      revealPassword: '',
      revealed: { mnemonic: res.mnemonic, xprv: res.xprv },
      showMnemonic: false,
      showXprv: false
    });
  }

  async exportBackup () {
    if (!this.state.backupPassword || this.state.busy) return;
    this.setState({ busy: true, error: null, notice: null });
    const res = await bridge().exportBackup(this.state.backupPassword);
    if (res.error) return this.setState({ busy: false, error: res.error });
    try {
      const blob = new Blob([JSON.stringify(res.backup, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.setState({ busy: false, backupPassword: '', notice: 'Encrypted backup downloaded. Store it offline; the same password unseals it.' });
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  importBackupFile (file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const backup = JSON.parse(String(reader.result || ''));
        const res = await bridge().importBackup(backup, this.state.importPassword, this.state.importReplace);
        if (res.error) return this.setState({ error: res.error });
        this.setState({ notice: 'Backup imported and unlocked.', importPassword: '', importReplace: false, error: null });
        this.load();
      } catch (e) {
        this.setState({ error: 'Could not read backup file: ' + e.message });
      }
    };
    reader.onerror = () => this.setState({ error: 'Failed to read backup file.' });
    reader.readAsText(file);
  }

  async forget () {
    if (this.state.forgetText !== 'forget') return;
    const res = await bridge().forget(true);
    if (res && res.error) return this.setState({ error: res.error });
    this.setState({ confirmForget: false, forgetText: '', revealed: null, notice: 'Identity deleted from this machine.' });
    this.load();
    if (this.props.onForget) this.props.onForget();
  }

  copy (text) {
    try { navigator.clipboard.writeText(text); this.setState({ notice: 'Copied.' }); } catch (_) { /* clipboard unavailable */ }
  }

  renderUnlockBanner () {
    const info = this.state.info;
    if (!info || info.unlocked) return null;
    return React.createElement('div', { className: 'id-sec' },
      React.createElement('h3', null, 'Identity locked',
        React.createElement('span', { className: 'id-tag off' }, 'locked')),
      React.createElement('div', { className: 'd' },
        'Unlock to sign mesh messages, share presence, and manage keys.'),
      React.createElement('div', { className: 'id-row' },
        React.createElement('input', {
          className: 'id-input', type: 'password', placeholder: 'password',
          value: this.state.unlockPassword,
          onChange: (e) => this.setState({ unlockPassword: e.target.value }),
          onKeyDown: (e) => { if (e.key === 'Enter') this.unlock(); }
        }),
        React.createElement('button', {
          className: 'id-btn',
          disabled: !this.state.unlockPassword || this.state.busy,
          onClick: () => this.unlock()
        }, 'Unlock')
      )
    );
  }

  renderKeyTools () {
    const info = this.state.info;
    if (!info) return null;
    const open = this.state.showKeyTools;
    return React.createElement('div', { className: 'id-sec' },
      React.createElement('div', { className: 'id-row', style: { marginTop: 0 } },
        React.createElement('button', {
          className: 'id-btn ghost',
          type: 'button',
          onClick: () => this.setState({ showKeyTools: !open, revealed: open ? null : this.state.revealed })
        }, open ? 'Hide keys & recovery' : 'Keys & recovery…'),
        info.unlocked
          ? React.createElement('span', { className: 'id-tag on' }, 'unlocked')
          : React.createElement('span', { className: 'id-tag off' }, 'locked'),
        info.unlocked
          ? React.createElement('button', { className: 'id-btn ghost', onClick: () => this.lock() }, '🔒 Lock now')
          : null
      ),
      open
        ? React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'd', style: { marginTop: 10 } },
            'Technical key material — pubkey, backups, and recovery. Most day-to-day use stays in Profile and Online status above.'),
          React.createElement('div', { className: 'id-kv' },
            React.createElement('b', null, 'pubkey (actor id) '), React.createElement('br'), info.pubkey || '—'),
          info.xpub
            ? React.createElement('div', { className: 'id-kv' },
              React.createElement('b', null, 'xpub (watch-only) '), React.createElement('br'), info.xpub)
            : null,
          React.createElement('div', { className: 'id-row' },
            React.createElement('button', { className: 'id-btn ghost', onClick: () => this.copy(info.pubkey) }, 'Copy pubkey')
          ),
          React.createElement('div', { className: 'id-row' },
            React.createElement('span', { style: { fontSize: 12, color: 'var(--muted)' } }, 'Auto-lock after idle'),
            React.createElement('select', {
              className: 'id-select',
              value: info.autoLockMinutes != null ? info.autoLockMinutes : 30,
              onChange: (e) => this.setAutoLock(Number(e.target.value))
            }, AUTOLOCK_OPTIONS.map(([v, label]) => React.createElement('option', { key: v, value: v }, label)))
          ),
          this.renderReveal(),
          this.renderBackup(),
          this.renderForget()
        )
        : null
    );
  }

  renderProfile () {
    return React.createElement('div', { className: 'id-sec' },
      React.createElement('h3', null, 'Profile'),
      React.createElement('div', { className: 'd' },
        'What peers see when they inspect you. Nickname is announced as P2P_PEER_ALIAS; bio and SC handle publish as PeerProfile. ',
        'Your pubkey stays the real identity.'),
      React.createElement('div', { className: 'id-field' },
        React.createElement('label', null, 'Nickname'),
        React.createElement('input', {
          type: 'text',
          maxLength: 32,
          placeholder: 'e.g. Neorion',
          value: this.state.nickname,
          onChange: (e) => this.setState({ nickname: e.target.value })
        })
      ),
      React.createElement('div', { className: 'id-field' },
        React.createElement('label', null, 'Star Citizen handle'),
        React.createElement('input', {
          type: 'text',
          maxLength: 64,
          placeholder: 'optional',
          value: this.state.scHandle,
          onChange: (e) => this.setState({ scHandle: e.target.value })
        })
      ),
      React.createElement('div', { className: 'id-field' },
        React.createElement('label', null, 'Bio'),
        React.createElement('textarea', {
          maxLength: 280,
          rows: 3,
          placeholder: 'Short bio (optional, max 280)',
          style: { resize: 'vertical', fontFamily: 'inherit' },
          value: this.state.bio,
          onChange: (e) => this.setState({ bio: e.target.value })
        })
      ),
      React.createElement('div', { className: 'id-row' },
        React.createElement('button', {
          className: 'id-btn',
          disabled: this.state.nicknameBusy,
          onClick: () => this.saveProfile()
        }, this.state.nicknameBusy ? '…' : 'Save profile'),
        (this.state.nickname || this.state.bio || this.state.scHandle)
          ? React.createElement('button', {
            className: 'id-btn ghost',
            disabled: this.state.nicknameBusy,
            onClick: () => this.setState({ nickname: '', bio: '', scHandle: '' }, () => this.saveProfile())
          }, 'Clear')
          : null
      ),
      this.renderProfileActivity()
    );
  }

  renderProfileActivity () {
    const show = this.props.showProfileActivity !== false &&
      ActivityHeatmap.readShowProfileActivity();
    if (!show) return null;
    return React.createElement(ActivityHeatmap, {
      title: 'When you fly',
      subtitle: 'Same cumulative heatmap as Home → When you fly (this machine’s logs).',
      analytics: this.props.analytics || null
    });
  }

  renderPresence () {
    const shipCleared = !!(this.state.shipOverride &&
      (this.state.shipOverride.cleared || this.state.shipOverride.slug === '__none__'));
    const shipLabel = shipCleared
      ? null
      : ((this.state.shipOverride && (this.state.shipOverride.name || this.state.shipOverride.slug)) ||
        (this.state.detectedShip && (this.state.detectedShip.name || this.state.detectedShip.slug)) ||
        null);
    const busy = this.state.presenceBusy;
    return React.createElement('div', { className: 'id-sec' },
      React.createElement('h3', null, 'Online status',
        React.createElement('span', { className: 'id-tag ' + (this.state.presenceOnline ? 'on' : 'off') },
          this.state.presenceOnline ? 'online' : 'offline')),
      React.createElement('div', { className: 'd' },
        'Opt-in presence for peers, groups, and fleets. Auto uses Game.log activity (last 10 minutes); Online/Offline force the published state. ',
        'Ship is detected from quantum travel and vehicle-control lines.'),
      React.createElement('div', { className: 'id-field' },
        React.createElement('label', null, 'Availability'),
        React.createElement('select', {
          value: this.state.presenceAvailability || 'auto',
          disabled: busy,
          onChange: (e) => this.putPresence({ presenceAvailability: e.target.value })
        },
        React.createElement('option', { value: 'auto' }, 'Auto (Game.log activity)'),
        React.createElement('option', { value: 'online' }, 'Online'),
        React.createElement('option', { value: 'offline' }, 'Offline')
        )
      ),
      React.createElement('div', { className: 'id-field' },
        React.createElement('label', null, 'Status message'),
        React.createElement('div', { className: 'id-row', style: { marginTop: 0 } },
          React.createElement('input', {
            className: 'id-input',
            type: 'text',
            maxLength: 64,
            placeholder: 'Short status (optional)',
            value: this.state.statusDraft,
            disabled: busy,
            onChange: (e) => this.setState({ statusDraft: e.target.value }),
            onKeyDown: (e) => {
              if (e.key === 'Enter') this.putPresence({ presenceStatusText: this.state.statusDraft });
            }
          }),
          React.createElement('button', {
            className: 'id-btn ghost',
            disabled: busy,
            onClick: () => this.putPresence({ presenceStatusText: this.state.statusDraft })
          }, 'Set')
        )
      ),
      React.createElement('div', { className: 'id-row', style: { marginBottom: 10 } },
        shipCleared
          ? React.createElement('span', { style: { fontSize: 12, color: 'var(--muted)' } },
            'Ship cleared — not publishing a ship')
          : (shipLabel
            ? React.createElement('span', { style: { fontSize: 12.5 } },
              this.state.shipOverride ? 'Publishing ' : 'Autodetect ',
              React.createElement('b', null, shipLabel),
              this.state.shipOverride ? ' (override)' : '')
            : React.createElement('span', { style: { fontSize: 12, color: 'var(--muted)' } }, 'No ship detected yet'))
      ),
      React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 10 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.sharePresence,
          disabled: busy,
          onChange: (e) => this.putPresence({ sharePresence: e.target.checked })
        }),
        'Share online status (and published ship) on the Fabric mesh'
      ),
      React.createElement('div', { className: 'id-field' },
        React.createElement('label', null, 'Visibility'),
        React.createElement('select', {
          value: this.state.presenceVisibility,
          disabled: busy || !this.state.sharePresence,
          onChange: (e) => this.putPresence({ presenceVisibility: e.target.value })
        },
        React.createElement('option', { value: 'private' }, 'Private (local only)'),
        React.createElement('option', { value: 'peers' }, 'Peers'),
        React.createElement('option', { value: 'groups' }, 'Groups'),
        React.createElement('option', { value: 'public' }, 'Public (mesh + groups)')
        )
      ),
      (this.state.presenceVisibility === 'groups' || this.state.presenceVisibility === 'public')
        ? React.createElement('div', { style: { marginBottom: 10 } },
          React.createElement('div', { className: 'd', style: { marginBottom: 6 } },
            'Groups that receive your presence (empty = all groups you belong to):'),
          React.createElement('div', { className: 'id-groups' },
            !(this.state.groups || []).length
              ? React.createElement('span', { style: { fontSize: 12, color: 'var(--muted)' } }, 'No groups yet')
              : this.state.groups.map((g) => React.createElement('label', { key: g.id },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.presenceGroupIds.includes(g.id),
                  disabled: busy || !this.state.sharePresence,
                  onChange: () => {
                    const ids = this.state.presenceGroupIds.includes(g.id)
                      ? this.state.presenceGroupIds.filter((id) => id !== g.id)
                      : this.state.presenceGroupIds.concat([g.id]);
                    this.putPresence({ presenceGroupIds: ids });
                  }
                }),
                g.name || g.id
              ))
          )
        )
        : null,
      React.createElement('div', { className: 'id-field', style: { marginBottom: 0 } },
        React.createElement(ShipPicker, {
          label: 'Published ship',
          disabled: busy,
          overrideShip: this.state.shipOverride,
          detectedShip: this.state.detectedShip,
          onSelect: (slug) => this.setPublishedShip(slug)
        })
      )
    );
  }

  renderReveal () {
    const r = this.state.revealed;
    return React.createElement('div', { style: { marginTop: 14 } },
      React.createElement('h3', { style: { margin: '0 0 4px', fontSize: 13 } }, 'Recovery phrase'),
      React.createElement('div', { className: 'd' },
        'Re-enter your password to view the seed phrase or xprv — required even while unlocked, so an open app never exposes the seed.'),
      !r
        ? React.createElement('div', { className: 'id-row' },
          React.createElement('input', {
            className: 'id-input', type: 'password', placeholder: 'password',
            value: this.state.revealPassword,
            onChange: (e) => this.setState({ revealPassword: e.target.value }),
            onKeyDown: (e) => { if (e.key === 'Enter') this.reveal(); }
          }),
          React.createElement('button', { className: 'id-btn ghost', disabled: !this.state.revealPassword || this.state.busy, onClick: () => this.reveal() }, 'Reveal secrets')
        )
        : React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'id-warn' },
            'Anyone with these can permanently impersonate you. Never share them; never paste them into chat.'),
          r.mnemonic
            ? React.createElement(React.Fragment, null,
              React.createElement('div', { className: 'id-secret' + (this.state.showMnemonic ? '' : ' hidden') },
                this.state.showMnemonic ? r.mnemonic : 'Recovery phrase hidden — click Show to reveal.'),
              React.createElement('div', { className: 'id-row' },
                React.createElement('button', { className: 'id-btn ghost', onClick: () => this.setState({ showMnemonic: !this.state.showMnemonic }) },
                  this.state.showMnemonic ? 'Hide phrase' : 'Show phrase'),
                React.createElement('button', {
                  className: 'id-btn ghost', disabled: !this.state.showMnemonic,
                  title: this.state.showMnemonic ? undefined : 'Reveal the phrase first so you know what you are copying',
                  onClick: () => this.copy(r.mnemonic)
                }, 'Copy phrase')
              ))
            : null,
          React.createElement('div', { className: 'id-secret' + (this.state.showXprv ? '' : ' hidden') },
            this.state.showXprv ? r.xprv : 'Extended private key (xprv) hidden — click Show to reveal.'),
          React.createElement('div', { className: 'id-row' },
            React.createElement('button', { className: 'id-btn ghost', onClick: () => this.setState({ showXprv: !this.state.showXprv }) },
              this.state.showXprv ? 'Hide xprv' : 'Show xprv'),
            React.createElement('button', {
              className: 'id-btn ghost', disabled: !this.state.showXprv,
              title: this.state.showXprv ? undefined : 'Reveal the xprv first so you know what you are copying',
              onClick: () => this.copy(r.xprv)
            }, 'Copy xprv'),
            React.createElement('button', { className: 'id-btn ghost', onClick: () => this.setState({ revealed: null }) }, 'Done — hide all')
          )
        )
    );
  }

  renderBackup () {
    return React.createElement('div', { style: { marginTop: 14 } },
      React.createElement('h3', { style: { margin: '0 0 4px', fontSize: 13 } }, 'Encrypted backup'),
      React.createElement('div', { className: 'd' },
        'Download a password-sealed backup file (the key material stays encrypted with your password). ',
        'Restore it on another machine via "Import backup".'),
      React.createElement('div', { className: 'id-row' },
        React.createElement('input', {
          className: 'id-input', type: 'password', placeholder: 'password',
          value: this.state.backupPassword,
          onChange: (e) => this.setState({ backupPassword: e.target.value })
        }),
        React.createElement('button', {
          className: 'id-btn ghost', disabled: !this.state.backupPassword || this.state.busy,
          onClick: () => this.exportBackup()
        }, '⬇ Download encrypted backup')
      ),
      React.createElement('div', { className: 'id-row', style: { marginTop: 14 } },
        React.createElement('input', {
          className: 'id-input', type: 'password', placeholder: 'backup password',
          value: this.state.importPassword,
          onChange: (e) => this.setState({ importPassword: e.target.value })
        }),
        React.createElement('label', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--muted)', cursor: 'pointer' } },
          React.createElement('input', {
            type: 'checkbox',
            checked: this.state.importReplace,
            onChange: (e) => this.setState({ importReplace: e.target.checked })
          }),
          'replace existing'
        ),
        React.createElement('label', { className: 'id-btn ghost', style: { cursor: 'pointer' } },
          'Import backup…',
          React.createElement('input', {
            type: 'file', accept: '.json,application/json', style: { display: 'none' },
            disabled: !this.state.importPassword,
            onChange: (e) => this.importBackupFile(e.target.files && e.target.files[0])
          })
        )
      )
    );
  }

  renderForget () {
    return React.createElement('div', { style: { marginTop: 14 } },
      React.createElement('h3', { style: { margin: '0 0 4px', fontSize: 13 } }, 'Danger zone'),
      !this.state.confirmForget
        ? React.createElement('button', { className: 'id-btn danger', onClick: () => this.setState({ confirmForget: true, forgetText: '' }) }, 'Forget identity on this machine…')
        : React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'id-warn' },
            React.createElement('b', null, 'This deletes the encrypted key file from this machine. '),
            'The only way back is your seed phrase or a backup file. If you have neither, this identity — and your standing attached to it — is gone forever.'),
          React.createElement('div', { className: 'id-row' },
            React.createElement('input', {
              className: 'id-input', type: 'text', placeholder: 'type "forget" to confirm',
              value: this.state.forgetText,
              onChange: (e) => this.setState({ forgetText: e.target.value })
            }),
            React.createElement('button', {
              className: 'id-btn danger', disabled: this.state.forgetText !== 'forget',
              onClick: () => this.forget()
            }, 'Delete identity'),
            React.createElement('button', { className: 'id-btn ghost', onClick: () => this.setState({ confirmForget: false, forgetText: '' }) }, 'Cancel')
          )
        )
    );
  }

  render () {
    const info = this.state.info;
    return React.createElement('div', { className: 'id-overlay', onClick: (e) => { if (e.target === e.currentTarget) this.props.onClose(); } },
      React.createElement('div', { className: 'id-card' },
        React.createElement('div', { className: 'id-head' },
          React.createElement('h2', null, '🔑 Identity'),
          React.createElement('button', { className: 'id-x', title: 'Close', onClick: () => this.props.onClose() }, '✕')
        ),
        !bridge()
          ? React.createElement('div', { className: 'id-sec' },
            React.createElement('div', { className: 'd' }, 'Identity management runs in the desktop app — browser sessions are read-only.'))
          : !info
            ? React.createElement('div', { className: 'id-sec' }, 'loading…')
            : !info.exists
              ? React.createElement('div', { className: 'id-sec' },
                React.createElement('div', { className: 'd' }, 'No identity on this machine yet — restart the app to run onboarding, or import a backup below.'),
                this.renderBackup())
              : React.createElement(React.Fragment, null,
                this.renderUnlockBanner(),
                this.renderProfile(),
                this.renderPresence(),
                this.renderKeyTools()
              ),
        this.state.error ? React.createElement('div', { className: 'id-sec' }, React.createElement('div', { className: 'id-err' }, this.state.error)) : null,
        this.state.notice ? React.createElement('div', { className: 'id-sec' }, React.createElement('div', { className: 'id-ok' }, this.state.notice)) : null
      )
    );
  }
}

Identity.CSS = CSS;

module.exports = Identity;
