# Components Guide
This document explains the different UI components provided by Star Citizen Live and their intended uses.

> **Lags LiveRelay.** The dashboard that runs is `components/Dashboard.js` (and
> Chat, Groups, Missions, Peers, …) as described in [`AGENTS.md`](AGENTS.md) §3.
> `StarCitizenHome` / `StarCitizenInterface` below are the older Hub/Sensemaker
> shells. Contributors: [`DEVELOPERS.md`](DEVELOPERS.md).

## Overview
Star Citizen Live provides two UI components with different purposes:

1. **StarCitizenHome** - Service panel for Sensemaker integration
2. **StarCitizenInterface** - Standalone full application

## StarCitizenHomes
**Path**: `components/StarCitizenHome.js`
**Purpose**: Sensemaker service panel component
**Use When**:
- Integrating into Sensemaker's admin dashboard
- Embedding as a service panel in another application
- You want the component to inherit authentication and routing from parent
**Features**:
- Service status display
- Statistics overview
- Recent activities and kills
- Quick access cards to detail views
- Optional ChatBox integration for AI queries
- Uses parent application's routing
- Inherits parent authentication
**Usage**:
```javascript
// In Sensemaker Dashboard
const StarCitizenHome = require('@rsi/star-citizen/components/StarCitizenHome');

<Route
  path='/services/star-citizen'
  element={
    <StarCitizenHome
      {...props}
      starCitizen={props.starCitizen}
      fetchStarCitizenStats={props.fetchStarCitizenStats}
    />
  }
/>
```

**Props**:
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| starCitizen | Object | Yes | Service data object with activities, players, vehicles, kills, status |
| fetchStarCitizenStats | Function | Yes | Function to fetch service stats |
| ...rest | Any | No | All other props passed through to child components |

**StarCitizen Prop Shape**:
```typescript
{
  loading: boolean;
  status: string;
  activities: Array<Activity>;
  players: Array<Player>;
  vehicles: Array<Vehicle>;
  kills: Array<Kill>;
  discord: {
    enabled: boolean;
  }
}
```

**Example with Mock Data**:
```javascript
const mockData = {
  loading: false,
  status: 'STARTED',
  activities: [
    {
      id: 'activity-1',
      type: 'StarCitizenLogEntry',
      target: '/logs',
      timestamp: '2024-12-05T00:00:00Z'
    }
  ],
  players: [
    {
      id: 'player-1',
      name: 'TestPilot',
      timestamp: '2024-12-05T00:00:00Z'
    }
  ],
  vehicles: [],
  kills: [],
  discord: {
    enabled: true
  }
};

<StarCitizenHome
  starCitizen={mockData}
  fetchStarCitizenStats={() => console.log('Fetching stats')}
/>
```

## StarCitizenInterface
**Path**: `components/Interface.js`
**Purpose**: Standalone full application interface
**Use When**:
- Deploying Star Citizen Live as a standalone web application
- You need a complete UI with authentication system
- Running independently without a parent application
- You want a full-featured Hub-style interface
**Features**:
- Complete authentication system (login, register, logout)
- IndexedDB session management
- Full React Router setup
- Splash screen
- Dashboard component
- Terms of use modal
- Complete application lifecycle

**Usage**:
```javascript
// As standalone application
const StarCitizenInterface = require('@rsi/star-citizen/components/Interface');
const store = createStore(rootReducer, applyMiddleware(thunk));

ReactDOM.render(
  <Provider store={store}>
    <StarCitizenInterface
      auth={auth}
      login={loginAction}
      register={registerAction}
      logout={logoutAction}
      // ... all required props
    />
  </Provider>,
  document.getElementById('root')
);
```

**Props**:
Requires extensive props for authentication, routing, and data management. See the full component for details.

**Note**: This component is **NOT recommended** for embedding in other applications. It's designed to be the root component of a standalone application.

## Comparison
| Feature | StarCitizenHome | StarCitizenInterface |
|---------|-----------------|---------------------|
| Authentication | Inherited from parent | Built-in complete system |
| Routing | Uses parent's routes | Complete React Router |
| Session Management | Parent handles | IndexedDB built-in |
| Complexity | Simple panel | Full application |
| Use Case | Service panel | Standalone app |
| Integration | Easy to embed | Difficult to embed |
| Dependencies | Parent app | Self-contained |
| Recommended For | Sensemaker | Independent deployment |

## Creating Additional Components
You may want to create additional detail view components for specific resources:

