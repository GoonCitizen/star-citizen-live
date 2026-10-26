'use strict';

/**
 * Group wallets — each Group's signers form a named Fabric federation
 * (`@fabric/core` `types/federation`): the same descriptor, Taproot vault,
 * withdrawal PSBT, and member messages as Hub and Passport, so a group
 * wallet is a federation any Fabric member software can verify and sign for.
 *
 * The validators are the signers' cosigner keys (`m/87'/B'/n'/0/0`), which
 * each signer ties to their identity with a `cosigner.set` GroupChange
 * (`functions/groupCosigner.js`) — never identity keys. A group shows no
 * vault until every signer has one for the wallet's network. Federation
 * messages are signed by the cosigner key.
 *
 * Changing a group's signers or threshold makes a new descriptor (new
 * federation id and vault). Every descriptor seen for a group is kept, so
 * coins left on an earlier vault can still be withdrawn by its signers.
 *
 * Group membership is GoonCitizen's own (GroupChange); federation invites
 * and responses are not used here. Withdrawal requests, signatures,
 * broadcast notices, and sync travel as `CONTRACT_MESSAGE` under the
 * federation id.
 */

const EventEmitter = require('events');
const Federation = require('@fabric/core/types/federation');
const { pubkeyXOnly, pubkeysMatch } = require('@fabric/core/functions/pubkey');
const { groupCosignerFor } = require('../functions/groupCosigner');

const TYPES = Federation.MESSAGE_TYPES;
const ALREADY_KNOWN = /already in (block chain|utxo set|mempool)|txn-already-known|txn-already-in-mempool|txn-same-nonwitness-data-in-mempool/i;
const TXID_RE = /^[0-9a-f]{64}$/;

class GroupWallets extends EventEmitter {
  /**
   * @param {Object} settings
   * @param {Object} settings.store Register store (`get` / `put` / `all`)
   * @param {string|Function} [settings.network='regtest'] Bitcoin network name, or `() => name`
   * @param {boolean} [settings.allowMainnet=false] Allow withdrawals on mainnet
   * @param {number} [settings.maxFeeSats=100000] Highest withdrawal fee this node signs
   * @param {Function} [settings.signingKey] `(network) => Key|null` — the unlocked local
   *   cosigner key for the wallet network
   * @param {Function} [settings.publish] `(body) => void` — send a federation message
   * @param {Object} [settings.chain] `{ scan(address), rawTransaction(txid, { height }), broadcast(txHex) }`
   * @param {Function} [settings.groups] `() => Array<Group>` — this node's groups, to recognise
   *   the current federation of a group whose wallet was never opened here
   */
  constructor (settings = {}) {
    super();
    this.settings = Object.assign({
      store: null,
      network: 'regtest',
      allowMainnet: false,
      maxFeeSats: 100000,
      signingKey: null,
      publish: null,
      chain: {},
      groups: null
    }, settings);
    if (!this.settings.store) throw new Error('GroupWallets requires a store');
  }

  get store () { return this.settings.store; }

  get network () {
    const n = typeof this.settings.network === 'function' ? this.settings.network() : this.settings.network;
    return String(n || 'regtest').toLowerCase();
  }

  /** @private */
  _signers (group) {
    return (group && Array.isArray(group.validators)) ? group.validators : [];
  }

  /**
   * A member's cosigner key for the wallet network.
   * @param {Object} group
   * @param {string} member Identity pubkey.
   * @returns {string|null}
   */
  cosignerOf (group, member) {
    return groupCosignerFor(group, member, this.network);
  }

  /**
   * Signers that have not published a cosigner key for the wallet network.
   * @param {Object} group
   * @returns {string[]} identity pubkeys
   */
  missingCosigners (group) {
    return this._signers(group).filter((v) => !this.cosignerOf(group, v));
  }

  /**
   * Canonical federation descriptor for a group's current signers.
   * @param {Object} group Group (or its JSON)
   * @returns {Object|null} descriptor, or null when the group has no signers
   *   or a signer has no cosigner key yet
   */
  descriptor (group) {
    const signers = this._signers(group);
    if (!signers.length || this.missingCosigners(group).length) return null;
    const keys = signers.map((v) => this.cosignerOf(group, v));
    if (new Set(keys.map(pubkeyXOnly)).size !== keys.length) return null;
    const threshold = Math.min(Math.max(1, Number(group.threshold) || 1), keys.length);
    const creator = signers.find((v) => pubkeysMatch(v, group.creator));
    const publisher = creator ? this.cosignerOf(group, creator) : [...keys].sort()[0];
    return Federation.buildDescriptor({ validators: keys, threshold, network: this.network, publisher });
  }

