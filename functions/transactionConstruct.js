'use strict';

/**
 * Personal-wallet send draft helpers.
 * Hub HTTP send is one destination per POST (`to` + `amountSats` + memo).
 * The constructor drafts N outputs and previews sequential Hub payments.
 */

function constructPath () {
  return '/wallet/construct';
}

/**
 * @param {object} [draft]
 * @param {string} [draft.to]
 * @param {string|number} [draft.amountSats]
 * @param {string} [draft.memo]
 * @returns {string}
 */
function constructHref (draft = {}) {
  const params = new URLSearchParams();
  const to = String(draft.to || draft.address || '').trim();
  if (to) params.set('to', to);
  const amount = Math.round(Number(draft.amountSats || 0));
  if (Number.isFinite(amount) && amount > 0) params.set('amountSats', String(amount));
  const memo = String(draft.memo || '').trim();
  if (memo) params.set('memo', memo);
  const qs = params.toString();
  return qs ? `${constructPath()}?${qs}` : constructPath();
}

/**
 * @param {string} [search] location.search or a query string
 * @returns {{ to: string, amountSats: string, memo: string }}
 */
function parseConstructQuery (search = '') {
  const raw = String(search || '');
  const q = raw.indexOf('?') >= 0
    ? new URLSearchParams(raw.slice(raw.indexOf('?')))
    : new URLSearchParams(raw.replace(/^\?/, ''));
  return {
    to: String(q.get('to') || q.get('address') || '').trim(),
    amountSats: String(q.get('amountSats') || '').trim(),
    memo: String(q.get('memo') || '').trim()
  };
}

function blankOutput (row = {}) {
  return {
    to: String(row.to || row.address || '').trim(),
    amountSats: row.amountSats != null && row.amountSats !== ''
      ? String(row.amountSats)
      : ''
  };
}

/**
 * @param {Array<object>} [rows]
 * @returns {Array<{ index: number, to: string, amountSats: number }>}
 */
function normalizeOutputs (rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row, i) => ({
    index: i,
    to: String(row && (row.to || row.address) || '').trim(),
    amountSats: Math.round(Number(row && row.amountSats || 0))
  }));
}

function isEmptyOutput (row) {
  const to = String(row && (row.to || row.address) || '').trim();
  const amount = Math.round(Number(row && row.amountSats || 0));
  return !to && !(Number.isFinite(amount) && amount > 0);
}

/**
 * @param {object} [draft]
 * @param {Array<object>} [draft.outputs]
 * @param {string|number} [draft.feeSats]
 * @param {string} [draft.changeAddress]
 * @param {string} [draft.memo]
 * @returns {object}
 */
function previewDraft (draft = {}) {
  const rows = Array.isArray(draft.outputs) ? draft.outputs : [];
  const normalized = normalizeOutputs(rows);
  const errors = [];
  normalized.forEach((o, i) => {
    if (isEmptyOutput(rows[i])) return;
    if (!o.to) errors.push(`Output ${i + 1}: destination address is required`);
    if (!Number.isFinite(o.amountSats) || o.amountSats <= 0) {
      errors.push(`Output ${i + 1}: amountSats must be a positive integer`);
    }
  });
  const valid = normalized.filter((o, i) => !isEmptyOutput(rows[i]) && o.to && o.amountSats > 0);
  if (valid.length === 0) {
    errors.push('Add at least one output with an address and positive amountSats');
  }
  const totalSats = valid.reduce((acc, o) => acc + o.amountSats, 0);
  const feeRaw = draft.feeSats;
  const feeSats = feeRaw === '' || feeRaw == null
    ? 0
    : Math.max(0, Math.round(Number(feeRaw) || 0));
  if (feeRaw != null && feeRaw !== '' && !Number.isFinite(Number(feeRaw))) {
    errors.push('Fee sats must be a number (preview only — Hub bitcoind chooses the actual fee)');
  }
  const changeAddress = String(draft.changeAddress || '').trim() || null;
  const memo = String(draft.memo || '').trim();
  return {
    outputs: valid,
    outputCount: valid.length,
    totalSats,
    feeSats,
    feeNote: 'Hub bitcoind chooses the actual fee; feeSats is a constructor preview only.',
    changeAddress,
    memo,
    hubSends: valid.map((o) => ({
      to: o.to,
      amountSats: o.amountSats,
      memo
    })),
    errors,
    ok: errors.length === 0
  };
}

function pickUtxoList (payload) {
  if (!payload) return [];
  const raw = payload.utxos || payload.data || payload;
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.utxos)) return raw.utxos;
  return [];
}

function fromLocation (pathname = '', search = '') {
  const path = String(pathname || '');
  if (!/^\/wallet\/construct\/?$/.test(path)) return null;
  return parseConstructQuery(search);
}

module.exports = {
  constructPath,
  constructHref,
  parseConstructQuery,
  blankOutput,
  normalizeOutputs,
  isEmptyOutput,
  previewDraft,
  pickUtxoList,
  fromLocation
};
