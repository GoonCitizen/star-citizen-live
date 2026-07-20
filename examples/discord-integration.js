#!/usr/bin/env node
'use strict';

/**
 * Example: Star Citizen Live with Discord Integration
 *
 * This example demonstrates how to use the Star Citizen Live service
 * with Discord webhook integration to announce game events.
 */

const StarCitizen = require('../services/StarCitizen');

async function main () {
  // Create instance with Discord enabled
  const sc = new StarCitizen({
    name: 'Star Citizen Live',
    authority: 'https://sensemaker.io',
    logfile: process.env.SC_LOGFILE || 'C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log',

    // Enable HTTP server
    http: {
      enable: true,
      port: 3041
    },

    // Configure Discord integration
    discord: {
      enable: true,
      webhook: process.env.DISCORD_WEBHOOK_URL,
      announceActivities: true,
      announceKills: true,
      announcePlayerJoins: true
    }
  });

  // Wire up event listeners
  sc.on('ready', () => {
    console.log('[EXAMPLE]', 'Service ready!');
    console.log('[EXAMPLE]', 'Service ID:', sc.id);
    console.log('[EXAMPLE]', 'HTTP Server:', `http://localhost:${sc.settings.http.port}`);
    console.log('[EXAMPLE]', 'Discord Integration:', sc.settings.discord.enable ? 'Enabled' : 'Disabled');
  });

  sc.on('activity', (activity) => {
    console.log('[EXAMPLE]', '[ACTIVITY]', activity.type);
    // Declarative API: access activities array
    console.log('[EXAMPLE]', 'Total activities:', sc.activities.length);
  });

  sc.on('kill', (kill) => {
    console.log('[EXAMPLE]', '[KILL]', `${kill.killer} -> ${kill.victim}`);
    // Declarative API: access kills array
    console.log('[EXAMPLE]', 'Total kills:', sc.kills.length);
  });

  sc.on('player:join', (player) => {
    console.log('[EXAMPLE]', '[PLAYER]', 'Player joined:', player.name);
    // Declarative API: access players array
    console.log('[EXAMPLE]', 'Total players:', sc.players.length);
  });

  sc.on('log', (log) => {
    console.log('[EXAMPLE]', '[LOG]', log);
  });

  sc.on('error', (error) => {
    console.error('[EXAMPLE]', '[ERROR]', error);
  });

  // Start the service
  await sc.start();

  // Demonstrate declarative API access
  console.log('[EXAMPLE]', '=== Declarative API Demo ===');
  console.log('[EXAMPLE]', 'Status:', sc.status);
  console.log('[EXAMPLE]', 'Activities:', sc.activities.length);
  console.log('[EXAMPLE]', 'Players:', sc.players.length);
  console.log('[EXAMPLE]', 'Vehicles:', sc.vehicles.length);
  console.log('[EXAMPLE]', 'Kills:', sc.kills.length);
  console.log('[EXAMPLE]', 'Logs:', sc.logs.length);

  // Demonstrate programmatic Discord posting
  if (sc.settings.discord.enable && sc.settings.discord.webhook) {
    console.log('[EXAMPLE]', 'Posting test message to Discord...');
    try {
      await sc.postToDiscord({
        embeds: [{
          title: '🚀 Star Citizen Live',
          description: 'Service started successfully!',
          fields: [
            { name: 'Service ID', value: sc.id, inline: true },
            { name: 'Status', value: sc.status, inline: true }
          ],
          timestamp: new Date().toISOString(),
          color: 0x00FF00
        }]
      });
      console.log('[EXAMPLE]', 'Test message posted to Discord!');
    } catch (error) {
      console.error('[EXAMPLE]', 'Failed to post to Discord:', error.message);
    }
  }

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('[EXAMPLE]', 'Shutting down...');
    await sc.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('[EXAMPLE]', 'Shutting down...');
    await sc.stop();
    process.exit(0);
  });

  return {
    id: sc.id,
    status: sc.status
  };
}

// Run the example
if (require.main === module) {
  console.log('[EXAMPLE]', 'Starting Star Citizen Live with Discord integration...');

  // Check for required environment variables
  if (!process.env.DISCORD_WEBHOOK_URL) {
    console.warn('[EXAMPLE]', 'Warning: DISCORD_WEBHOOK_URL not set. Discord integration will be disabled.');
    console.warn('[EXAMPLE]', 'Set it with: export DISCORD_WEBHOOK_URL=your_webhook_url');
  }

  main().catch((error) => {
    console.error('[EXAMPLE]', 'Fatal error:', error);
    process.exit(1);
  }).then((output) => {
    console.log('[EXAMPLE]', 'Started successfully:', JSON.stringify(output));
  });
}

module.exports = main;

