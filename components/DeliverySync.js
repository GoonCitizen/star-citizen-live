'use strict';

/**
 * Shared delivery-sync checkboxes (received / receipt aggregate).
 * Used by Chat and the Live feed for the same ARC 2PC sidecar.
 *
 * Transport order (avoid HTTP when a Fabric path is available):
 *   1. Electron IPC → LiveRelay._markDeliveryReceipt (in-process Fabric Peer)
 *   2. Hub Bridge.relaySignedFabricWire (WebRTC mesh + RelayFromWebRTC)
 *   3. HTTP POST /delivery/:wireHash/receipt (fallback)
 */

const React = require('react');

const BASE = '/services/star-citizen';

const CSS = `
  .gc-delivery{display:inline-flex;gap:10px;align-items:center;margin-top:4px;font-size:11px;color:var(--muted)}
  .gc-delivery label{display:inline-flex;gap:4px;align-items:center;cursor:default;user-select:none}
  .gc-delivery label.can-ack{cursor:pointer;color:var(--text)}
  .gc-delivery label.can-ack:hover{color:var(--accent)}
  .gc-delivery input{accent-color:var(--accent);margin:0}
  .gc-delivery input:disabled{opacity:.85;cursor:default}
  .gc-delivery .agg-on{color:var(--good)}
  .gc-delivery .hint{font-size:10.5px;color:var(--muted)}
  .gc-delivery.compact{margin-top:2px;gap:8px;font-size:10.5px}
`;

let styleInjected = false;
function ensureStyle () {
  if (styleInjected || typeof document === 'undefined') return;
  styleInjected = true;
  const el = document.createElement('style');
  el.setAttribute('data-gc-delivery', '1');
  el.textContent = CSS;
  document.head.appendChild(el);
}

/**
 * Electron desktop: in-process Fabric publish (no HTTP).
 * @param {string} wireHash
 * @param {{ contractId?: string, chatMessageId?: string }} [opts]
 * @returns {Promise<object|null>}
 */
async function tryElectronDeliveryReceipt (wireHash, opts = {}) {
  const api = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.fabric;
  if (!api || typeof api.deliveryReceipt !== 'function') return null;
  const out = await api.deliveryReceipt({
    wireHash,
    contractId: opts.contractId || null,
    chatMessageId: opts.chatMessageId || null
  });
  if (out && out.error) throw new Error(out.error);
  return (out && out.data) || out;
}

/**
 * Hub Bridge WebRTC mesh: caller must supply signed AMP hex/base64 via opts.messageHex.
 * @param {{ messageHex?: string, messageBase64?: string, originalType?: string }} opts
 * @returns {Promise<object|null>}
 */
async function tryBridgeMeshRelay (opts = {}) {
  const bridge = typeof window !== 'undefined' && (
    window.FabricBridge ||
    window.fabricBridge ||
    (window.app && window.app.bridge) ||
    null
  );
  if (!bridge || typeof bridge.relaySignedFabricWire !== 'function') return null;
  const wire = opts.messageHex || opts.messageBase64 || null;
  if (!wire) return null;
  const result = bridge.relaySignedFabricWire(wire, {
    originalType: opts.originalType || 'CONTRACT_MESSAGE'
  });
  if (!result || (!result.relayedToHub && !(result.meshRecipients && result.meshRecipients.length))) {
    return null;
  }
  return { transport: 'webrtc', ...result };
}

/**
 * POST Fabric MessageReceipt for a wire hash (HTTP fallback).
 * @param {string} wireHash
 * @param {{ contractId?: string, chatMessageId?: string, authToken?: string|null }} [opts]
 * @returns {Promise<object>}
 */
async function postDeliveryReceiptHttp (wireHash, opts = {}) {
  const hash = String(wireHash || '').toLowerCase();
  if (!hash) throw new Error('wireHash required');
  const headers = { 'Content-Type': 'application/json' };
  if (opts.authToken) headers.Authorization = `Bearer ${opts.authToken}`;
  const body = {};
  if (opts.contractId) body.contractId = opts.contractId;
  if (opts.chatMessageId) body.chatMessageId = opts.chatMessageId;
  const res = await fetch(`${BASE}/delivery/${encodeURIComponent(hash)}/receipt`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json && json.error) || `HTTP ${res.status}`);
  return json.data || json;
}

/**
 * Prefer Fabric IPC / WebRTC mesh; HTTP only when those are unavailable.
 * @param {string} wireHash
 * @param {{ contractId?: string, chatMessageId?: string, authToken?: string|null, messageHex?: string }} [opts]
 * @returns {Promise<object>}
 */
