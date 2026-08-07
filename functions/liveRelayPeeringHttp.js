'use strict';

/**
 * Hub-compatible HTTP discovery for LiveRelay:
 *   OPTIONS /              → Application Resource Contract (+ optional peering status)
 *   GET /services/peering  → PeeringCapability snapshot (+ OracleAttestation when keyed)
 *
 * Clients (GoonCitizen Network → Peers) use {@link functions/hubPeeringObserve}.
 */

const crypto = require('crypto');
const {
  buildApplicationResourceContract
} = require('@fabric/http/functions/applicationResourceContract');
const identityLib = require('./identity');

const ATTESTATION_TYPE = 'OracleAttestation';
const KIND_PEERING = 'PeeringCapability';
const PEERING_BASE = '/services/peering';

/**
 * Live peering claim from a LiveRelay instance.
 * @param {object} relay
 * @returns {object}
 */
function buildPeeringClaim (relay) {
  const fabricStatus = relay.fabricNetwork && typeof relay.fabricNetwork.status === 'function'
    ? relay.fabricNetwork.status()
    : {
      listening: false,
      fabricListenPort: (relay.settings && relay.settings.fabric && relay.settings.fabric.port) || 7777,
      fabricPeerId: relay._identity ? relay._identity.pubkey : null,
      fabricConnected: 0,
      ready: false
    };
  const listenPort = Number(fabricStatus.fabricListenPort) || 7777;
  const advertiseHost = relay._fabricAdvertiseHost || null;
  return {
    kind: KIND_PEERING,
    version: 1,
    fabricPeerId: fabricStatus.fabricPeerId || null,
    fabricIdentityId: fabricStatus.fabricPeerId || null,
    hub: {
      alias: (relay.settings && relay.settings.name) || 'relay.goon.vc',
      mode: (relay.settings && relay.settings.mode) || 'relay',
      clock: null
    },
    p2p: {
      listenAddress: advertiseHost ? `${advertiseHost}:${listenPort}` : null,
      listening: !!fabricStatus.listening || !!fabricStatus.ready,
      connections: Number(fabricStatus.fabricConnected) || 0,
      maxPeers: 32
    },
    webrtc: {
      // Browser mesh signaling stays on Hub; LiveRelay is Fabric TCP/NOISE.
      signaling: [],
      registeredPeers: 0
    },
    endpoints: {
      starCitizen: '/services/star-citizen',
      settings: '/settings',
      sessions: '/sessions'
    }
  };
}

/**
 * Optional signed OracleAttestation (BIP340) when the relay identity is unlocked.
 * @param {object} relay
 * @param {object} [claim]
 * @returns {object|null}
 */
function buildOracleAttestation (relay, claim) {
  const c = claim || buildPeeringClaim(relay);
  const identity = relay && relay._identity;
  if (!identity) {
    return {
      '@type': ATTESTATION_TYPE,
      version: 1,
      kind: KIND_PEERING,
      claim: c,
      signedAt: new Date().toISOString()
    };
  }
  let key;
  try {
    key = identityLib.keyFromIdentity(identity);
  } catch (_) {
    key = null;
  }
  if (!key || !key.private) {
    return {
      '@type': ATTESTATION_TYPE,
      version: 1,
      kind: KIND_PEERING,
      claim: c,
      signedAt: new Date().toISOString()
    };
  }
  const safeClaim = JSON.parse(JSON.stringify(c));
  const body = { version: 1, kind: KIND_PEERING, claim: safeClaim };
  const signingPayload = identityLib.canonicalStringify(body);
  const signature = key.signSchnorr(Buffer.from(signingPayload, 'utf8'));
  return {
    '@type': ATTESTATION_TYPE,
    version: 1,
    kind: KIND_PEERING,
    oracle: {
      name: 'Oracle',
      resource: KIND_PEERING,
      note: 'GoonCitizen LiveRelay peering attestation (BIP340 Schnorr)'
    },
    issuer: {
      publicKeyHex: key.pubkey,
      fabricIdentityId: key.pubkey
    },
    claim: safeClaim,
    signature: Buffer.isBuffer(signature) ? signature.toString('hex') : String(signature),
    algorithm: 'BIP340-SCHNORR',
    signedAt: new Date().toISOString(),
    claimDigest: crypto.createHash('sha256').update(Buffer.from(signingPayload, 'utf8')).digest('hex')
  };
}

/**
 * GET /services/peering body.
 * @param {object} relay
 * @returns {object}
 */
