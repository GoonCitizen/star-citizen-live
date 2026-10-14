'use strict';

/**
 * Shared shoutbox normalize — `@fabric/http/functions/fabricChatNormalize`.
 * Mesh: UTF-8 `P2P_CHAT_MESSAGE` + AMP author. Hub cache: `{ actor, object.content }`.
 * GoonCitizen Store still uses `{ channel, body, handle }` after ingest.
 */

module.exports = require('@fabric/http/functions/fabricChatNormalize');
