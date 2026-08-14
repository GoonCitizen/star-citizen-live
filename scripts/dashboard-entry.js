'use strict';

/**
 * Browser entry for the GoonCitizen dashboard.
 * Bundled by scripts/build.js into assets/index.html.
 *
 * Routes:
 *   /                   → Dashboard (live / analyze / groups tabs)
 *   /groups/:id|:slug   → dedicated GroupPage (share / join / settings)
 *   /profiles/:id       → Fabric / Discord / platform identity (from search, chat, …)
 *   /missions/:id       → dedicated mission register page
 *   /files/:id            → dedicated file / build listing (pin to profile)
 *   /collections/:kind/:id → other search hits (notes, guilds, channels, Fabric AMP, …)
 *   /wallet/construct     → advanced Hub-wallet transaction constructor
 */

const React = require('react');
const { createRoot } = require('react-dom/client');
const Dashboard = require('../components/Dashboard');
const GroupPage = require('../components/GroupPage');
const ProfilePage = require('../components/ProfilePage');
const MissionPage = require('../components/MissionPage');
const CollectionRecord = require('../components/CollectionRecord');
const FilePage = require('../components/FilePage');
const WalletConstruct = require('../components/WalletConstruct');

function renderDashboard (el) {
  const groupKey = GroupPage.pathKeyFromLocation();
  const profileKey = ProfilePage.pubkeyFromLocation();
  const missionId = MissionPage.missionIdFromLocation();
  const collection = CollectionRecord.fromLocation();
  const fileId = FilePage.idFromLocation();
  const walletConstruct = WalletConstruct.fromLocation();
  let page = React.createElement(Dashboard, null);
  if (groupKey) page = React.createElement(GroupPage, { pathKey: groupKey });
  else if (profileKey) page = React.createElement(ProfilePage, { pubkey: profileKey });
  else if (missionId) page = React.createElement(MissionPage, { missionId });
  else if (fileId) page = React.createElement(FilePage, { fileId });
  else if (collection) {
    page = React.createElement(CollectionRecord, { kind: collection.kind, recordId: collection.id });
  } else if (walletConstruct) {
    page = React.createElement(WalletConstruct, null);
  }
  createRoot(el).render(page);
}

function showLocalNodeWait (el, detail) {
  const line = detail || 'Local node on this device (127.0.0.1)';
  el.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'font-family:system-ui,sans-serif;background:#111;color:#eee;padding:24px;text-align:center">' +
    '<div><div style="font-size:18px;margin-bottom:8px">Starting local node…</div>' +
    '<div style="opacity:.7;font-size:13px">' + line + '</div></div></div>';
}

async function boot () {
  const el = document.getElementById('root');
  if (!el) return;
  if (typeof window !== 'undefined' && window.Capacitor) {
    try {
      const { installAndroidIdentityBridge } = require('../functions/androidIdentityBridge');
      installAndroidIdentityBridge();
    } catch (e) {
      try { console.warn('[GOONCITIZEN] Android identity:', e && e.message); } catch (_) {}
    }
    try {
      const androidLocalNode = require('../functions/androidLocalNode');
      androidLocalNode.installLocalNodeFetch();
      showLocalNodeWait(el);
      let up = await androidLocalNode.startEmbeddedAndroidNode();
      while (!up) {
        showLocalNodeWait(el, 'Waiting for the local node on this device… retrying');
        up = await androidLocalNode.waitForLocalNodeHttp(20000);
      }
    } catch (e) {
      try { console.warn('[GOONCITIZEN] Android local node:', e && e.message); } catch (_) {}
    }
  }
  renderDashboard(el);
}

boot();
