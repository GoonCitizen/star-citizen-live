'use strict';

/**
 * Turn a scanned QR payload into a fabric:// protocol URL for device-link
 * (or site login). Accepts fabric://link, the HTTPS Passport landing, and
 * a bare #device-link= hash.
 */

const { parseFabricDeviceLinkUrl } = require('./fabricDeviceLinkProtocol');
const { parseFabricLoginUrl } = require('./fabricProtocolLogin');
const {
  parseDeviceLinkLanding,
  DEFAULT_DEVICE_LINK_HUB
} = require('./fabricDeviceLinkOffer');
const { assertAllowedFabricHub } = require('./fabricHubAllowlist');

function protocolUrlFromLanding (landing) {
  if (!landing || !landing.sessionId) return null;
  const hub = String(landing.hubBase || DEFAULT_DEVICE_LINK_HUB).replace(/\/$/, '');
  const allowed = assertAllowedFabricHub(hub);
  if (!allowed.ok) return { error: allowed.error || 'hub origin is not allowlisted' };
  return {
    protocolUrl: 'fabric://link?sessionId=' + encodeURIComponent(landing.sessionId) +
      '&hub=' + encodeURIComponent(allowed.hubBase),
    sessionId: landing.sessionId,
    hubBase: allowed.hubBase
  };
}

function interpretQrScan (text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, error: 'empty scan' };

  const link = parseFabricDeviceLinkUrl(raw);
  if (link && link.ok) {
    return {
      ok: true,
      kind: 'device-link',
      protocolUrl: raw,
      sessionId: link.sessionId,
      hubBase: link.hubBase
    };
  }
  if (/^fabric:\/\/link\b/i.test(raw)) {
    return { ok: false, error: (link && link.error) || 'invalid fabric://link' };
  }

  const login = parseFabricLoginUrl(raw);
  if (login && login.ok) {
    return { ok: true, kind: 'login', protocolUrl: raw };
  }

  try {
    const url = new URL(raw);
    const landing = parseDeviceLinkLanding({
      hash: url.hash || '',
      search: url.search || '',
      origin: url.origin || ''
    });
    const converted = protocolUrlFromLanding(landing);
    if (converted && converted.error) return { ok: false, error: converted.error };
    if (converted && converted.protocolUrl) {
      return {
        ok: true,
        kind: 'device-link',
        protocolUrl: converted.protocolUrl,
        sessionId: converted.sessionId,
        hubBase: converted.hubBase
      };
    }
  } catch (_) { /* not an absolute URL */ }

  const hash = raw.replace(/^#/, '');
  if (/^device-link=/i.test(hash)) {
    const landing = parseDeviceLinkLanding({
      hash,
      search: '',
      origin: DEFAULT_DEVICE_LINK_HUB
    });
    const converted = protocolUrlFromLanding(landing);
    if (converted && converted.error) return { ok: false, error: converted.error };
    if (converted && converted.protocolUrl) {
      return {
        ok: true,
        kind: 'device-link',
        protocolUrl: converted.protocolUrl,
        sessionId: converted.sessionId,
        hubBase: converted.hubBase
      };
    }
  }

  return { ok: false, error: 'Not a Fabric device-link QR. Scan the code from Add a device on the other app.' };
}

module.exports = {
  interpretQrScan
};
