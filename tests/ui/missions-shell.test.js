'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findByClass, findType } = require('../helpers/reactTree');
const Dashboard = require('../../components/Dashboard');
const Missions = require('../../components/Missions');

describe('Missions register UI', () => {
  it('renders the empty register and create toggle', () => {
    const page = new Missions({ identityPubkey: '02aa' });
    page.state.loading = false;
    page.state.missions = [];
    const tree = page.render();
    assert.ok(findByClass(tree, 'mi-wrap').length >= 1);
    assert.ok(textOf(tree).includes('Mission register'));
    assert.ok(textOf(tree).includes('No missions yet'));
    assert.ok(textOf(tree).includes('+ New mission'));
    assert.ok(textOf(tree).includes('My missions (0)'));
    assert.ok(textOf(tree).includes('Top pilots'));
    assert.ok(textOf(tree).includes('Loading activity'));
    assert.ok(findByClass(tree, 'mi-outcomes').length >= 1);
    assert.ok(findByClass(tree, 'mi-pilots').length >= 1);
  });

  it('lists top pilots from Game.log analytics', () => {
    const page = new Missions({
      identityPubkey: '02aa',
      analytics: {
        missions: [
          { player: 'Neorion', outcome: 'Complete', type: 'Bounty' },
          { player: 'Neorion', outcome: 'Complete', type: 'Bounty' },
          { player: 'Neorion', outcome: 'Fail', type: 'Bounty' },
          { player: 'WATCHMAN', outcome: 'Abandon', type: 'Delivery' }
        ],
        deaths: [{ player: 'WATCHMAN' }]
      }
    });
    page.state.loading = false;
    page.state.missions = [];
    const tree = page.render();
    const text = textOf(tree);
    assert.ok(findByClass(tree, 'mi-outcomes').length >= 1);
    assert.ok(findByClass(tree, 'mi-pilots').length >= 1);
    assert.ok(text.includes('Top pilots'));
    assert.ok(text.includes('Neorion'));
    assert.ok(text.includes('WATCHMAN'));
    assert.ok(text.includes('67%') || text.includes('67'));
  });

  it('shows the create form when toggled', () => {
    const page = new Missions({});
    page.state.loading = false;
    page.state.showCreate = true;
    page.state.title = 'Escort the Hull-C';
    const tree = page.render();
    assert.ok(textOf(tree).includes('Bitcoin reward'));
    assert.ok(textOf(tree).includes('Create mission'));
    assert.ok(textOf(tree).includes('Escort the Hull-C'));
  });

  it('caps the register list so thousands of Game.log rows do not paint at once', () => {
    const page = new Missions({ identityPubkey: '02aa' });
    page.state.loading = false;
    page.state.missions = [];
    for (let i = 0; i < 210; i++) {
      page.state.missions.push({
        id: 'm' + i,
        title: 'Log mission ' + i,
        status: 'completed',
        source: 'gamelog',
        createdBy: '02aa'
      });
    }
    const text = textOf(page.render());
    assert.ok(text.includes('Showing 200 of 210'));
    assert.ok(text.includes('From log (210)'));
  });

  it('Dashboard Missions tab mounts the Missions view', () => {
    const dash = new Dashboard({});
    dash.state.tab = 'missions';
    const tree = dash.render();
    assert.ok(findType(tree, Missions).length >= 1);
  });

  it('mission page shows submit and approver review for the creator', () => {
    const me = '02aa'.padEnd(66, 'a');
    const MissionPage = require('../../components/MissionPage');
    const page = new MissionPage({ identityPubkey: me, missionId: 'm1' });
    page.state.loading = false;
    page.state.pubkey = me;
    page.state.mission = {
      id: 'm1',
      title: 'Escort the Hull-C',
      status: 'open',
      createdBy: me,
      authorities: { keys: [me], threshold: 1 },
      participantIds: []
    };
    page.state.applications = [];
    page.state.claims = [];
    let text = textOf(page.render());
    assert.ok(text.includes('✔ Submit completion'));

    page.state.claims = [{
      id: 'c1',
      missionId: 'm1',
      claimantId: me,
      note: 'cargo delivered',
      status: 'pending'
    }];
    text = textOf(page.render());
    assert.ok(text.includes('Review completions'));
    assert.ok(text.includes('cargo delivered'));
    assert.ok(text.includes('Approve'));
    assert.ok(text.includes('Reject'));
  });
});
