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
  Label,
  Segment,
  Tab,
  Table
} = require('semantic-ui-react');

/**
 * Mission home panel for Sensemaker admin UI.
 * Displays available missions and allows users to submit applications.
 */
class MissionHome extends React.Component {
  constructor (props) {
    super(props);

    this.state = {
      selectedMission: null,
      showApplicationForm: false
    };

    return this;
  }

  componentDidMount () {
    if (this.props.fetchMissions) {
      this.props.fetchMissions();
    }
  }

  getMissionStatusColor (status) {
    const colors = {
      open: 'green',
      assigned: 'blue',
      completed: 'grey',
      failed: 'red'
    };
    return colors[status] || 'grey';
  }

  getMissionTypeIcon (type) {
    const icons = {
      bounty: 'crosshairs',
      cargo: 'box',
      exploration: 'compass',
      escort: 'shield',
      mining: 'gem',
      salvage: 'wrench',
      generic: 'tasks'
    };
    return icons[type] || 'tasks';
  }

  renderMissionCard (mission) {
    return (
      <Card key={mission.id} as={Link} to={`/services/star-citizen/missions/${mission.id}`}>
        <Card.Content>
          <Card.Header>
            <Icon name={this.getMissionTypeIcon(mission.type)} />
            {mission.title}
          </Card.Header>
          <Card.Meta>
            <Label color={this.getMissionStatusColor(mission.status)} size='tiny'>
              {mission.status}
            </Label>
            {mission.contract.type === 'multisig' && (
              <Label size='tiny' color='purple'>
                <Icon name='users' /> Multisig
              </Label>
            )}
          </Card.Meta>
          <Card.Description>
            {mission.description}
          </Card.Description>
        </Card.Content>
        <Card.Content extra>
          <Icon name='money' />
          {mission.reward.toLocaleString()} UEC
          {mission.location && mission.location.system && (
            <>
              <br />
              <Icon name='map marker alternate' />
              {mission.location.system}
            </>
          )}
        </Card.Content>
        {mission.isOpen && (
          <Card.Content extra>
            <Button primary size='small' fluid>
              <Icon name='pencil' /> Apply
            </Button>
          </Card.Content>
        )}
      </Card>
    );
  }

  renderOpenMissions () {
    const { missions } = this.props;
    const openMissions = (missions || []).filter(m => m.status === 'open' && !m.isExpired);

    if (openMissions.length === 0) {
      return (
        <Segment placeholder>
          <Header icon>
            <Icon name='search' />
            No open missions available
          </Header>
        </Segment>
      );
    }

    return (
      <Card.Group>
        {openMissions.map(mission => this.renderMissionCard(mission))}
      </Card.Group>
    );
  }

  renderAssignedMissions () {
    const { missions } = this.props;
    const assignedMissions = (missions || []).filter(m => m.status === 'assigned');

    if (assignedMissions.length === 0) {
      return <p>No assigned missions</p>;
    }

    return (
      <Card.Group>
        {assignedMissions.map(mission => this.renderMissionCard(mission))}
      </Card.Group>
    );
  }

  renderCompletedMissions () {
    const { missions } = this.props;
    const completedMissions = (missions || []).filter(m => m.status === 'completed');

    if (completedMissions.length === 0) {
      return <p>No completed missions</p>;
    }

    return (
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Mission</Table.HeaderCell>
            <Table.HeaderCell>Type</Table.HeaderCell>
            <Table.HeaderCell>Reward</Table.HeaderCell>
            <Table.HeaderCell>Completed</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {completedMissions.map(mission => (
            <Table.Row key={mission.id}>
              <Table.Cell>
                <Link to={`/services/star-citizen/missions/${mission.id}`}>
                  {mission.title}
                </Link>
              </Table.Cell>
              <Table.Cell>
                <Icon name={this.getMissionTypeIcon(mission.type)} />
                {mission.type}
              </Table.Cell>
              <Table.Cell>{mission.reward.toLocaleString()} UEC</Table.Cell>
              <Table.Cell>
                {mission.completedAt && new Date(mission.completedAt).toLocaleDateString()}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    );
  }

  render () {
    const { missions, loading } = this.props;
    const missionCount = (missions || []).length;
    const openCount = (missions || []).filter(m => m.status === 'open').length;
    const assignedCount = (missions || []).filter(m => m.status === 'assigned').length;
    const completedCount = (missions || []).filter(m => m.status === 'completed').length;

    const panes = [
      {
        menuItem: { key: 'open', icon: 'tasks', content: `Open (${openCount})` },
        render: () => (
          <Tab.Pane loading={loading}>
            {this.renderOpenMissions()}
          </Tab.Pane>
        )
      },
      {
        menuItem: { key: 'assigned', icon: 'user', content: `Assigned (${assignedCount})` },
        render: () => (
          <Tab.Pane loading={loading}>
            {this.renderAssignedMissions()}
          </Tab.Pane>
        )
      },
      {
        menuItem: { key: 'completed', icon: 'check', content: `Completed (${completedCount})` },
        render: () => (
          <Tab.Pane loading={loading}>
            {this.renderCompletedMissions()}
          </Tab.Pane>
        )
      }
    ];

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
            <Breadcrumb.Divider />
            <Breadcrumb.Section active>Missions</Breadcrumb.Section>
          </Breadcrumb>
        </div>

        <Segment className='fade-in'>
          <Header as='h1' style={{ marginTop: 0 }}>
            <Icon name='tasks' />Missions
          </Header>
          <p>Browse available missions and submit applications with secp256k1 or Musig2 signatures.</p>

          <Grid columns={4} stackable>
            <Grid.Column>
              <Segment textAlign='center'>
                <Header as='h3'>{missionCount}</Header>
                <p>Total Missions</p>
              </Segment>
            </Grid.Column>
            <Grid.Column>
              <Segment textAlign='center' color='green'>
                <Header as='h3'>{openCount}</Header>
                <p>Open</p>
              </Segment>
            </Grid.Column>
            <Grid.Column>
              <Segment textAlign='center' color='blue'>
                <Header as='h3'>{assignedCount}</Header>
                <p>Assigned</p>
              </Segment>
            </Grid.Column>
            <Grid.Column>
              <Segment textAlign='center' color='grey'>
                <Header as='h3'>{completedCount}</Header>
                <p>Completed</p>
              </Segment>
            </Grid.Column>
          </Grid>
        </Segment>

        <Tab panes={panes} />

        <Segment>
          <Header as='h3'>Contract Types</Header>
          <Grid columns={2} stackable>
            <Grid.Column>
              <Segment>
                <Header as='h4'>
                  <Icon name='key' />
                  Single Signature (secp256k1)
                </Header>
                <p>
                  Individual missions requiring a single ephemeral contract key signature.
                  Players sign with their secp256k1 private key to accept the mission.
                </p>
              </Segment>
            </Grid.Column>
            <Grid.Column>
              <Segment>
                <Header as='h4'>
                  <Icon name='users' color='purple' />
                  Multisig (Musig2)
                </Header>
                <p>
                  Team missions requiring multiple signatures using Musig2 protocol.
                  Allows cooperative acceptance and completion of high-stakes missions.
                </p>
              </Segment>
            </Grid.Column>
          </Grid>
        </Segment>
      </div>
    );
  }

  toHTML () {
    return ReactDOMServer.renderToString(this.render());
  }
}

module.exports = MissionHome;

