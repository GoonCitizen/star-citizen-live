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

const httpPassport = require('@fabric/http/functions/passportHttp');
const httpAllowlist = require('@fabric/http/functions/fabricHubAllowlist');
const httpShared = require('@fabric/http/functions/httpSharedMode');
const httpDeviceProtocol = require('@fabric/http/functions/fabricDeviceLinkProtocol');
const httpDeviceMessages = require('@fabric/http/functions/fabricDeviceLinkMessages');
const httpInvite = require('@fabric/http/functions/federationContractInvite');

const gcAllowlist = require('../../functions/fabricHubAllowlist');
const gcShared = require('../../functions/httpSharedMode');
const gcDeviceProtocol = require('../../functions/fabricDeviceLinkProtocol');
const gcInvite = require('../../functions/federationContractInvite');
const gcNamespaces = require('../../contracts/applicationMessageTypes');
const gcSidechain = require('../../functions/contractSidechain');
const { pubkeyXOnly, pubkeysMatch, createIdentity, accountFromIdentity } = require('../../functions/identity');
const gcLogin = require('../../functions/fabricLoginClient');
const passport = require('@fabric/core/functions/passport');
const ChatManager = require('../../services/ChatManager');
const FabricNetwork = require('../../services/FabricNetwork');

describe('Fabric expectations: GoonCitizen re-exports @fabric/http', () => {
  it('native sign-in headers are the ones the http relying party reads', () => {
    assert.equal(gcLogin.NATIVE_HEADER.toLowerCase(), httpPassport.NATIVE_HEADER);
    assert.equal(gcLogin.BINDING_HEADER.toLowerCase(), httpPassport.BINDING_HEADER);
  });

  it('hub allowlist and httpSharedMode re-export http APIs', () => {
    assert.equal(typeof gcAllowlist.assertAllowedFabricHub, 'function');
    assert.equal(typeof gcShared.resolveHttpListenHost, 'function');
    assert.equal(gcShared.resolveHttpListenHost({ mode: 'relay', env: {} }), '127.0.0.1');
    assert.equal(gcShared.resolveHttpListenHost({ mode: 'server', env: {} }), '0.0.0.0');
    assert.equal(httpShared.isHttpSharedModeEnabled(true), true);
  });

  it('device-link URL parser re-exports http', () => {
    const sid = crypto.randomBytes(24).toString('hex');
    const link = gcDeviceProtocol.parseFabricDeviceLinkUrl(
      `fabric://link?sessionId=${sid}&hub=${encodeURIComponent('https://hub.fabric.pub')}`
    );
    assert.equal(link.ok, true);
    assert.equal(link.kind, 'link');
  });

  it('federationContractInvite re-exports http', () => {
    // Behaviour, not reference identity: on http pins predating
    // `resolveFederationInviteExpiresAt` the local module wraps the builder to
    // stamp `expiresAt`. Same convention as tests/fabric/peer-host.test.js.
    assert.equal(gcInvite.parseFederationContractInvite, httpInvite.parseFederationContractInvite);
    assert.equal(gcInvite.FEDERATION_CONTRACT_INVITE, httpInvite.FEDERATION_CONTRACT_INVITE);
    if (typeof httpInvite.resolveFederationInviteExpiresAt === 'function') {
      assert.equal(gcInvite, httpInvite);
    }
    const invite = gcInvite.buildFederationContractInvite({
      inviteId: 'i1',
      inviterHubId: 'hub1',
      contractId: 'c1',
      invitedAt: 1000
    });
    assert.equal(invite.expiresAt, 1000 + gcInvite.DEFAULT_FEDERATION_INVITE_TTL_MS);
    assert.equal(gcInvite.DEFAULT_FEDERATION_INVITE_TTL_MS, 7 * 24 * 60 * 60 * 1000);
    const explicit = gcInvite.buildFederationContractInvite({
      inviteId: 'i2',
      invitedAt: 1000,
      ttlMs: 5000
    });
    assert.equal(explicit.expiresAt, 6000);
  });
});

describe('Fabric expectations: IdentityCrossSign (core v2 strings)', () => {
  it('the local modules are core, and the strings name the session and origin', () => {
    const gcSign = require('../../functions/identityCrossSign');
    const gcVerifyCross = require('../../functions/identityCrossSignVerify');
    assert.equal(gcSign, require('@fabric/core/functions/identityCrossSign'));
    assert.equal(gcVerifyCross, require('@fabric/core/functions/identityCrossSignVerify'));
    assert.equal(gcSign.SIGN_TYPE, 'IdentityCrossSign');
    assert.equal(gcSign.REVOKE_TYPE, 'IdentityCrossSignRevoke');
    const fields = {
      sessionId: 'cd'.repeat(24),
      nonce: 'ab'.repeat(32),
      localPubkey: '02' + '11'.repeat(32),
      peerPubkey: '03' + '22'.repeat(32),
      origin: 'https://relay.goon.vc'
    };
    const msg = gcSign.buildCrossSignMessage(fields);
    assert.equal(msg, `fabric:identity-cross-sign:2:${fields.sessionId}:${fields.nonce}:${fields.localPubkey}:${fields.peerPubkey}:${fields.origin}`);
    assert.deepEqual(gcSign.parseCrossSignMessage(msg), fields);
    const revoke = gcSign.buildRevokeMessage(Object.assign({ revokedAt: 1700000000000 }, fields));
    assert.equal(revoke, `fabric:identity-cross-sign-revoke:2:${fields.sessionId}:${fields.nonce}:${fields.localPubkey}:${fields.peerPubkey}:1700000000000:${fields.origin}`);
    assert.equal(gcSign.parseRevokeMessage(msg), null);
    assert.equal(gcSign.parseCrossSignMessage(revoke), null);
    assert.equal(gcSign.buildCrossSignMessage(Object.assign({}, fields, { localPubkey: 'aa:bb' })), null);
    assert.equal(gcSign.buildCrossSignMessage(Object.assign({}, fields, { origin: undefined })), null);
  });
});

