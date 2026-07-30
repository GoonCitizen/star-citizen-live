'use strict';

const {
  NAME
} = require('../constants');

/**
 * Example configuration for Star Citizen Live service.
 * Copy this file to local.js and customize as needed.
 */
module.exports = {
  authority: 'https://sensemaker.io',
  name: NAME,

  // Path to Star Citizen game log file
  logfile: 'C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log',

  // HTTP Server Configuration (local dashboard / REST — not the peering transport)
  http: {
    enable: true,
    port: 3041
  },

  // Fabric P2P peering (AMP/Message over TCP/NOISE). Default seeds are network hubs.
  // Publishing identity (preferred via env, not committed here):
  //   FABRIC_XPRV=…           # GoonCitizen publishing key
  //   FABRIC_SEED='24 words'  # or FABRIC_MNEMONIC — derive XPRV:
  //     eval "$(node scripts/fabric-env.js)"
  fabric: {
    listen: true,
    port: 7777,
    peers: ['hub.fabric.pub:7777', 'relay.goon.vc:7777']
    // Optional public hostname for P2P_PEERING_OFFER: set Store key
    // fabricAdvertiseHost (settings API) — do not commit secrets here.
  },

  // Discord Integration
  discord: {
    enable: true,
    // Get webhook URL from Discord channel settings -> Integrations -> Webhooks
    webhook: 'https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN',
    // Optional: Discord channel ID for additional features
    channel: 'YOUR_CHANNEL_ID',
    // Configure what gets announced to Discord
    announceActivities: true,
    announceKills: true,
    announcePlayerJoins: true
  },

  // Initial State
  state: {
    status: 'STOPPED',
    activities: {},
    logs: {},
    players: {},
    vehicles: {},
    kills: {}
  }
};

