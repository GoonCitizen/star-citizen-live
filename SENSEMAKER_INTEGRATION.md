# Sensemaker Integration Guide
This guide explains how to integrate Star Citizen Live into the Sensemaker admin UI.

## Overview

The Star Citizen Live service can be integrated into Sensemaker's admin dashboard, providing real-time monitoring and analytics for Star Citizen gameplay directly within the Sensemaker interface.

## Components

### StarCitizenHome Component

The `components/StarCitizenHome.js` component is designed specifically for Sensemaker integration. It's a **service panel** that:

- Displays service status and statistics
- Shows recent activities and kills
- Provides quick access to detailed views
- Integrates with Sensemaker's ChatBox for AI queries
- Uses Sensemaker's routing (no standalone routing)
- Inherits authentication from parent Sensemaker app

### StarCitizenInterface Component

The `components/Interface.js` component is a **standalone application** that:

- Has its own complete UI with authentication
- Includes full routing, splash screens, dashboard
- Is designed for independent deployment
- **Cannot be directly embedded** in Sensemaker

**Note**: Use `StarCitizenHome` for Sensemaker integration, not `Interface`.

## Integration Steps

### 1. Install the Package

In your Sensemaker project:

```bash
npm install @rsi/star-citizen
# or
npm install FabricLabs/star-citizen-live
```

### 2. Initialize the Service

In `services/sensemaker.js`:

```javascript
const StarCitizen = require('@rsi/star-citizen');

class Sensemaker extends Hub {
  constructor (settings = {}) {
    super(settings);

    // ... other services ...

    // Initialize Star Citizen service
    if (this.settings.starCitizen && this.settings.starCitizen.enable) {
      this.starCitizen = new StarCitizen(this.settings.starCitizen);
    }
  }

  async start () {
    // ... other startup code ...

    // Start Star Citizen service
    if (this.starCitizen) {
      try {
        await this.starCitizen.start();
      } catch (exception) {
        console.error('[SENSEMAKER]', '[STAR-CITIZEN]', 'Error starting:', exception);
      }
    }
  }

  async stop () {
    // Stop Star Citizen service
    if (this.starCitizen) {
      await this.starCitizen.stop();
    }

    // ... other cleanup ...
  }
}
```

### 3. Add Configuration

In `settings/local.js`:

```javascript
module.exports = {
  // ... other settings ...

  starCitizen: {
    enable: true,
    logfile: 'C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log',
    http: {
      enable: false // Sensemaker handles HTTP
    },
    discord: {
      enable: true,
      webhook: process.env.STAR_CITIZEN_DISCORD_WEBHOOK,
      announceActivities: true,
      announceKills: true,
      announcePlayerJoins: true
    }
  }
};
```

### 4. Add Redux Actions

Create `actions/starCitizenActions.js`:

```javascript
export const FETCH_STAR_CITIZEN_STATS_REQUEST = 'FETCH_STAR_CITIZEN_STATS_REQUEST';
export const FETCH_STAR_CITIZEN_STATS_SUCCESS = 'FETCH_STAR_CITIZEN_STATS_SUCCESS';
export const FETCH_STAR_CITIZEN_STATS_FAILURE = 'FETCH_STAR_CITIZEN_STATS_FAILURE';

export const fetchStarCitizenStats = () => async (dispatch) => {
  dispatch({ type: FETCH_STAR_CITIZEN_STATS_REQUEST });

  try {
    const response = await fetch('/services/star-citizen');
    const data = await response.json();

    dispatch({
      type: FETCH_STAR_CITIZEN_STATS_SUCCESS,
      payload: data.data
    });
  } catch (error) {
    dispatch({
      type: FETCH_STAR_CITIZEN_STATS_FAILURE,
      error: error.message
    });
  }
};

export const fetchStarCitizenActivities = () => async (dispatch) => {
  // Similar pattern for activities
};

export const fetchStarCitizenPlayers = () => async (dispatch) => {
  // Similar pattern for players
};
```