function buildPeeringCapabilities (relay) {
  const claim = buildPeeringClaim(relay);
  const oracleAttestation = buildOracleAttestation(relay, claim);
  return {
    service: 'peering',
    available: true,
    endpointBasePath: PEERING_BASE,
    attestationType: ATTESTATION_TYPE,
    kind: KIND_PEERING,
    oracle: {
      name: 'Oracle',
      description: 'Signed claims anchored to the relay Fabric identity'
    },
    attestationUrl: `${PEERING_BASE}/attestation`,
    claim,
    oracleAttestation
  };
}

/**
 * OPTIONS / Application Resource Contract for LiveRelay.
 * @param {object} relay
 * @returns {object}
 */
function buildLiveRelayApplicationResourceContract (relay) {
  const name = (relay.settings && relay.settings.name) || 'GoonCitizen LiveRelay';
  const description = (relay.settings && relay.settings.description) ||
    'GoonCitizen — Star Citizen live relay, mission register, and Fabric peer hub';
  const serverLike = {
    settings: {
      name,
      description,
      cors: true,
      spaFallback: true,
      fabricCapabilities: {
        p2p: true,
        webrtcSignaling: false,
        contractPublish: true
      }
    },
    definitions: {
      StarCitizen: {
        name: 'StarCitizen',
        description: 'Live Game.log monitor, missions, and analytics',
        route: '/services/star-citizen'
      },
      Settings: {
        name: 'Settings',
        description: 'Operator settings and peer roster',
        route: '/settings'
      },
      Sessions: {
        name: 'Sessions',
        description: 'Fabric site-login sessions',
        route: '/sessions'
      }
    }
  };
  const claim = buildPeeringClaim(relay);
  const oracleAttestation = buildOracleAttestation(relay, claim);
  return buildApplicationResourceContract(serverLike, {
    services: {
      peering: {
        endpointBasePath: PEERING_BASE,
        kind: KIND_PEERING,
        attestationType: ATTESTATION_TYPE,
        attestationUrl: `${PEERING_BASE}/attestation`
      },
      starCitizen: {
        endpointBasePath: '/services/star-citizen'
      }
    },
    status: { oracleAttestation },
    fabricCapabilities: {
      p2p: true,
      webrtcSignaling: false,
      contractPublish: true
    }
  });
}

/**
 * True when pathname is handled by this module.
 * @param {string} pathname
 * @param {string} method
 * @returns {boolean}
 */
function isPeeringDiscoveryPath (pathname, method) {
  const m = String(method || 'GET').toUpperCase();
  if (m === 'OPTIONS' && (pathname === '/' || pathname === '')) return true;
  if (pathname === PEERING_BASE || pathname === `${PEERING_BASE}/` ||
      pathname === `${PEERING_BASE}/attestation`) {
    return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
  }
  return false;
}

/**
 * Handle discovery routes; returns true when the response was written.
 * @param {object} relay
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @returns {boolean}
 */
function tryHandlePeeringDiscovery (relay, req, res, pathname) {
  const method = String(req.method || 'GET').toUpperCase();
  if (!isPeeringDiscoveryPath(pathname, method)) return false;

  const send = (code, obj) => {
    const body = JSON.stringify(obj, null, 2);
    res.writeHead(code, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Accept, Content-Type, Authorization',
      Allow: 'GET, HEAD, OPTIONS'
    });
    if (method === 'HEAD') {
      res.end();
      return true;
    }
    res.end(body);
    return true;
  };

  if (method === 'OPTIONS' && (pathname === '/' || pathname === '')) {
    return send(200, buildLiveRelayApplicationResourceContract(relay));
  }

  if (pathname === PEERING_BASE || pathname === `${PEERING_BASE}/`) {
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept, Content-Type, Authorization',
        Allow: 'GET, HEAD, OPTIONS'
      });
      res.end();
      return true;
    }
    return send(200, buildPeeringCapabilities(relay));
  }

  if (pathname === `${PEERING_BASE}/attestation`) {
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept, Content-Type, Authorization',
        Allow: 'GET, HEAD, OPTIONS'
      });
      res.end();
      return true;
    }
    const caps = buildPeeringCapabilities(relay);
    if (!caps.oracleAttestation) {
      return send(503, { error: 'attestation unavailable' });
    }
    return send(200, caps.oracleAttestation);
  }

  return false;
}

module.exports = {
  ATTESTATION_TYPE,
  KIND_PEERING,
  PEERING_BASE,
  buildPeeringClaim,
  buildOracleAttestation,
  buildPeeringCapabilities,
  buildLiveRelayApplicationResourceContract,
  isPeeringDiscoveryPath,
  tryHandlePeeringDiscovery
};
