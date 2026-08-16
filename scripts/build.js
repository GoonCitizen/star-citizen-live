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

let polyfillNode = null;
try {
  ({ polyfillNode } = require('esbuild-plugin-polyfill-node'));
} catch (_) {
  polyfillNode = null;
}

const root = path.join(__dirname, '..');
const entry = path.join(__dirname, 'dashboard-entry.js');
const dest = path.join(root, 'assets', 'index.html');
const Dashboard = require('../components/Dashboard');
const Onboarding = require('../components/Onboarding');
const Identity = require('../components/Identity');
const Account = require('../components/Account');
const Chat = require('../components/Chat');
const GlobalChatDock = require('../components/GlobalChatDock');
const MissionBroadcastBanner = require('../components/MissionBroadcastBanner');
const Notifications = require('../components/Notifications');
const Groups = require('../components/Groups');
const GroupPage = require('../components/GroupPage');
const ProfilePage = require('../components/ProfilePage');
const Library = require('../components/Library');
const Missions = require('../components/Missions');
const MissionPage = require('../components/MissionPage');
const CollectionRecord = require('../components/CollectionRecord');
const FilePage = require('../components/FilePage');
const LocationPage = require('../components/LocationPage');
const MapPage = require('../components/MapPage');
const Peers = require('../components/Peers');
const FabricMessages = require('../components/FabricMessages');
const GroupFabricInspector = require('../components/GroupFabricInspector');
const ActivityHeatmap = require('../components/ActivityHeatmap');
const MissionOutcomesChart = require('../components/MissionOutcomesChart');
const ShipPicker = require('../components/ShipPicker');
const LocationPicker = require('../components/LocationPicker');
const StarMap = require('../components/StarMap');
const GroupComposition = require('../components/GroupComposition');
const Fleet = require('../components/Fleet');
const Settings = require('../components/Settings');
const Wallet = require('../components/Wallet');
const WalletConstruct = require('../components/WalletConstruct');
const DataSyncStatus = require('../components/DataSyncStatus');
const FabricLoginModal = require('../components/FabricLoginModal');
const PubkeyEmoji = require('../components/PubkeyEmoji');
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
    // Linked @fabric/core clones may have build/Release/fabric.node. The
    // dashboard never loads the native addon (browser); ignore it.
    loader: { '.node': 'empty' },
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.NODE_DEBUG': 'false',
      global: 'globalThis'
    },
    plugins: [
      {
        name: 'events-constructor',
        setup (build) {
          const shim = path.join(root, 'functions', 'browserEvents.js');
          build.onResolve({ filter: /^events$/ }, () => ({ path: shim }));
        }
      },
      {
        // polyfill-node leaves crypto as {} unless polyfills.crypto is true
        name: 'browser-crypto',
        setup (build) {
          const shim = path.join(root, 'functions', 'browserCrypto.js');
          build.onResolve({ filter: /^(node:)?crypto$/ }, () => ({ path: shim }));
        }
      },
      ...(polyfillNode ? [polyfillNode({
        globals: { Buffer: true, process: true }
      })] : [])
    ],
    logLevel: 'warning'
  });

  const js = result.outputFiles[0].text;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${Dashboard.TITLE}</title>
<style>
${Dashboard.CSS}
${Onboarding.CSS}
${Identity.CSS}
${Account.CSS || ''}
${FabricLoginModal.CSS || ''}
${PubkeyEmoji.CSS || ''}
${GroupOfferModal.CSS || ''}
${Chat.CSS}
${GlobalChatDock.CSS}
${MissionBroadcastBanner.CSS}
${Notifications.CSS}
${Groups.CSS}
${GroupPage.CSS}
${ProfilePage.CSS}
${Library.CSS}
${Missions.CSS}
${MissionPage.CSS}
${CollectionRecord.CSS}
${FilePage.CSS || ''}
${LocationPage.CSS || ''}
${MapPage.CSS || ''}
${Peers.CSS}
${FabricMessages.CSS}
${GroupFabricInspector.CSS}
${ActivityHeatmap.CSS}
${MissionOutcomesChart.CSS}
${ShipPicker.CSS}
${LocationPicker.CSS || ''}
${StarMap.CSS || ''}
${GroupComposition.CSS || ''}
${Fleet.CSS}
${Settings.CSS}
${Wallet.CSS}
${WalletConstruct.CSS || ''}
${DataSyncStatus.CSS || ''}
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
