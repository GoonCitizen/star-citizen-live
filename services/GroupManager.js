'use strict';

/**
 * GroupManager — member-created groups with k-of-n Schnorr multisig,
 * optional nested subgroups (`parentId`), public/private visibility,
 * custom page slugs, and join applications.
 *
 * Groups are the sharing boundary across many GoonCitizen installations
 * on the Fabric mesh (not a single global "org").
 *
 * Group pages live at `/groups/:id` (or `/groups/:slug` when a custom slug
 * is set). Public groups can be shared; visitors apply to join; the creator
 * accepts or rejects. Private groups are members-only.
 *
 * Persistence: uses `types/Store.js` (composes `@fabric/core` Store;
 * `/collections/*` paths) under
 * `stores/gooncitizen/register` (Hub-style named store root).
 */

const crypto = require('crypto');
const EventEmitter = require('events');

const Group = require('../types/Group');
const { Store } = require('../types/Store');
const {
  GROUP_CONTRACT_NAME,
  groupContractDefinition,
  groupContractId,
  normalizeProposedPolicy,
  policyFingerprint,
  isGroupContractDefinition
} = require('../contracts/gooncitizenGroup');

const ZERO = '0'.repeat(64);
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

class GroupManager extends EventEmitter {
  constructor (settings = {}) {
    super();
    this.settings = Object.assign({ enable: true, dir: null }, settings);
    this.store = settings.store || new Store({ path: this.settings.dir || this.settings.path || null });
    this._counter = 0;
  }

  get groups () { return this.store.all('groups'); }
  get applications () { return this.store.all('groupapplications'); }
  get audit () { return this.store.all('groupaudit').sort((a, b) => a.seq - b.seq); }

  async start () {
    if (this.store && typeof this.store.start === 'function') await this.store.start();
    this.emit('ready');
    return this;
  }

  async stop () {
    if (this.store && typeof this.store.stop === 'function' && !this.settings.store) {
      await this.store.stop();
    }
    this.emit('stopped');
    return this;
  }

  _id (prefix = 'group') { this._counter += 1; return `${prefix}-${Date.now().toString(36)}-${this._counter}`; }

  /** Signing validators (legacy groups: all members). */
  _signerList (data) {
    if (!data) return [];
    if (Array.isArray(data.validators) && data.validators.length) {
      return [...new Set(data.validators.map((v) => String(v).toLowerCase()))];
    }
    if (data.proposedPolicy && Array.isArray(data.proposedPolicy.validators)) {
      return [...new Set(data.proposedPolicy.validators.map((v) => String(v).toLowerCase()))];
    }
    return Array.isArray(data.members) ? data.members.slice() : [];
  }

  /** Refresh proposedPolicy from current validators (not all members). */
  _syncPolicyFromSigners (data) {
    const validators = this._signerList(data);
    data.validators = validators;
    data.threshold = Math.min(Math.max(1, Number(data.threshold) || 1), validators.length || 1);
    data.proposedPolicy = normalizeProposedPolicy({ validators, threshold: data.threshold });
    data.policyFingerprint = policyFingerprint(data.proposedPolicy);
    return data;
  }

  _groupDefinition (groupIdOrData) {
    const data = typeof groupIdOrData === 'string'
      ? this.store.get('groups', groupIdOrData)
      : groupIdOrData;
    if (!data) return null;
    if (data._contractDefinition && isGroupContractDefinition(data._contractDefinition)) {
      return data._contractDefinition;
    }
    if (!data.contractId && !data.id) return null;
    try {
      return groupContractDefinition({
        groupId: data.id,
        creator: data.creator,
        validators: this._signerList(data),
        threshold: data.threshold,
        createdAt: data.createdAt,
        meta: {
          name: data.name,
          visibility: data.visibility,
          slug: data.slug || null,
          parentId: data.parentId || null
        }
      });
    } catch (_) {
      return null;
    }
  }

  _syncGroupStatechain (contractId, definition) {
    if (!contractId || !definition) return null;
    const groupStatechain = require('../functions/groupStatechain');
    const { gooncitizenContractId } = require('../contracts/gooncitizen');
    return groupStatechain.publishFoldedContent(this.store, contractId, definition, {
      name: GROUP_CONTRACT_NAME,
      parentContractId: gooncitizenContractId()
    });
  }

  /**
   * Tip + roster for GroupChat sealing (latest local ContractStateTip).
   * Ensures genesis fold exists so clock/digest are stable across members.
   * @param {string} groupId
   * @returns {{ contractId: string, clock: number, stateDigest: string, memberPubkeys: string[], groupId: string }}
   */
  getChatSealTip (groupId) {
    const { group, definition } = this.ensureContract(groupId);
    const contractId = group.contractId || groupContractId(definition);
    if (!contractId || !definition) {
      throw new Error('group Federation contract is not ready');
    }
    const groupStatechain = require('../functions/groupStatechain');
    let tip = groupStatechain.tipForChatSeal(this.store, contractId, definition);
    // First seal after create: materialize an empty fold so peers share clock≥1 tip.
    if ((Number(tip.clock) || 0) === 0) {
      this._syncGroupStatechain(contractId, definition);
      tip = groupStatechain.tipForChatSeal(this.store, contractId, definition);
    }
    return Object.assign({ groupId: group.id }, tip);
  }

  /**
   * Append an accepted membership event to the group Statechain journal and fold.
   * @param {string} groupId
   * @param {Object} entry
   * @param {string} entry.id
   * @param {string} entry.type
   * @param {object} entry.message
   * @param {string} [entry.acceptedAt]
   */
  _appendGroupStatechain (groupId, entry) {
    try {
      const data = this.store.get('groups', groupId);
      if (!data || !data.contractId) return null;
      const definition = this._groupDefinition(data);
      if (!definition) return null;
      const groupStatechain = require('../functions/groupStatechain');
      const { gooncitizenContractId } = require('../contracts/gooncitizen');
      return groupStatechain.appendAccepted(
        this.store,
        data.contractId,
        entry,
        definition,
        { name: GROUP_CONTRACT_NAME, parentContractId: gooncitizenContractId() }
      );
    } catch (err) {
      this.emit('warning', '[GroupManager] group statechain append failed:',
        err && err.message ? err.message : err);
      return null;
    }
  }

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

  /** @returns {Group|null} Hydrated group from raw store record (or null). */
  _hydrate (data) {
    return data ? new Group(data) : null;
  }

  /** @returns {Group|null} Look up by id. */
  getGroup (id) {
    return this._hydrate(this.store.get('groups', id));
  }

