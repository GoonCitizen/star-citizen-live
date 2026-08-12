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
  // Default bind is loopback (127.0.0.1). Set httpSharedMode / FABRIC_HUB_INTERFACE for LAN.
  // Dedicated public NIC (same host pattern as relay.goon.vc → 65.21.231.149):
  //   FABRIC_HUB_INTERFACE=65.21.231.149
  http: {
    enable: true,
    port: 3041
    // sharedMode: true  // opt-in: bind 0.0.0.0 (or env FABRIC_HUB_INTERFACE / settings httpSharedMode)
  },

  // Fabric P2P peering (AMP/Message over TCP/NOISE). Default seeds are network hubs.
  // Publishing identity (preferred via env, not committed here):
  //   FABRIC_XPRV=…           # preferred — same key across Fabric suite apps
  //   FABRIC_SEED='24 words'  # or FABRIC_MNEMONIC — stamps FABRIC_XPRV:
  //     eval "$(node scripts/fabric-env.js)"
  fabric: {
    listen: true,
    port: 7777,
    // Peer bind — default 0.0.0.0; pin NIC with FABRIC_INTERFACE=65.21.231.149
    // interface: process.env.FABRIC_INTERFACE || '0.0.0.0',
    peers: ['hub.fabric.pub:7777', 'relay.goon.vc:7777']
    // Optional public hostname for P2P_PEERING_OFFER + self-dial filter:
    // Store key fabricAdvertiseHost, or env FABRIC_PUBLIC_HOST /
    // FABRIC_ADVERTISE_HOST (required on relay.goon.vc so it does not dial itself).
  },

  // Personal Wallet tab (Hub-backed L1). When enable is true, LiveRelay proxies
  // /services/star-citizen/bitcoin/* to hub HTTP — the app's Hub-shaped API surface.
  // Operator admin token stays server-side (env / adminTokenFile / playnet discover);
  // the UI never holds FABRIC_HUB_ADMIN_TOKEN. Identity xpub is watch-only for
  // balance / receive / history; Send spends the Hub bitcoind wallet via that token.
  bitcoin: {
    enable: true,
    hub: process.env.SC_BITCOIN_HUB || 'http://127.0.0.1:8080',
    network: process.env.SC_BTC_NETWORK || 'regtest',
    adminToken: process.env.FABRIC_HUB_ADMIN_TOKEN || null,
    // Playnet mesh Hub A: ../hub.fabric.pub/stores/playnet-mesh-runtime/admin-token-a.txt
    adminTokenFile: process.env.FABRIC_HUB_ADMIN_TOKEN_FILE || null
  },

  // Document Exchange tab (Hub UI /documents + Fabric TUI documents packs).
  // Off by default — set enable: true in settings/local.js to show the tab and
  // proxy Hub JSON-RPC (ListDocuments / CreateDocument / PublishDocument /
  // CreatePurchaseInvoice / ClaimPurchase / RequestPeerInventory).
  // hub defaults to bitcoin.hub when omitted.
  // defaultPriceSats: chat attach list price (Hub DocumentView default is 25).
  documents: {
    enable: false,
    hub: process.env.SC_DOCUMENTS_HUB || process.env.SC_BITCOIN_HUB || 'http://127.0.0.1:8080',
    defaultPriceSats: 25
  },

  // Discord — local @fabric/discord bot and/or webhook mirror (off-Fabric).
  // Prefer bot: set token + channel (or env DISCORD_BOT_TOKEN / DISCORD_CHANNEL_ID).
  // Secrets may also be saved from Settings UI into stores/.../discord.secrets.json.
  // Do not commit tokens / webhooks.
  //
  // Multi-operator coordination: inbound Discord traffic is published as Fabric
  // CONTRACT_MESSAGE types DiscordRequest → DiscordClaim (first-wins) →
  // DiscordResponse under the GoonCitizen namespace. Auditors reconstruct the
  // sequence from Fabric Messages → View tree (or GET …/fabric/messages/tree).
  discord: {
    enable: false,
    // token: process.env.DISCORD_BOT_TOKEN || null,
    // app: {
    //   id: process.env.DISCORD_APP_ID || null,
    //   secret: process.env.DISCORD_APP_SECRET || null
    // },
    // channel: process.env.DISCORD_CHANNEL_ID || null,
    // webhook: process.env.DISCORD_WEBHOOK_URL || null,
    announceActivities: false,
    announceKills: true,
    announcePlayerJoins: true,
    announceMissions: false,
    announceCombat: false,
    announceIncaps: false
  },

  // Desktop: primary group member/ship overlay — configure in the UI
  // (Store keys: primaryGroupId, groupOverlay). Not set here.

  // Instance default group — paste a Fabric message id (from Groups → Share /
  // Fabric Messages → Copy id), an opaque fabric:<hex> GroupOffer, or a group id.
  // On start, seeds Store primaryGroupId when that setting is still empty.
  // defaultGroupMessageId: '…',

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