### StarCitizenActivities
Display a paginated list of all activities with filtering:

```javascript
// components/StarCitizenActivities.js
class StarCitizenActivities extends React.Component {
  render() {
    const { activities } = this.props.starCitizen;
    return (
      <div>
        <Header>Activities</Header>
        <Table>
          {activities.map(activity => (
            <Table.Row key={activity.id}>
              <Table.Cell>{activity.type}</Table.Cell>
              <Table.Cell>{activity.target}</Table.Cell>
            </Table.Row>
          ))}
        </Table>
      </div>
    );
  }
}
```

### StarCitizenPlayers
Display player list with stats:

```javascript
// components/StarCitizenPlayers.js
class StarCitizenPlayers extends React.Component {
  render() {
    const { players } = this.props.starCitizen;
    return (
      <div>
        <Header>Players</Header>
        <Card.Group>
          {players.map(player => (
            <Card key={player.id}>
              <Card.Content>
                <Card.Header>{player.name}</Card.Header>
              </Card.Content>
            </Card>
          ))}
        </Card.Group>
      </div>
    );
  }
}
```

### StarCitizenKills
Display kill feed with filtering:

```javascript
// components/StarCitizenKills.js
class StarCitizenKills extends React.Component {
  render() {
    const { kills } = this.props.starCitizen;
    return (
      <div>
        <Header>Kill Feed</Header>
        <Feed>
          {kills.map(kill => (
            <Feed.Event key={kill.id}>
              <Feed.Content>
                <Feed.Summary>
                  {kill.killer} eliminated {kill.victim}
                  {kill.weapon && ` with ${kill.weapon}`}
                </Feed.Summary>
              </Feed.Content>
            </Feed.Event>
          ))}
        </Feed>
      </div>
    );
  }
}
```

## Component Architecture
```
StarCitizenHome (Service Panel)
├── Service Status Display
├── Statistics Grid
├── Quick Access Cards
│   ├── Activities Card → /services/star-citizen/activities
│   ├── Players Card → /services/star-citizen/players
│   ├── Vehicles Card → /services/star-citizen/vehicles
│   └── Kills Card → /services/star-citizen/kills
├── Recent Activities Feed
├── Recent Kills Feed
├── Discord Status Indicator
└── ChatBox (optional)

StarCitizenInterface (Standalone App)
├── Authentication System
│   ├── Splash Screen
│   ├── Login Form
│   └── Register Form
├── Main Dashboard
│   ├── Navigation
│   ├── Content Area
│   └── Sidebar
├── Terms of Use Modal
├── Logout Modal
└── Complete Routing System
```

## Best Practices
### For Sensemaker Integration
1. **Always use StarCitizenHome**, not Interface
2. Pass fresh data via props from Redux store
3. Implement fetchStarCitizenStats in your Redux actions
4. Handle loading and error states in parent
5. Follow Sensemaker's routing patterns
6. Use Link components for navigation
7. Maintain consistent styling with other service panels

### For Standalone Deployment
1. Use StarCitizenInterface as root component
2. Set up complete Redux store
3. Implement all authentication actions
4. Configure routing properly
5. Handle session management
6. Provide all required props

## Testing Components
### Testing StarCitizenHome
```javascript
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import StarCitizenHome from './StarCitizenHome';

test('renders service status', () => {
  const mockData = {
    status: 'STARTED',
    activities: [],
    players: [],
    vehicles: [],
    kills: []
  };

  render(
    <BrowserRouter>
      <StarCitizenHome
        starCitizen={mockData}
        fetchStarCitizenStats={jest.fn()}
      />
    </BrowserRouter>
  );

  expect(screen.getByText('STARTED')).toBeInTheDocument();
});
```

### Testing StarCitizenInterface
```javascript
import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import configureStore from 'redux-mock-store';
import StarCitizenInterface from './Interface';

const mockStore = configureStore([]);

test('renders splash when not authenticated', () => {
  const store = mockStore({
    auth: { isAuthenticated: false }
  });

  render(
    <Provider store={store}>
      <StarCitizenInterface auth={{ isAuthenticated: false }} />
    </Provider>
  );

  // Test splash screen renders
});
```

## Summary
- **Use StarCitizenHome** for Sensemaker and embedded scenarios
- **Use StarCitizenInterface** for standalone deployment only
- Create additional detail components as needed
- Follow existing patterns from Discord/Bitcoin services
- Test components with appropriate mock data

