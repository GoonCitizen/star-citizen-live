#!/usr/bin/env node
'use strict';

/**
 * Example: Using the Declarative API
 *
 * This example demonstrates the declarative API properties
 * exposed by the Star Citizen Live service.
 */

const StarCitizen = require('../services/StarCitizen');

async function main () {
  // Create a service instance
  const sc = new StarCitizen({
    name: 'Star Citizen Declarative API Demo',
    logfile: process.env.SC_LOGFILE || 'C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log',
    http: {
      enable: false // Disable HTTP for this example
    }
  });

  console.log('[DEMO]', '=== Star Citizen Declarative API ===\n');

  // Demonstrate property access before starting
  console.log('[DEMO]', 'Before starting:');
  console.log('[DEMO]', '  Status:', sc.status);
  console.log('[DEMO]', '  Activities:', sc.activities.length);
  console.log('[DEMO]', '  Players:', sc.players.length);
  console.log('[DEMO]', '  Vehicles:', sc.vehicles.length);
  console.log('[DEMO]', '  Kills:', sc.kills.length);
  console.log('[DEMO]', '  Logs:', sc.logs.length);
  console.log('');

  // Start the service
  await sc.start();

  console.log('[DEMO]', 'After starting:');
  console.log('[DEMO]', '  Status:', sc.status);
  console.log('');

  // Demonstrate reactive updates via events
  console.log('[DEMO]', 'Listening for events...\n');

  let eventCount = 0;

  sc.on('activity', (activity) => {
    eventCount++;
    console.log('[DEMO]', `[Event ${eventCount}] Activity detected:`, activity.type);
    console.log('[DEMO]', `  -> Total activities: ${sc.activities.length}`);
  });

  sc.on('player:join', (player) => {
    eventCount++;
    console.log('[DEMO]', `[Event ${eventCount}] Player joined:`, player.name);
    console.log('[DEMO]', `  -> Total players: ${sc.players.length}`);
    console.log('[DEMO]', `  -> All players:`, sc.players.map(p => p.name).join(', '));
  });

  sc.on('kill', (kill) => {
    eventCount++;
    console.log('[DEMO]', `[Event ${eventCount}] Kill event:`, `${kill.killer} -> ${kill.victim}`);
    console.log('[DEMO]', `  -> Total kills: ${sc.kills.length}`);
  });

  // Simulate some activities (since we may not have a real game running)
  console.log('[DEMO]', '\nSimulating some activities...\n');

  // Simulate a player join
  setTimeout(() => {
    const player = { name: 'TestPilot', id: 'test-123', timestamp: new Date().toISOString() };
    sc._state.content.players[player.id] = player;
    sc.commit();
    sc.emit('player:join', player);
  }, 1000);

  // Simulate a kill event
  setTimeout(() => {
    const kill = {
      killer: 'TestPilot',
      victim: 'EnemyPilot',
      weapon: 'Ballistic Cannon',
      id: 'kill-456',
      timestamp: new Date().toISOString()
    };
    sc._state.content.kills[kill.id] = kill;
    sc.commit();
    sc.emit('kill', kill);
  }, 2000);

  // Simulate an activity
  setTimeout(() => {
    const activity = {
      type: 'MissionComplete',
      actor: { id: 'test-123', name: 'TestPilot' },
      object: { id: 'mission-789', name: 'Bounty Hunt' },
      target: '/missions/bounty-hunt',
      id: 'activity-789',
      timestamp: new Date().toISOString()
    };
    sc._state.content.activities[activity.id] = activity;
    sc.commit();
    sc.emit('activity', activity);
  }, 3000);

  // Display final state after simulations
  setTimeout(async () => {
    console.log('\n[DEMO]', '=== Final State ===');
    console.log('[DEMO]', 'Status:', sc.status);
    console.log('[DEMO]', 'Total Events:', eventCount);
    console.log('[DEMO]', 'Activities:', sc.activities.length);
    console.log('[DEMO]', 'Players:', sc.players.length);
    console.log('[DEMO]', 'Vehicles:', sc.vehicles.length);
    console.log('[DEMO]', 'Kills:', sc.kills.length);
    console.log('[DEMO]', 'Logs:', sc.logs.length);

    console.log('\n[DEMO]', '=== Declarative Property Details ===');
    if (sc.players.length > 0) {
      console.log('[DEMO]', 'Players:', JSON.stringify(sc.players, null, 2));
    }
    if (sc.kills.length > 0) {
      console.log('[DEMO]', 'Kills:', JSON.stringify(sc.kills, null, 2));
    }
    if (sc.activities.length > 0) {
      console.log('[DEMO]', 'Activities:', JSON.stringify(sc.activities, null, 2));
    }

    // Clean up
    await sc.stop();
    console.log('\n[DEMO]', 'Demo complete!');
    process.exit(0);
  }, 4000);

  return sc;
}

// Run the demo
if (require.main === module) {
  console.log('[DEMO]', 'Starting declarative API demo...\n');

  main().catch((error) => {
    console.error('[DEMO]', 'Fatal error:', error);
    process.exit(1);
  });
}

module.exports = main;

