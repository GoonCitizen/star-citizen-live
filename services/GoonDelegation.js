'use strict';

/**
 * GoonCitizen as a delegation participant (`@fabric/core` docs/DELEGATION.md).
 *
 * GoonCitizen keeps its own `Delegation`: the player's identity key and its
 * frames in the register Store (collection `delegations`). Nothing is shared
 * with the signers it links to; each keeps its own key and its own record.
 *
 * - **Linking.** Passport on this computer pairs over the loopback delegate
 *   (`@fabric/http` fabricDelegate; the native dialog confirms the code).
 *   Anyone else pairs through a rendezvous: this app shows an invitation, or
 *   takes one, and the player matches the six-digit code in the dashboard
 *   before either side grants anything.
 * - **Requests.** A linked signer's `DELEGATION_REQUEST` (loopback or a
 *   mailbox) never signs on its own: it becomes a register inbox row
 *   (`DelegationRequest`) with Sign and Decline, and a desktop toast.
 * - **Who is who.** Mutual `identity` grants make one actor; every grant and
 *   revoke this app holds is handed to the relay (`identity`), which feeds
 *   the identity cluster and gossips them as `DelegationShare`.
 */

const EventEmitter = require('events');
const Delegation = require('@fabric/core/types/delegation');
const delegation = require('@fabric/core/types/delegation');
const { encodeFabricUri } = require('@fabric/core/functions/fabricUri');
const { createFabricDelegate } = require('@fabric/http/functions/fabricDelegate');
const client = require('@fabric/http/functions/fabricDelegationClient');
const { isAllowedFabricHub, normalizeHubOrigin } = require('@fabric/http/functions/fabricHubAllowlist');

const LABEL = 'GoonCitizen';
const COLLECTION = 'delegations';
const POLL_MS = 1500;
const MAILBOX_EVERY_MS = 30 * 1000;
const PAIRING_WAIT_MS = 3 * 60 * 1000;
const LINK_PROMPT_MS = 2 * 60 * 1000;
const PAIR_SCOPES = ['identity', 'passport', 'message'];

/**
 * `{ get, set }` over one register Store collection.
 * @param {object} registerStore `types/Store.js`
 * @param {string} [collection]
 * @returns {{ get: Function, set: Function }}
 */
function registerKv (registerStore, collection = COLLECTION) {
  return {
    async get (key) {
      const row = registerStore.get(collection, key);
      return row && typeof row.value === 'string' ? row.value : null;
    },
    async set (key, value) {
      registerStore.put(collection, key, { id: key, value: String(value) });
    }
  };
}

/** @private */
function grantView (g, direction) {
  const grant = g.grant || {};
  return {
    hash: g.hash,
    direction,
    grantor: grant.grantor,
    grantee: grant.grantee,
    label: grant.label || null,
    scopes: grant.scopes || [],
    origins: grant.origins || [],
    networks: grant.networks || [],
    hasCosigner: !!grant.cosigner,
    extensionOrigin: grant.extensionOrigin || null,
    issuedAt: grant.issuedAt || null,
    revoked: !!g.revoked
  };
}