### 5. Add Redux Reducer

Create `reducers/starCitizenReducer.js`:

```javascript
import {
  FETCH_STAR_CITIZEN_STATS_REQUEST,
  FETCH_STAR_CITIZEN_STATS_SUCCESS,
  FETCH_STAR_CITIZEN_STATS_FAILURE
} from '../actions/starCitizenActions';

const initialState = {
  loading: false,
  error: null,
  status: 'UNKNOWN',
  activities: [],
  players: [],
  vehicles: [],
  kills: [],
  discord: {
    enabled: false
  }
};

export default function starCitizenReducer(state = initialState, action) {
  switch (action.type) {
    case FETCH_STAR_CITIZEN_STATS_REQUEST:
      return { ...state, loading: true, error: null };

    case FETCH_STAR_CITIZEN_STATS_SUCCESS:
      return {
        ...state,
        loading: false,
        ...action.payload
      };

    case FETCH_STAR_CITIZEN_STATS_FAILURE:
      return { ...state, loading: false, error: action.error };

    default:
      return state;
  }
}
```

### 6. Import UI Components

In `components/Dashboard.js`:

```javascript
// Add to imports
const StarCitizenHome = require('@rsi/star-citizen/components/StarCitizenHome');

// Or if using relative path:
// const StarCitizenHome = require('../../node_modules/@rsi/star-citizen/components/StarCitizenHome');
```

### 7. Add Routes

In `components/Dashboard.js`, add routes in the render method:

```javascript
<Route
  path='/services/star-citizen'
  element={
    <StarCitizenHome
      {...this.props}
      starCitizen={this.props.starCitizen}
      fetchStarCitizenStats={this.props.fetchStarCitizenStats}
    />
  }
/>
<Route
  path='/services/star-citizen/activities'
  element={
    <StarCitizenActivities
      {...this.props}
      starCitizen={this.props.starCitizen}
    />
  }
/>
<Route
  path='/services/star-citizen/players'
  element={
    <StarCitizenPlayers
      {...this.props}
      starCitizen={this.props.starCitizen}
    />
  }
/>
<Route
  path='/services/star-citizen/kills'
  element={
    <StarCitizenKills
      {...this.props}
      starCitizen={this.props.starCitizen}
    />
  }
/>
```

### 8. Add to Navigation

In your navigation menu component, add a link:

```javascript
<Menu.Item
  as={Link}
  to='/services/star-citizen'
  active={location.pathname.startsWith('/services/star-citizen')}
>
  <Icon name='rocket' />
  Star Citizen
</Menu.Item>
```

## Server-Side Routes

Add routes in `routes/index.js`:

```javascript
// Star Citizen proxy routes
app.get('/services/star-citizen', async (req, res) => {
  if (!req.app.locals.sensemaker.starCitizen) {
    return res.status(503).json({ error: 'Star Citizen service not available' });
  }

  const sc = req.app.locals.sensemaker.starCitizen;
  res.json({
    type: 'StarCitizen',
    data: {
      id: sc.id,
      status: sc.status,
      activities: sc.activities.length,
      players: sc.players.length,
      vehicles: sc.vehicles.length,
      kills: sc.kills.length,
      discord: {
        enabled: sc.settings.discord.enable
      }
    }
  });
});

app.get('/services/star-citizen/activities', async (req, res) => {
  const sc = req.app.locals.sensemaker.starCitizen;
  res.json({
    type: 'Collection',
    data: sc.activities
  });
});

// Similar routes for players, vehicles, kills, etc.
```

## Features Available in Sensemaker

Once integrated, users can:

1. **View Service Status** - Real-time status of the Star Citizen monitoring service
2. **Monitor Activities** - See all game activities and log entries
3. **Track Players** - View known players and their participation
4. **Vehicle Registry** - Access vehicle information
5. **Kill Feed** - Review combat events and kills
6. **AI Queries** - Ask questions about Star Citizen data using Sensemaker's ChatBox
7. **Discord Integration** - Automatic announcements to Discord channels

