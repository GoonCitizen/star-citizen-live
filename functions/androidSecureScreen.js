'use strict';

/**
 * FLAG_SECURE while a seed / xprv is on screen (Android only).
 * No-op on desktop and when the FabricKeyStore plugin is absent.
 */

const { setSecureFlag } = require('./fabricKeyStoreClient');

function setAndroidSecureFlag (enabled) {
  return setSecureFlag(!!enabled);
}

module.exports = {
  setAndroidSecureFlag
};
