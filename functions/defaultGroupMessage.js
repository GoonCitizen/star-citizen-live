'use strict';

/**
 * Resolve a pasted Fabric message id / opaque fabric: share / group id into a
 * default (primary) group id for this instance.
 *
 * Accepted paste forms:
 * - opaque `fabric:<payload>` GroupOffer / invite / publish (hex or base64 body)
 * - raw AMP Message hex/base64 (same as Import share)
 * - AMP message hash / id (64 hex) — looked up in the Fabric message log
 * - group id (8–128 `[a-zA-Z0-9_-]`)
 */

const {
  parseOpaqueFabricMessage,
  classifyGroupShareMessage
} = require('./groupShareMessage');
const { sanitizePrimaryGroupId, PRIMARY_GROUP_ID_RE } = require('./settingsStore');

const MESSAGE_HASH_RE = /^[0-9a-fA-F]{64}$/;

/**
 * Normalize user paste for local.js / Settings.
 * @param {*} value
 * @returns {string|null}
 */
function sanitizeDefaultGroupMessageId (value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.length > 200000) return null; // opaque messages can be large but bound paste
  return s;
}

/**
 * @param {string} paste
 * @returns {{
 *   kind: 'groupId'|'opaque'|'messageHash'|'empty'|'unknown',
 *   value: string|null,
 *   groupId: string|null,
 *   messageId: string|null,
 *   contractId: string|null,
 *   error: string|null
 * }}
 */
function parseDefaultGroupRef (paste) {
  const raw = sanitizeDefaultGroupMessageId(paste);
  if (!raw) {
    return { kind: 'empty', value: null, groupId: null, messageId: null, contractId: null, error: null };
  }

  // Direct group id (Store / primaryGroupId shape).
  if (PRIMARY_GROUP_ID_RE.test(raw) && !MESSAGE_HASH_RE.test(raw)) {
    return {
      kind: 'groupId',
      value: raw,
      groupId: sanitizePrimaryGroupId(raw),
      messageId: null,
      contractId: null,
      error: null
    };
  }

  // Bare AMP message hash / id.
  if (MESSAGE_HASH_RE.test(raw)) {
    return {
      kind: 'messageHash',
      value: raw.toLowerCase(),
      groupId: null,
      messageId: raw.toLowerCase(),
      contractId: null,
      error: null
    };
  }

  // Opaque fabric: / raw hex|base64 Message.
  const parsed = parseOpaqueFabricMessage(raw);
  if (parsed.ok) {
    let classified = { kind: 'unknown', groupId: null, contractId: null };
    try {
      classified = classifyGroupShareMessage(parsed.message) || classified;
    } catch (_) { /* best-effort */ }
    const msgId = (parsed.message && (parsed.message.id || parsed.message.hash))
      ? String(parsed.message.id || parsed.message.hash).toLowerCase()
      : null;
    const groupId = classified.groupId
      ? sanitizePrimaryGroupId(classified.groupId)
      : null;
    if (!groupId && classified.kind === 'unknown') {
      return {
        kind: 'opaque',
        value: raw,
        groupId: null,
        messageId: msgId,
        contractId: classified.contractId || null,
        error: 'Fabric message is not a GroupOffer, Federation invite, or group CONTRACT_PUBLISH'
      };
    }
    return {
      kind: 'opaque',
      value: raw,
      groupId,
      messageId: msgId,
      contractId: classified.contractId || null,
      error: groupId ? null : 'Could not read a group id from that Fabric message'
    };
  }

  return {
    kind: 'unknown',
    value: raw,
    groupId: null,
    messageId: null,
    contractId: null,
    error: parsed.error || 'Unrecognized Fabric message id / group id'
  };
}

/**
 * Resolve paste against optional LiveRelay message log + GroupManager.
 * @param {string} paste
 * @param {Object} [ctx]
 * @param {{ list?: Function }} [ctx.messageLog]
 * @param {{ getGroup?: Function, findGroup?: Function, getGroupByContractId?: Function }} [ctx.groupManager]
 * @returns {{
 *   ok: boolean,
 *   groupId: string|null,
 *   messageId: string|null,
 *   contractId: string|null,
 *   kind: string,
 *   localJsSnippet: string|null,
 *   error: string|null
 * }}
 */
