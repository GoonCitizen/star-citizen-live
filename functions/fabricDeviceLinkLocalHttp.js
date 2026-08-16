'use strict';

/**
 * Loopback device-link API for the Android (and local) LiveRelay.
 *
 * The Capacitor WebView must not POST to the public hub itself: CapacitorHttp
 * is native and omits Origin, so `@fabric/http` `clientMayAccessDeviceLink`
 * returns 403. Desktop Electron already signs from Node with Origin = hub.
 * Android uses these routes so the embedded Node process talks to
 * relay.goon.vc the same way.
 */

const { isLoopbackRequest } = require('./isLoopbackRequest');
const settingsStore = require('./settingsStore');
const { mergeLinkedDevice } = require('./linkedDevices');
const {
  startDeviceLinkOffer,
  tickDeviceLinkOffer,
  abandonDeviceLinkOffer,
  DEFAULT_DEVICE_LINK_HUB,
  DEVICE_LINK_TICK_MS,
  peerPubkeyFromParty,
  compactPendingOffer
} = require('./fabricDeviceLinkOffer');
const {
  isStaleDeviceLinkError,
  isDeviceLinkOfferExpired
} = require('./deviceLinkLifecycle');
const {
  fetchPendingDeviceLink,
  completeDeviceLinkAsResponder
} = require('./fabricDeviceLinkClient');

const LOCAL_PREFIX = '/services/star-citizen/device-links';

function persistLinkedDevice (relay, entry) {
  if (!relay || !relay.registerStore || !entry) return;
  try {
    const cur = settingsStore.loadSettings(relay.registerStore);
    const list = mergeLinkedDevice(cur.linkedDevices, entry);
    settingsStore.putSetting(relay.registerStore, 'linkedDevices', list);
  } catch (e) {
    relay.emit && relay.emit('warning', '[LiveRelay] linkedDevices persist: ' +
      ((e && e.message) ? e.message : e));
  }
}

async function publishCrossSign (relay, peerPubkey, nonce) {
  if (!relay || !peerPubkey || !nonce) return;
  if (typeof relay.publishLocalIdentityCrossSign !== 'function') return;
  try {
    await relay.publishLocalIdentityCrossSign({ peerPubkey, nonce });
  } catch (e) {
    relay.emit && relay.emit('warning', '[LiveRelay] IdentityCrossSign: ' +
      ((e && e.message) ? e.message : e));
  }
}

function stopDeviceLinkTick (relay) {
  if (!relay) return;
  if (relay._deviceLinkTickTimer) {
    clearInterval(relay._deviceLinkTickTimer);
    relay._deviceLinkTickTimer = null;
  }
  relay._deviceLinkTickBusy = false;
}

function persistPendingOffer (relay, offer) {
  if (!relay || !relay.registerStore) return;
  try {
    settingsStore.putSetting(relay.registerStore, 'pendingDeviceLinkOffer',
      offer ? compactPendingOffer(offer) : null);
  } catch (_) { /* allowlist / store not ready */ }
}

function restorePendingDeviceLinkOffer (relay) {
  if (!relay || relay._pendingDeviceLinkOffer || !relay.registerStore) return;
  try {
    const cur = settingsStore.loadSettings(relay.registerStore);
    const row = cur.pendingDeviceLinkOffer;
    if (!row || !row.sessionId) return;
    if (isDeviceLinkOfferExpired(row)) {
      persistPendingOffer(relay, null);
      return;
    }
    relay._pendingDeviceLinkOffer = row;
    armDeviceLinkTick(relay);
  } catch (_) { /* ignore */ }
}

function clearPendingOffer (relay) {
  if (!relay) return;
  relay._pendingDeviceLinkOffer = null;
  stopDeviceLinkTick(relay);
  persistPendingOffer(relay, null);
}

async function tickPendingOffer (relay) {
  if (!relay || !relay._identity || !relay._pendingDeviceLinkOffer) return null;
  if (relay._deviceLinkTickBusy) return null;
  relay._deviceLinkTickBusy = true;
  try {
    const result = await tickDeviceLinkOffer(relay._identity, relay._pendingDeviceLinkOffer);
    if (!result || !result.ok) {
      if (result && (result.expired || isStaleDeviceLinkError(result))) {
        clearPendingOffer(relay);
      }
      return result;
    }
    if (result.status === 'linked') {
      persistLinkedDevice(relay, linkedEntryFromOffer(result, 'initiator'));
      const peerPk = result.peerPubkey || peerPubkeyFromParty(result.responder);
      await publishCrossSign(relay, peerPk, result.nonce);
      clearPendingOffer(relay);
    }
    return result;
  } catch (e) {
    relay.emit && relay.emit('warning', '[LiveRelay] device-link tick: ' +
      ((e && e.message) ? e.message : e));
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  } finally {
    relay._deviceLinkTickBusy = false;
  }
}

function armDeviceLinkTick (relay) {
  if (!relay || relay._deviceLinkTickTimer) return;
  relay._deviceLinkTickTimer = setInterval(() => {
    void tickPendingOffer(relay);
  }, DEVICE_LINK_TICK_MS);
  if (relay._deviceLinkTickTimer.unref) relay._deviceLinkTickTimer.unref();
}

function linkedEntryFromOffer (res, role) {
  return {
    kind: 'device-link',
    peerFabricId: res.peerFabricId || (res.responder && res.responder.id) ||
      (res.initiator && res.initiator.id) || null,
    peerXpub: res.peerXpub || (res.responder && res.responder.xpub) ||
      (res.initiator && res.initiator.xpub) || null,
    peerPubkey: res.peerPubkey || res.peerPubkeyHex ||
      peerPubkeyFromParty(res.responder) ||
      peerPubkeyFromParty(res.initiator) ||
      (res.responder && res.responder.pubkeyHex) ||
      (res.initiator && res.initiator.pubkeyHex) || null,
    nonce: res.nonce || null,
    label: res.label || 'Linked device',
    hubOrigin: res.hubBase || null,
    role: role || 'initiator'
  };
}

