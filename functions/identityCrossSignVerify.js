'use strict';

/**
 * Sign / verify IdentityCrossSign bodies: `signCrossSign(identity,
 * { sessionId, nonce, origin, peerPubkey, revokedAt? }, kind)` and
 * `verifyCrossSignObject(object)`.
 */

module.exports = require('@fabric/core/functions/identityCrossSignVerify');
