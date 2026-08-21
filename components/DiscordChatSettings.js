'use strict';

/**
 * Chat settings page — opened from the Chat tab ⚙.
 * Voice (PTT bind) plus Discord bot guilds/channels when the bot UI is available.
 */

const React = require('react');
const {
  buildDiscordNetworkGraph,
  neighborsForUser,
  filterNetworkUsers
} = require('../functions/discordNetworkGraph');
const { filterCatalogGuilds } = require('../functions/discordGuildCatalog');
const {
  DIRECTION_LISTEN,
  DIRECTION_BIDIRECTIONAL,
  directionForChannel,
  normalizeDirections,
  setChannelDirection
} = require('../functions/discordChatDirection');
const { discordChannelIndicators } = require('../functions/discordChannelAccess');
const { botPermissionNotice, discordBotAuthorizeUrl } = require('../functions/discordBotAuthorize');
const groupVoiceSettings = require('../functions/groupVoiceSettings');
const VoiceSettingsPanel = require('./VoiceSettingsPanel');

const BASE = '/services/star-citizen';

const CSS = `
  .dc-page{display:flex;flex-direction:column;min-height:0;flex:1 1 auto;height:100%;max-height:100%;overflow:hidden}
  .dc-toolbar{display:flex;gap:10px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line);
    flex:0 0 auto;flex-wrap:wrap}
  .dc-toolbar .ttl{font-size:13px;font-weight:650;flex:1;min-width:120px}
  .dc-toolbar .meta{font-size:11.5px;color:var(--muted)}
  .dc-toolbar .meta b{color:var(--text);font-weight:600}
  .dc-tabs{display:flex;gap:6px;padding:8px 16px 0;flex:0 0 auto;flex-wrap:wrap}
  .dc-tab{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:7px;
    padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer}
  .dc-tab:hover{border-color:var(--accent)}
  .dc-tab.on{background:rgba(88,101,242,.16);border-color:#5865F2;color:#c7c9ff}
  .dc-btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:7px;
    padding:6px 11px;font-size:12px;font-weight:600;cursor:pointer}
  .dc-btn:hover{border-color:var(--accent)}
  .dc-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  .dc-btn:disabled{opacity:.45;cursor:default}
  .dc-body{flex:1 1 auto;min-height:0;overflow:hidden;padding:12px 16px;display:flex;flex-direction:column;gap:12px}
  .dc-banner{font-size:12.5px;line-height:1.55;color:var(--muted);padding:10px 12px;border-radius:8px;
    background:var(--panel2);border:1px solid var(--line)}
  .dc-banner a{color:#5865F2;font-weight:650}
  .dc-banner.warn{color:var(--kill);background:rgba(248,81,73,.08);border-color:rgba(248,81,73,.25)}
  .dc-banner.ok{color:var(--good);background:rgba(63,185,80,.08);border-color:rgba(63,185,80,.25)}
  .dc-filter{display:flex;gap:8px;align-items:center;flex:0 0 auto;
    background:var(--panel);padding:2px 0 0}
  .dc-filter input{flex:1;min-width:0;box-sizing:border-box;background:var(--bg);border:1px solid var(--line);
    color:var(--text);border-radius:7px;padding:8px 10px;font-size:12.5px}
  .dc-filter input:focus{outline:none;border-color:#5865F2}
  .dc-filter-clear{background:var(--panel2);border:1px solid var(--line);color:var(--muted);
    border-radius:7px;width:32px;height:32px;flex:none;cursor:pointer;font-size:15px;line-height:1;
    display:inline-flex;align-items:center;justify-content:center}
  .dc-filter-clear:hover{color:var(--text);border-color:var(--accent)}
  .dc-filter-meta{font-size:11.5px;color:var(--muted);padding:0 2px 4px;flex:0 0 auto}
  .dc-guild-list{flex:1 1 auto;min-height:0;overflow-y:scroll;overflow-x:hidden;display:grid;gap:12px;
    align-content:start;padding-right:6px;scrollbar-gutter:stable}
  .dc-guild-list::-webkit-scrollbar{width:10px}
  .dc-guild-list::-webkit-scrollbar-track{background:rgba(110,118,129,.12);border-radius:8px}
  .dc-guild-list::-webkit-scrollbar-thumb{background:rgba(139,148,158,.55);border-radius:8px}
  .dc-guild-h .src{font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;flex:none;
    background:rgba(88,101,242,.15);color:#c7c9ff}
  .dc-guild{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--panel2)}
  .dc-guild-h{display:flex;gap:10px;align-items:center;width:100%;text-align:left;background:none;border:none;
    color:var(--text);padding:11px 13px;cursor:pointer;font-size:13px;font-weight:650}
  .dc-guild-h:hover{background:rgba(56,139,253,.06)}
  .dc-guild-h .chev{color:var(--muted);font-size:11px;width:14px}
  .dc-guild-h .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .dc-guild-h .cnt{color:var(--muted);font-size:11.5px;font-weight:500}
  .dc-chans{border-top:1px solid var(--line);display:grid;max-height:min(52vh,520px);overflow:auto;
    scrollbar-gutter:stable}
  .dc-ch{display:flex;gap:8px;align-items:center;width:100%;text-align:left;background:none;border:none;
    color:var(--text);padding:8px 13px 8px 28px;cursor:pointer;font-size:12.5px;border-left:3px solid transparent}
  .dc-ch:hover{background:rgba(56,139,253,.06)}
  .dc-ch.on{background:rgba(56,139,253,.1);border-left-color:var(--accent)}
  .dc-ch:disabled{opacity:.55;cursor:default}
  .dc-ch-row{display:flex;gap:6px;align-items:center;width:100%;border-left:3px solid transparent;
    padding-right:10px}
  .dc-ch-row:hover{background:rgba(56,139,253,.06)}
  .dc-ch-row.on{background:rgba(56,139,253,.1);border-left-color:var(--accent)}
  .dc-ch-row .dc-ch{flex:1;min-width:0;border-left:none;padding-right:4px}
  .dc-ch-row .dc-ch:hover{background:transparent}
  .dc-ch .hash{color:var(--muted);font-weight:700}
  .dc-ch .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .dc-ch .tag{font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;
    background:rgba(56,139,253,.12);color:var(--accent)}
  .dc-ch .tag.muted{background:rgba(110,118,129,.15);color:var(--muted)}
  .dc-ch .tag.block{background:rgba(248,81,73,.12);color:var(--kill)}
  .dc-ch .tag.warn{background:rgba(247,147,26,.16);color:#f7931a}
  .dc-auth-link{color:#5865F2;font-weight:650;text-decoration:underline}
  .dc-ch .dc-auth-link{font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;
    background:rgba(88,101,242,.12);text-decoration:none;flex:none}
  .dc-ch-row .dir-btns{display:flex;gap:4px;flex:none}
  .dc-ch-row .dir-btn{font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;cursor:pointer;
    border:1px solid var(--line);background:var(--bg);color:var(--muted);line-height:1.2}
  .dc-ch-row .dir-btn:hover{border-color:var(--accent);color:var(--text)}
  .dc-ch-row .dir-btn.on.bi{border-color:#5865F2;color:#c7c9ff;background:rgba(88,101,242,.16)}
  .dc-ch-row .dir-btn.on.listen{border-color:rgba(248,81,73,.45);color:var(--kill);
    background:rgba(248,81,73,.1)}
  .dc-ch-row .dir-btn:disabled{opacity:.45;cursor:default}
  .dc-users{border-top:1px solid var(--line);padding:8px 13px 10px 28px;display:grid;gap:4px;
    max-height:min(28vh,280px);overflow-y:auto;scrollbar-gutter:stable}
  .dc-user{display:flex;gap:8px;align-items:center;font-size:12px;color:var(--text);width:100%;
    text-align:left;background:none;border:none;padding:4px 0;cursor:pointer;border-radius:4px}
  .dc-user:hover{background:rgba(88,101,242,.08)}
  .dc-user .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .dc-user .tag,.dc-net-body .tag{font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;
    background:rgba(88,101,242,.15);color:#5865F2}
  .dc-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:8px 11px;font-size:12.5px}
  .dc-foot{font-size:11.5px;color:var(--muted);line-height:1.5;padding:0 2px 4px}
  .dc-foot code{font-size:11px}
  .dc-link{border:1px solid var(--line);border-radius:10px;padding:12px 13px;background:var(--panel2);display:grid;gap:8px}
  .dc-link .ttl{font-size:13px;font-weight:650}
  .dc-link .meta{font-size:12px;color:var(--muted);line-height:1.5}
  .dc-link .code{font-family:'Cascadia Code',Consolas,monospace;font-size:18px;letter-spacing:.12em;
    font-weight:700;padding:8px 10px;border-radius:7px;background:rgba(88,101,242,.12);color:#c9d1d9}
  .dc-link .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .dc-net{display:grid;gap:12px;grid-template-columns:minmax(200px,280px) minmax(0,1fr);align-items:start}
  @media(max-width:820px){.dc-net{grid-template-columns:1fr}}
  .dc-net-panel{border:1px solid var(--line);border-radius:10px;background:var(--panel2);overflow:hidden;min-width:0}
  .dc-net-panel h3{margin:0;padding:10px 12px;font-size:12px;font-weight:650;border-bottom:1px solid var(--line);
    text-transform:uppercase;letter-spacing:.35px;color:var(--muted)}
  .dc-net-search{padding:8px 10px;border-bottom:1px solid var(--line)}
  .dc-net-search input{width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--line);
    color:var(--text);border-radius:7px;padding:7px 9px;font-size:12.5px}
  .dc-net-list{max-height:420px;overflow:auto;display:grid}
  .dc-net-row{display:flex;gap:8px;align-items:center;width:100%;text-align:left;background:none;border:none;
    color:var(--text);padding:8px 12px;cursor:pointer;font-size:12.5px;border-left:3px solid transparent}
  .dc-net-row:hover{background:rgba(88,101,242,.08)}
  .dc-net-row.on{background:rgba(88,101,242,.12);border-left-color:#5865F2}
  .dc-net-row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .dc-net-row .meta{color:var(--muted);font-size:11px;flex:none}
  .dc-net-body{padding:12px;display:grid;gap:10px}
  .dc-net-stat{display:flex;flex-wrap:wrap;gap:8px}
  .dc-net-pill{font-size:11px;padding:3px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
  .dc-net-pill.on{border-color:#5865F2;color:#c7c9ff;background:rgba(88,101,242,.12)}
  .dc-net-edge{display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;padding:8px 0;
    border-bottom:1px solid #20262f;font-size:12.5px}
  .dc-net-edge:last-child{border-bottom:none}
  .dc-net-edge button{background:none;border:none;color:var(--accent);cursor:pointer;padding:0;font:inherit;font-weight:600}
  .dc-net-edge .share{color:var(--muted);font-size:11.5px;line-height:1.45;flex:1 1 100%}
  .dc-empty{color:var(--muted);font-size:12px;padding:10px 12px;line-height:1.5}
` + (VoiceSettingsPanel.CSS || '');

