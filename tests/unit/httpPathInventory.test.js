'use strict';

/**
 * Every LiveRelay HTTP path template must appear in docs/API-SURFACES.md.
 * Source of truth for handlers is still LiveRelay._handle + the Hub-shaped
 * adapters; this test only fails the inventory when a new pathname lands.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const DOC = 'docs/API-SURFACES.md';

const SOURCE_FILES = [
  'services/LiveRelay.js',
  'functions/fabricSiteLogin.js',
  'functions/fabricDeviceLinkRelay.js',
  'functions/fabricDeviceLinkLocalHttp.js',
  'functions/liveRelayPeeringHttp.js',
  'functions/groupVoiceHttp.js'
];

/** Distinctive path tokens that must appear (backticks optional). */
const REQUIRED_NEEDLES = [
  '/sessions',
  '/sessions/:id',
  '/sessions/:id/signatures',
  '/device-links',
  '/device-links/:id',
  '/device-links/:id/signatures',
  '/services/peering',
  '/services/peering/attestation',
  '/overlay',
  '/overlay.html',
  '/wallet/construct',
  '/overlay/primary-group',
  '/rules',
  '/missiongroups',
  '/combat',
  '/analytics',
  '/corpus',
  '/corpus/sync',
  '/corpus/import',
  '/corpus/remove',
  '/fs',
  '/activity-tree',
  '/activity-tree/publish',
  '/monitor',
  '/feed',
  '/auth',
  '/identity/cluster',
  '/identity/cluster/sync',
  '/identity/session',
  '/identity/cross-sign',
  '/discord/link',
  '/chat/channels',
  '/chat/messages',
  '/chat/messages/:id/pin',
  '/chat/messages/:id/receipt',
  '/delivery/:hash',
  '/delivery/:hash/receipt',
  '/groups',
  '/groups/:id',
  '/groups/:id/share',
  '/groups/share/ingest',
  '/voice',
  '/voice/signals',
  '/voice/leave',
  '/voice/ptt',
  '/groups/:id/voice',
  '/groups/:id/voice/join',
  '/groups/:id/voice/leave',
  '/groups/:id/voice/signal',
  '/groups/:id/voice/speaking',
  '/groups/:id/invites',
  '/groups/:id/invites/:inviteId/accept',
  '/groups/:id/invites/:inviteId/reject',
  '/groups/:id/fleets',
  '/groups/:id/statechain',
  '/groups/:id/members',
  '/groups/:id/proposals',
  '/groups/:id/proposals/:id/votes',
  '/groups/:id/applications',
  '/group-applications/:id/decision',
  '/groupaudit',
  '/groups/:id/wallet',
  '/groups/:id/withdrawals',
  '/groups/:id/withdrawals/:id/witness',
  '/groups/:id/withdrawals/:id/finalize',
  '/notes',
  '/notes/:id',
  '/notes/:id/share',
  '/notes/:id/pin',
  '/local-groups',
  '/local-groups/:id',
  '/local-groups/:id/members',
  '/local-groups/:id/members/:actor',
  '/missions',
  '/missions/:id',
  '/missions/:id/applications',
  '/missions/:id/cancel',
  '/missions/:id/apply',
  '/missions/:id/broadcast',
  '/missions/:id/claim',
  '/missions/:id/escrow',
  '/missions/:id/payout',
  '/missionbroadcasts',
  '/missionbroadcasts/:id/accept',
  '/missionbroadcasts/:id/ignore',
  '/inbox',
  '/inbox/:id/dismiss',
  '/applications',
  '/applications/:id/decision',
  '/claims',
  '/claims/:id/validate',
  '/validations',
  '/audit',
  '/wallet',
  '/activities',
  '/players',
  '/logins',
  '/vehicles',
  '/kills',
  '/incaps',
  '/deaths',
  '/missionlog',
  '/notifications',
  '/messages',
  '/events',
  '/documents',
  '/documents/inventory',
  '/documents/offers',
  '/documents/:id',
  '/documents/:id/publish',
  '/documents/:id/cluster-sync',
  '/documents/:id/purchase',
  '/documents/:id/claim',
  '/bitcoin/status',
  '/bitcoin/wallet',
  '/bitcoin/receive',
  '/bitcoin/transactions',
  '/bitcoin/utxos',
  '/bitcoin/send',
  '/bitcoin/faucet',
  '/device-links/offer',
  '/device-links/current',
  '/device-links/tick',
  '/device-links/cancel',
  '/device-links/pending',
  '/device-links/accept',
  '/settings',
  '/settings/:name',
  '/settings/discord/secrets',
  '/settings/primaryGroup/from-message',
  '/peers',
  '/peers/announce',
  '/peers/restore-seeds',
  '/peers/:id',
  '/profile',
  '/profiles/:id',
  '/presence',
  '/presence/ship',
  '/presence/roster',
  '/fabric/messages',
  '/fabric/messages/clear',
  '/fabric/messages/pause',
  '/fabric/messages/resume',
  '/fabric/messages/decode',
  '/fabric/messages/tree',
  '/fabric/messages/:hash',
  '/discord/links',
  '/discord/guilds',
  '/discord/guilds/:id/channels',
  '/discord/guilds/:id/members',
  '/discord/channels/:id',
  '/discord/coordination',
  '/discord/coordination/:requestId',
  '/world-view',
  '/search',
  '/network/observe',
  '/collections/:kind/:id',
  '/files/:id',
  '/files/:id/pin',
  '/files/:id/cluster-sync',
  '/loginfo',
  '/logslice',
  '/reparse',
  '/locations',
  '/locations/map',
  '/locations/reports',
  '/locations/:slug',
  '/ships',
  '/fleets',
  '/fleets/samples',
  '/fleets/:id',
  '/fleets/:id/ships',
  '/fleets/:id/ships/:slug',
  '/fleets/:id/share',
  '/snapshots',
  '/snapshots/:id/image',
  '/services/star-citizen/ui'
];