  /** @returns {Group|null} Look up by Fabric Federation contract id. */
  getGroupByContractId (contractId) {
    if (!contractId) return null;
    const match = this.groups.find((g) => g.contractId === contractId);
    return this._hydrate(match || null);
  }

  /** All known group Federation contract ids (for FabricNetwork routing). */
  knownContractIds () {
    return this.groups.map((g) => g.contractId).filter(Boolean);
  }

  /**
   * Resolve a group by id or custom slug.
   * @param {String} idOrSlug Path segment from `/groups/:idOrSlug`.
   * @returns {Group|null}
   */
  findGroup (idOrSlug) {
    if (!idOrSlug) return null;
    const byId = this.getGroup(idOrSlug);
    if (byId) return byId;
    const match = this.groups.find((g) => g.slug === idOrSlug);
    return this._hydrate(match || null);
  }

  /**
   * Build (or return existing) Federation genesis for a group. Persists
   * `contractId` / `proposedPolicy` / `policyFingerprint` on first call.
   * Does not publish — caller (LiveRelay) publishes via FabricNetwork.
   * @param {string} groupId
   * @returns {{ group: Object, definition: Object, created: boolean }}
   */
  ensureContract (groupId) {
    const data = this.store.get('groups', groupId);
    if (!data) throw new Error('group not found');
    if (data._contractDefinition) {
      if (!data.contractId) data.contractId = groupContractId(data._contractDefinition);
      this.store.put('groups', groupId, data);
      return { group: new Group(data).toJSON(), definition: data._contractDefinition, created: false };
    }
    const policy = normalizeProposedPolicy({
      validators: this._signerList(data),
      threshold: data.threshold
    });
    const definition = groupContractDefinition({
      groupId: data.id,
      creator: data.creator,
      validators: policy.validators,
      threshold: policy.threshold,
      createdAt: data.createdAt,
      meta: {
        name: data.name,
        visibility: data.visibility,
        slug: data.slug,
        parentId: data.parentId || null
      }
    });
    const contractId = groupContractId(definition);
    data.contractId = contractId;
    data.validators = policy.validators;
    data.proposedPolicy = definition.proposedPolicy;
    data.policyFingerprint = policyFingerprint(definition.proposedPolicy);
    // Persist genesis so republish stays id-stable (do not recompute from
    // a later membership roster).
    data._contractDefinition = definition;
    this.store.put('groups', groupId, data);
    const json = new Group(data).toJSON();
    this.emit('group:contract', { group: json, definition, created: true });
    return { group: json, definition, created: true };
  }

  /**
   * Upsert a group from a remote CONTRACT_PUBLISH (GoonCitizenGroup).
   * Idempotent on contractId / groupId.
   * @param {Object} definition
   * @param {string|null} [source] Signer pubkey
   * @returns {{ group: Object, created: boolean }}
   */
  ingestContractPublish (definition, source = null) {
    if (!isGroupContractDefinition(definition)) {
      throw new Error('not a GoonCitizenGroup contract definition');
    }
    const contractId = groupContractId(definition);
    const existing = this.getGroupByContractId(contractId) || this.getGroup(definition.groupId);
    const policy = normalizeProposedPolicy(definition.proposedPolicy);
    if (!policy) throw new Error('invalid proposedPolicy on group contract');

    if (existing) {
      let data = this.store.get('groups', existing.id);
      data.contractId = contractId;
      data.proposedPolicy = policy;
      data.policyFingerprint = policyFingerprint(policy);
      data._contractDefinition = definition;
      // Do not clobber a richer local roster with an older genesis unless
      // local has no members yet.
      if (!data.members || !data.members.length) {
        data.members = policy.validators.slice();
        data.validators = policy.validators.slice();
        data.threshold = policy.threshold;
      } else if (!data.validators || !data.validators.length) {
        data.validators = policy.validators.slice();
      }
      if (definition.meta) {
        if (definition.meta.name) data.name = definition.meta.name;
        if (definition.meta.visibility) data.visibility = definition.meta.visibility;
        if (definition.meta.slug !== undefined) data.slug = definition.meta.slug;
        if (definition.meta.parentId !== undefined) data.parentId = definition.meta.parentId;
      }
      // Remap provisional invite-* shells onto the inviter's Fabric groupId.
      if (definition.groupId && data.id !== definition.groupId) {
        data = this._remapGroupRecord(data.id, definition.groupId, data) || data;
      }
      this.store.put('groups', data.id, data);
      const json = new Group(data).toJSON();
      if (data._contractDefinition) json._contractDefinition = data._contractDefinition;
      this.emit('group:ingested', { group: json, created: false, source });
      this.emit('group:journal-needed', { group: json, contractId, fromClock: 1 });
      return { group: json, created: false };
    }

    const group = new Group({
      id: definition.groupId,
      name: (definition.meta && definition.meta.name) || 'Unnamed group',
      creator: definition.creator,
      members: policy.validators.slice(),
      threshold: policy.threshold,
      visibility: (definition.meta && definition.meta.visibility) || 'private',
      slug: (definition.meta && definition.meta.slug) || null,
      parentId: (definition.meta && definition.meta.parentId) || null,
      createdAt: definition.createdAt || new Date().toISOString(),
      contractId,
      proposedPolicy: policy,
      policyFingerprint: policyFingerprint(policy)
    });
    group.validate();
    const json = group.toJSON();
    json._contractDefinition = definition;
    this.store.put('groups', json.id, json);
    this._audit(source || definition.creator, 'group.ingest', json.id, `contract ${contractId.slice(0, 12)}…`);
    try {
      this._syncGroupStatechain(contractId, definition);
    } catch (err) {
      this.emit('warning', '[GroupManager] contract sidechain provision failed:',
        err && err.message ? err.message : err);
    }
    const createdJson = new Group(json).toJSON();
    if (json._contractDefinition) createdJson._contractDefinition = json._contractDefinition;
    this.emit('group:ingested', { group: createdJson, created: true, source });
    this.emit('group:journal-needed', { group: createdJson, contractId, fromClock: 1 });
    return { group: createdJson, created: true };
  }

  /**
   * Remap a provisional local group id (e.g. invite-*) onto the inviter's
   * Fabric groupId. The contractId (Actor id) remains the group's Fabric identity.
   * @param {string} oldId
   * @param {string} newId
   * @param {object} [data]
   * @returns {object|null}
   */
  _remapGroupRecord (oldId, newId, data = null) {
    const from = String(oldId || '').trim();
    const to = String(newId || '').trim();
    if (!from || !to || from === to) return data || this.store.get('groups', from);
    const record = data || this.store.get('groups', from);
    if (!record) return null;
    if (this.store.get('groups', to) && to !== from) {
      // Prefer the canonical id's row; copy missing fields then drop provisional.
      const canonical = this.store.get('groups', to);
      if (!canonical.contractId && record.contractId) canonical.contractId = record.contractId;
      if ((!canonical.members || !canonical.members.length) && record.members) {
        canonical.members = record.members.slice();
      }
      this.store.put('groups', to, canonical);
      this.store.del('groups', from);
      return canonical;
    }
    record.id = to;
    this.store.put('groups', to, record);
    this.store.del('groups', from);
    return record;
  }

