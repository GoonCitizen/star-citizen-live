'use strict';

/**
 * Legacy GoonCitizen `SC_*` env names → Fabric-canonical `FABRIC_*`.
 *
 * `@fabric/core` / `@fabric/http` / Hub only read Fabric-prefixed knobs.
 * GoonCitizen keeps `SC_*` as operator aliases for backward compatibility;
 * call {@link applyGoonCitizenEnvAliases} at process boot (before LiveRelay).
 */

/** @type {ReadonlyArray<[string, string]>} */
const GOONCITIZEN_ENV_ALIASES = Object.freeze([
  ['SC_HTTP_HOST', 'FABRIC_HUB_INTERFACE'],
  ['SC_HTTP_INTERFACE', 'FABRIC_HTTP_INTERFACE'],
  ['SC_FABRIC_PUBLIC_HOST', 'FABRIC_PUBLIC_HOST'],
  ['SC_FABRIC_HUB_ALLOWLIST', 'FABRIC_HUB_ALLOWLIST']
]);

/**
 * Copy each `SC_*` value onto its Fabric target when the target is unset.
 * Does not overwrite an explicit FABRIC_* setting.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number} Count of aliases applied
 */
function applyGoonCitizenEnvAliases (env = process.env) {
  let n = 0;
  for (const [from, to] of GOONCITIZEN_ENV_ALIASES) {
    const src = String(env[from] || '').trim();
    if (!src) continue;
    if (String(env[to] || '').trim()) continue;
    env[to] = src;
    n += 1;
  }
  return n;
}

module.exports = {
  GOONCITIZEN_ENV_ALIASES,
  applyGoonCitizenEnvAliases
};
