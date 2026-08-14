'use strict';

/**
 * Capacitor WebView talks to the on-device LiveRelay over loopback only.
 * Application data never uses HTTPS to a remote hub — Fabric Peer is the
 * remote plane (D-010). D-011 / D-013 HTTPS remains pairing rendezvous.
 */

const LOCAL_NODE_ORIGIN = 'http://127.0.0.1:3041';
const LOCAL_NODE_PORT = '3041';

function localNodeOrigin () {
  return LOCAL_NODE_ORIGIN;
}

function _isCapacitorDashboardOrigin (url) {
  try {
    const u = new URL(String(url || ''));
    const host = u.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') return false;
    const proto = u.protocol;
    if (proto !== 'http:' && proto !== 'https:' && proto !== 'capacitor:') return false;
    const port = u.port || (proto === 'https:' ? '443' : proto === 'http:' ? '80' : '');
    if (host === '127.0.0.1' && port === LOCAL_NODE_PORT) return false;
    return port === '' || port === '80' || port === '443' || port === LOCAL_NODE_PORT;
  } catch (_) {
    return false;
  }
}

function rewriteLocalNodeUrl (url) {
  const s = String(url || '');
  if (!s || s.startsWith('//')) return s;
  if (s.startsWith('/')) return LOCAL_NODE_ORIGIN + s;
  if (_isCapacitorDashboardOrigin(s)) {
    try {
      const u = new URL(s);
      return LOCAL_NODE_ORIGIN + u.pathname + u.search + u.hash;
    } catch (_) {
      return s;
    }
  }
  return s;
}

function _sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function _nodePlugin (win) {
  try {
    const cap = win.Capacitor;
    const plugins = cap && cap.Plugins;
    if (plugins) {
      const found = plugins.CapacitorNodeJS || plugins.NodeJS || plugins.CapacitorNodejs;
      if (found) return found;
    }
    if (typeof cap.registerPlugin === 'function') {
      return cap.registerPlugin('CapacitorNodeJS');
    }
  } catch (_) { /* ignore */ }
  return null;
}

async function waitForNodePlugin (win, timeoutMs = 15000) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w) return null;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const Node = _nodePlugin(w);
    if (Node && typeof Node.start === 'function') return Node;
    await _sleep(50);
  }
  return _nodePlugin(w);
}

async function waitForLocalNodeHttp (win, timeoutMs = 45000) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  const fetchImpl = (w && w.fetch) || (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) return false;
  const start = Date.now();
  let delay = 80;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetchImpl(LOCAL_NODE_ORIGIN + '/services/star-citizen', {
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (res && (res.ok || res.status < 500)) return true;
    } catch (_) { /* not listening yet */ }
    await _sleep(delay);
    delay = Math.min(Math.round(delay * 1.4), 800);
  }
  return false;
}

function _retryLoopbackFetch (orig, input, init) {
  const url = typeof input === 'string' ? input : (input && input.url);
  const loopback = typeof url === 'string' && url.indexOf(LOCAL_NODE_ORIGIN) === 0;
  if (!loopback) return orig(input, init);
  const attempt = (n) => orig(input, init).catch((err) => {
    if (n >= 8) throw err;
    return _sleep(Math.min(80 * Math.pow(1.5, n), 1000)).then(() => attempt(n + 1));
  });
  return attempt(0);
}

/**
 * Point same-origin `/services/…` fetches at the local LiveRelay.
 * No-op when `window.fetch` is missing.
 * @param {Window} [win]
 * @returns {boolean}
 */
function installLocalNodeFetch (win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w || typeof w.fetch !== 'function') return false;
  if (w.__goonLocalNodeFetch) return true;
  const orig = w.fetch.bind(w);
  w.fetch = function goonLocalNodeFetch (input, init) {
    if (typeof input === 'string') {
      const next = rewriteLocalNodeUrl(input);
      return _retryLoopbackFetch(orig, next, init);
    }
    if (input && typeof input.url === 'string') {
      const next = rewriteLocalNodeUrl(input.url);
      if (next !== input.url) {
        return _retryLoopbackFetch(orig, next, init);
      }
    }
    return orig(input, init);
  };
  w.__goonLocalNodeFetch = true;
  return true;
}

/**
 * Start the embedded Node LiveRelay when a Capacitor NodeJS plugin is present.
 * Waits until loopback HTTP answers — `whenReady` fires when `bridge` loads,
 * which is before LiveRelay listens.
 * @param {Window} [win]
 * @returns {Promise<boolean>}
 */
async function startEmbeddedAndroidNode (win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w) return false;
  const Node = await waitForNodePlugin(w);
  if (!Node || typeof Node.start !== 'function') {
    return waitForLocalNodeHttp(w, 8000);
  }
  // nativeStart blocks until the Node event loop exits. Do not await start()
  // or the dashboard stays on "Starting local node…" while LiveRelay is up.
  Node.start({
    env: {
      SC_MODE: 'android',
      PORT: '3041',
      FABRIC_HUB_INTERFACE: '127.0.0.1'
    }
  }).catch((e) => {
    const msg = String((e && e.message) || e || '');
    if (!/already been started|not enabled/i.test(msg)) {
      try { console.warn('[GOONCITIZEN] embedded Node start:', msg); } catch (_) {}
    }
  });
  return waitForLocalNodeHttp(w);
}

/**
 * POST unlocked identity to the local node so the Fabric Peer uses this device key.
 * Loopback-only on the server. Never send this to a remote origin.
 * @param {Object|null} identity
 * @param {Object} [opts]
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
async function syncIdentityToLocalNode (identity, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const origin = opts.origin || LOCAL_NODE_ORIGIN;
  if (!fetchImpl) return { ok: false, error: 'fetch unavailable' };
  const url = `${String(origin).replace(/\/$/, '')}/services/star-citizen/identity/session`;
  try {
    const body = identity
      ? { xprv: identity.xprv, mnemonic: identity.mnemonic || undefined }
      : { lock: true };
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data && data.error) || `HTTP ${res.status}` };
    return { ok: true, pubkey: data.pubkey };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

module.exports = {
  LOCAL_NODE_ORIGIN,
  localNodeOrigin,
  rewriteLocalNodeUrl,
  installLocalNodeFetch,
  startEmbeddedAndroidNode,
  waitForLocalNodeHttp,
  waitForNodePlugin,
  syncIdentityToLocalNode
};
