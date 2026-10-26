'use strict';

/**
 * BIP340 tags for GoonCitizen-only signatures, alongside `@fabric/core`
 * `functions/signingTags` (receipts, federation witnesses, cross-signs, device
 * links). A signature made for one of these never verifies as another.
 */

module.exports = Object.freeze({
  // `identity.signEnvelope` / `verifyEnvelope` (payload digest).
  ENVELOPE: 'Fabric/GoonCitizen/Envelope',
  // Group change proposal votes (`signingStringForGroupChangeProposal`).
  GROUP_CHANGE_PROPOSAL: 'Fabric/GoonCitizen/GroupChangeProposal'
});
