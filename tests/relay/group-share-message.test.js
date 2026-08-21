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
    assert.ok(offer.expiresAt);
    const offered = Date.parse(offer.offeredAt);
    const expires = Date.parse(offer.expiresAt);
    assert.ok(Number.isFinite(offered) && Number.isFinite(expires));
    assert.equal(expires - offered, 7 * 24 * 60 * 60 * 1000);
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
    assert.equal(/^fabric:(?:base64|b64)[,:]/i.test(url), false);
    assert.equal(parseOpaqueFabricUrl(url).ok, true);
    assert.equal(parseOpaqueFabricUrl(url).encoding, 'base64');

    const parsed = parseOpaqueFabricMessage(url);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.message.type, 'CONTRACT_MESSAGE');

    const classified = classifyGroupShareMessage(parsed.message);
    assert.equal(classified.kind, 'GroupOffer');
    assert.equal(classified.groupId, 'group-test-1');
    assert.equal(classified.contractId, contractId);
    assert.equal(classified.object.kind, GROUP_SHARE_KIND_OFFER);

    const hexUrl = buildOpaqueFabricUrl(msg, { encoding: 'hex' });
    assert.ok(hexUrl.startsWith('fabric:'));
    assert.ok(!hexUrl.startsWith('fabric:base64'));
    assert.equal(parseOpaqueFabricMessage(hexUrl).hex, parsed.hex);
  });

  it('opaque fabric: url sniffs base64 vs hex; tagged fabric:base64, still parses', () => {
    const key = new Key();
    const offer = buildGroupOfferBody({
      group: { id: 'group-test-1', contractId },
      definition,
      actor: key.pubkey
    });
    const body = buildGroupOfferContractMessage(offer, key.pubkey);
    const msg = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify(body)]).signWithKey(key);
    const url = buildOpaqueFabricUrl(msg, { encoding: 'base64' });
    assert.ok(url.startsWith('fabric:'));
    assert.equal(/^fabric:(?:base64|b64)[,:]/i.test(url), false);
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

    const tagged = 'fabric:base64,' + rawB64;
    const fromTagged = parseOpaqueFabricMessage(tagged);
    assert.equal(fromTagged.ok, true);
    assert.equal(fromTagged.hex, parsed.hex);
  });

  it('classifies FederationContractInvite opaque messages', () => {
    const key = new Key();
    const invite = buildFederationContractInvite({
      inviteId: 'inv-1',
      inviterHubId: key.pubkey,
      contractId,
      groupId: 'group-test-1',
      groupName: 'Test Wing',
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
    assert.equal(classified.groupId, 'group-test-1');
    assert.ok(classified.object.expiresAt);
    assert.equal(
      classified.object.expiresAt,
      invite.invitedAt + (7 * 24 * 60 * 60 * 1000)
    );
  });

  it('rejects garbage opaque urls', () => {
    assert.equal(parseOpaqueFabricUrl('https://example.com').ok, false);
    assert.equal(parseOpaqueFabricUrl('fabric://login?sessionId=aa&hub=https://x').ok, false);
    assert.equal(parseOpaqueFabricMessage('deadbeef').ok, false);
  });
});
