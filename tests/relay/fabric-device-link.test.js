'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const { parseFabricDeviceLinkUrl } = require('../../functions/fabricDeviceLinkProtocol');
const {
  buildLinkMessage,
  completeDeviceLinkAsResponder,
  fetchPendingDeviceLink
} = require('../../functions/fabricDeviceLinkClient');

describe('fabricDeviceLinkProtocol', () => {
  it('parses fabric://link URLs', () => {
    const sid = crypto.randomBytes(24).toString('hex');
    const u = `fabric://link?sessionId=${sid}&hub=${encodeURIComponent('https://relay.goon.vc')}`;
    const p = parseFabricDeviceLinkUrl(u);
    assert.equal(p.ok, true);
    assert.equal(p.kind, 'link');
    assert.equal(p.sessionId, sid);
    assert.equal(p.hubBase, 'https://relay.goon.vc');
  });

  it('rejects non-link fabric hosts', () => {
    assert.equal(parseFabricDeviceLinkUrl('fabric://login?sessionId=aa&hub=https://x').ok, false);
    assert.equal(parseFabricDeviceLinkUrl('https://example.com').ok, false);
  });
});

describe('fabricDeviceLinkClient', () => {
  it('builds canonical link messages', () => {
    const nonce = 'ab'.repeat(32);
    const msg = buildLinkMessage(nonce, 'id1aaa', 'id1bbb', 'GoonCitizen');
    assert.equal(msg, `fabric:device-link:1:${nonce}:id1aaa:id1bbb:GoonCitizen`);
  });

  it('signs as responder and POSTs', async () => {
    const initiator = new Key();
    const initiatorIdent = new Identity(initiator);
    const responder = new Key();
    const responderIdent = new Identity(responder);
    const sessionId = crypto.randomBytes(24).toString('hex');
    const nonce = crypto.randomBytes(32).toString('hex');
    let posted = null;
    const fetchImpl = async (url, init) => {
      posted = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          status: 'accepted',
          sessionId,
          linkMessage: buildLinkMessage(nonce, initiatorIdent.id, responderIdent.id, 'Hub')
        })
      };
    };
    const identity = {
      mnemonic: responder.mnemonic,
      xprv: responder.xprv,
      xpub: responder.xpub,
      pubkey: responder.pubkey,
      id: responder.pubkey
    };
    const res = await completeDeviceLinkAsResponder(identity, 'https://relay.goon.vc', {
      sessionId,
      status: 'pending',
      nonce,
      label: 'Hub',
      initiator: { id: initiatorIdent.id, xpub: initiator.xpub }
    }, { fetchImpl });
    assert.equal(res.ok, true);
    assert.ok(posted);
    assert.match(posted.url, /\/device-links\/.+\/signatures$/);
    const body = JSON.parse(posted.init.body);
    assert.equal(body.role, 'responder');
    assert.equal(body.identity.id, responderIdent.id);
    assert.match(body.signature, /^[a-f0-9]{128}$/i);
    const expected = buildLinkMessage(nonce, initiatorIdent.id, responderIdent.id, 'Hub');
    // Protocol signs with Identity#fabricKey, not the Bitcoin master.
    assert.ok(responderIdent.fabricKey.verifySchnorr(
      Buffer.from(expected, 'utf8'),
      Buffer.from(body.signature, 'hex')
    ));
    assert.equal(body.pubkeyHex, responderIdent.fabricKey.pubkey);
    assert.equal(body.identity.xpub, responderIdent.fabricKey.xpub);
  });

  it('fetches pending device-link sessions', async () => {
    const sessionId = 'aa'.repeat(24);
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        status: 'pending',
        sessionId,
        label: 'Hub',
        initiator: { id: 'id1x', xpub: 'xpub1' }
      })
    });
    const res = await fetchPendingDeviceLink('https://relay.goon.vc', sessionId, { fetchImpl });
    assert.equal(res.ok, true);
    assert.equal(res.status, 'pending');
    assert.equal(res.label, 'Hub');
  });
});
