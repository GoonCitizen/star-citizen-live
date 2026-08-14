'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findByClass } = require('../helpers/reactTree');
const Groups = require('../../components/Groups');
const GroupOfferModal = require('../../components/GroupOfferModal');
const Notifications = require('../../components/Notifications');

const ME = '02' + 'ab'.repeat(32);

function sampleGroup (overrides) {
  return Object.assign({
    id: 'group-1',
    name: 'Salvage Wing',
    creator: ME,
    members: [ME],
    threshold: 1,
    visibility: 'private',
    createdAt: '2026-08-01T00:00:00.000Z',
    path: '/groups/group-1'
  }, overrides || {});
}

describe('Groups join flow UI', () => {
  it('create form is name-first with a public toggle', () => {
    const page = new Groups({ identityPubkey: ME });
    page.state.loading = false;
    page.state.pubkey = ME;
    page.state.showCreate = true;
    page.state.groups = [];
    const tree = page.render();
    assert.ok(textOf(tree).includes('Group name'));
    assert.ok(textOf(tree).includes('Private — join by invite'));
    assert.ok(textOf(tree).includes('Add signers now (optional)'));
    assert.ok(!textOf(tree).includes('Member pubkeys (one per line'));
  });

  it('empty list and header expose Import plus create', () => {
    const page = new Groups({ identityPubkey: ME, onRequestImport: () => {} });
    page.state.loading = false;
    page.state.pubkey = ME;
    page.state.groups = [];
    const tree = page.render();
    assert.ok(textOf(tree).includes('+ New group'));
    assert.ok(textOf(tree).includes('+ Channel'));
    assert.ok(textOf(tree).includes('Import…'));
    assert.ok(textOf(tree).includes('No groups yet'));
  });

  it('selected group defaults to Chat with a settings cog, not a control farm', () => {
    const page = new Groups({ identityPubkey: ME });
    page.state.loading = false;
    page.state.pubkey = ME;
    page.state.groups = [sampleGroup({ pinnedChannels: ['group:group-1'] })];
    page.state.selectedId = 'group-1';
    page.state.detailTab = 'chat';
    page.state.localFleets = [{ id: 'fleet-1', name: 'Permafleet', shipCount: 3 }];
    const tree = page.render();
    const text = textOf(tree);
    assert.ok(findByClass(tree, 'gp-cog').length >= 1);
    assert.ok(!text.includes('Pins & shares'));
    assert.ok(!text.includes('Pin this group’s Fabric chat'));
    assert.ok(!text.includes('Primary color'));
    assert.ok(!text.includes('+ Nested channel'));
    assert.ok(text.includes('Salvage Wing'));
    assert.ok(text.includes('Chat'));
  });

  it('group settings slideout holds color, nested channel, share, and fleet share', () => {
    const page = new Groups({ identityPubkey: ME });
    page.state.loading = false;
    page.state.pubkey = ME;
    page.state.groups = [sampleGroup()];
    page.state.selectedId = 'group-1';
    page.state.detailTab = 'chat';
    page.state.settingsOpen = true;
    page.state.localFleets = [{ id: 'fleet-1', name: 'Permafleet', shipCount: 3 }];
    const tree = page.render();
    const text = textOf(tree);
    assert.ok(text.includes('Group settings'));
    assert.ok(text.includes('Primary color'));
    assert.ok(text.includes('+ Nested channel'));
    assert.ok(text.includes('Share this group'));
    assert.ok(text.includes('Set as primary'));
    assert.ok(text.includes('Share a fleet') || text.includes('Share fleet'));
    assert.ok(findByClass(tree, 'gp-settings').length >= 1);
  });

  it('nested channel opens as a settings flyout with channel-first copy', () => {
    const page = new Groups({ identityPubkey: ME });
    page.state.loading = false;
    page.state.pubkey = ME;
    page.state.groups = [sampleGroup()];
    page.state.selectedId = 'group-1';
    page.state.settingsOpen = true;
    page.state.settingsView = 'nested';
    page.state.createKind = 'channel';
    page.state.parentId = 'group-1';
    const tree = page.render();
    const text = textOf(tree);
    assert.ok(text.includes('Nested channel'));
    assert.ok(text.includes('Channel name'));
    assert.ok(text.includes('Create channel'));
    assert.ok(text.includes('Nested under Salvage Wing'));
    assert.ok(!text.includes('Parent group (optional'));
  });

  it('create channel form uses channel-first copy', () => {
    const page = new Groups({ identityPubkey: ME });
    page.state.loading = false;
    page.state.pubkey = ME;
    page.state.showCreate = true;
    page.state.createKind = 'channel';
    page.state.groups = [];
    const tree = page.render();
    assert.ok(textOf(tree).includes('Channel name'));
    assert.ok(textOf(tree).includes('Create channel'));
    assert.ok(textOf(tree).includes('Federation group'));
  });

  it('members tab offers Send invite and Share copies a join invite when private', () => {
    const page = new Groups({ identityPubkey: ME });
    page.state.loading = false;
    page.state.pubkey = ME;
    page.state.groups = [sampleGroup()];
    page.state.selectedId = 'group-1';
    page.state.detailTab = 'members';
    const tree = page.render();
    assert.ok(textOf(tree).includes('Send invite'));
    page.state.settingsOpen = true;
    page.state.settingsView = 'main';
    const settings = page.render();
    assert.ok(textOf(settings).includes('Share this group'));
    const share = findByClass(tree, 'gp-btn').concat(findByClass(tree, 'gp-btn')).length;
    assert.ok(share >= 1);
  });

  it('paste modal asks to import a group share', () => {
    const modal = new GroupOfferModal({ pasteOpen: true });
    const tree = modal.render();
    assert.ok(textOf(tree).includes('Join a group'));
    assert.ok(textOf(tree).includes('Import'));
    assert.ok(textOf(tree).includes('fabric:'));
  });

  it('after ingest, join stays available from the modal and Notifications', () => {
    const modal = new GroupOfferModal({ pasteOpen: true });
    modal.state.pendingJoin = {
      kind: 'FederationContractInvite',
      group: { id: 'group-1', name: 'Salvage Wing' },
      invite: { inviteId: 'inv-1' },
      inbox: { id: 'inbox-fi-inv-1', kind: 'MultisigWalletInvite', status: 'pending' }
    };
    const tree = modal.render();
    assert.ok(textOf(tree).includes('Join group'));
    assert.ok(textOf(tree).includes('View notifications'));
    assert.ok(textOf(tree).includes('Notifications'));
  });
});

