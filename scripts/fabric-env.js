#!/usr/bin/env node
'use strict';

/**
 * Update the shell Fabric configuration from FABRIC_SEED (or FABRIC_MNEMONIC).
 *
 *   export FABRIC_SEED='word1 word2 … word24'
 *   eval "$(node scripts/fabric-env.js)"
 *
 * Prints `export FABRIC_XPRV=…` (and xpub/pubkey). Does not write files.
 */

const {
  applyFabricEnvConfig,
  formatFabricEnvExports,
  loadRepoDotEnv
} = require('../functions/fabricEnvIdentity');

loadRepoDotEnv();
const { identity } = applyFabricEnvConfig(process.env);
if (!identity) {
  console.error('[FABRIC-ENV] Set FABRIC_SEED or FABRIC_MNEMONIC (or FABRIC_XPRV) first.');
  process.exit(1);
}
process.stdout.write(formatFabricEnvExports(identity));
