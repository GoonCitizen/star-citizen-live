'use strict';

/**
 * Fabric expectation tests: OracleAttestation + peer-host helpers (outside tests/relay).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Key = require('@fabric/core/types/key');

const httpOracle = require('@fabric/http/functions/oracleAttestation');
const httpPeerHost = require('@fabric/http/functions/fabricPeerHost');
const httpPubkey = require('@fabric/http/functions/fabricPubkey');
const httpChat = require('@fabric/http/functions/fabricChatNormalize');
const httpPeering = require('@fabric/http/functions/fabricPeeringHttp');
const FabricNetwork = require('../../services/FabricNetwork');
const ChatManager = require('../../services/ChatManager');
const {
  buildOracleAttestation,
  buildPeeringCapabilities,
  tryHandlePeeringDiscovery,
  ATTESTATION_TYPE,
  KIND_PEERING,
  PEERING_BASE
} = require('../../functions/liveRelayPeeringHttp');
const { pubkeyXOnly, canonicalChatAuthor } = require('../../functions/identity');

describe('Fabric expectations: OracleAttestation', () => {
  it('http module signs and verifies PeeringCapability claims', () => {
    const key = new Key();
    const att = httpOracle.buildOracleAttestation({
      claim: { kind: KIND_PEERING, version: 1, fabricPeerId: key.pubkey },
      key,
      issuer: { publicKeyHex: key.pubkey, fabricIdentityId: key.pubkey }
    });
    assert.equal(att['@type'], ATTESTATION_TYPE);
    assert.equal(httpOracle.verifyOracleAttestation(att), true);
  });

  it('LiveRelay buildOracleAttestation uses http signer when identity unlocked', () => {
    const identityLib = require('../../functions/identity');
    const id = identityLib.createIdentity();
    const relay = {
      _identity: id,
      settings: { name: 'test-relay', mode: 'relay', fabric: { port: 7777 } },
      fabricNetwork: {
        status: () => ({
          listening: true,
          fabricListenPort: 7777,
          fabricPeerId: id.pubkey,
          fabricConnected: 0,
          ready: true
        })
      }
    };
    const att = buildOracleAttestation(relay);
    assert.equal(att['@type'], ATTESTATION_TYPE);
    assert.ok(att.signature);
    assert.equal(httpOracle.verifyOracleAttestation(att), true);
  });
});

describe('Fabric expectations: fabricPeerHost', () => {
  it('FabricNetwork dial helpers match http fabricPeerHost', () => {
    assert.equal(
      FabricNetwork.isSelfFabricAddress('127.0.0.1:7777', 7777),
      httpPeerHost.isSelfFabricAddress('127.0.0.1:7777', 7777)
    );
    assert.equal(
      FabricNetwork.normalizeFabricAddress('https://hub.fabric.pub/', { migrate: true }),
      httpPeerHost.normalizeFabricAddress('https://hub.fabric.pub/', { migrate: true })
    );
    assert.deepEqual(
      FabricNetwork.DEFAULT_SEEDS.slice().sort(),
      httpPeerHost.DEFAULT_NETWORK_HUB_SEEDS.slice().sort()
    );
  });

  it('createIsKnownAppRelayType catalogs GoonCitizen DirectChat', () => {
    assert.equal(FabricNetwork.isKnownAppRelayType('DirectChat'), true);
    assert.equal(httpPeerHost.createIsKnownAppRelayType(['DirectChat'])('DirectChat'), true);
  });
});

describe('Fabric expectations: fabricPubkey + chat normalize', () => {
  it('GC identity and ChatManager share http x-only author basis', () => {
    const key = new Key();
    const x = httpPubkey.pubkeyXOnly(key.pubkey);
    assert.equal(pubkeyXOnly(key.pubkey), x);
    assert.equal(canonicalChatAuthor(key.pubkey), x);
    assert.equal(ChatManager.canonicalChatAuthor(key.pubkey), x);
    const n = httpChat.normalizeP2pChatMessage({ text: 'ping' }, { signer: key.pubkey });
    assert.equal(n.actor.id, x);
    assert.equal(httpChat.chatTextOf({ text: 'mesh' }), 'mesh');
    assert.equal(httpChat.chatTextOf({ object: { content: 'hub' } }), 'hub');
    const gcChat = require('../../functions/fabricChatNormalize');
    assert.equal(gcChat.chatTextOf({ object: { body: 'app' } }), 'app');
    const coreChat = require('@fabric/core/functions/fabricChatText');
    assert.equal(httpChat.chatTextOf, coreChat.chatTextOf);
    assert.equal(gcChat.chatTextOf, httpChat.chatTextOf);
  });
});

describe('Fabric expectations: fabricPeeringHttp mount', () => {
  it('LiveRelay capabilities use shared envelope builder', () => {
    const identityLib = require('../../functions/identity');
    const id = identityLib.createIdentity();
    const relay = {
      _identity: id,
      settings: { name: 'test-relay', mode: 'relay', fabric: { port: 7777 } },
      fabricNetwork: {
        status: () => ({
          listening: true,
          fabricListenPort: 7777,
          fabricPeerId: id.pubkey,
          fabricConnected: 1,
          ready: true
        })
      }
    };
    const caps = buildPeeringCapabilities(relay);
    assert.equal(caps.endpointBasePath, PEERING_BASE);
    assert.equal(caps.kind, KIND_PEERING);
    assert.ok(caps.claim);
    assert.ok(caps.oracleAttestation && caps.oracleAttestation.signature);

    let status = 0;
    let body = '';
    const res = {
      writeHead (code) { status = code; },
      end (buf) { body = buf || ''; }
    };
    assert.equal(tryHandlePeeringDiscovery(relay, { method: 'GET' }, res, PEERING_BASE), true);
    assert.equal(status, 200);
    const parsed = JSON.parse(body);
    assert.equal(parsed.service, 'peering');
    assert.equal(httpPeering.isPeeringHttpPath(PEERING_BASE, 'GET'), true);
  });
});