describe('Fabric expectations: @fabric/discord pin', () => {
  it('OAuth callback is fail-closed (501; CSRF 400 when the pin emits state)', async () => {
    const Discord = require('@fabric/discord');
    const discord = new Discord({
      autoCommands: false,
      app: { id: '111', secret: 'x' },
      authority: '127.0.0.1'
    });
    const mockRes = () => {
      const res = {
        statusCode: 200,
        body: null,
        status (code) {
          this.statusCode = code;
          return this;
        },
        json (obj) {
          this.body = obj;
          return this;
        },
        send (msg) {
          this.body = msg;
          return this;
        }
      };
      return res;
    };
    const url = discord.generateAuthorizeLink();
    const state = new URL(url).searchParams.get('state');
    const empty = mockRes();
    await discord._handleOAuthCallback({}, empty);
    assert.equal(empty.body && empty.body.status, 'error');
    if (state) {
      assert.equal(empty.statusCode, 400);
      const unimplemented = mockRes();
      await discord._handleOAuthCallback({ query: { code: 'stolen', state } }, unimplemented);
      assert.equal(unimplemented.statusCode, 501);
      const replay = mockRes();
      await discord._handleOAuthCallback({ query: { code: 'stolen', state } }, replay);
      assert.equal(replay.statusCode, 400);
    } else {
      assert.equal(empty.statusCode, 501);
    }
    if (discord.client && typeof discord.client.destroy === 'function') {
      await discord.client.destroy();
    }
  });
});

describe('Fabric expectations: Passport v2 assertion contract', () => {
  it('a GoonCitizen assertion verifies with core for its own challenge only', () => {
    const player = createIdentity();
    const origin = 'https://relay.goon.vc';
    const challenge = passport.createChallenge({ origin, network: 'regtest', purpose: 'Sign in to GoonCitizen' });
    const account = accountFromIdentity(player, { network: 'regtest' });
    const { uri } = passport.signAssertion({ challenge: challenge.uri, origin, signer: 'gooncitizen', network: 'regtest' }, account.identity.key);
    const expected = {
      origin,
      nonce: challenge.nonce,
      challengeHash: challenge.hash,
      network: 'regtest',
      allow: challenge.request,
      challengeExpiresAt: challenge.expiresAt
    };
    const verified = passport.verifyAssertion(uri, expected);
    assert.equal(verified.ok, true, verified.error);
    assert.equal(verified.signer, 'gooncitizen');
    assert.equal(verified.identity.pubkey, account.identity.pubkey);
    assert.equal(passport.verifyAssertion(uri, Object.assign({}, expected, { origin: 'https://evil.example' })).ok, false);
    const other = passport.createChallenge({ origin, network: 'regtest' });
    assert.equal(passport.verifyAssertion(uri, Object.assign({}, expected, { nonce: other.nonce, challengeHash: other.hash })).ok, false);
  });
});

describe('Fabric expectations: device-link messages', () => {
  it('canonical link message parses', () => {
    const sessionId = 'bb'.repeat(24);
    const nonce = 'aa'.repeat(32);
    const a = new Identity(new Key()).id;
    const b = new Identity(new Key()).id;
    const origin = 'https://relay.goon.vc';
    const msg = httpDeviceMessages.buildDeviceLinkMessage(sessionId, nonce, a, b, 'phone', origin);
    assert.equal(msg, `fabric:device-link:3:link:${sessionId}:${nonce}:${a}:${b}:phone:${origin}`);
    const parsed = httpDeviceMessages.parseDeviceLinkMessage(msg);
    assert.equal(parsed.sessionId, sessionId);
    assert.equal(parsed.nonce, nonce);
    assert.equal(parsed.initiatorId, a);
    assert.equal(parsed.responderId, b);
    assert.equal(parsed.label, 'phone');
    assert.equal(parsed.origin, origin);
    assert.equal(
      httpDeviceMessages.buildDeviceLinkOfferMessage(sessionId, nonce, a, 'phone', origin),
      `fabric:device-link:3:offer:${sessionId}:${nonce}:${a}:phone:${origin}`
    );
    assert.throws(() => httpDeviceMessages.buildDeviceLinkMessage(sessionId, nonce, 'id1a', b, 'phone', origin), /id1/);
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
    assert.equal(FabricNetwork.isKnownAppRelayType('NoteShare'), true);
    assert.equal(FabricNetwork.isKnownAppRelayType('NoteUpdate'), true);
    assert.equal(FabricNetwork.isKnownAppRelayType('DiscordCatalogShare'), true);
    assert.equal(FabricNetwork.isKnownAppRelayType('GroupDataShare'), true);
    assert.equal(FabricNetwork.isKnownAppRelayType('IdentityCrossSign'), true);
    assert.equal(FabricNetwork.isKnownAppRelayType('IdentityCrossSignRevoke'), true);
    assert.equal(FabricNetwork.isKnownAppRelayType('MissionClaim'), true);
    assert.equal(FabricNetwork.isKnownAppRelayType('MissionClaimDecision'), true);
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
