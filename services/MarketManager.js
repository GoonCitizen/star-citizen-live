'use strict';

/**
 * @fileoverview MarketManager — GoonCitizen's local document market view.
 *
 * Composes the core `DocumentBook` (`@fabric/core/types/documentBook`): a
 * ranked **chunk index** (blob hash / merkle root → providers) plus **local**
 * provider telemetry (inventory RTT, delivery outcomes, refunds, penalties).
 * Reputation never leaves this node (plan decision 4); the signable
 * `ProviderTelemetry` export is persisted in the Fabric Store collection
 * `markettelemetry` so scores survive restarts.
 *
 * The flat `documentoffers` collection (`functions/documentOffers.js`) stays the
 * catalog view the Files page already renders; this manager is the ranking /
 * chunk-locator layer on top of the same inventory events.
 *
 * **Budget agent:** `settings.market.agent` `{ enable, budgetSats, perPlanMaxSats,
 * proximityWeight, tickMs }` composes the core consumer agent
 * (`@fabric/core/services/market`) over the same book. Funding goes through the
 * Hub-proxied personal wallet (`functions/hubBitcoinProxy.sendHubPayment`,
 * admin token resolved server-side) and L1 verification through the Hub
 * `GET /services/bitcoin/transactions/:txid?address=&amountSats=` proof. Mainnet
 * is refused (D-008). Agent state persists as `markettelemetry/agent`.
 */

const EventEmitter = require('events');

const DocumentBook = require('@fabric/core/types/documentBook');
const MarketAgent = require('@fabric/core/services/market');
const hubBitcoinProxy = require('../functions/hubBitcoinProxy');
const Challenge = require('@fabric/core/types/challenge');
const ChannelBook = require('@fabric/core/types/channelBook');
const Witness = require('@fabric/core/types/witness');

const COLLECTION = 'markettelemetry';
const RECORD_ID = 'local';
const AGENT_RECORD_ID = 'agent';
const CHANNELS_RECORD_ID = 'channels';

function sellerIdFromEvent (ev = {}) {
  const message = ev.message || {};
  const actor = message.actor && typeof message.actor === 'object' ? message.actor : null;
  const fromActor = actor && actor.id ? String(actor.id) : null;
  const signer = ev.signerPubkeyHex ? String(ev.signerPubkeyHex).toLowerCase() : null;
  const origin = ev.origin && (ev.origin.name != null ? ev.origin.name : ev.origin);
  return fromActor || signer || (origin ? String(origin) : null);
}

class MarketManager extends EventEmitter {
  /**
   * @param {Object} [settings]
   * @param {object} [settings.store] GoonCitizen `types/Store` instance.
   * @param {number} [settings.persistDebounceMs=2000]
   * @param {object} [settings.book] `DocumentBook` settings (alpha, hopPenaltyMs, weights).
   */
  constructor (settings = {}) {
    super();
    this.settings = Object.assign({ persistDebounceMs: 2000, agent: { enable: false }, channels: { enable: false } }, settings);
    this.channels = null;
    this.store = settings.store || null;
    this.book = new DocumentBook(settings.book || {});
    this.agent = null;
    this._peerProvider = typeof settings.peer === 'function' ? settings.peer : () => settings.peer || null;
    this._bitcoinSettings = settings.bitcoin || null;
    this._persistTimer = null;
    this._restore();
  }

  /** @returns {boolean} */
  get agentEnabled () {
    return !!(this.settings.agent && this.settings.agent.enable === true);
  }

  /**
   * Late-bind the Fabric Peer (LiveRelay starts it after construction) and the
   * Hub-proxied Bitcoin settings used to fund purchases.
   * @param {Object} deps `{ peer?: Function|Object, bitcoin?: Object }`
   */
  attach (deps = {}) {
    if (deps.peer) this._peerProvider = typeof deps.peer === 'function' ? deps.peer : () => deps.peer;
    if (deps.bitcoin) this._bitcoinSettings = deps.bitcoin;
    if (deps.providerPrivateKey) this._providerPrivateKey = deps.providerPrivateKey;
    if (typeof deps.localTree === 'function') this._localTree = deps.localTree;
    if (typeof deps.publish === 'function') this._publish = deps.publish;
    if (typeof deps.tipHeight === 'function') this._tipHeight = deps.tipHeight;
    if (this.agent) {
      const peer = this._peerProvider();
      if (peer) this.agent.attach({ peer });
    }
    return this;
  }

