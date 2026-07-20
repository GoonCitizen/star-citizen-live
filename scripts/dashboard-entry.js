'use strict';

/**
 * Browser entry for the GoonCitizen dashboard.
 * Bundled by scripts/build.js into assets/index.html.
 *
 * Routes:
 *   /                 → Dashboard (live / analyze / groups tabs)
 *   /groups/:id|:slug → dedicated GroupPage (share / join / settings)
 */

const React = require('react');
const { createRoot } = require('react-dom/client');
const Dashboard = require('../components/Dashboard');
const GroupPage = require('../components/GroupPage');

const el = document.getElementById('root');
if (el) {
  const pathKey = GroupPage.pathKeyFromLocation();
  createRoot(el).render(React.createElement(pathKey ? GroupPage : Dashboard, pathKey ? { pathKey } : null));
}