/** @private */
function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class GoonDelegation extends EventEmitter {
  /**
   * @param {Object} settings
   * @param {Object} settings.key The player's identity key (private).
   * @param {string} settings.network
   * @param {Object} [settings.registerStore] Register Store; in memory when omitted.
   * @param {Function} settings.getAccount `({ network, account }) => account|null`.
   * @param {Function} [settings.approve] `(prompt) => Promise<boolean>` native dialog; loopback pairing needs it.
   * @param {boolean} [settings.loopback=true] Answer Passport on this computer.
   * @param {string[]} [settings.mailboxes] Hub origins whose mailboxes this app reads.
   * @param {string[]} [settings.extensionIds] Chrome Passport ids.
   * @param {Object} [settings.allowlist] Options for `isAllowedFabricHub` (`extra`).
   * @param {Function} [settings.fetch]
   * @param {Function} [settings.now]
   */
  constructor (settings = {}) {
    super();
    if (!settings.key || !settings.key.private) throw new TypeError('GoonDelegation: the player\'s identity key is required');
    this.settings = Object.assign({ loopback: true, mailboxes: [], extensionIds: [], allowlist: {} }, settings);
    this._now = typeof settings.now === 'function' ? settings.now : () => Date.now();
    this._fetch = settings.fetch || undefined;
    this.store = new Delegation({
      key: settings.key,
      store: settings.registerStore ? registerKv(settings.registerStore) : undefined,
      now: this._now
    });
    this.delegate = createFabricDelegate({
      delegation: this.store,
      signer: 'gooncitizen',
      network: settings.network,
      name: LABEL,
      getAccount: settings.getAccount,
      decide: () => 'notify',
      confirmLink: typeof settings.approve === 'function'
        ? (p) => settings.approve({ kind: 'link', code: p.sas, label: p.peerLabel, signer: p.peer, origin: p.origin, expiresAt: this._now() + LINK_PROMPT_MS })
        : null,
      grantsForLink: () => [{ scopes: ['identity', 'passport'], label: LABEL }],
      extensionIds: this.settings.extensionIds,
      now: this._now
    });
    this._requestHub = new Map();
    this._cursors = new Map();
    this._pairing = null;
    this._token = 0;
    this._timer = null;
    this._polling = false;

    this.store.on('request', (ev) => this.emit('request', { hash: ev.hash, notification: ev.notification, scope: ev.read.scope }));
    this.store.on('result', (ev) => this.emit('result', ev));
    this.store.on('grant', (ev) => {
      if (ev.read && ev.read.grant && ev.read.grant.scopes.includes('identity')) this.emit('identity', encodeFabricUri(ev.read.buffer));
      this.emit('signers');
    });
    this.store.on('revoke', (ev) => {
      this._frameUri(ev.hash).then((uri) => { if (uri) this.emit('identity', uri); }).catch(() => {});
      this.emit('signers');
    });
  }

  /** Compressed pubkey of the player's delegation identity. */
  get pubkey () {
    return this.store.pubkey;
  }

  /** @private */
  async _frameUri (hash) {
    const frames = await this.store.frames();
    const found = frames.find((f) => f.hash === hash);
    return found ? encodeFabricUri(Buffer.from(found.hex, 'hex')) : null;
  }

  /** @private */
  _allowed (origin) {
    const o = normalizeHubOrigin(String(origin || ''));
    return o && isAllowedFabricHub(o, this.settings.allowlist || {}) ? o : null;
  }

  /** Hub origins this app pairs through and reads mail from. */
  get mailboxes () {
    return [...new Set((this.settings.mailboxes || []).map((o) => this._allowed(o)).filter(Boolean))];
  }

  start () {
    if (this._timer || !this.mailboxes.length) return this;
    const tick = () => { this.pollMailboxes().catch((err) => this.emit('warning', `[DELEGATION] mailbox: ${err.message}`)); };
    this._timer = setInterval(tick, MAILBOX_EVERY_MS);
    if (this._timer.unref) this._timer.unref();
    tick();
    return this;
  }

  stop () {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this._token++;
    this._pairing = null;
  }

  /**
   * A frame addressed to this player arrived (a mailbox on this relay, or
   * one this app read).
   * @param {string|Buffer} frame
   * @param {string} [origin] Mailbox the frame came from (results go back there).
   * @returns {Promise<object>}
   */
  async take (frame, origin) {
    const out = await this.delegate.takeRemote(frame);
    const hash = out && out.json && out.json.request;
    if (hash && origin && !this._requestHub.has(hash)) this._requestHub.set(hash, origin);
    return out;
  }

  /**
   * Read every mailbox once.
   * @returns {Promise<number>} frames taken
   */
  async pollMailboxes () {
    if (this._polling) return 0;
    this._polling = true;
    let taken = 0;
    try {
      for (const origin of this.mailboxes) {
        const since = this._cursors.get(origin) || 0;
        const proof = delegation.createMailboxFetch({ since, now: this._now() }, this.settings.key);
        const out = await client.fetchMailbox(origin, proof.uri, { fetch: this._fetch });
        if (!out.ok) continue;
        for (const f of Array.isArray(out.frames) ? out.frames : []) {
          if (!f || typeof f.frame !== 'string') continue;
          try {
            const got = await this.take(f.frame, origin);
            if (got && got.status < 300) taken++;
          } catch (err) {
            this.emit('warning', `[DELEGATION] mailbox frame refused: ${err.message}`);
          }
        }
        const next = Number(out.next);
        if (Number.isFinite(next) && next > since) this._cursors.set(origin, next);
      }
    } finally {
      this._polling = false;
    }
    return taken;
  }

  /**
   * Requests waiting for the player, oldest first.
   * @returns {Promise<object[]>}
   */
  async pending () {
    const list = await this.store.pending();
    return list.map((p) => Object.assign({ hash: p.hash, receivedAt: p.receivedAt }, p.notification));
  }

  /**
   * The player signs or declines a request; the requester gets the result
   * from the mailbox it asked through (or from loopback, where Passport polls).
   * @param {string} hash
   * @param {'sign'|'decline'} action
   * @param {{ reason: (string|undefined) }} [options]
   * @returns {Promise<{ status: number, json: object }>}
   */
  async answer (hash, action, options = {}) {
    const out = await this.delegate.resolve(hash, { action, reason: options.reason || 'declined in GoonCitizen' });
    const settledNow = out && out.json && out.json.result && out.json.alreadySettled !== true;
    if (settledNow) {
      const item = await this.store.inboxItem(hash);
      const hub = this._requestHub.get(String(hash).toLowerCase());
      if (item && item.read && item.read.ok && hub) {
        const posted = await client.postMailbox(hub, out.json.result, { to: item.read.request.requester, fetch: this._fetch });
        if (!posted.ok) this.emit('warning', `[DELEGATION] result not delivered: ${posted.error || posted.httpStatus}`);
      }
    }
    return out;
  }

  /**
   * Linked signers: pairings and grants both ways, plus identity-linked keys.
   * @returns {Promise<object>}
   */
  async signers () {
    const [links, given, received, identityPeers] = await Promise.all([
      this.store.links(),
      this.store.grants('given', { revoked: true }),
      this.store.grants('received', { revoked: true }),
      this.store.identityPeers()
    ]);
    const peers = new Map();
    const peer = (pubkey) => {
      const x = delegation.xOnly(pubkey);
      if (!x) return null;
      if (!peers.has(x)) peers.set(x, { pubkey, label: null, given: [], received: [], linkedAt: null, sameIdentity: false });
      return peers.get(x);
    };
    for (const l of links) {
      if (l.status !== 'confirmed' || !l.peerPubkey) continue;
      const p = peer(l.peerPubkey);
      p.label = p.label || l.peerLabel || null;
      p.linkedAt = p.linkedAt || l.createdAt;
    }
    for (const g of given) {
      const p = peer(g.grant.grantee);
      if (p) p.given.push(grantView(g, 'given'));
    }
    for (const g of received) {
      const p = peer(g.grant.grantor);
      if (!p) continue;
      p.received.push(grantView(g, 'received'));
      p.label = p.label || g.grant.label || null;
    }
    const same = new Set(identityPeers.map((k) => delegation.xOnly(k)));
    for (const [x, p] of peers) p.sameIdentity = same.has(x);
    return {
      pubkey: this.pubkey,
      signers: Array.from(peers.values()).filter((p) => p.given.some((g) => !g.revoked) || p.received.some((g) => !g.revoked) || p.linkedAt),
      identityPeers,
      mailboxes: this.mailboxes,
      pairing: this.pairing()
    };
  }

  /**
   * Withdraw a grant the player made; the grantee finds the revocation in the mailboxes.
   * @param {string} hash
   * @returns {Promise<object>}
   */
  async revoke (hash) {
    const given = await this.store.grants('given');
    const found = given.find((g) => g.hash === String(hash || '').toLowerCase());
    if (!found) throw Object.assign(new Error('unknown grant'), { status: 404 });
    const made = await this.store.revoke(found.hash);
    for (const origin of this.mailboxes) {
      const posted = await client.postMailbox(origin, made.uri, { to: found.grant.grantee, fetch: this._fetch });
      if (!posted.ok) this.emit('warning', `[DELEGATION] revocation not delivered to ${origin}: ${posted.error || posted.httpStatus}`);
    }
    return { ok: true, revoked: found.hash, frame: made.uri };
  }

  /**
   * Withdraw every grant the player gave one signer.
   * @param {string} pubkey
   * @returns {Promise<{ ok: true, revoked: string[] }>}
   */
  async unlink (pubkey) {
    const x = delegation.xOnly(pubkey);
    if (!x) throw Object.assign(new Error('pubkey required'), { status: 400 });
    const given = await this.store.grants('given');
    const revoked = [];
    for (const g of given.filter((g) => g.grant.grantee.slice(2) === x)) {
      await this.revoke(g.hash);
      revoked.push(g.hash);
    }
    return { ok: true, revoked };
  }

  // Pairing through a rendezvous

  /**
   * The pairing in progress, for the dashboard (no nonces).
   * @returns {object|null}
   */
  pairing () {
    const p = this._pairing;
    if (!p) return null;
    return {
      mode: p.mode,
      status: p.status,
      rendezvous: p.rendezvous,
      invitation: p.invitation || null,
      sas: p.status === 'confirm' || p.status === 'granting' ? p.sas : null,
      peerPubkey: p.peerPubkey || null,
      peerLabel: p.peerLabel || null,
      localConfirmed: !!p.localConfirmed,
      scopes: p.scopes || null,
      expiresAt: p.expiresAt,
      error: p.error || null
    };
  }

  /** @private */
  _begin (fields) {
    this._token++;
    this._pairing = Object.assign({ token: this._token, expiresAt: this._now() + PAIRING_WAIT_MS }, fields);
    this.emit('pairing', this.pairing());
    return this._token;
  }

  /** @private */
  _live (token) {
    return !!(this._pairing && this._pairing.token === token && !['failed', 'cancelled', 'done'].includes(this._pairing.status));
  }

  /** @private */
  _update (token, fields) {
    if (!this._pairing || this._pairing.token !== token) return;
    Object.assign(this._pairing, fields);
    this.emit('pairing', this.pairing());
  }

  /** @private */
  _fail (token, err) {
    this._update(token, { status: 'failed', error: (err && err.message) || String(err) });
  }

  /** @private */
  async _waitForFrames (token, hub, linkId, count) {
    while (this._live(token) && this._now() < this._pairing.expiresAt) {
      const out = await client.readLink(hub, linkId, { fetch: this._fetch });
      if (!out.ok) throw new Error(out.httpStatus === 404 ? 'the pairing ended on the Hub' : (out.error || `the Hub answered ${out.httpStatus}`));
      const frames = Array.isArray(out.frames) ? out.frames : [];
      if (frames.length > count) return frames;
      await sleep(POLL_MS);
    }
    if (this._live(token)) throw new Error('the other side did not answer in time');
    return null;
  }

  /**
   * Show an invitation on a Hub; the other side takes it and both match the code.
   * @param {string} hub
   * @returns {Promise<object>} the pairing view
   */
  async invite (hub) {
    const rendezvous = this._allowed(hub);
    if (!rendezvous) throw Object.assign(new Error('choose one of the Hubs this app uses'), { status: 400 });
    const offer = await this.store.offer({ origin: rendezvous, label: LABEL, network: this.settings.network });
    const opened = await client.openLink(rendezvous, offer.uri, { fetch: this._fetch });
    if (!opened.ok) throw Object.assign(new Error(opened.error || `the Hub answered ${opened.httpStatus}`), { status: 502 });
    const token = this._begin({
      mode: 'offer',
      status: 'waiting',
      rendezvous,
      linkId: offer.linkId,
      invitation: offer.uri,
      expiresAt: Number(opened.expiresAt) || this._now() + PAIRING_WAIT_MS
    });
    this._runOffer(token, rendezvous, offer.linkId).catch((err) => this._fail(token, err));
    return this.pairing();
  }

  /** @private */
  async _runOffer (token, hub, linkId) {
    const frames = await this._waitForFrames(token, hub, linkId, 1);
    if (!frames) return;
    const got = await this.store.receive(frames[1]);
    if (!got.ok) throw new Error(got.error);
    const posted = await client.postLinkFrame(hub, linkId, got.reveal, { fetch: this._fetch });
    if (!posted.ok) throw new Error(posted.error || `the Hub answered ${posted.httpStatus}`);
    this._update(token, { status: 'confirm', sas: got.sas, peerPubkey: got.peerPubkey, peerLabel: got.peerLabel || '' });
  }

  /**
   * Take an invitation another signer shows.
   * @param {string} invitation `fabric:` link offer
   * @returns {Promise<object>} the pairing view
   */
  async accept (invitation) {
    const uri = String(invitation || '').trim();
    const read = client.readLinkInvitation(uri, { allowlist: this.settings.allowlist, now: this._now });
    if (!read.ok) throw Object.assign(new Error(`not an invitation this app can use: ${read.error}`), { status: 400 });
    if (read.author === delegation.xOnly(this.pubkey)) throw Object.assign(new Error('this invitation came from this app'), { status: 400 });
    const made = await this.store.answer(uri, { label: LABEL });
    const posted = await client.postLinkFrame(read.rendezvous, made.linkId, made.uri, { fetch: this._fetch });
    if (!posted.ok) throw Object.assign(new Error(posted.error || `the Hub answered ${posted.httpStatus}`), { status: 502 });
    const token = this._begin({
      mode: 'invitation',
      status: 'waiting',
      rendezvous: read.rendezvous,
      linkId: made.linkId,
      peerPubkey: made.peerPubkey,
      peerLabel: read.label || ''
    });
    this._runInvitation(token, read.rendezvous, made.linkId).catch((err) => this._fail(token, err));
    return this.pairing();
  }

  /** @private */
  async _runInvitation (token, hub, linkId) {
    const frames = await this._waitForFrames(token, hub, linkId, 2);
    if (!frames) return;
    const got = await this.store.receive(frames[2]);
    if (!got.ok) throw new Error(got.error);
    this._update(token, { status: 'confirm', sas: got.sas });
  }

  /**
   * The player matched the code: grant what they chose, then take the other side's grant.
   * @param {string[]} scopesRaw
   * @returns {Promise<object>} the pairing view
   */
  async confirm (scopesRaw) {
    const p = this._pairing;
    if (!p || p.status !== 'confirm' || !p.sas) throw Object.assign(new Error('nothing to confirm'), { status: 409 });
    const scopes = [...new Set((Array.isArray(scopesRaw) ? scopesRaw : []).map(String))].filter((s) => PAIR_SCOPES.includes(s));
    if (!scopes.length) throw Object.assign(new Error('choose at least one thing to allow'), { status: 400 });
    const token = p.token;
    this._update(token, { localConfirmed: true, scopes, status: 'granting' });
    await this.store.confirmLink(p.linkId);
    this._finish(token).catch((err) => this._fail(token, err));
    return this.pairing();
  }

  /** @private */
  async _finish (token) {
    const p = this._pairing;
    const link = (await this.store.links()).find((l) => l.linkId === p.linkId);
    if (!link || !link.revealHash || !link.peerPubkey) throw new Error('the pairing is incomplete');
    const grant = await this.store.grant({ grantee: link.peerPubkey, scopes: p.scopes, link: link.revealHash, label: LABEL });
    const posted = await client.postLinkFrame(p.rendezvous, p.linkId, grant.uri, { fetch: this._fetch });
    if (!posted.ok) throw new Error(posted.error || `the Hub answered ${posted.httpStatus}`);
    const until = Math.min(p.expiresAt, this._now() + PAIRING_WAIT_MS);
    while (this._live(token) && this._now() < until) {
      const out = await client.readLink(p.rendezvous, p.linkId, { fetch: this._fetch });
      if (!out.ok) break;
      for (const frame of Array.isArray(out.frames) ? out.frames : []) {
        if (delegation.delegationType(frame) !== 'DELEGATION_GRANT') continue;
        const read = delegation.readGrant(frame, { now: this._now() });
        if (!read.ok || read.author !== link.peer) continue;
        const got = await this.store.receive(frame);
        if (got.ok) {
          this._update(token, { status: 'done' });
          return;
        }
      }
      await sleep(POLL_MS * 2);
    }
    if (this._live(token)) this._update(token, { status: 'done', error: 'the other side has not granted anything yet' });
  }

  /**
   * Stop the pairing in progress and close its link on the Hub.
   * @returns {Promise<{ ok: true }>}
   */
  async cancelPairing () {
    const p = this._pairing;
    if (p) {
      this._update(p.token, { status: 'cancelled' });
      if (p.rendezvous && p.linkId) {
        const proof = delegation.createMailboxFetch({ now: this._now() }, this.settings.key);
        await client.cancelLink(p.rendezvous, p.linkId, proof.uri, { fetch: this._fetch }).catch(() => null);
      }
    }
    this._pairing = null;
    this.emit('pairing', null);
    return { ok: true };
  }

  /**
   * Every identity grant and revoke this app holds, as `fabric:` frames (to gossip).
   * @returns {Promise<string[]>}
   */
  async identityFrames () {
    const frames = await this.store.frames();
    const out = [];
    for (const f of frames) {
      if (f.type !== 'DELEGATION_GRANT' && f.type !== 'DELEGATION_REVOKE') continue;
      const buffer = Buffer.from(f.hex, 'hex');
      if (f.type === 'DELEGATION_GRANT') {
        const read = delegation.readGrant(buffer, { now: f.at });
        if (!read.ok || !read.grant.scopes.includes('identity')) continue;
      }
      out.push(encodeFabricUri(buffer));
    }
    return out;
  }
}

GoonDelegation.registerKv = registerKv;
GoonDelegation.PAIR_SCOPES = PAIR_SCOPES;
GoonDelegation.LABEL = LABEL;

module.exports = GoonDelegation;