## Example: Full Integration

Here's a complete example of the service panel in Sensemaker's Dashboard:

```
┌─────────────────────────────────────────────┐
│  ← Back   Star Citizen                      │
├─────────────────────────────────────────────┤
│  🚀 Star Citizen Live                       │
│  Real-time monitoring and analytics         │
│                                             │
│  Service Status                             │
│  ✓ STARTED                                  │
│                                             │
│  Statistics                                 │
│  ┌────────┬────────┬────────┬──────────┐   │
│  │   42   │   5    │   3    │    8     │   │
│  │Activity│Players │Vehicles│  Kills   │   │
│  └────────┴────────┴────────┴──────────┘   │
│                                             │
│  Quick Access                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │Activities│ │ Players  │ │ Vehicles │   │
│  │ View all │ │View known│ │View ships│   │
│  │ 42 total │ │ 5 total  │ │ 3 total  │   │
│  └──────────┘ └──────────┘ └──────────┘   │
│                                             │
│  Recent Activities                          │
│  🎮 StarCitizenLogEntry                     │
│     Target: /logs                           │
│  🎮 MissionComplete                         │
│     Target: /missions                       │
│                                             │
│  💬 Ask about Star Citizen activity...      │
└─────────────────────────────────────────────┘
```

## Declarative API Access

The service exposes declarative properties that can be accessed from Sensemaker:

```javascript
// In your Sensemaker route handlers or components
const sc = req.app.locals.sensemaker.starCitizen;

// Access data via declarative properties
const activities = sc.activities;  // Array
const players = sc.players;        // Array
const vehicles = sc.vehicles;      // Array
const kills = sc.kills;            // Array
const status = sc.status;          // String
```

## Event Integration

Listen to Star Citizen events in Sensemaker:

```javascript
// In Sensemaker service initialization
this.starCitizen.on('activity', (activity) => {
  // Process activity in Sensemaker
  this.processStarCitizenActivity(activity);
});

this.starCitizen.on('kill', (kill) => {
  // Handle kill events
  this.announceKill(kill);
});

this.starCitizen.on('player:join', (player) => {
  // Track player joins
  this.trackPlayer(player);
});
```

## Testing

Test the integration:

```bash
# Start Sensemaker with Star Citizen enabled
STAR_CITIZEN_DISCORD_WEBHOOK=your_webhook npm start

# Navigate to http://localhost:3000/services/star-citizen
```

## Troubleshooting

### Service Not Showing

1. Verify the service is enabled in settings
2. Check that the service started successfully in logs
3. Ensure routes are properly added to Dashboard

### No Data Displaying

1. Verify Star Citizen game log file exists and is accessible
2. Check service status is 'STARTED'
3. Play Star Citizen to generate log entries

### ChatBox Not Working

1. Ensure ChatBox component is imported correctly
2. Verify props are passed correctly to StarCitizenHome
3. Check that the service prop contains data

## Additional Components

You may want to create additional detail views:

- `StarCitizenActivities.js` - Detailed activity list
- `StarCitizenPlayers.js` - Player details and stats
- `StarCitizenVehicles.js` - Vehicle registry
- `StarCitizenKills.js` - Kill feed with filtering

Follow the pattern used in `DiscordHome`, `DiscordGuild`, etc. for consistency.

## Summary

The **StarCitizenHome** component is the proper way to integrate Star Citizen Live into Sensemaker's admin UI. It:

- Follows Sensemaker's service panel pattern
- Uses declarative API to access live data
- Integrates with Sensemaker's routing and authentication
- Provides a clean, consistent user experience
- Supports AI queries through ChatBox integration

The **StarCitizenInterface** component, on the other hand, is a standalone application and should not be used for Sensemaker integration.