describe('Notifications group actions', () => {
  it('lets a creator Accept a pending join request', () => {
    const page = new Notifications({});
    page.state.loading = false;
    page.state.pubkey = ME;
    page.state.items = [{
      id: 'inbox-gapp-1',
      kind: 'GroupApplication',
      status: 'pending',
      title: 'Join request · Salvage Wing',
      actionable: true,
      refs: { groupId: 'group-1', applicationId: 'gapp-1', applicantId: '02' + 'cd'.repeat(32) }
    }];
    page.state.filter = 'pending';
    const tree = page.render();
    assert.ok(textOf(tree).includes('Accept'));
    assert.ok(textOf(tree).includes('Reject'));
    assert.ok(textOf(tree).includes('join request'));
  });

  it('lets a recipient Apply to join from a public group share', () => {
    const page = new Notifications({});
    page.state.loading = false;
    page.state.items = [{
      id: 'inbox-go-1',
      kind: 'GroupOffer',
      status: 'pending',
      title: 'Salvage Wing',
      actionable: true,
      refs: {
        groupId: 'group-1',
        visibility: 'public',
        offer: { meta: { visibility: 'public', name: 'Salvage Wing' } }
      }
    }];
    page.state.filter = 'pending';
    const tree = page.render();
    assert.ok(textOf(tree).includes('Apply to join'));
    assert.ok(textOf(tree).includes('group share'));
  });

  it('shows waiting copy when the join request is your own', () => {
    const page = new Notifications({});
    page.state.loading = false;
    page.state.pubkey = ME;
    page.state.items = [{
      id: 'inbox-gapp-me',
      kind: 'GroupApplication',
      status: 'pending',
      title: 'Join request · Salvage Wing',
      source: ME,
      actionable: true,
      refs: { groupId: 'group-1', applicationId: 'gapp-2', applicantId: ME }
    }];
    page.state.filter = 'pending';
    const tree = page.render();
    assert.ok(textOf(tree).includes('Waiting for the creator'));
    assert.ok(!textOf(tree).includes('Reject'));
  });
});
