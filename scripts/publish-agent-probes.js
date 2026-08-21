'use strict';

/**
 * Publish local `reports/probes/*.json` into the live-network static root.
 *
 *   SC_AGENT_STATIC_ROOT=/var/www/goon.vc/html npm run probes:publish
 *
 * Public URLs (after nginx/Caddy `/probes/` is enabled):
 *   https://relay.goon.vc/probes/index.json
 *   https://relay.goon.vc/probes/discord-scheduled-events.json
 */

const { publishAgentProbes, resolveProbeDir, resolvePublishRoot } = require('../functions/agentProbeExport');

const result = publishAgentProbes({ cwd: require('path').join(__dirname, '..') });
if (!result.publishDir) {
  console.error('Set SC_AGENT_STATIC_ROOT (document root that serves /probes/).');
  console.error('Local probes dir:', resolveProbeDir({ cwd: require('path').join(__dirname, '..') }));
  process.exit(2);
}
console.log('Published', result.copied.length, 'files →', result.publishDir);
for (const f of result.copied) console.log(' ', f);
console.log('Publish root was', resolvePublishRoot({}));
