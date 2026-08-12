'use strict';

/**
 * Fabric expectation tests for GoonCitizen — leaf modules and http/core re-exports.
 * Kept outside tests/relay so unit Fabric contracts do not require LiveRelay boot.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');

const httpVerify = require('@fabric/http/functions/fabricSiteLoginVerify');
const httpAllowlist = require('@fabric/http/functions/fabricHubAllowlist');
const httpShared = require('@fabric/http/functions/httpSharedMode');
const httpProtocol = require('@fabric/http/functions/fabricProtocolLogin');
const httpDeviceProtocol = require('@fabric/http/functions/fabricDeviceLinkProtocol');
const httpDeviceMessages = require('@fabric/http/functions/fabricDeviceLinkMessages');
const httpInvite = require('@fabric/http/functions/federationContractInvite');

const gcVerify = require('../../functions/fabricSiteLoginVerify');
const gcAllowlist = require('../../functions/fabricHubAllowlist');
const gcShared = require('../../functions/httpSharedMode');
const gcProtocol = require('../../functions/fabricProtocolLogin');
const gcDeviceProtocol = require('../../functions/fabricDeviceLinkProtocol');
const gcInvite = require('../../functions/federationContractInvite');
const gcNamespaces = require('../../contracts/applicationMessageTypes');
const gcSidechain = require('../../functions/contractSidechain');
const { pubkeyXOnly, pubkeysMatch } = require('../../functions/identity');
const ChatManager = require('../../services/ChatManager');
const FabricNetwork = require('../../services/FabricNetwork');

describe('Fabric expectations: GoonCitizen re-exports @fabric/http', () => {
  it('site-login verify is the http module (or API-compatible)', () => {
    assert.equal(gcVerify.DESKTOP_LOGIN_PREFIX, httpVerify.DESKTOP_LOGIN_PREFIX);
    assert.equal(gcVerify.DESKTOP_LOGIN_PREFIX, 'fabric:hub-login:1');
    assert.equal(typeof gcVerify.buildLoginMessage, 'function');
    assert.equal(typeof gcVerify.verifyFabricDesktopLoginSignedPayload, 'function');
    assert.equal(typeof gcVerify.originsMatchForDesktopSession, 'function');
  });

  it('hub allowlist and httpSharedMode re-export http APIs', () => {
    assert.equal(typeof gcAllowlist.assertAllowedFabricHub, 'function');
    assert.equal(typeof gcShared.resolveHttpListenHost, 'function');
    assert.equal(gcShared.resolveHttpListenHost({ mode: 'relay', env: {} }), '127.0.0.1');
    assert.equal(gcShared.resolveHttpListenHost({ mode: 'server', env: {} }), '0.0.0.0');
    assert.equal(httpShared.isHttpSharedModeEnabled(true), true);
  });

  it('protocol URL parsers re-export http', () => {
    const sid = crypto.randomBytes(24).toString('hex');
    const login = gcProtocol.parseFabricLoginUrl(
      `fabric://login?sessionId=${sid}&hub=${encodeURIComponent('https://relay.goon.vc')}`
    );
    assert.equal(login.ok, true);
    assert.equal(login.hubBase, 'https://relay.goon.vc');
    const link = gcDeviceProtocol.parseFabricDeviceLinkUrl(
      `fabric://link?sessionId=${sid}&hub=${encodeURIComponent('https://hub.fabric.pub')}`
    );
    assert.equal(link.ok, true);
    assert.equal(link.kind, 'link');
    assert.equal(typeof httpProtocol.fabricLoginRequestHeaders, 'function');
  });

  it('federationContractInvite re-exports http', () => {
    assert.equal(gcInvite, httpInvite);
  });
});

describe('Fabric expectations: site-login challenge contract', () => {
  it('build/parse/verify round-trip matches Hub Passport wire format', () => {
    const key = new Key();
    const ident = new Identity(key);
    const sessionId = crypto.randomBytes(24).toString('hex');
    const nonce = crypto.randomBytes(32).toString('hex');
    const origin = 'https://relay.goon.vc';
    const message = gcVerify.buildLoginMessage(sessionId, origin, nonce);
    assert.match(message, /^fabric:hub-login:1:/);
    const parsed = gcVerify.parseDesktopLoginMessage(message);
    assert.equal(parsed.sessionId, sessionId);
    assert.equal(parsed.origin, origin);
    const payload = gcVerify.buildFabricIdentitySignedPayload(ident, message);
    const verified = gcVerify.verifyFabricDesktopLoginSignedPayload({
      ...payload,
      message
    }, { sessionId, origin });
    assert.equal(verified.ok, true);
    assert.equal(payload.pubkeyHex, ident.fabricKey.pubkey);
    assert.equal(payload.identity.xpub, ident.fabricKey.xpub);
  });

  it('rejects phishing hub origins on fabric://login', () => {
    const sid = crypto.randomBytes(24).toString('hex');
    const bad = gcProtocol.parseFabricLoginUrl(
      `fabric://login?sessionId=${sid}&hub=${encodeURIComponent('https://evil.example')}`
    );
    assert.equal(bad.ok, false);
    assert.match(bad.error, /not allowed/);
  });
});

describe('Fabric expectations: device-link messages', () => {
  it('canonical link message parses', () => {
    const nonce = 'aa'.repeat(32);
    const msg = httpDeviceMessages.buildDeviceLinkMessage(nonce, 'id1a', 'id1b', 'phone');
    const parsed = httpDeviceMessages.parseDeviceLinkMessage(msg);
    assert.equal(parsed.nonce, nonce);
    assert.equal(parsed.initiatorId, 'id1a');
    assert.equal(parsed.responderId, 'id1b');
    assert.equal(parsed.label, 'phone');
  });
});

describe('Fabric expectations: application namespaces', () => {
  it('re-exports core OUTER and CONTRACT_BODY_TYPES', () => {
    assert.equal(gcNamespaces.fromCore, true);
    assert.ok(gcNamespaces.OUTER);
    assert.ok(gcNamespaces.OUTER.P2P_CHAT_MESSAGE || gcNamespaces.OUTER.CHAT_MESSAGE || Object.keys(gcNamespaces.OUTER).length > 0);
    assert.ok(gcNamespaces.CONTRACT_BODY_TYPES);
    assert.ok(gcNamespaces.CONTRACT_BODY_TYPES.MissionBroadcast || gcNamespaces.CONTRACT_BODY_TYPES.GroupChat);
  });

  it('FabricNetwork known app relay types include DirectChat and GroupChat', () => {
    assert.equal(typeof FabricNetwork.isKnownAppRelayType, 'function');
    assert.equal(FabricNetwork.isKnownAppRelayType('DirectChat'), true);
    const groupChat = gcNamespaces.CONTRACT_BODY_TYPES.GroupChat || 'GroupChat';
    assert.equal(FabricNetwork.isKnownAppRelayType(groupChat), true);
    assert.equal(FabricNetwork.isKnownAppRelayType('NotARealType_XYZ'), false);
  });
});

describe('Fabric expectations: contract sidechain re-export', () => {
  it('marks fromCore and exposes path helpers', () => {
    assert.equal(gcSidechain.fromCore, true);
    assert.equal(typeof gcSidechain.storePathsForContract, 'function');
  });
});

describe('Fabric expectations: chat author canonicalization', () => {
  it('canonicalChatAuthor uses x-only form and matches compressed', () => {
    const key = new Key();
    const compressed = String(key.pubkey);
    const xOnly = pubkeyXOnly(compressed);
    assert.equal(xOnly.length, 64);
    assert.equal(ChatManager.canonicalChatAuthor(compressed), xOnly);
    assert.equal(ChatManager.canonicalChatAuthor(xOnly), xOnly);
    assert.equal(pubkeysMatch(compressed, xOnly), true);
  });

  it('global chat id is stable for compressed vs x-only authors', () => {
    const key = new Key();
    const body = 'hello fabric';
    const idA = ChatManager.idOf({ channel: 'global', author: key.pubkey, body });
    const idB = ChatManager.idOf({ channel: 'global', author: pubkeyXOnly(key.pubkey), body });
    assert.equal(idA, idB);
  });
});

describe('Fabric expectations: hub allowlist defaults', () => {
  it('allows network hubs and loopback; rejects unknown', () => {
    assert.equal(gcAllowlist.isAllowedFabricHub('https://hub.fabric.pub'), true);
    assert.equal(gcAllowlist.isAllowedFabricHub('https://relay.goon.vc'), true);
    assert.equal(gcAllowlist.isAllowedFabricHub('http://127.0.0.1:3041'), true);
    assert.equal(gcAllowlist.isAllowedFabricHub('https://phishing.test'), false);
    assert.equal(
      httpAllowlist.isAllowedFabricHub('https://phishing.test', {
        env: { FABRIC_HUB_ALLOWLIST: 'https://phishing.test' }
      }),
      true
    );
  });
});