  /**
   * Materialize (or refresh) a local group shell from a FederationContractInvite
   * when the full genesis definition is not available. Keyed by contractId so
   * later GroupChange / CONTRACT_PUBLISH can converge on the same record.
   *
   * Prefers inviter `groupId` / `groupName` (Fabric identity fields on the
   * invite) over provisional `invite-<contractPrefix>` / note-as-name.
   *
   * @param {Object} invite Parsed FederationContractInvite
   * @param {string|null} [source]
   * @returns {{ group: Object, created: boolean }|null}
   */
  ingestFederationInviteShell (invite, source = null) {
    if (!invite || !invite.contractId) return null;
    const policy = normalizeProposedPolicy(invite.proposedPolicy);
    if (!policy) return null;
    const contractId = String(invite.contractId).trim();
    const existing = this.getGroupByContractId(contractId);
    const creator = String(invite.inviterHubId || policy.validators[0] || '').toLowerCase();
    const members = policy.validators.slice();
    if (creator && Group.isValidPubkey(creator) && !members.includes(creator)) {
      members.unshift(creator);
    }
    const invitedName = (invite.groupName && String(invite.groupName).trim())
      ? String(invite.groupName).trim().slice(0, 80)
      : ((invite.note && String(invite.note).trim())
        ? String(invite.note).trim().slice(0, 80)
        : 'Invited group');
    const invitedGroupId = (invite.groupId && String(invite.groupId).trim())
      ? String(invite.groupId).trim().slice(0, 96)
      : null;

    if (existing) {
      let data = this.store.get('groups', existing.id);
      data.contractId = contractId;
      if (!data.members || !data.members.length) {
        data.members = members.slice();
        data.validators = policy.validators.slice();
        data.threshold = Math.min(policy.threshold, policy.validators.length);
      }
      if (!data.validators || !data.validators.length) data.validators = this._signerList(data);
      this._syncPolicyFromSigners(data);
      if (!data.creator && creator) data.creator = creator;
      if (invite.groupName && String(invite.groupName).trim()) {
        data.name = String(invite.groupName).trim().slice(0, 80);
      }
      if (invitedGroupId && data.id !== invitedGroupId) {
        data = this._remapGroupRecord(data.id, invitedGroupId, data) || data;
      }
      this.store.put('groups', data.id, data);
      return { group: new Group(data).toJSON(), created: false };
    }

    const groupId = invitedGroupId || `invite-${contractId.slice(0, 16)}`;
    const group = new Group({
      id: groupId,
      name: invitedName,
      creator: creator || members[0],
      members,
      validators: policy.validators.slice(),
      threshold: Math.min(policy.threshold, policy.validators.length),
      visibility: 'private',
      createdAt: invite.invitedAt
        ? new Date(Number(invite.invitedAt)).toISOString()
        : new Date().toISOString(),
      contractId,
      proposedPolicy: policy,
      policyFingerprint: policyFingerprint(policy)
    });
    group.validate();
    const json = group.toJSON();
    this.store.put('groups', json.id, json);
    this._audit(source || creator, 'group.invite-shell', json.id, `contract ${contractId.slice(0, 12)}…`);
    this.emit('group:ingested', { group: json, created: true, source: source || 'federation-invite' });
    this.emit('group:journal-needed', { group: json, contractId, fromClock: 1 });
    return { group: json, created: true };
  }

  /**
   * Merge a remote GroupJournalBatch into local Statechain + roster.
   * @param {object} batch
   * @param {string|null} [source]
   * @returns {{ applied: number, group: object|null, verified: boolean }}
   */
  ingestJournalBatch (batch, source = null) {
    if (!batch || !batch.contractId) {
      return { applied: 0, group: null, verified: false };
    }
    const groupStatechain = require('../functions/groupStatechain');
    const { verifyGroupStateTip } = require('../functions/groupStateSigning');
    const contractId = String(batch.contractId).trim();
    let group = this.getGroupByContractId(contractId);
    if (!group && batch.groupId) group = this.getGroup(batch.groupId);
    if (!group) {
      // Materialize shell from batch identity fields when possible.
      if (batch.groupId && Array.isArray(batch.entries)) {
        const shell = this.ingestFederationInviteShell({
          contractId,
          groupId: batch.groupId,
          groupName: batch.groupName || null,
          note: batch.groupName || null,
          inviterHubId: source,
          proposedPolicy: batch.proposedPolicy || null,
          invitedAt: Date.now()
        }, source || 'journal-batch');
        group = shell && shell.group;
      }
    }
    if (!group) return { applied: 0, group: null, verified: false };

    const data = this.store.get('groups', group.id);
    const definition = this._groupDefinition(data);
    if (!definition) return { applied: 0, group: new Group(data).toJSON(), verified: false };

    if (batch.groupId && data.id !== batch.groupId) {
      const remapped = this._remapGroupRecord(data.id, batch.groupId, data);
      if (remapped) Object.assign(data, remapped);
    }
    if (batch.groupName && String(batch.groupName).trim()) {
      data.name = String(batch.groupName).trim().slice(0, 80);
    }

    const { gooncitizenContractId } = require('../contracts/gooncitizen');
    const merged = groupStatechain.mergeJournalEntries(
      this.store,
      contractId,
      batch.entries || [],
      definition,
      { name: GROUP_CONTRACT_NAME, parentContractId: gooncitizenContractId() }
    );

    // Fold roster from Statechain content when present.
    const content = merged.content || {};
    if (Array.isArray(content.members) && content.members.length) {
      data.members = content.members.slice();
      if (Array.isArray(content.signers) && content.signers.length) {
        data.validators = content.signers.slice();
        data.threshold = content.threshold != null
          ? Number(content.threshold)
          : (content.proposedPolicy && content.proposedPolicy.threshold) || data.threshold;
      } else if (content.proposedPolicy && Array.isArray(content.proposedPolicy.validators)) {
        data.validators = content.proposedPolicy.validators.slice();
        data.threshold = content.proposedPolicy.threshold || data.threshold;
      } else if (!data.validators || !data.validators.length) {
        data.validators = data.members.slice();
      }
      this._syncPolicyFromSigners(data);
    }
    data.contractId = contractId;
    data._contractDefinition = definition;
    this.store.put('groups', data.id, data);

    let verified = true;
    if (batch.signatures && typeof batch.signatures === 'object' && Object.keys(batch.signatures).length) {
      verified = verifyGroupStateTip(
        new Group(data),
        contractId,
        batch.tipClock != null ? batch.tipClock : merged.head.clock,
        batch.stateDigest || groupStatechain.stateDigestOfContent(content),
        batch.signatures
      );
    }

    const json = new Group(data).toJSON();
    if (data._contractDefinition) json._contractDefinition = data._contractDefinition;
    this.emit('group:journal-merged', {
      group: json,
      applied: merged.applied,
      verified,
      source
    });
    return { applied: merged.applied, group: json, verified };
  }

