'use strict';

/**
 * Cross-runtime desktop notifications for the dashboard.
 * Prefers Electron IPC (`window.electronAPI.notify`); falls back to the
 * browser Notification API when running in a plain browser tab.
 *
 * Electron may support action buttons (Accept / Ignore) — primarily on
 * macOS. Callers should still offer in-app Accept / Ignore controls.
 */

/**
 * @param {{
 *   title: string,
 *   body?: string,
 *   id?: string,
 *   kind?: string,
 *   actions?: Array<{ id?: string, text: string }>,
 *   onClick?: Function
 * }} opts
 * @returns {Promise<boolean>} true when a notification was shown
 */
async function showDesktopNotification (opts = {}) {
  const title = String(opts.title || 'GoonCitizen');
  const body = String(opts.body || '');
  const actions = Array.isArray(opts.actions) ? opts.actions : [];

  if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.notify === 'function') {
    try {
      const res = await window.electronAPI.notify({
        title,
        body,
        id: opts.id || null,
        kind: opts.kind || null,
        actions: actions.map((a) => ({
          id: a.id || a.text,
          text: String(a.text || a.id || 'OK')
        }))
      });
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
