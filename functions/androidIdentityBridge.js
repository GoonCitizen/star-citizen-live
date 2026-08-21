'use strict';

/**
 * Capacitor Android polyfill for `window.electronAPI` (identity + fabric:// prompts).
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

function _bufToHex (buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function _hexToBuf (hex) {
  const s = String(hex || '');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function _pbkdf2Key (password, saltHex) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: _hexToBuf(saltHex), iterations: 210000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptIdentityWeb (identity, password) {
  const salt = _bufToHex(crypto.getRandomValues(new Uint8Array(16)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await _pbkdf2Key(password, salt);
  const secret = JSON.stringify({ mnemonic: identity.mnemonic || null, xprv: identity.xprv });
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret));
  const bytes = new Uint8Array(cipher);
  const tag = bytes.slice(bytes.length - 16);
  const ciphertext = bytes.slice(0, bytes.length - 16);
  return {
    version: 2,
    kdf: { algorithm: 'pbkdf2', salt, iterations: 210000, hash: 'SHA-256' },
    cipher: 'aes-256-gcm',
    iv: _bufToHex(iv),
    tag: _bufToHex(tag),
    ciphertext: _bufToHex(ciphertext),
    pubkey: identity.pubkey,
    xpub: identity.xpub,
    id: identity.pubkey,
    createdAt: new Date().toISOString()
  };
}

async function decryptIdentityWeb (blob, password) {
  const key = await _pbkdf2Key(password, blob.kdf.salt);
  const ct = _hexToBuf(blob.ciphertext);
  const tag = _hexToBuf(blob.tag);
  const packed = new Uint8Array(ct.length + tag.length);
  packed.set(ct, 0);
  packed.set(tag, ct.length);
  let secret;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: _hexToBuf(blob.iv) },
      key,
      packed
    );
    secret = JSON.parse(new TextDecoder().decode(plain));
  } catch (_) {
    throw new Error('Could not decrypt identity (wrong password or corrupted file)');
  }
  const { restoreIdentity } = require('./identity');
  return restoreIdentity({ xprv: secret.xprv, mnemonic: secret.mnemonic || undefined });
}

function installAndroidIdentityBridge () {
  if (typeof window === 'undefined') return false;
  if (!window.Capacitor) return false;
  if (window.electronAPI && window.electronAPI.identity && window.electronAPI.platform !== 'android') {
    return false;
  }

  const identityLib = require('./identity');
  const { assertAllowedFabricHub } = require('./fabricHubAllowlist');
  const { parseFabricLoginUrl } = require('./fabricProtocolLogin');
  const { parseFabricDeviceLinkUrl } = require('./fabricDeviceLinkProtocol');
  const { completeClientSignedLogin } = require('./fabricLoginClient');
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
  const loginHandlers = [];
  let pendingLogin = null;
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
      return {
        exists: !!blob,
        pubkey: blob ? blob.pubkey : null,
        xpub: blob ? blob.xpub : null,
        createdAt: blob ? blob.createdAt : null,
        unlocked: !!unlocked,
        autoLockMinutes,
        pendingDeviceLinkOffer: pending
      };
    });
  }

  async function encryptAndSave (identity, password) {
    let blob;
    try {
      blob = identityLib.encryptIdentity(identity, password);
    } catch (_) {
      blob = await encryptIdentityWeb(identity, password);
    }
    await persistIdentityBlob(blob);
    unlocked = identity;
    armAutoLock();
    emitChanged();
    void syncIdentityToLocalNode(identity);
    return blob;
  }

  async function decryptBlob (blob, password) {
    if (blob && blob.version === 2) return decryptIdentityWeb(blob, password);
    return identityLib.decryptIdentity(blob, password);
  }

  function emitLoginPrompt (payload) {
    if (!payload) return;
    stampCreatedAt(payload);
    pendingLogin = payload;
    loginHandlers.forEach((fn) => {
      try { fn(payload); } catch (_) {}
    });
  }

  async function handleProtocolUrl (urlStr) {
    const link = parseFabricDeviceLinkUrl(urlStr);
    if (link && link.ok) {
      const allowed = assertAllowedFabricHub(link.hubBase);
      if (!allowed.ok) {
        emitLoginPrompt({
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
      emitLoginPrompt({
        kind: 'device-link',
        sessionId: link.sessionId,
        origin: (pending.ok && pending.origin) || link.hubBase,
        hubBase: link.hubBase,
        nonce: pending.ok ? pending.nonce : null,
        label: pending.ok ? pending.label : null,
        initiator: pending.ok ? pending.initiator : null,
        identityLocked: !unlocked,
        error: pending.ok ? null : pending.error
      });
      return;
    }
    const login = parseFabricLoginUrl(urlStr);
    if (login && login.ok) {
      const allowed = assertAllowedFabricHub(login.hubBase);
      if (!allowed.ok) {
        emitLoginPrompt({
          kind: 'login',
          sessionId: login.sessionId,
          origin: login.hubBase,
          hubBase: login.hubBase,
          error: allowed.error || 'hub origin is not allowlisted',
          identityLocked: !unlocked
        });
        return;
      }
      emitLoginPrompt({
        kind: 'login',
        sessionId: login.sessionId,
        origin: login.hubBase,
        hubBase: login.hubBase,
        identityLocked: !unlocked
      });
    }
  }

  const identity = {
    get: () => currentSummary(),
    create: async (password) => {
      const blob = await readIdentityBlob();
      if (blob) {
        return {
          error: 'An identity already exists. Unlock it, or forget it on this device first.',
          exists: true
        };
      }
      if (!password || password.length < 8) return { error: 'Password must be at least 8 characters.' };
      try {
        const ident = identityLib.createIdentity();
        await encryptAndSave(ident, password);
        return { pubkey: ident.pubkey, mnemonic: ident.mnemonic };
      } catch (e) {
        return { error: e.message || String(e) };
      }
    },
    restore: async (opts) => {
      const password = opts && opts.password;
      if (!password || password.length < 8) return { error: 'Password must be at least 8 characters.' };
      try {
        const ident = identityLib.restoreIdentity(opts.xprv ? { xprv: opts.xprv } : { mnemonic: opts.mnemonic });
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
        unlocked = await decryptBlob(blob, password);
        armAutoLock();
        emitChanged();
        void syncIdentityToLocalNode(unlocked);
        return { pubkey: unlocked.pubkey };
      } catch (e) {
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
    signMessage: async (message) => {
      if (!unlocked) return { error: 'Identity is locked.' };
      if (typeof message !== 'string' || !message.length) return { error: 'message string required' };
      try {
        const key = identityLib.keyFromIdentity(unlocked);
        const sig = key.signSchnorr(Buffer.from(message));
        const signature = typeof sig === 'string' ? sig : _bufToHex(sig);
        armAutoLock();
        return { pubkey: key.pubkey, signature };
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
    reveal: async (password) => {
      const blob = await readIdentityBlob();
      if (!blob) return { error: 'No identity found.' };
      try {
        const ident = await decryptBlob(blob, password);
        return { mnemonic: ident.mnemonic, xprv: ident.xprv };
      } catch (e) {
        return { error: e.message || String(e) };
      }
    },
    exportBackup: async (password) => {
      const blob = await readIdentityBlob();
      if (!blob) return { error: 'No identity found.' };
      try {
        await decryptBlob(blob, password);
        return { backup: blob };
      } catch (e) {
        return { error: e.message || String(e) };
      }
    },
    importBackup: async (backup, password, replace) => {
      if (!replace) {
        const existing = await readIdentityBlob();
        if (existing) {
          return { error: 'An identity already exists. Forget it on this device first, or check replace.', exists: true };
        }
      }
      try {
        const ident = await decryptBlob(backup, password);
        await encryptAndSave(ident, password);
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
    cancelDeviceLinkOffer: async () => {
      try { await localDeviceLinkFetch('/cancel', { method: 'POST', body: {} }); } catch (_) { /* ignore */ }
      pendingDeviceLinkOffer = null;
      return { ok: true, cancelled: true };
    },
    openProtocolUrl: async (url) => {
      await handleProtocolUrl(String(url || '').trim());
      return { ok: true };
    },
    onChanged: (handler) => {
      changeHandlers.push(handler);
      return () => {
        const i = changeHandlers.indexOf(handler);
        if (i >= 0) changeHandlers.splice(i, 1);
      };
    }
  };

  const fabricLogin = {
    onPrompt: (handler) => {
      loginHandlers.push(handler);
      return () => {
        const i = loginHandlers.indexOf(handler);
        if (i >= 0) loginHandlers.splice(i, 1);
      };
    },
    pullPending: async () => {
      if (!pendingLogin) return null;
      if (isDeviceLinkPromptExpired(pendingLogin)) {
        pendingLogin = null;
        return null;
      }
      return pendingLogin;
    },
    resolve: async (opts) => {
      const prompt = pendingLogin;
      if (!prompt || !prompt.sessionId) return { error: 'no pending prompt' };
      if (!opts || !opts.approve) {
        pendingLogin = null;
        return { ok: true, approved: false };
      }
      if (!unlocked) return { error: 'Identity is locked — unlock it, then try the link again.' };
      if (prompt.kind === 'device-link') {
        if (prompt.error && !prompt.initiator) {
          pendingLogin = null;
          return { error: prompt.error };
        }
        if (isDeviceLinkPromptExpired(prompt)) {
          pendingLogin = null;
          return { error: 'This device-link expired. Scan a fresh QR.' };
        }
        const result = await localDeviceLinkFetch('/accept', {
          method: 'POST',
          body: {
            hubBase: prompt.hubBase,
            sessionId: prompt.sessionId,
            nonce: prompt.nonce,
            label: prompt.label,
            initiator: prompt.initiator
          }
        });
        if (!result.ok) return { error: result.error || 'Device link failed.' };
        pendingLogin = null;
        armAutoLock();
        return { ok: true, approved: true, linked: true };
      }
      const { fetchPendingLoginSession } = require('./fabricLoginClient');
      const pending = await fetchPendingLoginSession(prompt.hubBase, prompt.sessionId);
      if (!pending.ok) return { error: pending.error || 'session not pending' };
      const done = await completeClientSignedLogin(
        unlocked,
        prompt.hubBase,
        prompt.sessionId,
        pending.message
      );
      if (!done.ok) return { error: done.error || 'login failed' };
      pendingLogin = null;
      armAutoLock();
      return { ok: true, approved: true };
    }
  };

  window.electronAPI = Object.assign({}, window.electronAPI || {}, {
    identity,
    fabricLogin,
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