  /** @private */
  _btc () {
    const cfg = this._bitcoinSettings || {};
    if (!hubBitcoinProxy.isBitcoinEnabled({ bitcoin: cfg })) return null;
    return hubBitcoinProxy.withResolvedHubAdminToken({
      hub: hubBitcoinProxy.normalizeHubBase(cfg.hub),
      network: String(cfg.network || 'regtest'),
      adminToken: cfg.adminToken || null,
      adminTokenFile: cfg.adminTokenFile || null
    });
  }

  /**
   * Build the core budget agent once. Refuses mainnet.
   * @returns {MarketAgent|null}
   */
  _ensureAgent () {
    if (this.agent) return this.agent;
    if (!this.agentEnabled) return null;
    const cfg = this._bitcoinSettings || {};
    const network = String(cfg.network || 'regtest');
    if (network === 'mainnet' && cfg.allowMainnet !== true) {
      this.emit('error', new Error('[MARKET] budget agent refused on mainnet (D-008)'));
      return null;
    }
    const agentSettings = Object.assign({ tickMs: 15000 }, this.settings.agent, { book: this.book, network });
    const channels = this._ensureChannels();
    delete agentSettings.enable;
    const agent = new MarketAgent(agentSettings);
    const self = this;
    agent.attach({
      peer: this._peerProvider() || undefined,
      book: this.book,
      channels: channels || undefined,
      pay: async (session) => {
        const btc = self._btc();
        if (!btc) throw new Error('Hub Bitcoin wallet disabled (settings.bitcoin.enable)');
        const result = await hubBitcoinProxy.sendHubPayment(btc, {
          to: session.paymentAddress,
          amountSats: session.amountSats,
          memo: `fabric-market ${String(session.documentId).slice(0, 24)}#${session.blobIndex != null ? session.blobIndex : 'all'}`
        });
        const payment = result && (result.payment || result.data || result);
        return (payment && (payment.txid || payment.txId)) || null;
      },
      verify: async (session, txid) => {
        const btc = self._btc();
        if (!btc) return false;
        const q = `address=${encodeURIComponent(session.paymentAddress)}&amountSats=${encodeURIComponent(session.amountSats)}`;
        const proof = await hubBitcoinProxy.hubRequest(btc.hub, `/services/bitcoin/transactions/${encodeURIComponent(txid)}?${q}`);
        const body = proof && (proof.data || proof);
        return !!(body && body.verified === true);
      }
    });
    for (const ev of ['sessionOpened', 'sessionConfirmed', 'sessionComplete', 'sessionFailed', 'fundingRequired']) {
      agent.on(ev, (session) => {
        this.emit(ev, session);
        this._schedulePersist();
      });
    }
    agent.on('error', (e) => this.emit('error', e instanceof Error ? e : new Error(String(e))));
    this.agent = agent;
    this._restoreAgent();
    return agent;
  }

  /** @private */
  _restoreAgent () {
    if (!this.agent || !this.store || typeof this.store.get !== 'function') return;
    try {
      const rec = this.store.get(COLLECTION, AGENT_RECORD_ID);
      if (rec && rec.type === 'MarketAgentState') this.agent.import(rec);
    } catch (_) { /* fresh store */ }
  }

  /** Start the budget agent scheduler when enabled. */
  async start () {
    const agent = this._ensureAgent();
    if (agent) await agent.start();
    if (this.channelsEnabled && this._ensureChannels()) this._startChainPoll();
    return this;
  }

  /** @returns {Object} agent status or `{ available: false }`. */
  agentStatus () {
    const agent = this._ensureAgent();
    if (!agent) return { type: 'MarketAgentStatus', available: false, reason: this.agentEnabled ? 'unavailable' : 'disabled' };
    return Object.assign({ available: true }, agent.status());
  }

