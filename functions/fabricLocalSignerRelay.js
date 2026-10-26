'use strict';

/**
 * GoonCitizen desktop as a local signing authority for Passport v2
 * (`@fabric/http` local signer): `GET /services/fabric/identity`,
 * `POST /services/fabric/sign`, and `POST /services/fabric/link` on loopback,
 * for Passport's extension origin only.
 *
 * The desktop identity is the identity key of the player's current account on
 * the challenge's network (`accountFromIdentity`), the same key it cross-signs
 * with on that network. A device may ask only once it is in that key's
 * identity cluster, and every sign-in or link waits for a native dialog in the
 * Electron main process (`settings.fabricSignApprover`, set by `main.js`). The
 * web dashboard is never the approver, so a CLI, server, or Android LiveRelay
 * does not mount these routes.
 *
 * Chrome builds of Passport are pinned by id (`FABRIC_PASSPORT_EXTENSION_IDS`
 * or `settings.fabricSigner.extensionIds`); any Firefox build may ask.
 */

const {
  createFabricLocalSigner,
  FABRIC_IDENTITY_PATH,
  FABRIC_SIGN_PATH,
  FABRIC_LINK_PATH
} = require('@fabric/http/functions/fabricLocalSigner');
const { accountFromIdentity, fabricIdentityNetwork } = require('./identity');

function xOnly (hex) {
  const h = String(hex || '').toLowerCase();
  return h.length === 66 ? h.slice(2) : h;
}

/**
 * Chrome extension ids of Passport builds this desktop answers.
 * @param {object} relay
 * @param {object} [env]
 * @returns {string[]}
 */
function passportExtensionIds (relay, env = process.env) {
  const cfg = (relay.settings && relay.settings.fabricSigner) || {};
  const fromSettings = Array.isArray(cfg.extensionIds) ? cfg.extensionIds : [];
  const fromEnv = String(env.FABRIC_PASSPORT_EXTENSION_IDS || '').split(',');
  return [...new Set([].concat(fromSettings, fromEnv).map((id) => String(id || '').trim()).filter(Boolean))];
}

/**
 * The player's account on `network`, or null while locked.
 * @param {object} relay
 * @param {{ network: string, account: (number|null) }} asked
 * @returns {object|null}
 */
function playerAccount (relay, { network, account }) {
  const identity = relay._identity;
  if (!identity) return null;
  if (!relay._playerAccounts || relay._playerAccountsOf !== identity) {
    relay._playerAccounts = new Map();
    relay._playerAccountsOf = identity;
  }
  const index = account != null ? account : (Number.isInteger(identity.account) ? identity.account : 0);
  const key = `${network}:${index}`;
  if (!relay._playerAccounts.has(key)) {
    let derived = null;
    try {
      derived = accountFromIdentity(identity, { network, account: index });
    } catch (_) {}
    relay._playerAccounts.set(key, derived);
  }
  return relay._playerAccounts.get(key);
}

/**
 * Build the signer for a desktop LiveRelay, or null when it should not run.
 * @param {object} relay LiveRelay
 * @param {object} [opts]
 * @param {Function} [opts.approve] `(prompt) => Promise<boolean>` (defaults to `settings.fabricSignApprover`)
 * @param {object} [opts.env]
 * @returns {object|null}
 */
function createFabricLocalSignerRelay (relay, opts = {}) {
  const mode = String((relay.settings && relay.settings.mode) || '').toLowerCase();
  if (mode === 'server' || mode === 'android') return null;
  const approve = opts.approve || (relay.settings && relay.settings.fabricSignApprover);
  if (typeof approve !== 'function') return null;
  const port = () => {
    const bound = relay.server && typeof relay.server.address === 'function' ? relay.server.address() : null;
    return Number((bound && bound.port) || (relay.settings && relay.settings.port) || 3041);
  };
  const network = () => fabricIdentityNetwork({ network: relay._identity && relay._identity.network });

  const signer = createFabricLocalSigner({
    signer: 'gooncitizen',
    name: 'GoonCitizen',
    network: network(),
    extensionIds: passportExtensionIds(relay, opts.env),
    getAccount: (asked) => playerAccount(relay, asked),
    linkedDevice: (deviceXOnly) => {
      const own = playerAccount(relay, { network: network(), account: null });
      const cluster = relay.identityCluster;
      if (!own || !cluster) return null;
      const me = own.identity.pubkey;
      if (xOnly(me) === xOnly(deviceXOnly)) return null;
      if (!cluster.clusterEquals(me, deviceXOnly)) return null;
      return typeof cluster.compressedOf === 'function' ? cluster.compressedOf(deviceXOnly) : null;
    },
    approve,
    linkBase: () => `http://127.0.0.1:${port()}`,
    onLinkAccepted: ({ peerPubkey, nonce, sessionId, origin }) => {
      return relay.publishLocalIdentityCrossSign({ peerPubkey, nonce, sessionId, origin });
    }
  });
  console.log('[LiveRelay] Passport local signer on',
    [FABRIC_IDENTITY_PATH, FABRIC_SIGN_PATH, FABRIC_LINK_PATH].join(', '));
  return signer;
}

module.exports = {
  createFabricLocalSignerRelay,
  passportExtensionIds,
  playerAccount
};
