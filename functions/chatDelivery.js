'use strict';

/**
 * Delivery synchronization UI helpers (ARC 2PC sidecar).
 *
 * Canonical store: `contractmessagecommits` via `@fabric/core` contractMessageCommit.
 * Aggregate flags light only when every reader completed that phase.
 * Chat rows link via `wireHash`; Feed / other surfaces enrich the same way.
 */

const commit = require('./contractMessageCommit');
const { pubkeyXOnly } = require('./groupChatSeal');

/**
 * BIP340 hex signature over the MessageReceipt id (wire hash).
 * @param {*} signerKey Key-like with signSchnorr
 * @param {string} messageId
 * @returns {string}
 */
function signReceiptSig (signerKey, messageId) {
  if (!signerKey || typeof signerKey.signSchnorr !== 'function') {
    throw new Error('signerKey with signSchnorr required for receiptSig');
  }
  const msg = commit.receiptSigningMessage(messageId);
  return Buffer.from(signerKey.signSchnorr(msg)).toString('hex');
}

/**
 * Attach AMP wire hash onto a stored ChatMessage (links UI rows to 2PC).
 * @param {{ get: Function, put: Function }} store
 * @param {string} chatMessageId
 * @param {string} wireHash
 * @param {string} [contractId]
 * @returns {object|null} updated row
 */
function attachWireHash (store, chatMessageId, wireHash, contractId) {
  if (!store || !chatMessageId || !wireHash) return null;
  const id = String(chatMessageId);
  const hash = String(wireHash).toLowerCase();
  const row = store.get('chatmessages', id);
  if (!row) return null;
  let changed = false;
  if (row.wireHash !== hash) {
    row.wireHash = hash;
    changed = true;
  }
  if (contractId && row.contractId !== String(contractId).toLowerCase()) {
    row.contractId = String(contractId).toLowerCase();
    changed = true;
  }
  if (changed) store.put('chatmessages', id, row);
  return row;
}

/**
 * @param {object|null} record commit record
 * @param {string|null} viewerPubkey
 * @returns {object|null}
 */
function deliverySummary (record, viewerPubkey) {
  if (!record || typeof record !== 'object') return null;
  const aggregate = commit.aggregatePhaseFlags(record);
  const local = viewerPubkey
    ? commit.phaseFlags(record, viewerPubkey)
    : { received: false, receipt: false };
  const readers = Array.isArray(record.readers) ? record.readers : [];
  let receivedCount = 0;
  let receiptCount = 0;
  for (const r of readers) {
    const f = commit.phaseFlags(record, r);
    if (f.received) receivedCount += 1;
    if (f.receipt) receiptCount += 1;
  }
  return {
    wireHash: record.wireHash || record.id || null,
    contractId: record.contractId || null,
    sourceType: record.sourceType || null,
    aggregate,
    local,
    readers: readers.length,
    receivedCount,
    receiptCount
  };
}

/**
 * Enrich any list of objects that may carry `wireHash` (Chat, Feed, …).
 * @param {{ get: Function }} store
 * @param {object[]} items
 * @param {string|null} viewerPubkey
 * @param {{ requireGroupChannel?: boolean }} [opts]
 * @returns {object[]}
 */
function enrichWithDelivery (store, items, viewerPubkey, opts = {}) {
  if (!store || !Array.isArray(items)) return items || [];
  const requireGroup = opts.requireGroupChannel !== false;
  return items.map((m) => {
    if (!m || typeof m !== 'object') return m;
    if (requireGroup && m.channel && !String(m.channel).startsWith('group:')) {
      return m;
    }
    const hash = m.wireHash ? String(m.wireHash).toLowerCase() : null;
    if (!hash) {
      return Object.assign({}, m, { delivery: null });
    }
    const record = store.get('contractmessagecommits', hash);
    return Object.assign({}, m, {
      delivery: deliverySummary(record, viewerPubkey)
    });
  });
}

/** @deprecated use enrichWithDelivery */
function enrichChatMessages (store, messages, viewerPubkey) {
  return enrichWithDelivery(store, messages, viewerPubkey, { requireGroupChannel: true });
}

/**
 * Ensure a pending commit exists and mark local receipt (sidecar only).
 * Prefer publishing a Fabric MessageReceipt via LiveRelay — this updates local state.
 * Requires BIP340 `receiptSig` (or `signerKey` to produce one) over the wire hash.
 * @param {{ get: Function, put: Function }} store
 * @param {object} opts
 * @param {string} opts.wireHash
 * @param {*} opts.viewerPubkey
 * @param {string} [opts.receiptSig]
 * @param {*} [opts.signerKey] Key with signSchnorr when receiptSig omitted
 * @returns {{ record: object, flags: object, aggregate: object, receiptSig: string }}
 */
