'use strict';

// Dependencies
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const { Link } = require('react-router-dom');

// Semantic UI
const {
  Breadcrumb,
  Button,
  Card,
  Grid,
  Header,
  Icon,
  Segment,
  Statistic
} = require('semantic-ui-react');

// Optional Components (will be available when used in Sensemaker)
let ChatBox = null;
try {
  // Try to load ChatBox from Sensemaker when available
  ChatBox = require('../../sensemaker/components/ChatBox');
} catch (e) {
  // ChatBox not available (standalone mode)
  console.debug('[STAR-CITIZEN-HOME]', 'ChatBox component not available');
}

/**
 * Star Citizen service home panel for Sensemaker admin UI.
 * Displays service status, recent activities, and quick stats.
 */
class StarCitizenHome extends React.Component {
  constructor (props) {
    super(props);

    // Settings
    this.settings = Object.assign({
      debug: false,
      starCitizen: {},
      state: {
        starCitizen: {
          activities: [],
          players: [],
          vehicles: [],
          kills: [],
          status: 'UNKNOWN'
        }
      }
    }, props);

    // React State
    this.state = {
      ...this.settings.state
    };

    // Fabric State
    this._state = {
      starCitizen: {
        activities: {},
        players: {},
        vehicles: {},
        kills: {}
      },
      content: this.settings.state
    };

    return this;
  }

  componentDidMount () {
    // Fetch Star Citizen stats periodically
    if (this.props.fetchStarCitizenStats) {
      this.props.fetchStarCitizenStats();
      this.watcher = setInterval(() => {
        this.props.fetchStarCitizenStats();
      }, 30000); // Every 30 seconds
    }
  }

  componentWillUnmount () {
    if (this.watcher) {
      clearInterval(this.watcher);
    }
  }