  /**
   * Invitee self-join after accepting a pending FederationContractInvite.
   * Does not require the actor to already be a member (unlike {@link #addMember}).
   *
   * @param {string} groupId
   * @param {string} pubkey Invitee pubkey
   * @param {Object} invite Stored / parsed invite
   * @returns {Object} Updated group JSON
   */
  async joinFromPendingInvite (groupId, pubkey, invite) {
    const data = this.store.get('groups', groupId);
    if (!data) throw Object.assign(new Error('group not found'), { code: 'NOT_FOUND' });
    if (!Group.isValidPubkey(pubkey)) throw new Error('invalid member pubkey');
    if (!invite || !invite.inviteId) throw new Error('invite required');
    if (data.contractId && invite.contractId && data.contractId !== invite.contractId) {
      throw new Error('invite contract does not match group');
    }
    if (data.members.includes(pubkey)) return new Group(data).toJSON();

    const role = String(invite.role || 'signer').toLowerCase() === 'reader' ? 'reader' : 'signer';
    data.members = data.members.concat([pubkey]);
    if (!Array.isArray(data.validators) || !data.validators.length) {
      data.validators = this._signerList(data);
    }
    if (role === 'signer' && !data.validators.includes(pubkey)) {
      data.validators = data.validators.concat([pubkey]);
    }
    this._syncPolicyFromSigners(data);
    const group = new Group(data);
    group.validate();
    const json = group.toJSON();
    this.store.put('groups', groupId, Object.assign({}, data, json));
    this._audit(pubkey, 'group.invite.accept', groupId, invite.inviteId);
    const change = {
      id: this._id('gchg'),
      action: 'member.add',
      groupId,
      contractId: data.contractId || invite.contractId || null,
      actor: pubkey,
      member: pubkey,
      role,
      via: 'FederationContractInvite',
      inviteId: invite.inviteId,
      ts: new Date().toISOString()
    };
    this.emit('group:member-added', { groupId, pubkey, actor: pubkey, via: 'invite', role });
    this.emit('group:local-change', change);
    this._appendGroupStatechain(groupId, {
      id: change.id,
      type: 'GroupChange',
      message: change,
      acceptedAt: change.ts
    });
    return new Group(this.store.get('groups', groupId)).toJSON();
  }

  /**
   * Apply a remote GroupChange. Actions: member.add | member.remove | update.
   * Idempotent where possible.
   * @param {Object} change
   * @param {string|null} [source]
   * @returns {Object} `{ group, applied, skipped }` — `skipped` only when not applied
   */
  ingestGroupChange (change = {}, source = null) {
    const contractId = change.contractId || null;
    const groupId = change.groupId || null;
    const group = (contractId && this.getGroupByContractId(contractId)) || (groupId && this.getGroup(groupId));
    if (!group) return { group: null, applied: false, skipped: 'group-unknown' };

    const data = this.store.get('groups', group.id);
    const action = String(change.action || '');
    const actor = change.actor || source || null;
    const changeId = change.id || null;
    if (changeId) {
      const seen = this.store.get('groupchanges', changeId);
      if (seen) return { group: new Group(data).toJSON(), applied: false, skipped: 'duplicate' };
    }

    if (action === 'member.add') {
      const pubkey = String(change.member || '').trim();
      if (!Group.isValidPubkey(pubkey)) return { group: null, applied: false, skipped: 'bad-member' };
      if (!data.members.includes(pubkey)) {
        data.members = data.members.concat([pubkey]);
      }
      if (!Array.isArray(data.validators) || !data.validators.length) {
        data.validators = this._signerList(data);
      }
      const role = String(change.role || 'signer').toLowerCase() === 'reader' ? 'reader' : 'signer';
      if (role === 'signer' && !data.validators.includes(pubkey)) {
        data.validators = data.validators.concat([pubkey]);
      }
    } else if (action === 'member.remove') {
      const pubkey = String(change.member || '').trim();
      if (pubkey === data.creator) return { group: null, applied: false, skipped: 'creator' };
      data.members = data.members.filter((m) => m !== pubkey);
      data.validators = this._signerList(data).filter((m) => m !== pubkey);
      data.threshold = Math.min(data.threshold, data.validators.length || 1);
    } else if (action === 'update' && change.patch && typeof change.patch === 'object') {
      const patch = change.patch;
      if (patch.name !== undefined) data.name = String(patch.name || data.name);
      if (patch.threshold !== undefined) data.threshold = Number(patch.threshold) || data.threshold;
      if (patch.visibility === 'public' || patch.visibility === 'private') data.visibility = patch.visibility;
      if (patch.slug !== undefined) {
        try { data.slug = Group.normalizeSlug(patch.slug); } catch (_) { /* ignore bad remote slug */ }
      }
      if (patch.primaryColor !== undefined) {
        const { sanitizePrimaryColor } = require('../functions/groupPrimaryColor');
        data.primaryColor = sanitizePrimaryColor(patch.primaryColor);
      }
    } else {
      return { group: null, applied: false, skipped: 'bad-action' };
    }

    this._syncPolicyFromSigners(data);
    // Invalidate cached Federation in hydrated Group on next access.
    const g = new Group(data);
    g.validate();
    const json = g.toJSON();
    // Preserve genesis definition for republish stability.
    if (data._contractDefinition) json._contractDefinition = data._contractDefinition;
    if (data.contractId) json.contractId = data.contractId;
    this.store.put('groups', json.id, Object.assign({}, data, json));
    if (changeId) {
      this.store.put('groupchanges', changeId, {
        id: changeId,
        groupId: json.id,
        contractId: json.contractId,
        action,
        ts: change.ts || new Date().toISOString(),
        source: actor
      });
    }
    this._audit(actor, `group.change.${action}`, json.id, change.member || '');
    this._appendGroupStatechain(json.id, {
      id: changeId || this._id('gchg'),
      type: 'GroupChange',
      message: {
        id: changeId,
        action,
        groupId: json.id,
        contractId: json.contractId,
        actor,
        member: change.member || null,
        patch: change.patch || null,
        ts: change.ts || new Date().toISOString()
      },
      acceptedAt: change.ts || new Date().toISOString()
    });
    this.emit('group:changed', { group: json, change, source: actor });
    return { group: json, applied: true };
  }

