'use strict';

/**
 * GoonCitizen publishing identity from the process environment.
 *
 * Priority (same convention across the Fabric suite):
 *   1. FABRIC_XPRV — extended private key (preferred in public docs / production)
 *   2. FABRIC_SEED — raw BIP32 seed hex (16–64 bytes), or a legacy mnemonic / `xprv…`
 *   3. FABRIC_MNEMONIC — BIP39 word phrase
 *   4. ~/.fabric/wallet.json (`FABRIC_PASSWORD` unlocks a sealed wallet)
 *   5. Optional local `local/fabric-operator-identity.json` (automation fallback only)
 *
 * Calling {@link applyFabricEnvConfig} stamps FABRIC_XPRV (and public fields) onto `env`
 * so the rest of the stack can treat XPRV as the canonical publishing secret.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { restoreIdentity } = require('./identity');

function tryCore (name) {
  try {
    return require(name);
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') throw err;
    return null;
  }
}

const fabricKeyMaterial = tryCore('@fabric/core/functions/fabricKeyMaterial');
const fabricHomeEnv = tryCore('@fabric/core/functions/fabricHomeEnv');
const fabricWalletIdentity = tryCore('@fabric/core/functions/fabricWalletIdentity');

/**
 * Load KEY=VALUE lines from a `.env` file into `env` without overriding
 * variables already present. Does not shell-expand; quotes are stripped.
 *
 * @param {string} filePath
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number} Count of keys applied
 */
function loadDotEnvFile (filePath, env = process.env) {
  if (fabricHomeEnv && typeof fabricHomeEnv.loadDotEnvFile === 'function') {
    return fabricHomeEnv.loadDotEnvFile(filePath, env);
  }
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
 * Fill missing FABRIC_* keys from `~/.fabric/env`.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {object} [opts]
 * @returns {number}
 */
function loadFabricHomeEnv (env = process.env, opts = {}) {
  if (fabricHomeEnv && typeof fabricHomeEnv.loadFabricHomeEnv === 'function') {
    return fabricHomeEnv.loadFabricHomeEnv(env, opts);
  }
  const home = opts.home || env.HOME || os.homedir();
  return loadDotEnvFile(path.join(home, '.fabric', 'env'), env);
}

/**
 * Local automation identity file (never preferred over FABRIC_XPRV / FABRIC_SEED).
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [repoRoot]
 * @returns {{ path: string, mnemonic: string|null, xprv: string|null }|null}
 */
function loadLocalOperatorIdentityFile (env = process.env, repoRoot = path.join(__dirname, '..')) {
  const candidates = [
    env.FABRIC_OPERATOR_IDENTITY
      ? path.resolve(String(env.FABRIC_OPERATOR_IDENTITY))
      : null,
    path.join(repoRoot, 'local', 'fabric-operator-identity.json'),
    path.resolve(repoRoot, '..', 'hub.fabric.pub', 'local', 'fabric-operator-identity.json'),
    // Silent legacy filenames (disk only; not part of the public API)
    path.join(repoRoot, 'local', 'cursor-agent-fabric-identity.json'),
    path.resolve(repoRoot, '..', 'hub.fabric.pub', 'local', 'cursor-agent-fabric-identity.json')
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      const mnemonic = String(data.mnemonic || '').trim();
      const xprv = String(data.xprv || '').trim();
      if (xprv.startsWith('xprv') || xprv.startsWith('tprv') || mnemonic) {
        return {
          path: p,
          mnemonic: mnemonic || null,
          xprv: (xprv.startsWith('xprv') || xprv.startsWith('tprv')) ? xprv : null
        };
      }
    } catch (_) {}
  }
  return null;
}

