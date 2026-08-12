'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const Message = require('@fabric/core/types/message');
const Key = require('@fabric/core/types/key');
const {
  groupContractDefinition,
  groupContractId
} = require('../../contracts/gooncitizenGroup');
const {
  GROUP_SHARE_KIND_OFFER,
  buildGroupOfferBody,
  buildGroupOfferContractMessage,
  buildOpaqueFabricUrl,
  parseOpaqueFabricUrl,
  parseOpaqueFabricMessage,
  classifyGroupShareMessage
} = require('../../functions/groupShareMessage');
const {
  buildFederationContractInvite
} = require('../../functions/federationContractInvite');

describe('groupShareMessage', () => {
  const creator = '02' + 'ab'.repeat(31);
  const definition = groupContractDefinition({
    groupId: 'group-test-1',
    creator,
    validators: [creator],
    threshold: 1,
    createdAt: '2026-07-24T00:00:00.000Z',
    meta: { name: 'Test Wing', visibility: 'public', slug: 'test-wing' }
  });
  const contractId = groupContractId(definition);

  it('buildGroupOfferBody embeds genesis definition', () => {
    const offer = buildGroupOfferBody({
      group: { id: 'group-test-1', contractId, name: 'Test Wing', visibility: 'public' },
      definition,
      actor: creator,
      note: 'join us'
    });
    assert.equal(offer.kind, GROUP_SHARE_KIND_OFFER);
    assert.equal(offer.contractId, contractId);
    assert.equal(offer.definition.groupId, 'group-test-1');
    assert.equal(offer.note, 'join us');
  });

  it('opaque fabric: url round-trips a signed GroupOffer Message', () => {
    const key = new Key();
    const offer = buildGroupOfferBody({
      group: { id: 'group-test-1', contractId },
      definition,
      actor: key.pubkey
    });
    const body = buildGroupOfferContractMessage(offer, key.pubkey);
    const msg = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify(body)]).signWithKey(key);
    const url = buildOpaqueFabricUrl(msg);
    assert.ok(url.startsWith('fabric:'));
    assert.equal(parseOpaqueFabricUrl(url).ok, true);

    const parsed = parseOpaqueFabricMessage(url);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.message.type, 'CONTRACT_MESSAGE');

    const classified = classifyGroupShareMessage(parsed.message);
    assert.equal(classified.kind, 'GroupOffer');
    assert.equal(classified.groupId, 'group-test-1');
    assert.equal(classified.contractId, contractId);
    assert.equal(classified.object.kind, GROUP_SHARE_KIND_OFFER);
  });

  it('opaque fabric:base64 url round-trips the same Message', () => {
    const key = new Key();
    const offer = buildGroupOfferBody({
      group: { id: 'group-test-1', contractId },
      definition,
      actor: key.pubkey
    });
    const body = buildGroupOfferContractMessage(offer, key.pubkey);
    const msg = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify(body)]).signWithKey(key);
    const url = buildOpaqueFabricUrl(msg, { encoding: 'base64' });
    assert.ok(url.startsWith('fabric:base64,'));
    const parsedUrl = parseOpaqueFabricUrl(url);
    assert.equal(parsedUrl.ok, true);
    assert.equal(parsedUrl.encoding, 'base64');

    const parsed = parseOpaqueFabricMessage(url);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.encoding, 'base64');
    assert.equal(parsed.message.type, 'CONTRACT_MESSAGE');
    assert.equal(parsed.hex, msg.toBuffer().toString('hex'));

    const rawB64 = msg.toBuffer().toString('base64');
    const fromRaw = parseOpaqueFabricMessage(rawB64);
    assert.equal(fromRaw.ok, true);
    assert.equal(fromRaw.hex, parsed.hex);
  });

  it('classifies FederationContractInvite opaque messages', () => {
    const key = new Key();
    const invite = buildFederationContractInvite({
      inviteId: 'inv-1',
      inviterHubId: key.pubkey,
      contractId,
      note: 'co-sign'
    });
    const body = {
      contract: contractId,
      type: 'FederationContractInvite',
      actor: { publicKey: key.pubkey, id: key.pubkey },
      object: invite
    };
    const msg = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify(body)]).signWithKey(key);
    const classified = classifyGroupShareMessage(msg);
    assert.equal(classified.kind, 'FederationContractInvite');
    assert.equal(classified.object.inviteId, 'inv-1');
  });

  it('rejects garbage opaque urls', () => {
    assert.equal(parseOpaqueFabricUrl('https://example.com').ok, false);
    assert.equal(parseOpaqueFabricUrl('fabric://login?sessionId=aa&hub=https://x').ok, false);
    assert.equal(parseOpaqueFabricMessage('deadbeef').ok, false);
  });
});
