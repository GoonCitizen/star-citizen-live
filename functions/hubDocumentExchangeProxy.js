'use strict';

/**
 * Document runtime flags for GoonCitizen LiveRelay.
 * The Files catalog is always this node (`functions/localDocuments.js`).
 * Legacy Hub JSON-RPC helpers below are unused by the catalog path.
 */

const hubBitcoinProxy = require('./hubBitcoinProxy');

const DEFAULT_HUB = hubBitcoinProxy.DEFAULT_HUB;

function normalizeHubBase (hub) {
  return hubBitcoinProxy.normalizeHubBase(hub);
}

function documentsRuntimeForSettings (settings = {}) {
  const d = (settings && settings.documents) || {};
  const chatAttachment = require('./chatAttachment');
  return {
    enable: d.enable === true,
    local: true,
    defaultPriceSats: chatAttachment.defaultAttachPriceSats(settings),
    satsPerKiB: d.satsPerKiB != null && Number.isFinite(Number(d.satsPerKiB))
      ? Math.max(0, Number(d.satsPerKiB))
      : 1,
    satsPerByte: d.satsPerByte != null && Number.isFinite(Number(d.satsPerByte))
      ? Math.max(0, Number(d.satsPerByte))
      : null
  };
}

function isDocumentsEnabled (settings = {}) {
  return documentsRuntimeForSettings(settings).enable === true;
}

let _rpcId = 1;

/**
 * JSON-RPC 2.0 call against Hub HTTP (`POST /services/rpc`).
 * @param {string} hubBase
 * @param {string} method
 * @param {Array|Object} [params]
 * @returns {Promise<*>} result field (throws on transport / JSON-RPC error)
 */
async function hubJsonRpc (hubBase, method, params = []) {
  const body = {
    jsonrpc: '2.0',
    id: _rpcId++,
    method: String(method),
    params: Array.isArray(params) ? params : [params]
  };
  const data = await hubBitcoinProxy.hubRequest(hubBase, '/services/rpc', {
    method: 'POST',
    body
  });
  if (data && data.error) {
    const msg = (data.error.message != null)
      ? String(data.error.message)
      : (typeof data.error === 'string' ? data.error : 'Hub JSON-RPC error');
    const err = new Error(msg);
    err.status = 502;
    err.data = data.error;
    throw err;
  }
  const result = data && Object.prototype.hasOwnProperty.call(data, 'result')
    ? data.result
    : data;
  if (result && typeof result === 'object' && result.status === 'error') {
    const err = new Error(result.message || 'Hub method error');
    err.status = 400;
    err.data = result;
    throw err;
  }
  return result;
}

async function listDocuments (cfg = {}) {
  return hubJsonRpc(cfg.hub, 'ListDocuments', []);
}

async function getDocument (cfg = {}, documentId) {
  const id = String(documentId || '').trim();
  if (!id) {
    const err = new Error('documentId required');
    err.status = 400;
    throw err;
  }
  return hubJsonRpc(cfg.hub, 'GetDocument', [id]);
}

/**
 * @param {object} cfg
 * @param {{ name?: string, mime?: string, contentBase64: string, sha256?: string, size?: number }} doc
 */
async function createDocument (cfg = {}, doc = {}) {
  const contentBase64 = String(doc.contentBase64 || '').trim();
  if (!contentBase64) {
    const err = new Error('contentBase64 required');
    err.status = 400;
    throw err;
  }
  return hubJsonRpc(cfg.hub, 'CreateDocument', [{
    name: doc.name ? String(doc.name) : 'upload',
    mime: doc.mime ? String(doc.mime) : 'application/octet-stream',
    contentBase64,
    sha256: doc.sha256 ? String(doc.sha256) : undefined,
    size: doc.size != null ? Number(doc.size) : undefined
  }]);
}

/**
 * @param {object} cfg
 * @param {{ id: string, purchasePriceSats?: number }} opts
 */
async function publishDocument (cfg = {}, opts = {}) {
  const id = String(opts.id || opts.documentId || '').trim();
  if (!id) {
    const err = new Error('document id required');
    err.status = 400;
    throw err;
  }
  const purchasePriceSats = Number(opts.purchasePriceSats || 0);
  const arg = (Number.isFinite(purchasePriceSats) && purchasePriceSats > 0)
    ? { id, purchasePriceSats: Math.floor(purchasePriceSats) }
    : id;
  return hubJsonRpc(cfg.hub, 'PublishDocument', [arg]);
}

async function createPurchaseInvoice (cfg = {}, opts = {}) {
  const documentId = String(opts.documentId || opts.id || '').trim();
  if (!documentId) {
    const err = new Error('documentId required');
    err.status = 400;
    throw err;
  }
  const params = { documentId };
  if (opts.amountSats != null) params.amountSats = Number(opts.amountSats);
  return hubJsonRpc(cfg.hub, 'CreatePurchaseInvoice', [params]);
}

async function claimPurchase (cfg = {}, opts = {}) {
  const documentId = String(opts.documentId || opts.id || '').trim();
  const txid = String(opts.txid || '').trim();
  if (!documentId) {
    const err = new Error('documentId required');
    err.status = 400;
    throw err;
  }
  if (!txid) {
    const err = new Error('txid required');
    err.status = 400;
    throw err;
  }
  return hubJsonRpc(cfg.hub, 'ClaimPurchase', [{ documentId, txid }]);
}

/**
 * Ask Hub to request a peer's document inventory (optional; needs Fabric peer id).
 * @param {object} cfg
 * @param {{ peerId: string, inventoryTarget?: string, inventoryRelayTtl?: number }} opts
 */
async function requestPeerInventory (cfg = {}, opts = {}) {
  const peerId = String(opts.peerId || opts.peer || '').trim();
  if (!peerId) {
    const err = new Error('peerId required');
    err.status = 400;
    throw err;
  }
  const third = {};
  if (opts.inventoryTarget) third.inventoryTarget = String(opts.inventoryTarget);
  if (opts.inventoryRelayTtl != null) third.inventoryRelayTtl = Number(opts.inventoryRelayTtl);
  const params = Object.keys(third).length ? [peerId, null, third] : [peerId];
  return hubJsonRpc(cfg.hub, 'RequestPeerInventory', params);
}

module.exports = {
  DEFAULT_HUB,
  normalizeHubBase,
  documentsRuntimeForSettings,
  isDocumentsEnabled,
  hubJsonRpc,
  listDocuments,
  getDocument,
  createDocument,
  publishDocument,
  createPurchaseInvoice,
  claimPurchase,
  requestPeerInventory
};