  /**
   * The group's current federation, remembered so its vault stays spendable
   * after the signers change.
   * @param {Object} group
   * @returns {{ id: string, groupId: string, descriptor: Object, address: string }|null}
   */
  federation (group) {
    const descriptor = this.descriptor(group);
    if (!descriptor) return null;
    const id = Federation.descriptorId(descriptor);
    let record = this.store.get('groupfederations', id);
    if (!record) {
      record = { id, groupId: group.id, descriptor, createdAt: new Date().toISOString() };
      this.store.put('groupfederations', id, record);
    }
    return Object.assign({}, record, { address: Federation.vaultForDescriptor(descriptor).address });
  }

  /**
   * Every federation this node has seen for a group, current first.
   * @param {Object} group
   * @returns {Array<Object>}
   */
  federations (group) {
    const current = this.federation(group);
    return this._federationRows(group, current);
  }

  /** @private */
  _federationRows (group, current) {
    const rows = this.store.all('groupfederations')
      .filter((r) => r.groupId === group.id && (!current || r.id !== current.id))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map((r) => Object.assign({}, r, { address: Federation.vaultForDescriptor(r.descriptor).address }));
    return current ? [current, ...rows] : rows;
  }

  /**
   * Wallet view: current vault plus earlier ones.
   * @param {Object} group
   * @param {string} [viewer] pubkey of the viewer (for `viewerIsSigner`)
   * @returns {Object}
   */
  wallet (group, viewer = null) {
    const current = this.federation(group);
    const rows = this._federationRows(group, current);
    const previous = (current ? rows.slice(1) : rows).map((r) => ({
      federationId: r.id,
      address: r.address,
      threshold: r.descriptor.threshold,
      keys: r.descriptor.validators.slice(),
      createdAt: r.createdAt
    }));
    const viewerCosigner = viewer ? this.cosignerOf(group, viewer) : null;
    const viewerKey = viewerCosigner ? pubkeyXOnly(viewerCosigner) : null;
    if (!current) {
      const missing = this.missingCosigners(group);
      return {
        groupId: group.id,
        mode: 'federation',
        address: null,
        network: this.network,
        keys: [],
        threshold: null,
        missingCosigners: missing,
        viewerIsSigner: false,
        viewerKey,
        previous,
        note: this._signers(group).length
          ? `Waiting for ${missing.length} signer(s) to unlock GoonCitizen, which shares their wallet key with the group.`
          : 'group has no signers'
      };
    }
    const d = current.descriptor;
    return {
      groupId: group.id,
      mode: 'federation',
      federationId: current.id,
      descriptor: d,
      address: current.address,
      network: d.network,
      threshold: d.threshold,
      keys: d.validators.slice(),
      members: Array.isArray(group.members) ? group.members.slice() : [],
      missingCosigners: [],
      viewerIsSigner: !!viewerCosigner && Federation.isValidator(d, viewerCosigner),
      viewerKey,
      previous
    };
  }

