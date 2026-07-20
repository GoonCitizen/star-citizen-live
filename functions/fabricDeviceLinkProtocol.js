'use strict';

/**
 * Parse `fabric://link?sessionId=…&hub=…` for mutual device-link offers.
 */

const FABRIC_PROTOCOL = 'fabric';

/**
 * @param {string} urlStr
 * @returns {{ ok: true, kind: 'link', sessionId: string, hubBase: string } | { ok: false, error: string }}
 */
function parseFabricDeviceLinkUrl (urlStr) {
  if (typeof urlStr !== 'string' || !urlStr.trim()) {
    return { ok: false, error: 'empty url' };
  }
  let url;
  try {
    url = new URL(urlStr.trim());
  } catch (_) {
    return { ok: false, error: 'invalid url' };
  }
  if (url.protocol !== `${FABRIC_PROTOCOL}:`) {
    return { ok: false, error: 'not a fabric: url' };
  }
  if (!url.hostname || url.hostname !== 'link') {
    return { ok: false, error: 'not a fabric://link url' };
  }
  const sessionId = (url.searchParams.get('sessionId') || '').trim();
  if (!sessionId || !/^[a-f0-9]{32,128}$/i.test(sessionId)) {
    return { ok: false, error: 'missing or invalid sessionId' };
  }
  const hubRaw = (url.searchParams.get('hub') || '').trim();
  if (!hubRaw) return { ok: false, error: 'missing hub origin' };
  let hubBase;
  try {
    const hubUrl = new URL(hubRaw);
    if (hubUrl.protocol !== 'http:' && hubUrl.protocol !== 'https:') {
      return { ok: false, error: 'hub must be http(s)' };
    }
    hubBase = `${hubUrl.protocol}//${hubUrl.host}`;
  } catch (_) {
    return { ok: false, error: 'invalid hub origin' };
  }
  return { ok: true, kind: 'link', sessionId, hubBase };
}

module.exports = {
  parseFabricDeviceLinkUrl
};
