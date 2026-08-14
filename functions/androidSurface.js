'use strict';

/**
 * Dashboard surfaces that exist on the Android companion.
 *
 * The mobile companion runs a local LiveRelay + Fabric Peer. It does not tail Game.log,
 * run a Discord bot, proxy Hub Bitcoin, host a document catalog, or capture
 * snapshots — those controls must stay off so the UI does not fetch them.
 */

const { isAndroidCompanion } = require('./isAndroidCompanion');

/** @type {Object<string, boolean>} */
const ANDROID_HIDDEN = {
  wallet: true,
  documents: true,
  library: true,
  heatmap: true,
  corpus: true,
  discordBot: true,
  hubObserve: true,
  associatedFunds: true,
  logShare: true
};

/**
 * @param {string} name Surface id (wallet, documents, heatmap, …).
 * @returns {boolean} false when this Android build should not show the surface.
 */
function androidSurface (name) {
  if (!isAndroidCompanion()) return true;
  return ANDROID_HIDDEN[name] !== true;
}

/**
 * Primary dashboard tabs that the mobile companion must not route into.
 * @param {string} key
 * @returns {boolean}
 */
function androidDashboardTabVisible (key) {
  if (key === 'wallet') return androidSurface('wallet');
  if (key === 'documents') return androidSurface('documents');
  if (key === 'library') return androidSurface('library');
  return true;
}

module.exports = {
  isAndroidCompanion,
  androidSurface,
  androidDashboardTabVisible,
  ANDROID_HIDDEN
};
