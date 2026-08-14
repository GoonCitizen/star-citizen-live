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
  DEFAULT_DEVICE_LINK_HUB
} = require('./fabricDeviceLinkOffer');
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

function linkedEntryFromOffer (res, role) {
  return {
    kind: 'device-link',
    peerFabricId: res.peerFabricId || (res.responder && res.responder.id) ||
      (res.initiator && res.initiator.id) || null,
    peerXpub: res.peerXpub || (res.responder && res.responder.xpub) ||
      (res.initiator && res.initiator.xpub) || null,
    peerPubkey: res.peerPubkey || res.peerPubkeyHex ||
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
    send(200, result);
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
    const result = await tickDeviceLinkOffer(relay._identity, offer);
    if (!result.ok) {
      send(400, result);
      return true;
    }
    if (result.status === 'linked') {
      relay._pendingDeviceLinkOffer = null;
      persistLinkedDevice(relay, linkedEntryFromOffer(result, 'initiator'));
      await publishCrossSign(relay, result.peerPubkey, result.nonce);
    }
    send(200, result);
    return true;
  }

  if (req.method === 'POST' && rest === '/cancel') {
    relay._pendingDeviceLinkOffer = null;
    send(200, { ok: true });
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
    const peerPk = (d && d.initiator && d.initiator.pubkeyHex) || result.peerPubkeyHex;
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
  linkedEntryFromOffer
};
