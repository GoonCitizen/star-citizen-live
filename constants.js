'use strict';

const NAME = 'GOONCITIZEN';
const BRAND_NAME = 'G00N CITIZEN';

/**
 * Feature flags. Disabled features are hidden from the dashboard (tab, home
 * card, and routed view). Off by default here; flip to `true` to enable.
 */
const FEATURES = {
  wallet: false,
  library: false
};

module.exports = {
  NAME,
  BRAND_NAME,
  FEATURES
};
