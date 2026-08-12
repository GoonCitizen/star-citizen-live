'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const { parseFabricLoginUrl, fabricLoginRequestHeaders } = require('../../functions/fabricProtocolLogin');
const { completeClientSignedLogin, fetchPendingLoginSession } = require('../../functions/fabricLoginClient');

/** Must match Hub `fabricDesktopLoginVerify.DESKTOP_LOGIN_PREFIX`. */
const DESKTOP_LOGIN_PREFIX = 'fabric:hub-login:1';

function buildLoginMessage (sessionId, origin, nonce) {
  return `${DESKTOP_LOGIN_PREFIX}:${nonce}:${sessionId}:${origin}`;
}

describe('fabricProtocolLogin', () => {
  it('parses fabric://login URLs', () => {
    const sid = crypto.randomBytes(24).toString('hex');
    const u = `fabric://login?sessionId=${sid}&hub=${encodeURIComponent('https://relay.goon.vc')}`;
    const p = parseFabricLoginUrl(u);
    assert.equal(p.ok, true);
    assert.equal(p.sessionId, sid);
    assert.equal(p.hubBase, 'https://relay.goon.vc');
  });

  it('rejects non-login fabric hosts and bad hubs', () => {
    assert.equal(parseFabricLoginUrl('fabric://message?hex=aa').ok, false);
    assert.equal(parseFabricLoginUrl('https://example.com').ok, false);
    assert.equal(parseFabricLoginUrl('fabric://login?sessionId=ab&hub=ftp://x').ok, false);
  });

  it('builds Origin/Referer headers for the hub callback', () => {
    const h = fabricLoginRequestHeaders('https://relay.goon.vc/');
    assert.equal(h.Origin, 'https://relay.goon.vc');
    assert.equal(h.Referer, 'https://relay.goon.vc/');
  });
});

describe('fabricLoginClient', () => {
  it('signs and POSTs a client completion body', async () => {
    const key = new Key();
    const ident = new Identity(key);
    const sessionId = crypto.randomBytes(24).toString('hex');
    const nonce = crypto.randomBytes(32).toString('hex');
    const origin = 'https://relay.goon.vc';
    const message = buildLoginMessage(sessionId, origin, nonce);
    let posted = null;
    const fetchImpl = async (url, init) => {
      posted = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          signer: 'client',
          identity: { id: ident.id, xpub: ident.fabricKey.xpub },
          pubkeyHex: ident.fabricKey.pubkey
        })
      };
    };
    const identity = {
      mnemonic: key.mnemonic,
      xprv: key.xprv,
      xpub: key.xpub,
      pubkey: key.pubkey,
      id: key.pubkey
    };
    const res = await completeClientSignedLogin(identity, origin, sessionId, message, { fetchImpl });
    assert.equal(res.ok, true);
    assert.ok(posted);
    assert.match(posted.url, /\/sessions\/.+\/signatures$/);
    const body = JSON.parse(posted.init.body);
    assert.equal(body.pubkeyHex, ident.fabricKey.pubkey);
    assert.equal(body.identity.id, ident.id);
    assert.equal(body.identity.xpub, ident.fabricKey.xpub);
    assert.match(body.signature, /^[a-f0-9]{128}$/i);
    assert.ok(ident.fabricKey.verifySchnorr(
      Buffer.from(message, 'utf8'),
      Buffer.from(body.signature, 'hex')
    ));
  });

  it('fetchPendingLoginSession maps pending JSON', async () => {
    const sessionId = crypto.randomBytes(24).toString('hex');
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'pending',
        origin: 'http://127.0.0.1:8080',
        message: 'fabric:hub-login:1:xx',
        nonce: 'nn'
      })
    });
    const r = await fetchPendingLoginSession('http://127.0.0.1:8080', sessionId, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.origin, 'http://127.0.0.1:8080');
  });
});