function resolveDefaultGroup (paste, ctx = {}) {
  const parsed = parseDefaultGroupRef(paste);
  if (parsed.kind === 'empty') {
    return {
      ok: false,
      groupId: null,
      messageId: null,
      contractId: null,
      kind: 'empty',
      localJsSnippet: null,
      error: 'Paste a Fabric message id, fabric:<hex> share, or group id'
    };
  }

  let groupId = parsed.groupId;
  let messageId = parsed.messageId;
  let contractId = parsed.contractId;

  if (parsed.kind === 'messageHash' && ctx.messageLog && typeof ctx.messageLog.list === 'function') {
    const rows = ctx.messageLog.list({ limit: 500, hideKeepalive: false, q: parsed.messageId });
    const hit = (rows || []).find((e) => {
      const h = e && e.hash != null ? String(e.hash).toLowerCase() : '';
      return h === parsed.messageId;
    });
    if (hit) {
      messageId = parsed.messageId;
      if (hit.contract) contractId = String(hit.contract).toLowerCase();
      // Prefer group id embedded in body preview JSON when present.
      const preview = String(hit.bodyPreview || hit.summary || '');
      const gidMatch = preview.match(/"groupId"\s*:\s*"([a-zA-Z0-9_-]{8,128})"/);
      if (gidMatch) groupId = sanitizePrimaryGroupId(gidMatch[1]);
      if (!groupId && hit.appType === 'GroupShare' && contractId && ctx.groupManager) {
        const byC = ctx.groupManager.getGroupByContractId &&
          ctx.groupManager.getGroupByContractId(contractId);
        if (byC && byC.id) groupId = sanitizePrimaryGroupId(byC.id);
      }
    } else {
      return {
        ok: false,
        groupId: null,
        messageId: parsed.messageId,
        contractId: null,
        kind: 'messageHash',
        localJsSnippet: localJsSnippetFor(parsed.messageId),
        error: 'Message hash not in the local Fabric message buffer — paste the full fabric:<hex> share, or copy the id again after Share'
      };
    }
  }

  if (groupId && ctx.groupManager) {
    const g = (ctx.groupManager.getGroup && ctx.groupManager.getGroup(groupId)) ||
      (ctx.groupManager.findGroup && ctx.groupManager.findGroup(groupId));
    if (!g) {
      return {
        ok: false,
        groupId,
        messageId,
        contractId,
        kind: parsed.kind,
        localJsSnippet: localJsSnippetFor(messageId || paste),
        error: 'Group id resolved but this node does not have that group yet — Import the share first'
      };
    }
  }

  if (!groupId) {
    return {
      ok: false,
      groupId: null,
      messageId,
      contractId,
      kind: parsed.kind,
      localJsSnippet: localJsSnippetFor(messageId || paste),
      error: parsed.error || 'Could not resolve a group id'
    };
  }

  const snippetSource = messageId || (parsed.kind === 'opaque' ? String(paste).trim() : groupId);
  return {
    ok: true,
    groupId,
    messageId,
    contractId,
    kind: parsed.kind,
    localJsSnippet: localJsSnippetFor(snippetSource),
    error: null
  };
}

/**
 * @param {string} value
 * @returns {string}
 */
function localJsSnippetFor (value) {
  const v = String(value || '').trim();
  // Prefer single-quoted JS string; escape embedded quotes/backslashes.
  const escaped = v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `  // Default group — Fabric message id / fabric:<hex> share / group id\n  defaultGroupMessageId: '${escaped}',`;
}

module.exports = {
  MESSAGE_HASH_RE,
  sanitizeDefaultGroupMessageId,
  parseDefaultGroupRef,
  resolveDefaultGroup,
  localJsSnippetFor
};