  /** @param {Object} body `{ documentId, merkleRootHex?, blobTotal?, maxSats? }` */
  agentWant (body = {}) {
    const agent = this._ensureAgent();
    if (!agent) throw new Error('budget agent is not enabled (settings.market.agent.enable)');
    const want = agent.want(body.documentId, body);
    this._schedulePersist();
    return want;
  }

  /** @param {string} documentId */
  agentForget (documentId) {
    const agent = this._ensureAgent();
    if (!agent) return false;
    const ok = agent.forget(documentId);
    this._schedulePersist();
    return ok;
  }

  /** @param {Object} body `{ budgetSats?, perPlanMaxSats?, proximityWeight? }` */
  agentConfigure (body = {}) {
    const agent = this._ensureAgent();
    if (!agent) throw new Error('budget agent is not enabled (settings.market.agent.enable)');
    if (body.budgetSats != null) agent.setBudget(body.budgetSats);
    if (body.perPlanMaxSats != null) agent.settings.perPlanMaxSats = Math.max(0, Math.floor(Number(body.perPlanMaxSats) || 0));
    if (body.proximityWeight != null) agent.settings.proximityWeight = Math.min(1, Math.max(0, Number(body.proximityWeight) || 0));
    this._schedulePersist();
    return agent.status();
  }

  _restore () {
    if (!this.store || typeof this.store.get !== 'function') return;
    try {
      const rec = this.store.get(COLLECTION, RECORD_ID);
      if (rec && rec.type === 'ProviderTelemetry') this.book.importTelemetry(rec);
    } catch (_) { /* fresh store */ }
  }

