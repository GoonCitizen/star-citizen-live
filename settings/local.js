'use strict';

const {
  NAME
} = require('../constants');

module.exports = {
  authority: 'localhost:3040',
  name: NAME,
  http: {
    enable: false,
    port: 3041
  },
  discord: {
    enable: false,
    webhook: process.env.DISCORD_WEBHOOK_URL || null,
    channel: process.env.DISCORD_CHANNEL_ID || null,
    announceActivities: true,
    announceKills: true,
    announcePlayerJoins: true
  }
};
