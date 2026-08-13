'use strict';

/**
 * Browser entry for the GoonCitizen dashboard.
 * Bundled by scripts/build.js into assets/index.html.
 *
 * Routes:
 *   /                   → Dashboard (live / analyze / groups tabs)
 *   /groups/:id|:slug   → dedicated GroupPage (share / join / settings)
 *   /profiles/:pubkey   → peer / player profile (from chat members, etc.)
 *   /missions/:id       → dedicated mission register page
 */

const React = require('react');
const { createRoot } = require('react-dom/client');
const Dashboard = require('../components/Dashboard');
const GroupPage = require('../components/GroupPage');
const ProfilePage = require('../components/ProfilePage');
const MissionPage = require('../components/MissionPage');

const el = document.getElementById('root');
if (el) {
  const groupKey = GroupPage.pathKeyFromLocation();
  const profileKey = ProfilePage.pubkeyFromLocation();
  const missionId = MissionPage.missionIdFromLocation();
  let page = React.createElement(Dashboard, null);
  if (groupKey) page = React.createElement(GroupPage, { pathKey: groupKey });
  else if (profileKey) page = React.createElement(ProfilePage, { pubkey: profileKey });
  else if (missionId) page = React.createElement(MissionPage, { missionId });
  createRoot(el).render(page);
}
