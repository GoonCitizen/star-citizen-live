'use strict';

/**
 * Identity — key management (Hub IdentityManager brought forward).
 * Desktop uses the overlay modal; Android and desktop `#signers` (Linked signers) use
 * `layout: 'page'` on `#keys` / `#signers` / `#security` / `#privacy`
 * (`components/Account.js`).
 *
 * Adapts hub.fabric.pub's identity safety model to the GoonCitizen desktop
 * and Android shells (plain React + IPC / Capacitor bridge):
 *   - lock / unlock with the encryption password; idle auto-lock timer
 *   - **Linked signers** (`components/LinkedSigners.js`): pair with Passport,
 *     another GoonCitizen, or a Hub through an invitation and a six-digit code;
 *     grants and revocations are signed Fabric Messages
 *   - account + network switcher: one sealed master key, each pair derives
 *     its own identity, wallet, and cosigner keys (locked: cached pairs only)
 *   - no seed or private key is ever shown after creation; backups are the
 *     sealed master key (password-sealed JSON file)
 *   - forget requires an explicit typed confirmation
 *
 * The plaintext key never enters the renderer: all operations go through
 * `window.electronAPI.identity` (Electron main, or the Android WebView polyfill).
 */

const React = require('react');
const ShipPicker = require('./ShipPicker');
const LocationPicker = require('./LocationPicker');
const BitcoinWalletPanel = require('./BitcoinWalletPanel');
const { isAndroidCompanion, androidSurface } = require('../functions/androidSurface');
const { setAndroidSecureFlag } = require('../functions/androidSecureScreen');
const { fetchPresence, putPresence, putPresenceShip } = require('../functions/presenceClient');
const LinkedSigners = require('./LinkedSigners');

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
  .id-qr{display:block;width:min(220px,72vw);height:auto;margin:10px auto;background:#fff;padding:10px;border-radius:8px}
  .id-link{font-family:'Cascadia Code',Consolas,monospace;font-size:11px;word-break:break-all;
    background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px 10px;margin:6px 0}
  .id-page{width:100%}
  .id-page .id-overlay{position:static;inset:auto;background:none;padding:0;display:block;
    backdrop-filter:none;align-items:stretch;justify-content:stretch}
  .id-page .id-card{width:100%;max-width:none;max-height:none;border:1px solid var(--line);
    border-radius:12px;overflow:visible}
  .id-page .id-head{position:static}
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
      // account switcher
      accountDraft: '',
      networkDraft: '',
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
      rsiClaim: null,
      rsiVerified: null,
      rsiVerifyBusy: false,
      nicknameBusy: false,
      // opt-in PeerPresence
      sharePresence: false,
      presenceVisibility: 'private',
      presenceGroupIds: [],
      shipOverrideSlug: null,
      presenceOnline: false,
      detectedShip: null,
      shipOverride: null,
      locationOverride: null,
      detectedLocation: null,
      destinationOverride: null,
      detectedDestination: null,
      groups: [],
      presenceBusy: false,
      presenceAvailability: 'auto',
      presenceStatusText: '',
      statusDraft: '',
      showKeyTools: this.props.section === 'keys',
      createPassword: '',
      createPassword2: '',
      createdMnemonic: null,
      createdAck: false
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
      this._unsub = b.onChanged((summary) => this.setState({ info: summary }));
    }
    this.syncSeedSecureFlag();
  }

  componentDidUpdate (_prevProps, prevState) {
    if (!!prevState.createdMnemonic !== !!this.state.createdMnemonic) {
      this.syncSeedSecureFlag();
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
    try {
      const claimRes = await fetch('/services/star-citizen/rsi/claim');
      if (claimRes.ok) {
        const claimJson = await claimRes.json();
        this.setState({
          rsiClaim: (claimJson.data && claimJson.data.claim) || null
        });
      }
    } catch (_) { /* claim optional until identity unlocked */ }
  }

  async verifyRsiOwnership () {
    const handle = String(this.state.scHandle || '').trim();
    if (!handle || this.state.rsiVerifyBusy) return;
    this.setState({ rsiVerifyBusy: true, error: null, notice: null, rsiVerified: null });
    try {
      const res = await fetch(
        '/services/star-citizen/rsi/citizens/' + encodeURIComponent(handle) + '/verify'
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const ownership = json.data || {};
      this.setState({
        rsiVerifyBusy: false,
        rsiVerified: ownership.verified === true,
        notice: ownership.verified
          ? ('RSI handle ' + handle + ' verified via ' + (ownership.claim || 'g00n claim') + '.')
          : ('RSI bio does not yet contain ' + (this.state.rsiClaim || 'your g00n claim') +
            '. Paste the token into your public RSI biography and try again.')
      });
    } catch (e) {
      this.setState({ rsiVerifyBusy: false, rsiVerified: false, error: e.message });
    }
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
      shipOverride: pd.shipOverride || null,
      locationOverride: pd.locationOverride || null,
      detectedLocation: pd.detectedLocation || null,
      destinationOverride: pd.destinationOverride || null,
      detectedDestination: pd.detectedDestination || null
    };
    this.setState(next);
    if (typeof this.props.onPresenceChange === 'function') {
      this.props.onPresenceChange({
        online: next.presenceOnline,
        sharePresence: next.sharePresence,
        availability: next.presenceAvailability,
        statusText: next.presenceStatusText || null,
        ship: (pd.presence && pd.presence.ship) || null,
        location: (pd.presence && pd.presence.location) || null,
        destination: (pd.presence && pd.presence.destination) || null,
        detectedShip: next.detectedShip,
        shipOverride: next.shipOverride,
        locationOverride: next.locationOverride,
        detectedLocation: next.detectedLocation,
        destinationOverride: next.destinationOverride,
        detectedDestination: next.detectedDestination
      });
    }
  }

  async loadPresence () {
    try {
      const [presenceRes, groupsRes] = await Promise.all([
        fetchPresence(),
        fetch('/services/star-citizen/groups').then((r) => (r.ok ? r.json() : { data: [] })).catch(() => ({ data: [] }))
      ]);
      const groups = Array.isArray(groupsRes.data) ? groupsRes.data : (Array.isArray(groupsRes) ? groupsRes : []);
      this.setState({ groups });
      if (presenceRes && presenceRes.ok && presenceRes.data) this.applyPresenceData(presenceRes.data);
    } catch (_) { /* ignore */ }
  }

  async putPresence (patch) {
    this.setState({ presenceBusy: true, error: null, notice: null });
    try {
      const posted = await putPresence(patch);
      if (!posted.ok) throw new Error(posted.error || 'presence update failed');
      this.setState({ presenceBusy: false });
      this.applyPresenceData(posted.data || {});
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
      const posted = await putPresenceShip(body);
      if (!posted.ok) throw new Error(posted.error || 'ship update failed');
      this.setState({ presenceBusy: false });
      this.applyPresenceData(posted.data || {});
    } catch (e) {
      this.setState({ presenceBusy: false, error: e.message });
    }
  }

  async setPublishedPlace (field, slug) {
    const key = field === 'destination' ? 'destinationOverrideSlug' : 'locationOverrideSlug';
    this.setState({ presenceBusy: true, error: null, notice: null });
    try {
      const posted = await putPresence({ [key]: slug === undefined ? null : slug });
      if (!posted.ok) throw new Error(posted.error || 'location update failed');
      this.setState({ presenceBusy: false });
      this.applyPresenceData(posted.data || {});
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
    setAndroidSecureFlag(false);
    if (this._unsub) this._unsub();
    if (this._presenceTimer) clearInterval(this._presenceTimer);
    // Never keep secrets in component state after close.
    this.setState({ unlockPassword: '', backupPassword: '', createdMnemonic: null });
  }

  syncSeedSecureFlag () {
    setAndroidSecureFlag(!!this.state.createdMnemonic);
  }

  async load () {
    const b = bridge();
    if (!b) { this.setState({ info: null }); return; }
    try {
      this.setState({ info: await b.get() });
    } catch (_) { /* bridge gone */ }
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
    this.setState({ notice: 'Locked — the key was cleared from memory.' });
    this.load();
  }

  async setAutoLock (minutes) {
    const res = await bridge().setAutoLock(minutes);
    if (res && !res.error) this.setState({ info: res });
  }

  async selectAccount (pair) {
    const b = bridge();
    if (!b || typeof b.selectAccount !== 'function' || this.state.busy) return;
    const account = Math.floor(Number(pair.account));
    if (!Number.isInteger(account) || account < 0 || account > 0x7fffffff) {
      this.setState({ error: 'Account must be a whole number, 0 or more.' });
      return;
    }
    this.setState({ busy: true, error: null, notice: null });
    const res = await b.selectAccount({ account, network: pair.network });
    if (res && res.error) return this.setState({ busy: false, error: res.error });
    this.setState({
      busy: false,
      info: res,
      accountDraft: '',
      networkDraft: '',
      notice: 'Switched to account ' + account + ' on ' + pair.network + '.'
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
    this.setState({
      confirmForget: false,
      forgetText: '',
      notice: isAndroidCompanion()
        ? 'Identity deleted from this device.'
        : 'Identity deleted from this machine.'
    });
    this.load();
    if (this.props.onForget) this.props.onForget();
  }

  copy (text) {
    try { navigator.clipboard.writeText(text); this.setState({ notice: 'Copied.' }); } catch (_) { /* clipboard unavailable */ }
  }

  async createOnDevice () {
    const p = this.state.createPassword;
    if (!p || p.length < 8 || p !== this.state.createPassword2 || this.state.busy) return;
    const b = bridge();
    if (!b || typeof b.create !== 'function') return;
    this.setState({ busy: true, error: null, notice: null });
    const res = await b.create(p);
    if (res.error) return this.setState({ busy: false, error: res.error });
    this.setState({
      busy: false,
      createPassword: '',
      createPassword2: '',
      createdMnemonic: res.mnemonic || null,
      createdAck: false,
      notice: 'Identity created on this device — write down the recovery phrase. This seed stays here; linking other apps does not copy it.'
    });
    this.load();
  }

  renderCreateIdentity () {
    const words = (this.state.createdMnemonic || '').trim().split(/\s+/).filter(Boolean);
    return React.createElement('div', { className: 'id-sec' },
      React.createElement('h3', null, 'Create identity on this device'),
      React.createElement('div', { className: 'd' },
        isAndroidCompanion()
          ? 'This device gets its own seed. Restore a phrase or backup if you already have one — then link desktop or Passport from Security. Do not copy the mnemonic onto them.'
          : 'This device gets its own seed. Link desktop and Passport afterwards — do not copy the mnemonic onto them.'),
      words.length
        ? React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'id-warn' },
            'Write these words down once. Anyone with them can impersonate you.'),
          React.createElement('div', { className: 'id-secret' }, this.state.createdMnemonic),
          React.createElement('label', { className: 'id-groups', style: { marginTop: 8 } },
            React.createElement('input', {
              type: 'checkbox',
              checked: this.state.createdAck === true,
              onChange: (e) => this.setState({ createdAck: e.target.checked })
            }),
            'I wrote down the recovery phrase'),
          React.createElement('div', { className: 'id-row' },
            React.createElement('button', {
              className: 'id-btn',
              disabled: !this.state.createdAck,
              onClick: () => this.setState({ createdMnemonic: null, createdAck: false })
            }, 'Done')
          )
        )
        : React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'id-row' },
            React.createElement('input', {
              className: 'id-input', type: 'password', placeholder: 'password (8+ characters)',
              value: this.state.createPassword,
              onChange: (e) => this.setState({ createPassword: e.target.value })
            })
          ),
          React.createElement('div', { className: 'id-row' },
            React.createElement('input', {
              className: 'id-input', type: 'password', placeholder: 'confirm password',
              value: this.state.createPassword2,
              onChange: (e) => this.setState({ createPassword2: e.target.value }),
              onKeyDown: (e) => { if (e.key === 'Enter') this.createOnDevice(); }
            }),
            React.createElement('button', {
              className: 'id-btn',
              disabled: this.state.busy ||
                !this.state.createPassword ||
                this.state.createPassword.length < 8 ||
                this.state.createPassword !== this.state.createPassword2,
              onClick: () => this.createOnDevice()
            }, this.state.busy ? '…' : 'Create identity')
          )
        )
    );
  }

  renderLinkedSigners (opts = {}) {
    const info = this.state.info || {};
    const page = opts.page === true;
    if (!page && !info.unlocked) return null;
    return React.createElement('div', { className: 'id-sec' },
      page ? null : React.createElement('h3', null, 'Linked signers'),
      React.createElement(LinkedSigners, {
        variant: page ? 'page' : 'embed',
        localPubkey: info.pubkey || '',
        invitation: this.props.invitation || null
      }),
      !page && typeof this.props.onOpenDevices === 'function'
        ? React.createElement('button', {
          type: 'button',
          className: 'id-btn ghost',
          style: { marginTop: 8 },
          onClick: () => this.props.onOpenDevices()
        }, 'Open linked signers')
        : null
    );
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
          onClick: () => this.setState({ showKeyTools: !open })
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
            'Accounts, backups, and recovery. Most day-to-day use stays in Profile and Online status above.'),
          this.renderKeyDetails(info),
          this.renderAccounts(),
          React.createElement('div', { className: 'id-row' },
            React.createElement('span', { style: { fontSize: 12, color: 'var(--muted)' } }, 'Auto-lock after idle'),
            React.createElement('select', {
              className: 'id-select',
              value: info.autoLockMinutes != null ? info.autoLockMinutes : 30,
              onChange: (e) => this.setAutoLock(Number(e.target.value))
            }, AUTOLOCK_OPTIONS.map(([v, label]) => React.createElement('option', { key: v, value: v }, label)))
          ),
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
          placeholder: 'RSI handle (citizens/…)',
          value: this.state.scHandle,
          onChange: (e) => this.setState({
            scHandle: e.target.value,
            rsiVerified: null
          })
        }),
        this.state.rsiClaim
          ? React.createElement('div', {
            className: 'd',
            style: { marginTop: 8, lineHeight: 1.45 }
          },
            'To prove this handle is yours, paste ',
            React.createElement('code', {
              style: { userSelect: 'all', cursor: 'pointer' },
              title: 'Click to copy',
              onClick: () => {
                const t = this.state.rsiClaim;
                if (t && typeof navigator !== 'undefined' && navigator.clipboard) {
                  navigator.clipboard.writeText(t).catch(() => {});
                }
              }
            }, this.state.rsiClaim),
            ' into your public RSI citizen biography, then verify.',
            this.state.rsiVerified === true
              ? React.createElement('span', {
                className: 'id-tag on',
                style: { marginLeft: 8 }
              }, 'verified')
              : (this.state.rsiVerified === false
                ? React.createElement('span', {
                  className: 'id-tag off',
                  style: { marginLeft: 8 }
                }, 'unverified')
                : null)
          )
          : null,
        this.state.scHandle && this.state.rsiClaim
          ? React.createElement('div', { className: 'id-row', style: { marginTop: 8 } },
            React.createElement('button', {
              type: 'button',
              className: 'id-btn ghost',
              disabled: this.state.rsiVerifyBusy || this.state.nicknameBusy,
              onClick: () => this.verifyRsiOwnership()
            }, this.state.rsiVerifyBusy ? 'Checking RSI…' : 'Verify on RSI')
          )
          : null
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
    if (!androidSurface('heatmap')) return null;
    const pk = this.state.info && this.state.info.pubkey;
    return React.createElement('div', { style: { marginTop: 12 } },
      pk
        ? React.createElement('div', { className: 'd' },
          'When you fly lives on ',
          React.createElement('a', { href: '/profiles/' + encodeURIComponent(pk) }, 'your profile'),
          ' (identity chip → My profile). Publish a weekday × hour grid to Federation groups from there.')
        : null,
      React.createElement('div', { className: 'd', style: { marginTop: 12, marginBottom: 0 } },
        'Pin files to this profile with 📌 on each file page. Installers pinned here are how other org leaders run this desktop from your identity — names, sizes, and prices, not the bytes.')
    );
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
        'Ship is detected from quantum travel and vehicle-control lines. Location and destination follow QT select / route / arrive (or set them here).'),
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
      this.props.offlineMode
        ? React.createElement('div', { className: 'd', style: { marginBottom: 10 } },
          'Offline Mode is on — presence stays on this machine.')
        : React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 10 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.sharePresence,
          disabled: busy,
          onChange: (e) => this.putPresence({ sharePresence: e.target.checked })
        }),
        'Share online status (and published ship) on the Fabric mesh'
      ),
      this.props.offlineMode ? null : React.createElement('div', { className: 'id-field' },
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
      !this.props.offlineMode && (this.state.presenceVisibility === 'groups' || this.state.presenceVisibility === 'public')
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
      ),
      React.createElement('div', { className: 'id-field' },
        React.createElement(LocationPicker, {
          label: 'Published location',
          noun: 'Location',
          disabled: busy,
          overridePlace: this.state.locationOverride,
          detectedPlace: this.state.detectedLocation,
          onSelect: (slug) => this.setPublishedPlace('location', slug)
        })
      ),
      React.createElement('div', { className: 'id-field', style: { marginBottom: 0 } },
        React.createElement(LocationPicker, {
          label: 'Published destination',
          noun: 'Destination',
          disabled: busy,
          overridePlace: this.state.destinationOverride,
          detectedPlace: this.state.detectedDestination,
          onSelect: (slug) => this.setPublishedPlace('destination', slug)
        })
      )
    );
  }

  renderKeyDetails (info, tag = false) {
    const wallet = info.wallet || {};
    return React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'id-kv' },
        React.createElement('b', null, 'pubkey (actor id) '), React.createElement('br'), info.pubkey || '—'),
      wallet.segwit
        ? React.createElement('div', { className: 'id-kv' },
          React.createElement('b', null, 'wallet '), React.createElement('br'),
          wallet.segwit.path + ' (SegWit, new addresses)',
          wallet.standard ? React.createElement('br') : null,
          wallet.standard ? wallet.standard.path + ' (standard, watched)' : null)
        : null,
      info.cosigner
        ? React.createElement('div', { className: 'id-kv' },
          React.createElement('b', null, 'multisig key (group wallets, escrow) '), React.createElement('br'), info.cosigner)
        : null,
      React.createElement('div', { className: 'id-row' },
        React.createElement('button', { className: 'id-btn ghost', onClick: () => this.copy(info.pubkey) }, 'Copy pubkey'),
        tag
          ? React.createElement('span', { className: 'id-tag ' + (info.unlocked ? 'on' : 'off') }, info.unlocked ? 'unlocked' : 'locked')
          : null
      )
    );
  }

  renderAccounts () {
    const info = this.state.info;
    if (!info || !info.exists) return null;
    const accounts = Array.isArray(info.accounts) ? info.accounts : [];
    const network = this.state.networkDraft || info.network || 'regtest';
    const draft = this.state.accountDraft;
    const draftOk = draft !== '' && Number.isInteger(Number(draft)) && Number(draft) >= 0;
    const cached = (a, n) => accounts.some((x) => x.account === a && x.network === n);
    const canSwitch = draftOk && (info.unlocked || cached(Number(draft), network));
    return React.createElement('div', { style: { marginTop: 14 } },
      React.createElement('h3', { style: { margin: '0 0 4px', fontSize: 13 } }, 'Account'),
      React.createElement('div', { className: 'd' },
        'One master key, many accounts. Each account and network has its own identity, wallet, and multisig key; the same account number on another network uses another path. ',
        info.unlocked ? null : 'Locked, you can switch only to accounts used before.'),
      React.createElement('div', { className: 'id-kv' },
        React.createElement('b', null, 'current '), React.createElement('br'),
        (info.label || ('Account ' + info.account)) + ' · ' + info.network),
      accounts.length > 1
        ? React.createElement('div', { className: 'id-row' },
          accounts.filter((a) => !a.current).map((a) => React.createElement('button', {
            key: a.network + ':' + a.account,
            className: 'id-btn ghost',
            disabled: this.state.busy,
            title: a.pubkey,
            onClick: () => this.selectAccount({ account: a.account, network: a.network })
          }, (a.label || ('Account ' + a.account)) + ' · ' + a.network)))
        : null,
      React.createElement('div', { className: 'id-row' },
        React.createElement('input', {
          className: 'id-input', type: 'number', min: 0, placeholder: 'account number',
          value: draft,
          style: { flex: '0 1 140px', minWidth: 120 },
          onChange: (e) => this.setState({ accountDraft: e.target.value })
        }),
        React.createElement('select', {
          className: 'id-select',
          value: network,
          onChange: (e) => this.setState({ networkDraft: e.target.value })
        }, ['mainnet', 'testnet', 'signet', 'regtest'].map((n) =>
          React.createElement('option', { key: n, value: n }, n))),
        React.createElement('button', {
          className: 'id-btn ghost',
          disabled: !canSwitch || this.state.busy,
          title: draftOk && !canSwitch ? 'Unlock to add this account' : undefined,
          onClick: () => this.selectAccount({ account: Number(draft), network })
        }, 'Switch')
      )
    );
  }

  renderBackup () {
    return React.createElement('div', { style: { marginTop: 14 } },
      React.createElement('h3', { style: { margin: '0 0 4px', fontSize: 13 } }, 'Encrypted backup'),
      React.createElement('div', { className: 'd' },
        'Download a backup file holding your master key, sealed with your password. ',
        isAndroidCompanion()
          ? 'Restore it here, or on desktop / another device, via Import backup.'
          : 'Restore it on another machine via "Import backup".'),
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
        ? React.createElement('button', { className: 'id-btn danger', onClick: () => this.setState({ confirmForget: true, forgetText: '' }) },
          isAndroidCompanion() ? 'Forget identity on this device…' : 'Forget identity on this machine…')
        : React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'id-warn' },
            React.createElement('b', null, isAndroidCompanion()
              ? 'This deletes the encrypted key from this device. '
              : 'This deletes the encrypted key file from this machine. '),
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

  renderKeySummary () {
    const info = this.state.info;
    if (!info) return null;
    return React.createElement('div', { className: 'id-sec' },
      React.createElement('h3', null, 'This device’s key'),
      React.createElement('div', { className: 'd' },
        'Pubkey is the actor id on the mesh. Funds and multisig use their own keys from the same master.'),
      this.renderKeyDetails(info, true),
      this.renderAccounts()
    );
  }

  renderFunds () {
    if (!androidSurface('associatedFunds')) return null;
    const info = this.state.info;
    return React.createElement('div', { className: 'id-sec' },
      React.createElement('h3', null, 'Associated funds'),
      React.createElement('div', { className: 'd' },
        'Balance, receive, and history for this account’s wallet (Hub Bitcoin proxy). New addresses are SegWit. Unlock to refresh.'),
      React.createElement(BitcoinWalletPanel, {
        identityPubkey: info && info.pubkey,
        identityLocked: !(info && info.unlocked),
        bitcoinEnable: true
      })
    );
  }

  renderLockRow () {
    const info = this.state.info;
    if (!info) return null;
    return React.createElement('div', { className: 'id-sec' },
      React.createElement('h3', null, 'Lock'),
      React.createElement('div', { className: 'd' },
        'Password encrypts the master key on this device. Auto-lock clears the unlocked session after idle time.'),
      React.createElement('div', { className: 'id-row', style: { marginTop: 0 } },
        info.unlocked
          ? React.createElement('button', { className: 'id-btn ghost', onClick: () => this.lock() }, '🔒 Lock now')
          : null,
        React.createElement('span', { style: { fontSize: 12, color: 'var(--muted)' } }, 'Auto-lock after idle'),
        React.createElement('select', {
          className: 'id-select',
          value: info.autoLockMinutes != null ? info.autoLockMinutes : 30,
          onChange: (e) => this.setAutoLock(Number(e.target.value))
        }, AUTOLOCK_OPTIONS.map(([v, label]) => React.createElement('option', { key: v, value: v }, label)))
      )
    );
  }

  renderBody () {
    const info = this.state.info;
    const section = this.props.section || 'all';
    if (!bridge()) {
      return React.createElement('div', { className: 'id-sec' },
        React.createElement('div', { className: 'd' },
          'Identity management runs in the GoonCitizen app — browser sessions without a local node are read-only.'));
    }
    if (!info) return React.createElement('div', { className: 'id-sec' }, 'loading…');
    if (!info.exists) {
      return React.createElement(React.Fragment, null,
        this.renderCreateIdentity(),
        React.createElement('div', { className: 'id-sec' }, this.renderBackup()));
    }
    if (section === 'keys') {
      return React.createElement(React.Fragment, null,
        this.renderUnlockBanner(),
        this.renderKeySummary(),
        this.renderFunds(),
        React.createElement('div', { className: 'id-sec' },
          React.createElement('h3', null, 'Recovery'),
          React.createElement('div', { className: 'd' },
            'Your seed phrase and derivation password rebuild every account; they are never shown again here. Export an encrypted backup, or restore one here.'),
          this.renderBackup()
        ),
        isAndroidCompanion()
          ? React.createElement('div', { className: 'id-sec' }, this.renderForget())
          : null
      );
    }
    if (section === 'signers') {
      return React.createElement(React.Fragment, null,
        this.renderUnlockBanner(),
        this.renderLinkedSigners({ page: true })
      );
    }
    if (section === 'security') {
      return React.createElement(React.Fragment, null,
        this.renderUnlockBanner(),
        this.renderLockRow(),
        this.renderLinkedSigners(),
        React.createElement('div', { className: 'id-sec' }, this.renderForget())
      );
    }
    if (section === 'privacy') {
      return React.createElement(React.Fragment, null,
        this.renderUnlockBanner(),
        this.renderProfile(),
        this.renderPresence()
      );
    }
    return React.createElement(React.Fragment, null,
      this.renderUnlockBanner(),
      this.renderLinkedSigners(),
      this.renderProfile(),
      this.renderPresence(),
      this.renderKeyTools()
    );
  }

  render () {
    const page = this.props.layout === 'page';
    const section = this.props.section || 'all';
    const titles = {
      keys: '🔑 Keys',
      signers: '🔗 Linked signers',
      security: '🛡️ Security',
      privacy: '🔒 Privacy',
      all: '🔑 Identity'
    };
    const inner = React.createElement('div', { className: 'id-card' },
      page
        ? null
        : React.createElement('div', { className: 'id-head' },
          React.createElement('h2', null, titles[section] || titles.all),
          React.createElement('button', {
            className: 'id-x',
            title: 'Close',
            onClick: () => this.props.onClose && this.props.onClose()
          }, '✕')
        ),
      this.renderBody(),
      this.state.error ? React.createElement('div', { className: 'id-sec' }, React.createElement('div', { className: 'id-err' }, this.state.error)) : null,
      this.state.notice ? React.createElement('div', { className: 'id-sec' }, React.createElement('div', { className: 'id-ok' }, this.state.notice)) : null
    );
    if (page) return React.createElement('div', { className: 'id-page' }, inner);
    return React.createElement('div', {
      className: 'id-overlay',
      onClick: (e) => {
        if (e.target === e.currentTarget && this.props.onClose) this.props.onClose();
      }
    }, inner);
  }
}

Identity.CSS = CSS + '\n' + (BitcoinWalletPanel.CSS || '') + '\n' + (LinkedSigners.CSS || '');

module.exports = Identity;
