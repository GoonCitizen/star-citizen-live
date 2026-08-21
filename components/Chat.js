'use strict';

/**
 * Chat — org chat brought forward from the Hub (ChatMessage types).
 *
 * Channel list on the left: one flattened rail of Fabric, Discord, and
 * bridged Fabric+Discord channels (filterable). A group that pins a Discord
 * channel is both — even when the bot relays as itself.
 * Member list (right) and message authors: hover for profile preview + Message
 * (DM); click opens the peer profile page. Messages sync over the Fabric Peer.
 */

const React = require('react');
const DeliverySync = require('./DeliverySync');
const DiscordChatSettings = require('./DiscordChatSettings');
const IdentityNotePanel = require('./IdentityNotePanel');
const {
  matchSlashMenu,
  listSlashCommands,
  displayCaption,
  messageAttachment,
  DEFAULT_CHAT_ATTACH_PRICE_SATS
} = require('../functions/chatAttachment');
const {
  chatChannelsFromCatalog,
  botDmChannelFromCatalog,
  parseDiscordChatChannel,
  parseDiscordDmChannel,
  discordDmChannelKey
} = require('../functions/discordGuildCatalog');
const {
  parseDiscordActor,
  linkForDiscordUser,
  mergeDiscordThreadMessages,
  applyLinksToMessages
} = require('../functions/discordIdentityLink');
const {
  CHANNEL_KIND_FILTERS,
  filterChannels,
  normalizeChannelQuery
} = require('../functions/chatChannelSearch');
const { pinnedChannelsFromGroups, sanitizePinnedChannels } = require('../functions/groupPinnedChannels');
const {
  flattenChatChannels,
  channelRowMatchesKey,
  pickKeyForRow
} = require('../functions/chatChannelList');
const {
  lastMessageAtByAuthor,
  sortChatMembers
} = require('../functions/chatMemberSort');
const { pubkeysMatch } = require('@fabric/http/functions/fabricPubkey');
const { shareClipboardText } = require('../functions/groupJoinFlow');
const {
  filterMembers,
  mergePeopleDirectory,
  searchPeople,
  canonicalPersonKey,
  commonDiscordGuilds,
  commonFabricGroups,
  normalizePeopleQuery
} = require('../functions/chatPeopleSearch');
const {
  isDiscordOutboundAllowed,
  normalizeDirections
} = require('../functions/discordChatDirection');
const {
  discordChannelIndicators,
  canBotPostToDiscord,
  canOperatorPostToDiscord
} = require('../functions/discordChannelAccess');
const {
  botPermissionNotice,
  looksLikeMissingPermissionError
} = require('../functions/discordBotAuthorize');
const { androidSurface } = require('../functions/androidSurface');
const { fetchPresenceRoster } = require('../functions/presenceClient');
const { JoinVoiceButton } = require('./ActiveVoicePanel');

const BASE = '/services/star-citizen';

const CSS = `
  /* Fill the window canvas (Dashboard toggles body.chat-fill). Sidebars + messages scroll internally. */
  .chat-wrap{width:100%;max-width:none;margin:0;padding:12px 14px;display:grid;
    grid-template-columns:minmax(180px,220px) minmax(0,1fr) minmax(180px,220px);gap:12px;
    height:100%;min-height:0;overflow:hidden;box-sizing:border-box}
  .chat-side{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:auto;
    min-height:0;min-width:0}
  .chat-side h3{font-size:12px;color:var(--muted);margin:0;padding:12px 14px 6px;text-transform:uppercase;letter-spacing:.4px;
    background:var(--panel)}
  .chat-side .chat-filter{position:sticky;top:0;z-index:3;background:var(--panel);padding:10px 10px 8px;
    border-bottom:1px solid var(--line);margin-bottom:2px}
  .chat-side .chat-filter-row{display:flex;gap:6px;align-items:center}
  .chat-side .chat-filter input{flex:1;min-width:0;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:7px 9px;font-size:12.5px}
  .chat-side .chat-filter input:focus{outline:none;border-color:var(--accent)}
  .chat-side .chat-filter-clear{background:var(--panel2);border:1px solid var(--line);color:var(--muted);
    border-radius:7px;width:28px;height:28px;flex:none;cursor:pointer;font-size:14px;line-height:1;
    display:inline-flex;align-items:center;justify-content:center}
  .chat-side .chat-filter-clear:hover{color:var(--text);border-color:var(--accent)}
  .chat-side .chat-filter-empty{color:var(--muted);font-size:11.5px;padding:10px 14px;line-height:1.5}
  .chat-side .chat-filter-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
  .chat-side .chat-filter-chip{font-size:10.5px;padding:3px 8px;border-radius:999px;border:1px solid var(--line);
    background:transparent;color:var(--muted);cursor:pointer;line-height:1.2}
  .chat-side .chat-filter-chip.on{background:rgba(59,130,246,.15);color:var(--accent);border-color:var(--accent)}
  .chat-side .chat-filter-chip.discord.on{background:rgba(88,101,242,.18);color:#5865F2;border-color:#5865F2}
  .chat-ch{display:flex;gap:8px;align-items:center;width:100%;text-align:left;background:none;border:none;
    color:var(--text);padding:9px 14px;font-size:13px;cursor:pointer;border-left:3px solid transparent}
  .chat-ch:hover{background:var(--panel2)}
  .chat-ch.on{background:var(--panel2);border-left-color:var(--accent)}
  .chat-ch .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .chat-ch .c{color:var(--muted);font-size:11px}
  .chat-ch .chat-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
  .chat-ch .chat-row-sub{font-size:10.5px;color:var(--muted);font-weight:400;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  .chat-plat{font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;flex:none;letter-spacing:.2px}
  .chat-plat.fabric{background:rgba(56,139,253,.14);color:var(--accent)}
  .chat-plat.discord{background:rgba(88,101,242,.18);color:#5865F2}
  .chat-ch .dir{font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px;flex:none;
    background:rgba(110,118,129,.15);color:var(--muted)}
  .chat-ch .dir.listen{background:rgba(248,81,73,.12);color:var(--kill)}
  .chat-ch .perm{font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;flex:none;letter-spacing:.2px}
  .chat-ch .perm.block{background:rgba(248,81,73,.12);color:var(--kill)}
  .chat-ch .perm.warn{background:rgba(247,147,26,.16);color:#f7931a}
  .chat-new-ch{margin:8px 10px 4px;background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer;width:calc(100% - 20px)}
  .chat-new-ch:hover{border-color:var(--accent)}
  .chat-new-ch:disabled{opacity:.45;cursor:default}
  .chat-create{padding:8px 10px 10px;border-bottom:1px solid var(--line);display:grid;gap:6px}
  .chat-create input,.chat-create select{width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--line);
    color:var(--text);border-radius:7px;padding:6px 8px;font-size:12px}
  .chat-create .row{display:flex;gap:6px;flex-wrap:wrap}
  .chat-create .hint{font-size:11px;color:var(--muted);line-height:1.4}
  .chat-main{background:var(--panel);border:1px solid var(--line);border-radius:12px;display:flex;flex-direction:column;
    min-width:0;min-height:0;overflow:hidden}
  .chat-main > .dc-page{flex:1 1 auto;min-height:0;height:100%;max-height:100%;overflow:hidden}
  .chat-head{padding:12px 16px;border-bottom:1px solid var(--line);font-size:13px;font-weight:600;display:flex;gap:10px;align-items:center;
    flex:0 0 auto}
  .chat-head .sub{color:var(--muted);font-weight:400;font-size:12px}
  .chat-head .chat-head-main{display:flex;gap:10px;align-items:center;min-width:0;flex:1}
  .chat-head .chat-head-actions{margin-left:auto;display:flex;gap:6px;align-items:center;flex:none}
  .chat-head .chat-cog,.chat-head .chat-pins-btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:8px;width:34px;height:34px;flex:none;cursor:pointer;font-size:15px;line-height:1;
    display:inline-flex;align-items:center;justify-content:center;position:relative}
  .chat-head .chat-cog:hover,.chat-head .chat-cog.on,
  .chat-head .chat-pins-btn:hover,.chat-head .chat-pins-btn.on{border-color:var(--accent);background:rgba(56,139,253,.1)}
  .chat-head .chat-pins-btn.on{border-color:#f7931a;background:rgba(247,147,26,.12)}
  .chat-head .chat-pins-btn .n{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;padding:0 4px;
    border-radius:999px;background:#f7931a;color:#111;font-size:9px;font-weight:800;line-height:16px}
  .chat-pins-drawer{flex:0 0 auto;border-bottom:1px solid var(--line);background:var(--panel2);
    max-height:min(280px,42%);overflow:auto}
  .chat-pins-head{display:flex;align-items:center;gap:8px;padding:8px 14px 6px;font-size:11.5px;font-weight:650;
    color:var(--muted);text-transform:uppercase;letter-spacing:.3px}
  .chat-pins-head button{margin-left:auto;background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;line-height:1}
  .chat-pins-row{display:grid;gap:2px;width:100%;text-align:left;background:none;border:none;border-top:1px solid #20262f;
    color:var(--text);padding:8px 14px;cursor:pointer}
  .chat-pins-row:hover{background:rgba(56,139,253,.08)}
  .chat-pins-row .meta{font-size:11px;color:var(--muted)}
  .chat-pins-row .preview{font-size:12.5px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .chat-pins-empty{color:var(--muted);font-size:12.5px;padding:8px 14px 12px;font-style:italic}
  .chat-side .chat-ch.discord{border-left-color:transparent}
  .chat-side .chat-ch.discord.on{border-left-color:#5865F2}
  .chat-side .chat-ch.discord-ch{padding-left:18px}
  .chat-side .chat-ch.pinned{border-left-color:rgba(247,147,26,.55)}
  .chat-side .chat-ch.pinned.on{border-left-color:#f7931a}
  .chat-side .chat-pin{color:#f7931a;font-size:11px;flex:none}
  .chat-side h3.pinned-h{color:#f7931a}
  .chat-side h3.discord-h{color:#5865F2}
  .chat-guild{font-size:11px;color:var(--muted);padding:8px 14px 2px;font-weight:650;
    text-transform:uppercase;letter-spacing:.3px}
  .chat-mem .tag.bot{background:rgba(88,101,242,.15);color:#5865F2}
  .chat-msgs{flex:1 1 auto;min-height:0;overflow:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px}
  .chat-msg{position:relative}
  .chat-msg.pinned{border-left:2px solid #f7931a;padding-left:8px;margin-left:-8px}
  .chat-msg.jump{outline:1px solid var(--accent);outline-offset:2px;border-radius:4px}
  .chat-msg .m{display:flex;gap:8px;align-items:baseline}
  .chat-msg .chat-author{display:inline-flex;gap:8px;align-items:baseline;cursor:pointer;
    border-radius:4px;padding:1px 3px;margin:-1px -3px}
  .chat-msg .chat-author:hover{background:rgba(56,139,253,.08)}
  .chat-msg .chat-author:focus{outline:1px solid var(--accent);outline-offset:1px}
  .chat-msg .who{font-weight:600;font-size:12.5px}
  .chat-msg .who.me{color:var(--accent)}
  .chat-msg .key{color:var(--muted);font-size:10.5px;font-family:'Cascadia Code',Consolas,monospace}
  .chat-msg .t{color:var(--muted);font-size:10.5px;font-variant-numeric:tabular-nums}
  .chat-msg .chat-msg-pin{margin-left:auto;background:none;border:none;cursor:pointer;padding:0 2px;
    font-size:12px;line-height:1;color:var(--muted);opacity:0;flex:none}
  .chat-msg:hover .chat-msg-pin,.chat-msg:focus-within .chat-msg-pin,.chat-msg .chat-msg-pin.on{opacity:1}
  .chat-msg .chat-msg-pin.on{color:#f7931a}
  .chat-msg .chat-msg-pin:disabled{cursor:default;opacity:.35}
  .chat-msg .b{font-size:13.5px;line-height:1.5;word-break:break-word;white-space:pre-wrap}
  .chat-attach-card{margin-top:6px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;
    background:var(--panel2);display:grid;gap:4px;max-width:420px}
  .chat-attach-card .nm{font-size:12.5px;font-weight:600}
  .chat-attach-card .meta{font-size:11.5px;color:var(--muted)}
  .chat-attach-card .tag{font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;
    background:rgba(247,147,26,.16);color:#f7931a;margin-left:6px}
  .chat-empty{color:var(--muted);font-style:italic;text-align:center;margin:auto;font-size:13px;line-height:1.7}
  .chat-compose-wrap{position:relative;flex:0 0 auto;border-top:1px solid var(--line)}
  .chat-attach-chip{display:flex;gap:8px;align-items:center;padding:8px 14px 0;font-size:12px;color:var(--muted)}
  .chat-attach-chip b{color:var(--text);font-weight:600}
  .chat-attach-chip button{background:none;border:none;color:var(--kill);cursor:pointer;font-size:12px;padding:0}
  .chat-compose{display:flex;gap:8px;padding:12px 14px;align-items:center}
  .chat-compose input{flex:1;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:8px;padding:10px 12px;font-size:13.5px;min-width:0}
  .chat-tool{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:8px;
    width:38px;height:38px;flex:none;cursor:pointer;font-size:16px;line-height:1;display:inline-flex;
    align-items:center;justify-content:center}
  .chat-tool:hover{border-color:var(--accent)}
  .chat-tool:disabled{opacity:.45;cursor:default}
  .chat-send{background:var(--accent);border:none;color:#fff;border-radius:8px;padding:0 18px;height:38px;
    font-size:13px;font-weight:600;cursor:pointer}
  .chat-send:disabled{opacity:.45;cursor:default}
  .chat-slash{position:absolute;left:14px;right:14px;bottom:calc(100% - 4px);z-index:20;
    background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden;
    box-shadow:0 10px 28px rgba(0,0,0,.4);max-height:220px;overflow-y:auto}
  .chat-slash button{display:grid;gap:2px;width:100%;text-align:left;background:none;border:none;
    color:var(--text);padding:9px 12px;cursor:pointer;border-bottom:1px solid #20262f}
  .chat-slash button:last-child{border-bottom:none}
  .chat-slash button:hover,.chat-slash button.on{background:var(--panel2)}
  .chat-slash .cmd{font-weight:650;font-size:12.5px;font-family:'Cascadia Code',Consolas,monospace}
  .chat-slash .hint{font-size:11.5px;color:var(--muted)}
  .chat-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;margin:0 14px 10px;padding:8px 11px;font-size:12.5px;
    flex:0 0 auto;line-height:1.5}
  .chat-perm-notice{background:rgba(247,147,26,.1);color:#f7931a;border-radius:7px;margin:0 14px 10px;padding:8px 11px;
    font-size:12.5px;flex:0 0 auto;line-height:1.5}
  .chat-err a,.chat-perm-notice a{color:#5865F2;font-weight:650}
  .chat-members{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:auto;display:flex;
    flex-direction:column;min-height:0;min-width:0}
  .chat-members h3{font-size:12px;color:var(--muted);margin:0;padding:12px 14px 6px;text-transform:uppercase;letter-spacing:.4px}
  .chat-members .chat-people-head{position:sticky;top:0;z-index:2;background:var(--panel);border-bottom:1px solid var(--line)}
  .chat-members .chat-filter{padding:0 10px 8px}
  .chat-members .chat-filter-row{display:flex;gap:6px;align-items:center}
  .chat-members .chat-filter input{flex:1;min-width:0;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:7px 9px;font-size:12.5px}
  .chat-members .chat-filter input:focus{outline:none;border-color:var(--accent)}
  .chat-members .chat-filter-clear{background:var(--panel2);border:1px solid var(--line);color:var(--muted);
    border-radius:7px;width:28px;height:28px;flex:none;cursor:pointer;font-size:14px;line-height:1;
    display:inline-flex;align-items:center;justify-content:center}
  .chat-members .chat-filter-clear:hover{color:var(--text);border-color:var(--accent)}
  .chat-members .chat-people-sec{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.3px;
    padding:8px 12px 4px}
  .chat-mem{display:grid;gap:2px;padding:8px 12px;border-bottom:1px solid #20262f;cursor:pointer}
  .chat-mem:hover{background:rgba(56,139,253,.06)}
  .chat-mem:last-child{border-bottom:none}
  .chat-mem .row{display:flex;gap:8px;align-items:center;min-width:0}
  .chat-mem .dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--muted)}
  .chat-mem .dot.on{background:var(--good);box-shadow:0 0 0 2px rgba(63,185,80,.25)}
  .chat-mem .nm{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
  .chat-mem .nm.me{color:var(--accent)}
  .chat-mem .pk{font-size:10.5px;color:var(--muted);font-family:'Cascadia Code',Consolas,monospace}
  .chat-mem .ship{font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .chat-mem .ship b{color:var(--text);font-weight:600}
  .chat-mem .tag{font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(56,139,253,.12);color:var(--accent)}
  .chat-mem-hint{color:var(--muted);font-size:11.5px;padding:10px 14px;line-height:1.5}
  .chat-mem-wrap{position:relative}
  /* Fixed so overflow:auto on .chat-members cannot clip the popover. */
  .chat-mem-card{position:fixed;z-index:40;width:340px;
    background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 13px;
    box-shadow:0 12px 28px rgba(0,0,0,.45);display:grid;gap:8px;cursor:default;pointer-events:auto}
  .chat-mem-card .nm{font-size:14px;font-weight:650}
  .chat-mem-card .pk{font-size:10.5px;color:var(--muted);font-family:'Cascadia Code',Consolas,monospace;word-break:break-all}
  .chat-mem-card .bio{font-size:12.5px;line-height:1.45;color:var(--text);max-height:4.2em;overflow:hidden}
  .chat-mem-card .meta{font-size:12px;color:var(--muted);line-height:1.4;display:flex;flex-wrap:wrap;gap:4px;align-items:center}
  .chat-mem-card .meta b{color:var(--text);font-weight:600}
  .chat-mem-card .dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--muted)}
  .chat-mem-card .dot.on{background:var(--good);box-shadow:0 0 0 2px rgba(63,185,80,.25)}
  .chat-mem-card .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
  .chat-mem-card .btn{background:var(--accent);border:none;color:#fff;border-radius:7px;padding:6px 11px;
    font-size:12px;font-weight:600;cursor:pointer}
  .chat-mem-card .btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
  .chat-mem-card .btn:disabled{opacity:.45;cursor:default}
  .chat-mem-card .invite{display:grid;gap:6px;padding-top:4px;border-top:1px solid var(--line)}
  .chat-mem-card .invite label{font-size:11px;color:var(--muted)}
  .chat-mem-card .invite select{width:100%;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:6px 8px;font-size:12px}
  .chat-mem-card .invite .hint{font-size:11px;color:var(--muted);line-height:1.4}
  .chat-mem-card .invite .ok{font-size:11.5px;color:var(--good)}
  .chat-mem-card .invite .err{font-size:11.5px;color:var(--kill)}
  .chat-overlap{display:grid;gap:4px;padding-top:6px;border-top:1px solid var(--line)}
  .chat-overlap h4{margin:0;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.3px}
  .chat-overlap .list{font-size:12px;color:var(--text);line-height:1.45}
  .chat-overlap .hint{font-size:11px;color:var(--muted);line-height:1.4}
  /* Group page (and similar): messages + compose only, no channel/member rails. */
  .chat-wrap.chat-embedded{grid-template-columns:1fr;height:min(440px,55vh);padding:0;gap:0}
  .chat-wrap.chat-embedded .chat-side,
  .chat-wrap.chat-embedded .chat-members{display:none}
  .chat-wrap.chat-embedded .chat-main{border-radius:0;border:none;min-height:0}
  .chat-wrap.chat-people-only{grid-template-columns:1fr;height:100%;min-height:0;padding:0;gap:0}
  .chat-wrap.chat-people-only .chat-members{border:none;border-radius:0;height:100%}
  @media(max-width:980px){
    .chat-wrap{grid-template-columns:1fr;grid-template-rows:minmax(120px,22%) minmax(0,1fr) minmax(120px,22%);gap:10px}
    .chat-wrap.chat-embedded{grid-template-rows:minmax(0,1fr);height:min(440px,55vh)}
    .chat-wrap.chat-people-only{grid-template-rows:minmax(0,1fr)}
    .chat-side,.chat-members{max-height:none}
    .chat-mem-card{width:min(260px,calc(100vw - 24px))}
  }
`;

