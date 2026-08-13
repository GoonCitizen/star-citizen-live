'use strict';

/**
 * Local integration: Hub session create → GoonCitizen client-sign → poll signed.
 * Usage: node scripts/test-fabric-login-against-hub.js [http://127.0.0.1:8080]
 */

const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const { parseFabricLoginUrl } = require('../functions/fabricProtocolLogin');
const {
  fetchPendingLoginSession,
  completeClientSignedLogin
} = require('../functions/fabricLoginClient');

async function main () {
  const hubBase = (process.argv[2] || 'http://127.0.0.1:8080').replace(/\/$/, '');
  const origin = hubBase;

  console.log('[TEST] Creating session at', hubBase);
  const createRes = await fetch(`${hubBase}/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: origin,
      Referer: `${origin}/`
    },
    body: JSON.stringify({ origin })
  });
  const created = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !created.ok) {
    console.error('[TEST] FAIL create', createRes.status, created);
    process.exit(1);
  }
  console.log('[TEST] sessionId', created.sessionId);
  console.log('[TEST] acceptsClientSignature', created.acceptsClientSignature);
  console.log('[TEST] protocolUrl', created.protocolUrl);

  const parsed = parseFabricLoginUrl(created.protocolUrl);
  if (!parsed.ok) {
    console.error('[TEST] FAIL parse protocolUrl', parsed);
    process.exit(1);
  }
  if (parsed.hubBase.replace(/\/$/, '') !== hubBase) {
    console.error('[TEST] FAIL hub mismatch', parsed.hubBase, hubBase);
    process.exit(1);
  }

  const pending = await fetchPendingLoginSession(parsed.hubBase, parsed.sessionId);
  if (!pending.ok) {
    console.error('[TEST] FAIL fetch pending', pending);
    process.exit(1);
  }
  console.log('[TEST] pending origin', pending.origin);
  console.log('[TEST] message prefix', pending.message.slice(0, 40) + '…');

  const key = new Key();
  const identity = {
    mnemonic: key.mnemonic,
    xprv: key.xprv,
    xpub: key.xpub,
    pubkey: key.pubkey,
    id: key.pubkey
  };
  const signed = await completeClientSignedLogin(
    identity,
    parsed.hubBase,
    parsed.sessionId,
    pending.message
  );
  if (!signed.ok) {
    console.error('[TEST] FAIL client sign POST', signed);
    process.exit(1);
  }
  console.log('[TEST] signed ok, signer=', signed.signer, 'id=', signed.identity && signed.identity.id);

  const poll = await fetch(`${hubBase}/sessions/${encodeURIComponent(parsed.sessionId)}`, {
    headers: { Accept: 'application/json', Origin: origin, Referer: `${origin}/` },
    cache: 'no-store'
  });
  const body = await poll.json().catch(() => ({}));
  if (!poll.ok || body.status !== 'signed') {
    console.error('[TEST] FAIL poll', poll.status, body);
    process.exit(1);
  }
  console.log('[TEST] poll signed, delegationToken=', !!body.delegationToken, 'signer=', body.signer);

  const fabricIdent = new Identity(key);
  if (String(body.identity && body.identity.id) !== String(fabricIdent.id)) {
    console.error('[TEST] FAIL identity id mismatch', body.identity, fabricIdent.id);
    process.exit(1);
  }
  console.log('[TEST] PASS — Hub ↔ GoonCitizen client-signed login works');
}

main().catch((e) => {
  console.error('[TEST] ERROR', e && e.stack ? e.stack : e);
  process.exit(1);
});