  _schedulePersist () {
    if (!this.store || this._persistTimer) return;
    const wait = Math.max(0, Number(this.settings.persistDebounceMs) || 0);
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this.persist();
    }, wait);
    if (this._persistTimer.unref) this._persistTimer.unref();
  }

  /**
   * Write the signable telemetry record to the Store now.
   * @returns {object|null}
   */
  persist () {
    if (!this.store || typeof this.store.put !== 'function') return null;
    const record = this.book.exportTelemetry();
    try {
      this.store.put(COLLECTION, RECORD_ID, record);
      if (this.agent) this.store.put(COLLECTION, AGENT_RECORD_ID, this.agent.export());
      if (this.channels) this.store.put(COLLECTION, CHANNELS_RECORD_ID, this.channels.export());
    } catch (e) {
      this.emit('error', e);
    }
    return record;
  }

  /**
   * Fold one `P2P_INVENTORY_RESPONSE` into the book (telemetry + chunk index).
   * @param {Object} ev `{ message, origin, latencyMs?, hops?, signerPubkeyHex? }`
   * @returns {object[]} rows upserted
   */
  ingestInventoryResponse (ev = {}) {
    const message = ev.message || {};
    const object = message.object || {};
    const items = object.items || object.documents || object.inventory;
    if (!Array.isArray(items) || !items.length) return [];
    const origin = ev.origin && (ev.origin.name != null ? ev.origin.name : ev.origin);
    const sellerId = sellerIdFromEvent(ev);
    const rows = this.book.ingestInventoryResponse({
      origin: origin ? String(origin) : undefined,
      items,
      sellerId,
      signerPubkeyHex: ev.signerPubkeyHex || null,
      latencyMs: Number.isFinite(Number(ev.latencyMs)) ? Number(ev.latencyMs) : undefined,
      hops: Number.isFinite(Number(ev.hops)) ? Number(ev.hops) : undefined
    });
    this._schedulePersist();
    this.emit('offers', { sellerId, count: rows.length });
    return rows;
  }

  recordDelivery (sellerId, outcome = {}) {
    this.book.recordDelivery(sellerId, outcome);
    this._schedulePersist();
  }

  recordRefund (sellerId) {
    this.book.recordRefund(sellerId);
    this._schedulePersist();
  }

  recordPenalty (sellerId, info = {}) {
    this.book.recordPenalty(sellerId, info);
    this.book.forgetSeller(sellerId);
    this._schedulePersist();
  }

  listProviders () {
    return this.book.listProviders();
  }

  /**
   * Chunk locator: blob hash → providers, optionally narrowed by document / root.
   * @param {Object} [filter]
   * @returns {Object.<string, object[]>}
   */
  chunkIndex (filter = {}) {
    const index = this.book.indexByBlobHash(filter);
    const out = {};
    for (const [hash, providers] of index) out[hash] = providers;
    return out;
  }

  /**
   * Cheapest ranked per-blob plan for one document (see `DocumentBook#pickBlobPlan`).
   */
  planFor (documentId, blobTotal, opts = {}) {
    return this.book.pickBlobPlan(documentId, blobTotal, opts);
  }

  status () {
    return {
      type: 'MarketStatus',
      offerCount: this.book.listOffers().length,
      providerCount: this.book.listProviders().length,
      telemetry: 'local'
    };
  }

  // --- Phase 4: Fabric payment channels (core ChannelBook) --------------------------

  /** @returns {boolean} */
  get channelsEnabled () {
    return !!(this.settings.channels && this.settings.channels.enable === true);
  }

  /**
   * Channel registry keyed by this node's Fabric key; bodies gossip as
   * `CONTRACT_MESSAGE` under the document-market namespace (no new opcode).
   * @returns {object|null} core `ChannelBook`
   */
  _ensureChannels () {
    if (this.channels) return this.channels;
    if (!this.channelsEnabled) return null;
    const priv = this._providerKey();
    if (!priv) return null;
    const cfg = this._bitcoinSettings || {};
    const network = String(cfg.network || 'regtest');
    if (network === 'mainnet' && cfg.allowMainnet !== true) {
      this.emit('error', new Error('[MARKET] payment channels refused on mainnet (D-008)'));
      return null;
    }
    try {
      const chCfg = this.settings.channels || {};
      this.channels = new ChannelBook({
        localPrivateKey: priv,
        network,
        // Chain view: host `tipHeight` (tests / Electron) or the Hub Bitcoin status poll (`onBitcoinBlock`).
        tipHeight: () => (typeof this._tipHeight === 'function' ? Number(this._tipHeight()) || 0 : 0),
        // Inbound ChannelOpen requires a confirmations source. `gateFunding`
        // waits on the host cache; otherwise the funding tx counts as deep
        // enough for the channel to open.
        confirmations: chCfg.gateFunding === true ? true : () => Number.MAX_SAFE_INTEGER,
        policy: chCfg.policy || {},
        forwardPolicy: chCfg.forwardPolicy || undefined,
        staleTipMs: chCfg.staleTipMs,
        publish: (body) => { if (this._publish) this._publish(body.type, body); this._schedulePersist(); },
        // Seller-fulfils: a committed HTLC for a blob this node sells is
        // fulfilled with K_i from the Peer's sealed-blob registry.
        preimageFor: (paymentHashHex) => this._preimageFor(paymentHashHex)
      });
      this.channels.on('htlcSettled', (ev) => { this.emit('channelHtlcSettled', ev); this._schedulePersist(); });
      this.channels.on('htlcCommitted', (ev) => this.emit('channelHtlcCommitted', ev));
    } catch (e) {
      this.emit('error', e);
      return null;
    }
    const snap = this.store && typeof this.store.get === 'function' ? this.store.get(COLLECTION, CHANNELS_RECORD_ID) : null;
    if (snap) { try { this.channels.import(snap); } catch (e) { this.emit('error', e); } }
    return this.channels;
  }

  /**
   * Content key for a payment hash this node can fulfil: the Fabric Peer's
   * published sealed blobs first, then an optional `settings.channels.preimageFor` hook.
   * @param {string} paymentHashHex
   * @returns {string|null} 32-byte key hex
   * @private
   */
  _preimageFor (paymentHashHex) {
    const peer = this._peerProvider ? this._peerProvider() : null;
    if (peer && typeof peer.sealedBlobPreimageForPaymentHash === 'function') {
      const hit = peer.sealedBlobPreimageForPaymentHash(paymentHashHex);
      if (hit && hit.keyHex) return hit.keyHex;
    }
    const hook = this.settings.channels && this.settings.channels.preimageFor;
    if (typeof hook === 'function') {
      try { return hook(paymentHashHex) || null; } catch (_) { return null; }
    }
    return null;
  }

  /**
   * Route an inbound `Channel*` body from the Fabric contract stream.
   * @param {object} body
   * @param {object} [meta] `{ sellerId }`
   * @returns {object|null}
   */
  ingestChannelMessage (body, meta = {}) {
    const book = this._ensureChannels();
    if (!book) return null;
    try {
      const reply = book.ingest(body, meta);
      this._schedulePersist();
      return reply;
    } catch (e) {
      this.emit('error', e);
      return null;
    }
  }

  /**
   * New chain tip (Hub Bitcoin status poll or host hook): refresh the book's
   * tip, tick expiries, and classify any supplied transactions — a stale
   * counterparty commitment yields a justice tx and a gossiped `FraudProof`.
   * Supply `blockHeaderHex` + `txids` (the block the transactions confirmed in)
   * so the proof carries an SPV inclusion artifact third parties can verify.
   * @param {object} payload `{ height, txHexes?, blockHeaderHex?, txids?, destinationAddress? }`
   * @returns {object|null}
   */
  onBitcoinBlock (payload = {}) {
    const book = this.channels;
    if (!book) return null;
    const result = book.onBlock({
      height: payload.height,
      txHexes: payload.txHexes || [],
      blockHeaderHex: payload.blockHeaderHex || undefined,
      txids: Array.isArray(payload.txids) ? payload.txids : undefined,
      destinationAddress: payload.destinationAddress
    });
    for (const obs of result.observations) {
      if (obs.kind !== 'stale') continue;
      this.emit('channelBreach', obs);
      if (obs.fraudProof && this._publish) this._publish('FraudProof', obs.fraudProof);
    }
    if (result.published.length || result.observations.length) this._schedulePersist();
    return result;
  }

  /** @private poll the Hub Bitcoin status for the tip while channels are enabled */
  _startChainPoll () {
    if (this._chainTimer || !this.channelsEnabled) return;
    const every = Math.max(5000, Number((this.settings.channels || {}).tipPollMs) || 60000);
    const poll = async () => {
      const btc = this._btc();
      if (!btc) return;
      try {
        const status = await hubBitcoinProxy.fetchStatus(btc);
        const height = Number(status && (status.height || (status.data && status.data.height)));
        if (height > 0) {
          this._tipHeight = () => height;
          this.onBitcoinBlock({ height });
        }
      } catch (_) { /* Hub unreachable: tip goes stale, new HTLCs refused */ }
    };
    poll().catch(() => {});
    this._chainTimer = setInterval(() => { poll().catch(() => {}); }, every);
    if (this._chainTimer.unref) this._chainTimer.unref();
  }

  /** @returns {object} */
  channelsStatus () {
    const book = this._ensureChannels();
    if (!book) return { type: 'ChannelBookStatus', available: false, reason: this.channelsEnabled ? 'unavailable' : 'disabled' };
    return { type: 'ChannelBookStatus', available: true, localPubkey: book.localPubkey, network: book.network, channels: book.list() };
  }

  /**
   * Open a channel as funder (operator). Caller supplies the funding tx hex.
   * @param {object} body `{ remotePubkey, fundedTxHex, capacitySats, expireAfter, localAddress, remoteAddress, feeSats?, aliases? }`
   */
  channelOpen (body = {}) {
    const book = this._ensureChannels();
    if (!book) throw new Error('payment channels are not enabled');
    const { session, body: open } = book.open(body);
    this._schedulePersist();
    return { channelId: session.channelId, open };
  }

  // --- Phase 3: availability market (provider side + local reputation) -----------

  /**
   * Verify a peer-relayed `FraudProof` and penalize the offender in the local
   * book (core `DocumentBook#ingestFraudProof`). Reputation stays local.
   * @param {object} body
   * @param {object} [ctx] `{ epoch }`
   * @returns {object} verdict
   */
  ingestFraudProof (body, ctx = {}) {
    const out = this.book.ingestFraudProof(body, ctx);
    if (out.ok) {
      this.emit('fraud', out);
      this._schedulePersist();
    }
    return out;
  }

  /** @private 32-byte provider key (Buffer) or null. */
  _providerKey () {
    const k = this._providerPrivateKey;
    if (!k) return null;
    const buf = Buffer.isBuffer(k) ? k : Buffer.from(String(k), 'hex');
    return buf.length === 32 ? buf : null;
  }

  /** x-only provider pubkey (hex) this node answers challenges for, or null. */
  providerPubkey () {
    const priv = this._providerKey();
    return priv ? Witness.xOnlyPubkeyHex(priv) : null;
  }

  /**
   * Sign an `AvailabilityCommitment` for a tree this node serves and publish it
   * as a `CONTRACT_MESSAGE` (via the injected `publish(type, object)`).
   * @param {object} opts `{ merkleRootHex, blobTotal, publisherPubkey, fromEpoch, untilEpoch, depositAddress?, depositTxid? }`
   * @returns {object} signed commitment
   */
  commitAvailability (opts = {}) {
    const priv = this._providerKey();
    if (!priv) throw new Error('provider key required to commit availability');
    const commitment = Challenge.commit(Object.assign({}, opts, { providerPrivateKey: priv }));
    if (this._publish) this._publish('AvailabilityCommitment', commitment);
    this.emit('commitment', commitment);
    return commitment;
  }

  /**
   * Answer an `AvailabilityChallenge` addressed to this provider from the local
   * catalog (`localTree(merkleRootHex)` → `{ blobHashes, bytesFor(i) }`).
   * @param {object} challenge signed artifact
   * @param {object} [opts] `{ epoch }`
   * @returns {object|null} signed response, or null when not ours / not held
   */
  onAvailabilityChallenge (challenge, opts = {}) {
    const priv = this._providerKey();
    if (!priv || !challenge || challenge.type !== 'AvailabilityChallenge') return null;
    if (String(challenge.providerPubkey || '').toLowerCase() !== Witness.xOnlyPubkeyHex(priv)) return null;
    if (!Witness.verifyArtifact(challenge)) return null;
    const tree = this._localTree ? this._localTree(String(challenge.merkleRootHex).toLowerCase()) : null;
    if (!tree || !Array.isArray(tree.blobHashes) || !tree.blobHashes.length) return null;
    const bytes = typeof tree.bytesFor === 'function' ? tree.bytesFor(Number(challenge.blobIndex)) : null;
    const response = new Challenge().respond(challenge, {
      blobHashes: tree.blobHashes,
      bytes: Buffer.isBuffer(bytes) ? bytes : undefined,
      epoch: opts.epoch != null ? Number(opts.epoch) : Number(challenge.epoch),
      providerPrivateKey: priv
    });
    if (this._publish) this._publish('AvailabilityResponse', response);
    this.emit('challengeResponse', { challenge, response });
    return response;
  }

  /**
   * Counter-proof when this provider is penalized despite a valid response.
   * The penalty's `prevouts` let verifiers check the penalty leaf and both
   * signatures; `ctx` is this node's chain view showing the penalty confirmed.
   * @param {object} challenge
   * @param {object} response
   * @param {object} [penalty] `{ txHex, txid?, prevouts: [{ scriptHex, valueSats }], anchor? }` (spent outputs in input order). `anchor` is the publisher's `AvailabilityReceipt` or trusted `EpochAttestation`s showing the response existed by the deadline.
   * @param {object} [ctx] `{ txConfirmed(txid, depth) }` or `{ headerKnown(blockHash), confirmations(blockHash) }`
   * @returns {object} `FraudProof` body (also published)
   */
  publishWrongfulPenalty (challenge, response, penalty = null, ctx = {}) {
    const proof = Challenge.wrongfulPenaltyProof(challenge, response, penalty, {
      anchor: penalty && penalty.anchor
    });
    const verdict = proof.verify(ctx);
    if (!verdict.ok) throw new Error(`wrongful-penalty proof does not verify: ${verdict.reason}`);
    const body = proof.toBody();
    if (this._publish) this._publish('FraudProof', body);
    return body;
  }

  stop () {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    if (this._chainTimer) {
      clearInterval(this._chainTimer);
      this._chainTimer = null;
    }
    if (this.agent) this.agent.stop().catch(() => {});
    this.persist();
  }
}

MarketManager.COLLECTION = COLLECTION;

module.exports = MarketManager;