  /** Groups the pubkey belongs to. */
  groupsFor (pubkey) {
    return this.groups.filter((g) => Array.isArray(g.members) && g.members.includes(pubkey));
  }

  /** @returns {Boolean} True when pubkey is a direct member of group `groupId`. */
  isMember (groupId, pubkey) {
    const g = this.store.get('groups', groupId);
    return !!(g && Array.isArray(g.members) && g.members.includes(pubkey));
  }

  /** Immediate child groups of `parentId`. */
  childrenOf (parentId) {
    if (!parentId) return [];
    return this.groups.filter((g) => g.parentId === parentId);
  }

  /**
   * Depth-first descendant ids of `groupId` (subgroups, nested).
   * @param {String} groupId
   * @param {number} [maxDepth=8]
   * @returns {String[]}
   */
  descendantIds (groupId, maxDepth = 8) {
    const out = [];
    const walk = (id, depth) => {
      if (depth > maxDepth) return;
      for (const child of this.childrenOf(id)) {
        out.push(child.id);
        walk(child.id, depth + 1);
      }
    };
    walk(groupId, 1);
    return out;
  }

  /**
   * True when pubkey is a direct member of `groupId`, or of any subgroup
   * beneath it. Used for group-scoped mission broadcasts (fleet → wings).
   */
  isInGroupTree (groupId, pubkey) {
    if (!groupId || !pubkey) return false;
    if (this.isMember(groupId, pubkey)) return true;
    for (const id of this.descendantIds(groupId)) {
      if (this.isMember(id, pubkey)) return true;
    }
    return false;
  }

  /**
   * Can `viewer` see the full group page / member JSON?
   * Public groups: anyone. Private: members only.
   */
  canView (group, viewer) {
    if (!group) return false;
    if (group.isPublic()) return true;
    return !!(viewer && group.includes(viewer));
  }

  /**
   * JSON for a viewer: full for members, public summary for non-members of
   * public groups, null when forbidden.
   */
  viewFor (group, viewer) {
    if (!group) return null;
    const member = !!(viewer && group.includes(viewer));
    if (member) return Object.assign(group.toJSON(), { role: group.creator === viewer ? 'creator' : 'member' });
    if (group.isPublic()) {
      return Object.assign(group.toPublicJSON(), { role: 'visitor', canApply: true });
    }
    return null;
  }

  _assertSlugAvailable (slug, exceptId) {
    if (!slug) return;
    const clash = this.groups.find((g) => g.slug === slug && g.id !== exceptId);
    if (clash) throw new Error(`slug already in use: ${slug}`);
    if (this.store.get('groups', slug)) throw new Error(`slug collides with a group id: ${slug}`);
  }

  /**
   * Create a group. The creator (authenticated pubkey) is always a member.
   * Optional `parentId` nests this as a subgroup (actor must be a member of
   * the parent; cycles and excessive depth are rejected).
   * @param {Object} data Group fields (`name`, optional `members` / `threshold` / `visibility` / `slug` / `parentId`).
   * @param {String} creator Authenticated creator pubkey.
   */
  async createGroup (data = {}, creator) {
    if (!Group.isValidPubkey(creator)) {
      const e = new Error('creator must be an authenticated pubkey'); e.code = 'FORBIDDEN'; throw e;
    }
    const parentId = data.parentId || null;
    if (parentId) {
      const parent = this.getGroup(parentId);
      if (!parent) throw new Error('parent group not found');
      if (!parent.includes(creator)) {
        const e = new Error('forbidden: only a parent-group member may create a subgroup');
        e.code = 'FORBIDDEN';
        throw e;
      }
      // Cap nesting so a bad client cannot build an unbounded tree.
      let depth = 1;
      let walk = parent.parentId;
      while (walk) {
        depth += 1;
        if (depth > 8) throw new Error('subgroup nesting exceeds maximum depth (8)');
        const up = this.getGroup(walk);
        if (!up) break;
        walk = up.parentId;
      }
    }
    const members = [...new Set([creator].concat(Array.isArray(data.members) ? data.members : []))];
    const validators = [...new Set([creator].concat(Array.isArray(data.validators) ? data.validators : members))];
    const slug = Group.normalizeSlug(data.slug);
    this._assertSlugAvailable(slug, null);
    const createdAt = new Date().toISOString();
    const id = data.id || this._id();
    const threshold = data.threshold;
    const visibility = data.visibility === 'public' ? 'public' : 'private';
    const policy = normalizeProposedPolicy({ validators, threshold });
    const definition = groupContractDefinition({
      groupId: id,
      creator,
      validators: policy.validators,
      threshold: policy.threshold,
      createdAt,
      meta: { name: data.name || 'Unnamed group', visibility, slug, parentId }
    });
    const contractId = groupContractId(definition);
    const group = new Group({
      id,
      name: data.name,
      creator,
      members,
      validators: policy.validators,
      threshold,
      visibility,
      slug,
      parentId,
      createdAt,
      contractId,
      proposedPolicy: definition.proposedPolicy,
      policyFingerprint: policyFingerprint(definition.proposedPolicy)
    });
    group.validate();
    if (this.store.get('groups', group.id)) throw new Error('group id already exists');
    const json = group.toJSON();
    json._contractDefinition = definition;
    this.store.put('groups', group.id, json);
    this._audit(creator, 'group.create', group.id, `${group.name} (${members.length} member(s), ${group.visibility}${parentId ? `, parent=${parentId}` : ''})`);

    // D-016 / ADR-001: provision local contract Statechain + folded genesis state.
    try {
      this._syncGroupStatechain(contractId, definition);
    } catch (err) {
      this.emit('warning', '[GroupManager] contract sidechain provision failed:',
        err && err.message ? err.message : err);
    }

    const publicJson = new Group(json).toJSON();
    this.emit('group:created', publicJson, { definition });
    return publicJson;
  }

  get proposals () {
    return this.store.all('groupchangeproposals');
  }

  /** Pending proposals for a group (shared log). */
  listProposals (groupId, { includeAdopted = false } = {}) {
    return this.proposals.filter((p) => {
      if (p.groupId !== groupId) return false;
      if (includeAdopted) return true;
      return p.status === 'pending';
    });
  }

  getProposal (proposalId) {
    return this.store.get('groupchangeproposals', proposalId) || null;
  }

