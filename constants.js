'use strict';

const NAME = 'GOONCITIZEN';
const BRAND_NAME = 'G00N CITIZEN';

/**
 * Feature flags. Disabled features are hidden from the dashboard (tab, home
 * card, and routed view). Off by default here; flip to `true` to enable.
 */
const FEATURES = {
  // Wallet tab; runtime settings.bitcoin.enable can still hide it when false.
  wallet: true,
  // Files tab (advanced UI); runtime settings.documents.enable + Advanced mode.
  // Chat 📎 attach uses the same local catalog (always, not a remote Hub).
  documents: true,
  library: false
};

module.exports = {
  NAME,
  BRAND_NAME,
  FEATURES
};
