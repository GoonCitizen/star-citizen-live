'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity } = require('../../functions/identity');
const { passportLogin } = require('../helpers/passportLogin');
const { signProposalVote } = require('../../functions/groupChangeProposal');

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-prop-vote-'));
}

function request (port, method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const req = http.request({
      host: '127.0.0.1', port, method, path: urlPath, headers
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = buf ? JSON.parse(buf) : null; } catch (_) { parsed = buf; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

function walletSigner (identity) {
  return (proposal) => signProposalVote(identity, proposal);
}

test('proposal vote signs with the unlocked wallet when FABRIC_XPRV is the publisher', async () => {
  const publisher = createIdentity();
  const wallet = createIdentity();
  const friend = createIdentity();
  const stranger = createIdentity();
  const dir = tmpDir();
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    peers: [],
    fabric: { enable: false },
    discord: { enable: false }
  });
  await svc.start();
  const port = svc.server.address().port;
  const base = '/services/star-citizen';
  try {
    const created = await svc.groupManager.createGroup({
      name: 'CRAZYWORLD',
      threshold: 2,
      members: [friend.pubkey],
      validators: [friend.pubkey]
    }, wallet.pubkey);
    const proposed = svc.groupManager.proposeChange({
      groupId: created.id,
      action: 'member.add',
      actor: friend.pubkey,
      member: stranger.pubkey
    });
    assert.equal(proposed.adopted, false);
    const proposalId = proposed.proposal.id;
    const votes = `${base}/groups/${encodeURIComponent(created.id)}/proposals/${encodeURIComponent(proposalId)}/votes`;

    svc.setIdentity(publisher, { unlockedPubkey: wallet.pubkey });
    const blocked = await request(port, 'POST', votes, {});
    assert.equal(blocked.status, 400);
    assert.match(blocked.body.error, /signature required/);

    svc.setLocalSigner(walletSigner(wallet));
    const voted = await request(port, 'POST', votes, {});
    assert.equal(voted.status, 200, voted.body && voted.body.error);
    assert.equal(voted.body.adopted, true);
    assert.ok(voted.body.group.members.includes(stranger.pubkey));

    const again = await svc.groupManager.proposeChange({
      groupId: created.id,
      action: 'member.add',
      actor: friend.pubkey,
      member: createIdentity().pubkey
    });
    const token = await passportLogin(port, wallet);
    const withBearer = await request(
      port,
      'POST',
      `${base}/groups/${encodeURIComponent(created.id)}/proposals/${encodeURIComponent(again.proposal.id)}/votes`,
      {},
      token
    );
    assert.equal(withBearer.status, 200, withBearer.body && withBearer.body.error);
    assert.equal(withBearer.body.adopted, true);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
