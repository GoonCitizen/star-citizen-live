'use strict';

/**
 * Native Capacitor QR scan (`FabricQrScanner`). Missing plugin is a skip
 * so desktop can use the in-page camera overlay.
 */

function fabricQrScannerPlugin () {
  try {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FabricQrScanner;
  } catch (_) {
    return null;
  }
}

async function scanQrNative () {
  const plugin = fabricQrScannerPlugin();
  if (!plugin || typeof plugin.scan !== 'function') return { skipped: true };
  const result = await plugin.scan();
  if (result && result.cancelled) return { cancelled: true };
  const text = result && result.text != null ? String(result.text).trim() : '';
  if (!text) return { error: 'empty scan' };
  return { text };
}

module.exports = {
  fabricQrScannerPlugin,
  scanQrNative
};
