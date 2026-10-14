'use strict';

/**
 * pm2 process file for a public GoonCitizen relay.
 *
 *   nvm use 24.15.0
 *   pm2 start deploy/ecosystem.config.cjs --interpreter "$(nvm which 24.15.0)"
 *
 * Secrets belong in repo-root `.env` (loaded at boot) or the pm2 env — not here.
 * See docs/PRODUCTION.md.
 */

const path = require('path');

module.exports = {
  apps: [
    {
      name: 'gooncitizen-relay',
      cwd: path.join(__dirname, '..'),
      script: 'scripts/node.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 15,
      min_uptime: '10s',
      restart_delay: 4000,
      kill_timeout: 10000,
      exp_backoff_restart_delay: 200,
      env: {
        NODE_ENV: 'production',
        SC_MODE: 'server'
      }
    }
  ]
};
