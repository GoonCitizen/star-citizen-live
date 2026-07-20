'use strict';

/**
 * Cross-runtime desktop notifications for the dashboard.
 * Prefers Electron IPC (`window.electronAPI.notify`); falls back to the
 * browser Notification API when running in a plain browser tab.
 */

/**
 * @param {{ title: string, body?: string, onClick?: Function }} opts
 * @returns {Promise<boolean>} true when a notification was shown
 */
async function showDesktopNotification (opts = {}) {
  const title = String(opts.title || 'GoonCitizen');
  const body = String(opts.body || '');

  if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.notify === 'function') {
    try {
      const res = await window.electronAPI.notify({ title, body });
      return !!(res && res.ok !== false);
    } catch (_) {
      // fall through to browser API
    }
  }

  if (typeof Notification === 'undefined') return false;
  let permission = Notification.permission;
  if (permission === 'default') {
    try { permission = await Notification.requestPermission(); } catch (_) { return false; }
  }
  if (permission !== 'granted') return false;

  try {
    const n = new Notification(title, { body, silent: false });
    if (typeof opts.onClick === 'function') {
      n.onclick = () => {
        try { window.focus(); } catch (_) { /* ignore */ }
        opts.onClick();
      };
    }
    return true;
  } catch (_) {
    return false;
  }
}

/** @returns {Promise<'granted'|'denied'|'default'|'unsupported'>} */
async function ensureNotifyPermission () {
  if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.notify === 'function') {
    return 'granted';
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch (_) {
    return 'denied';
  }
}

module.exports = {
  showDesktopNotification,
  ensureNotifyPermission
};