  /**
   * Propose a membership/meta change. Appears in the shared log; adopts when
   * signer votes reach the group threshold (auto-adopts at threshold 1).
   * @param {object} opts
   * @param {string} opts.groupId
   * @param {string} opts.action member.add | member.remove | update
   * @param {string} opts.actor
   * @param {string} [opts.member]
   * @param {string} [opts.role]
   * @param {object} [opts.patch]
   * @param {string} [opts.signature] BIP340 hex; else local trust vote for signer actor
   * @returns {{ group: object, proposal: object, adopted: boolean, change: object|null }}
   */
  proposeChange (opts = {}) {
    const gcp = require('../functions/groupChangeProposal');
    const { pubkeysMatch } = require('../functions/identity');
    const groupId = opts.groupId;
    const actor = String(opts.actor || '');
    const data = this.store.get('groups', groupId);
    if (!data) throw new Error('group not found');
    if (!actor) throw new Error('actor required');
    const g0 = new Group(data);

    const action = String(opts.action || '');
    if (action === 'member.add') {
      if (!g0.includes(actor)) {
        const e = new Error('forbidden: only members may add members'); e.code = 'FORBIDDEN'; throw e;
      }
      const pubkey = String(opts.member || '').trim();
      if (!Group.isValidPubkey(pubkey)) throw new Error('invalid member pubkey');
      if (g0.includes(pubkey)) {
        return {
          group: g0.toJSON(),
          proposal: null,
          adopted: true,
          change: null,
          skipped: 'already-member'
        };
      }
    } else if (action === 'member.remove') {
      if (!pubkeysMatch(data.creator, actor)) {
        const e = new Error('forbidden: only the creator may remove members'); e.code = 'FORBIDDEN'; throw e;
      }
      const pubkey = String(opts.member || '').trim();
      if (pubkeysMatch(pubkey, data.creator)) throw new Error('creator cannot be removed');
      if (!g0.includes(pubkey)) {
        return {
          group: g0.toJSON(),
          proposal: null,
          adopted: true,
          change: null,
          skipped: 'not-member'
        };
      }
    } else if (action === 'update') {
      if (!pubkeysMatch(data.creator, actor)) {
        const e = new Error('forbidden: only the creator may change group settings'); e.code = 'FORBIDDEN'; throw e;
      }
      const patch = opts.patch && typeof opts.patch === 'object' ? opts.patch : {};
      if (patch.visibility !== undefined &&
          patch.visibility !== 'public' && patch.visibility !== 'private') {
        throw new Error('visibility must be public or private');
      }
      if (patch.slug !== undefined) {
        const slug = Group.normalizeSlug(patch.slug);
        this._assertSlugAvailable(slug, groupId);
        opts = Object.assign({}, opts, { patch: Object.assign({}, patch, { slug }) });
      }
      if (patch.primaryColor !== undefined && patch.primaryColor !== null && patch.primaryColor !== '') {
        const { sanitizePrimaryColor } = require('../functions/groupPrimaryColor');
        const color = sanitizePrimaryColor(patch.primaryColor);
        if (!color) throw new Error('primaryColor must be #RRGGBB');
        opts = Object.assign({}, opts, { patch: Object.assign({}, patch, { primaryColor: color }) });
      }
    } else {
      throw new Error(`unsupported proposal action: ${action}`);
    }

    const signers = this._signerList(data);
    const proposal = gcp.createProposalRecord({
      id: this._id('gprop'),
      groupId,
      contractId: data.contractId || null,
      action,
      member: opts.member != null ? String(opts.member) : null,
      role: opts.role != null ? String(opts.role) : null,
      patch: opts.patch || null,
      proposedBy: actor,
      threshold: data.threshold || 1
    });

    if (g0.isSigner(actor)) {
      const sig = opts.signature
        ? String(opts.signature).toLowerCase()
        : (`local:${proposal.id}`);
      if (opts.signature) {
        const ok = gcp.verifyProposalVote(proposal, actor, opts.signature);
        if (!ok) throw new Error('invalid proposal signature');
      }
      gcp.addVote(proposal, actor, sig);
    }

    this.store.put('groupchangeproposals', proposal.id, proposal);
    this._audit(actor, `group.proposal.${action}`, groupId, proposal.id);
    this._appendGroupStatechain(groupId, {
      id: proposal.id,
      type: 'GroupChangeProposal',
      message: gcp.proposalWireObject(proposal),
      acceptedAt: proposal.createdAt
    });
    this.emit('group:proposal', proposal);

    if (gcp.hasThresholdVotes(proposal, { validators: signers, threshold: data.threshold })) {
      return this.adoptProposal(proposal.id, { local: true });
    }
    return {
      group: new Group(this.store.get('groups', groupId)).toJSON(),
      proposal,
      adopted: false,
      change: null
    };
  }

  /**
   * Cast a validator vote on a pending proposal.
   * @param {string} proposalId
   * @param {string} voter
   * @param {string} signature BIP340 hex (or local: for trusted local path)
   * @param {object} [opts]
   * @param {boolean} [opts.requireVerify=true] Verify BIP340 (false only for trusted local)
   * @returns {{ group: object, proposal: object, adopted: boolean, change: object|null }}
   */
  castVote (proposalId, voter, signature, opts = {}) {
    const gcp = require('../functions/groupChangeProposal');
    const proposal = this.store.get('groupchangeproposals', proposalId);
    if (!proposal) throw new Error('proposal not found');
    if (proposal.status !== 'pending') throw new Error(`proposal already ${proposal.status}`);
    const data = this.store.get('groups', proposal.groupId);
    if (!data) throw new Error('group not found');
    const pk = String(voter || '').toLowerCase();
    const g = new Group(data);
    if (!g.isSigner(pk)) {
      const e = new Error('forbidden: only group validators may vote'); e.code = 'FORBIDDEN'; throw e;
    }
    const sig = String(signature || '').trim().toLowerCase();
    if (!sig) throw new Error('signature required');
    const requireVerify = opts.requireVerify !== false;
    if (requireVerify || !sig.startsWith('local:')) {
      if (!gcp.verifyProposalVote(proposal, pk, sig)) {
        throw new Error('invalid vote signature');
      }
    }
    gcp.addVote(proposal, pk, sig);
    this.store.put('groupchangeproposals', proposal.id, proposal);
    this._audit(pk, 'group.proposal.vote', proposal.groupId, proposal.id);
    this._appendGroupStatechain(proposal.groupId, {
      id: `${proposal.id}:vote:${pk}`,
      type: 'GroupChangeVote',
      message: gcp.voteWireObject(proposal, pk, sig),
      acceptedAt: new Date().toISOString()
    });
    this.emit('group:vote', { proposal, voter: pk });

    if (gcp.hasThresholdVotes(proposal, data)) {
      return this.adoptProposal(proposal.id, { local: opts.local === true });
    }
    return {
      group: new Group(data).toJSON(),
      proposal,
      adopted: false,
      change: null
    };
  }

