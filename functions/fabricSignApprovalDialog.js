'use strict';

/**
 * Native dialog that confirms a pairing with a linked signer (Passport on
 * this computer asking the loopback delegate, `services/GoonDelegation.js` →
 * `settings.fabricSignApprover` in `main.js`).
 * Pure: builds `dialog.showMessageBox` options; button 0 approves.
 * Signing requests never use it: they go to Notifications.
 */

function shortKey (hex) {
  const h = String(hex || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-8)}` : (h || 'unknown');
}

function plainText (value, max = 200) {
  return String(value || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ').trim().slice(0, max);
}

/**
 * @param {object} prompt `{ kind: 'link', code, label, signer }`
 * @param {string} [appName]
 * @returns {object|null} options for `dialog.showMessageBox`, or null for anything else
 */
function fabricSignApprovalDialog (prompt = {}, appName = 'GoonCitizen') {
  if (!prompt || prompt.kind !== 'link') return null;
  const app = plainText(appName, 40) || 'GoonCitizen';
  const label = plainText(prompt.label, 64) || 'a signer';
  const code = /^[0-9]{6}$/.test(String(prompt.code || '')) ? String(prompt.code) : null;
  if (!code) return null;
  return {
    type: 'question',
    title: 'Link a signer',
    message: `Link “${label}” to ${app}?`,
    detail: [
      `Pairing code: ${code}\n\nCheck that ${label} shows the same code. If it doesn’t, cancel.`,
      `Signer key ${shortKey(prompt.signer)}.`,
      `Each side keeps its own key. Once linked, ${label} can ask ${app} to sign, and you approve every request in Notifications. ` +
        'Only link a signer you control.'
    ].join('\n\n'),
    buttons: ['Link signer', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  };
}

module.exports = { fabricSignApprovalDialog };
