'use strict';

/**
 * GoonCitizen publishing identity from the process environment.
 *
 * Priority:
 *   1. FABRIC_XPRV — extended private key (preferred for headless / relay)
 *   2. FABRIC_SEED or FABRIC_MNEMONIC — BIP39 mnemonic (derives the same Key)
 *
 * Calling {@link applyFabricEnvConfig} with FABRIC_SEED set fills FABRIC_XPRV
 * (and related public fields) on the env object so the rest of the stack can
 * treat XPRV as the canonical publishing secret.
 */

const fs = require('fs');
const path = require('path');
const { restoreIdentity } = require('./identity');

/**
 * Load KEY=VALUE lines from a `.env` file into `env` without overriding
 * variables already present. Does not shell-expand; quotes are stripped.
 *
 * @param {string} filePath
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number} Count of keys applied
 */
function loadDotEnvFile (filePath, env = process.env) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return 0;
  }
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (env[key] != null && env[key] !== '') continue;
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
    n++;
  }
  return n;
}

/**
 * Load repo-root `.env` when present (gitignored).
 * @param {string} [repoRoot]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
function loadRepoDotEnv (repoRoot = path.join(__dirname, '..'), env = process.env) {
  return loadDotEnvFile(path.join(repoRoot, '.env'), env);
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ mnemonic: string|null, xprv: string, xpub: string, pubkey: string, id: string }|null}
 */
function loadFabricEnvIdentity (env = process.env) {
  const xprv = String(env.FABRIC_XPRV || '').trim();
  if (xprv.startsWith('xprv')) {
    return restoreIdentity({ xprv });
  }
  const seed = String(env.FABRIC_SEED || env.FABRIC_MNEMONIC || '').trim();
  if (!seed) return null;
  if (seed.startsWith('xprv')) {
    return restoreIdentity({ xprv: seed });
  }
  return restoreIdentity({ mnemonic: seed });
}

/**
 * Derive Key material from FABRIC_SEED / FABRIC_MNEMONIC and stamp FABRIC_XPRV
 * (plus FABRIC_XPUB / FABRIC_PUBKEY) onto `env` when missing.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ identity: object|null, updated: boolean, source: string|null }}
 */
function applyFabricEnvConfig (env = process.env) {
  const before = String(env.FABRIC_XPRV || '').trim();
  const identity = loadFabricEnvIdentity(env);
  if (!identity) {
    return { identity: null, updated: false, source: null };
  }
  let source = before.startsWith('xprv')
    ? 'FABRIC_XPRV'
    : (env.FABRIC_SEED ? 'FABRIC_SEED' : 'FABRIC_MNEMONIC');
  let updated = false;
  if (!before.startsWith('xprv')) {
    env.FABRIC_XPRV = identity.xprv;
    updated = true;
  }
  if (!env.FABRIC_XPUB) {
    env.FABRIC_XPUB = identity.xpub;
    updated = true;
  }
  if (!env.FABRIC_PUBKEY) {
    env.FABRIC_PUBKEY = identity.pubkey;
    updated = true;
  }
  return { identity, updated, source };
}

/**
 * Shell-friendly export lines (never log these to shared consoles in prod).
 * @param {object} identity
 * @returns {string}
 */
function formatFabricEnvExports (identity) {
  if (!identity || !identity.xprv) return '';
  const lines = [
    `export FABRIC_XPRV=${JSON.stringify(identity.xprv)}`,
    `export FABRIC_XPUB=${JSON.stringify(identity.xpub)}`,
    `export FABRIC_PUBKEY=${JSON.stringify(identity.pubkey)}`
  ];
  return lines.join('\n') + '\n';
}

module.exports = {
  loadDotEnvFile,
  loadRepoDotEnv,
  loadFabricEnvIdentity,
  applyFabricEnvConfig,
  formatFabricEnvExports
};
