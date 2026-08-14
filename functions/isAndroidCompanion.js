'use strict';

/**
 * True when the dashboard is running inside the Capacitor Android WebView
 * (polyfilled `window.electronAPI.platform === 'android'`).
 */
function isAndroidCompanion () {
  try {
    if (typeof window === 'undefined') return false;
    const api = window.electronAPI;
    if (api && api.platform === 'android') return true;
    return !!(window.Capacitor && window.Capacitor.getPlatform &&
      window.Capacitor.getPlatform() === 'android');
  } catch (_) {
    return false;
  }
}

module.exports = { isAndroidCompanion };
