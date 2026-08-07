'use strict';

/**
 * PayoutManager — Bitcoin-unlocked mission rewards.
 *
 * A mission's reward can be escrowed on-chain in a k-of-n multisig address
 * built from the mission's AUTHORITY pubkeys (the same keys whose Schnorr
 * signatures accept the completion claim). Flow:
 *
 *   1. createEscrow(mission)   -> k-of-n P2WSH address (bitcoind createmultisig)
 *   2. (creator funds address) -> checkFunding() confirms via scantxoutset
 *   3. claim accepted (k-of-n Schnorr on the acceptance message, MissionManager)
 *      -> 'payout:unlocked' -> escrow status 'payable'
 *   4. buildPayout()           -> PSBT paying the claimant (authorities sign
 *                                 with their own wallets — keys never touch
 *                                 the server)
 *   5. broadcastPayout(hex)    -> sendrawtransaction
 *
 * Modes:
 *   - LEDGER (no rpc): the obligation + authorization are recorded and
 *     auditable; settlement happens out-of-band.
 *   - BITCOIN (rpc provided): full on-chain flow. Mainnet is refused unless
 *     `allowMainnet: true` — regtest/signet first, by decision.
 *
 * `rpc` is any `(method, params) => Promise<result>` — on goon.vc it wraps
 * the Hub's managed bitcoind (`@fabric/core` Bitcoin `_makeRPCRequest`).
 */

const EventEmitter = require('events');

const SATS_PER_BTC = 100000000;
const PUBKEY_RE = /^0[23][0-9a-f]{64}$/;

class PayoutManager extends EventEmitter {
  constructor (settings = {}) {
    super();
    this.settings = Object.assign({
      network: 'regtest',      // regtest | signet | testnet | mainnet
      allowMainnet: false,
      rpc: null,               // async (method, params) => result
      feeSats: 500
    }, settings);

    if (this.settings.network === 'mainnet' && !this.settings.allowMainnet) {
      throw new Error('mainnet escrow is disabled until the flow is proven (set allowMainnet to override)');
    }
  }

  get mode () { return typeof this.settings.rpc === 'function' ? 'bitcoin' : 'ledger'; }

  /**
   * Subscribe to a MissionManager: accepted claims flip escrow to 'payable'.
   * @param {Object} missionManager
   * @param {Object} [hooks]
   * @param {Function} [hooks.resolveGroupWallet] `(groupId) => { address }|null`
   */
  attach (missionManager, hooks = {}) {
    const resolveGroupWallet = typeof hooks.resolveGroupWallet === 'function'
      ? hooks.resolveGroupWallet
      : (typeof this.settings.resolveGroupWallet === 'function' ? this.settings.resolveGroupWallet : null);
    missionManager.on('payout:unlocked', ({ mission, claim, validation }) => {
      const escrow = mission.escrow;
      if (!escrow) return;
      escrow.status = 'payable';
      escrow.claimId = claim.id;
      escrow.unlockedAt = validation.validatedAt;
      const groupId = claim && claim.completionGroupId ? String(claim.completionGroupId) : null;
      if (groupId && resolveGroupWallet) {
        try {
          const wallet = resolveGroupWallet(groupId);
          const address = wallet && wallet.address ? String(wallet.address) : null;
          escrow.payeeKind = 'group';
          escrow.payee = groupId;
          escrow.payeeAddress = address;
          escrow.completionGroupId = groupId;
        } catch (e) {
          escrow.payeeKind = 'group';
          escrow.payee = groupId;
          escrow.payeeAddress = null;
          escrow.completionGroupId = groupId;
          escrow.payeeError = (e && e.message) || String(e);
        }
      } else {
        escrow.payeeKind = 'individual';
        escrow.payee = claim.claimantId;
        escrow.payeeAddress = escrow.payeeAddress || null;
        escrow.completionGroupId = null;
      }
      missionManager.store.put('missions', mission.id, mission);
      this.emit('payout:payable', { missionId: mission.id, escrow });
    });
    return this;
  }

  /**
   * Derive the k-of-n P2WSH multisig address for an arbitrary key set —
   * used for GROUP wallets (the group's roster + threshold) as well as
   * mission escrows. Sorted keys make the address deterministic across
   * every member's relay.
   * @param {Array<String>} keys Compressed secp256k1 pubkeys.
   * @param {Number} threshold Signatures required to spend.
   * @returns {Object} `{ address, keys, threshold, network, mode }` plus optional `redeemScript` / `descriptor`
   */
  async multisigAddress (keys, threshold = 1) {
    if (!Array.isArray(keys) || !keys.length) throw new Error('keys required');
    for (const k of keys) {
      if (!PUBKEY_RE.test(k)) throw new Error(`not a compressed secp256k1 pubkey: ${k}`);
    }
    const sorted = [...new Set(keys)].sort();
    const k = Math.max(1, Math.min(Number(threshold) || 1, sorted.length));
    const base = { keys: sorted, threshold: k, network: this.settings.network, mode: this.mode };
    if (this.mode === 'ledger') {
      return Object.assign(base, { address: null, note: 'ledger mode — connect a bitcoind RPC to derive addresses' });
    }
    const result = await this.settings.rpc('createmultisig', [k, sorted, 'bech32']);
    return Object.assign(base, {
      address: result.address,
      redeemScript: result.redeemScript,
      descriptor: result.descriptor || null
    });
  }

