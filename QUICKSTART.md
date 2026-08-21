# Quick Start Guide
Get Star Citizen Live running with Discord integration in 5 minutes.

> **Current surface** is LiveRelay + a Fabric Peer (`AGENTS.md` §3), not a
> zero-dependency `app/` server. **Contributors and other orgs:**
> [`DEVELOPERS.md`](DEVELOPERS.md). Public seed: [`docs/PRODUCTION.md`](docs/PRODUCTION.md).
> Desktop installer: [`ELECTRON_BUILD.md`](ELECTRON_BUILD.md).

## Prerequisites

- Node.js 24.15.0 or higher
- Star Citizen installed (for log file access)
- Discord server with webhook access (optional, for Discord features)

## Installation

```bash
git clone https://github.com/GoonCitizen/star-citizen-live.git
cd star-citizen-live
npm install
```

## Basic Setup (No Discord)

1. **Configure the service:**

   Create `settings/local.js`:
   ```javascript
   module.exports = {
     logfile: 'C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log',
     http: {
       enable: false
     },
     discord: {
       enable: false
     }
   };
   ```

2. **Start the service:**

   ```bash
   npm start
   ```

3. **Verify it's working:**

   You should see:
   ```
   [STAR-CITIZEN-LIVE] [STATUS] Starting node...
   [STAR-CITIZEN] Starting service...
   [STAR-CITIZEN] Service started
   [STAR-CITIZEN-LIVE] [OUTPUT] Main Process: {"id":"..."}
   [STAR-CITIZEN-LIVE] [STATUS] Listening for logs...
   ```

## Discord Setup (Recommended)

1. **Create a Discord webhook:**

   - Open your Discord server
   - Go to Server Settings → Integrations → Webhooks
   - Click "New Webhook"
   - Name it "Star Citizen Live"
   - Select the channel for announcements
   - Copy the webhook URL

2. **Configure Discord integration:**

   Update `settings/local.js`:
   ```javascript
   module.exports = {
     logfile: 'C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log',
     http: {
       enable: false
     },
     discord: {
       enable: true,
       webhook: 'https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN',
       announceActivities: true,
       announceKills: true,
       announcePlayerJoins: true
     }
   };
   ```

   Or use environment variables:
   ```bash
   export DISCORD_WEBHOOK_URL='your_webhook_url'
   npm start
   ```

3. **Test the integration:**

   ```bash
   node examples/discord-integration.js
   ```

   You should see a test message in your Discord channel!

## Using the Declarative API

```javascript
const StarCitizen = require('@rsi/star-citizen');

// Create instance
const sc = new StarCitizen({
  logfile: 'C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log',
  discord: {
    enable: true,
    webhook: process.env.DISCORD_WEBHOOK_URL
  }
});

// Access declarative properties
sc.on('ready', () => {
  console.log('Activities:', sc.activities.length);
  console.log('Players:', sc.players.length);
  console.log('Kills:', sc.kills.length);
  console.log('Status:', sc.status);
});

// Listen to events
sc.on('activity', (activity) => {
  console.log('New activity:', activity.type);
  console.log('Total activities:', sc.activities.length);
});

sc.on('kill', (kill) => {
  console.log(`${kill.killer} eliminated ${kill.victim}!`);
});

// Start service
await sc.start();
```

## Enable HTTP API

To expose HTTP endpoints:

```javascript
// In settings/local.js
module.exports = {
  // ... other settings
  http: {
    enable: true,
    port: 3041
  }
};
```

Then access endpoints:
```bash
# Get service status
curl http://localhost:3041/services/star-citizen

# Get activities
curl http://localhost:3041/services/star-citizen/activities

# Get kills
curl http://localhost:3041/services/star-citizen/kills
```

## Common Issues

### Log file not found

**Error:** `Could not open log: ENOENT: no such file or directory`

**Solution:** Update the logfile path in your settings:
- Windows: `C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log`
- Check if you have PTU installed: `C:/Program Files/Roberts Space Industries/StarCitizen/PTU/Game.log`

### Discord webhook not working

**Error:** `Error posting to Discord: 404 Not Found`

**Solution:** Verify your webhook URL:
1. Go back to Discord → Server Settings → Integrations → Webhooks
2. Copy the webhook URL again
3. Make sure it includes both the ID and TOKEN parts

### Nothing happening

**Cause:** No game activity to monitor

**Solution:**
1. Launch Star Citizen
2. Play for a bit (enter the game, move around)
3. Check the logs are being written: `tail -f "C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log"`

## Next Steps

- Read the [Integration Guide](INTEGRATION.md) for advanced patterns
- Check the [API Documentation](API.md) for full API reference
- Browse [examples/](examples/) for more code samples
- Run the test suite: `npm test`

## Quick Reference

### Configuration Options

```javascript
{
  logfile: 'path/to/Game.log',          // Star Citizen log file
  authority: 'https://sensemaker.io',    // Authority URL

  http: {
    enable: true,                        // Enable HTTP server
    port: 3041                           // HTTP port
  },

  discord: {
    enable: true,                        // Enable Discord
    webhook: 'YOUR_WEBHOOK_URL',         // Webhook URL
    channel: 'YOUR_CHANNEL_ID',          // Channel ID (optional)
    announceActivities: true,            // Announce activities
    announceKills: true,                 // Announce kills
    announcePlayerJoins: true            // Announce player joins
  }
}
```

### Declarative Properties

```javascript
sc.activities  // Array<Activity>
sc.players     // Array<Player>
sc.vehicles    // Array<Vehicle>
sc.kills       // Array<Kill>
sc.logs        // Array<Log>
sc.status      // String
```

### Events

```javascript
sc.on('activity', (activity) => { ... });
sc.on('kill', (kill) => { ... });
sc.on('player:join', (player) => { ... });
sc.on('ready', () => { ... });
sc.on('error', (error) => { ... });
```

### HTTP Endpoints

```
GET  /services/star-citizen
GET  /services/star-citizen/activities
POST /services/star-citizen/activities
GET  /services/star-citizen/players
POST /services/star-citizen/players
GET  /services/star-citizen/vehicles
GET  /services/star-citizen/kills
POST /services/star-citizen/kills
```

## Support

- 📖 [README](README.md) - Overview and features
- 🔧 [Integration Guide](INTEGRATION.md) - Advanced integration
- 📚 [API Docs](API.md) - Complete API reference
- 💡 [Examples](examples/) - Working code samples
- 🐛 [Issues](https://github.com/GoonCitizen/star-citizen-live/issues) - Bug reports

Happy flying, Citizen! 🚀