async function postDeliveryReceipt (wireHash, opts = {}) {
  const hash = String(wireHash || '').toLowerCase();
  if (!hash) throw new Error('wireHash required');

  const viaElectron = await tryElectronDeliveryReceipt(hash, opts);
  if (viaElectron) {
    return Object.assign({ transport: 'ipc' }, viaElectron);
  }

  // If Bridge already has a signed MessageReceipt wire, fan it over WebRTC.
  if (opts.messageHex || opts.messageBase64) {
    const viaMesh = await tryBridgeMeshRelay(opts);
    if (viaMesh) return viaMesh;
  }

  return postDeliveryReceiptHttp(hash, opts);
}

class DeliverySync extends React.Component {
  constructor (props) {
    super(props);
    this.state = { busy: false, error: null };
  }

  componentDidMount () {
    ensureStyle();
  }

  async onReceipt () {
    const d = this.props.delivery;
    const wireHash = (d && d.wireHash) || this.props.wireHash;
    if (!wireHash || this.state.busy) return;
    const local = (d && d.local) || {};
    if (local.receipt) return;
    this.setState({ busy: true, error: null });
    try {
      let authToken = this.props.authToken || null;
      if (!authToken && typeof this.props.getAuthToken === 'function') {
        authToken = await this.props.getAuthToken();
      }
      const data = await postDeliveryReceipt(wireHash, {
        contractId: (d && d.contractId) || this.props.contractId || null,
        chatMessageId: this.props.chatMessageId || null,
        authToken,
        messageHex: this.props.messageHex || null
      });
      this.setState({ busy: false });
      if (typeof this.props.onUpdated === 'function') this.props.onUpdated(data);
      if (typeof this.props.onReceipted === 'function') this.props.onReceipted(data);
    } catch (e) {
      this.setState({ busy: false, error: e.message || String(e) });
      if (typeof this.props.onError === 'function') this.props.onError(e);
    }
  }

  render () {
    ensureStyle();
    const d = this.props.delivery;
    if (!d || !d.aggregate) {
      if (this.props.showAwaiting && this.props.wireHash == null) {
        return React.createElement('div', {
          className: 'gc-delivery' + (this.props.compact ? ' compact' : '')
        },
        React.createElement('span', { className: 'hint' }, 'awaiting wire'));
      }
      return null;
    }
    const agg = d.aggregate;
    const local = d.local || {};
    // canReceipt defaults true when unset — parent passes false to force read-only.
    const allowAck = this.props.canReceipt !== false;
    const canAck = !!(d.wireHash || this.props.wireHash) &&
      !local.receipt &&
      allowAck;
    const busy = this.state.busy;
    const recvTitle = agg.received
      ? `All ${d.readers} readers received`
      : `Received ${d.receivedCount}/${d.readers}` + (local.received ? ' (you)' : '');
    const receiptTitle = agg.receipt
      ? `All ${d.readers} readers receipted`
      : `Receipt ${d.receiptCount}/${d.readers}` + (local.receipt ? ' (you)' : '');

    return React.createElement('div', {
      className: 'gc-delivery' + (this.props.compact ? ' compact' : ''),
      title: 'Delivery sync (Fabric MessageReceived / MessageReceipt)'
    },
    React.createElement('label', {
      className: agg.received ? 'agg-on' : '',
      title: recvTitle
    },
    React.createElement('input', {
      type: 'checkbox',
      checked: !!agg.received,
      disabled: true,
      readOnly: true,
      'aria-label': 'All readers received'
    }),
    'received'
    ),
    React.createElement('label', {
      className: (agg.receipt ? 'agg-on' : '') + (canAck ? ' can-ack' : ''),
      title: canAck ? 'Send Fabric MessageReceipt' : receiptTitle,
      onClick: canAck && !busy
        ? (e) => { e.preventDefault(); this.onReceipt(); }
        : undefined
    },
    React.createElement('input', {
      type: 'checkbox',
      checked: !!agg.receipt,
      disabled: !canAck || busy,
      readOnly: !canAck,
      onChange: canAck ? () => this.onReceipt() : undefined,
      'aria-label': canAck ? 'Send receipt' : 'All readers receipted'
    }),
    busy ? '…' : 'receipt'
    ),
    !(d.wireHash || this.props.wireHash)
      ? React.createElement('span', { className: 'hint' }, 'awaiting wire')
      : null,
    this.state.error
      ? React.createElement('span', { className: 'hint', style: { color: 'var(--kill)' } }, this.state.error)
      : null
    );
  }
}

DeliverySync.CSS = CSS;
DeliverySync.postDeliveryReceipt = postDeliveryReceipt;
DeliverySync.postDeliveryReceiptHttp = postDeliveryReceiptHttp;
DeliverySync.ensureStyle = ensureStyle;

module.exports = DeliverySync;