function restoreFromKeySettings (settings) {
  if (!settings) return null;
  if (settings.xprv) return restoreIdentity({ xprv: settings.xprv });
  if (settings.mnemonic) return restoreIdentity({ mnemonic: settings.mnemonic });
  if (settings.seed) return restoreIdentity({ seed: settings.seed });
  return null;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {object} [opts]
 * @param {boolean} [opts.allowLocalIdentityFallback=true]
 * @param {boolean} [opts.allowWalletFallback]
 * @returns {{ mnemonic: string|null, seed: string|null, xprv: string, xpub: string, pubkey: string, id: string }|null}
 */
function loadFabricEnvIdentity (env = process.env, opts = {}) {
  const allowLocal = opts.allowLocalIdentityFallback !== false;
  const allowWallet = opts.allowWalletFallback != null
    ? opts.allowWalletFallback
    : env === process.env;

  if (fabricKeyMaterial && typeof fabricKeyMaterial.keySettingsFromEnv === 'function') {
    const fromEnv = restoreFromKeySettings(fabricKeyMaterial.keySettingsFromEnv(env));
    if (fromEnv) return fromEnv;
  } else {
    const xprv = String(env.FABRIC_XPRV || '').trim();
    if (xprv.startsWith('xprv') || xprv.startsWith('tprv')) {
      return restoreIdentity({ xprv });
    }
    const seed = String(env.FABRIC_SEED || '').trim();
    if (seed.startsWith('xprv') || seed.startsWith('tprv')) {
      return restoreIdentity({ xprv: seed });
    }
    if (seed) {
      return restoreIdentity({ seed });
    }
    const mnemonic = String(env.FABRIC_MNEMONIC || '').trim();
    if (mnemonic) return restoreIdentity({ mnemonic });
  }

  if (allowWallet && fabricWalletIdentity && typeof fabricWalletIdentity.loadIdentityFromWalletFile === 'function') {
    const wallet = fabricWalletIdentity.loadIdentityFromWalletFile({
      home: env.HOME,
      password: env.FABRIC_PASSWORD
    });
    if (wallet && wallet.xprv) {
      return restoreIdentity({
        xprv: wallet.xprv,
        mnemonic: wallet.mnemonic || undefined,
        seed: wallet.seed || undefined
      });
    }
  }

  if (!allowLocal) return null;
  const local = loadLocalOperatorIdentityFile(env);
  if (!local) return null;
  if (local.xprv) return restoreIdentity({ xprv: local.xprv });
  if (local.mnemonic) return restoreIdentity({ mnemonic: local.mnemonic });
  return null;
}

/**
 * Derive Key material from FABRIC_* env (preferred) and stamp FABRIC_XPRV
 * (plus FABRIC_XPUB / FABRIC_PUBKEY) onto `env` when missing.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ identity: object|null, updated: boolean, source: string|null }}
 */
function applyFabricEnvConfig (env = process.env) {
  if (env === process.env) {
    loadFabricHomeEnv(env);
  }
  const before = String(env.FABRIC_XPRV || '').trim();
  const identity = loadFabricEnvIdentity(env);
  if (!identity) {
    return { identity: null, updated: false, source: null };
  }

  let source = 'local-operator-identity';
  if (before.startsWith('xprv') || before.startsWith('tprv')) source = 'FABRIC_XPRV';
  else if (String(env.FABRIC_SEED || '').trim()) source = 'FABRIC_SEED';
  else if (String(env.FABRIC_MNEMONIC || '').trim()) source = 'FABRIC_MNEMONIC';
  else if (source === 'local-operator-identity' && env === process.env) {
    source = 'wallet-or-local';
  }

  let updated = false;
  if (!(before.startsWith('xprv') || before.startsWith('tprv'))) {
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
 * Prefer exporting FABRIC_XPRV for suite-wide identity.
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
  if (identity.seed) {
    lines.push(`export FABRIC_SEED=${JSON.stringify(identity.seed)}`);
  }
  if (identity.mnemonic) {
    lines.push(`export FABRIC_MNEMONIC=${JSON.stringify(identity.mnemonic)}`);
  }
  return lines.join('\n') + '\n';
}

module.exports = {
  loadDotEnvFile,
  loadRepoDotEnv,
  loadFabricHomeEnv,
  loadLocalOperatorIdentityFile,
  loadFabricEnvIdentity,
  applyFabricEnvConfig,
  formatFabricEnvExports
};