function markLocalReceipt (store, opts = {}) {
  const hash = String(opts.wireHash || '').toLowerCase();
  const me = opts.viewerPubkey;
  if (!hash || !me) throw new Error('wireHash and viewerPubkey required');
  let record = store.get('contractmessagecommits', hash);
  if (!record) {
    const readers = opts.readers && Array.from(opts.readers).length
      ? opts.readers
      : [me];
    record = commit.createPending({
      id: hash,
      contractId: opts.contractId || 'unknown',
      wireHash: hash,
      readers
    });
  }
  const receiptSig = opts.receiptSig
    ? String(opts.receiptSig)
    : signReceiptSig(opts.signerKey, hash);
  commit.markReceived(record, me);
  commit.markReceipt(record, me, undefined, receiptSig);
  store.put('contractmessagecommits', hash, record);
  return {
    record,
    flags: commit.phaseFlags(record, me),
    aggregate: commit.aggregatePhaseFlags(record),
    receiptSig
  };
}

/**
 * Apply a remote MessageReceipt / MessageReceived body into the sidecar.
 * Prefer accumulate ingest; this is a fallback when wire bytes are missing.
 * @param {{ get: Function, put: Function }} store
 * @param {object} object
 * @param {*} signerPubkey
 * @param {{ contractId?: string, readers?: Iterable<*> }} [meta]
 * @returns {object|null}
 */
function applyRemoteDeliveryAck (store, object, signerPubkey, meta = {}) {
  if (!store || !object) return null;
  const hash = String(object.messageId || object.wireHash || object.hash || '').toLowerCase();
  const signer = pubkeyXOnly(signerPubkey) || pubkeyXOnly(object.author);
  if (!hash || !signer) return null;
  let record = store.get('contractmessagecommits', hash);
  if (!record) {
    const readers = meta.readers && Array.from(meta.readers).length
      ? meta.readers
      : [signer];
    record = commit.createPending({
      id: hash,
      contractId: meta.contractId || object.contractId || 'unknown',
      wireHash: hash,
      readers
    });
  }
  try {
    commit.markReceived(record, signer, object.receivedAt || undefined);
    if (object.receipt || object.receiptAt || object['@type'] === 'MessageReceipt' ||
        object.type === 'MessageReceipt') {
      commit.markReceipt(record, signer, object.receiptAt || undefined, object.receiptSig || null);
    }
    store.put('contractmessagecommits', hash, record);
    return record;
  } catch (_) {
    return null;
  }
}

/**
 * Resolve contractId + readers for a wire hash (chat row, commit, or group).
 * @param {object} ctx
 * @param {{ get: Function }} ctx.store
 * @param {object} [ctx.groupManager]
 * @param {string} wireHash
 * @param {{ contractId?: string, chatMessageId?: string }} [hints]
 * @returns {{ wireHash: string, contractId: string|null, readers: string[], chatMessageId: string|null, sourceType: string|null }}
 */
function resolveDeliveryTarget (ctx, wireHash, hints = {}) {
  const store = ctx && ctx.store;
  const hash = String(wireHash || '').toLowerCase();
  if (!hash) throw Object.assign(new Error('wireHash required'), { code: 'BAD_REQUEST' });

  let chatMessageId = hints.chatMessageId ? String(hints.chatMessageId) : null;
  let contractId = hints.contractId ? String(hints.contractId).toLowerCase() : null;
  let readers = [];
  let sourceType = null;

  const commitRow = store && store.get('contractmessagecommits', hash);
  if (commitRow) {
    if (!contractId && commitRow.contractId) contractId = String(commitRow.contractId).toLowerCase();
    if (Array.isArray(commitRow.readers)) readers = commitRow.readers.slice();
    if (commitRow.sourceType) sourceType = commitRow.sourceType;
  }

  if (chatMessageId && store) {
    const row = store.get('chatmessages', chatMessageId);
    if (row) {
      if (!contractId && row.contractId) contractId = String(row.contractId).toLowerCase();
      if (!contractId && row.channel && String(row.channel).startsWith('group:')) {
        const groupId = String(row.channel).slice('group:'.length);
        const group = ctx.groupManager && ctx.groupManager.getGroup(groupId);
        if (group && group.contractId) contractId = String(group.contractId).toLowerCase();
        if (group && Array.isArray(group.members) && !readers.length) readers = group.members.slice();
      }
    }
  }

  if (!chatMessageId && store && typeof store.all === 'function') {
    try {
      const msgs = store.all('chatmessages') || [];
      const hit = msgs.find((m) => m && String(m.wireHash || '').toLowerCase() === hash);
      if (hit) {
        chatMessageId = hit.id;
        if (!contractId && hit.contractId) contractId = String(hit.contractId).toLowerCase();
      }
    } catch (_) { /* memory/facade may lack all() */ }
  }

  if (contractId && ctx.groupManager && !readers.length) {
    const group = ctx.groupManager.getGroupByContractId(contractId);
    if (group) {
      if (typeof ctx.groupManager.getChatSealTip === 'function') {
        const tip = ctx.groupManager.getChatSealTip(group.id);
        if (tip && tip.memberPubkeys && tip.memberPubkeys.length) readers = tip.memberPubkeys.slice();
      }
      if (!readers.length && Array.isArray(group.members)) readers = group.members.slice();
    }
  }

  return { wireHash: hash, contractId, readers, chatMessageId, sourceType };
}

module.exports = {
  attachWireHash,
  deliverySummary,
  enrichWithDelivery,
  enrichChatMessages,
  signReceiptSig,
  markLocalReceipt,
  applyRemoteDeliveryAck,
  resolveDeliveryTarget
};
