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
const { isAndroidCompanion } = require('../functions/isAndroidCompanion');
const { postIdentityCrossSign, fetchIdentityCluster } = require('../functions/identityCrossSignClient');
const DataSyncStatus = require('./DataSyncStatus');
const groupVoiceSettings = require('../functions/groupVoiceSettings');
const VoiceSettingsPanel = require('./VoiceSettingsPanel');
const { discordBotAuthorizeUrl } = require('../functions/discordBotAuthorize');

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
  .st-auth-link{color:#5865F2;font-weight:650}
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
  .st-embedded{background:var(--panel);border:1px solid var(--line);border-radius:10px;
    overflow:hidden;margin:12px 18px 24px}
  .st-embedded .st-sec:last-child{border-bottom:none}
` + (VoiceSettingsPanel.CSS || '');

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
      fabricShareEncoding: 'base64',
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
      identityCluster: null,
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
      shareDiscordCatalog: false,
      discordRuntime: null,
      voice: groupVoiceSettings.defaultVoiceSettings(),
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
        fabricShareEncoding: (s.fabricShareEncoding === 'hex' ||
          (settingsRes.runtime && settingsRes.runtime.fabricShareEncoding === 'hex'))
          ? 'hex'
          : 'base64',
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
        identityCluster: null,
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
        shareDiscordCatalog: s.shareDiscordCatalog === true ||
          !!(settingsRes.runtime && settingsRes.runtime.shareDiscordCatalog === true),
        discordRuntime: (settingsRes.runtime && settingsRes.runtime.discord) || null,
        voice: groupVoiceSettings.sanitizeVoiceSettings(s.voice),
        discordToken: '',
        discordAppSecret: '',
        discordWebhook: ''
      });
      try {
        const cluster = await fetchIdentityCluster(window.location.origin);
        if (cluster.ok) this.setState({ identityCluster: cluster.data });
      } catch (_) { /* optional */ }
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

  async putVoice (patch) {
    const next = groupVoiceSettings.sanitizeVoiceSettings(Object.assign({}, this.state.voice, patch));
    this.setState({ voice: next, error: null });
    groupVoiceSettings.applyElectronPttBind(next);
    try {
      await this.put('voice', next);
    } catch (err) {
      this.setState({ error: err.message });
    }
  }

  renderVoice () {
    const v = this.state.voice || groupVoiceSettings.defaultVoiceSettings();
    return React.createElement('div', { className: 'st-sec', id: 'settings-voice' },
      React.createElement('h3', null, 'Voice'),
      React.createElement(VoiceSettingsPanel, {
        voice: v,
        disabled: !this.state.editable || this.state.busy,
        onChange: (patch) => this.putVoice(patch)
      })
    );
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
    if (value === true) {
      const confirms = {
        shareLogsGlobal:
          'Share parsed Game.log events with EVERY connected Fabric peer?\n\nPrefer per-peer “Share logs” on Network → Peers when possible.',
        shareDiscordCatalog:
          'Gossip Discord/chat catalog packs to Federation groups you belong to?\n\nPeers in those groups will see compact server/people/message packs from this node.',
        httpSharedMode:
          'Allow other machines on the LAN to open this dashboard?\n\nRemote reads/writes need a signed login; loopback on this machine still uses your unlocked identity.',
        requireSealedGroupChat:
          'Drop inbound group chat that is not sealed?\n\nPeers still sending cleartext GroupChat will be silent here until they enable sealing.'
      };
      if (confirms[key] && typeof window !== 'undefined' && window.confirm &&
          !window.confirm(confirms[key])) {
        return;
      }
    }
    if (value === false && key === 'groupChatSeal') {
      if (typeof window !== 'undefined' && window.confirm &&
          !window.confirm(
            'Turn off sealed group chat?\n\nOutbound group messages will be cleartext at relays again. Sealed GroupChat is the recommended path for confidential contract messaging.'
          )) {
        return;
      }
    }
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

  async putShareEncoding (value) {
    const next = value === 'hex' ? 'hex' : 'base64';
    const prev = this.state.fabricShareEncoding;
    this.setState({ fabricShareEncoding: next, error: null, busy: true });
    try {
      await this.put('fabricShareEncoding', next);
      this.setState({ busy: false });
    } catch (err) {
      this.setState({ busy: false, fabricShareEncoding: prev, error: err.message });
    }
  }

  async revokeLinkedDevice (peerFabricId) {
    const id = String(peerFabricId || '');
    if (!id) return;
    const match = (this.state.linkedDevices || []).find((d) => {
      const pid = d && (d.peerFabricId || d.pubkey || d.id || d.peerPubkey);
      return String(pid || '') === id;
    });
    const next = (this.state.linkedDevices || []).filter((d) => {
      const pid = d && (d.peerFabricId || d.pubkey || d.id || d.peerPubkey);
      return String(pid || '') !== id;
    });
    this.setState({ busy: true, error: null });
    try {
      const nonce = match && match.nonce;
      const peerPubkey = (match && (match.peerPubkey || match.pubkey)) || id;
      if (!nonce) {
        throw new Error('No pairing nonce on file — unlock this identity and complete fabric://link again before revoking.');
      }
      const posted = await postIdentityCrossSign(window.location.origin, {
        type: 'IdentityCrossSignRevoke',
        peerPubkey,
        nonce
      });
      if (!posted.ok) {
        throw new Error(posted.error || 'Could not publish IdentityCrossSignRevoke. Unlock this identity, then retry.');
      }
      await this.put('linkedDevices', next);
      this.setState({ linkedDevices: next, busy: false });
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
    const cluster = this.state.identityCluster;
    const clusterMembers = (cluster && Array.isArray(cluster.members) && cluster.members.length > 1)
      ? cluster.members
      : null;
    const devices = clusterMembers
      ? clusterMembers.map((pk) => {
        const local = (this.state.linkedDevices || []).find((d) => {
          const pid = d && (d.peerFabricId || d.pubkey || d.peerPubkey || d.id);
          return String(pid || '') === pk || (d && d.peerPubkey === pk);
        });
        return local || { peerFabricId: pk, peerPubkey: pk, label: 'cluster device' };
      })
      : (this.state.linkedDevices || []);

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
        isAndroidCompanion() ? null : this.privacyChip(logsOn ? 'game logs → all peers' : 'game logs private', logsOn),
        isAndroidCompanion() ? null : this.privacyChip(lanOn ? 'dashboard LAN' : 'dashboard local only', lanOn),
        this.privacyChip(announceOn ? 'peering announce on' : 'peering announce off', announceOn),
        this.privacyChip(sealOn ? 'group chat sealed' : 'group chat cleartext at relays', sealOn, !sealOn)
      ),
      React.createElement('div', { className: 'd', style: { marginBottom: 12 } },
        'Chat, mission offers, and your profile nickname publish on the Fabric mesh whenever your peer is connected — unlike game logs, which stay private until you authorize sharing.'),

      isAndroidCompanion() ? null : React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.httpSharedMode,
          disabled: !this.state.editable || this.state.busy,
          onChange: (e) => this.putBool('httpSharedMode', e.target.checked)
        }),
        'Allow LAN access to the dashboard'
      ),
      isAndroidCompanion() ? null : React.createElement('div', { className: 'd', style: { marginTop: -4, marginBottom: 10 } },
        'Also under Relay. Off = 127.0.0.1 only. When on, other machines can open this UI; writes from those hosts need a signed login (same bar as hosted server mode). Loopback on this machine still uses your unlocked identity.'),

      isAndroidCompanion() ? null : React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.shareLogsGlobal,
          disabled: !this.state.editable || this.state.busy,
          onChange: (e) => this.putBool('shareLogsGlobal', e.target.checked)
        }),
        'Share game logs with every connected peer'
      ),
      isAndroidCompanion() ? null : React.createElement('div', { className: 'd', style: { marginTop: -4, marginBottom: 10 } },
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
              this.props.onOpenIdentity('privacy');
            }
          }
        }, isAndroidCompanion()
          ? 'Open Privacy (profile & presence)'
          : 'Open Identity (profile & presence detail)')),

      React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.groupChatSeal,
          disabled: !this.state.editable || this.state.busy,
          onChange: (e) => this.putBool('groupChatSeal', e.target.checked)
        }),
        'Seal outbound group chat (recommended — hub-blind)'
      ),
      React.createElement('div', { className: 'd', style: { marginTop: -4, marginBottom: 8 } },
        'Recommended for private ops. When on, GroupChat CONTRACT_MESSAGE bodies are encrypted for members (relays cannot read). Global mesh shoutbox stays cleartext by design — use sealed groups or onion SendOnion for confidential traffic. Sealed chat is the first wave for future contract messaging; peering/gossip remains the primary mesh fabric.'),
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
        'Public shoutbox'
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
        'Peer-equivalent identity cluster. Add a device here to show a QR, or scan one from the header QR button. After both approve, account data replays over Fabric both ways. Revoke publishes an IdentityCrossSignRevoke Fabric Message (BIP340) — a stolen device stays you until another cluster member revokes.'),
      React.createElement(DataSyncStatus, {
        variant: 'panel',
        onAddDevice: () => {
          if (typeof this.props.onOpenIdentity === 'function') {
            if (typeof this.props.onClose === 'function') this.props.onClose();
            this.props.onOpenIdentity('security');
          }
        }
      }),
      React.createElement('div', { className: 'st-row', style: { marginBottom: 10 } },
        React.createElement('button', {
          type: 'button',
          className: 'st-btn',
          onClick: () => {
            if (typeof this.props.onOpenIdentity === 'function') {
              if (typeof this.props.onClose === 'function') this.props.onClose();
              this.props.onOpenIdentity('security');
            }
          }
        }, 'Add a device')
      ),
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

  renderLanBindSection () {
    return React.createElement('div', { className: 'st-sec' },
      React.createElement('h3', null, 'HTTP / LAN'),
      React.createElement('div', { className: 'd' },
        'Bind the dashboard for other machines on your network. Off by default — loopback only.'),
      React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 10 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.httpSharedMode,
          disabled: !this.state.editable || this.state.busy,
          onChange: (e) => this.putBool('httpSharedMode', e.target.checked)
        }),
        'Allow LAN access to the dashboard (bind all interfaces)'
      ),
      React.createElement('div', { className: 'd', style: { marginTop: -4 } },
        'LAN writes require a Schnorr/Bearer session; loopback still uses the unlocked identity. Hosted server mode always binds all interfaces. Override with FABRIC_HUB_INTERFACE.')
    );
  }

  renderFabricNetworkSection (opts = {}) {
    const embedded = opts.embedded === true;
    const encodingName = embedded ? 'fabricShareEncoding-net' : 'fabricShareEncoding';
    const openNetwork = (view) => {
      if (typeof this.props.onOpenNetwork === 'function') {
        this.props.onOpenNetwork(view || 'peers');
        return;
      }
      if (typeof this.props.onClose === 'function') this.props.onClose();
      if (typeof window !== 'undefined') {
        window.location.hash = view === 'messages' ? 'network/messages' : 'network/peers';
      }
    };
    return React.createElement('div', { className: 'st-sec' },
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
            if (value === true && typeof window !== 'undefined' && window.confirm &&
                !window.confirm(
                  'Publish P2P_PEERING_OFFER on the mesh?\n\nPeers can learn you have open slots and (with advertise host) a dialable address tied to your key.'
                )) {
              return;
            }
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
          onChange: (e) => this.putBool('shareLogsGlobal', e.target.checked)
        }),
        'Share logs to global — push my parsed game events to every connected Fabric peer'
      ),
      React.createElement('div', { className: 'd', style: { marginTop: -4, marginBottom: 10 } },
        'Default is off. Per-peer “Share logs” on Network → Peers is the usual path for authorizing a network hub.'),
      React.createElement('h3', { style: { margin: '14px 0 4px', fontSize: 13 } }, 'Share encoding'),
      React.createElement('div', { className: 'd' },
        'Groups → Share copies an opaque Fabric message as ',
        React.createElement('code', null, 'fabric:'),
        ' plus the raw body. Default is base64; hex is still sniffed on Import.'),
      React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 6 } },
        React.createElement('input', {
          type: 'radio',
          name: encodingName,
          checked: this.state.fabricShareEncoding !== 'hex',
          disabled: !this.state.editable || this.state.busy,
          onChange: () => this.putShareEncoding('base64')
        }),
        'base64 body (default)'
      ),
      React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 10 } },
        React.createElement('input', {
          type: 'radio',
          name: encodingName,
          checked: this.state.fabricShareEncoding === 'hex',
          disabled: !this.state.editable || this.state.busy,
          onChange: () => this.putShareEncoding('hex')
        }),
        'hex body'
      ),
      React.createElement('div', { className: 'st-row' },
        React.createElement('span', { style: { fontSize: 12.5, color: 'var(--muted)' } },
          this.state.peerCount
            ? `${this.state.peerCount} peer${this.state.peerCount === 1 ? '' : 's'} configured`
            : 'no peers configured'),
        React.createElement('button', {
          className: 'st-btn ghost',
          onClick: () => openNetwork('peers')
        }, embedded ? 'Open Peers' : 'Open Network'),
        this.props.advancedMode
          ? React.createElement('button', {
            className: 'st-btn ghost',
            onClick: () => openNetwork('messages')
          }, 'Fabric Messages')
          : null
      )
    );
  }

  renderEmbedded () {
    const android = isAndroidCompanion();
    return React.createElement('div', { className: 'st-embedded' },
      this.state.loading
        ? React.createElement('div', { className: 'st-sec' }, 'loading…')
        : React.createElement(React.Fragment, null,
          this.state.error ? React.createElement('div', { className: 'st-sec' }, React.createElement('div', { className: 'st-err' }, this.state.error)) : null,
          this.state.notice ? React.createElement('div', { className: 'st-sec' }, React.createElement('div', { className: 'st-ok' }, this.state.notice)) : null,
          this.renderFabricNetworkSection({ embedded: true }),
          android ? null : this.renderLanBindSection()
        )
    );
  }

  render () {
    if (this.props.embedded) return this.renderEmbedded();
    const rt = this.state.runtime;
    const android = isAndroidCompanion();
    return React.createElement('div', { className: 'st-overlay', onClick: (e) => { if (e.target === e.currentTarget && typeof this.props.onClose === 'function') this.props.onClose(); } },
      React.createElement('div', { className: 'st-card' },
        React.createElement('div', { className: 'st-head' },
          React.createElement('h2', null, '⚙️ Settings'),
          React.createElement('button', { className: 'st-x', title: 'Close', onClick: () => { if (typeof this.props.onClose === 'function') this.props.onClose(); } }, '✕')
        ),
        this.state.loading
          ? React.createElement('div', { className: 'st-sec' }, 'loading…')
          : React.createElement(React.Fragment, null,
            this.state.error ? React.createElement('div', { className: 'st-sec' }, React.createElement('div', { className: 'st-err' }, this.state.error)) : null,
            this.state.notice ? React.createElement('div', { className: 'st-sec' }, React.createElement('div', { className: 'st-ok' }, this.state.notice)) : null,

            this.renderPrivacy(),

            android ? null : React.createElement('div', { className: 'st-sec' },
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
                  onChange: (e) => this.putBool('httpSharedMode', e.target.checked)
                }),
                'Allow LAN access to the dashboard (bind all interfaces)'
              ),
              React.createElement('div', { className: 'd', style: { marginTop: -4, marginBottom: 10 } },
                'Off by default — the dashboard listens on 127.0.0.1 only. Enable only when you want other machines on your network to open this UI (firewall permitting). LAN writes require a Schnorr/Bearer session; loopback still uses the unlocked identity. Hosted server mode always binds all interfaces. Override with FABRIC_HUB_INTERFACE.'),
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

            android ? null : React.createElement('div', { className: 'st-sec' },
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
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, cursor: 'pointer', marginBottom: 10 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.shareDiscordCatalog === true,
                  disabled: !this.state.editable || this.state.busy,
                  onChange: (e) => this.putBool('shareDiscordCatalog', e.target.checked),
                  style: { marginTop: 3 }
                }),
                React.createElement('span', null,
                  'Share group data with Federation groups I belong to',
                  React.createElement('div', { className: 'd', style: { marginTop: 4 } },
                    'Chat catalogs and messages are the first packs (`chat.catalog` / `chat.messages`, Discord as the first platform). This node accumulates servers, people, and messages locally so you can browse them if that platform is down, then gossips compact packs on Federation group contracts. Later bots and chat apps use the same envelope. Off = keep chat packs local. “When you fly” is a separate publish opt-in on your profile.')
                )
              ),
              this.field('Application ID', 'discordAppId', 'Discord application / client id'),
              (() => {
                const url = discordBotAuthorizeUrl({ appId: this.state.discordAppId });
                if (!url) return null;
                return React.createElement('div', {
                  className: 'd',
                  style: { marginTop: -6, marginBottom: 10 }
                },
                'A server administrator can ',
                React.createElement('a', {
                  className: 'st-auth-link',
                  href: url,
                  target: '_blank',
                  rel: 'noopener noreferrer'
                }, 'authorize bot permissions in Discord'),
                ' (View Channel, Send Messages, Read Message History, Attach Files).');
              })(),
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

            android ? null : React.createElement('div', { className: 'st-sec' },
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

            android ? null : React.createElement('div', { className: 'st-sec' },
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
                'Paste a Fabric message id (from Groups → Share / Fabric Messages → Copy id), an opaque fabric: GroupOffer, or a group id. Applies as the Store primary group and shows a settings/local.js snippet.'),
              React.createElement('div', { className: 'st-row', style: { alignItems: 'stretch' } },
                React.createElement('input', {
                  type: 'text',
                  value: this.state.defaultGroupPaste,
                  disabled: !this.state.editable || this.state.busy,
                  placeholder: 'fabric:… · message hash · group id',
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
                      this.props.onOpenIdentity('keys');
                    }
                  }
                }, isAndroidCompanion() ? 'Open Keys' : 'Open Identity')
              )
            ),

            this.renderVoice(),

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Desktop notifications'),
              React.createElement('div', { className: 'd' },
                'OS notifications for new chat messages. The public shoutbox dock stays available on every tab; the Chat page still covers all channels.'),
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
                'Public shoutbox messages'
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
              React.createElement('h3', null, 'When you fly'),
              React.createElement('div', { className: 'd' },
                'The weekday × hour heatmap is on your own profile (identity chip → My profile). Publishing is off until you check “Publish when I fly” there. That pack rides Federation GroupDataShare with other group data — it is not a local heatmap of someone else’s handle from this machine’s logs.')
            ),

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Files on your profile'),
              React.createElement('div', { className: 'd' },
                'Pin individual files with 📌 (“Pin to profile”) on the file page. Only pinned listings gossip to Federation groups — names, sizes, and prices, not the bytes. A local developer install uses the same pin to share GoonCitizen builds over Fabric.')
            ),

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Advanced mode'),
              React.createElement('div', { className: 'd' },
                'Reveal advanced Network → Messages (complete AMP wire Message log — Fabric Messages only, not Game.log), Home views (Activity Tree, Parser rules), and the Files tab (this node\'s document catalog). Stored in this browser.'),
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

            this.renderFabricNetworkSection(),

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
