# Integration Guide

This guide explains how to integrate Star Citizen Live with Discord, Fabric, and other services.

## Table of Contents

- [Discord Integration](#discord-integration)
- [Fabric Service Integration](#fabric-service-integration)
- [Sensemaker Integration](#sensemaker-integration)
- [Custom Integration](#custom-integration)
- [Event Handling](#event-handling)
- [HTTP API Integration](#http-api-integration)

## Discord Integration

### Setup

1. **Create a Discord Webhook**

   In your Discord server:
   - Go to Server Settings → Integrations → Webhooks
   - Click "New Webhook"
   - Configure the webhook (name, channel, avatar)
   - Copy the webhook URL

2. **Configure the Service**

   ```javascript
   const StarCitizen = require('@rsi/star-citizen');

   const sc = new StarCitizen({
     discord: {
       enable: true,
       webhook: 'https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN',
       channel: 'CHANNEL_ID', // optional
       announceActivities: true,
       announceKills: true,
       announcePlayerJoins: true
     }
   });

   await sc.start();
   ```

### Discord Message Types

The service automatically posts rich embeds to Discord:

#### Activity Announcements (Green)
```javascript
// Automatically posted when activities occur
{
  embeds: [{
    title: '🎮 Star Citizen Activity',
    description: 'StarCitizenLogEntry',
    fields: [
      { name: 'Actor', value: 'service-id', inline: true },
      { name: 'Object', value: 'actor-id', inline: true },
      { name: 'Target', value: '/logs', inline: true }
    ],
    color: 0x00FF00,
    timestamp: '2024-01-01T00:00:00Z'
  }]
}
```

#### Kill Events (Red)
```javascript
// Automatically posted when kills occur
{
  embeds: [{
    title: '💀 Kill Event',
    description: 'Player1 eliminated Player2',
    fields: [
      { name: 'Killer', value: 'Player1', inline: true },
      { name: 'Victim', value: 'Player2', inline: true },
      { name: 'Weapon', value: 'Ballistic Cannon', inline: true }
    ],
    color: 0xFF0000,
    timestamp: '2024-01-01T00:00:00Z'
  }]
}
```

#### Player Joins (Blue)
```javascript
// Automatically posted when players join
{
  embeds: [{
    title: '👤 Player Joined',
    description: 'TestPilot has entered the verse',
    fields: [
      { name: 'Player', value: 'TestPilot', inline: true },
      { name: 'ID', value: 'player-123', inline: true }
    ],
    color: 0x0000FF,
    timestamp: '2024-01-01T00:00:00Z'
  }]
}
```

### Custom Discord Messages

You can also post custom messages to Discord:

```javascript
await sc.postToDiscord({
  content: 'Simple text message',
  embeds: [{
    title: 'Custom Embed',
    description: 'Your custom content',
    fields: [
      { name: 'Field 1', value: 'Value 1' },
      { name: 'Field 2', value: 'Value 2' }
    ],
    color: 0xFFFF00,
    timestamp: new Date().toISOString()
  }]
});
```

## Fabric Service Integration

Star Citizen Live extends `@fabric/hub`, making it fully compatible with the Fabric ecosystem.

### Basic Integration

```javascript
const StarCitizen = require('@rsi/star-citizen');

const sc = new StarCitizen({
  authority: 'https://hub.fabric.pub',
  logfile: 'path/to/Game.log',
  http: {
    enable: true,
    port: 3041
  }
});

// Fabric event handlers
sc.on('message', (message) => {
  console.log('Fabric message:', message);
});

sc.on('state', (state) => {
  console.log('State update:', state);
});

await sc.start();
```

### Declarative API Access

The service exposes Fabric-compatible declarative properties:

```javascript
// Access collections via properties
console.log(sc.activities);  // Array<Activity>
console.log(sc.players);     // Array<Player>
console.log(sc.vehicles);    // Array<Vehicle>
console.log(sc.kills);       // Array<Kill>
console.log(sc.logs);        // Array<Log>
console.log(sc.status);      // String
```

### Routes

The service defines RESTful routes following Fabric patterns:

```javascript
sc.routes.forEach(route => {
  console.log(`${route.method} ${route.path}`);
});

// Output:
// GET /services/star-citizen
// POST /services/star-citizen
// GET /services/star-citizen/activities
// POST /services/star-citizen/activities
// ... etc
```

## Sensemaker Integration

Integrate with Sensemaker for full AI and coordination capabilities:

```javascript
const Sensemaker = require('@fabric/sensemaker');

const sensemaker = new Sensemaker({
  // Sensemaker configuration
  authority: 'https://sensemaker.io',

  // Star Citizen configuration
  rsi: {
    enable: true,
    logfile: 'C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log',
    discord: {
      enable: true,
      webhook: process.env.DISCORD_WEBHOOK_URL
    },
    http: {
      enable: false // Let Sensemaker handle HTTP
    }
  }
});

// Event forwarding
sensemaker.on('ready', async () => {
  console.log('Sensemaker ready with Star Citizen integration');

  // Access Star Citizen service
  console.log('RSI Status:', sensemaker.rsi.status);
  console.log('RSI Activities:', sensemaker.rsi.activities.length);
});

// Star Citizen events bubble up to Sensemaker
sensemaker.rsi.on('kill', (kill) => {
  console.log('Kill event in Sensemaker context:', kill);
  // Process with AI, store in database, etc.
});

await sensemaker.start();
```

## Custom Integration

### Event-Driven Integration

Listen to events and integrate with any system:

```javascript
const sc = new StarCitizen(config);

// Activity monitoring
sc.on('activity', async (activity) => {
  // Send to analytics
  await analytics.track('star_citizen_activity', activity);

  // Store in database
  await db.activities.insert(activity);

  // Trigger webhooks
  await webhooks.trigger('activity', activity);
});

// Player tracking
sc.on('player:join', async (player) => {
  // Update player database
  await db.players.upsert(player);

  // Send notification
  await notifications.send(`${player.name} joined`);
});

// Kill feed
sc.on('kill', async (kill) => {
  // Update leaderboard
  await leaderboard.recordKill(kill);

  // Award achievements
  await achievements.check(kill);
});

await sc.start();
```

### Polling Integration

Use the declarative API for polling-based integration:

```javascript
const sc = new StarCitizen(config);
await sc.start();

// Poll every 10 seconds
setInterval(() => {
  const stats = {
    activities: sc.activities.length,
    players: sc.players.length,
    vehicles: sc.vehicles.length,
    kills: sc.kills.length,
    status: sc.status
  };

  // Send to monitoring system
  monitoring.report(stats);
}, 10000);
```

## Event Handling

### Available Events

```javascript
sc.on('activity', (activity) => {
  // Game activity detected
});

sc.on('kill', (kill) => {
  // Kill event occurred
});

sc.on('player:join', (player) => {
  // Player joined the game
});

sc.on('log', (log) => {
  // Raw log entry processed
});

sc.on('ready', () => {
  // Service started successfully
});

sc.on('stopped', () => {
  // Service stopped
});

sc.on('error', (error) => {
  // Error occurred
});

// Fabric events
sc.on('message', (message) => {
  // Fabric message received
});

sc.on('state', (state) => {
  // State changed
});

sc.on('commit', (commit) => {
  // State committed
});
```

### Event Filtering

```javascript
// Filter activities by type
sc.on('activity', (activity) => {
  switch (activity.type) {
    case 'StarCitizenLogEntry':
      // Handle log entries
      break;
    case 'MissionComplete':
      // Handle mission completions
      break;
    case 'CargoDelivery':
      // Handle cargo deliveries
      break;
  }
});

// Filter kills by weapon
sc.on('kill', (kill) => {
  if (kill.weapon === 'Ballistic Cannon') {
    console.log('Ballistic kill!');
  }
});
```

## HTTP API Integration

### Client-Side Integration

```javascript
// Fetch service status
const response = await fetch('http://localhost:3041/services/star-citizen');
const data = await response.json();
console.log(data);
// {
//   type: 'StarCitizen',
//   data: {
//     id: 'service-id',
//     status: 'STARTED',
//     activities: 42,
//     players: 5,
//     vehicles: 3,
//     kills: 8,
//     logs: 100
//   }
// }

// Fetch activities
const activities = await fetch('http://localhost:3041/services/star-citizen/activities');
const activitiesData = await activities.json();
console.log(activitiesData);
// {
//   type: 'Collection',
//   data: [...]
// }

// Create a new kill
await fetch('http://localhost:3041/services/star-citizen/kills', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    killer: 'Player1',
    victim: 'Player2',
    weapon: 'Ballistic Cannon'
  })
});
```

### WebSocket Integration

```javascript
// Connect to Fabric WebSocket
const ws = new WebSocket('ws://localhost:3041');

ws.on('open', () => {
  console.log('Connected to Star Citizen Live');

  // Subscribe to events
  ws.send(JSON.stringify({
    type: 'subscribe',
    channel: 'activities'
  }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data);
  console.log('Received:', message);
});
```

## Advanced Patterns

### Multi-Service Coordination

```javascript
const StarCitizen = require('@rsi/star-citizen');
const Discord = require('@fabric/discord');

// Create services
const sc = new StarCitizen(config);
const discord = new Discord(discordConfig);

// Cross-service event handling
sc.on('kill', async (kill) => {
  // Post to Discord directly
  await discord.postMessage({
    content: `💀 ${kill.killer} eliminated ${kill.victim}!`
  });

  // Or use the built-in Discord integration
  await sc.postToDiscord({
    embeds: [{ title: 'Kill Event', description: `${kill.killer} -> ${kill.victim}` }]
  });
});

await Promise.all([
  sc.start(),
  discord.start()
]);
```

### State Persistence

```javascript
const fs = require('fs');

// Save state periodically
setInterval(() => {
  const state = {
    activities: sc.activities,
    players: sc.players,
    vehicles: sc.vehicles,
    kills: sc.kills
  };

  fs.writeFileSync('./state.json', JSON.stringify(state, null, 2));
}, 60000); // Every minute

// Restore state on startup
const savedState = JSON.parse(fs.readFileSync('./state.json'));
// ... restore logic
```

## Best Practices

1. **Error Handling**: Always listen for error events
2. **Graceful Shutdown**: Properly stop services on process exit
3. **Rate Limiting**: Respect Discord rate limits (webhook: 30 requests/min)
4. **State Management**: Use Fabric's state management patterns
5. **Event Filtering**: Filter events at the source to reduce overhead
6. **Testing**: Use the provided test suite as examples

## Examples

See the `examples/` directory for complete working examples:

- `examples/discord-integration.js` - Full Discord integration
- `examples/declarative-api.js` - Declarative API usage