  /**
   * Apply a pending proposal once threshold votes are present.
   * @param {string} proposalId
   * @param {object} [opts]
   * @returns {{ group: object, proposal: object, adopted: boolean, change: object|null }}
   */
  adoptProposal (proposalId, opts = {}) {
    const gcp = require('../functions/groupChangeProposal');
    const proposal = this.store.get('groupchangeproposals', proposalId);
    if (!proposal) throw new Error('proposal not found');
    if (proposal.status === 'adopted') {
      const group = this.getGroup(proposal.groupId);
      return { group: group ? group.toJSON() : null, proposal, adopted: true, change: null };
    }
    const data = this.store.get('groups', proposal.groupId);
    if (!data) throw new Error('group not found');
    if (!gcp.hasThresholdVotes(proposal, data)) {
      throw new Error('proposal lacks threshold votes');
    }

    proposal.adoptedChangeId = this._id('gchg');
    proposal.adoptedAt = new Date().toISOString();
    proposal.status = 'adopted';
    this.store.put('groupchangeproposals', proposal.id, proposal);

    const change = gcp.changeFromProposal(proposal);
    const result = this.ingestGroupChange(change, proposal.proposedBy);
    if (result.applied && opts.local !== false) {
      this.emit('group:local-change', change);
    }
    if (result.applied) {
      if (change.action === 'member.add') {
        this.emit('group:member-added', {
          groupId: change.groupId,
          pubkey: change.member,
          actor: change.actor,
          role: change.role
        });
      } else if (change.action === 'member.remove') {
        this.emit('group:member-removed', {
          groupId: change.groupId,
          pubkey: change.member,
          actor: change.actor
        });
      } else if (change.action === 'update') {
        this.emit('group:updated', result.group);
      }
    }
    this.emit('group:proposal-adopted', { proposal, change, group: result.group });
    return {
      group: result.group || new Group(this.store.get('groups', proposal.groupId)).toJSON(),
      proposal: this.store.get('groupchangeproposals', proposal.id),
      adopted: !!result.applied,
      change: result.applied ? change : null
    };
  }

  /**
   * Ingest a remote GroupChangeProposal (mesh). Does not auto-vote.
   * @param {object} object
   * @param {string|null} [source]
   */
  ingestGroupChangeProposal (object = {}, source = null) {
    const gcp = require('../functions/groupChangeProposal');
    const id = object.id || null;
    if (!id) return { applied: false, skipped: 'no-id' };
    if (this.store.get('groupchangeproposals', id)) {
      return { applied: false, skipped: 'duplicate', proposal: this.store.get('groupchangeproposals', id) };
    }
    const groupId = object.groupId || null;
    const contractId = object.contractId || null;
    const group = (contractId && this.getGroupByContractId(contractId)) ||
      (groupId && this.getGroup(groupId));
    if (!group) return { applied: false, skipped: 'group-unknown' };

    const proposal = gcp.createProposalRecord({
      id,
      groupId: group.id,
      contractId: group.contractId || contractId,
      action: object.action,
      member: object.member,
      role: object.role,
      patch: object.patch,
      proposedBy: object.proposedBy || source,
      createdAt: object.createdAt,
      threshold: object.threshold || group.threshold
    });
    proposal.status = object.status === 'adopted' ? 'pending' : (object.status || 'pending');
    if (proposal.status === 'adopted') proposal.status = 'pending';
    this.store.put('groupchangeproposals', proposal.id, proposal);
    this._appendGroupStatechain(group.id, {
      id: proposal.id,
      type: 'GroupChangeProposal',
      message: gcp.proposalWireObject(proposal),
      acceptedAt: proposal.createdAt
    });
    this._audit(proposal.proposedBy, `group.proposal.${proposal.action}`, group.id, proposal.id);
    this.emit('group:proposal', proposal);
    return { applied: true, proposal };
  }

  /**
   * Ingest a remote GroupChangeVote.
   * @param {object} object
   * @param {string|null} [source]
   */
  ingestGroupChangeVote (object = {}, source = null) {
    const proposalId = object.proposalId || null;
    const voter = String(object.voter || source || '').toLowerCase();
    const signature = object.signature || null;
    if (!proposalId || !voter || !signature) {
      return { applied: false, skipped: 'bad-vote' };
    }
    try {
      return this.castVote(proposalId, voter, signature, { requireVerify: true, local: false });
    } catch (err) {
      if (/not found|already|forbidden|invalid/i.test(err.message || '')) {
        return { applied: false, skipped: err.message, error: err };
      }
      throw err;
    }
  }

  /**
   * Update group settings (creator only): name, threshold, visibility, slug, primaryColor.
   * Published as a GroupChangeProposal until validators adopt.
   */
  async updateGroup (groupId, patch = {}, actor) {
    const clean = {};
    if (patch.name !== undefined) clean.name = String(patch.name || '');
    if (patch.threshold !== undefined) clean.threshold = Number(patch.threshold);
    if (patch.visibility !== undefined) clean.visibility = patch.visibility;
    if (patch.slug !== undefined) clean.slug = patch.slug;
    if (patch.primaryColor !== undefined) {
      const { sanitizePrimaryColor } = require('../functions/groupPrimaryColor');
      if (patch.primaryColor === null || patch.primaryColor === '') {
        clean.primaryColor = null;
      } else {
        const color = sanitizePrimaryColor(patch.primaryColor);
        if (!color) throw new Error('primaryColor must be #RRGGBB');
        clean.primaryColor = color;
      }
    }
    const result = this.proposeChange({
      groupId,
      action: 'update',
      actor,
      patch: clean
    });
    return result.group;
  }

  /**
   * Propose adding a member (adopted when votes ≥ threshold).
   * @param {string} groupId
   * @param {string} pubkey
   * @param {string} actor
   * @param {Object} [opts]
   * @param {string} [opts.role] `'reader'` or `'signer'`
   */
  async addMember (groupId, pubkey, actor, opts = {}) {
    const role = String(opts.role || 'signer').toLowerCase() === 'reader' ? 'reader' : 'signer';
    const result = this.proposeChange({
      groupId,
      action: 'member.add',
      actor,
      member: pubkey,
      role,
      signature: opts.signature
    });
    return result.group;
  }

