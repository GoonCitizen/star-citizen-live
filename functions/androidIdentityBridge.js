'use strict';

/**
 * Capacitor Android polyfill for `window.electronAPI` (identity + fabric://link prompts).
 * Only installs when `window.Capacitor` is set and Electron preload has not already
 * exposed an identity bridge. Each device keeps its own seed — linking is D-013
 * cross-sign, not mnemonic copy.
 */

const { Buffer } = require('buffer');
const {
  IDENTITY_PREF,
  readIdentityBlob,
  persistIdentityBlob,
  clearIdentityBlob,
  readAutoLockMinutes,
  writeAutoLockMinutes
} = require('./androidIdentityStore');
const {
  stampCreatedAt,
  isDeviceLinkPromptExpired,
  isStaleDeviceLinkError
} = require('./deviceLinkLifecycle');

const { sealMasterWeb, unsealMasterWeb } = require('./webSealedMaster');

/**
 * Seal an identity into a core account vault with Web Crypto (same envelope
 * as `identity.encryptIdentity` on desktop).
 * @param {Object} identity
 * @param {string} password Lock password.
 * @returns {Promise<object>}
 */
async function encryptIdentityWeb (identity, password) {
  const identityLib = require('./identity');
  const seal = await sealMasterWeb(identity.xprv, password);
  return identityLib.identityVaultFromSeal(seal, identity);
}

/**
 * @param {object} blob Account vault.
 * @param {string} password Lock password.
 * @returns {Promise<object>} Unlocked identity of the vault's current account.
 */
async function decryptIdentityWeb (blob, password) {
  const identityLib = require('./identity');
  if (!identityLib.isIdentityVault(blob)) throw new Error(identityLib.LEGACY_BLOB_ERROR);
  const master = await unsealMasterWeb(blob.seal, password);
  return identityLib.openIdentityVault(blob, master);
}