  /**
   * Withdrawals for a group, newest first (without the funding transaction).
   * @param {string} groupId
   * @returns {Array<Object>}
   */
  withdrawals (groupId) {
    return this.store.all('groupwithdrawals')
      .filter((w) => w.groupId === groupId && w.federationId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map((w) => this.view(w));
  }

  /**
   * Public view of a withdrawal record.
   * @param {Object} w
   * @returns {Object}
   */
  view (w) {
    const fed = this.store.get('groupfederations', w.federationId);
    const out = Object.assign({}, w, {
      signers: Object.keys(w.signatures || {}),
      threshold: fed ? fed.descriptor.threshold : null
    });
    delete out.fundedTxHex;
    delete out.signatures;
    return out;
  }

  /**
   * Request a withdrawal from one of the group's vaults. Any signer of that
   * vault may ask; the request is signed by this node right away when the
   * requester is the unlocked local identity.
   * @param {Object} group
   * @param {string} actor requester identity pubkey
   * @param {Object} opts `{ destinationAddress, amountSats, feeSats, federationId?, fundedTxHex?, txid?, vout? }`
   * @returns {Promise<Object>} withdrawal view
   */
  async request (group, actor, opts = {}) {
    const record = this._federationFor(group, opts.federationId);
    const d = record.descriptor;
    this._checkNetwork(d.network);
    const cosigner = this.cosignerOf(group, actor);
    if (!cosigner || !Federation.isValidator(d, cosigner)) throw this._error('only a signer of this vault may request a withdrawal', 'FORBIDDEN');
    const amountSats = Number(opts.amountSats);
    const feeSats = Number(opts.feeSats);
    if (feeSats > this.settings.maxFeeSats) throw this._error(`fee is over this node's cap (${this.settings.maxFeeSats} sats)`);
    const destinationAddress = String(opts.destinationAddress || '').trim();

    const prepared = await this._prepare(record, { destinationAddress, amountSats, feeSats, fundedTxHex: opts.fundedTxHex, txid: opts.txid, vout: opts.vout });
    let w = this.store.get('groupwithdrawals', prepared.requestId);
    if (!w) {
      w = {
        id: prepared.requestId,
        requestId: prepared.requestId,
        groupId: group.id,
        federationId: record.id,
        requester: pubkeyXOnly(cosigner),
        destinationAddress,
        amountSats: prepared.amountSats,
        feeSats: prepared.feeSats,
        changeSats: prepared.changeSats,
        txid: prepared.txid,
        vout: prepared.vout,
        inputSats: prepared.inputSats,
        vaultAddress: prepared.vaultAddress,
        fundedTxHex: prepared.fundedTxHex,
        psbtBase64: prepared.psbtBase64,
        signatures: {},
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      this.store.put('groupwithdrawals', w.id, w);
    }
    this._publish(Federation.withdrawalMessage(record.id, {
      requestId: w.requestId,
      fundedTxHex: w.fundedTxHex,
      vout: w.vout,
      destinationAddress: w.destinationAddress,
      amountSats: w.amountSats,
      feeSats: w.feeSats
    }));
    const key = this._localKey();
    if (key && pubkeysMatch(key.pubkey, cosigner) && w.status === 'pending' && !w.signatures[pubkeyXOnly(cosigner)]) {
      return this.approve(group, w.id, actor);
    }
    return this.view(w);
  }

  /**
   * Add a signer's signatures to a pending withdrawal. Without `signatures`
   * the unlocked local cosigner key signs (it must be `actor`'s).
   * @param {Object} group
   * @param {string} requestId
   * @param {string} actor signer identity pubkey
   * @param {Object} [opts] `{ signatures? }` from {@link Federation.signWithdrawal}
   * @returns {Promise<Object>} withdrawal view
   */
  async approve (group, requestId, actor, opts = {}) {
    const w = this._withdrawal(group, requestId);
    const record = this._federationRecord(w.federationId);
    this._checkNetwork(record.descriptor.network);
    const cosigner = this.cosignerOf(group, actor);
    if (!cosigner || !Federation.isValidator(record.descriptor, cosigner)) throw this._error('only a signer of this vault may approve', 'FORBIDDEN');
    if (w.status !== 'pending') throw this._error(`withdrawal is ${w.status}`);
    const x = pubkeyXOnly(cosigner);
    let signatures;
    if (Array.isArray(opts.signatures) && opts.signatures.length) {
      signatures = opts.signatures;
      if (signatures.some((s) => pubkeyXOnly(s && s.pubkey) !== x)) throw this._error('signatures must all be from the approving signer');
    } else {
      const key = this._localKey();
      if (!key || !pubkeysMatch(key.pubkey, cosigner)) throw this._error('unlock this identity to sign, or send signatures', 'FORBIDDEN');
      signatures = Federation.signWithdrawal({ psbtBase64: w.psbtBase64, privateKey: key.private }).signatures;
    }
    this._addSignatures(record, w, signatures);
    this.store.put('groupwithdrawals', w.id, w);
    this._publish(Federation.signatureMessage(record.id, w.requestId, signatures));
    await this._maybeFinalize(record, w);
    return this.view(w);
  }

  /**
   * Handle a federation `CONTRACT_MESSAGE` body from the mesh.
   * @param {Object} body
   * @param {string} signer verified frame author
   * @returns {Promise<boolean>} true when the message was for one of our group federations
   */
  async receive (body, signer) {
    if (!Federation.isMessage(body) || !signer) return false;
    const record = this._knownFederation(String(body.federationId || '').toLowerCase());
    if (!record) return false;
    const from = Federation.verifySender(record.descriptor, body, signer);
    const key = this._localKey();
    if (key && pubkeyXOnly(key.pubkey) === from) return true;
    switch (body.type) {
      case TYPES.withdrawal: await this._onWithdrawal(record, body, from); break;
      case TYPES.signature: await this._onSignature(record, body, from); break;
      case TYPES.broadcast: await this._onBroadcast(record, body); break;
      case TYPES.sync: this._onSync(record); break;
      default:
    }
    return true;
  }

  async _onWithdrawal (record, body, from) {
    this._checkNetwork(record.descriptor.network);
    const prepared = Federation.verifyWithdrawalRequest(record.descriptor, body);
    if (prepared.feeSats > this.settings.maxFeeSats) throw new Error('withdrawal fee is over this node\'s cap');
    const existing = this.store.get('groupwithdrawals', prepared.requestId);
    if (existing) {
      this._resendOwnSignature(record, existing);
      return;
    }
    const w = {
      id: prepared.requestId,
      requestId: prepared.requestId,
      groupId: record.groupId,
      federationId: record.id,
      requester: from,
      destinationAddress: String(body.destinationAddress).trim(),
      amountSats: prepared.amountSats,
      feeSats: prepared.feeSats,
      changeSats: prepared.changeSats,
      txid: prepared.txid,
      vout: prepared.vout,
      inputSats: prepared.inputSats,
      vaultAddress: prepared.vaultAddress,
      fundedTxHex: String(body.fundedTxHex).toLowerCase(),
      psbtBase64: prepared.psbtBase64,
      signatures: {},
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    this.store.put('groupwithdrawals', w.id, w);
    this.emit('withdrawal', this.view(w));
  }

  async _onSignature (record, body, from) {
    const w = this.store.get('groupwithdrawals', String(body.requestId || '').toLowerCase());
    if (!w || w.federationId !== record.id) {
      this._publish(Federation.syncMessage(record.id));
      return;
    }
    if (w.signatures[from]) return;
    const sigs = (Array.isArray(body.signatures) ? body.signatures : []).filter((s) => pubkeyXOnly(s && s.pubkey) === from);
    if (!sigs.length) throw new Error('signature does not belong to its sender');
    this._addSignatures(record, w, sigs);
    this.store.put('groupwithdrawals', w.id, w);
    await this._maybeFinalize(record, w);
  }

  async _onBroadcast (record, body) {
    const w = this.store.get('groupwithdrawals', String(body.requestId || '').toLowerCase());
    if (!w || w.federationId !== record.id || w.status === 'broadcast') return;
    const txid = String(body.txid || '').toLowerCase();
    if (!TXID_RE.test(txid)) return;
    const chain = this.settings.chain || {};
    if (typeof chain.rawTransaction !== 'function') {
      w.reportedTxid = txid;
      this.store.put('groupwithdrawals', w.id, w);
      return;
    }
    try {
      await chain.rawTransaction(txid);
    } catch (_) {
      return;
    }
    w.status = 'broadcast';
    w.broadcastTxid = txid;
    this.store.put('groupwithdrawals', w.id, w);
  }

  _onSync (record) {
    const key = this._localKey();
    const self = key ? pubkeyXOnly(key.pubkey) : null;
    for (const w of this.store.all('groupwithdrawals')) {
      if (w.federationId !== record.id || w.status === 'broadcast') continue;
      if (w.requester === self) {
        this._publish(Federation.withdrawalMessage(record.id, {
          requestId: w.requestId,
          fundedTxHex: w.fundedTxHex,
          vout: w.vout,
          destinationAddress: w.destinationAddress,
          amountSats: w.amountSats,
          feeSats: w.feeSats
        }));
      }
      this._resendOwnSignature(record, w);
    }
  }

  _resendOwnSignature (record, w) {
    const key = this._localKey();
    const self = key ? pubkeyXOnly(key.pubkey) : null;
    if (self && w.signatures && w.signatures[self]) {
      this._publish(Federation.signatureMessage(record.id, w.requestId, [w.signatures[self]]));
    }
  }

  _addSignatures (record, w, signatures) {
    const out = Federation.addWithdrawalSignatures({ descriptor: record.descriptor, psbtBase64: w.psbtBase64, signatures });
    w.psbtBase64 = out.psbtBase64;
    for (const s of signatures) w.signatures[pubkeyXOnly(s.pubkey)] = s;
  }

  async _maybeFinalize (record, w) {
    if (w.status !== 'pending') return;
    if (Object.keys(w.signatures).length < record.descriptor.threshold) return;
    const final = Federation.finalizeWithdrawal({ descriptor: record.descriptor, psbtBase64: w.psbtBase64 });
    w.txHex = final.txHex;
    w.finalTxid = final.txid;
    w.status = 'signed';
    const chain = this.settings.chain || {};
    if (typeof chain.broadcast === 'function') {
      try {
        await chain.broadcast(final.txHex);
        w.status = 'broadcast';
        w.broadcastTxid = final.txid;
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        if (ALREADY_KNOWN.test(msg)) {
          w.status = 'broadcast';
          w.broadcastTxid = final.txid;
        } else {
          w.status = 'failed';
          w.error = msg;
        }
      }
    }
    this.store.put('groupwithdrawals', w.id, w);
    if (w.status === 'broadcast') this._publish(Federation.broadcastMessage(record.id, w.requestId, final.txid));
  }

  /**
   * Find the funding coin (when not given) and build the PSBT.
   * @private
   */
  async _prepare (record, opts) {
    const chain = this.settings.chain || {};
    const base = {
      descriptor: record.descriptor,
      destinationAddress: opts.destinationAddress,
      amountSats: opts.amountSats,
      feeSats: opts.feeSats
    };
    if (opts.fundedTxHex) {
      const fundedTxHex = String(opts.fundedTxHex).trim().toLowerCase();
      return Object.assign(Federation.prepareWithdrawal(Object.assign({}, base, { fundedTxHex, vout: opts.vout })), { fundedTxHex });
    }
    if (typeof chain.rawTransaction !== 'function') throw this._error('no Bitcoin backend to read the funding transaction; send fundedTxHex');
    if (opts.txid) {
      const fundedTxHex = String(await chain.rawTransaction(String(opts.txid).toLowerCase())).toLowerCase();
      return Object.assign(Federation.prepareWithdrawal(Object.assign({}, base, { fundedTxHex, vout: opts.vout })), { fundedTxHex });
    }
    if (typeof chain.scan !== 'function') throw this._error('no Bitcoin backend to find vault coins; send txid or fundedTxHex');
    const vault = Federation.vaultForDescriptor(record.descriptor);
    const scan = await chain.scan(vault.address);
    const need = Number(opts.amountSats) + Number(opts.feeSats);
    const coins = ((scan && scan.utxos) || [])
      .filter((u) => Number(u.amountSats) >= need)
      .sort((a, b) => Number(a.amountSats) - Number(b.amountSats));
    let lastError = null;
    for (const coin of coins) {
      try {
        const fundedTxHex = String(await chain.rawTransaction(coin.txid, { height: coin.height })).toLowerCase();
        return Object.assign(Federation.prepareWithdrawal(Object.assign({}, base, { fundedTxHex, vout: coin.vout })), { fundedTxHex });
      } catch (err) {
        lastError = err;
      }
    }
    throw this._error(lastError ? lastError.message : `no single vault coin covers ${need} sats (amount + fee)`);
  }

  _federationFor (group, federationId) {
    if (!federationId) {
      const current = this.federation(group);
      if (current) return current;
      if (!this._signers(group).length) throw this._error('group has no signers');
      throw this._error('every signer must publish a wallet key first');
    }
    const record = this.store.get('groupfederations', String(federationId).toLowerCase());
    if (!record || record.groupId !== group.id) throw this._error('unknown federation for this group', 'NOT_FOUND');
    return record;
  }

  /** Stored federation, else the current federation of one of this node's groups. */
  _knownFederation (federationId) {
    const record = this.store.get('groupfederations', federationId);
    if (record || typeof this.settings.groups !== 'function') return record || null;
    for (const group of this.settings.groups() || []) {
      const descriptor = this.descriptor(group);
      if (!descriptor || Federation.descriptorId(descriptor) !== federationId) continue;
      this.federation(group);
      return this.store.get('groupfederations', federationId);
    }
    return null;
  }

  _federationRecord (federationId) {
    const record = this.store.get('groupfederations', federationId);
    if (!record) throw this._error('unknown federation', 'NOT_FOUND');
    return record;
  }

  _withdrawal (group, requestId) {
    const w = this.store.get('groupwithdrawals', String(requestId || '').toLowerCase());
    if (!w || !w.federationId || w.groupId !== group.id) throw this._error('withdrawal not found', 'NOT_FOUND');
    return w;
  }

  _localKey () {
    try {
      return typeof this.settings.signingKey === 'function' ? this.settings.signingKey(this.network) : null;
    } catch (_) {
      return null;
    }
  }

  _publish (body) {
    if (typeof this.settings.publish !== 'function') return;
    try {
      this.settings.publish(body);
    } catch (err) {
      this.emit('warning', `[GROUP-WALLETS] publish ${body.type} failed: ${err.message}`);
    }
  }

  _checkNetwork (network) {
    if (network === 'mainnet' && !this.settings.allowMainnet) {
      throw this._error('mainnet group withdrawals are disabled until the flow is proven (payouts.allowMainnet)');
    }
  }

  _error (message, code = 'BAD_REQUEST') {
    return Object.assign(new Error(message), { code });
  }
}

module.exports = GroupWallets;
