'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('local @fabric re-exports', () => {
  it('keeps shoutbox normalize on the http pin', () => {
    const local = require('../../functions/fabricChatNormalize');
    const pkg = require('@fabric/http/functions/fabricChatNormalize');
    assert.equal(local, pkg);
    assert.equal(typeof local.chatTextOf, 'function');
  });

  it('keeps site-login verify on the http pin', () => {
    const local = require('../../functions/fabricSiteLoginVerify');
    const pkg = require('@fabric/http/functions/fabricSiteLoginVerify');
    assert.equal(local, pkg);
    assert.equal(typeof local.buildLoginMessage, 'function');
  });

  it('keeps device-link protocol and protocol-login on the http pin', () => {
    assert.equal(
      require('../../functions/fabricDeviceLinkProtocol'),
      require('@fabric/http/functions/fabricDeviceLinkProtocol')
    );
    assert.equal(
      require('../../functions/fabricProtocolLogin'),
      require('@fabric/http/functions/fabricProtocolLogin')
    );
  });

  it('keeps hub allowlist and federation invite on the http pin', () => {
    assert.equal(
      require('../../functions/fabricHubAllowlist'),
      require('@fabric/http/functions/fabricHubAllowlist')
    );
    const local = require('../../functions/federationContractInvite');
    const pkg = require('@fabric/http/functions/federationContractInvite');
    assert.equal(typeof local.buildFederationContractInvite, 'function');
    assert.equal(typeof pkg.buildFederationContractInvite, 'function');
    assert.equal(local.parseFederationContractInvite, pkg.parseFederationContractInvite);
    assert.equal(typeof local.DEFAULT_FEDERATION_INVITE_TTL_MS, 'number');
  });

  it('keeps oracle attestation on the http pin (orphan local path)', () => {
    assert.equal(
      require('../../functions/oracleAttestation'),
      require('@fabric/http/functions/oracleAttestation')
    );
  });

  it('keeps Discord settings normalize on the discord pin (orphan local path)', () => {
    assert.equal(
      require('../../functions/normalizeDiscordSettings'),
      require('@fabric/discord/functions/normalizeDiscordSettings')
    );
  });

  it('keeps GroupChat seal and contract-message helpers on core', () => {
    assert.equal(
      require('../../functions/groupChatSeal'),
      require('@fabric/core/functions/groupChatSeal')
    );
    assert.equal(
      require('../../functions/contractMessageCommit'),
      require('@fabric/core/functions/contractMessageCommit')
    );
    assert.equal(
      require('../../functions/contractMessageAccumulate'),
      require('@fabric/core/functions/contractMessageAccumulate')
    );
    assert.equal(
      require('../../functions/fabricMessageCollection'),
      require('@fabric/core/functions/fabricMessageCollection')
    );
  });

  it('re-exports contract sidechain locals with fromCore', () => {
    const local = require('../../functions/contractSidechain');
    const core = require('@fabric/core/functions/contractSidechainLocal');
    assert.equal(local.fromCore, true);
    assert.equal(typeof local.storePathsForContract, 'function');
    assert.equal(
      local.storePathsForContract,
      core.storePathsForContract || core.storePathsForLocalContract
    );
  });

  it('uses http fabricPeerHost and httpSharedMode when the package is staged', () => {
    assert.equal(
      require('../../functions/fabricPeerHost'),
      require('@fabric/http/functions/fabricPeerHost')
    );
    assert.equal(
      require('../../functions/httpSharedMode'),
      require('@fabric/http/functions/httpSharedMode')
    );
  });

  it('uses Hub bulk-advisory detector when the package is staged', () => {
    const local = require('../../functions/bulkSecurityAdvisory');
    const hub = require('@fabric/hub/functions/bulkSecurityAdvisory');
    assert.equal(local.looksLikeBulkSecurityAdvisory, hub.looksLikeBulkSecurityAdvisory);
  });

  it('uses Hub identityCluster when the package is staged', () => {
    assert.equal(
      require('../../functions/identityCluster'),
      require('@fabric/hub/functions/identityCluster')
    );
  });
});

describe('constants', () => {
  it('exports brand names and feature flags', () => {
    const c = require('../../constants');
    assert.equal(c.NAME, 'GOONCITIZEN');
    assert.equal(c.BRAND_NAME, 'G00N CITIZEN');
    assert.equal(c.FEATURES.wallet, true);
    assert.equal(c.FEATURES.documents, true);
    assert.equal(c.FEATURES.library, false);
  });
});
