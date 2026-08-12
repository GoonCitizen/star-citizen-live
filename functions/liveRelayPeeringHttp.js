'use strict';

/**
 * Hub-compatible HTTP discovery for LiveRelay.
 * Shared mount: `@fabric/http/functions/fabricPeeringHttp`.
 * Claim builders stay GoonCitizen-specific below.
 */

const {
  buildApplicationResourceContract
} = require('@fabric/http/functions/applicationResourceContract');
const peeringHttp = require('@fabric/http/functions/fabricPeeringHttp');
const oracleAttestation = require('@fabric/http/functions/oracleAttestation');
const identityLib = require('./identity');

const ATTESTATION_TYPE = peeringHttp.ATTESTATION_TYPE;
const KIND_PEERING = peeringHttp.KIND_PEERING;
const PEERING_BASE = peeringHttp.PEERING_BASE;

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

function buildOracleAttestation (relay, claim) {
  const c = claim || buildPeeringClaim(relay);
  const identity = relay && relay._identity;
  const unsigned = () => ({
    '@type': ATTESTATION_TYPE,
    version: 1,
    kind: KIND_PEERING,
    claim: c,
    signedAt: new Date().toISOString()
  });
  if (!identity) return unsigned();
  let key;
  try {
    key = identityLib.keyFromIdentity(identity);
  } catch (_) {
    key = null;
  }
  if (!key || !key.private) return unsigned();
  return oracleAttestation.buildOracleAttestation({
    claim: c,
    key,
    kind: KIND_PEERING,
    issuer: {
      publicKeyHex: key.pubkey,
      fabricIdentityId: key.pubkey
    },
    oracleNote: 'GoonCitizen LiveRelay peering attestation (BIP340 Schnorr)'
  });
}

function buildPeeringCapabilities (relay) {
  const claim = buildPeeringClaim(relay);
  const att = buildOracleAttestation(relay, claim);
  return peeringHttp.buildPeeringCapabilitiesBody({
    claim,
    oracleAttestation: att,
    endpointBasePath: PEERING_BASE,
    oracleDescription: 'Signed claims anchored to the relay Fabric identity'
  });
}

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
  const att = buildOracleAttestation(relay, claim);
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
    status: { oracleAttestation: att },
    fabricCapabilities: {
      p2p: true,
      webrtcSignaling: false,
      contractPublish: true
    }
  });
}

function isPeeringDiscoveryPath (pathname, method) {
  return peeringHttp.isPeeringHttpPath(pathname, method, PEERING_BASE);
}

function tryHandlePeeringDiscovery (relay, req, res, pathname) {
  return peeringHttp.tryHandlePeeringHttp(req, res, pathname, {
    endpointBasePath: PEERING_BASE,
    getCapabilities: () => buildPeeringCapabilities(relay),
    getAttestation: () => {
      const caps = buildPeeringCapabilities(relay);
      return caps.oracleAttestation || null;
    },
    getRootContract: () => buildLiveRelayApplicationResourceContract(relay)
  });
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
