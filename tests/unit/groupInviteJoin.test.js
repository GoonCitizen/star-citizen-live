'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const GroupManager = require('../../services/GroupManager');
const FabricNetwork = require('../../services/FabricNetwork');
const { createIdentity } = require('../../functions/identity');
const { parseOpaqueFabricMessage } = require('../../functions/groupShareMessage');
const { buildFederationContractInvite } = require('../../functions/federationContractInvite');

describe('targeted FederationContractInvite join', () => {
  it('invitee GroupChange applies when the inviter holds that outbound invite', async () => {
    const a = createIdentity();
    const b = createIdentity();
    const gm = new GroupManager({});
    const g = await gm.createGroup({ name: 'Wing', threshold: 1 }, a.pubkey);
    gm.store.put('groupinvites', 'inv-1', {
      inviteId: 'inv-1',
      inviteePubkey: b.pubkey,
      groupId: g.id,
      contractId: g.contractId || null,
      status: 'pending'
    });

    const stranger = createIdentity();
    const denied = gm.ingestGroupChange({
      id: 'chg-stranger',
      action: 'member.add',
      groupId: g.id,
      actor: stranger.pubkey,
      member: stranger.pubkey,
      via: 'FederationContractInvite',
      inviteId: 'inv-other',
      ts: new Date().toISOString()
    }, stranger.pubkey);
    assert.equal(denied.applied, false);
    assert.equal(denied.skipped, 'unauthorized');

    const applied = gm.ingestGroupChange({
      id: 'chg-bob',
      action: 'member.add',
      groupId: g.id,
      contractId: g.contractId || null,
      actor: b.pubkey,
      member: b.pubkey,
      via: 'FederationContractInvite',
      inviteId: 'inv-1',
      role: 'signer',
      ts: new Date().toISOString()
    }, b.pubkey);
    assert.equal(applied.applied, true);
    assert.equal(gm.getGroup(g.id).includes(b.pubkey), true);
  });

  it('joinFromPendingInvite refuses a different destination pubkey', async () => {
    const a = createIdentity();
    const b = createIdentity();
    const c = createIdentity();
    const gm = new GroupManager({});
    const g = await gm.createGroup({ name: 'Wing', threshold: 1 }, a.pubkey);
    await assert.rejects(
      () => gm.joinFromPendingInvite(g.id, c.pubkey, {
        inviteId: 'inv-2',
        inviteePubkey: b.pubkey,
        contractId: g.contractId
      }),
      { code: 'FORBIDDEN' }
    );
    const joined = await gm.joinFromPendingInvite(g.id, b.pubkey, {
      inviteId: 'inv-2',
      inviteePubkey: b.pubkey,
      contractId: g.contractId
    });
    assert.equal(gm.getGroup(g.id).includes(b.pubkey), true);
    assert.ok(joined.members.some((m) => String(m).toLowerCase() === String(b.pubkey).toLowerCase()));
  });

  it('clipboard fabric: bytes match the signed CONTRACT_MESSAGE', () => {
    const a = createIdentity();
    const b = createIdentity();
    const net = new FabricNetwork({ enable: false, listen: false, peers: [], peersDb: null });
    net.setIdentity(a);
    const invite = buildFederationContractInvite({
      inviteId: 'inv-clip-1',
      inviterHubId: a.pubkey,
      contractId: 'ab'.repeat(32),
      inviteePubkey: b.pubkey,
      groupId: 'group-1',
      groupName: 'Wing'
    });
    const msg = net.signContractMessage('ab'.repeat(32), 'FederationContractInvite', invite, { relay: false });
    const encoded = net.encodeOpaqueMessage(msg);
    const parsed = parseOpaqueFabricMessage(encoded.protocolUrl);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.hex, encoded.messageHex);
    const again = net.relaySignedMessage(msg, { relay: false, record: false });
    assert.equal(again.toBuffer().toString('hex'), encoded.messageHex);
  });
});