function extractSourcePathTokens (src) {
  const out = new Set();
  const add = (p) => {
    const n = String(p || '')
      .replace(/\$\{base\}/g, '')
      .replace(/\$\{btcPath\}/g, '/bitcoin')
      .replace(/\$\{docsPath\}/g, '/documents')
      .replace(/`\$\{base\}/g, '')
      .replace(/^\/services\/star-citizen/, '');
    if (n.startsWith('/') && n.length > 1 && !n.includes('${') && !n.includes('[^')) {
      out.add(n);
    }
  };
  let m;
  const lit = /(?:pathname\s*===\s*|pathname\.startsWith\(\s*)[`'](\/[^`'"]+)[`']/g;
  while ((m = lit.exec(src))) add(m[1].replace(/\$\{base\}/, ''));
  const tmpl = /pathname\s*===\s*`\$\{base\}([^`]+)`/g;
  while ((m = tmpl.exec(src))) add(m[1]);
  const btc = /pathname\s*===\s*`\$\{btcPath\}([^`]*)`/g;
  while ((m = btc.exec(src))) add('/bitcoin' + (m[1] || ''));
  const docs = /pathname\s*===\s*`\$\{docsPath\}([^`]*)`/g;
  while ((m = docs.exec(src))) add('/documents' + (m[1] || ''));
  const rest = /rest === '(\/[^']+)'/g;
  while ((m = rest.exec(src))) add('/device-links' + m[1]);
  return out;
}

describe('HTTP path inventory (docs/API-SURFACES.md)', () => {
  const doc = fs.readFileSync(path.join(ROOT, DOC), 'utf8');

  it('lists every required path template', () => {
    const missing = REQUIRED_NEEDLES.filter((n) => !doc.includes(n));
    assert.deepEqual(missing, [], `undocumented HTTP paths:\n${missing.join('\n')}`);
  });

  it('source pathname literals are covered by the inventory needles', () => {
    const tokens = new Set();
    for (const rel of SOURCE_FILES) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      for (const t of extractSourcePathTokens(src)) tokens.add(t);
    }
    const covered = (token) => {
      if (REQUIRED_NEEDLES.includes(token)) return true;
      if (REQUIRED_NEEDLES.includes('/services/star-citizen' + token)) return true;
      // Parametric / collection names: a documented prefix matches.
      return REQUIRED_NEEDLES.some((n) => {
        const stem = n.replace(/\/:[^/]+/g, '');
        if (!stem || stem === '/') return false;
        return token === stem || token.startsWith(stem + '/') ||
          n.replace(/:[^/]+/g, '') === token.replace(/\/[^/]+/g, (s) => s);
      });
    };
    const uncovered = [...tokens].filter((t) => {
      if (t === '/' || t === '/services/star-citizen/' || t === '/fleets/' ||
          t === '/bitcoin/' || t === '/documents/' || t === '/services/peering/' ||
          t === '/sessions/' || t === '/collections' || t === '/files' ||
          t === '/groups' || t === '/missions' || t === '/profiles' ||
          t === '/discord/world-view') {
        return false;
      }
      return !covered(t);
    }).sort();
    assert.deepEqual(uncovered, [], `LiveRelay path not in inventory list:\n${uncovered.join('\n')}`);
  });
});