/**
 * @returns {Promise<boolean>}
 */
async function tryHandleDeviceLinkLocal (relay, req, res, pathname, readBody, send) {
  if (!pathname || pathname.indexOf(LOCAL_PREFIX) !== 0) return false;
  if (!relay._isAndroidMode || !relay._isAndroidMode()) {
    send(404, { ok: false, error: 'device-link local API is an Android node route' });
    return true;
  }
  if (!isLoopbackRequest(req)) {
    send(403, { ok: false, error: 'local node only' });
    return true;
  }

  const rest = pathname.slice(LOCAL_PREFIX.length) || '/';

  if (req.method === 'POST' && rest === '/offer') {
    if (!relay._identity) {
      send(401, { ok: false, error: 'Identity is locked — unlock it, then add a device.' });
      return true;
    }
    if (relay._pendingDeviceLinkOffer) {
      await abandonDeviceLinkOffer(relay._pendingDeviceLinkOffer);
      relay._pendingDeviceLinkOffer = null;
    }
    const d = await readBody();
    const result = await startDeviceLinkOffer(relay._identity, {
      hubBase: (d && d.hubBase) || DEFAULT_DEVICE_LINK_HUB,
      label: (d && d.label) || 'GoonCitizen Android'
    });
    if (!result.ok) {
      send(400, result);
      return true;
    }
    relay._pendingDeviceLinkOffer = result;
    persistPendingOffer(relay, result);
    armDeviceLinkTick(relay);
    send(200, result);
    return true;
  }

  if (req.method === 'GET' && rest === '/current') {
    const offer = relay._pendingDeviceLinkOffer;
    if (!offer) {
      send(200, { ok: true, pending: false });
      return true;
    }
    send(200, Object.assign({ ok: true, pending: true }, compactPendingOffer(offer), {
      qrDataUrl: offer.qrDataUrl || null,
      protocolUrl: offer.protocolUrl || null
    }));
    return true;
  }

  if (req.method === 'POST' && rest === '/tick') {
    if (!relay._identity) {
      send(401, { ok: false, error: 'Identity is locked' });
      return true;
    }
    const offer = relay._pendingDeviceLinkOffer;
    if (!offer) {
      send(400, { ok: false, error: 'no pending device-link offer' });
      return true;
    }
    const result = await tickPendingOffer(relay);
    if (!result) {
      send(400, { ok: false, error: 'device-link tick busy' });
      return true;
    }
    if (!result.ok) {
      if (result.expired || isStaleDeviceLinkError(result)) {
        send(410, Object.assign({ expired: true }, result));
        return true;
      }
      send(400, result);
      return true;
    }
    send(200, result);
    return true;
  }

  if (req.method === 'POST' && rest === '/cancel') {
    const offer = relay._pendingDeviceLinkOffer;
    clearPendingOffer(relay);
    if (offer) await abandonDeviceLinkOffer(offer);
    send(200, { ok: true, cancelled: true });
    return true;
  }

  if (req.method === 'GET' && rest === '/pending') {
    const url = new URL(req.url, 'http://127.0.0.1');
    const sessionId = String(url.searchParams.get('sessionId') || '').trim();
    const hubBase = String(url.searchParams.get('hub') || DEFAULT_DEVICE_LINK_HUB).trim();
    if (!sessionId) {
      send(400, { ok: false, error: 'sessionId required' });
      return true;
    }
    const pending = await fetchPendingDeviceLink(hubBase, sessionId);
    send(pending.ok ? 200 : (pending.status || 400), pending);
    return true;
  }

  if (req.method === 'POST' && rest === '/accept') {
    if (!relay._identity) {
      send(401, { ok: false, error: 'Identity is locked — unlock it, then try the link again.' });
      return true;
    }
    const d = await readBody();
    const hubBase = String((d && d.hubBase) || DEFAULT_DEVICE_LINK_HUB).trim();
    const session = {
      sessionId: d && d.sessionId,
      status: 'pending',
      nonce: d && d.nonce,
      label: d && d.label,
      initiator: d && d.initiator
    };
    const result = await completeDeviceLinkAsResponder(relay._identity, hubBase, session);
    if (!result.ok) {
      send(400, result);
      return true;
    }
    const peerPk = peerPubkeyFromParty(d && d.initiator) ||
      result.peerPubkeyHex ||
      peerPubkeyFromParty(result);
    persistLinkedDevice(relay, linkedEntryFromOffer({
      peerFabricId: result.peerFabricId || (d && d.initiator && d.initiator.id),
      peerXpub: result.peerXpub || (d && d.initiator && d.initiator.xpub),
      peerPubkey: peerPk,
      nonce: (d && d.nonce) || result.nonce,
      label: result.label || (d && d.label) || 'Linked device',
      hubBase
    }, 'responder'));
    await publishCrossSign(relay, peerPk, (d && d.nonce) || result.nonce);
    send(200, Object.assign({ ok: true }, result, { linked: true }));
    return true;
  }

  send(404, { ok: false, error: 'Not found', path: pathname });
  return true;
}

module.exports = {
  LOCAL_PREFIX,
  tryHandleDeviceLinkLocal,
  persistLinkedDevice,
  linkedEntryFromOffer,
  armDeviceLinkTick,
  stopDeviceLinkTick,
  tickPendingOffer,
  restorePendingDeviceLinkOffer
};