  /**
   * Propose removing a member (creator proposes; validators adopt).
   * @param {string} groupId
   * @param {string} pubkey
   * @param {string} actor
   * @param {Object} [opts]
   */
  async removeMember (groupId, pubkey, actor, opts = {}) {
    const result = this.proposeChange({
      groupId,
      action: 'member.remove',
      actor,
      member: pubkey,
      signature: opts.signature
    });
    return result.group;
  }

  getGroupApplications (groupId) {
    return this.applications.filter((a) => a.groupId === groupId);
  }

  /**
   * Apply to join a public group (or any group when somehow invited via share —
   * applications are accepted only for public groups to keep private closed).
   */
  async applyToGroup (groupId, applicantId, message = '') {
    const group = this.getGroup(groupId);
    if (!group) throw new Error('group not found');
    if (!group.isPublic()) {
      const e = new Error('forbidden: only public groups accept join applications'); e.code = 'FORBIDDEN'; throw e;
    }
    if (!Group.isValidPubkey(applicantId)) throw new Error('applicant must be an authenticated pubkey');
    if (group.includes(applicantId)) throw new Error('already a member');
    const pending = this.applications.find((a) => a.groupId === groupId && a.applicantId === applicantId && a.status === 'pending');
    if (pending) throw new Error('application already pending');

    const id = this._id('gapp');
    const app = {
      id,
      groupId,
      applicantId,
      message: String(message || '').slice(0, 500),
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    this.store.put('groupapplications', id, app);
    this._audit(applicantId, 'group.application.submit', groupId, id);
    this._appendGroupStatechain(groupId, {
      id,
      type: 'GroupApplication',
      message: app,
      acceptedAt: app.createdAt
    });
    this.emit('group:application', app);
    return app;
  }

  /**
   * Accept or reject a join application (creator only).
   * Accept adds the applicant as a member.
   */
  async decideApplication (data = {}) {
    const app = this.store.get('groupapplications', data.applicationId);
    if (!app) throw new Error('application not found');
    if (app.status !== 'pending') throw new Error(`application already ${app.status}`);
    const group = this.store.get('groups', app.groupId);
    if (!group) throw new Error('group not found');
    if (group.creator !== data.actor) {
      const e = new Error('forbidden: only the creator may decide join applications'); e.code = 'FORBIDDEN'; throw e;
    }
    app.decidedBy = data.actor;
    app.decidedAt = new Date().toISOString();
    if (data.decision === 'accept') {
      app.status = 'accepted';
      this.store.put('groupapplications', app.id, app);
      this._appendGroupStatechain(app.groupId, {
        id: `${app.id}:decision`,
        type: 'GroupApplicationDecision',
        message: {
          applicationId: app.id,
          applicantId: app.applicantId,
          decision: 'accept',
          status: 'accepted',
          decidedBy: data.actor,
          decidedAt: app.decidedAt
        },
        acceptedAt: app.decidedAt
      });
      await this.addMember(app.groupId, app.applicantId, data.actor);
      this._audit(data.actor, 'group.application.accept', app.groupId, app.applicantId);
      this.emit('group:application-accepted', app);
    } else if (data.decision === 'reject') {
      app.status = 'rejected';
      app.reason = data.reason || null;
      this.store.put('groupapplications', app.id, app);
      this._appendGroupStatechain(app.groupId, {
        id: `${app.id}:decision`,
        type: 'GroupApplicationDecision',
        message: {
          applicationId: app.id,
          applicantId: app.applicantId,
          decision: 'reject',
          status: 'rejected',
          reason: app.reason,
          decidedBy: data.actor,
          decidedAt: app.decidedAt
        },
        acceptedAt: app.decidedAt
      });
      this._audit(data.actor, 'group.application.reject', app.groupId, app.applicantId);
      this.emit('group:application-rejected', app);
    } else {
      throw new Error('decision must be "accept" or "reject"');
    }
    return app;
  }

  /**
   * Journal a GroupActivityTree into the group's Statechain (local + inbound).
   * @param {string} groupId
   * @param {object} treeBody GroupActivityTree contract object
   * @param {string|null} source
   */
  ingestActivityTree (groupId, treeBody, source = null) {
    const group = this.getGroup(groupId);
    if (!group) throw new Error('group not found');
    if (!treeBody || !treeBody.root) throw new Error('GroupActivityTree root required');
    const entryId = `activity-tree:${treeBody.root}:${treeBody.generatedAt || ''}:${source || 'local'}`;
    const result = this._appendGroupStatechain(group.id, {
      id: entryId,
      type: 'GroupActivityTree',
      message: {
        root: treeBody.root,
        leafCount: treeBody.leafCount || 0,
        ownerPubkey: treeBody.ownerPubkey || source || null,
        generatedAt: treeBody.generatedAt || new Date().toISOString(),
        counts: treeBody.counts || null,
        digests: Array.isArray(treeBody.digests) ? treeBody.digests.slice(0, 50000) : []
      },
      acceptedAt: treeBody.generatedAt || new Date().toISOString()
    });
    this._audit(source || treeBody.ownerPubkey, 'group.activity-tree', group.id, treeBody.root);
    this.emit('group:activity-tree', { groupId: group.id, tree: treeBody, statechain: result });
    return result;
  }

  /**
   * Journal a FleetShare tip into the group's Statechain (local + inbound).
   * @param {string} groupId
   * @param {object} shareObject FleetShare wire/object tip (no heavy export required)
   * @param {string|null} source
   */
  ingestFleetShare (groupId, shareObject, source = null) {
    const group = this.getGroup(groupId);
    if (!group) throw new Error('group not found');
    const starjumpFleet = require('../functions/starjumpFleet');
    const tip = starjumpFleet.fleetShareJournalMessage(shareObject || {}, {
      groupId: group.id,
      source: source || null
    });
    if (!tip.fleetId) throw new Error('FleetShare fleetId required');
    const entryId = `fleet-share:${tip.fleetId}:${tip.sharedAt || ''}:${source || tip.ownerPubkey || 'local'}`;
    const result = this._appendGroupStatechain(group.id, {
      id: entryId,
      type: 'FleetShare',
      message: tip,
      acceptedAt: tip.sharedAt || new Date().toISOString()
    });
    this._audit(source || tip.ownerPubkey, 'group.fleet-share', group.id, tip.fleetId);
    this.emit('group:fleet-share', { groupId: group.id, fleet: tip, statechain: result });
    return result;
  }

  /**
   * Verify a k-of-n multisignature for a group decision.
   */
  verifyGroupSignature (groupId, multiSig, threshold) {
    const group = this.getGroup(groupId);
    if (!group) return false;
    return group.verifyMultiSignature(multiSig, threshold);
  }
}

module.exports = GroupManager;
