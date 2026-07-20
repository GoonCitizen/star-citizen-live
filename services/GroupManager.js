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
 * Persistence: uses `types/Store.js` → `@fabric/core` LevelDB under
 * `stores/gooncitizen/register` (Hub-style named store root).
 */

const crypto = require('crypto');
const path = require('path');
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
      validators: data.members,
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
      const data = this.store.get('groups', existing.id);
      data.contractId = contractId;
      data.proposedPolicy = policy;
      data.policyFingerprint = policyFingerprint(policy);
      data._contractDefinition = definition;
      // Do not clobber a richer local roster with an older genesis unless
      // local has no members yet.
      if (!data.members || !data.members.length) {
        data.members = policy.validators.slice();
        data.threshold = policy.threshold;
      }
      if (definition.meta) {
        if (definition.meta.name) data.name = definition.meta.name;
        if (definition.meta.visibility) data.visibility = definition.meta.visibility;
        if (definition.meta.slug !== undefined) data.slug = definition.meta.slug;
        if (definition.meta.parentId !== undefined) data.parentId = definition.meta.parentId;
      }
      this.store.put('groups', data.id, data);
      const json = new Group(data).toJSON();
      this.emit('group:ingested', { group: json, created: false, source });
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
    this.emit('group:ingested', { group: new Group(json).toJSON(), created: true, source });
    return { group: new Group(json).toJSON(), created: true };
  }

  /**
   * Apply a remote GroupChange. Actions: member.add | member.remove | update.
   * Idempotent where possible.
   * @param {Object} change
   * @param {string|null} [source]
   * @returns {{ group: Object|null, applied: boolean, skipped?: string }}
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
    } else if (action === 'member.remove') {
      const pubkey = String(change.member || '').trim();
      if (pubkey === data.creator) return { group: null, applied: false, skipped: 'creator' };
      data.members = data.members.filter((m) => m !== pubkey);
      data.threshold = Math.min(data.threshold, data.members.length);
    } else if (action === 'update' && change.patch && typeof change.patch === 'object') {
      const patch = change.patch;
      if (patch.name !== undefined) data.name = String(patch.name || data.name);
      if (patch.threshold !== undefined) data.threshold = Number(patch.threshold) || data.threshold;
      if (patch.visibility === 'public' || patch.visibility === 'private') data.visibility = patch.visibility;
      if (patch.slug !== undefined) {
        try { data.slug = Group.normalizeSlug(patch.slug); } catch (_) { /* ignore bad remote slug */ }
      }
    } else {
      return { group: null, applied: false, skipped: 'bad-action' };
    }

    data.proposedPolicy = normalizeProposedPolicy({
      validators: data.members,
      threshold: data.threshold
    });
    data.policyFingerprint = policyFingerprint(data.proposedPolicy);
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
   * @param {Object} data { name, members?, threshold?, visibility?, slug?, parentId? }
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
    const slug = Group.normalizeSlug(data.slug);
    this._assertSlugAvailable(slug, null);
    const createdAt = new Date().toISOString();
    const id = data.id || this._id();
    const threshold = data.threshold;
    const visibility = data.visibility === 'public' ? 'public' : 'private';
    const policy = normalizeProposedPolicy({ validators: members, threshold });
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

    // D-016 / ADR-001: provision a local contract Statechain for the Group
    // (same layout as Hub `sidechains/<contractId>/`).
    try {
      const contractSidechain = require('../functions/contractSidechain');
      const { gooncitizenContractId } = require('../contracts/gooncitizen');
      const registerPath = (this.store && this.store.path) || this.settings.dir || null;
      const storeRoot = registerPath
        ? path.dirname(registerPath)
        : (process.env.SC_SETTINGS_DIR || path.join(process.cwd(), 'stores', 'gooncitizen'));
      contractSidechain.ensureLocalContractChain(storeRoot, contractId, {
        name: GROUP_CONTRACT_NAME,
        parentContractId: gooncitizenContractId()
      });
      contractSidechain.publishContent(storeRoot, contractId, {
        '@type': 'GoonCitizenGroupState',
        groupId: id,
        contractId,
        meta: definition.meta || {},
        members: members.slice(),
        proposedPolicy: definition.proposedPolicy || null
      }, {
        name: GROUP_CONTRACT_NAME,
        parentContractId: gooncitizenContractId()
      });
    } catch (err) {
      this.emit('warning', '[GroupManager] contract sidechain provision failed:',
        err && err.message ? err.message : err);
    }

    const publicJson = new Group(json).toJSON();
    this.emit('group:created', publicJson, { definition });
    return publicJson;
  }

  /**
   * Update group settings (creator only): name, threshold, visibility, slug.
   */
  async updateGroup (groupId, patch = {}, actor) {
    const data = this.store.get('groups', groupId);
    if (!data) throw new Error('group not found');
    if (data.creator !== actor) {
      const e = new Error('forbidden: only the creator may change group settings'); e.code = 'FORBIDDEN'; throw e;
    }
    if (patch.name !== undefined) data.name = String(patch.name || data.name);
    if (patch.threshold !== undefined) data.threshold = Number(patch.threshold) || data.threshold;
    if (patch.visibility !== undefined) {
      if (patch.visibility !== 'public' && patch.visibility !== 'private') throw new Error('visibility must be public or private');
      data.visibility = patch.visibility;
    }
    if (patch.slug !== undefined) {
      const slug = Group.normalizeSlug(patch.slug);
      this._assertSlugAvailable(slug, groupId);
      data.slug = slug;
    }
    // Invalidate cached federation if membership-affecting fields changed.
    const group = new Group(data);
    group.validate();
    const json = group.toJSON();
    const prevDef = data._contractDefinition;
    const prevContractId = data.contractId;
    this.store.put('groups', groupId, Object.assign({}, json, {
      _contractDefinition: prevDef,
      contractId: prevContractId || json.contractId
    }));
    this._audit(actor, 'group.update', groupId, `visibility=${json.visibility} slug=${json.slug || '—'} threshold=${json.threshold}`);
    const change = {
      id: this._id('gchg'),
      action: 'update',
      groupId,
      contractId: prevContractId || json.contractId,
      actor,
      patch: {
        name: json.name,
        threshold: json.threshold,
        visibility: json.visibility,
        slug: json.slug
      },
      ts: new Date().toISOString()
    };
    this.emit('group:updated', json);
    this.emit('group:local-change', change);
    return new Group(this.store.get('groups', groupId)).toJSON();
  }

  /**
   * Add a member. Only existing members may add (or accept a join application).
   */
  async addMember (groupId, pubkey, actor) {
    const data = this.store.get('groups', groupId);
    if (!data) throw new Error('group not found');
    if (!data.members.includes(actor)) {
      const e = new Error('forbidden: only members may add members'); e.code = 'FORBIDDEN'; throw e;
    }
    if (!Group.isValidPubkey(pubkey)) throw new Error('invalid member pubkey');
    if (data.members.includes(pubkey)) return new Group(data).toJSON();
    data.members = data.members.concat([pubkey]);
    data.proposedPolicy = normalizeProposedPolicy({ validators: data.members, threshold: data.threshold });
    data.policyFingerprint = policyFingerprint(data.proposedPolicy);
    const group = new Group(data);
    group.validate();
    const json = group.toJSON();
    this.store.put('groups', groupId, Object.assign({}, data, json));
    this._audit(actor, 'group.member.add', groupId, pubkey);
    const change = {
      id: this._id('gchg'),
      action: 'member.add',
      groupId,
      contractId: data.contractId || null,
      actor,
      member: pubkey,
      ts: new Date().toISOString()
    };
    this.emit('group:member-added', { groupId, pubkey, actor });
    this.emit('group:local-change', change);
    return new Group(this.store.get('groups', groupId)).toJSON();
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
    if (!data.members.includes(pubkey)) return new Group(data).toJSON();
    data.members = data.members.filter((m) => m !== pubkey);
    data.threshold = Math.min(data.threshold, data.members.length);
    data.proposedPolicy = normalizeProposedPolicy({ validators: data.members, threshold: data.threshold });
    data.policyFingerprint = policyFingerprint(data.proposedPolicy);
    const group = new Group(data);
    group.validate();
    const json = group.toJSON();
    this.store.put('groups', groupId, Object.assign({}, data, json));
    this._audit(actor, 'group.member.remove', groupId, pubkey);
    const change = {
      id: this._id('gchg'),
      action: 'member.remove',
      groupId,
      contractId: data.contractId || null,
      actor,
      member: pubkey,
      ts: new Date().toISOString()
    };
    this.emit('group:member-removed', { groupId, pubkey, actor });
    this.emit('group:local-change', change);
    return new Group(this.store.get('groups', groupId)).toJSON();
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
      await this.addMember(app.groupId, app.applicantId, data.actor);
      this._audit(data.actor, 'group.application.accept', app.groupId, app.applicantId);
      this.emit('group:application-accepted', app);
    } else if (data.decision === 'reject') {
      app.status = 'rejected';
      app.reason = data.reason || null;
      this.store.put('groupapplications', app.id, app);
      this._audit(data.actor, 'group.application.reject', app.groupId, app.applicantId);
      this.emit('group:application-rejected', app);
    } else {
      throw new Error('decision must be "accept" or "reject"');
    }
    return app;
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
