'use strict';

/**
 * Size-based document listing prices. Storage and P2P blob transfer scale
 * with bytes, so each AMP blob carries `rateSats` proportional to its size.
 *
 * Operator units: `satsPerKiB` (integer). Canonical math uses sats/byte.
 * `minSats` floors the **document** total (chat attach default), not each blob.
 */

function resolveSatsPerByte (policy = {}) {
  if (policy.satsPerByte != null && Number.isFinite(Number(policy.satsPerByte))) {
    return Math.max(0, Number(policy.satsPerByte));
  }
  if (policy.satsPerKiB != null && Number.isFinite(Number(policy.satsPerKiB))) {
    return Math.max(0, Number(policy.satsPerKiB) / 1024);
  }
  return 0;
}

function minSatsOf (policy = {}) {
  return Math.max(0, Math.floor(Number(policy.minSats) || 0));
}

function hasFlatOverride (policy = {}) {
  return policy.purchasePriceSats != null && Number.isFinite(Number(policy.purchasePriceSats));
}

/**
 * @param {number} byteLength
 * @param {Object} [policy]
 * @returns {number}
 */
function listPriceSats (byteLength, policy = {}) {
  if (hasFlatOverride(policy)) {
    return Math.max(0, Math.floor(Number(policy.purchasePriceSats)));
  }
  const size = Math.max(0, Math.floor(Number(byteLength) || 0));
  const rate = resolveSatsPerByte(policy);
  const proportional = rate > 0 ? Math.ceil(size * rate) : 0;
  return Math.max(minSatsOf(policy), proportional);
}

/**
 * Split `total` sats across blobs in proportion to byte size (sums exactly).
 * @param {Array<{ size?: number }>} blobs
 * @param {number} total
 * @returns {number[]}
 */
function allocateBlobRates (blobs, total) {
  const list = Array.isArray(blobs) ? blobs : [];
  const n = list.length || 1;
  const want = Math.max(0, Math.floor(Number(total) || 0));
  if (!list.length) return [want];
  if (want === 0) return list.map(() => 0);
  const sizes = list.map((b) => Math.max(0, Number(b && b.size) || 0));
  const sumSize = sizes.reduce((a, b) => a + b, 0) || n;
  const raw = sizes.map((s) => (s / sumSize) * want);
  const floors = raw.map((x) => Math.floor(x));
  let rem = want - floors.reduce((a, b) => a + b, 0);
  const order = sizes.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s || a.i - b.i);
  const rates = floors.slice();
  for (let k = 0; k < rem; k++) rates[order[k % n].i] += 1;
  return rates;
}

/**
 * @param {Array<{ size?: number }>} blobs
 * @param {number} totalBytes
 * @param {Object} [policy]
 * @returns {{ total: number, blobs: number[], satsPerByte: number }}
 */
function pricePackedDocument (blobs, totalBytes, policy = {}) {
  const total = listPriceSats(totalBytes, policy);
  return {
    total,
    blobs: allocateBlobRates(blobs, total),
    satsPerByte: resolveSatsPerByte(policy)
  };
}

/**
 * @param {object} [settings]
 * @param {object} [override] HTTP / CLI fields
 * @returns {object}
 */
function policyFromSettings (settings = {}, override = {}) {
  const chatAttachment = require('./chatAttachment');
  const d = (settings && settings.documents) || {};
  const o = override && typeof override === 'object' ? override : {};
  const policy = {
    minSats: o.minSats != null ? o.minSats : chatAttachment.defaultAttachPriceSats(settings)
  };
  if (o.purchasePriceSats != null && Number.isFinite(Number(o.purchasePriceSats))) {
    policy.purchasePriceSats = Math.max(0, Math.floor(Number(o.purchasePriceSats)));
  }
  if (o.satsPerByte != null && Number.isFinite(Number(o.satsPerByte))) {
    policy.satsPerByte = Number(o.satsPerByte);
  } else if (o.satsPerKiB != null && Number.isFinite(Number(o.satsPerKiB))) {
    policy.satsPerKiB = Number(o.satsPerKiB);
  } else if (d.satsPerByte != null && Number.isFinite(Number(d.satsPerByte))) {
    policy.satsPerByte = Number(d.satsPerByte);
  } else if (d.satsPerKiB != null && Number.isFinite(Number(d.satsPerKiB))) {
    policy.satsPerKiB = Number(d.satsPerKiB);
  } else {
    policy.satsPerKiB = 1;
  }
  return policy;
}

module.exports = {
  resolveSatsPerByte,
  listPriceSats,
  allocateBlobRates,
  pricePackedDocument,
  policyFromSettings
};
