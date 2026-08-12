'use strict';

/**
 * Settings modal — operator relay settings.
 *
 * Mirrors the Hub's settings surface (`GET /settings`, `PUT /settings/:name`).
 * Opens with a Privacy overview (egress chips + masters); the same toggles also
 * remain under Relay, Fabric Network, Identity, Peers, and Desktop notifications.
 * Peer management lives under Network → Peers (`components/Peers.js`),
 * revealed via the "Advanced mode" toggle here (client-only preference).
 */

const React = require('react');
const { showDesktopNotification, ensureNotifyPermission } = require('../functions/desktopNotify');

const CSS = `
  .st-overlay{position:fixed;inset:0;z-index:40;background:rgba(8,10,14,.7);
    display:flex;align-items:flex-start;justify-content:center;padding:60px 16px 30px;backdrop-filter:blur(2px)}
  .st-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;
    width:min(640px,94vw);max-height:84vh;overflow:auto}
  .st-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);
    position:sticky;top:0;background:var(--panel);z-index:1}
  .st-head h2{margin:0;font-size:16px;flex:1}
  .st-x{background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;padding:2px 8px}
  .st-x:hover{color:var(--text)}
  .st-sec{padding:14px 18px;border-bottom:1px solid var(--line)}
  .st-sec h3{margin:0 0 4px;font-size:13px}
  .st-sec .d{color:var(--muted);font-size:12px;margin-bottom:10px}
  .st-field{display:grid;gap:5px;margin-bottom:10px}
  .st-field label{font-size:12px;color:var(--muted)}
  .st-field input{width:100%;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:8px 10px;font-size:13px;box-sizing:border-box;
    font-family:'Cascadia Code',Consolas,monospace}
  .st-row{display:flex;gap:8px;align-items:center}
  .st-btn{background:var(--accent);border:none;color:#fff;border-radius:7px;padding:7px 14px;
    font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}
  .st-btn:disabled{opacity:.45;cursor:default}
  .st-btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
  .st-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:8px 11px;font-size:12.5px;margin-bottom:10px}
  .st-ok{background:rgba(63,185,80,.12);color:var(--good);border-radius:7px;padding:8px 11px;font-size:12.5px;margin-bottom:10px}
  .st-note{background:rgba(210,153,34,.12);color:var(--warn);border-radius:7px;padding:8px 11px;font-size:12.5px;margin-top:10px}
  .st-runtime{color:var(--muted);font-size:11.5px;display:grid;gap:3px;
    font-family:'Cascadia Code',Consolas,monospace}
  .st-runtime b{color:var(--text);font-weight:600}
  .st-privacy-strip{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px}
  .st-chip{font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;
    border:1px solid var(--line);background:var(--panel2);color:var(--muted)}
  .st-chip.on{border-color:rgba(63,185,80,.45);color:var(--good);background:rgba(63,185,80,.08)}
  .st-chip.warn{border-color:rgba(210,153,34,.45);color:var(--warn);background:rgba(210,153,34,.08)}
  .st-devices{display:grid;gap:6px;margin-top:8px}
  .st-device{display:flex;gap:8px;align-items:center;justify-content:space-between;
    background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px}
  .st-device .id{font-family:'Cascadia Code',Consolas,monospace;color:var(--muted);font-size:11px}
  .gear{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:7px;
    padding:5px 11px;font-size:14px;cursor:pointer;line-height:1}
  .gear:hover{border-color:var(--accent)}
`;