function installAndroidIdentityBridge () {
  if (typeof window === 'undefined') return false;
  if (!window.Capacitor) return false;
  if (window.electronAPI && window.electronAPI.identity && window.electronAPI.platform !== 'android') {
    return false;
  }

  const identityLib = require('./identity');
  const { assertAllowedFabricHub } = require('./fabricHubAllowlist');
  const { parseFabricDeviceLinkUrl } = require('./fabricDeviceLinkProtocol');
  const { signInToRelay } = require('./fabricLoginClient');
  const { localNodeOrigin, syncIdentityToLocalNode } = require('./androidLocalNode');

  async function localDeviceLinkFetch (path, opts = {}) {
    const fetchImpl = opts.fetchImpl || globalThis.fetch;
    const url = localNodeOrigin() + '/services/star-citizen/device-links' + path;
    const init = {
      method: opts.method || 'GET',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      cache: 'no-store'
    };
    if (opts.body != null) init.body = JSON.stringify(opts.body);
    const res = await fetchImpl(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: (data && data.error) || `HTTP ${res.status}`, status: res.status };
    }
    return data && typeof data === 'object' ? Object.assign({ ok: true }, data) : { ok: true, data };
  }

  let unlocked = null;
  let autoLockMinutes = 15;
  let autoLockTimer = null;
  const changeHandlers = [];
  const promptHandlers = [];
  let pendingPrompt = null;
  let pendingDeviceLinkOffer = null;

  function emitChanged () {
    const summary = currentSummary();
    changeHandlers.forEach((fn) => {
      try { fn(summary); } catch (_) {}
    });
  }

  function armAutoLock () {
    if (autoLockTimer) clearTimeout(autoLockTimer);
    autoLockTimer = null;
    if (!unlocked || !autoLockMinutes) return;
    autoLockTimer = setTimeout(() => {
      unlocked = null;
      emitChanged();
    }, autoLockMinutes * 60 * 1000);
  }

  function currentSummary () {
    return Promise.resolve(readIdentityBlob()).then(async (blob) => {
      let pending = pendingDeviceLinkOffer && pendingDeviceLinkOffer.ok
        ? pendingDeviceLinkOffer
        : null;
      try {
        const row = await localDeviceLinkFetch('/current');
        if (row && row.ok && row.pending) pending = row;
      } catch (_) { /* node not up yet */ }
      const vault = identityLib.identityBlobSummary(blob);
      return Object.assign({
        exists: !!blob,
        legacy: !!blob && !vault,
        pubkey: null,
        account: null,
        network: null,
        label: null,
        wallet: null,
        cosigner: null,
        accounts: [],
        createdAt: null
      }, vault || {}, {
        unlocked: !!unlocked && !!vault,
        autoLockMinutes,
        pendingDeviceLinkOffer: pending
      });
    });
  }

  function setUnlocked (identity) {
    unlocked = identity;
    armAutoLock();
    emitChanged();
    void syncIdentityToLocalNode(identity);
  }

  async function encryptAndSave (identity, password) {
    const blob = await encryptIdentityWeb(identity, password);
    await persistIdentityBlob(blob);
    setUnlocked(identity);
    return blob;
  }

  function backupVault (backup) {
    return backup && backup.type === 'gooncitizen-identity-backup' ? backup.vault : backup;
  }

  function emitDeviceLinkPrompt (payload) {
    if (!payload) return;
    stampCreatedAt(payload);
    pendingPrompt = payload;
    promptHandlers.forEach((fn) => {
      try { fn(payload); } catch (_) {}
    });
  }

  async function handleProtocolUrl (urlStr) {
    const link = parseFabricDeviceLinkUrl(urlStr);
    if (link && link.ok) {
      const allowed = assertAllowedFabricHub(link.hubBase);
      if (!allowed.ok) {
        emitDeviceLinkPrompt({
          kind: 'device-link',
          sessionId: link.sessionId,
          origin: link.hubBase,
          hubBase: link.hubBase,
          error: allowed.error || 'hub origin is not allowlisted',
          identityLocked: !unlocked
        });
        return;
      }
      const q = '?sessionId=' + encodeURIComponent(link.sessionId) +
        '&hub=' + encodeURIComponent(link.hubBase);
      const pending = await localDeviceLinkFetch('/pending' + q);
      emitDeviceLinkPrompt({
        kind: 'device-link',
        sessionId: link.sessionId,
        origin: (pending.ok && pending.origin) || link.hubBase,
        hubBase: link.hubBase,
        nonce: pending.ok ? pending.nonce : null,
        label: pending.ok ? pending.label : null,
        initiator: pending.ok ? pending.initiator : null,
        fingerprint: pending.ok ? (pending.fingerprint || null) : null,
        identityLocked: !unlocked,
        error: pending.ok ? null : pending.error
      });
      return;
    }
  }

  /**
   * Native HTTP (CapacitorHttp) as a fetch: a WebView fetch adds `Origin`,
   * and a relay answers Passport native sign-in only without one.
   * @returns {Function|null}
   */
  function nativeHttpFetch () {
    const plugins = window.Capacitor && window.Capacitor.Plugins;
    const nativeHttp = plugins && plugins.CapacitorHttp;
    if (!nativeHttp || typeof nativeHttp.request !== 'function') return null;
    return async (url, init = {}) => {
      const res = await nativeHttp.request({
        url,
        method: init.method || 'GET',
        headers: init.headers || {},
        data: init.body != null ? JSON.parse(init.body) : undefined
      });
      const status = Number(res && res.status) || 0;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => (typeof res.data === 'string' ? JSON.parse(res.data) : res.data)
      };
    };
  }

  const identity = {
    get: () => currentSummary(),
    create: async (password, opts = {}) => {
      const blob = await readIdentityBlob();
      if (blob) {
        return {
          error: 'An identity already exists. Unlock it, or forget it on this device first.',
          exists: true
        };
      }
      if (!password || password.length < 8) return { error: 'Password must be at least 8 characters.' };
      try {
        const { mnemonic, ...ident } = identityLib.createIdentity({
          passphrase: opts && opts.passphrase,
          account: opts && opts.account,
          network: opts && opts.network
        });
        await encryptAndSave(ident, password);
        return { pubkey: ident.pubkey, mnemonic };
      } catch (e) {
        return { error: e.message || String(e) };
      }
    },
    restore: async (opts) => {
      const password = opts && opts.password;
      if (!password || password.length < 8) return { error: 'Password must be at least 8 characters.' };
      if (await readIdentityBlob()) {
        return { error: 'An identity already exists. Forget it on this device first.', exists: true };
      }
      try {
        const ident = identityLib.restoreIdentity(opts.xprv
          ? { xprv: opts.xprv, account: opts.account, network: opts.network }
          : { mnemonic: opts.mnemonic, passphrase: opts.passphrase, account: opts.account, network: opts.network });
        await encryptAndSave(ident, password);
        return { pubkey: ident.pubkey };
      } catch (e) {
        return { error: e.message || String(e) };
      }
    },
    unlock: async (password) => {
      const blob = await readIdentityBlob();
      if (!blob) return { error: 'No identity found.' };
      try {
        setUnlocked(await decryptIdentityWeb(blob, password));
        return { pubkey: unlocked.pubkey };
      } catch (e) {
        return { error: e.message || String(e) };
      }
    },
    selectAccount: async (pair = {}) => {
      const blob = await readIdentityBlob();
      if (!blob) return { error: 'No identity found.' };
      try {
        const result = identityLib.selectIdentityAccount(blob, pair, unlocked);
        await persistIdentityBlob(result.blob);
        if (result.identity) setUnlocked(result.identity);
        else emitChanged();
        return currentSummary();
      } catch (e) {
        if (e && e.code === 'FABRIC_ACCOUNT_LOCKED') return { error: 'Unlock to add this account.' };
        return { error: e.message || String(e) };
      }
    },
    signEnvelope: async (payload) => {
      if (!unlocked) return { error: 'Identity is locked.' };
      try {
        const envelope = identityLib.signEnvelope(unlocked, payload);
        armAutoLock();
        return envelope;
      } catch (e) {
        return { error: e.message || String(e) };
      }
    },
    lock: async () => {
      unlocked = null;
      armAutoLock();
      emitChanged();
      void syncIdentityToLocalNode(null);
      return { ok: true };
    },
    exportBackup: async (password) => {
      const blob = await readIdentityBlob();
      if (!blob) return { error: 'No identity found.' };
      try {
        await decryptIdentityWeb(blob, password);
        const summary = identityLib.identityBlobSummary(blob);
        return {
          filename: `gooncitizen-identity-${((summary && summary.pubkey) || 'backup').slice(0, 8)}.enc.json`,
          backup: { type: 'gooncitizen-identity-backup', v: 2, createdAt: new Date().toISOString(), vault: blob }
        };
      } catch (e) {
        return { error: e.message || String(e) };
      }
    },
    importBackup: async (backup, password, replace) => {
      const vault = backupVault(backup);
      if (!identityLib.isIdentityVault(vault)) {
        return { error: backup && backup.ciphertext ? identityLib.LEGACY_BLOB_ERROR : 'Not a GoonCitizen identity backup file.' };
      }
      if (!replace) {
        const existing = await readIdentityBlob();
        if (existing) {
          return { error: 'An identity already exists. Forget it on this device first, or check replace.', exists: true };
        }
      }
      try {
        const ident = await decryptIdentityWeb(vault, password);
        await persistIdentityBlob(vault);
        setUnlocked(ident);
        return { pubkey: ident.pubkey };
      } catch (e) {
        return { error: e.message || String(e) };
      }
    },
    setAutoLock: async (minutes) => {
      autoLockMinutes = Math.max(0, Number(minutes) || 0);
      await writeAutoLockMinutes(autoLockMinutes);
      armAutoLock();
      return { autoLockMinutes };
    },
    forget: async (confirm) => {
      if (!confirm) return { error: 'confirmation required' };
      unlocked = null;
      armAutoLock();
      await clearIdentityBlob();
      emitChanged();
      void syncIdentityToLocalNode(null);
      return { ok: true };
    },
    startDeviceLinkOffer: async (opts) => {
      if (!unlocked) return { error: 'Identity is locked — unlock it, then add a device.' };
      if (pendingDeviceLinkOffer) {
        try { await localDeviceLinkFetch('/cancel', { method: 'POST', body: {} }); } catch (_) { /* ignore */ }
        pendingDeviceLinkOffer = null;
      }
      const res = await localDeviceLinkFetch('/offer', {
        method: 'POST',
        body: {
          hubBase: opts && opts.hubBase,
          label: (opts && opts.label) || 'GoonCitizen Android'
        }
      });
      if (!res.ok) return { error: res.error || 'Could not create device-link offer' };
      pendingDeviceLinkOffer = res;
      armAutoLock();
      return res;
    },
    tickDeviceLinkOffer: async () => {
      if (!unlocked) return { error: 'Identity is locked' };
      if (!pendingDeviceLinkOffer) return { error: 'no pending device-link offer', expired: true };
      const res = await localDeviceLinkFetch('/tick', { method: 'POST', body: {} });
      if (!res.ok) {
        if (res.expired || isStaleDeviceLinkError(res)) pendingDeviceLinkOffer = null;
        return res;
      }
      if (res.status === 'linked') {
        pendingDeviceLinkOffer = null;
        armAutoLock();
      }
      return res;
    },
    confirmDeviceLinkOffer: async (responderId) => {
      if (!unlocked) return { error: 'Identity is locked' };
      if (!pendingDeviceLinkOffer) return { error: 'no pending device-link offer', expired: true };
      const res = await localDeviceLinkFetch('/confirm', { method: 'POST', body: { responderId } });
      if (!res.ok) {
        if (res.expired || isStaleDeviceLinkError(res)) pendingDeviceLinkOffer = null;
        return res;
      }
      if (res.status === 'linked') {
        pendingDeviceLinkOffer = null;
        armAutoLock();
      }
      return res;
    },
    cancelDeviceLinkOffer: async () => {
      try { await localDeviceLinkFetch('/cancel', { method: 'POST', body: {} }); } catch (_) { /* ignore */ }
      pendingDeviceLinkOffer = null;
      return { ok: true, cancelled: true };
    },
    openProtocolUrl: async (url) => {
      await handleProtocolUrl(String(url || '').trim());
      return { ok: true };
    },
    signInToRelay: async (origin) => {
      if (!unlocked) return { error: 'Identity is locked — unlock it, then sign in.' };
      const allowed = assertAllowedFabricHub(String(origin || ''));
      if (!allowed.ok) return { error: allowed.error || 'That relay is not allowlisted.' };
      const fetchImpl = nativeHttpFetch();
      if (!fetchImpl) return { error: 'Native HTTP is not available on this device.' };
      const result = await signInToRelay(unlocked, allowed.hubBase, { fetchImpl });
      if (!result.ok) return { error: result.error || 'Sign-in failed.' };
      armAutoLock();
      return { ok: true, token: result.token, session: result.session };
    },
    onChanged: (handler) => {
      changeHandlers.push(handler);
      return () => {
        const i = changeHandlers.indexOf(handler);
        if (i >= 0) changeHandlers.splice(i, 1);
      };
    }
  };

  const deviceLinkPrompt = {
    onPrompt: (handler) => {
      promptHandlers.push(handler);
      return () => {
        const i = promptHandlers.indexOf(handler);
        if (i >= 0) promptHandlers.splice(i, 1);
      };
    },
    pullPending: async () => {
      if (!pendingPrompt) return null;
      if (isDeviceLinkPromptExpired(pendingPrompt)) {
        pendingPrompt = null;
        return null;
      }
      return pendingPrompt;
    },
    resolve: async (opts) => {
      const prompt = pendingPrompt;
      if (!prompt || !prompt.sessionId) return { error: 'no pending prompt' };
      if (!opts || !opts.approve) {
        pendingPrompt = null;
        return { ok: true, approved: false };
      }
      if (!unlocked) return { error: 'Identity is locked — unlock it, then try the link again.' };
      if (prompt.kind === 'device-link') {
        if (prompt.error && !prompt.initiator) {
          pendingPrompt = null;
          return { error: prompt.error };
        }
        if (isDeviceLinkPromptExpired(prompt)) {
          pendingPrompt = null;
          return { error: 'This device-link expired. Scan a fresh QR.' };
        }
        const result = await localDeviceLinkFetch('/accept', {
          method: 'POST',
          body: {
            hubBase: prompt.hubBase,
            sessionId: prompt.sessionId,
            nonce: prompt.nonce,
            label: prompt.label,
            origin: prompt.origin,
            initiator: prompt.initiator
          }
        });
        if (!result.ok) return { error: result.error || 'Device link failed.' };
        pendingPrompt = null;
        armAutoLock();
        return { ok: true, approved: true, linked: true };
      }
      pendingPrompt = null;
      return { error: 'Unknown request.' };
    }
  };

  window.electronAPI = Object.assign({}, window.electronAPI || {}, {
    identity,
    deviceLinkPrompt,
    platform: 'android',
    notify: async (payload) => {
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification((payload && payload.title) || 'GoonCitizen', {
            body: (payload && payload.body) || ''
          });
        }
      } catch (_) {}
      return { ok: true };
    },
    onNotifyAction: () => () => {},
    onNotifyClick: () => () => {}
  });

  void readAutoLockMinutes(autoLockMinutes).then((minutes) => {
    autoLockMinutes = minutes;
    armAutoLock();
  }).catch(() => {});

  try {
    const CapApp = window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (CapApp && typeof CapApp.addListener === 'function') {
      CapApp.addListener('appUrlOpen', (event) => {
        if (event && event.url) void handleProtocolUrl(event.url);
      });
    }
    if (CapApp && typeof CapApp.getLaunchUrl === 'function') {
      CapApp.getLaunchUrl().then((r) => {
        if (r && r.url) void handleProtocolUrl(r.url);
      }).catch(() => {});
    }
  } catch (_) { /* plugin optional */ }

  return true;
}

module.exports = {
  IDENTITY_PREF,
  installAndroidIdentityBridge
};