function shortKey (pk) {
  return pk ? pk.slice(0, 8) + '…' : '?';
}

function identityBridge () {
  return (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.identity) || null;
}

function shortTime (ts) {
  const m = String(ts || '').match(/T(\d{2}:\d{2})/);
  return m ? m[1] : '';
}

/** Match ChatManager.dmChannelKey (sorted pubkey pair). */
function dmChannelKey (a, b) {
  const x = String(a || '').trim();
  const y = String(b || '').trim();
  if (!x || !y || x === y) return null;
  const [lo, hi] = [x, y].sort();
  return `dm:${lo}:${hi}`;
}

function isDiscordActor (id) {
  return !!parseDiscordActor(id);
}

const PREFERRED_CHANNEL_KEY = 'gc.chat.channel';
const PREFERRED_PEOPLE_KEY = 'gc.chat.people';

function initialChannel (props) {
  if (props && props.groupId) return 'group:' + props.groupId;
  if (props && props.channel) return props.channel;
  try {
    const pref = sessionStorage.getItem(PREFERRED_CHANNEL_KEY);
    if (pref) {
      sessionStorage.removeItem(PREFERRED_CHANNEL_KEY);
      return pref;
    }
  } catch (_) { /* ignore */ }
  return 'global';
}

function initialPeopleQuery () {
  try {
    const pref = sessionStorage.getItem(PREFERRED_PEOPLE_KEY);
    if (pref) {
      sessionStorage.removeItem(PREFERRED_PEOPLE_KEY);
      return pref;
    }
  } catch (_) { /* ignore */ }
  return '';
}