  /**
   * Create the escrow record for a mission from its authorities set.
   * BITCOIN mode derives a k-of-n P2WSH address; LEDGER mode records the
   * obligation only.
   * @param {Object} mission Mission with `authorities: { keys, threshold }`.
   * @param {Number} [amountSats] Escrow amount (defaults to mission.reward).
   * @returns {Object} Escrow record (also assigned to mission.escrow by caller).
   */
  async createEscrow (mission, amountSats) {
    const auth = mission.authorities;
    if (!auth || !Array.isArray(auth.keys) || !auth.keys.length) {
      throw new Error('mission has no authorities to escrow against');
    }
    for (const k of auth.keys) {
      if (!PUBKEY_RE.test(k)) throw new Error(`authority key is not a compressed secp256k1 pubkey: ${k}`);
    }
    const sats = Number(amountSats != null ? amountSats : mission.reward) || 0;
    const base = {
      network: this.settings.network,
      mode: this.mode,
      amountSats: sats,
      threshold: auth.threshold || 1,
      keys: [...auth.keys].sort(),
      status: 'unfunded',
      createdAt: new Date().toISOString()
    };

    if (this.mode === 'ledger') {
      return Object.assign(base, { address: null, note: 'ledger-only obligation; settle out-of-band' });
    }

    // k-of-n P2WSH via bitcoind. Sorted keys => deterministic address.
    const result = await this.settings.rpc('createmultisig', [base.threshold, base.keys, 'bech32']);
    return Object.assign(base, {
      address: result.address,
      redeemScript: result.redeemScript,
      descriptor: result.descriptor || null
    });
  }

  /**
   * Check whether the escrow address holds at least the escrow amount.
   * Uses scantxoutset (no wallet import needed).
   * @returns {{ funded, totalSats, utxos }}
   */
  async checkFunding (escrow) {
    if (this.mode === 'ledger') return { funded: false, totalSats: 0, utxos: [], note: 'ledger mode' };
    if (!escrow || !escrow.address) throw new Error('escrow has no address');
    const scan = await this.settings.rpc('scantxoutset', ['start', [`addr(${escrow.address})`]]);
    const utxos = (scan && scan.unspents) || [];
    const totalSats = Math.round(((scan && scan.total_amount) || 0) * SATS_PER_BTC);
    const funded = totalSats >= (escrow.amountSats || 0) && totalSats > 0;
    if (funded && escrow.status === 'unfunded') {
      escrow.status = 'funded';
      escrow.fundedAt = new Date().toISOString();
      escrow.fundedSats = totalSats;
    }
    return { funded, totalSats, utxos };
  }

  /**
   * Build the payout PSBT: escrow UTXOs -> payee address (minus fee).
   * The mission's authorities sign it with their own wallets
   * (walletprocesspsbt / HWW / Sparrow), then broadcastPayout() sends it.
   * @param {Object} escrow Funded, payable escrow.
   * @param {String} toAddress Claimant payout address.
   * @returns {{ psbt, inputSats, payoutSats, toAddress }}
   */
  async buildPayout (escrow, toAddress) {
    if (this.mode === 'ledger') throw new Error('ledger mode has no on-chain payout');
    const dest = toAddress || (escrow && escrow.payeeAddress) || null;
    if (!dest) throw new Error('toAddress required');
    if (escrow.status !== 'payable') throw new Error(`escrow is ${escrow.status}, not payable (claim must be accepted first)`);

    const { utxos, totalSats } = await this.checkFunding(escrow);
    if (!utxos.length) throw new Error('escrow address has no UTXOs');
    const fee = this.settings.feeSats || 500;
    const payoutSats = totalSats - fee;
    if (payoutSats <= 0) throw new Error('escrow balance does not cover the fee');

    const inputs = utxos.map((u) => ({ txid: u.txid, vout: u.vout }));
    const outputs = [{ [dest]: payoutSats / SATS_PER_BTC }];
    const psbt = await this.settings.rpc('createpsbt', [inputs, outputs]);
    escrow.payoutPsbt = psbt;
    escrow.payoutAddress = dest;
    return { psbt, inputSats: totalSats, payoutSats, toAddress: dest, redeemScript: escrow.redeemScript, payeeKind: escrow.payeeKind || 'individual' };
  }

  /**
   * Broadcast the authority-signed payout transaction.
   * @param {Object} escrow Escrow record (status flips to 'paid').
   * @param {String} signedTxHex Fully signed raw transaction hex.
   * @returns {{ txid }}
   */
  async broadcastPayout (escrow, signedTxHex) {
    if (this.mode === 'ledger') throw new Error('ledger mode has no on-chain payout');
    if (!signedTxHex) throw new Error('signedTxHex required');
    const txid = await this.settings.rpc('sendrawtransaction', [signedTxHex]);
    escrow.status = 'paid';
    escrow.paidAt = new Date().toISOString();
    escrow.payoutTxid = txid;
    this.emit('payout:paid', { escrow, txid });
    return { txid };
  }
}

module.exports = PayoutManager;
