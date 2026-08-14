'use strict';

/**
 * Chat DocumentPublish attachments — local catalog + wire encoding.
 *
 * Files live on this node (`functions/localDocuments.js`). Global
 * `P2P_CHAT_MESSAGE` is UTF-8 text only, so priced shares ride a magic first
 * line (`fabric-doc:{…json…}`) plus an optional caption. Discord / bridged
 * channels get the caption only (the bot relays as itself); the Fabric
 * ChatMessage keeps the `fabric-doc:` line.
 *
 * Default list price matches Hub DocumentView (`DEFAULT_PUBLISH_PRICE_SATS`).
 */

const DEFAULT_CHAT_ATTACH_PRICE_SATS = 25;
const ATTACHMENT_KIND = 'DocumentPublish';
const WIRE_PREFIX = 'fabric-doc:';

/** Extensible slash-command catalog (compose pop-out). */
const SLASH_COMMANDS = [
  {
    cmd: '/file',
    hint: 'Attach a file (this node\'s catalog)',
    action: 'attach'
  },
  {
    cmd: '/price',
    hint: 'Set download fee in sats for the next attach (default 25)',
    action: 'price'
  },
  {
    cmd: '/lookup',
    hint: 'Master lookup report — players, groups, fleets, peers, Discord (race to answer)',
    action: 'lookup'
  },
  {
    cmd: '/help',
    hint: 'List slash commands',
    action: 'help'
  }
];

function listSlashCommands () {
  return SLASH_COMMANDS.slice();
}

/**
 * Filter slash commands for a draft that starts with `/`.
 * @param {string} draft
 * @returns {Array<object>}
 */
function matchSlashMenu (draft) {
  const raw = String(draft || '');
  if (!raw.startsWith('/')) return [];
  const token = raw.split(/\s/)[0].toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(token));
}

function normalizeAttachment (raw) {
  if (!raw || typeof raw !== 'object') return null;
  const documentId = String(raw.documentId || raw.id || '').trim();
  if (!documentId) return null;
  const purchasePriceSats = Math.max(0, Math.floor(Number(raw.purchasePriceSats) || 0));
  const name = String(raw.name || 'file').slice(0, 256);
  const mime = String(raw.mime || 'application/octet-stream').slice(0, 128);
  const sealed = raw.sealed === true || purchasePriceSats > 0;
  const out = {
    kind: ATTACHMENT_KIND,
    documentId,
    name,
    mime,
    purchasePriceSats,
    sealed
  };
  if (raw.size != null && Number.isFinite(Number(raw.size))) out.size = Number(raw.size);
  return out;
}

function isWireEncoded (body) {
  return String(body || '').startsWith(WIRE_PREFIX);
}

/**
 * @param {{ caption?: string, attachment: object }} opts
 * @returns {string}
 */
function encodeWireBody (opts = {}) {
  const attachment = normalizeAttachment(opts.attachment);
  if (!attachment) {
    return String(opts.caption || '').trim();
  }
  const caption = String(opts.caption || '').trim() || `📎 ${attachment.name}`;
  const meta = {
    kind: attachment.kind,
    documentId: attachment.documentId,
    name: attachment.name,
    mime: attachment.mime,
    purchasePriceSats: attachment.purchasePriceSats,
    sealed: attachment.sealed === true
  };
  if (attachment.hub) meta.hub = attachment.hub;
  if (attachment.size != null) meta.size = attachment.size;
  return `${WIRE_PREFIX}${JSON.stringify(meta)}\n${caption}`;
}

/**
 * @param {string} body
 * @returns {{ caption: string, attachment: object|null, wire: boolean }}
 */
function decodeWireBody (body) {
  const raw = String(body || '');
  if (!raw.startsWith(WIRE_PREFIX)) {
    return { caption: raw, attachment: null, wire: false };
  }
  const nl = raw.indexOf('\n');
  const metaLine = nl >= 0 ? raw.slice(WIRE_PREFIX.length, nl) : raw.slice(WIRE_PREFIX.length);
  const caption = nl >= 0 ? raw.slice(nl + 1) : '';
  let attachment = null;
  try {
    attachment = normalizeAttachment(JSON.parse(metaLine));
  } catch (_) {
    attachment = null;
  }
  return {
    caption: caption || (attachment ? `📎 ${attachment.name}` : raw),
    attachment,
    wire: true
  };
}

/** Display caption for a ChatMessage (strips wire meta). */
function displayCaption (message) {
  if (!message) return '';
  if (message.attachment && !isWireEncoded(message.body)) {
    return String(message.body || '').trim() || `📎 ${message.attachment.name}`;
  }
  return decodeWireBody(message.body).caption;
}

/** Attachment on a ChatMessage (structured or parsed from wire body). */
function messageAttachment (message) {
  if (!message) return null;
  return normalizeAttachment(message.attachment) || decodeWireBody(message.body).attachment;
}

/**
 * Plain-text Discord caption (no fabric-doc wire). The bot relays this as itself.
 * @param {string} [body]
 * @param {object} [attachment]
 * @returns {string}
 */
function discordCaptionForAttach (body, attachment) {
  const caption = String(body || '').trim();
  const att = normalizeAttachment(attachment);
  if (!att) return caption;
  const tag = '📎 ' + att.name;
  if (!caption || caption === tag) return tag;
  return (caption + '\n' + tag).slice(0, 1800);
}

function defaultAttachPriceSats (settings = {}) {
  const d = (settings && settings.documents) || {};
  if (d.defaultPriceSats != null && Number.isFinite(Number(d.defaultPriceSats))) {
    return Math.max(0, Math.floor(Number(d.defaultPriceSats)));
  }
  return DEFAULT_CHAT_ATTACH_PRICE_SATS;
}

module.exports = {
  DEFAULT_CHAT_ATTACH_PRICE_SATS,
  ATTACHMENT_KIND,
  WIRE_PREFIX,
  SLASH_COMMANDS,
  listSlashCommands,
  matchSlashMenu,
  normalizeAttachment,
  isWireEncoded,
  encodeWireBody,
  decodeWireBody,
  displayCaption,
  messageAttachment,
  discordCaptionForAttach,
  defaultAttachPriceSats
};
