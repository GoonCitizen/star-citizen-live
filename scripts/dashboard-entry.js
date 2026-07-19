'use strict';

/**
 * Browser entry for the GoonCitizen dashboard.
 * Bundled by scripts/build.js into assets/index.html.
 */

const React = require('react');
const { createRoot } = require('react-dom/client');
const Dashboard = require('../components/Dashboard');

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(React.createElement(Dashboard));
}
