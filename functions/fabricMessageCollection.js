'use strict';

/**
 * Re-export of `@fabric/core/functions/fabricMessageCollection`.
 * Ordered AMP frames (`Message.toBuffer()` hex) are the share format for
 * group journals, Discord / GroupDataShare packs, DeviceDataShare cluster
 * catch-up (`functions/clusterSync.js`), and peer replay. Records include
 * `id` / `parent` when the core pin stores them (D-020).
 */
module.exports = require('@fabric/core/functions/fabricMessageCollection');
