'use strict';

/**
 * Publish GoonCitizen CONTRACT_PUBLISH to playnet peers, then optionally Accept on a Hub.
 *
 * Canonical location: star-citizen-live (this repo). Hub may ship a thin overlay
 * that shells here — prefer running from this tree.
 *
 * Usage:
 *   npm run playnet:deploy-gooncitizen -- [--accept] [--hub <url>] [peer…]
 *   npm run publish:gooncitizen -- …   (alias)
 *
 * Env:
 *   FABRIC_XPRV                 preferred operator key (same across Fabric suite)
 *   FABRIC_SEED / FABRIC_MNEMONIC  BIP39 alternative (or xprv string in FABRIC_SEED)
 *   FABRIC_HUB_RPC_URL          default http://127.0.0.1:8080
 *   FABRIC_HUB_ADMIN_TOKEN      required for --accept
 *   FABRIC_PLAYNET_PEERS
 */

const path = require('path');
const Message = require('@fabric/core/types/message');
const Peer = require('@fabric/core/types/peer');
const {
  gooncitizenContractDefinition,
  gooncitizenContractId
} = require('../contracts/gooncitizen');
const {
  loadPeerKeySettings,
  loadAdminToken,
  hubRpcBase,
  hubRpc,
  playnetPeers,
  waitForPeerConnections
} = require('../functions/playnetDeploy');

function printHelp () {
  console.log(`Usage:
  npm run playnet:deploy-gooncitizen -- [--accept] [--hub <url>] [--hold-ms <n>] [peer…]

  --accept           Call AcceptTrackedApplicationContract after publish
  --hub <url>        Hub HTTP base (default FABRIC_HUB_RPC_URL / http://127.0.0.1:8080)
  --hold-ms <n>      Keep peer up after publish (default 4000)
  --check-only       Skip publish; only print contract id + ListTracked status

Env: FABRIC_XPRV (preferred), FABRIC_SEED / FABRIC_MNEMONIC, FABRIC_HUB_ADMIN_TOKEN, FABRIC_PLAYNET_PEERS
`);
}

async function listTracked (baseUrl) {
  try {
    return await hubRpc('ListTrackedApplicationContracts', {}, { baseUrl });
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

function summarizeTracked (list, contractId) {
  const pending = (list && list.pending) || (list && list.result && list.result.pending) || [];
  const accepted = (list && list.accepted) || (list && list.result && list.result.accepted) || [];
  const hitAccepted = accepted.find((e) => e && String(e.contractId || e.id || '') === contractId) || null;
  const hitPending = pending.find((e) => e && String(e.contractId || e.id || '') === contractId) || null;
  const hit = hitAccepted || hitPending;
  return {
    pendingCount: Array.isArray(pending) ? pending.length : null,
    acceptedCount: Array.isArray(accepted) ? accepted.length : null,
    entry: hit,
    status: hitAccepted ? 'accepted' : (hitPending ? 'pending' : 'missing')
  };
}

function loadContract () {
  const contractId = gooncitizenContractId();
  const definition = gooncitizenContractDefinition();
  return {
    source: path.join(__dirname, '..', 'contracts', 'gooncitizen.js'),
    contractId,
    definition
  };
}

async function main () {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  let doAccept = false;
  let checkOnly = false;
  let hubUrl = hubRpcBase();
  let holdMs = Number(process.env.FABRIC_DEPLOY_HOLD_MS || 4000);
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--accept') doAccept = true;
    else if (a === '--check-only') checkOnly = true;
    else if (a === '--hub') hubUrl = String(argv[++i] || '').replace(/\/$/, '');
    else if (a === '--hold-ms') holdMs = Number(argv[++i] || holdMs);
    else if (!a.startsWith('-')) positional.push(a);
    else {
      console.error('Unknown flag:', a);
      printHelp();
      process.exit(1);
    }
  }

  const gc = loadContract();
  console.log('[playnet:deploy] GoonCitizen', {
    source: gc.source,
    contractId: gc.contractId,
    name: gc.definition && gc.definition.name,
    version: gc.definition && gc.definition.version
  });

  const before = await listTracked(hubUrl);
  console.log('[playnet:deploy] tracked before', summarizeTracked(before, gc.contractId));

  if (checkOnly) {
    process.exit(0);
  }

  const peerKey = loadPeerKeySettings();
  if (!peerKey) {
    throw new Error('FABRIC_XPRV (preferred) or FABRIC_SEED / FABRIC_MNEMONIC required');
  }

  const peers = playnetPeers(positional);
  const peer = new Peer({
    listen: false,
    networking: true,
    peers,
    key: peerKey,
    peersDb: null,
    flushChainMinTrustedScore: -1
  });
  peer.on('error', (err) => console.error('[playnet:deploy] peer error', err && err.message ? err.message : err));
  peer.on('warning', (w) => console.warn('[playnet:deploy] warning', w));

  await peer.start();
  console.log('[playnet:deploy] local pubkey', peer.key && peer.key.pubkey);
  console.log('[playnet:deploy] dialing', peers);

  const conns = await waitForPeerConnections(peer, {
    timeoutMs: Number(process.env.FABRIC_PLAYNET_WAIT_MS || 20000)
  });
  console.log('[playnet:deploy] connections', conns);
  if (!conns.length) {
    await peer.stop();
    throw new Error('no Fabric peer connections — cannot publish');
  }

  const msg = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(gc.definition)]).signWithKey(peer.key);
  if (typeof peer.broadcast === 'function') {
    peer.broadcast(msg.toBuffer());
  } else if (typeof peer.relayFrom === 'function') {
    peer.relayFrom(null, msg);
  } else {
    for (const id of conns) {
      if (peer.connections[id] && typeof peer.connections[id]._writeFabric === 'function') {
        peer.connections[id]._writeFabric(msg.toBuffer());
      }
    }
  }
  console.log('[playnet:deploy] CONTRACT_PUBLISH sent', { contractId: gc.contractId, peers: conns.length });

  await new Promise((r) => setTimeout(r, holdMs));
  await peer.stop();

  await new Promise((r) => setTimeout(r, 1000));
  const mid = await listTracked(hubUrl);
  console.log('[playnet:deploy] tracked after publish', summarizeTracked(mid, gc.contractId));

  if (doAccept) {
    const token = loadAdminToken();
    if (!token) {
      throw new Error('--accept requires FABRIC_HUB_ADMIN_TOKEN');
    }
    const accept = await hubRpc('AcceptTrackedApplicationContract', {
      contractId: gc.contractId,
      adminToken: token
    }, { baseUrl: hubUrl });
    console.log('[playnet:deploy] AcceptTrackedApplicationContract', accept);

    try {
      const side = await hubRpc('GetContractSidechainState', { contractId: gc.contractId }, { baseUrl: hubUrl });
      console.log('[playnet:deploy] contract sidechain', {
        clock: side && side.clock,
        stateDigest: side && side.stateDigest,
        version: side && side.version
      });
    } catch (e) {
      console.warn('[playnet:deploy] GetContractSidechainState:', e.message || e);
    }
  }

  const after = await listTracked(hubUrl);
  console.log('[playnet:deploy] tracked final', summarizeTracked(after, gc.contractId));
  console.log('[playnet:deploy] done');
}

main().catch((err) => {
  console.error('[playnet:deploy]', err && err.message ? err.message : err);
  process.exit(1);
});
