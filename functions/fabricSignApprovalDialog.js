'use strict';

/**
 * Native approval dialog for Passport requests to the desktop local signer
 * (`functions/fabricLocalSignerRelay.js` → `settings.fabricSignApprover` in `main.js`).
 * Pure: builds `dialog.showMessageBox` options; button 0 approves.
 */

function shortKey (hex) {
  const h = String(hex || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-8)}` : (h || 'unknown');
}

function plainText (value, max = 200) {
  return String(value || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ').trim().slice(0, max);
}

const SHARE_TEXT = {
  identity: 'your pilot identity’s public key',
  wallet: 'the account’s wallet public keys, which reveal its balance and history',
  cosigner: 'the account’s cosigner public key'
};

/**
 * @param {object} prompt `{ kind, origin, purpose, device, network, account, shares, code }` from the local signer
 * @param {string} [appName]
 * @returns {object} options for `dialog.showMessageBox`
 */
function fabricSignApprovalDialog (prompt = {}, appName = 'GoonCitizen') {
  const device = shortKey(prompt.device);
  const app = plainText(appName, 40) || 'GoonCitizen';
  if (prompt.kind === 'link') {
    const label = plainText(prompt.label || prompt.purpose, 64) || 'a device';
    const code = /^[0-9]{6}$/.test(String(prompt.code || '')) ? String(prompt.code) : null;
    return {
      type: 'question',
      title: 'Link a device',
      message: `Link “${label}” to ${app}?`,
      detail: [
        code ? `Pairing code: ${code}\n\nCheck that the device shows the same code. If it doesn’t, cancel.` : null,
        `Device key ${device}.`,
        `Once linked, this device can ask ${app} to sign you in to websites as your pilot identity. ` +
          'You approve each sign-in here. Only link a device you control.'
      ].filter(Boolean).join('\n\n'),
      buttons: ['Link device', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    };
  }
  if (prompt.kind === 'device-link-confirm') {
    const label = plainText(prompt.purpose, 64) || 'a device';
    const fingerprint = plainText(prompt.fingerprint, 40) || 'unknown';
    const hub = plainText(prompt.origin, 200) || 'the Hub';
    return {
      type: 'question',
      title: 'Confirm the device',
      message: `Link “${label}” to ${app}?`,
      detail: `A device answered your add-device code through ${hub}.\n\nIts key: ${fingerprint}\n\n` +
        'Check that the other device shows the same key. If it does not, or you did not just scan this code, cancel — ' +
        'linked devices act as you.',
      buttons: ['Link device', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    };
  }
  const origin = plainText(prompt.origin, 200) || 'an unknown site';
  const purpose = plainText(prompt.purpose, 200);
  const shares = (Array.isArray(prompt.shares) && prompt.shares.length ? prompt.shares : ['identity'])
    .filter((s) => SHARE_TEXT[s]);
  const network = plainText(prompt.network, 16);
  const account = Number.isInteger(prompt.account) ? prompt.account : null;
  const lines = [
    `Requested by your linked device ${device}.`,
    purpose ? `Message from the site (not verified): “${purpose}”` : null,
    (network || account != null)
      ? `Account ${account != null ? account : 0}${network ? ` on ${network}` : ''}.`
      : null,
    `The site receives ${shares.map((s) => SHARE_TEXT[s]).join('; ')}. Nothing else is shared.`
  ].filter(Boolean);
  return {
    type: 'question',
    title: 'Sign in',
    message: `Sign in to ${origin} with ${app}?`,
    detail: lines.join('\n\n'),
    buttons: ['Sign in', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  };
}

module.exports = { fabricSignApprovalDialog };
