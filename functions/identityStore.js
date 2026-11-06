'use strict';

// File-backed storage for the encrypted player identity. Used by the
// Electron main process (userData dir) and by the standalone relay
// (SC_IDENTITY_DIR or stores/). Only the encrypted blob ever touches disk.

const fs = require('fs');
const path = require('path');

const FILENAME = 'identity.json';

function identityPath (dir) {
  return path.join(dir, FILENAME);
}

/**
 * @param {String} dir Directory holding identity.json.
 * @returns {Boolean} True when an identity file exists.
 */
function hasIdentity (dir) {
  return fs.existsSync(identityPath(dir));
}

/**
 * Load the stored identity vault (public account views readable, master
 * sealed). A blob from before account vaults is returned as-is so callers can
 * tell the user to restore from their seed.
 * @param {String} dir Directory holding identity.json.
 * @returns {Object|null} Vault (or legacy blob), or null when absent/corrupt.
 */
function loadEncrypted (dir) {
  try {
    const raw = fs.readFileSync(identityPath(dir), 'utf8');
    const blob = JSON.parse(raw);
    if (!blob || typeof blob !== 'object') return null;
    if (!(blob.seal && blob.seal.ciphertext) && !blob.ciphertext) return null;
    return blob;
  } catch (error) {
    return null;
  }
}

/**
 * Persist an identity vault. Refuses to write plaintext secrets.
 * @param {String} dir Target directory (created if missing).
 * @param {Object} blob Result of functions/identity.js encryptIdentity().
 * @returns {String} Path written.
 */
function saveEncrypted (dir, blob) {
  if (!blob || !blob.seal || !blob.seal.ciphertext || !blob.accounts) {
    throw new Error('refusing to save: not an encrypted identity blob');
  }
  if (blob.xprv || blob.mnemonic) throw new Error('refusing to save: blob contains plaintext secrets');
  fs.mkdirSync(dir, { recursive: true });
  const file = identityPath(dir);
  fs.writeFileSync(file, JSON.stringify(blob, null, 2) + '\n', { mode: 0o600 });
  return file;
}

/**
 * Remove the stored identity (forget). Does not touch backups.
 * @param {String} dir Directory holding identity.json.
 * @returns {Boolean} True when a file was removed.
 */
function removeIdentity (dir) {
  const file = identityPath(dir);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

module.exports = {
  FILENAME,
  identityPath,
  hasIdentity,
  loadEncrypted,
  saveEncrypted,
  removeIdentity
};
