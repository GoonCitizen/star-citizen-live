'use strict';

/**
 * GroupManager — member-created groups with k-of-n Schnorr multisig,
 * public/private visibility, custom page slugs, and join applications.
 *
 * Group pages live at `/groups/:id` (or `/groups/:slug` when a custom slug
 * is set). Public groups can be shared; visitors apply to join; the creator
 * accepts or rejects. Private groups are members-only.
 *
 * Persistence: uses `types/Store.js` → `@fabric/core` LevelDB under
 * `stores/gooncitizen/register` (Hub-style named store root).
 */

const crypto = require('crypto');
const EventEmitter = require('events');

const Group = require('../types/Group');
const { Store } = require('../types/Store');

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

  /** Groups the pubkey belongs to. */
  groupsFor (pubkey) {
    return this.groups.filter((g) => Array.isArray(g.members) && g.members.includes(pubkey));
  }

  /** @returns {Boolean} True when pubkey is a member of group `groupId`. */
  isMember (groupId, pubkey) {
    const g = this.store.get('groups', groupId);
    return !!(g && Array.isArray(g.members) && g.members.includes(pubkey));
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
   * @param {Object} data { name, members?, threshold?, visibility?, slug? }
   * @param {String} creator Authenticated creator pubkey.
   */
  async createGroup (data = {}, creator) {
    if (!Group.isValidPubkey(creator)) {
      const e = new Error('creator must be an authenticated pubkey'); e.code = 'FORBIDDEN'; throw e;
    }
    const members = [...new Set([creator].concat(Array.isArray(data.members) ? data.members : []))];
    const slug = Group.normalizeSlug(data.slug);
    this._assertSlugAvailable(slug, null);
    const group = new Group({
      id: data.id || this._id(),
      name: data.name,
      creator,
      members,
      threshold: data.threshold,
      visibility: data.visibility === 'public' ? 'public' : 'private',
      slug
    });
    group.validate();
    if (this.store.get('groups', group.id)) throw new Error('group id already exists');
    const json = group.toJSON();
    this.store.put('groups', group.id, json);
    this._audit(creator, 'group.create', group.id, `${group.name} (${members.length} member(s), ${group.visibility})`);
    this.emit('group:created', json);
    return json;
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
    this.store.put('groups', groupId, json);
    this._audit(actor, 'group.update', groupId, `visibility=${json.visibility} slug=${json.slug || '—'} threshold=${json.threshold}`);
    this.emit('group:updated', json);
    return json;
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
    if (!data.members.includes(pubkey)) return new Group(data).toJSON();
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
