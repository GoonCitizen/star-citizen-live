'use strict';

/**
 * Fabric expectation tests for GoonCitizen — leaf modules and http/core re-exports.
 * Kept outside tests/relay so unit Fabric contracts do not require LiveRelay boot.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Key = require('@fabric/core/types/key');
const delegation = require('@fabric/core/types/delegation');

const httpPassport = require('@fabric/http/functions/passportHttp');
const httpAllowlist = require('@fabric/http/functions/fabricHubAllowlist');
const httpShared = require('@fabric/http/functions/httpSharedMode');
const httpDelegationClient = require('@fabric/http/functions/fabricDelegationClient');
const httpInvite = require('@fabric/http/functions/federationContractInvite');

const gcAllowlist = require('../../functions/fabricHubAllowlist');
const gcShared = require('../../functions/httpSharedMode');
const gcQrScan = require('../../functions/qrScanLink');
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

  it('signer invitations read the same in GoonCitizen and http', () => {
    const offer = delegation.createLinkOffer({ origin: 'https://hub.fabric.pub', label: 'Phone', network: 'regtest' }, new Key());
    const http = httpDelegationClient.readLinkInvitation(offer.uri);
    const gc = gcQrScan.interpretQrScan(offer.uri);
    assert.equal(http.ok, true);
    assert.equal(gc.ok, true);
    assert.equal(gc.kind, 'delegation-invitation');
    assert.equal(gc.rendezvous, http.rendezvous);
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

describe('Fabric expectations: delegation frames (core)', () => {
  it('an identity grant is a signed Fabric Message and its revoke names it', () => {
    const grantor = new Key();
    const grantee = new Key();
    const grant = delegation.createGrant({ grantee: grantee.pubkey, scopes: ['identity'], label: 'Desktop' }, grantor);
    assert.match(grant.uri, /^fabric:/);
    const read = delegation.readGrant(grant.uri);
    assert.equal(read.ok, true, read.error);
    assert.deepEqual(read.grant.scopes, ['identity']);
    assert.equal(delegation.delegationType(grant.uri), 'DELEGATION_GRANT');
    const revoke = delegation.createRevoke({ grant: grant.hash }, grantor);
    const readRevoke = delegation.readRevoke(revoke.uri);
    assert.equal(readRevoke.ok, true, readRevoke.error);
    assert.equal(readRevoke.revoke.grant, grant.hash);
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
    assert.equal(FabricNetwork.isKnownAppRelayType('IdentityCrossSign'), false);
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
