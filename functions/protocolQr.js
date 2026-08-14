'use strict';

/**
 * Optional QR data-URL for fabric:// protocol URLs (SiteLogin / Hub Identity).
 * Uses the `qrcode` package when installed (Hub already depends on it).
 */

function protocolQrDataUrl (text) {
  const value = String(text || '').trim();
  if (!value) return Promise.resolve(null);
  let QRCode = null;
  try {
    QRCode = require('qrcode');
  } catch (_) {
    return Promise.resolve(null);
  }
  if (!QRCode || typeof QRCode.toDataURL !== 'function') return Promise.resolve(null);
  return QRCode.toDataURL(value, {
    width: 196,
    margin: 1,
    errorCorrectionLevel: 'M'
  }).catch(() => null);
}

module.exports = { protocolQrDataUrl };