function channelIcon (ch) {
  if (!ch) return '#';
  if (ch.type === 2 || ch.type === 13) return '🔊';
  if (ch.type === 4) return '📁';
  if (ch.type === 5) return '📢';
  return '#';
}

class DiscordChatSettings extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      loading: true,
      refreshing: false,
      error: null,
      notice: null,
      busyChannel: null,
      catalog: null,
      openGuildIds: {},
      selectedChannelId: null,
      linkBusy: false,
      linkStatus: null,
      /** 'servers' | 'network' */
      view: 'servers',
      serverQuery: '',
      networkQuery: '',
      selectedUserId: null,
      hideBots: true,
      minShared: 1,
      discordChatDirections: normalizeDirections(props.discordChatDirections) || {},
      busyDirectionId: null,
      voice: groupVoiceSettings.defaultVoiceSettings(),
      voiceBusy: false
    };
  }

  componentDidMount () {
    this.load();
    this.loadVoice();
  }

  componentDidUpdate (prevProps) {
    if (prevProps.discordChatDirections !== this.props.discordChatDirections) {
      const next = normalizeDirections(this.props.discordChatDirections) || {};
      this.setState({ discordChatDirections: next });
    }
  }

  async load (opts = {}) {
    this.setState({ loading: true, error: null });
    try {
      const res = await fetch(BASE + '/discord/guilds' + (opts.refresh ? '?refresh=1' : ''), {
        headers: { Accept: 'application/json' }
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body && body.error) || ('HTTP ' + res.status));
      const catalog = (body && body.data) || body || {};
      const guilds = Array.isArray(catalog.guilds) ? catalog.guilds : [];
      const open = Object.assign({}, this.state.openGuildIds);
      const selected = catalog.selectedChannelId || null;
      if (selected) {
        for (const g of guilds) {
          if ((g.channels || []).some((c) => String(c.id) === String(selected))) {
            open[g.id] = true;
          }
        }
      } else if (guilds[0] && open[guilds[0].id] == null) {
        open[guilds[0].id] = true;
      }
      this.setState({
        loading: false,
        refreshing: false,
        catalog,
        openGuildIds: open,
        selectedChannelId: selected
      });
      await Promise.all([this.loadLink(), this.loadDirections()]);
    } catch (e) {
      this.setState({
        loading: false,
        refreshing: false,
        error: (e && e.message) || String(e)
      });
    }
  }

  async loadDirections () {
    try {
      const res = await fetch('/settings', { headers: { Accept: 'application/json' } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return null;
      const value = body && body.settings && body.settings.discordChatDirections;
      const dirs = normalizeDirections(value) || {};
      this.setState({ discordChatDirections: dirs });
      if (typeof this.props.onDirectionsChanged === 'function') {
        this.props.onDirectionsChanged(dirs);
      }
      return dirs;
    } catch (_) {
      return null;
    }
  }

  async loadVoice () {
    try {
      const res = await fetch('/settings', { headers: { Accept: 'application/json' } });
      const body = await res.json().catch(() => ({}));
      const raw = body && body.settings && body.settings.voice;
      this.setState({ voice: groupVoiceSettings.sanitizeVoiceSettings(raw) });
    } catch (_) { /* ignore */ }
  }

  async putVoice (patch) {
    const next = groupVoiceSettings.sanitizeVoiceSettings(Object.assign({}, this.state.voice, patch));
    this.setState({ voice: next, voiceBusy: true, error: null });
    groupVoiceSettings.applyElectronPttBind(next);
    try {
      const res = await fetch('/settings/voice', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ value: next })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body && body.error) || ('HTTP ' + res.status));
      this.setState({ voiceBusy: false });
    } catch (err) {
      this.setState({ voiceBusy: false, error: err.message });
    }
  }

  showDiscordTabs () {
    return this.props.showDiscord !== false;
  }

  async setChatDirection (channel, direction) {
    if (!channel || !channel.id) return;
    const id = String(channel.id);
    const dir = direction === DIRECTION_LISTEN ? DIRECTION_LISTEN : DIRECTION_BIDIRECTIONAL;
    const next = setChannelDirection(this.state.discordChatDirections, id, dir);
    this.setState({ busyDirectionId: id, error: null, notice: null });
    try {
      const res = await fetch('/settings/discordChatDirections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ value: next })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body && body.error) || ('HTTP ' + res.status));
      const saved = normalizeDirections(
        body && body.settings && body.settings.discordChatDirections != null
          ? body.settings.discordChatDirections
          : next
      ) || {};
      this.setState({
        busyDirectionId: null,
        discordChatDirections: saved,
        notice: dir === DIRECTION_LISTEN
          ? `#${channel.name} is listen-only (no Chat → Discord)`
          : `#${channel.name} is bi-directional`
      });
      if (typeof this.props.onDirectionsChanged === 'function') {
        this.props.onDirectionsChanged(saved);
      }
    } catch (e) {
      this.setState({
        busyDirectionId: null,
        error: (e && e.message) || String(e)
      });
    }
  }

  renderChannelPermTags (ch, guild) {
    if (!ch || !ch.canAnnounce) return null;
    const listenOnly = directionForChannel(ch.id, {
      discordChatDirections: this.state.discordChatDirections
    }) === DIRECTION_LISTEN;
    const catalog = this.state.catalog || {};
    const indicators = discordChannelIndicators({
      botReady: catalog.botReady === true,
      bot: ch.bot || null,
      listenOnly,
      identityUnlocked: !!this.props.identityPubkey,
      discordSurface: true,
      discordOnly: true,
      isDm: false
    });
    const notice = botPermissionNotice({
      bot: ch.bot || null,
      appId: catalog.appId || null,
      guildId: guild && guild.id
    });
    if (!indicators.length && !(notice && notice.url)) return null;
    return React.createElement(React.Fragment, null,
      indicators.map((ind) => React.createElement('span', {
        key: ind.id,
        className: 'tag ' + (ind.tone === 'block' ? 'block' : 'warn'),
        title: ind.title
      }, ind.label)),
      notice && notice.url
        ? React.createElement('a', {
          className: 'dc-auth-link',
          href: notice.url,
          target: '_blank',
          rel: 'noopener noreferrer',
          title: notice.text,
          onClick: (e) => e.stopPropagation()
        }, notice.linkLabel)
        : null
    );
  }

  renderDirectionControls (ch) {
    if (!ch || !ch.canAnnounce) return null;
    const id = String(ch.id);
    const current = directionForChannel(id, {
      discordChatDirections: this.state.discordChatDirections
    });
    const busy = this.state.busyDirectionId === id;
    return React.createElement('span', {
      className: 'dir-btns',
      onClick: (e) => e.stopPropagation()
    },
    React.createElement('button', {
      type: 'button',
      className: 'dir-btn bi' + (current === DIRECTION_BIDIRECTIONAL ? ' on' : ''),
      disabled: busy,
      title: 'Bi-directional — Chat can post to Discord',
      onClick: (e) => {
        e.stopPropagation();
        this.setChatDirection(ch, DIRECTION_BIDIRECTIONAL);
      }
    }, 'Bi'),
    React.createElement('button', {
      type: 'button',
      className: 'dir-btn listen' + (current === DIRECTION_LISTEN ? ' on' : ''),
      disabled: busy,
      title: 'Listen-only — inbound Discord only',
      onClick: (e) => {
        e.stopPropagation();
        this.setChatDirection(ch, DIRECTION_LISTEN);
      }
    }, 'Listen')
    );
  }

  async loadLink () {
    if (!this.props.identityPubkey) {
      this.setState({ linkStatus: null });
      return null;
    }
    try {
      const res = await fetch(BASE + '/discord/link', { headers: { Accept: 'application/json' } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return null;
      const linkStatus = (body && body.data) || null;
      this.setState({ linkStatus });
      return linkStatus;
    } catch (_) {
      return null;
    }
  }

  async generateLinkCode () {
    this.setState({ linkBusy: true, error: null, notice: null });
    try {
      const res = await fetch(BASE + '/discord/link', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: '{}'
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body && body.error) || ('HTTP ' + res.status));
      const pending = (body && body.data) || {};
      this.setState({
        linkBusy: false,
        linkStatus: Object.assign({}, this.state.linkStatus, {
          pending: {
            code: pending.code,
            expiresAt: pending.expiresAt,
            instruction: pending.instruction
          },
          linked: pending.linked || (this.state.linkStatus && this.state.linkStatus.linked) || null
        }),
        notice: pending.instruction || 'Post the !link code in Discord.'
      });
    } catch (e) {
      this.setState({
        linkBusy: false,
        error: (e && e.message) || String(e)
      });
    }
  }

  async unlinkIdentity () {
    this.setState({ linkBusy: true, error: null, notice: null });
    try {
      const res = await fetch(BASE + '/discord/link', {
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body && body.error) || ('HTTP ' + res.status));
      this.setState({
        linkBusy: false,
        linkStatus: { linked: null, pending: null },
        notice: 'Discord identity unlinked on this node.'
      });
    } catch (e) {
      this.setState({
        linkBusy: false,
        error: (e && e.message) || String(e)
      });
    }
  }

  async refresh () {
    this.setState({ refreshing: true, error: null, notice: null });
    await this.load({ refresh: true });
  }

  toggleGuild (guildId) {
    const id = String(guildId);
    this.setState((prev) => ({
      openGuildIds: Object.assign({}, prev.openGuildIds, {
        [id]: !prev.openGuildIds[id]
      })
    }));
  }

  setServerQuery (value) {
    const serverQuery = String(value || '');
    const q = serverQuery.trim();
    if (!q) {
      this.setState({ serverQuery });
      return;
    }
    const cat = this.state.catalog;
    const guilds = filterCatalogGuilds(
      (cat && Array.isArray(cat.guilds)) ? cat.guilds : [],
      q
    );
    const open = Object.assign({}, this.state.openGuildIds);
    for (const g of guilds) {
      if (g && g.id != null) open[g.id] = true;
    }
    this.setState({ serverQuery, openGuildIds: open });
  }

  clearServerQuery () {
    this.setState({ serverQuery: '' });
  }

  openNetworkUser (userId) {
    const id = userId != null ? String(userId) : null;
    this.setState({
      view: 'network',
      selectedUserId: id,
      networkQuery: ''
    });
  }

  networkGraph () {
    return buildDiscordNetworkGraph(this.state.catalog);
  }

  async selectAnnounceChannel (channel) {
    if (!channel || !channel.canAnnounce) return;
    const id = String(channel.id);
    this.setState({ busyChannel: id, error: null, notice: null });
    try {
      const res = await fetch('/settings/discordChannel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ value: id })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body && body.error) || ('HTTP ' + res.status));
      this.setState({
        busyChannel: null,
        selectedChannelId: id,
        notice: `Announce channel set to #${channel.name}`
      });
      if (typeof this.props.onChannelSelected === 'function') {
        this.props.onChannelSelected(id, channel);
      }
    } catch (e) {
      this.setState({
        busyChannel: null,
        error: (e && e.message) || String(e)
      });
    }
  }

  renderLinkPanel () {
    const st = this.state.linkStatus;
    const pending = st && st.pending;
    const linked = st && st.linked;
    const unlocked = !!this.props.identityPubkey;
    return React.createElement('div', { className: 'dc-link' },
      React.createElement('div', { className: 'ttl' }, 'Fabric ↔ Discord identity'),
      React.createElement('div', { className: 'meta' },
        'Prove possession of both identities: generate a one-time code here, then post ',
        React.createElement('code', null, '!link CODE'),
        ' from your Discord account in any channel this bot can see. Linked authors appear as Fabric profiles in Chat.'
      ),
      !unlocked
        ? React.createElement('div', { className: 'meta' }, 'Unlock your identity to generate a link code.')
        : (linked
          ? React.createElement('div', { className: 'meta' },
            'Linked Discord ',
            React.createElement('b', null, linked.username || linked.discordUserId),
            ' ↔ this Fabric key.')
          : React.createElement('div', { className: 'meta' }, 'No Discord account linked yet.')),
      pending && pending.code
        ? React.createElement('div', { className: 'code', title: pending.instruction }, pending.code)
        : null,
      pending && pending.instruction
        ? React.createElement('div', { className: 'meta' }, pending.instruction)
        : null,
      React.createElement('div', { className: 'row' },
        React.createElement('button', {
          type: 'button',
          className: 'dc-btn primary',
          disabled: !unlocked || this.state.linkBusy,
          onClick: () => this.generateLinkCode()
        }, this.state.linkBusy ? '…' : (pending ? 'New code' : 'Generate link code')),
        linked
          ? React.createElement('button', {
            type: 'button',
            className: 'dc-btn',
            disabled: this.state.linkBusy,
            onClick: () => this.unlinkIdentity()
          }, 'Unlink')
          : null
      )
    );
  }

  renderBanner () {
    const cat = this.state.catalog;
    if (!cat) return null;
    const guildCount = Array.isArray(cat.guilds) ? cat.guilds.length : 0;
    const view = cat.worldView || {};
    const msgPack = (view.packs || []).find((p) => p &&
      (p.pack === 'chat.messages' || p.pack === 'discord.messages'));
    const messageCount = msgPack && Number(msgPack.messageCount) ? Number(msgPack.messageCount) : 0;
    if (cat.botReady) {
      return React.createElement('div', { className: 'dc-banner ok' },
        'Bot ready',
        cat.botUser ? React.createElement('span', null, ` as ${cat.botUser}`) : null,
        '. Pick a text or announcement channel for embeds. Use Bi / Listen to control Chat → Discord posting per channel.',
        ' Messages and guild lists accumulate locally so you can keep browsing if Discord goes down.',
        cat.truncated
          ? ' Large servers never return a full member list — this page unions people over time and from group data shares.'
          : '');
    }
    if (guildCount || messageCount) {
      return React.createElement('div', { className: 'dc-banner' },
        'Discord is not reachable on this node. Showing ',
        React.createElement('b', null, String(guildCount)),
        ' server',
        guildCount === 1 ? '' : 's',
        messageCount
          ? React.createElement('span', null,
            ' and ',
            React.createElement('b', null, String(messageCount)),
            ' stored message',
            messageCount === 1 ? '' : 's')
          : null,
        ' accumulated before the outage (and from group data shares). Enable a bot token under Settings ⚙ → Discord bot to refresh from Discord.');
    }
    return React.createElement('div', { className: 'dc-banner warn' },
      'Discord bot is not ready. Enable integration and save a bot token under Settings ⚙ → Discord bot, then ',
      (() => {
        const url = discordBotAuthorizeUrl({ appId: cat.appId });
        return url
          ? React.createElement(React.Fragment, null,
            React.createElement('a', {
              className: 'dc-auth-link',
              href: url,
              target: '_blank',
              rel: 'noopener noreferrer'
            }, 'authorize the bot in Discord'),
            '.')
          : 'invite the bot to your server.';
      })(),
      ' Group members who run a bot can share data packs over Fabric so this node can still build a world view.');
  }

  renderGuild (guild) {
    const filterActive = !!String(this.state.serverQuery || '').trim();
    const open = filterActive || !!this.state.openGuildIds[guild.id];
    const selected = this.state.selectedChannelId;
    const channels = Array.isArray(guild.channels) ? guild.channels : [];
    const announceable = channels.filter((c) => c.canAnnounce);
    const other = channels.filter((c) => !c.canAnnounce && c.type !== 4);
    const cats = channels.filter((c) => c.type === 4);

    const members = Array.isArray(guild.members) ? guild.members : [];
    const usersShown = members.slice(0, filterActive ? 200 : 120);
    const listed = members.length;
    const reported = Number(guild.memberCount);
    const truncated = guild.truncated === true ||
      (Number.isFinite(reported) && reported > listed);
    const source = guild.source === 'gossip' ? 'shared' :
      (guild.source === 'merged' ? 'merged' : null);

    return React.createElement('div', { className: 'dc-guild', key: guild.id },
      React.createElement('button', {
        type: 'button',
        className: 'dc-guild-h',
        onClick: () => this.toggleGuild(guild.id)
      },
      React.createElement('span', { className: 'chev' }, open ? '▼' : '▶'),
      React.createElement('span', { className: 'nm', title: guild.id }, guild.name),
      source
        ? React.createElement('span', { className: 'src', title: 'From group members on Fabric' }, source)
        : null,
      React.createElement('span', { className: 'cnt' },
        `${announceable.length} text` +
        (truncated && Number.isFinite(reported)
          ? ` · ${listed} / ~${reported} members`
          : (listed
            ? ` · ${listed} users`
            : (Number.isFinite(reported) ? ` · ${reported} members` : '')))
      )
      ),
      open
        ? React.createElement('div', { className: 'dc-chans' },
          announceable.length === 0 && other.length === 0 && cats.length === 0 && !usersShown.length
            ? React.createElement('div', { className: 'dc-empty' },
              filterActive
                ? 'No channels or users match in this guild.'
                : 'No channels visible to the bot in this guild.')
            : null,
          announceable.map((ch) => React.createElement('div', {
            key: ch.id,
            className: 'dc-ch-row' + (String(selected) === String(ch.id) ? ' on' : '')
          },
          React.createElement('button', {
            type: 'button',
            className: 'dc-ch',
            disabled: this.state.busyChannel === ch.id,
            title: 'Set announce channel · ' + ch.id,
            onClick: () => this.selectAnnounceChannel(ch)
          },
          React.createElement('span', { className: 'hash' }, channelIcon(ch)),
          React.createElement('span', { className: 'nm' }, ch.name),
          String(selected) === String(ch.id)
            ? React.createElement('span', { className: 'tag' }, 'announce')
            : React.createElement('span', { className: 'tag muted' }, ch.typeName),
          ch.messageCount
            ? React.createElement('span', { className: 'tag muted', title: ch.lastMessageAt || '' },
              String(ch.messageCount) + ' msg')
            : null,
          this.renderChannelPermTags(ch, guild),
          this.state.busyChannel === ch.id
            ? React.createElement('span', { className: 'tag muted' }, '…')
            : null
          ),
          this.renderDirectionControls(ch)
          )),
          other.map((ch) => React.createElement('button', {
            type: 'button',
            key: ch.id,
            className: 'dc-ch',
            disabled: true,
            title: `${ch.id} · not used for announce embeds`
          },
          React.createElement('span', { className: 'hash' }, channelIcon(ch)),
          React.createElement('span', { className: 'nm' }, ch.name),
          React.createElement('span', { className: 'tag muted' }, ch.typeName)
          )),
          usersShown.length
            ? React.createElement('div', { className: 'dc-users' },
              usersShown.map((u) => React.createElement('button', {
                type: 'button',
                className: 'dc-user',
                key: u.id,
                title: u.id + ' — open network',
                onClick: () => this.openNetworkUser(u.id)
              },
              React.createElement('span', { className: 'nm' }, u.displayName || u.username),
              u.bot ? React.createElement('span', { className: 'tag' }, 'bot') : null
              )),
              members.length > usersShown.length
                ? React.createElement('div', { className: 'dc-empty' },
                  `+${members.length - usersShown.length} more listed` +
                  (truncated && Number.isFinite(reported) && reported > members.length
                    ? ` · Discord reports ~${reported}`
                    : ''))
                : (truncated && Number.isFinite(reported) && reported > members.length
                  ? React.createElement('div', { className: 'dc-empty' },
                    `Listed ${listed} of ~${reported} — accumulating from chat and group shares`)
                  : null)
            )
            : null
          )
        : null
    );
  }

  renderServerFilter (guildCount, channelCount) {
    const q = this.state.serverQuery || '';
    const active = !!q.trim();
    return React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'dc-filter' },
        React.createElement('input', {
          type: 'search',
          value: q,
          placeholder: 'Filter servers, #channels, or users…',
          'aria-label': 'Filter Discord servers and channels',
          autoComplete: 'off',
          spellCheck: false,
          onChange: (e) => this.setServerQuery(e.target.value)
        }),
        active
          ? React.createElement('button', {
            type: 'button',
            className: 'dc-filter-clear',
            title: 'Clear filter',
            'aria-label': 'Clear server filter',
            onClick: () => this.clearServerQuery()
          }, '×')
          : null
      ),
      active
        ? React.createElement('div', { className: 'dc-filter-meta' },
          guildCount
            ? `Showing ${guildCount} server${guildCount === 1 ? '' : 's'}` +
              (channelCount != null ? ` · ${channelCount} channel${channelCount === 1 ? '' : 's'}` : '')
            : 'No servers or channels match.')
        : null
    );
  }

  renderNetwork () {
    const graph = this.networkGraph();
    const stats = graph.stats || {};
    const hideBots = this.state.hideBots !== false;
    const minShared = Math.max(1, Number(this.state.minShared) || 1);
    const humans = (graph.users || []).filter((u) => !(hideBots && u.bot));
    const filtered = filterNetworkUsers(humans, this.state.networkQuery);
    const selectedId = this.state.selectedUserId;
    const selected = (graph.users || []).find((u) => u.id === selectedId) || null;
    const neighbors = selected
      ? neighborsForUser(graph, selected.id, { minShared, excludeBots: hideBots })
      : [];
    const topEdges = (graph.edges || [])
      .filter((e) => e.sharedCount >= minShared)
      .filter((e) => {
        if (!hideBots) return true;
        const a = (graph.users || []).find((u) => u.id === e.a);
        const b = (graph.users || []).find((u) => u.id === e.b);
        return a && b && !a.bot && !b.bot;
      })
      .slice(0, 40);

    return React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'dc-banner' },
        'Network exploration uses ',
        React.createElement('b', null, 'shared Discord servers'),
        ' the bot can see (co-membership). Discord Friends are a private user graph and are not available to bots. ',
        'Linked Fabric identities appear when operators complete ',
        React.createElement('code', null, '!link'),
        '.'
      ),
      React.createElement('div', { className: 'dc-net-stat' },
        React.createElement('span', { className: 'dc-net-pill on' }, `${stats.guildCount || 0} servers`),
        React.createElement('span', { className: 'dc-net-pill' }, `${stats.humanCount || 0} humans`),
        React.createElement('span', { className: 'dc-net-pill' }, `${stats.multiGuildHumanCount || 0} multi-server`),
        React.createElement('span', { className: 'dc-net-pill' }, `${stats.linkedCount || 0} Fabric-linked`),
        React.createElement('span', { className: 'dc-net-pill' }, `${stats.edgeCount || 0} overlaps`),
        React.createElement('button', {
          type: 'button',
          className: 'dc-net-pill' + (hideBots ? ' on' : ''),
          onClick: () => this.setState({ hideBots: !hideBots })
        }, hideBots ? 'Humans only' : 'Include bots'),
        React.createElement('button', {
          type: 'button',
          className: 'dc-net-pill' + (minShared >= 2 ? ' on' : ''),
          onClick: () => this.setState({ minShared: minShared >= 2 ? 1 : 2 })
        }, minShared >= 2 ? '≥2 shared servers' : '≥1 shared server')
      ),
      React.createElement('div', { className: 'dc-net' },
        React.createElement('div', { className: 'dc-net-panel' },
          React.createElement('h3', null, 'People'),
          React.createElement('div', { className: 'dc-net-search' },
            React.createElement('input', {
              type: 'search',
              value: this.state.networkQuery || '',
              placeholder: 'Search users or servers…',
              'aria-label': 'Search Discord network users',
              onChange: (e) => this.setState({ networkQuery: e.target.value })
            })
          ),
          React.createElement('div', { className: 'dc-net-list' },
            !filtered.length
              ? React.createElement('div', { className: 'dc-empty' }, 'No users match.')
              : filtered.slice(0, 200).map((u) => React.createElement('button', {
                type: 'button',
                key: u.id,
                className: 'dc-net-row' + (u.id === selectedId ? ' on' : ''),
                onClick: () => this.setState({ selectedUserId: u.id })
              },
              React.createElement('span', { className: 'nm' }, u.displayName || u.username || u.id),
              React.createElement('span', { className: 'meta' },
                `${u.guildIds.length} srv` + (u.linkedPubkey ? ' · linked' : ''))
              ))
          )
        ),
        React.createElement('div', { className: 'dc-net-panel' },
          React.createElement('h3', null, selected ? 'Shared with' : 'Strongest overlaps'),
          React.createElement('div', { className: 'dc-net-body' },
            selected
              ? React.createElement(React.Fragment, null,
                React.createElement('div', null,
                  React.createElement('b', null, selected.displayName || selected.username),
                  selected.bot
                    ? React.createElement('span', { className: 'tag', style: { marginLeft: 8 } }, 'bot')
                    : null,
                  selected.linkedPubkey
                    ? React.createElement('div', { className: 'dc-empty', style: { padding: '4px 0' } },
                      'Fabric ',
                      React.createElement('code', null, selected.linkedPubkey.slice(0, 16) + '…'))
                    : null
                ),
                React.createElement('div', { className: 'dc-empty', style: { padding: 0 } },
                  'Servers: ',
                  (selected.guildNames || []).join(', ') || '—'),
                !neighbors.length
                  ? React.createElement('div', { className: 'dc-empty', style: { padding: 0 } },
                    'No co-members meet the shared-server threshold yet. Refresh after the bot sees more guilds, or lower the threshold.')
                  : neighbors.slice(0, 60).map((n) => React.createElement('div', {
                    className: 'dc-net-edge',
                    key: n.user.id
                  },
                  React.createElement('button', {
                    type: 'button',
                    onClick: () => this.setState({ selectedUserId: n.user.id })
                  }, n.user.displayName || n.user.username),
                  React.createElement('span', { className: 'dc-net-pill on' },
                    `${n.sharedCount} shared`),
                  n.user.linkedPubkey
                    ? React.createElement('span', { className: 'dc-net-pill' }, 'Fabric linked')
                    : null,
                  React.createElement('div', { className: 'share' },
                    n.sharedGuildNames.join(' · '))
                  ))
              )
              : React.createElement(React.Fragment, null,
                React.createElement('div', { className: 'dc-empty', style: { padding: 0 } },
                  'Pick someone on the left, or browse pairs who share the most servers below.'),
                !topEdges.length
                  ? React.createElement('div', { className: 'dc-empty', style: { padding: 0 } },
                    'Need at least two visible humans in overlapping guilds to draw edges.')
                  : topEdges.map((e) => React.createElement('div', {
                    className: 'dc-net-edge',
                    key: e.a + ':' + e.b
                  },
                  React.createElement('button', {
                    type: 'button',
                    onClick: () => this.setState({ selectedUserId: e.a })
                  }, e.aName),
                  React.createElement('span', { className: 'dc-empty', style: { padding: 0 } }, '↔'),
                  React.createElement('button', {
                    type: 'button',
                    onClick: () => this.setState({ selectedUserId: e.b })
                  }, e.bName),
                  React.createElement('span', { className: 'dc-net-pill on' },
                    `${e.sharedCount} shared`),
                  React.createElement('div', { className: 'share' },
                    (e.sharedGuildNames || []).join(' · '))
                  ))
              )
          )
        )
      )
    );
  }

  renderVoice () {
    return React.createElement(VoiceSettingsPanel, {
      voice: this.state.voice,
      disabled: this.state.voiceBusy,
      onChange: (patch) => this.putVoice(patch)
    });
  }

  render () {
    const cat = this.state.catalog;
    const guilds = cat && Array.isArray(cat.guilds) ? cat.guilds : [];
    const showDiscord = this.showDiscordTabs();
    let view = this.state.view;
    if (view !== 'voice' && view !== 'network' && view !== 'servers') view = 'servers';
    if (!showDiscord) view = 'voice';

    return React.createElement('div', { className: 'dc-page' },
      React.createElement('div', { className: 'dc-toolbar' },
        React.createElement('div', { className: 'ttl' }, view === 'voice' ? 'Voice' : 'Discord bot'),
        view !== 'voice' && cat && (cat.botReady || guilds.length)
          ? React.createElement('span', { className: 'meta' },
            React.createElement('b', null, guilds.length),
            ` guild${guilds.length === 1 ? '' : 's'}`,
            cat.users && cat.users.length
              ? React.createElement('span', null,
                ' · ',
                React.createElement('b', null, cat.users.length),
                ' users')
              : null,
            cat.accumulated
              ? React.createElement('span', null, ' · accumulated')
              : null,
            cat.offline
              ? React.createElement('span', null, ' · offline')
              : null,
            cat.worldView && cat.worldView.packs
              ? (function () {
                const msgs = (cat.worldView.packs || []).find((p) => p &&
                  (p.pack === 'chat.messages' || p.pack === 'discord.messages'));
                const n = msgs && Number(msgs.messageCount);
                return n
                  ? React.createElement('span', null, ` · ${n} stored msg${n === 1 ? '' : 's'}`)
                  : null;
              }())
              : null)
          : null,
        view === 'voice'
          ? null
          : React.createElement('button', {
            type: 'button',
            className: 'dc-btn',
            disabled: this.state.loading || this.state.refreshing,
            onClick: () => this.refresh()
          }, this.state.refreshing || this.state.loading ? 'Refreshing…' : 'Refresh'),
        typeof this.props.onClose === 'function'
          ? React.createElement('button', {
            type: 'button',
            className: 'dc-btn primary',
            onClick: () => this.props.onClose()
          }, 'Back to chat')
          : null
      ),
      React.createElement('div', { className: 'dc-tabs', role: 'tablist' },
        React.createElement('button', {
          type: 'button',
          role: 'tab',
          className: 'dc-tab' + (view === 'voice' ? ' on' : ''),
          'aria-selected': view === 'voice',
          onClick: () => this.setState({ view: 'voice' })
        }, 'Voice'),
        showDiscord
          ? React.createElement('button', {
            type: 'button',
            role: 'tab',
            className: 'dc-tab' + (view === 'servers' ? ' on' : ''),
            'aria-selected': view === 'servers',
            onClick: () => this.setState({ view: 'servers' })
          }, 'Servers')
          : null,
        showDiscord
          ? React.createElement('button', {
            type: 'button',
            role: 'tab',
            className: 'dc-tab' + (view === 'network' ? ' on' : ''),
            'aria-selected': view === 'network',
            onClick: () => this.setState({ view: 'network' })
          }, 'Network')
          : null
      ),
      React.createElement('div', { className: 'dc-body' },
        this.state.error ? React.createElement('div', { className: 'dc-err' }, this.state.error) : null,
        this.state.notice ? React.createElement('div', { className: 'dc-banner ok' }, this.state.notice) : null,
        view === 'voice'
          ? this.renderVoice()
          : null,
        view === 'voice'
          ? null
          : (this.state.loading && !cat
            ? React.createElement('div', { className: 'dc-empty' }, 'Loading Discord guilds…')
            : null),
        view === 'voice'
          ? null
          : (view === 'network'
          ? React.createElement('div', { className: 'dc-guild-list' }, this.renderNetwork())
          : React.createElement(React.Fragment, null,
            this.renderBanner(),
            this.renderLinkPanel(),
            (() => {
              const allGuilds = Array.isArray(guilds) ? guilds : [];
              const filtered = filterCatalogGuilds(allGuilds, this.state.serverQuery);
              const channelCount = filtered.reduce(
                (n, g) => n + (Array.isArray(g.channels) ? g.channels.length : 0),
                0
              );
              return React.createElement(React.Fragment, null,
                this.renderServerFilter(filtered.length, channelCount),
                !this.state.loading && allGuilds.length === 0 && cat && cat.botReady
                  ? React.createElement('div', { className: 'dc-empty' },
                    'Bot is ready but not in any guilds yet — ',
                    (() => {
                      const url = discordBotAuthorizeUrl({ appId: cat.appId });
                      return url
                        ? React.createElement(React.Fragment, null,
                          React.createElement('a', {
                            className: 'dc-auth-link',
                            href: url,
                            target: '_blank',
                            rel: 'noopener noreferrer'
                          }, 'authorize it in Discord'),
                          '.')
                        : 'invite it from the Discord Developer Portal.';
                    })())
                  : null,
                !this.state.loading && allGuilds.length > 0 && filtered.length === 0
                  ? React.createElement('div', { className: 'dc-empty' },
                    'No servers, channels, or users match that filter.')
                  : null,
                React.createElement('div', { className: 'dc-guild-list' },
                  filtered.map((g) => this.renderGuild(g)),
                  React.createElement('div', { className: 'dc-foot' },
                    'Token, Application ID, and announce toggles live under the app Settings ⚙ → Discord bot. ',
                    'Discord never returns a full member list for large servers — this node accumulates guilds, channels, and people over time (bot snapshots, chat authors, and group shares). ',
                    'Peers without Discord credentials receive that picture from group members who run a bot. ',
                    'Pick a text or announcement channel for embeds; Chat lists those channels as a bridged thread. ',
                    'Open Network to explore who shares servers (co-membership). Link your Discord user under Fabric ↔ Discord identity.')
                )
              );
            })()
          ))
      )
    );
  }
}

DiscordChatSettings.CSS = CSS;

module.exports = DiscordChatSettings;