class Chat extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      channels: [],
      channel: initialChannel(props),
      messages: [],
      draft: '',
      error: null,
      authorizeUrl: null,
      sending: false,
      loading: true,
      members: [],
      membersLabel: 'Members',
      hoverPubkey: null,
      hoverRect: null, // DOMRect-like for fixed popover placement
      profileCache: {},
      openDmChannels: [], // { key, label, kind, peerPubkey } opened from the member card
      inviteOpen: false,
      inviteGroups: [],
      inviteGroupId: '',
      inviteLoading: false,
      inviteBusy: false,
      inviteError: null,
      inviteOk: null,
      authToken: null,
      pendingFile: null, // { name, mime, size, contentBase64 }
      attachPriceSats: null, // null → props / default 25
      slashOpen: false,
      slashIndex: 0,
      documentsEnableLocal: null,
      /** 'messages' | 'discord' — Discord bot page from Chat settings cog */
      page: 'messages',
      discordCatalog: null,
      discordChannels: [],
      /** { [channelId]: 'listen' | 'bidirectional' } — missing → bidirectional */
      discordChatDirections: {},
      groupPinned: [],
      channelQuery: '',
      channelKind: 'all',
      /** guildId → expanded when Discord list is collapsed by default */
      openDiscordGuildIds: {},
      peopleQuery: initialPeopleQuery(),
      fabricGroups: [],
      showCreateChannel: false,
      createChannelName: '',
      createChannelParentId: '',
      creatingChannel: false,
      createChannelError: null,
      pinBusy: null,
      pinsOpen: false,
      highlightMessageId: null
    };
    this._timer = null;
    this._hoverTimer = null;
    this._msgsRef = React.createRef();
    this._fileRef = React.createRef();
    this._memRefs = {};
    this._discordCatalogFetchedAt = 0;
    this._groupPinsFetchedAt = 0;
  }

  lockedChannel () {
    if (this.props.groupId) return 'group:' + this.props.groupId;
    if (this.props.channel) return this.props.channel;
    return null;
  }

  showDiscordBotUi () {
    return androidSurface('discordBot');
  }

  componentDidMount () {
    this.refresh();
    this._timer = setInterval(() => this.refresh(), 3000);
    this.loadOperatorSettings();
  }

  async loadOperatorSettings () {
    try {
      const res = await fetch('/settings').then((r) => r.json());
      const settings = (res && res.settings) || {};
      const documents = (res.runtime && res.runtime.documents) || null;
      const dirs = normalizeDirections(settings.discordChatDirections) || {};
      const patch = { discordChatDirections: dirs };
      if (this.props.documentsEnable == null && documents) {
        patch.documentsEnableLocal = documents.enable === true;
        if (this.state.attachPriceSats == null && documents.defaultPriceSats != null) {
          patch.attachPriceSats = Number(documents.defaultPriceSats);
        }
      }
      this.setState(patch);
    } catch (_) { /* ignore */ }
  }

  /** @deprecated alias — documents flag loads with operator settings */
  async loadDocumentsFlag () {
    return this.loadOperatorSettings();
  }

  discordDirectionsMap () {
    return normalizeDirections(this.state.discordChatDirections) || {};
  }

  isDiscordListenOnly (channelId) {
    if (!channelId) return false;
    return !isDiscordOutboundAllowed(channelId, { discordChatDirections: this.discordDirectionsMap() });
  }

  discordAccessForRow (ch) {
    const row = ch || this.channelRowFor(this.state.channel);
    if (!row) {
      return {
        indicators: [],
        canPost: true,
        botCanPost: true,
        discordSurface: false,
        discordOnly: false,
        listenOnly: false,
        isDm: false,
        botReady: false
      };
    }
    const platforms = row.platforms || [];
    const hasDiscord = platforms.indexOf('discord') >= 0 ||
      row.kind === 'discord' || row.kind === 'discord-dm';
    const discordId = parseDiscordChatChannel(row.discordKey || row.key);
    const isDm = row.kind === 'discord-dm' || !!parseDiscordDmChannel(row.key);
    const discordOnly = !!(hasDiscord && !row.bridged);
    const listenOnly = !!(discordId && this.isDiscordListenOnly(discordId));
    const botReady = !!(this.state.discordCatalog && this.state.discordCatalog.botReady);
    const opts = {
      botReady,
      bot: row.bot || null,
      listenOnly,
      identityUnlocked: !!this.props.identityPubkey,
      discordSurface: hasDiscord,
      discordOnly,
      isDm
    };
    return {
      indicators: discordChannelIndicators(opts),
      canPost: canOperatorPostToDiscord(opts),
      botCanPost: canBotPostToDiscord(opts),
      discordSurface: hasDiscord,
      discordOnly,
      listenOnly,
      isDm,
      botReady,
      bot: row.bot || null,
      guildId: row.guildId || null
    };
  }

  discordAppId () {
    const cat = this.state.discordCatalog || {};
    const world = cat.worldView || {};
    return cat.appId || world.sourceAppId || null;
  }

  discordBotPermissionNotice (access) {
    if (!access || access.discordSurface !== true || access.isDm) return null;
    return botPermissionNotice({
      bot: access.bot || null,
      appId: this.discordAppId(),
      guildId: access.guildId || null,
      authorizeUrl: this.state.authorizeUrl || null
    });
  }

  renderAuthorizeNotice (notice, className) {
    if (!notice) return null;
    return React.createElement('div', { className: className || 'chat-perm-notice' },
      notice.text,
      notice.url
        ? React.createElement(React.Fragment, null,
          ' ',
          React.createElement('a', {
            className: 'dc-auth-link',
            href: notice.url,
            target: '_blank',
            rel: 'noopener noreferrer'
          }, notice.linkLabel)
        )
        : null
    );
  }

  renderChatAccessBanner (access) {
    const notice = this.discordBotPermissionNotice(access);
    if (this.state.error) {
      const url = this.state.authorizeUrl ||
        (looksLikeMissingPermissionError(this.state.error) && notice && notice.url) ||
        null;
      const linkLabel = notice && notice.linkLabel
        ? notice.linkLabel
        : 'Authorize permission';
      return React.createElement('div', { className: 'chat-err' },
        this.state.error,
        url
          ? React.createElement(React.Fragment, null,
            ' ',
            React.createElement('a', {
              className: 'dc-auth-link',
              href: url,
              target: '_blank',
              rel: 'noopener noreferrer'
            }, linkLabel)
          )
          : null
      );
    }
    if (notice) {
      return this.renderAuthorizeNotice(notice, 'chat-perm-notice');
    }
    return null;
  }

  renderPermBadges (ch) {
    const { indicators } = this.discordAccessForRow(ch);
    if (!indicators.length) return null;
    return indicators.map((ind) => React.createElement('span', {
      key: ind.id,
      className: 'perm ' + ind.tone,
      title: ind.title
    }, ind.label));
  }

  onDiscordDirectionsChanged (nextMap) {
    this.setState({ discordChatDirections: normalizeDirections(nextMap) || {} });
  }

  documentsEnabled () {
    if (this.props.documentsEnable === true) return true;
    if (this.props.documentsEnable === false) return false;
    return this.state.documentsEnableLocal === true;
  }

  flattenedChannels () {
    return flattenChatChannels({
      fabricChannels: this.state.channels || [],
      discordChannels: this.state.discordChannels || [],
      openDmChannels: this.state.openDmChannels || [],
      groups: this.state.fabricGroups || [],
      botDm: botDmChannelFromCatalog(this.state.discordCatalog)
    });
  }

  channelRowFor (key) {
    const k = key || this.state.channel;
    return this.flattenedChannels().find((ch) => channelRowMatchesKey(ch, k)) || null;
  }

  componentDidUpdate (prevProps) {
    const next = this.lockedChannel();
    const prev = prevProps.groupId
      ? 'group:' + prevProps.groupId
      : (prevProps.channel || null);
    if (next && next !== prev && next !== this.state.channel) {
      this.setState({ channel: next, messages: [], members: [], loading: true }, () => this.refresh());
    }
  }

  componentWillUnmount () {
    if (this._timer) clearInterval(this._timer);
    if (this._hoverTimer) clearTimeout(this._hoverTimer);
  }

  async refresh () {
    if (this.props.peopleOnly) {
      try {
        this.setState({ loading: false });
        await this.refreshMembers([], [], null);
        await this.refreshGroupPins();
      } catch (_) {
        this.setState({ loading: false });
      }
      return;
    }
    try {
      await this.refreshDiscordCatalog(false);
      const discordDmUserId = parseDiscordDmChannel(this.state.channel);
      const [chRes, msgRes] = await Promise.all([
        fetch(`${BASE}/chat/channels`).then((r) => r.json()),
        fetch(`${BASE}/chat/messages?channel=${encodeURIComponent(this.state.channel)}&limit=200`).then((r) => r.json())
      ]);
      const fromApi = chRes.data || [];
      const keys = new Set(fromApi.map((c) => c.key));
      const channels = fromApi.concat(
        (this.state.openDmChannels || []).filter((c) => c && c.key && !keys.has(c.key))
      );
      let messages = msgRes.data || [];
      let insight = null;
      const flattened = flattenChatChannels({
        fabricChannels: channels,
        discordChannels: this.state.discordChannels || [],
        openDmChannels: this.state.openDmChannels || [],
        groups: this.state.fabricGroups || [],
        botDm: botDmChannelFromCatalog(this.state.discordCatalog)
      });
      const row = flattened.find((ch) => channelRowMatchesKey(ch, this.state.channel)) || null;
      const discordId = parseDiscordChatChannel(this.state.channel) ||
        (row && row.discordKey ? parseDiscordChatChannel(row.discordKey) : null);
      if (discordId) {
        const insightRes = await fetch(
          `${BASE}/discord/channels/${encodeURIComponent(discordId)}?limit=50`,
          { headers: { Accept: 'application/json' } }
        );
        const insightJson = await insightRes.json().catch(() => ({}));
        insight = (insightJson && insightJson.data) || {};
        const insightMsgs = Array.isArray(insight.messages) ? insight.messages : [];
        const links = (this.state.discordCatalog && this.state.discordCatalog.identityLinks) || [];
        messages = applyLinksToMessages(
          mergeDiscordThreadMessages(messages, insightMsgs),
          links
        );
      } else if (discordDmUserId) {
        const links = (this.state.discordCatalog && this.state.discordCatalog.identityLinks) || [];
        messages = applyLinksToMessages(messages, links);
      }
      const el = this._msgsRef.current;
      const pinned = el && (el.scrollHeight - el.scrollTop - el.clientHeight < 60);
      this.setState({ channels, messages, loading: false }, () => {
        if (pinned && this._msgsRef.current) this._msgsRef.current.scrollTop = this._msgsRef.current.scrollHeight;
      });
      await this.refreshMembers(channels, messages, insight);
      await this.refreshGroupPins();
    } catch (_) {
      this.setState({ loading: false });
    }
  }

  async refreshGroupPins () {
    if (this.props.embedded && !this.props.peopleOnly) return;
    const now = Date.now();
    if (this._groupPinsFetchedAt &&
        (now - this._groupPinsFetchedAt) < 15000 &&
        Array.isArray(this.state.groupPinned)) {
      return;
    }
    try {
      let token = this.state.authToken;
      if (!token) token = await this.ensureAuth();
      const headers = { Accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${BASE}/groups`, { headers });
      const json = await res.json().catch(() => ({}));
      const groups = Array.isArray(json.data) ? json.data : [];
      const me = this.props.identityPubkey;
      const mine = me
        ? groups.filter((g) => Array.isArray(g.members) && g.members.includes(me))
        : groups.filter((g) => Array.isArray(g.pinnedChannels) && g.pinnedChannels.length);
      const groupPinned = pinnedChannelsFromGroups(mine, {
        discordChannels: this.state.discordChannels || []
      });
      this._groupPinsFetchedAt = Date.now();
      this.setState({ groupPinned, fabricGroups: groups });
    } catch (_) { /* optional */ }
  }

  async refreshDiscordCatalog (force) {
    const now = Date.now();
    if (!force && this._discordCatalogFetchedAt &&
        (now - this._discordCatalogFetchedAt) < 25000 && this.state.discordCatalog) {
      return this.state.discordCatalog;
    }
    try {
      const q = force ? '?refresh=1' : '';
      const res = await fetch(BASE + '/discord/guilds' + q, {
        headers: { Accept: 'application/json' }
      });
      const body = await res.json().catch(() => ({}));
      const catalog = (body && body.data) || body || {};
      this._discordCatalogFetchedAt = Date.now();
      this.setState({
        discordCatalog: catalog,
        discordChannels: chatChannelsFromCatalog(catalog)
      });
      return catalog;
    } catch (_) {
      return this.state.discordCatalog;
    }
  }

  openProfile (pubkey) {
    if (!pubkey) return;
    window.location.href = `/profiles/${encodeURIComponent(pubkey)}`;
  }

  async ensureAuth () {
    if (this.state.authToken) return this.state.authToken;
    if (this.props.authToken) return this.props.authToken;
    const bridge = identityBridge();
    if (!bridge) return null;
    try {
      const info = await bridge.get();
      if (!info || !info.unlocked || !bridge.signEnvelope) return null;
      const envelope = await bridge.signEnvelope({ intent: 'login', ts: new Date().toISOString() });
      if (!envelope || envelope.error) return null;
      const res = await fetch(`${BASE}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope)
      });
      if (!res.ok) return null;
      const json = await res.json();
      const token = json.data && json.data.token;
      if (token) this.setState({ authToken: token });
      return token || null;
    } catch (_) {
      return null;
    }
  }

  async openInvitePicker () {
    const me = this.props.identityPubkey;
    if (!me || !this.state.hoverPubkey || this.state.hoverPubkey === me) return;
    this.setState({
      inviteOpen: true,
      inviteLoading: true,
      inviteError: null,
      inviteOk: null,
      inviteGroups: [],
      inviteGroupId: ''
    });
    try {
      const token = await this.ensureAuth();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${BASE}/groups`, { headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const target = this.state.hoverPubkey;
      const groups = (json.data || []).filter((g) => {
        const members = Array.isArray(g.members) ? g.members : [];
        if (!members.some((m) => pubkeysMatch(m, me))) return false;
        if (target && members.some((m) => pubkeysMatch(m, target))) return false;
        return true;
      });
      const preferred = this.props.groupId && groups.some((g) => g.id === this.props.groupId)
        ? this.props.groupId
        : (groups[0] ? groups[0].id : '');
      this.setState({
        inviteLoading: false,
        inviteGroups: groups,
        inviteGroupId: preferred
      });
    } catch (e) {
      this.setState({ inviteLoading: false, inviteError: e.message || String(e) });
    }
  }

  async sendGroupInvite () {
    const groupId = this.state.inviteGroupId;
    const invitee = this.state.hoverPubkey;
    const me = this.props.identityPubkey;
    if (!groupId || !invitee || !me || this.state.inviteBusy) return;
    this.setState({ inviteBusy: true, inviteError: null, inviteOk: null });
    try {
      const token = await this.ensureAuth();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const g = (this.state.inviteGroups || []).find((x) => x.id === groupId);
      const res = await fetch(`${BASE}/groups/${encodeURIComponent(groupId)}/invites`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          inviteePubkey: invitee,
          note: `You're invited to join ${(g && g.name) || 'our group'}`
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const data = json.data || {};
      const url = shareClipboardText(data);
      if (url) {
        try { await navigator.clipboard.writeText(url); } catch (_) { /* ignore */ }
      }
      const mesh = data.relayed
        ? `Invite sent as the same Fabric message that was copied (${data.peers || 0} peer connection(s)). They Accept in Notifications.`
        : (`Invite copied` + (data.relayError ? ` — mesh: ${data.relayError}` : ''));
      this.setState({ inviteBusy: false, inviteOk: mesh });
    } catch (e) {
      this.setState({ inviteBusy: false, inviteError: e.message || String(e) });
    }
  }

  scheduleHover (pubkey, el) {
    if (this._hoverTimer) clearTimeout(this._hoverTimer);
    const rect = el && el.getBoundingClientRect
      ? el.getBoundingClientRect()
      : (this._memRefs[pubkey] && this._memRefs[pubkey].getBoundingClientRect
        ? this._memRefs[pubkey].getBoundingClientRect()
        : null);
    this._hoverTimer = setTimeout(() => {
      this.setState({
        hoverPubkey: pubkey,
        hoverRect: rect
          ? { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
          : null,
        inviteOpen: false,
        inviteError: null,
        inviteOk: null
      });
      this.ensureProfile(pubkey);
    }, 120);
  }

  scheduleHoverLeave () {
    if (this._hoverTimer) clearTimeout(this._hoverTimer);
    this._hoverTimer = setTimeout(() => {
      this.setState({ hoverPubkey: null, hoverRect: null });
    }, 280);
  }

  cancelHoverLeave () {
    if (this._hoverTimer) clearTimeout(this._hoverTimer);
  }

  cardStyle () {
    const r = this.state.hoverRect;
    if (!r) return { top: 80, right: 16 };
    const cardW = 340;
    const gap = 8;
    // Prefer to the right of message authors (left of the pane); fall back left of members rail.
    let left = r.right + gap;
    if (left + cardW > window.innerWidth - 8) {
      left = r.left - cardW - gap;
    }
    if (left < 8) left = Math.min(r.right + gap, window.innerWidth - cardW - 8);
    let top = r.top;
    const maxTop = window.innerHeight - 220;
    if (top > maxTop) top = Math.max(8, maxTop);
    return { top, left };
  }

  renderAuthor (author, handle) {
    if (!author) return null;
    const me = this.props.identityPubkey || null;
    const discord = isDiscordActor(author);
    const who = handle || (discord ? 'Discord' : shortKey(author));
    // Avoid "abc12345… abc12345…" when there is no nickname — keep the full
    // pubkey on the element title for hover / copy.
    const showKey = discord
      ? true
      : !!(handle && String(handle).trim() && String(handle).trim() !== shortKey(author));
    return React.createElement('span', {
      className: 'chat-author',
      title: discord ? (author + ' — click for profile') : (author + ' — hover for preview · click for profile'),
      role: 'link',
      tabIndex: 0,
      onMouseEnter: (e) => this.scheduleHover(author, e.currentTarget),
      onMouseLeave: () => this.scheduleHoverLeave(),
      onClick: () => this.openProfile(author),
      onKeyDown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.openProfile(author);
        }
      }
    },
    React.createElement('span', { className: 'who' + (me && author === me ? ' me' : '') }, who),
    showKey
      ? React.createElement('span', { className: 'key', title: author },
        discord ? 'discord' : shortKey(author))
      : null
    );
  }

  async ensureProfile (pubkey) {
    if (!pubkey || this.state.profileCache[pubkey]) return;
    if (isDiscordActor(pubkey)) {
      const m = (this.state.members || []).find((row) => row.pubkey === pubkey);
      this.setState((s) => ({
        profileCache: Object.assign({}, s.profileCache, {
          [pubkey]: {
            discord: true,
            profile: { nickname: (m && m.handle) || null },
            presence: { online: !!(m && m.online) }
          }
        })
      }));
      return;
    }
    try {
      const res = await fetch(`${BASE}/profiles/${encodeURIComponent(pubkey)}`);
      const json = await res.json();
      if (!res.ok) return;
      this.setState((s) => ({
        profileCache: Object.assign({}, s.profileCache, { [pubkey]: json.data || null })
      }));
    } catch (_) { /* ignore */ }
  }

  openDm (peerPubkey, handle) {
    const me = this.props.identityPubkey;
    if (!me || !peerPubkey || me === peerPubkey) return;
    const key = dmChannelKey(me, peerPubkey);
    if (!key) return;
    // Embedded / page-rail chat has no channel list — hand off to the Chat tab.
    if (this.props.embedded || this.props.peopleOnly) {
      try { sessionStorage.setItem(PREFERRED_CHANNEL_KEY, key); } catch (_) { /* ignore */ }
      window.location.href = '/#chat';
      return;
    }
    const ch = {
      key,
      label: 'DM ' + (handle || shortKey(peerPubkey)),
      kind: 'dm',
      peerPubkey
    };
    this.setState((s) => {
      const openDmChannels = (s.openDmChannels || []).some((c) => c.key === key)
        ? s.openDmChannels
        : (s.openDmChannels || []).concat([ch]);
      return { openDmChannels, hoverPubkey: null, channel: key, messages: [], loading: true };
    }, () => this.refresh());
  }

  /** Open a Discord user DM thread (`discord:dm:<userId>`), including the local bot. */
  openDiscordDm (discordUserId, handle, opts = {}) {
    const id = String(discordUserId || '').trim();
    const key = discordDmChannelKey(id);
    if (!parseDiscordDmChannel(key)) return;
    if (this.props.embedded || this.props.peopleOnly) {
      try { sessionStorage.setItem(PREFERRED_CHANNEL_KEY, key); } catch (_) { /* ignore */ }
      window.location.href = '/#chat';
      return;
    }
    const ch = {
      key,
      label: 'DM ' + (handle || id),
      kind: 'discord-dm',
      discordUserId: id,
      bot: !!opts.bot
    };
    this.setState((s) => {
      const openDmChannels = (s.openDmChannels || []).some((c) => c.key === key)
        ? s.openDmChannels
        : (s.openDmChannels || []).concat([ch]);
      return { openDmChannels, hoverPubkey: null, channel: key, messages: [], loading: true };
    }, () => this.refresh());
  }

  async refreshMembers (channels, messages, insight) {
    const discordId = parseDiscordChatChannel(this.state.channel);
    const discordDmUserId = parseDiscordDmChannel(this.state.channel);
    if (discordDmUserId) {
      const cat = this.state.discordCatalog || {};
      const botId = cat.botUserId != null ? String(cat.botUserId) : null;
      const isBot = !!(botId && botId === discordDmUserId);
      const links = cat.identityLinks || [];
      const link = linkForDiscordUser(links, discordDmUserId);
      const me = this.props.identityPubkey || null;
      const members = [];
      if (me) {
        members.push({
          pubkey: me,
          handle: this.props.nickname || 'You',
          online: true,
          kind: 'self'
        });
      }
      members.push({
        pubkey: link ? link.pubkey : ('discord:' + discordDmUserId),
        handle: isBot
          ? (cat.botUser || 'Bot')
          : ((link && link.username) || discordDmUserId),
        online: true,
        bot: isBot,
        kind: link ? 'linked' : 'discord',
        linked: !!link,
        discordUserId: discordDmUserId
      });
      this.setState({
        members,
        membersLabel: isBot ? 'Bot DM' : 'Discord DM'
      });
      return;
    }
    if (discordId) {
      const roster = (insight && Array.isArray(insight.members))
        ? insight.members
        : [];
      const links = (this.state.discordCatalog && this.state.discordCatalog.identityLinks) || [];
      const msgs = messages || this.state.messages || [];
      const lastAt = lastMessageAtByAuthor(msgs);
      const members = sortChatMembers(roster.map((m) => {
        const link = linkForDiscordUser(links, m.id);
        const discordKey = 'discord:' + m.id;
        const pubkey = link ? link.pubkey : discordKey;
        const lastMessageAt = Math.max(
          lastAt.get(pubkey) || 0,
          lastAt.get(discordKey) || 0
        );
        if (link) {
          return {
            pubkey,
            handle: m.displayName || m.username || link.username,
            online: m.status === 'online' || m.status === 'idle' || m.status === 'dnd',
            bot: !!m.bot,
            kind: 'linked',
            linked: true,
            discordUserId: m.id,
            lastMessageAt
          };
        }
        return {
          pubkey: discordKey,
          handle: m.displayName || m.username,
          online: m.status === 'online' || m.status === 'idle' || m.status === 'dnd',
          bot: !!m.bot,
          kind: 'discord',
          discordUserId: m.id,
          lastMessageAt
        };
      }));
      this.setState({
        members,
        membersLabel: (insight && insight.guild && insight.guild.name)
          ? insight.guild.name
          : 'Discord'
      });
      return;
    }
    const fabricAndDiscord = (channels || this.state.channels).concat(this.state.discordChannels || []);
    const active = fabricAndDiscord.find((c) => c.key === this.state.channel);
    const msgs = messages || this.state.messages || [];
    const me = this.props.identityPubkey || null;
    let roster = {};
    try {
      const r = await fetchPresenceRoster();
      roster = (r && r.ok && r.data) || {};
    } catch (_) { /* ignore */ }

    const byPk = new Map();
    const upsert = (pubkey, patch = {}) => {
      if (!pubkey) return;
      const prev = byPk.get(pubkey) || {
        pubkey,
        handle: null,
        online: false,
        ship: null,
        role: null,
        lastMessageAt: 0
      };
      const next = Object.assign({}, prev, patch);
      if (patch.lastMessageAt != null) {
        next.lastMessageAt = Math.max(
          Number(prev.lastMessageAt) || 0,
          Number(patch.lastMessageAt) || 0
        );
      }
      byPk.set(pubkey, next);
    };

    // Recent chat authors (handles + last message time).
    const lastAt = lastMessageAtByAuthor(msgs);
    for (const m of msgs) {
      upsert(m.author, {
        handle: m.handle || null,
        lastMessageAt: lastAt.get(String(m.author)) || 0
      });
    }

    const groupId = this.props.groupId || (active && active.kind === 'group' && active.groupId) || null;
    if (groupId) {
      try {
        const gRes = await fetch(`${BASE}/groups/${encodeURIComponent(groupId)}`);
        const gJson = await gRes.json();
        const g = gJson && gJson.data;
        if (g && Array.isArray(g.members)) {
          const validators = Array.isArray(g.validators) ? g.validators : [];
          for (const pk of g.members) {
            const signer = validators.some((v) => String(v).toLowerCase() === String(pk).toLowerCase());
            upsert(pk, {
              role: pk === g.creator ? 'creator' : (signer ? 'signer' : 'reader')
            });
          }
        }
      } catch (_) { /* private / unavailable */ }
    } else {
      // Global: mesh presence roster + anyone who has spoken.
      for (const [pk, p] of Object.entries(roster)) {
        upsert(pk, {
          handle: (p && p.nickname) || null,
          online: !!(p && p.online),
          ship: (p && p.ship) || null
        });
      }
    }

    // Overlay presence for everyone we already listed.
    for (const [pk, row] of byPk) {
      const p = roster[pk];
      if (!p) continue;
      byPk.set(pk, Object.assign({}, row, {
        handle: row.handle || p.nickname || null,
        online: p.online === true,
        ship: p.ship || row.ship || null
      }));
    }

    if (me && !byPk.has(me)) {
      upsert(me, { handle: this.props.nickname || null, role: groupId ? 'you' : null });
    }

    const members = sortChatMembers([...byPk.values()]);

    this.setState({
      members,
      membersLabel: groupId || (active && active.kind === 'group') ? 'Members' : 'On channel'
    });
  }

  pick (key) {
    if (this.lockedChannel()) return;
    const row = this.channelRowFor(key);
    const next = pickKeyForRow(row) || key;
    this.setState({
      channel: next,
      page: 'messages',
      messages: [],
      members: [],
      loading: true
    }, () => this.refresh());
  }

  openDiscordPage () {
    if (this.props.embedded) return;
    this.setState({ page: 'discord', error: null });
    if (this.showDiscordBotUi()) this.refreshDiscordCatalog(true);
  }

  closeDiscordPage () {
    this.setState({ page: 'messages' });
  }

  async send () {
    const body = this.state.draft.trim();
    const pending = this.state.pendingFile;
    if ((!body && !pending) || this.state.sending) return;
    const access = this.discordAccessForRow();
    if (access.discordOnly && !access.canPost) {
      const notice = !access.listenOnly ? this.discordBotPermissionNotice(access) : null;
      const err = access.listenOnly
        ? 'Channel is listen-only — Chat → Discord posting is disabled.'
        : ((notice && notice.text) ||
          (!access.botCanPost
            ? 'The Discord bot cannot chat in this channel.'
            : 'Cannot post to Discord on this channel.'));
      this.setState({
        error: err,
        authorizeUrl: (notice && notice.url) || null
      });
      return;
    }
    this.setState({ sending: true, error: null, authorizeUrl: null, slashOpen: false });
    try {
      const price = this.state.attachPriceSats != null
        ? this.state.attachPriceSats
        : (Number(this.props.documentsDefaultPriceSats) || DEFAULT_CHAT_ATTACH_PRICE_SATS);
      const payload = {
        channel: this.state.channel,
        body: body || (pending ? `📎 ${pending.name}` : '')
      };
      if (pending) {
        payload.file = {
          name: pending.name,
          mime: pending.mime,
          size: pending.size,
          contentBase64: pending.contentBase64
        };
        payload.purchasePriceSats = price;
      }
      const res = await fetch(`${BASE}/chat/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!res.ok) {
        const err = new Error(json.error || `HTTP ${res.status}`);
        err.authorizeUrl = json.authorizeUrl || null;
        throw err;
      }
      this.setState({ draft: '', sending: false, pendingFile: null, authorizeUrl: null });
      await this.refresh();
      if (this._msgsRef.current) this._msgsRef.current.scrollTop = this._msgsRef.current.scrollHeight;
    } catch (e) {
      this.setState({
        sending: false,
        error: e.message,
        authorizeUrl: e.authorizeUrl || (looksLikeMissingPermissionError(e.message)
          ? ((this.discordBotPermissionNotice(access) || {}).url || null)
          : null)
      });
    }
  }

  attachPrice () {
    return this.state.attachPriceSats != null
      ? this.state.attachPriceSats
      : (Number(this.props.documentsDefaultPriceSats) || DEFAULT_CHAT_ATTACH_PRICE_SATS);
  }

  onDraftChange (value) {
    const draft = String(value || '');
    const matches = matchSlashMenu(draft);
    const slashOpen = draft.startsWith('/') && matches.length > 0;
    this.setState({
      draft,
      slashOpen,
      slashIndex: slashOpen ? Math.min(this.state.slashIndex, matches.length - 1) : 0
    });
  }

  applySlash (cmd) {
    if (!cmd) return;
    if (cmd.action === 'attach') {
      this.setState({ draft: '', slashOpen: false }, () => this.openFilePicker());
      return;
    }
    if (cmd.action === 'price') {
      const rest = String(this.state.draft || '').split(/\s+/).slice(1).join(' ').trim();
      const n = rest ? Math.max(0, Math.floor(Number(rest))) : null;
      if (n == null || !Number.isFinite(n)) {
        this.setState({
          draft: '',
          slashOpen: false,
          error: `Usage: /price <sats> — current default ${this.attachPrice()} sats`
        });
        return;
      }
      this.setState({
        draft: '',
        slashOpen: false,
        attachPriceSats: n,
        error: null
      });
      return;
    }
    if (cmd.action === 'help') {
      const lines = listSlashCommands().map((c) => `${c.cmd} — ${c.hint}`).join('\n');
      this.setState({ draft: '', slashOpen: false, error: lines });
      return;
    }
    if (cmd.action === 'lookup') {
      const rest = String(this.state.draft || '').replace(/^\/lookup\b/i, '').trim();
      this.setState({
        draft: rest ? `/lookup ${rest}` : '/lookup ',
        slashOpen: false,
        error: null
      });
    }
  }

  openFilePicker () {
    const el = this._fileRef.current;
    if (el) el.click();
  }

  onFilePicked (ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const dataUrl = String(reader.result || '');
        const comma = dataUrl.indexOf(',');
        const contentBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
        this.setState({
          pendingFile: {
            name: file.name || 'attachment',
            mime: file.type || 'application/octet-stream',
            size: file.size,
            contentBase64
          },
          error: null,
          slashOpen: false
        });
      } catch (e) {
        this.setState({ error: e.message || 'Failed to read file' });
      }
    };
    reader.onerror = () => this.setState({ error: 'Failed to read file' });
    reader.readAsDataURL(file);
  }

  onComposeKeyDown (e) {
    const matches = this.state.slashOpen ? matchSlashMenu(this.state.draft) : [];
    if (this.state.slashOpen && matches.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.setState({ slashIndex: (this.state.slashIndex + 1) % matches.length });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.setState({ slashIndex: (this.state.slashIndex - 1 + matches.length) % matches.length });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        this.applySlash(matches[this.state.slashIndex] || matches[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.setState({ slashOpen: false });
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.send();
    }
  }

  renderAttachmentCard (m) {
    const att = messageAttachment(m);
    if (!att) return null;
    const price = Number(att.purchasePriceSats || 0);
    return React.createElement('div', { className: 'chat-attach-card' },
      React.createElement('div', { className: 'nm' },
        '📎 ', att.name,
        price > 0
          ? React.createElement('span', { className: 'tag' }, `${price.toLocaleString()} sats`)
          : React.createElement('span', { className: 'tag' }, 'free')
      ),
      React.createElement('div', { className: 'meta' },
        att.mime || 'file',
        att.sealed ? ' · sealed' : '',
        ' · ',
        React.createElement('span', {
          title: att.documentId,
          style: { fontFamily: "'Cascadia Code',Consolas,monospace", fontSize: 10.5 }
        }, String(att.documentId).slice(0, 12) + '…')
      )
    );
  }

  onDeliveryUpdated (data) {
    if (!data || !data.delivery) return;
    const hash = data.wireHash ? String(data.wireHash).toLowerCase() : null;
    const chatId = data.chatMessageId || data.id || null;
    this.setState((s) => ({
      messages: (s.messages || []).map((m) => {
        const match = (hash && m.wireHash && String(m.wireHash).toLowerCase() === hash) ||
          (chatId && m.id === chatId);
        if (!match) return m;
        return Object.assign({}, m, {
          delivery: data.delivery,
          wireHash: hash || m.wireHash
        });
      })
    }));
  }

  async toggleMessagePin (m) {
    if (!m || !m.id || this.state.pinBusy || !this.props.identityPubkey) return;
    this.setState({ pinBusy: m.id, error: null });
    try {
      const token = await this.ensureAuth();
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${BASE}/chat/messages/${encodeURIComponent(m.id)}/pin`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ pinned: m.pinned !== true })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const next = (json && json.data) || json || {};
      this.setState((s) => ({
        pinBusy: null,
        messages: (s.messages || []).map((row) => {
          if (row.id !== m.id) return row;
          return Object.assign({}, row, { pinned: next.pinned === true });
        })
      }));
    } catch (e) {
      this.setState({ pinBusy: null, error: (e && e.message) || String(e) });
    }
  }

  pinnedMessages () {
    return (this.state.messages || []).filter((m) => m && m.pinned === true);
  }

  jumpToPinned (id) {
    const messageId = String(id || '');
    if (!messageId) return;
    this.setState({ highlightMessageId: messageId });
    const root = this._msgsRef && this._msgsRef.current;
    if (root && typeof root.querySelector === 'function') {
      const el = root.querySelector('[data-message-id="' + messageId.replace(/"/g, '') + '"]');
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'center' });
      }
    }
  }

  renderPinsDrawer () {
    const pins = this.pinnedMessages();
    return React.createElement('div', { className: 'chat-pins-drawer' },
      React.createElement('div', { className: 'chat-pins-head' },
        'Pinned in this channel',
        React.createElement('button', {
          type: 'button',
          title: 'Close pinned messages',
          'aria-label': 'Close pinned messages',
          onClick: () => this.setState({ pinsOpen: false })
        }, '×')
      ),
      pins.length
        ? pins.map((m) => React.createElement('button', {
          type: 'button',
          key: m.id,
          className: 'chat-pins-row',
          onClick: () => this.jumpToPinned(m.id)
        },
        React.createElement('div', { className: 'meta' },
          (m.handle || shortKey(m.author)),
          ' · ',
          shortTime(m.ts)
        ),
        React.createElement('div', { className: 'preview' }, displayCaption(m) || '(attachment)')
        ))
        : React.createElement('div', { className: 'chat-pins-empty' },
          'No pinned messages in this channel yet — use 📌 on a row.')
    );
  }

  renderMessage (m) {
    const pinned = m.pinned === true;
    const busy = this.state.pinBusy === m.id;
    const canPin = !!this.props.identityPubkey;
    const jump = this.state.highlightMessageId && this.state.highlightMessageId === m.id;
    return React.createElement('div', {
      className: 'chat-msg' + (pinned ? ' pinned' : '') + (jump ? ' jump' : ''),
      key: m.id,
      'data-message-id': m.id
    },
      React.createElement('div', { className: 'm' },
        this.renderAuthor(m.author, m.handle),
        React.createElement('span', { className: 't' }, shortTime(m.ts)),
        React.createElement('button', {
          type: 'button',
          className: 'chat-msg-pin' + (pinned ? ' on' : ''),
          title: pinned ? 'Unpin message' : 'Pin message',
          'aria-label': pinned ? 'Unpin message' : 'Pin message',
          'aria-pressed': pinned,
          disabled: !canPin || busy,
          onClick: (e) => {
            e.stopPropagation();
            this.toggleMessagePin(m);
          }
        }, '📌')
      ),
      React.createElement('div', { className: 'b' }, displayCaption(m)),
      this.renderAttachmentCard(m),
      m.kind === 'discord'
        ? null
        : React.createElement(DeliverySync, {
          delivery: m.delivery,
          wireHash: m.wireHash || (m.delivery && m.delivery.wireHash) || null,
          chatMessageId: m.id,
          contractId: (m.delivery && m.delivery.contractId) || m.contractId || null,
          canReceipt: !!this.props.identityPubkey,
          authToken: this.state.authToken,
          getAuthToken: () => this.ensureAuth(),
          showAwaiting: !!(m.channel && String(m.channel).startsWith('group:') && !m.wireHash),
          onUpdated: (data) => this.onDeliveryUpdated(data),
          onError: (e) => this.setState({ error: (e && e.message) || String(e) })
        })
    );
  }

  peopleDirectory () {
    return mergePeopleDirectory({
      members: this.state.members || [],
      catalog: this.state.discordCatalog,
      groups: this.state.fabricGroups || []
    });
  }

  findPerson (pubkey) {
    const key = String(pubkey || '');
    const canon = canonicalPersonKey(key);
    const fromMembers = (this.state.members || []).find((row) => {
      return row && (row.pubkey === key || canonicalPersonKey(row.pubkey) === canon);
    });
    if (fromMembers) return fromMembers;
    const fromDir = this.peopleDirectory().find((row) => {
      return row && (row.pubkey === key || canonicalPersonKey(row.pubkey) === canon);
    });
    return fromDir || { pubkey: key };
  }

  renderPeopleOverlap (actor) {
    const me = this.props.identityPubkey || null;
    const catalog = this.state.discordCatalog;
    const groups = this.state.fabricGroups || [];
    const discord = me
      ? commonDiscordGuilds(catalog, me, actor)
      : commonDiscordGuilds(catalog, actor, actor);
    const fabric = me
      ? commonFabricGroups(groups, me, actor)
      : commonFabricGroups(groups, actor, actor);
    if (!discord.length && !fabric.length) return null;
    const self = !!(me && canonicalPersonKey(me) === canonicalPersonKey(actor));
    const discordLabel = self || !me ? 'Discord servers' : 'Common Discord servers';
    const groupLabel = self || !me ? 'Fabric groups' : 'Common Fabric groups';
    return React.createElement('div', { className: 'chat-overlap' },
      discord.length
        ? React.createElement(React.Fragment, null,
          React.createElement('h4', null, discordLabel),
          React.createElement('div', { className: 'list' },
            discord.map((g) => g.name).join(' · ')))
        : null,
      fabric.length
        ? React.createElement(React.Fragment, null,
          React.createElement('h4', null, groupLabel),
          React.createElement('div', { className: 'list' },
            fabric.map((g) => g.name).join(' · ')))
        : null,
      React.createElement('div', { className: 'hint' },
        'Notes stay on this node until you pin one to a profile (📌) or share it to a Federation group.')
    );
  }

  renderMemberCard () {
    const pubkey = this.state.hoverPubkey;
    if (!pubkey) return null;
    const m = this.findPerson(pubkey);
    const discord = (isDiscordActor(pubkey) || m.kind === 'discord') && !m.linked;
    const me = this.props.identityPubkey || null;
    const detail = this.state.profileCache[pubkey] || null;
    const profile = (detail && detail.profile) || {};
    const presence = (detail && detail.presence) || null;
    const ship = (presence && presence.ship) || m.ship;
    const shipLabel = ship && (ship.name || ship.slug);
    const online = presence ? !!presence.online : !!m.online;
    const nickname = profile.nickname || m.handle || null;
    const scHandle = profile.scHandle || null;
    const bio = profile.bio || null;
    const isSelf = !!(me && pubkey === me);

    if (discord) {
      const canMessage = !!(m.discordUserId && parseDiscordDmChannel(discordDmChannelKey(m.discordUserId)));
      return React.createElement('div', {
        className: 'chat-mem-card',
        style: this.cardStyle(),
        onMouseEnter: () => this.cancelHoverLeave(),
        onMouseLeave: () => this.scheduleHoverLeave(),
        onClick: (e) => e.stopPropagation()
      },
      React.createElement('div', { className: 'nm' }, nickname || 'Discord user'),
      React.createElement('div', { className: 'pk', title: m.discordUserId || pubkey },
        m.discordUserId || String(pubkey).replace(/^discord:/, '')),
      React.createElement('div', { className: 'meta' },
        React.createElement('span', { className: 'dot' + (online ? ' on' : '') }),
        React.createElement('span', null, online ? 'online' : 'offline'),
        m.bot ? React.createElement('span', null, '· bot') : null,
        React.createElement('span', null, '· Discord'),
        !canMessage
          ? React.createElement('span', null, '· link from Bot settings')
          : null
      ),
      React.createElement('div', { className: 'actions' },
        canMessage
          ? React.createElement('button', {
            type: 'button',
            className: 'btn',
            title: m.bot
              ? 'Open an in-app DM with this bot (works locally even if you run it)'
              : 'Open an in-app Discord DM via the local bot',
            onClick: (e) => {
              e.stopPropagation();
              this.openDiscordDm(m.discordUserId, nickname || m.handle, { bot: !!m.bot });
            }
          }, 'Message')
          : null,
        React.createElement('button', {
          type: 'button',
          className: 'btn ghost',
          onClick: (e) => {
            e.stopPropagation();
            this.openProfile(pubkey);
          }
        }, 'Profile')
      ),
      this.renderPeopleOverlap(pubkey),
      React.createElement(IdentityNotePanel, {
        actor: pubkey,
        handle: nickname || m.handle,
        authToken: this.state.authToken,
        shareGroups: this.state.inviteGroups || this.state.fabricGroups || [],
        sharePeer: null,
        compact: true
      })
      );
    }

    return React.createElement('div', {
      className: 'chat-mem-card',
      style: this.cardStyle(),
      onMouseEnter: () => this.cancelHoverLeave(),
      onMouseLeave: () => this.scheduleHoverLeave(),
      onClick: (e) => e.stopPropagation()
    },
    React.createElement('div', { className: 'nm' }, nickname || shortKey(pubkey)),
    React.createElement('div', { className: 'pk', title: pubkey }, pubkey),
    React.createElement('div', { className: 'meta' },
      React.createElement('span', { className: 'dot' + (online ? ' on' : '') }),
      React.createElement('span', null, online ? 'online' : 'offline'),
      scHandle ? React.createElement('span', null, '· SC ', React.createElement('b', null, scHandle)) : null,
      m.discordUserId ? React.createElement('span', null, '· Discord linked') : null,
      shipLabel
        ? React.createElement('span', null, '· ', React.createElement('b', null, shipLabel),
          ship.type ? ` (${ship.type})` : '')
        : null,
      m.role === 'creator' ? React.createElement('span', null, '· creator') : null
    ),
    bio ? React.createElement('div', { className: 'bio' }, bio) : null,
    !detail
      ? React.createElement('div', { className: 'meta' }, 'loading profile…')
      : null,
    React.createElement('div', { className: 'actions' },
      React.createElement('button', {
        type: 'button',
        className: 'btn',
        disabled: isSelf || !me,
        title: isSelf ? 'That\'s you' : (me ? 'Open a direct message' : 'Unlock identity to DM'),
        onClick: (e) => {
          e.stopPropagation();
          this.openDm(pubkey, nickname || m.handle);
        }
      }, isSelf ? 'You' : 'Message'),
      React.createElement('button', {
        type: 'button',
        className: 'btn ghost',
        onClick: (e) => {
          e.stopPropagation();
          this.openProfile(pubkey);
        }
      }, 'Profile'),
      !isSelf && me
        ? React.createElement('button', {
          type: 'button',
          className: 'btn ghost',
          title: 'Send a direct group invitation',
          onClick: (e) => {
            e.stopPropagation();
            this.openInvitePicker();
          }
        }, this.state.inviteOpen ? 'Invite ▾' : 'Invite to group')
        : null
    ),
    this.state.inviteOpen && !isSelf
      ? React.createElement('div', { className: 'invite' },
        React.createElement('label', null, 'Choose a group'),
        this.state.inviteLoading
          ? React.createElement('div', { className: 'hint' }, 'loading your groups…')
          : (this.state.inviteGroups.length
            ? React.createElement(React.Fragment, null,
              React.createElement('select', {
                value: this.state.inviteGroupId,
                onChange: (e) => this.setState({ inviteGroupId: e.target.value, inviteOk: null, inviteError: null }),
                onClick: (e) => e.stopPropagation()
              }, this.state.inviteGroups.map((g) => React.createElement('option', { key: g.id, value: g.id }, g.name))),
              React.createElement('button', {
                type: 'button',
                className: 'btn',
                disabled: !this.state.inviteGroupId || this.state.inviteBusy,
                onClick: (e) => {
                  e.stopPropagation();
                  this.sendGroupInvite();
                }
              }, this.state.inviteBusy ? 'Sending…' : 'Send invite')
            )
            : React.createElement('div', { className: 'hint' },
              'No groups available — create one on the Groups tab, or they may already be a member.')),
        this.state.inviteOk ? React.createElement('div', { className: 'ok' }, this.state.inviteOk) : null,
        this.state.inviteError ? React.createElement('div', { className: 'err' }, this.state.inviteError) : null
      )
      : null,
    this.renderPeopleOverlap(pubkey),
    React.createElement(IdentityNotePanel, {
      actor: pubkey,
      handle: nickname || m.handle,
      authToken: this.state.authToken,
      shareGroups: this.state.inviteGroups || this.state.fabricGroups || [],
      identityPubkey: this.props.identityPubkey || null,
      sharePeer: isSelf ? null : pubkey,
      compact: true
    })
    );
  }

  renderMemberRow (m, opts = {}) {
    const me = this.props.identityPubkey || null;
    const ship = m.ship;
    const shipLabel = ship && (ship.name || ship.slug);
    const discordOnly = m.kind === 'discord' && !m.linked;
    return React.createElement('div', {
      className: 'chat-mem-wrap',
      key: (opts.prefix || '') + m.pubkey,
      ref: (el) => { this._memRefs[m.pubkey] = el; },
      onMouseEnter: (e) => this.scheduleHover(m.pubkey, e.currentTarget),
      onMouseLeave: () => this.scheduleHoverLeave()
    },
    React.createElement('div', {
      className: 'chat-mem',
      title: discordOnly
        ? 'Discord member — click for profile'
        : 'Hover for preview · click for profile',
      role: 'link',
      tabIndex: 0,
      onClick: () => this.openProfile(m.pubkey),
      onKeyDown: (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && m.pubkey) {
          e.preventDefault();
          this.openProfile(m.pubkey);
        }
      }
    },
    React.createElement('div', { className: 'row' },
      React.createElement('span', { className: 'dot' + (m.online ? ' on' : '') }),
      React.createElement('span', {
        className: 'nm' + (me && m.pubkey === me ? ' me' : ''),
        title: m.pubkey
      }, m.handle || (discordOnly ? 'Discord' : shortKey(m.pubkey))),
      m.role === 'creator'
        ? React.createElement('span', { className: 'tag' }, 'creator')
        : (m.role === 'signer'
          ? React.createElement('span', { className: 'tag' }, 'signer')
          : null),
      m.linked
        ? React.createElement('span', { className: 'tag' }, 'linked')
        : null,
      m.bot
        ? React.createElement('span', { className: 'tag bot' }, 'bot')
        : null,
      opts.via
        ? React.createElement('span', { className: 'tag' }, opts.via)
        : null
    ),
    (discordOnly || (m.handle && String(m.handle).trim()))
      ? React.createElement('div', { className: 'pk', title: m.pubkey },
        discordOnly
          ? (m.discordUserId || String(m.pubkey).replace(/^discord:/, ''))
          : shortKey(m.pubkey))
      : null,
    shipLabel
      ? React.createElement('div', { className: 'ship' },
        React.createElement('b', null, shipLabel),
        ship.type ? ` · ${ship.type}` : '')
      : null,
    (m.guildNames && m.guildNames.length) || (m.groupNames && m.groupNames.length)
      ? React.createElement('div', { className: 'ship' },
        (m.guildNames || []).slice(0, 2).join(' · '),
        (m.guildNames && m.guildNames.length && m.groupNames && m.groupNames.length) ? ' · ' : '',
        (m.groupNames || []).slice(0, 2).join(' · '))
      : null
    )
    );
  }

  renderPeopleFilter () {
    const q = this.state.peopleQuery || '';
    const active = !!normalizePeopleQuery(q);
    return React.createElement('div', { className: 'chat-filter' },
      React.createElement('div', { className: 'chat-filter-row' },
        React.createElement('input', {
          type: 'search',
          value: q,
          placeholder: 'Search people…',
          'aria-label': 'Search people',
          autoComplete: 'off',
          spellCheck: false,
          onChange: (e) => this.setState({ peopleQuery: e.target.value })
        }),
        active
          ? React.createElement('button', {
            type: 'button',
            className: 'chat-filter-clear',
            title: 'Clear people search',
            'aria-label': 'Clear people search',
            onClick: () => this.setState({ peopleQuery: '' })
          }, '×')
          : null
      )
    );
  }

  renderMembers () {
    const members = this.state.members || [];
    const q = this.state.peopleQuery || '';
    const visible = filterMembers(members, q, { keepKey: this.state.hoverPubkey });
    const extras = searchPeople(this.peopleDirectory(), q, {
      exclude: members.map((m) => m && m.pubkey).filter(Boolean)
    });
    const queryActive = !!normalizePeopleQuery(q);
    return React.createElement('div', { className: 'chat-members' },
      React.createElement('div', { className: 'chat-people-head' },
        React.createElement('h3', null, this.state.membersLabel,
          members.length ? ` · ${members.length}` : ''),
        this.renderPeopleFilter()
      ),
      visible.length
        ? visible.map((m) => this.renderMemberRow(m))
        : React.createElement('div', { className: 'chat-mem-hint' },
          queryActive
            ? 'No one on this channel matches — world-view hits appear below when the catalog or groups know them.'
            : (parseDiscordChatChannel(this.state.channel)
              ? 'Guild members the bot can see appear here. Search people across Discord servers and Fabric groups. Hover for notes / DM.'
              : (this.state.channel === 'global'
                ? 'Peers sharing presence appear here. Search people across Discord servers and Fabric groups — hover for notes, common servers, and groups.'
                : 'Group members appear here once loaded. Search people across Discord and Fabric groups; hover to add a shareable note.'))),
      extras.length
        ? React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'chat-people-sec' }, 'Also in world view'),
          extras.map((m) => this.renderMemberRow(m, {
            prefix: 'dir:',
            via: (m.guildNames && m.guildNames.length) ? 'discord' : 'group'
          })))
        : null
    );
  }

  setChannelQuery (value) {
    this.setState({ channelQuery: String(value || '') });
  }

  setChannelKind (kind) {
    const next = CHANNEL_KIND_FILTERS.some(([k]) => k === kind) ? kind : 'all';
    this.setState({ channelKind: next });
  }

  clearChannelQuery () {
    this.setState({ channelQuery: '', channelKind: 'all' });
  }

  channelSearchCriteria () {
    return {
      query: this.state.channelQuery || '',
      kind: this.state.channelKind || 'all'
    };
  }

  renderChannelFilter () {
    const q = this.state.channelQuery || '';
    const kind = this.state.channelKind || 'all';
    const active = !!(normalizeChannelQuery(q) || kind !== 'all');
    return React.createElement('div', { className: 'chat-filter' },
      React.createElement('div', { className: 'chat-filter-row' },
        React.createElement('input', {
          type: 'search',
          value: q,
          placeholder: 'Search channels, guilds…',
          'aria-label': 'Search channels',
          autoComplete: 'off',
          spellCheck: false,
          onChange: (e) => this.setChannelQuery(e.target.value)
        }),
        active
          ? React.createElement('button', {
            type: 'button',
            className: 'chat-filter-clear',
            title: 'Clear filters',
            'aria-label': 'Clear channel filters',
            onClick: () => this.clearChannelQuery()
          }, '×')
          : null
      ),
      React.createElement('div', {
        className: 'chat-filter-chips',
        role: 'group',
        'aria-label': 'Channel type'
      },
      CHANNEL_KIND_FILTERS.map(([key, label]) => React.createElement('button', {
        key: key,
        type: 'button',
        className: 'chat-filter-chip' +
          (key === 'discord' ? ' discord' : '') +
          (kind === key ? ' on' : ''),
        onClick: () => this.setChannelKind(key)
      }, label))
      )
    );
  }

  /** Group-leader pins shared with members — top of the rail. */
  renderPinnedRail (discordPage, criteria) {
    const pins = this.state.groupPinned || [];
    if (!pins.length) return null;
    const q = normalizeChannelQuery(criteria && criteria.query);
    const kind = (criteria && criteria.kind) || 'all';
    if (kind === 'dm' || kind === 'global') return null;
    let list = pins;
    if (kind === 'discord') {
      list = pins.filter((p) => p.kind === 'discord' || p.bridged ||
        (p.platforms && p.platforms.indexOf('discord') >= 0));
    }
    if (kind === 'group') {
      list = pins.filter((p) => p.kind === 'group' || p.bridged);
    }
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter((p) => {
        const hay = [p.label, p.guildName, p.groupName, p.key].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(needle);
      });
    }
    if (!list.length) return null;
    return [
      React.createElement('h3', { key: 'ph', className: 'pinned-h' }, 'Pinned'),
      ...list.map((ch) => React.createElement('button', {
        type: 'button',
        className: 'chat-ch pinned' +
          (ch.kind === 'discord' ? ' discord' : '') +
          (!discordPage && ch.key === this.state.channel ? ' on' : ''),
        key: 'pin-' + ch.key,
        title: ch.groupName
          ? ('Pinned by ' + ch.groupName)
          : 'Pinned by a group you belong to',
        onClick: () => this.pick(ch.key)
      },
      React.createElement('span', { className: 'chat-pin', 'aria-hidden': true }, '📌'),
      React.createElement('span', { className: 'n' },
        ch.kind === 'discord'
          ? String(ch.label || '').replace(/^#/, '')
          : (ch.label || ch.key)),
      ch.groupName
        ? React.createElement('span', { className: 'c' }, ch.groupName)
        : null
      ))
    ];
  }

  async createChatChannel () {
    const me = this.props.identityPubkey;
    const name = String(this.state.createChannelName || '').trim();
    if (!me || !name || this.state.creatingChannel) return;
    this.setState({ creatingChannel: true, createChannelError: null });
    try {
      const token = await this.ensureAuth();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const parentId = String(this.state.createChannelParentId || '').trim() || undefined;
      const res = await fetch(`${BASE}/groups`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name,
          members: [],
          threshold: 1,
          parentId,
          visibility: 'private',
          creator: me
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json && json.error) || `HTTP ${res.status}`);
      const created = (json && json.data) || json;
      const newId = created && created.id;
      if (parentId && newId) {
        const parent = (this.state.fabricGroups || []).find((g) => g.id === parentId);
        if (parent && parent.creator === me) {
          const next = sanitizePinnedChannels(parent.pinnedChannels).concat(['group:' + newId]);
          await fetch(`${BASE}/groups/${encodeURIComponent(parentId)}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ pinnedChannels: next })
          }).catch(() => null);
        }
      }
      this._groupPinsFetchedAt = 0;
      this.setState({
        creatingChannel: false,
        showCreateChannel: false,
        createChannelName: '',
        createChannelParentId: '',
        createChannelError: null
      });
      if (newId) this.pick('group:' + newId);
      await this.refresh();
    } catch (e) {
      this.setState({
        creatingChannel: false,
        createChannelError: (e && e.message) || String(e)
      });
    }
  }

  renderCreateChannel () {
    const me = this.props.identityPubkey;
    if (this.props.embedded) return null;
    const parents = (this.state.fabricGroups || []).filter((g) => {
      return g && Array.isArray(g.members) && me && g.members.includes(me);
    });
    if (!this.state.showCreateChannel) {
      return React.createElement('button', {
        type: 'button',
        className: 'chat-new-ch',
        disabled: !me,
        title: me
          ? 'Create a chat channel (a Federation group)'
          : 'Unlock your identity to create a channel',
        onClick: () => this.setState({
          showCreateChannel: true,
          createChannelError: null,
          createChannelParentId: this.props.groupId || this.state.createChannelParentId || ''
        })
      }, '+ Channel');
    }
    return React.createElement('div', { className: 'chat-create' },
      React.createElement('div', { className: 'hint' },
        'A new channel is a Federation group with its own chat and log. Members stay in sync.'),
      React.createElement('input', {
        type: 'text',
        value: this.state.createChannelName,
        placeholder: 'Channel name',
        'aria-label': 'Channel name',
        onChange: (e) => this.setState({ createChannelName: e.target.value })
      }),
      parents.length
        ? React.createElement('select', {
          value: this.state.createChannelParentId,
          'aria-label': 'Parent group',
          onChange: (e) => this.setState({ createChannelParentId: e.target.value })
        },
          React.createElement('option', { value: '' }, 'Top-level channel'),
          parents.map((g) => React.createElement('option', { key: g.id, value: g.id },
            'Inside ' + (g.name || g.id)))
        )
        : null,
      this.state.createChannelError
        ? React.createElement('div', { className: 'chat-err' }, this.state.createChannelError)
        : null,
      React.createElement('div', { className: 'row' },
        React.createElement('button', {
          type: 'button',
          className: 'chat-new-ch',
          style: { margin: 0, width: 'auto' },
          disabled: !me || !String(this.state.createChannelName || '').trim() || this.state.creatingChannel,
          onClick: () => this.createChatChannel()
        }, this.state.creatingChannel ? 'Creating…' : 'Create'),
        React.createElement('button', {
          type: 'button',
          className: 'chat-new-ch',
          style: { margin: 0, width: 'auto' },
          onClick: () => this.setState({
            showCreateChannel: false, createChannelError: null, createChannelName: ''
          })
        }, 'Cancel')
      )
    );
  }

  renderBotSettings (discordPage) {
    if (!this.showDiscordBotUi()) return null;
    return React.createElement('button', {
      type: 'button',
      key: 'settings',
      className: 'chat-ch discord' + (discordPage ? ' on' : ''),
      onClick: () => this.openDiscordPage()
    },
    React.createElement('span', null, '⚙'),
    React.createElement('span', { className: 'n' }, 'Bot settings')
    );
  }

  renderPlatformBadges (ch) {
    const platforms = Array.isArray(ch.platforms) && ch.platforms.length
      ? ch.platforms
      : (ch.kind === 'discord' || ch.kind === 'discord-dm'
        ? ['discord']
        : ['fabric']);
    return platforms.map((p) => React.createElement('span', {
      key: p,
      className: 'chat-plat ' + p,
      title: p === 'discord'
        ? (ch.bridged
          ? 'Discord bridge — the bot relays as itself'
          : 'Discord')
        : 'Fabric'
    }, p === 'discord' ? 'Discord' : 'Fabric'));
  }

  renderChannelRow (ch, discordPage) {
    const active = !discordPage && channelRowMatchesKey(ch, this.state.channel);
    const access = this.discordAccessForRow(ch);
    const isPinned = !!(this.state.groupPinned || []).some((p) => p.key === ch.key ||
      (ch.discordKeys || []).indexOf(p.key) >= 0);
    const hasDiscord = (ch.platforms || []).indexOf('discord') >= 0 ||
      ch.kind === 'discord' || ch.kind === 'discord-dm';
    const icon = isPinned
      ? '📌'
      : (ch.kind === 'global'
        ? '🌐'
        : (ch.kind === 'dm' || ch.kind === 'discord-dm'
          ? '✉️'
          : (hasDiscord && !ch.bridged ? '#' : '👥')));
    const label = ch.kind === 'discord'
      ? String(ch.label || '').replace(/^#/, '')
      : (ch.label || ch.key);
    const sub = ch.bridged
      ? [ch.discordLabel || (ch.discordKey ? '#' + String(ch.discordKey).replace(/^discord:/, '') : null),
        ch.guildName, ch.groupName].filter(Boolean).join(' · ')
      : (ch.guildName || null);
    const titleParts = [];
    if (ch.bridged) titleParts.push('Fabric + Discord — bot relays as itself');
    if (isPinned) titleParts.push('Pinned by a group you belong to');
    for (const ind of access.indicators) titleParts.push(ind.title);
    const dmIsBot = ch.kind === 'discord-dm' && ch.bot === true;
    return React.createElement('button', {
      type: 'button',
      className: 'chat-ch' +
        (hasDiscord ? ' discord-ch' : '') +
        (ch.bridged ? ' bridged' : '') +
        (isPinned ? ' pinned' : '') +
        (active ? ' on' : ''),
      key: ch.key,
      title: titleParts.length ? titleParts.join(' · ') : undefined,
      onClick: () => {
        if (ch.kind === 'discord-dm' && ch.discordUserId) {
          this.openDiscordDm(ch.discordUserId, ch.label, { bot: dmIsBot });
          return;
        }
        this.pick(ch.key);
      }
    },
    React.createElement('span', null, icon),
    React.createElement('span', { className: 'chat-row-main' },
      React.createElement('span', { className: 'n' }, label),
      sub ? React.createElement('span', { className: 'chat-row-sub' }, sub) : null
    ),
    this.renderPlatformBadges(ch),
    this.renderPermBadges(ch),
    ch.count ? React.createElement('span', { className: 'c' }, ch.count) : null
    );
  }


  render () {
    if (this.props.peopleOnly) {
      return React.createElement('div', { className: 'chat-wrap chat-people-only' },
        this.renderMembers(),
        this.renderMemberCard()
      );
    }
    const me = this.props.identityPubkey || null;
    const discordPage = !this.props.embedded && this.state.page === 'discord';
    const active = this.channelRowFor(this.state.channel);
    const discordChannelId = parseDiscordChatChannel(this.state.channel) ||
      (active && active.discordKey ? parseDiscordChatChannel(active.discordKey) : null);
    const discordDmUserId = parseDiscordDmChannel(this.state.channel);
    const discordBotReady = !!(this.state.discordCatalog && this.state.discordCatalog.botReady);
    const discordListenOnly = !!(discordChannelId && this.isDiscordListenOnly(discordChannelId));
    const access = this.discordAccessForRow(active);
    const discordOnly = !!(access.discordOnly);
    const discordComposeLocked = !!(discordOnly && !access.canPost);
    const botDm = botDmChannelFromCatalog(this.state.discordCatalog);
    const voiceGroupId = this.props.groupId ||
      (active && active.kind === 'group' && (active.groupId || String(this.state.channel || '').replace(/^group:/, ''))) ||
      null;
    const voiceMember = (() => {
      if (!voiceGroupId) return false;
      const row = (active && active.kind === 'group') ? active : null;
      const members = row && Array.isArray(row.members) ? row.members : null;
      const creator = row && row.creator;
      if (!members && !creator) return true;
      if (!me) return false;
      if (creator && pubkeysMatch(creator, me)) return true;
      return (members || []).some((m) => pubkeysMatch(m, me));
    })();

    const embedded = !!this.props.embedded;
    const headLabel = discordPage
      ? 'Chat settings'
      : (embedded
        ? 'Group chat'
        : (active
          ? (active.kind === 'global'
            ? 'Public shoutbox'
            : (active.bridged
              ? ('👥 ' + (active.label || '') +
                (active.discordLabel ? ' · ' + String(active.discordLabel).replace(/^#/, '#') : ''))
              : (active.kind === 'discord'
                ? ((active.guildName ? active.guildName + ' · ' : '') + active.label)
                : (active.kind === 'discord-dm'
                  ? '✉️ ' + active.label
                  : (active.kind === 'dm' ? '✉️ ' + active.label : '👥 ' + active.label)))))
          : this.state.channel));
    const headSub = discordPage
      ? 'push-to-talk, Discord bot'
      : (embedded
        ? 'members only · same channel as Chat tab'
        : (active && active.kind === 'global'
          ? 'cleartext mesh flood — relays can read; use sealed groups or onion for private'
          : (active && active.bridged
            ? (discordListenOnly
              ? 'Fabric + Discord — you cannot post to Discord (listen-only)'
              : (!access.botCanPost
                ? 'Fabric + Discord — the bot cannot chat on Discord'
                : 'Fabric + Discord — the bot relays as itself'))
            : (active && active.kind === 'discord'
              ? (discordListenOnly
                ? 'you cannot chat — listen-only (no Chat → Discord)'
                : (!access.botCanPost
                  ? 'bot cannot chat here'
                  : 'Discord channel — bot relays as itself'))
              : (active && active.kind === 'discord-dm'
                ? (active.bot || (botDm && botDm.key === active.key)
                  ? 'local bot DM — works even when you run the bot'
                  : 'Discord DM via the local bot')
                : (active && active.kind === 'group'
                  ? 'members only'
                  : (active && active.kind === 'dm'
                    ? 'direct — only you and them'
                    : 'network — relayed via your Fabric peers')))))));

    const criteria = this.channelSearchCriteria();
    const keepKey = discordPage ? null : this.state.channel;
    const visibleChannels = filterChannels(this.flattenedChannels(), criteria, { keepKey });
    const queryActive = !!(normalizeChannelQuery(criteria.query) ||
      (criteria.kind && criteria.kind !== 'all'));
    const pinnedNodes = this.renderPinnedRail(discordPage, criteria);
    const noRailMatches = queryActive &&
      !visibleChannels.length &&
      !(pinnedNodes && pinnedNodes.length);

    return React.createElement('div', { className: 'chat-wrap' + (embedded ? ' chat-embedded' : '') },
      embedded
        ? null
        : React.createElement('div', { className: 'chat-side' },
          this.renderChannelFilter(),
          this.renderCreateChannel(),
          pinnedNodes,
          React.createElement('h3', null, 'Channels'),
          noRailMatches
            ? React.createElement('div', { className: 'chat-filter-empty' },
              'No channels match — try a guild, group, or #name.')
            : null,
          visibleChannels.map((ch) => this.renderChannelRow(ch, discordPage)),
          this.renderBotSettings(discordPage),
          !queryActive && !this.state.channels.some((c) => c.kind === 'group')
            ? React.createElement('div', { style: { color: 'var(--muted)', fontSize: 11.5, padding: '8px 14px', lineHeight: 1.5 } },
              'Each group is a chat channel — use + Channel here, or Groups. Hover a member to start a DM.')
            : null
        ),
      React.createElement('div', { className: 'chat-main' },
        React.createElement('div', { className: 'chat-head' },
          React.createElement('div', { className: 'chat-head-main' },
            headLabel,
            React.createElement('span', { className: 'sub' }, headSub)
          ),
          React.createElement('div', { className: 'chat-head-actions' },
            voiceGroupId && voiceMember
              ? React.createElement(JoinVoiceButton, {
                groupId: voiceGroupId,
                handle: this.props.nickname || null,
                identityPubkey: me,
                authToken: this.state.authToken || this.props.authToken,
                getAuthToken: () => this.ensureAuth(),
                disabled: !me
              })
              : null,
            React.createElement('button', {
              type: 'button',
              className: 'chat-pins-btn' + (this.state.pinsOpen ? ' on' : ''),
              title: 'Pinned messages',
              'aria-label': 'Pinned messages',
              'aria-pressed': !!this.state.pinsOpen,
              onClick: () => this.setState((s) => ({
                pinsOpen: !s.pinsOpen,
                page: s.page === 'discord' ? 'messages' : s.page
              }))
            },
            '📌',
            this.pinnedMessages().length
              ? React.createElement('span', { className: 'n' }, this.pinnedMessages().length)
              : null),
            embedded
              ? null
              : React.createElement('button', {
                type: 'button',
                className: 'chat-cog' + (discordPage ? ' on' : ''),
                title: 'Chat settings — PTT and Discord',
                'aria-label': 'Chat settings',
                onClick: () => (discordPage ? this.closeDiscordPage() : this.openDiscordPage())
              }, '⚙️')
          )
        ),
        discordPage
          ? React.createElement(DiscordChatSettings, {
            identityPubkey: this.props.identityPubkey || null,
            discordChatDirections: this.discordDirectionsMap(),
            onDirectionsChanged: (next) => this.onDiscordDirectionsChanged(next),
            onClose: () => this.closeDiscordPage(),
            showDiscord: this.showDiscordBotUi()
          })
          : React.createElement(React.Fragment, null,
            this.state.pinsOpen ? this.renderPinsDrawer() : null,
            React.createElement('div', { className: 'chat-msgs', ref: this._msgsRef },
              this.state.messages.length
                ? this.state.messages.map((m) => this.renderMessage(m))
                : React.createElement('div', { className: 'chat-empty' },
                  this.state.loading
                    ? 'loading…'
                    : (discordChannelId
                      ? 'No recent Discord messages — the bot may lack Read Message History, or the channel is quiet.'
                      : (active && active.kind === 'global'
                        ? 'Public shoutbox is empty — posts are cleartext on the mesh (relays can read). Sealed group chat is for confidential traffic.'
                        : 'No messages yet — say hello, Citizen.')))
            ),
            this.renderChatAccessBanner(access),
            React.createElement('div', { className: 'chat-compose-wrap' },
              this.state.pendingFile
                ? React.createElement('div', { className: 'chat-attach-chip' },
                  React.createElement('span', null, 'Attach '),
                  React.createElement('b', null, this.state.pendingFile.name),
                  React.createElement('span', null, ` · ${this.attachPrice().toLocaleString()} sats`),
                  React.createElement('button', {
                    type: 'button',
                    onClick: () => this.setState({ pendingFile: null })
                  }, 'remove')
                )
                : null,
              this.state.slashOpen
                ? React.createElement('div', { className: 'chat-slash', role: 'listbox' },
                  matchSlashMenu(this.state.draft).map((cmd, i) => React.createElement('button', {
                    type: 'button',
                    key: cmd.cmd,
                    className: i === this.state.slashIndex ? 'on' : '',
                    onMouseDown: (e) => { e.preventDefault(); this.applySlash(cmd); }
                  },
                  React.createElement('span', { className: 'cmd' }, cmd.cmd),
                  React.createElement('span', { className: 'hint' }, cmd.hint)
                  ))
                )
                : null,
              React.createElement('input', {
                ref: this._fileRef,
                type: 'file',
                style: { display: 'none' },
                onChange: (e) => this.onFilePicked(e)
              }),
              React.createElement('div', { className: 'chat-compose' },
                React.createElement('button', {
                  type: 'button',
                  className: 'chat-tool',
                  title: `Attach file to this node\'s catalog (${this.attachPrice()} sats)`,
                  disabled: !me || this.state.sending,
                  onClick: () => this.openFilePicker()
                }, '📎'),
                React.createElement('input', {
                  type: 'text',
                  value: this.state.draft,
                  placeholder: discordOnly
                    ? (!me
                      ? 'Unlock identity (Desktop / Passport) to chat on Discord…'
                      : (discordListenOnly
                        ? 'You cannot chat here — listen-only'
                        : (!discordBotReady
                          ? 'Discord bot not ready'
                          : (!access.botCanPost
                            ? 'Bot cannot chat in this channel'
                            : ('Message Discord as ' + (this.props.nickname || shortKey(me)) + '…')))))
                    : (me
                      ? ('Message as ' + (this.props.nickname || shortKey(me)) +
                        (active && active.bridged ? ' (Fabric + Discord)' : '') +
                        '…  (/ for commands)')
                      : 'Unlock identity (Desktop / Passport) to chat…'),
                  disabled: !me || discordComposeLocked,
                  onChange: (e) => this.onDraftChange(e.target.value),
                  onKeyDown: (e) => this.onComposeKeyDown(e)
                }),
                React.createElement('button', {
                  className: 'chat-send',
                  disabled: discordComposeLocked ||
                    (!this.state.draft.trim() && !this.state.pendingFile) ||
                    this.state.sending || !me,
                  onClick: () => this.send()
                }, this.state.sending ? '…' : 'Send')
              )
            )
          )
      ),
      embedded || discordPage ? null : this.renderMembers(),
      this.renderMemberCard()
    );
  }

}

Chat.CSS = CSS + '\n' + (DiscordChatSettings.CSS || '') + '\n' + (IdentityNotePanel.CSS || '');

module.exports = Chat;
