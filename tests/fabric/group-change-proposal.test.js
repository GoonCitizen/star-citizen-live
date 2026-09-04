'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const GroupManager = require('../../services/GroupManager');
const { createIdentity } = require('../../functions/identity');
const gcp = require('../../functions/groupChangeProposal');
const {
  GOONCITIZEN_GROUP_CONTRACT_VERSION,
  GROUP_MESSAGE_TYPES,
  GROUP_GOVERNANCE_TYPES
} = require('../../contracts/gooncitizenGroup');

describe('GroupChangeProposal governance', () => {
  it('enables proposal + vote types on group contract genesis', () => {
    assert.ok(GOONCITIZEN_GROUP_CONTRACT_VERSION >= 5);
    assert.ok(GROUP_GOVERNANCE_TYPES.includes('GroupChangeProposal'));
    assert.ok(GROUP_GOVERNANCE_TYPES.includes('GroupChangeVote'));
    assert.ok(GROUP_MESSAGE_TYPES.includes('GroupChangeProposal'));
    assert.ok(GROUP_MESSAGE_TYPES.includes('GroupChangeVote'));
  });

  it('threshold 1: propose + local vote adopts as GroupChange', async () => {
    const a = createIdentity();
    const b = createIdentity();
    const c = createIdentity();
    const gm = new GroupManager({});
    const g = await gm.createGroup({ name: 'Wing', members: [b.pubkey], threshold: 1 }, a.pubkey);

    const events = [];
    gm.on('group:proposal', (p) => events.push(['proposal', p.id]));
    gm.on('group:local-change', (ch) => events.push(['change', ch.action, ch.member]));

    const out = await gm.addMember(g.id, c.pubkey, b.pubkey);
    assert.ok(out.members.includes(c.pubkey));
    assert.ok(events.some((e) => e[0] === 'proposal'));
    assert.ok(events.some((e) => e[0] === 'change' && e[1] === 'member.add'));
    assert.strictEqual(gm.listProposals(g.id).length, 0);
    assert.ok(gm.listProposals(g.id, { includeAdopted: true }).some((p) => p.status === 'adopted'));
  });

  it('threshold 2: one vote stays pending; second vote adopts', async () => {
    const a = createIdentity();
    const b = createIdentity();
    const c = createIdentity();
    const gm = new GroupManager({});
    const g = await gm.createGroup({
      name: 'Fleet',
      members: [b.pubkey],
      validators: [a.pubkey, b.pubkey],
      threshold: 2
    }, a.pubkey);

    const pending = gm.proposeChange({
      groupId: g.id,
      action: 'member.add',
      actor: a.pubkey,
      member: c.pubkey,
      role: 'signer'
    });
    assert.strictEqual(pending.adopted, false);
    assert.ok(pending.proposal);
    assert.strictEqual(pending.proposal.status, 'pending');
    assert.ok(!gm.getGroup(g.id).members.includes(c.pubkey));

    const signed = gcp.signProposalVote(b, pending.proposal);
    const adopted = gm.castVote(pending.proposal.id, b.pubkey, signed.signature, {
      requireVerify: true,
      local: true
    });
    assert.strictEqual(adopted.adopted, true);
    assert.ok(gm.getGroup(g.id).members.includes(c.pubkey));
  });

  it('BIP340 vote round-trip verifies', () => {
    const a = createIdentity();
    const proposal = gcp.createProposalRecord({
      id: 'gprop-test',
      groupId: 'group-1',
      contractId: 'ab'.repeat(32),
      action: 'member.add',
      member: createIdentity().pubkey,
      proposedBy: a.pubkey,
      threshold: 1
    });
    const signed = gcp.signProposalVote(a, proposal);
    assert.strictEqual(gcp.verifyProposalVote(proposal, a.pubkey, signed.signature), true);
    assert.strictEqual(gcp.verifyProposalVote(proposal, a.pubkey, '00'.repeat(64)), false);
  });

  it('invite-join snapshot is stable and covered by the vote string', () => {
    const invite = {
      type: 'FederationContractInvite',
      v: 2,
      inviteId: 'inv-snap-1',
      inviterHubId: 'AA' + '11'.repeat(31),
      inviteePubkey: 'BB' + '22'.repeat(31),
      contractId: 'cc'.repeat(32),
      groupId: 'group-1',
      groupName: 'Wing',
      role: 'signer',
      invitedAt: 1_700_000_000_000,
      expiresAt: 1_700_604_800_000,
      protocolUrl: 'fabric:deadbeef',
      direction: 'outbound'
    };
    const snap = gcp.canonicalInviteForProposal(invite);
    assert.deepEqual(gcp.canonicalInviteForProposal(snap), snap);
    assert.equal(snap.inviterHubId, String(invite.inviterHubId).toLowerCase());
    assert.equal(snap.inviteePubkey, String(invite.inviteePubkey).toLowerCase());
    assert.equal(gcp.inviteJoinProposalId('INV-snap-1'), 'gprop-join-inv-snap-1');
    assert.ok(!Object.prototype.hasOwnProperty.call(snap, 'protocolUrl'));

    const a = createIdentity();
    const proposal = gcp.createProposalRecord({
      id: gcp.inviteJoinProposalId(invite.inviteId),
      groupId: 'group-1',
      contractId: invite.contractId,
      action: 'member.add',
      member: invite.inviteePubkey,
      proposedBy: invite.inviteePubkey,
      createdAt: gcp.proposalCreatedAtFromInvite(invite),
      via: gcp.INVITE_VIA,
      inviteId: invite.inviteId,
      invite
    });
    const signed = gcp.signProposalVote(a, proposal);
    assert.equal(gcp.verifyProposalVote(proposal, a.pubkey, signed.signature), true);
    assert.match(signed.message, /inv-snap-1/);
    assert.match(signed.message, /FederationContractInvite/);
    const wire = gcp.proposalWireObject(proposal);
    assert.equal(wire.invite.inviteId, 'inv-snap-1');
    assert.equal(wire.member, String(invite.inviteePubkey).toLowerCase());
  });
});