class Settings extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      loading: true,
      error: null,
      notice: null,
      editable: false,
      requiresRestart: false,
      runtime: {},
      logfile: '',
      channel: '',
      httpSharedMode: false,
      snapshotsEnabled: false,
      snapshotIntervalSeconds: 10,
      snapshotAutoPurge: true,
      snapshotMaxMB: 256,
      shareLogsGlobal: false,
      fabricAdvertiseHost: '',
      broadcastPeering: false,
      notifyDesktop: true,
      notifyChatGlobal: true,
      notifyChatGroups: true,
      notifyWhenFocused: false,
      notifyMissionBroadcasts: true,
      groupOverlay: false,
      primaryGroupId: null,
      primaryGroupColor: null,
      defaultGroupMessageId: null,
      defaultGroupPaste: '',
      defaultGroupSnippet: null,
      peerCount: 0,
      groupChatSeal: false,
      requireSealedGroupChat: false,
      sharePresence: false,
      presenceVisibility: 'private',
      linkedDevices: [],
      fabricReady: false,
      fabricConnected: 0,
      discordBotEnable: false,
      discordAppId: '',
      discordChannel: '',
      discordToken: '',
      discordAppSecret: '',
      discordWebhook: '',
      discordAnnounceKills: true,
      discordAnnouncePlayerJoins: true,
      discordAnnounceActivities: false,
      discordAnnounceMissions: false,
      discordAnnounceCombat: false,
      discordAnnounceIncaps: false,
      discordRuntime: null,
      busy: false
    };
  }

  componentDidMount () {
    this.load();
  }

  async load () {
    this.setState({ loading: true, error: null });
    try {
      const [settingsRes, peersRes] = await Promise.all([
        fetch('/settings').then((r) => r.json()),
        fetch('/peers').then((r) => (r.ok ? r.json() : { data: [] })).catch(() => ({ data: [] }))
      ]);
      const s = settingsRes.settings || {};
      this.setState({
        loading: false,
        editable: !!settingsRes.editable,
        requiresRestart: !!settingsRes.requiresRestart,
        runtime: settingsRes.runtime || {},
        logfile: s.logfile || '',
        channel: s.channel || '',
        snapshotsEnabled: !!s.snapshotsEnabled,
        snapshotIntervalSeconds: s.snapshotIntervalSeconds || 10,
        snapshotAutoPurge: s.snapshotAutoPurge !== false,
        snapshotMaxMB: s.snapshotMaxMB || 256,
        shareLogsGlobal: s.shareLogsGlobal === true || (settingsRes.runtime && settingsRes.runtime.shareLogsGlobal === true),
        httpSharedMode: s.httpSharedMode === true || (settingsRes.runtime && settingsRes.runtime.httpSharedMode === true),
        fabricAdvertiseHost: s.fabricAdvertiseHost || (settingsRes.runtime && settingsRes.runtime.fabricAdvertiseHost) || '',
        broadcastPeering: s.broadcastPeering === true || (settingsRes.runtime && settingsRes.runtime.broadcastPeering === true),
        notifyDesktop: s.notifyDesktop !== false,
        notifyChatGlobal: s.notifyChatGlobal !== false,
        notifyChatGroups: s.notifyChatGroups !== false,
        notifyWhenFocused: !!s.notifyWhenFocused,
        notifyMissionBroadcasts: s.notifyMissionBroadcasts !== false,
        groupOverlay: s.groupOverlay === true || (settingsRes.runtime && settingsRes.runtime.groupOverlay === true),
        primaryGroupId: s.primaryGroupId || (settingsRes.runtime && settingsRes.runtime.primaryGroupId) || null,
        primaryGroupColor: (settingsRes.runtime && settingsRes.runtime.primaryGroupColor) || null,
        defaultGroupMessageId: (settingsRes.runtime && settingsRes.runtime.defaultGroupMessageId) || null,
        peerCount: Array.isArray(peersRes.data) ? peersRes.data.length : 0,
        groupChatSeal: s.groupChatSeal === true || (settingsRes.runtime && settingsRes.runtime.groupChatSeal === true),
        requireSealedGroupChat: s.requireSealedGroupChat === true ||
          (settingsRes.runtime && settingsRes.runtime.requireSealedGroupChat === true),
        sharePresence: s.sharePresence === true || (settingsRes.runtime && settingsRes.runtime.sharePresence === true),
        presenceVisibility: s.presenceVisibility ||
          (settingsRes.runtime && settingsRes.runtime.presenceVisibility) || 'private',
        linkedDevices: Array.isArray(s.linkedDevices) ? s.linkedDevices : [],
        fabricReady: !!(settingsRes.runtime && settingsRes.runtime.fabricReady),
        fabricConnected: Number(settingsRes.runtime && settingsRes.runtime.fabricConnected) || 0,
        discordBotEnable: s.discordBotEnable === true,
        discordAppId: s.discordAppId || (settingsRes.runtime && settingsRes.runtime.discord && settingsRes.runtime.discord.appId) || '',
        discordChannel: s.discordChannel || (settingsRes.runtime && settingsRes.runtime.discord && settingsRes.runtime.discord.channel) || '',
        discordAnnounceKills: s.discordAnnounceKills !== false,
        discordAnnouncePlayerJoins: s.discordAnnouncePlayerJoins !== false,
        discordAnnounceActivities: s.discordAnnounceActivities === true,
        discordAnnounceMissions: s.discordAnnounceMissions === true,
        discordAnnounceCombat: s.discordAnnounceCombat === true,
        discordAnnounceIncaps: s.discordAnnounceIncaps === true,
        discordRuntime: (settingsRes.runtime && settingsRes.runtime.discord) || null,
        discordToken: '',
        discordAppSecret: '',
        discordWebhook: ''
      });
    } catch (e) {
      this.setState({ loading: false, error: e.message });
    }
  }

  async saveDiscordSecrets () {
    this.setState({ busy: true, error: null, notice: null });
    try {
      const body = {};
      if (String(this.state.discordToken || '').trim()) body.token = String(this.state.discordToken).trim();
      if (String(this.state.discordAppSecret || '').trim()) body.appSecret = String(this.state.discordAppSecret).trim();
      if (String(this.state.discordWebhook || '').trim()) body.webhook = String(this.state.discordWebhook).trim();
      const res = await fetch('/settings/discord/secrets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      this.setState({
        busy: false,
        notice: 'Discord credentials saved (store root only — not in git).',
        discordToken: '',
        discordAppSecret: '',
        discordWebhook: '',
        discordRuntime: (json.runtime && json.runtime.discord) || this.state.discordRuntime
      });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async putNotify (key, value) {
    this.setState({ [key]: value, error: null });
    try {
      await this.put(key, value);
    } catch (err) {
      this.setState({ error: err.message });
    }
  }

  async putBool (key, value) {
    const prev = this.state[key];
    this.setState({ [key]: value, error: null, busy: true });
    try {
      await this.put(key, value);
      this.setState({ busy: false });
      await this.load();
    } catch (err) {
      this.setState({ busy: false, [key]: prev, error: err.message });
    }
  }

  async revokeLinkedDevice (peerFabricId) {
    const id = String(peerFabricId || '');
    if (!id) return;
    const next = (this.state.linkedDevices || []).filter((d) => {
      const pid = d && (d.peerFabricId || d.pubkey || d.id);
      return String(pid || '') !== id;
    });
    this.setState({ linkedDevices: next, busy: true, error: null });
    try {
      await this.put('linkedDevices', next);
      this.setState({ busy: false });
      await this.load();
    } catch (err) {
      this.setState({ busy: false, error: err.message });
      await this.load();
    }
  }

  privacyChip (label, on, warn) {
    return React.createElement('span', {
      className: 'st-chip' + (on ? ' on' : '') + (warn ? ' warn' : ''),
      title: label
    }, label);
  }

  renderPrivacy () {
    const peerUp = this.state.fabricReady || this.state.fabricConnected > 0;
    const logsOn = this.state.shareLogsGlobal === true;
    const presenceOn = this.state.sharePresence === true;
    const lanOn = this.state.httpSharedMode === true;
    const announceOn = this.state.broadcastPeering === true;
    const sealOn = this.state.groupChatSeal === true;
    const devices = this.state.linkedDevices || [];

    return React.createElement('div', { className: 'st-sec', id: 'settings-privacy' },
      React.createElement('h3', null, 'Privacy'),
      React.createElement('div', { className: 'd' },
        'What can leave this machine. Same controls also live under Relay, Fabric Network, Identity, Peers, and Desktop notifications — this panel is the overview.'),
      React.createElement('div', { className: 'st-privacy-strip' },
        this.privacyChip(peerUp ? 'chat → mesh when peer up' : 'chat idle (peer down)', peerUp, true),
        this.privacyChip(peerUp ? 'missions → mesh when peer up' : 'missions idle', peerUp, true),
        this.privacyChip(
          presenceOn
            ? ('presence → ' + (this.state.presenceVisibility || 'peers'))
            : 'presence private',
          presenceOn
        ),
        this.privacyChip(logsOn ? 'game logs → all peers' : 'game logs private', logsOn),
        this.privacyChip(lanOn ? 'dashboard LAN' : 'dashboard local only', lanOn),
        this.privacyChip(announceOn ? 'peering announce on' : 'peering announce off', announceOn),
        this.privacyChip(sealOn ? 'group chat sealed' : 'group chat cleartext at relays', sealOn, !sealOn)
      ),
      React.createElement('div', { className: 'd', style: { marginBottom: 12 } },
        'Chat, mission offers, and your profile nickname publish on the Fabric mesh whenever your peer is connected — unlike game logs, which stay private until you authorize sharing.'),

      React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.httpSharedMode,
          disabled: !this.state.editable || this.state.busy,
          onChange: (e) => this.putBool('httpSharedMode', e.target.checked)
        }),
        'Allow LAN access to the dashboard'
      ),
      React.createElement('div', { className: 'd', style: { marginTop: -4, marginBottom: 10 } },
        'Also under Relay. Off = 127.0.0.1 only.'),

      React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.shareLogsGlobal,
          disabled: !this.state.editable || this.state.busy,
          onChange: (e) => this.putBool('shareLogsGlobal', e.target.checked)
        }),
        'Share game logs with every connected peer'
      ),
      React.createElement('div', { className: 'd', style: { marginTop: -4, marginBottom: 10 } },
        'Default off. Prefer per-peer “Share logs” on Network → Peers. Also under Fabric Network.'),
      React.createElement('div', { className: 'st-row', style: { marginBottom: 12 } },
        React.createElement('button', {
          type: 'button',
          className: 'st-btn ghost',
          onClick: () => {
            this.props.onClose();
            window.location.hash = 'network/peers';
          }
        }, 'Open Peers (per-peer log share)')),

      this.field('Advertise host (public hostname)', 'fabricAdvertiseHost', 'e.g. relay.example.com'),
      React.createElement('div', { className: 'st-row', style: { marginTop: -4, marginBottom: 10 } },
        React.createElement('button', {
          type: 'button',
          className: 'st-btn ghost',
          style: { padding: '3px 10px', fontSize: 11 },
          disabled: !this.state.editable || this.state.busy,
          onClick: async () => {
            this.setState({ busy: true, error: null });
            try {
              await this.put('fabricAdvertiseHost', String(this.state.fabricAdvertiseHost || '').trim() || null);
              this.setState({ busy: false });
              await this.load();
            } catch (err) {
              this.setState({ busy: false, error: err.message });
            }
          }
        }, 'Save advertise host')
      ),
      React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 10 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.broadcastPeering,
          disabled: !this.state.editable || this.state.busy,
          onChange: (e) => this.putBool('broadcastPeering', e.target.checked)
        }),
        'Announce open peer slots on the mesh'
      ),

      React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.sharePresence,
          disabled: !this.state.editable || this.state.busy,
          onChange: (e) => this.putBool('sharePresence', e.target.checked)
        }),
        'Share online presence (status / ship) on the mesh'
      ),
      React.createElement('div', { className: 'st-field', style: { marginBottom: 10 } },
        React.createElement('label', null, 'Presence audience'),
        React.createElement('select', {
          value: this.state.presenceVisibility || 'private',
          disabled: !this.state.editable || this.state.busy || !this.state.sharePresence,
          style: {
            width: '100%', background: 'var(--bg)', border: '1px solid var(--line)',
            color: 'var(--text)', borderRadius: 7, padding: '8px 10px', fontSize: 13
          },
          onChange: async (e) => {
            const value = e.target.value;
            this.setState({ presenceVisibility: value, busy: true, error: null });
            try {
              await this.put('presenceVisibility', value);
              this.setState({ busy: false });
              await this.load();
            } catch (err) {
              this.setState({ busy: false, error: err.message });
            }
          }
        },
        ['private', 'peers', 'groups', 'public'].map((v) =>
          React.createElement('option', { key: v, value: v }, v))
        )
      ),
      React.createElement('div', { className: 'st-row', style: { marginBottom: 12 } },
        React.createElement('button', {
          type: 'button',
          className: 'st-btn ghost',
          onClick: () => {
            if (typeof this.props.onOpenIdentity === 'function') {
              this.props.onClose();
              this.props.onOpenIdentity();
            }
          }
        }, 'Open Identity (profile & presence detail)')),

      React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.groupChatSeal,
          disabled: !this.state.editable || this.state.busy,
          onChange: (e) => this.putBool('groupChatSeal', e.target.checked)
        }),
        'Seal outbound group chat (hub-blind)'
      ),
      React.createElement('div', { className: 'd', style: { marginTop: -4, marginBottom: 8 } },
        'When on, group messages are encrypted for members so relays cannot read the body.'),
      React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 12 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.requireSealedGroupChat,
          disabled: !this.state.editable || this.state.busy,
          onChange: (e) => this.putBool('requireSealedGroupChat', e.target.checked)
        }),
        'Require sealed group chat (drop cleartext inbound)'
      ),

      React.createElement('h3', { style: { marginTop: 4, fontSize: 12.5 } }, 'Notifications (attention)'),
      React.createElement('div', { className: 'd' },
        'Same toggles as Desktop notifications below — here for privacy of attention, not mesh egress.'),
      React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.notifyDesktop,
          disabled: !this.state.editable || this.state.busy,
          onChange: (e) => this.putNotify('notifyDesktop', e.target.checked)
        }),
        'Enable desktop notifications'
      ),
      React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.notifyChatGlobal,
          disabled: !this.state.editable || this.state.busy || !this.state.notifyDesktop,
          onChange: (e) => this.putNotify('notifyChatGlobal', e.target.checked)
        }),
        'Global chat'
      ),
      React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.notifyChatGroups,
          disabled: !this.state.editable || this.state.busy || !this.state.notifyDesktop,
          onChange: (e) => this.putNotify('notifyChatGroups', e.target.checked)
        }),
        'Group chat'
      ),
      React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 12 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.notifyMissionBroadcasts,
          disabled: !this.state.editable || this.state.busy || !this.state.notifyDesktop,
          onChange: (e) => this.putNotify('notifyMissionBroadcasts', e.target.checked)
        }),
        'Mission broadcasts'
      ),

      React.createElement('div', { className: 'd', style: { marginBottom: 6 } },
        'Screen snapshots stay on this machine (Library). Toggle under Snapshots. Discord mirror uses env ',
        React.createElement('code', null, 'DISCORD_WEBHOOK_URL'),
        ' only — never stored in the Fabric Store.'),

      React.createElement('h3', { style: { marginTop: 10, fontSize: 12.5 } }, 'Linked devices'),
      React.createElement('div', { className: 'd' },
        'Devices you approved via fabric://link. Revoking removes the local attestation record.'),
      devices.length
        ? React.createElement('div', { className: 'st-devices' },
          devices.map((d, i) => {
            const pid = (d && (d.peerFabricId || d.pubkey || d.id)) || '';
            const label = (d && (d.label || d.name)) || 'device';
            return React.createElement('div', { className: 'st-device', key: pid || ('dev-' + i) },
              React.createElement('div', null,
                React.createElement('div', null, label),
                React.createElement('div', { className: 'id' },
                  pid ? (String(pid).slice(0, 16) + '…') : '—')
              ),
              React.createElement('button', {
                type: 'button',
                className: 'st-btn ghost',
                style: { padding: '3px 10px', fontSize: 11 },
                disabled: !this.state.editable || this.state.busy || !pid,
                onClick: () => this.revokeLinkedDevice(pid)
              }, 'Revoke')
            );
          })
        )
        : React.createElement('div', { className: 'd', style: { marginBottom: 0 } }, 'No linked devices yet.')
    );
  }

  async toggleGroupOverlay (enabled) {
    this.setState({ groupOverlay: enabled, error: null });
    try {
      await this.put('groupOverlay', enabled);
      if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.setGroupOverlay === 'function') {
        await window.electronAPI.setGroupOverlay(enabled);
      }
    } catch (err) {
      this.setState({ error: err.message, groupOverlay: !enabled });
    }
  }

  async applyDefaultGroupFromPaste () {
    const paste = String(this.state.defaultGroupPaste || '').trim();
    if (!paste || this.state.busy) return;
    this.setState({ busy: true, error: null, notice: null });
    try {
      const res = await fetch('/settings/primaryGroup/from-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: paste, apply: true })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const data = json.data || {};
      const rt = json.runtime || {};
      this.setState({
        busy: false,
        primaryGroupId: data.groupId || rt.primaryGroupId || null,
        primaryGroupColor: data.primaryColor || rt.primaryGroupColor || null,
        defaultGroupSnippet: data.localJsSnippet || null,
        notice: 'Primary group set from Fabric message. Copy the snippet below into settings/local.js to pin it across restarts.'
      });
      if (typeof this.props.onPrimaryGroupTheme === 'function') {
        this.props.onPrimaryGroupTheme(data.primaryColor || rt.primaryGroupColor || null);
      }
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async copyDefaultGroupSnippet () {
    const text = this.state.defaultGroupSnippet;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ notice: 'local.js snippet copied.' });
    } catch (_) {
      this.setState({ notice: text });
    }
  }

  async testNotify () {
    const perm = await ensureNotifyPermission();
    if (perm === 'denied' || perm === 'unsupported') {
      this.setState({ error: perm === 'unsupported'
        ? 'Desktop notifications are not available in this environment'
        : 'Notification permission denied — enable it in your OS / browser settings' });
      return;
    }
    const ok = await showDesktopNotification({
      title: 'GoonCitizen',
      body: 'Desktop notifications are working.'
    });
    if (!ok) this.setState({ error: 'Could not show a test notification' });
  }

  async put (name, value) {
    const res = await fetch(`/settings/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: value === '' ? null : value })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  async save () {
    if (this.state.busy || !this.state.editable) return;
    this.setState({ busy: true, error: null });
    try {
      await this.put('logfile', this.state.logfile.trim() || null);
      await this.put('channel', this.state.channel.trim() || null);
      this.setState({ busy: false, requiresRestart: true });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  /** Snapshot settings apply live (no relay restart). */
  async saveSnapshots () {
    if (this.state.busy || !this.state.editable) return;
    this.setState({ busy: true, error: null });
    try {
      const interval = Math.max(2, Math.floor(Number(this.state.snapshotIntervalSeconds) || 10));
      const maxMB = Math.max(16, Math.floor(Number(this.state.snapshotMaxMB) || 256));
      await this.put('snapshotsEnabled', !!this.state.snapshotsEnabled);
      await this.put('snapshotIntervalSeconds', interval);
      await this.put('snapshotAutoPurge', !!this.state.snapshotAutoPurge);
      await this.put('snapshotMaxMB', maxMB);
      this.setState({ busy: false, snapshotIntervalSeconds: interval, snapshotMaxMB: maxMB });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async restart () {
    if (window.electronAPI && window.electronAPI.restartService) {
      await window.electronAPI.restartService();
    }
  }

  field (label, key, placeholder, hint) {
    return React.createElement('div', { className: 'st-field' },
      React.createElement('label', null, label),
      React.createElement('input', {
        type: 'text',
        value: this.state[key],
        placeholder: placeholder || '',
        onChange: (e) => this.setState({ [key]: e.target.value })
      }),
      hint ? React.createElement('span', { style: { fontSize: 11, color: 'var(--muted)' } }, hint) : null
    );
  }

  async pickLogFile () {
    if (!(window.electronAPI && window.electronAPI.dialog && window.electronAPI.dialog.openLogFile)) return;
    try {
      const result = await window.electronAPI.dialog.openLogFile();
      if (!result || result.canceled || !result.path) return;
      this.setState({ logfile: result.path });
    } catch (e) {
      this.setState({ error: e.message || String(e) });
    }
  }

  render () {
    const rt = this.state.runtime;
    return React.createElement('div', { className: 'st-overlay', onClick: (e) => { if (e.target === e.currentTarget) this.props.onClose(); } },
      React.createElement('div', { className: 'st-card' },
        React.createElement('div', { className: 'st-head' },
          React.createElement('h2', null, '⚙️ Settings'),
          React.createElement('button', { className: 'st-x', title: 'Close', onClick: () => this.props.onClose() }, '✕')
        ),
        this.state.loading
          ? React.createElement('div', { className: 'st-sec' }, 'loading…')
          : React.createElement(React.Fragment, null,
            this.state.error ? React.createElement('div', { className: 'st-sec' }, React.createElement('div', { className: 'st-err' }, this.state.error)) : null,
            this.state.notice ? React.createElement('div', { className: 'st-sec' }, React.createElement('div', { className: 'st-ok' }, this.state.notice)) : null,

            this.renderPrivacy(),

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Relay'),
              React.createElement('div', { className: 'd' }, 'Where the game log comes from. Leave blank to auto-detect the freshest Game.log across drives and channels. To import historical log folders or individual files, use Network → Feed → Import logs.'),
              this.field('Game.log path', 'logfile', 'auto-detect (e.g. C:\\...\\StarCitizen\\LIVE\\Game.log)'),
              (window.electronAPI && window.electronAPI.dialog && window.electronAPI.dialog.openLogFile)
                ? React.createElement('div', { className: 'st-row', style: { marginTop: -4, marginBottom: 10 } },
                  React.createElement('button', {
                    type: 'button', className: 'st-btn ghost',
                    style: { padding: '3px 10px', fontSize: 11 },
                    disabled: !this.state.editable || this.state.busy,
                    onClick: () => this.pickLogFile()
                  }, 'Browse for Game.log…')
                )
                : null,
              this.field('Channel', 'channel', 'auto (LIVE / PTU / EPTU / HOTFIX / TECH-PREVIEW)'),
              React.createElement('div', { className: 'd', style: { marginBottom: 10 } },
                'Discord: configure the local bot below (or set env ',
                React.createElement('code', null, 'DISCORD_BOT_TOKEN'),
                ' / ',
                React.createElement('code', null, 'DISCORD_WEBHOOK_URL'),
                '). Secrets are not stored in the Fabric Store.'),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 10 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.httpSharedMode,
                  disabled: !this.state.editable || this.state.busy,
                  onChange: async (e) => {
                    const value = e.target.checked;
                    this.setState({ httpSharedMode: value, busy: true, error: null });
                    try {
                      await this.put('httpSharedMode', value);
                      this.setState({ busy: false });
                      await this.load();
                    } catch (err) {
                      this.setState({ busy: false, httpSharedMode: !value, error: err.message });
                    }
                  }
                }),
                'Allow LAN access to the dashboard (bind all interfaces)'
              ),
              React.createElement('div', { className: 'd', style: { marginTop: -4, marginBottom: 10 } },
                'Off by default — the dashboard listens on 127.0.0.1 only. Enable only when you want other machines on your network to open this UI (firewall permitting). Hosted server mode always binds all interfaces. Override with FABRIC_HUB_INTERFACE.'),
              React.createElement('div', { className: 'st-row' },
                React.createElement('button', { className: 'st-btn', disabled: !this.state.editable || this.state.busy, onClick: () => this.save() }, this.state.busy ? 'Saving…' : 'Save'),
                !this.state.editable ? React.createElement('span', { style: { fontSize: 11.5, color: 'var(--muted)' } }, 'read-only: no settings directory configured') : null
              ),
              this.state.requiresRestart
                ? React.createElement('div', { className: 'st-note' },
                  'Saved. Log settings apply after a restart. ',
                  (window.electronAPI && window.electronAPI.restartService)
                    ? React.createElement('button', { className: 'st-btn ghost', style: { marginLeft: 8, padding: '3px 10px', fontSize: 11 }, onClick: () => this.restart() }, 'Restart relay now')
                    : 'Restart the relay to apply.')
                : null
            ),

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Discord bot'),
              React.createElement('div', { className: 'd' },
                'Local ',
                React.createElement('code', null, '@fabric/discord'),
                ' bot for announcements and Fabric-coordinated replies (DiscordRequest → Claim → Response). Multiple operators of the same Discord app race claims so only one replies; auditors open Fabric Messages → View tree. Create an application at Discord Developer Portal, invite the bot, then paste Application ID + Bot token here (or in ',
                React.createElement('code', null, 'settings/local.js'),
                ').'),
              this.state.discordRuntime
                ? React.createElement('div', { className: 'st-runtime', style: { marginBottom: 10 } },
                  React.createElement('div', null, 'mode ', React.createElement('b', null, this.state.discordRuntime.mode || 'off')),
                  React.createElement('div', null, 'bot ',
                    React.createElement('b', null, this.state.discordRuntime.botReady
                      ? ('ready' + (this.state.discordRuntime.botUser ? ` (${this.state.discordRuntime.botUser})` : ''))
                      : (this.state.discordRuntime.botConfigured ? 'configured' : 'off'))),
                  React.createElement('div', null, 'webhook ',
                    React.createElement('b', null, this.state.discordRuntime.webhookConfigured ? 'set' : 'none')))
                : null,
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 10 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.discordBotEnable,
                  disabled: !this.state.editable || this.state.busy,
                  onChange: (e) => this.putBool('discordBotEnable', e.target.checked)
                }),
                'Enable Discord integration'
              ),
              this.field('Application ID', 'discordAppId', 'Discord application / client id'),
              this.field('Announce channel ID', 'discordChannel', 'snowflake channel id for embeds'),
              React.createElement('div', { className: 'st-row', style: { marginBottom: 10 } },
                React.createElement('button', {
                  className: 'st-btn ghost',
                  disabled: !this.state.editable || this.state.busy,
                  onClick: async () => {
                    this.setState({ busy: true, error: null });
                    try {
                      await this.put('discordAppId', String(this.state.discordAppId || '').trim() || null);
                      await this.put('discordChannel', String(this.state.discordChannel || '').trim() || null);
                      this.setState({ busy: false, notice: 'Discord app/channel saved.' });
                      await this.load();
                    } catch (err) {
                      this.setState({ busy: false, error: err.message });
                    }
                  }
                }, 'Save app / channel')
              ),
              React.createElement('div', { className: 'st-field' },
                React.createElement('label', null, 'Bot token'),
                React.createElement('input', {
                  type: 'password',
                  autoComplete: 'off',
                  placeholder: this.state.discordRuntime && this.state.discordRuntime.botConfigured
                    ? '(unchanged — paste to replace)'
                    : 'Bot token from Discord Developer Portal',
                  value: this.state.discordToken,
                  disabled: !this.state.editable || this.state.busy,
                  onChange: (e) => this.setState({ discordToken: e.target.value })
                })
              ),
              React.createElement('div', { className: 'st-field' },
                React.createElement('label', null, 'Client secret (OAuth, optional)'),
                React.createElement('input', {
                  type: 'password',
                  autoComplete: 'off',
                  placeholder: '(optional)',
                  value: this.state.discordAppSecret,
                  disabled: !this.state.editable || this.state.busy,
                  onChange: (e) => this.setState({ discordAppSecret: e.target.value })
                })
              ),
              React.createElement('div', { className: 'st-field' },
                React.createElement('label', null, 'Webhook URL (fallback mirror)'),
                React.createElement('input', {
                  type: 'password',
                  autoComplete: 'off',
                  placeholder: this.state.discordRuntime && this.state.discordRuntime.webhookConfigured
                    ? '(unchanged — paste to replace)'
                    : 'https://discord.com/api/webhooks/…',
                  value: this.state.discordWebhook,
                  disabled: !this.state.editable || this.state.busy,
                  onChange: (e) => this.setState({ discordWebhook: e.target.value })
                })
              ),
              React.createElement('div', { className: 'st-row', style: { marginBottom: 10 } },
                React.createElement('button', {
                  className: 'st-btn',
                  disabled: !this.state.editable || this.state.busy,
                  onClick: () => this.saveDiscordSecrets()
                }, this.state.busy ? 'Saving…' : 'Save Discord secrets')
              ),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, cursor: 'pointer', marginBottom: 6 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.discordAnnounceKills,
                  disabled: !this.state.editable || this.state.busy,
                  onChange: (e) => this.putBool('discordAnnounceKills', e.target.checked)
                }),
                'Announce kills'
              ),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, cursor: 'pointer', marginBottom: 6 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.discordAnnouncePlayerJoins,
                  disabled: !this.state.editable || this.state.busy,
                  onChange: (e) => this.putBool('discordAnnouncePlayerJoins', e.target.checked)
                }),
                'Announce player joins'
              ),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, cursor: 'pointer', marginBottom: 6 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.discordAnnounceActivities,
                  disabled: !this.state.editable || this.state.busy,
                  onChange: (e) => this.putBool('discordAnnounceActivities', e.target.checked)
                }),
                'Announce activities'
              ),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, cursor: 'pointer', marginBottom: 6 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.discordAnnounceMissions,
                  disabled: !this.state.editable || this.state.busy,
                  onChange: (e) => this.putBool('discordAnnounceMissions', e.target.checked)
                }),
                'Announce mission objectives'
              )
            ),

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Snapshots'),
              React.createElement('div', { className: 'd' },
                'Opt-in periodic screen captures while you play — stored reduced-size in the Library for later image analysis. Desktop app only; applies live.'),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 10 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.snapshotsEnabled,
                  onChange: (e) => this.setState({ snapshotsEnabled: e.target.checked })
                }),
                'Capture snapshots of my screen while GoonCitizen runs'
              ),
              React.createElement('div', { className: 'st-row', style: { flexWrap: 'wrap' } },
                React.createElement('label', { style: { fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' } },
                  'every',
                  React.createElement('input', {
                    type: 'number', min: 2, max: 3600, value: this.state.snapshotIntervalSeconds,
                    style: { width: 70, background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 7, padding: '6px 8px' },
                    onChange: (e) => this.setState({ snapshotIntervalSeconds: e.target.value })
                  }),
                  'seconds'
                ),
                React.createElement('label', { style: { fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' } },
                  React.createElement('input', {
                    type: 'checkbox',
                    checked: this.state.snapshotAutoPurge,
                    onChange: (e) => this.setState({ snapshotAutoPurge: e.target.checked })
                  }),
                  'auto-purge oldest beyond'
                ),
                React.createElement('label', { style: { fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' } },
                  React.createElement('input', {
                    type: 'number', min: 16, max: 65536, value: this.state.snapshotMaxMB,
                    style: { width: 80, background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 7, padding: '6px 8px' },
                    onChange: (e) => this.setState({ snapshotMaxMB: e.target.value })
                  }),
                  'MB'
                ),
                React.createElement('button', { className: 'st-btn', disabled: !this.state.editable || this.state.busy, onClick: () => this.saveSnapshots() }, 'Apply')
              ),
              rt.snapshots
                ? React.createElement('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginTop: 8 } },
                  `${rt.snapshots.count} stored · ${(rt.snapshots.bytes / (1024 * 1024)).toFixed(1)} MB`,
                  rt.snapshots.enabled && !rt.snapshots.available ? ' · capture needs the desktop app' : '',
                  rt.snapshots.lastError ? ` · last error: ${rt.snapshots.lastError}` : '',
                  ' · view in the Library tab')
                : null
            ),

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Primary group overlay'),
              React.createElement('div', { className: 'd' },
                'Pin your primary group’s members and ships in a small always-on-top panel (top-right). Designed for Windows while Star Citizen is focused — clicks pass through to the game. Pick a primary group on the Groups tab, or paste a Fabric message id below.'),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.groupOverlay,
                  disabled: !this.state.editable || this.state.busy,
                  onChange: (e) => this.toggleGroupOverlay(e.target.checked)
                }),
                'Show primary-group overlay (desktop)'
              ),
              React.createElement('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 } },
                this.state.primaryGroupId
                  ? ('Primary group id: ' + String(this.state.primaryGroupId).slice(0, 12) + '…' +
                    (this.state.primaryGroupColor ? (' · accent ' + this.state.primaryGroupColor) : ''))
                  : 'No primary group set yet — open Groups → Set as primary, or paste a message id.'),
              React.createElement('div', { className: 'd', style: { marginTop: 4 } },
                'Paste a Fabric message id (from Groups → Share / Fabric Messages → Copy id), an opaque fabric:<hex> GroupOffer, or a group id. Applies as the Store primary group and shows a settings/local.js snippet.'),
              React.createElement('div', { className: 'st-row', style: { alignItems: 'stretch' } },
                React.createElement('input', {
                  type: 'text',
                  value: this.state.defaultGroupPaste,
                  disabled: !this.state.editable || this.state.busy,
                  placeholder: 'fabric:<hex> · message hash · group id',
                  style: { flex: 1, minWidth: 0, background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 7, padding: '8px 10px', fontSize: 12, fontFamily: "Cascadia Code, Consolas, monospace" },
                  onChange: (e) => this.setState({ defaultGroupPaste: e.target.value })
                }),
                React.createElement('button', {
                  className: 'st-btn',
                  disabled: !this.state.editable || this.state.busy || !String(this.state.defaultGroupPaste || '').trim(),
                  onClick: () => this.applyDefaultGroupFromPaste()
                }, 'Set as default')
              ),
              this.state.defaultGroupSnippet
                ? React.createElement('div', { style: { marginTop: 10 } },
                  React.createElement('pre', {
                    style: {
                      margin: 0, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)',
                      borderRadius: 8, fontSize: 11.5, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all'
                    }
                  }, this.state.defaultGroupSnippet),
                  React.createElement('button', {
                    className: 'st-btn ghost',
                    style: { marginTop: 8 },
                    type: 'button',
                    onClick: () => this.copyDefaultGroupSnippet()
                  }, 'Copy for settings/local.js')
                )
                : (this.state.defaultGroupMessageId
                  ? React.createElement('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginTop: 8 } },
                    'Booted with settings/local.js defaultGroupMessageId (truncated): ',
                    String(this.state.defaultGroupMessageId).slice(0, 48),
                    String(this.state.defaultGroupMessageId).length > 48 ? '…' : '')
                  : null)
            ),

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Identity & presence'),
              React.createElement('div', { className: 'd' },
                'Nickname, Star Citizen handle, bio, and online status (ship sharing) live on the identity card in the header — click your key / nickname pill.'),
              React.createElement('div', { className: 'st-row' },
                React.createElement('button', {
                  className: 'st-btn ghost',
                  type: 'button',
                  onClick: () => {
                    if (typeof this.props.onOpenIdentity === 'function') {
                      this.props.onClose();
                      this.props.onOpenIdentity();
                    }
                  }
                }, 'Open Identity')
              )
            ),

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Desktop notifications'),
              React.createElement('div', { className: 'd' },
                'OS notifications for new chat messages. The global chat dock stays available on every tab; the Chat page still covers all channels.'),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.notifyDesktop,
                  disabled: !this.state.editable || this.state.busy,
                  onChange: (e) => this.putNotify('notifyDesktop', e.target.checked)
                }),
                'Enable desktop notifications'
              ),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.notifyChatGlobal,
                  disabled: !this.state.editable || this.state.busy || !this.state.notifyDesktop,
                  onChange: (e) => this.putNotify('notifyChatGlobal', e.target.checked)
                }),
                'Global chat messages'
              ),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.notifyChatGroups,
                  disabled: !this.state.editable || this.state.busy || !this.state.notifyDesktop,
                  onChange: (e) => this.putNotify('notifyChatGroups', e.target.checked)
                }),
                'Group chat messages'
              ),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.notifyWhenFocused,
                  disabled: !this.state.editable || this.state.busy || !this.state.notifyDesktop,
                  onChange: (e) => this.putNotify('notifyWhenFocused', e.target.checked)
                }),
                'Notify even when this window is focused'
              ),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 10 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.notifyMissionBroadcasts,
                  disabled: !this.state.editable || this.state.busy || !this.state.notifyDesktop,
                  onChange: (e) => this.putNotify('notifyMissionBroadcasts', e.target.checked)
                }),
                'Mission broadcasts from peers (Accept / Ignore)'
              ),
              React.createElement('div', { className: 'st-row' },
                React.createElement('button', {
                  className: 'st-btn ghost',
                  disabled: this.state.busy,
                  onClick: () => this.testNotify()
                }, 'Send test notification')
              )
            ),

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Profile activity'),
              React.createElement('div', { className: 'd' },
                'Show the Home “When you fly” activity heatmap on Identity and peer profiles. Uses the same cumulative analytics as the stats pages. Stored in this browser.'),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.props.showProfileActivity !== false,
                  onChange: (e) => {
                    if (typeof this.props.onShowProfileActivityChange === 'function') {
                      this.props.onShowProfileActivityChange(e.target.checked);
                    }
                  }
                }),
                'Show activity graph on player profiles'
              )
            ),

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Advanced mode'),
              React.createElement('div', { className: 'd' },
                'Reveal advanced Network → Messages (complete AMP wire Message log — Fabric Messages only, not Game.log), Home views (Activity Tree, Parser rules), and the Files tab (Hub Document Exchange). Stored in this browser.'),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: !!this.props.advancedMode,
                  onChange: (e) => {
                    if (typeof this.props.onAdvancedModeChange === 'function') {
                      this.props.onAdvancedModeChange(e.target.checked);
                    }
                  }
                }),
                'Enable advanced mode (Network Messages + Home tools)'
              )
            ),

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Fabric Network'),
              React.createElement('div', { className: 'd' },
                'Native Fabric TCP/NOISE only (pubkey@host:port). Seeds hub.fabric.pub:7777 and relay.goon.vc:7777 are the default rendezvous. Set a public advertise host so others can dial you; announce open slots only when you opt in.'),
              this.field('Advertise host (public hostname)', 'fabricAdvertiseHost', 'e.g. relay.example.com — no port; listen uses fabricPort'),
              React.createElement('div', { className: 'st-row', style: { marginTop: -4, marginBottom: 10 } },
                React.createElement('button', {
                  type: 'button',
                  className: 'st-btn ghost',
                  style: { padding: '3px 10px', fontSize: 11 },
                  disabled: !this.state.editable || this.state.busy,
                  onClick: async () => {
                    this.setState({ busy: true, error: null });
                    try {
                      await this.put('fabricAdvertiseHost', String(this.state.fabricAdvertiseHost || '').trim() || null);
                      this.setState({ busy: false });
                      await this.load();
                    } catch (err) {
                      this.setState({ busy: false, error: err.message });
                    }
                  }
                }, 'Save advertise host')
              ),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 10 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.broadcastPeering,
                  disabled: !this.state.editable || this.state.busy,
                  onChange: async (e) => {
                    const value = e.target.checked;
                    this.setState({ broadcastPeering: value });
                    try { await this.put('broadcastPeering', value); } catch (err) { this.setState({ error: err.message }); }
                  }
                }),
                'Announce open peer slots on the Fabric mesh (P2P_PEERING_OFFER)'
              ),
              React.createElement('div', { className: 'd', style: { marginTop: -4, marginBottom: 10 } },
                'Off by default. Requires advertise host. Network → Peers can also force a one-shot announce.'),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 10 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.shareLogsGlobal,
                  disabled: !this.state.editable || this.state.busy,
                  onChange: async (e) => {
                    const value = e.target.checked;
                    this.setState({ shareLogsGlobal: value });
                    try { await this.put('shareLogsGlobal', value); } catch (err) { this.setState({ error: err.message }); }
                  }
                }),
                'Share logs to global — push my parsed game events to every connected Fabric peer'
              ),
              React.createElement('div', { className: 'd', style: { marginTop: -4, marginBottom: 10 } },
                'Default is off. Per-peer “Share logs” on Network → Peers is the usual path for authorizing a network hub.'),
              React.createElement('div', { className: 'st-row' },
                React.createElement('span', { style: { fontSize: 12.5, color: 'var(--muted)' } },
                  this.state.peerCount
                    ? `${this.state.peerCount} peer${this.state.peerCount === 1 ? '' : 's'} configured`
                    : 'no peers configured'),
                React.createElement('button', {
                  className: 'st-btn ghost',
                  onClick: () => {
                    this.props.onClose();
                    window.location.hash = 'network/peers';
                  }
                }, 'Open Network'),
                this.props.advancedMode
                  ? React.createElement('button', {
                    className: 'st-btn ghost',
                    onClick: () => {
                      this.props.onClose();
                      window.location.hash = 'network/messages';
                    }
                  }, 'Fabric Messages')
                  : null
              )
            ),

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Runtime'),
              React.createElement('div', { className: 'st-runtime' },
                React.createElement('span', null, 'log: ', React.createElement('b', null, rt.logfile || 'not found (auto-detect)')),
                React.createElement('span', null, 'channel: ', React.createElement('b', null, rt.channel || '—'), '  ·  port: ', React.createElement('b', null, rt.port || '—')),
                React.createElement('span', null, 'http bind: ', React.createElement('b', null, rt.httpHost || '—'),
                  rt.httpSharedMode ? ' (LAN shared)' : ''),
                React.createElement('span', null, 'identity: ', React.createElement('b', null, rt.identity ? rt.identity.slice(0, 16) + '…' : 'locked / none')),
                React.createElement('span', null, 'event queue: ', React.createElement('b', null, rt.uplinkActive ? `active (${rt.uplinkQueued} queued)` : 'idle'))
              )
            )
          )
      )
    );
  }
}

Settings.CSS = CSS;

module.exports = Settings;
