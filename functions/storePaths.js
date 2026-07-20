'use strict';

/**
 * Resolve GoonCitizen's Fabric store root — the counterpart of the Hub's
 * `stores/hub`. Layout (data only; code lives in `types/`):
 *
 *   stores/gooncitizen/
 *     settings.json     operator settings (peers, logfile, …)
 *     register/         LevelDB for missions + groups (`types/Store`)
 *
 * Migrates once from the older flat layout (`stores/register`,
 * `stores/settings.json`) when present.
 */

const fs = require('fs');
const path = require('path');

const STORE_NAME = 'gooncitizen';

/**
 * @param {String} [baseDir] Parent of the named store (default: repo `stores/`).
 * @returns {String} Absolute path to `…/stores/gooncitizen`.
 */
function storeRoot (baseDir) {
  const stores = baseDir
    ? path.resolve(baseDir)
    : path.resolve(__dirname, '..', 'stores');
  // If caller already passed …/gooncitizen, keep it; otherwise nest under stores/.
  const root = path.basename(stores) === STORE_NAME
    ? stores
    : path.join(stores, STORE_NAME);
  return migrateLegacy(root);
}

/** LevelDB path for the mission/group register Store. */
function registerPath (root) {
  return path.join(root || storeRoot(), 'register');
}

/**
 * Move legacy flat paths into the Hub-style named store once.
 * @param {String} root Absolute `…/stores/gooncitizen`.
 */
function migrateLegacy (root) {
  const stores = path.dirname(root);
  fs.mkdirSync(root, { recursive: true });

  const legacyRegister = path.join(stores, 'register');
  const nextRegister = path.join(root, 'register');
  try {
    if (
      fs.existsSync(legacyRegister) &&
      fs.existsSync(path.join(legacyRegister, 'CURRENT')) &&
      !fs.existsSync(path.join(nextRegister, 'CURRENT'))
    ) {
      fs.renameSync(legacyRegister, nextRegister);
      console.log(`[STAR-CITIZEN] migrated register store → ${nextRegister}`);
    }
  } catch (e) {
    console.warn('[STAR-CITIZEN] register migrate skipped:', e.message);
  }

  const legacySettings = path.join(stores, 'settings.json');
  const nextSettings = path.join(root, 'settings.json');
  try {
    if (fs.existsSync(legacySettings) && !fs.existsSync(nextSettings)) {
      fs.renameSync(legacySettings, nextSettings);
      console.log(`[STAR-CITIZEN] migrated settings → ${nextSettings}`);
    }
  } catch (e) {
    console.warn('[STAR-CITIZEN] settings migrate skipped:', e.message);
  }

  return root;
}

module.exports = { STORE_NAME, storeRoot, registerPath, migrateLegacy };
