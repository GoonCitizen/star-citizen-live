'use strict';

/**
 * Build the browser/Electron dashboard.
 *
 * Source of truth: components/Dashboard.js (React).
 * Output: assets/index.html (self-contained HTML + inlined bundle).
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const entry = path.join(__dirname, 'dashboard-entry.js');
const dest = path.join(root, 'assets', 'index.html');
const Dashboard = require('../components/Dashboard');
const Onboarding = require('../components/Onboarding');
const Identity = require('../components/Identity');
const Chat = require('../components/Chat');
const GlobalChatDock = require('../components/GlobalChatDock');
const MissionBroadcastBanner = require('../components/MissionBroadcastBanner');
const Notifications = require('../components/Notifications');
const Groups = require('../components/Groups');
const GroupPage = require('../components/GroupPage');
const Library = require('../components/Library');
const Missions = require('../components/Missions');
const Peers = require('../components/Peers');
const Settings = require('../components/Settings');
const Wallet = require('../components/Wallet');
const FabricLoginModal = require('../components/FabricLoginModal');
const GroupOfferModal = require('../components/GroupOfferModal');

async function main () {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['chrome100'],
    minify: true,
    define: {
      'process.env.NODE_ENV': '"production"'
    },
    logLevel: 'warning'
  });

  const js = result.outputFiles[0].text;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${Dashboard.TITLE}</title>
<style>
${Dashboard.CSS}
${Onboarding.CSS}
${Identity.CSS}
${FabricLoginModal.CSS || ''}
${GroupOfferModal.CSS || ''}
${Chat.CSS}
${GlobalChatDock.CSS}
${MissionBroadcastBanner.CSS}
${Notifications.CSS}
${Groups.CSS}
${GroupPage.CSS}
${Library.CSS}
${Missions.CSS}
${Peers.CSS}
${Settings.CSS}
${Wallet.CSS}
</style>
</head>
<body>
<div id="root"></div>
<script>
${js}
</script>
</body>
</html>
`;

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html);
  console.log('[BUILD]', 'Wrote assets/index.html from components/Dashboard.js');
}

main().catch((err) => {
  console.error('[BUILD]', err);
  process.exit(1);
});