  render () {
    const { starCitizen } = this.props;
    const sc = starCitizen || {};
    const activities = sc.activities || [];
    const players = sc.players || [];
    const vehicles = sc.vehicles || [];
    const kills = sc.kills || [];
    const status = sc.status || 'UNKNOWN';

    console.debug('[STAR-CITIZEN]', 'Service:', sc);

    return (
      <div>
        <div className='uppercase'>
          <Button onClick={() => { history.back(); }} icon color='black'>
            <Icon name='left chevron' /> Back
          </Button>
          <Breadcrumb style={{ marginLeft: '1em' }}>
            <Breadcrumb.Section>
              <Link to='/services/star-citizen'>Star Citizen</Link>
            </Breadcrumb.Section>
          </Breadcrumb>
        </div>

        <Segment className='fade-in' loading={sc.loading} style={{ maxHeight: '100%' }}>
          <Header as='h1' style={{ marginTop: 0 }}>
            <Icon name='rocket' />Star Citizen Live
          </Header>
          <p>Real-time monitoring and analytics for Star Citizen gameplay.</p>

          {/* Service Status */}
          <Segment>
            <Header as='h3'>Service Status</Header>
            <Statistic size='small'>
              <Statistic.Label>Status</Statistic.Label>
              <Statistic.Value>
                <Icon
                  name={status === 'STARTED' ? 'check circle' : status === 'STOPPED' ? 'stop circle' : 'question circle'}
                  color={status === 'STARTED' ? 'green' : status === 'STOPPED' ? 'red' : 'grey'}
                />
                {status}
              </Statistic.Value>
            </Statistic>
          </Segment>

          {/* Statistics Grid */}
          <Header as='h3'>Statistics</Header>
          <Statistic.Group widths='four' size='small'>
            <Statistic>
              <Statistic.Value>
                <Icon name='game' />
                {activities.length}
              </Statistic.Value>
              <Statistic.Label>Activities</Statistic.Label>
            </Statistic>

            <Statistic>
              <Statistic.Value>
                <Icon name='users' />
                {players.length}
              </Statistic.Value>
              <Statistic.Label>Players</Statistic.Label>
            </Statistic>

            <Statistic>
              <Statistic.Value>
                <Icon name='rocket' />
                {vehicles.length}
              </Statistic.Value>
              <Statistic.Label>Vehicles</Statistic.Label>
            </Statistic>

            <Statistic>
              <Statistic.Value>
                <Icon name='crosshairs' />
                {kills.length}
              </Statistic.Value>
              <Statistic.Label>Kills</Statistic.Label>
            </Statistic>
          </Statistic.Group>
        </Segment>

        {/* Quick Actions */}
        <Header as='h2'>Quick Access</Header>
        <Card.Group>
          <Card as={Link} to='/services/star-citizen/activities'>
            <Card.Content>
              <Card.Header><Icon name='game' />Activities</Card.Header>
              <Card.Description>
                View all game activities and log entries
              </Card.Description>
            </Card.Content>
            <Card.Content extra>
              {activities.length} activities
            </Card.Content>
          </Card>

          <Card as={Link} to='/services/star-citizen/players'>
            <Card.Content>
              <Card.Header><Icon name='users' />Players</Card.Header>
              <Card.Description>
                View known players and their stats
              </Card.Description>
            </Card.Content>
            <Card.Content extra>
              {players.length} players
            </Card.Content>
          </Card>

          <Card as={Link} to='/services/star-citizen/vehicles'>
            <Card.Content>
              <Card.Header><Icon name='rocket' />Vehicles</Card.Header>
              <Card.Description>
                View registered vehicles
              </Card.Description>
            </Card.Content>
            <Card.Content extra>
              {vehicles.length} vehicles
            </Card.Content>
          </Card>

          <Card as={Link} to='/services/star-citizen/kills'>
            <Card.Content>
              <Card.Header><Icon name='crosshairs' />Kill Feed</Card.Header>
              <Card.Description>
                View recent kill events
              </Card.Description>
            </Card.Content>
            <Card.Content extra>
              {kills.length} kills
            </Card.Content>
          </Card>
        </Card.Group>

        {/* Recent Activities */}
        {activities.length > 0 && (
          <>
            <Header as='h2'>Recent Activities</Header>
            <Segment>
              {activities.slice(-5).reverse().map((activity, index) => (
                <div key={activity.id || index} style={{ marginBottom: '1em' }}>
                  <Header as='h4' style={{ marginBottom: '0.5em' }}>
                    <Icon name='game' />
                    {activity.type || 'Activity'}
                  </Header>
                  <p style={{ marginLeft: '2em', fontSize: '0.9em', color: '#666' }}>
                    Target: {activity.target || 'Unknown'}
                  </p>
                </div>
              ))}
            </Segment>
          </>
        )}

        {/* Recent Kills */}
        {kills.length > 0 && (
          <>
            <Header as='h2'>Recent Kills</Header>
            <Segment>
              {kills.slice(-5).reverse().map((kill, index) => (
                <div key={kill.id || index} style={{ marginBottom: '1em' }}>
                  <Icon name='crosshairs' color='red' />
                  <strong>{kill.killer}</strong> eliminated <strong>{kill.victim}</strong>
                  {kill.weapon && <span style={{ color: '#666', marginLeft: '0.5em' }}>({kill.weapon})</span>}
                </div>
              ))}
            </Segment>
          </>
        )}

        {/* Discord Integration Status */}
        {sc.discord && sc.discord.enabled && (
          <Segment>
            <Header as='h3'>
              <Icon name='discord' color='purple' />
              Discord Integration
            </Header>
            <p>
              <Icon name='check circle' color='green' />
              Discord announcements are enabled
            </p>
          </Segment>
        )}

        {/* Chat Box for AI queries (only when available in Sensemaker) */}
        {ChatBox && (
          <ChatBox
            {...this.props}
            context={{ starCitizen: sc }}
            placeholder='Ask about Star Citizen activity...'
          />
        )}
      </div>
    );
  }

  toHTML () {
    return ReactDOMServer.renderToString(this.render());
  }
}

module.exports = StarCitizenHome;

