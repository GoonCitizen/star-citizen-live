'use strict';

/**
 * GroupManager — member-created groups with k-of-n Schnorr multisig.
 *
 * Any player (pubkey) may create a group; members may add members. Groups
 * scope mission visibility (missions shared to a group are served only to
 * its members) and act as authority sets for mission acceptance/payouts.
 * Mutations are recorded in a hash-chained audit log (same pattern as
 * MissionManager).
 */

const crypto = require('crypto');
const EventEmitter = require('events');

const Group = require('../types/Group');
const { Store } = require('../stores/register');

const ZERO = '0'.repeat(64);
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

class GroupManager extends EventEmitter {
  constructor (settings = {}) {
    super();
    this.settings = Object.assign({ enable: true, dir: null }, settings);
    this.store = settings.store || new Store({ dir: this.settings.dir });
    this._counter = 0;
  }

  get groups () { return this.store.all('groups'); }
  get audit () { return this.store.all('groupaudit').sort((a, b) => a.seq - b.seq); }

  async start () { this.emit('ready'); return this; }
  async stop () { this.emit('stopped'); return this; }

  _id () { this._counter += 1; return `group-${Date.now().toString(36)}-${this._counter}`; }

  _audit (actor, action, entityId, summary) {
    const chain = this.audit;
    const prevHash = chain.length ? chain[chain.length - 1].hash : ZERO;
    const body = { seq: chain.length, ts: new Date().toISOString(), actor: actor != null ? String(actor) : null, action, entity: 'group', entityId, summary: summary || '' };
    const hash = sha256(prevHash + JSON.stringify(body));
    const entry = Object.assign({ id: `groupaudit-${body.seq}` }, body, { prevHash, hash });
    this.store.put('groupaudit', entry.id, entry);
    this.emit('audit', entry);
    return entry;
  }

  verifyAudit () {
    let prev = ZERO;
    for (const e of this.audit) {
      const body = { seq: e.seq, ts: e.ts, actor: e.actor, action: e.action, entity: e.entity, entityId: e.entityId, summary: e.summary };
      if (e.prevHash !== prev || e.hash !== sha256(prev + JSON.stringify(body))) return false;
      prev = e.hash;
    }
    return true;
  }

  /** @returns {Group|null} Hydrated group or null. */
  getGroup (id) {
    const data = this.store.get('groups', id);
    return data ? new Group(data) : null;
  }

  /** Groups visible to a pubkey (member of). */
  groupsFor (pubkey) {
    return this.groups.filter((g) => Array.isArray(g.members) && g.members.includes(pubkey));
  }

  /** @returns {Boolean} True when pubkey is a member of group `groupId`. */
  isMember (groupId, pubkey) {
    const g = this.store.get('groups', groupId);
    return !!(g && Array.isArray(g.members) && g.members.includes(pubkey));
  }

  /**
   * Create a group. The creator (authenticated pubkey) is always a member.
   * @param {Object} data { name, members?, threshold? }
   * @param {String} creator Authenticated creator pubkey.
   * @returns {Object} Stored group JSON.
   */
  async createGroup (data = {}, creator) {
    if (!Group.isValidPubkey(creator)) {
      const e = new Error('creator must be an authenticated pubkey'); e.code = 'FORBIDDEN'; throw e;
    }
    const members = [...new Set([creator].concat(Array.isArray(data.members) ? data.members : []))];
    const group = new Group({
      id: data.id || this._id(),
      name: data.name,
      creator,
      members,
      threshold: data.threshold
    });
    group.validate();
    if (this.store.get('groups', group.id)) throw new Error('group id already exists');
    const json = group.toJSON();
    this.store.put('groups', group.id, json);
    this._audit(creator, 'group.create', group.id, `${group.name} (${members.length} member(s), ${group.threshold}-of-${members.length})`);
    this.emit('group:created', json);
    return json;
  }

  /**
   * Add a member. Only existing members may add.
   * @param {String} groupId Group id.
   * @param {String} pubkey New member pubkey.
   * @param {String} actor Authenticated pubkey performing the action.
   */
  async addMember (groupId, pubkey, actor) {
    const data = this.store.get('groups', groupId);
    if (!data) throw new Error('group not found');
    if (!data.members.includes(actor)) {
      const e = new Error('forbidden: only members may add members'); e.code = 'FORBIDDEN'; throw e;
    }
    if (!Group.isValidPubkey(pubkey)) throw new Error('invalid member pubkey');
    if (data.members.includes(pubkey)) return data;
    data.members = data.members.concat([pubkey]);
    const group = new Group(data);
    group.validate();
    const json = group.toJSON();
    this.store.put('groups', groupId, json);
    this._audit(actor, 'group.member.add', groupId, pubkey);
    this.emit('group:member-added', { groupId, pubkey, actor });
    return json;
  }

  /**
   * Remove a member. Only the creator may remove; the creator cannot be removed.
   * Threshold is clamped to the new member count.
   */
  async removeMember (groupId, pubkey, actor) {
    const data = this.store.get('groups', groupId);
    if (!data) throw new Error('group not found');
    if (data.creator !== actor) {
      const e = new Error('forbidden: only the creator may remove members'); e.code = 'FORBIDDEN'; throw e;
    }
    if (pubkey === data.creator) throw new Error('creator cannot be removed');
    if (!data.members.includes(pubkey)) return data;
    data.members = data.members.filter((m) => m !== pubkey);
    data.threshold = Math.min(data.threshold, data.members.length);
    const group = new Group(data);
    group.validate();
    const json = group.toJSON();
    this.store.put('groups', groupId, json);
    this._audit(actor, 'group.member.remove', groupId, pubkey);
    this.emit('group:member-removed', { groupId, pubkey, actor });
    return json;
  }

  /**
   * Verify a k-of-n multisignature for a group decision.
   * @param {String} groupId Group id.
   * @param {Object} multiSig `{ message, signatures }`.
   * @param {Number} [threshold] Optional override.
   * @returns {Boolean}
   */
  verifyGroupSignature (groupId, multiSig, threshold) {
    const group = this.getGroup(groupId);
    if (!group) return false;
    return group.verifyMultiSignature(multiSig, threshold);
  }
}

module.exports = GroupManager;
