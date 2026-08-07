'use strict';

/**
 * MissionManager — the org mission register (M5.1).
 *
 * Implements D-005: a centralized, OFFICER-VALIDATED register. Lifecycle:
 *   open --apply--> (applications) --officer accept / joinMission--> assigned
 *        (many accepted participants; mission stays open for more joins)
 *        --claim(any participant)--> pending claims
 *        --authorities approve ONE claim--> completed (+ other pending → superseded)
 *        --authorities reject claim--> mission stays assigned (re-claim allowed)
 *   open|assigned --officer cancel--> cancelled
 *
 * Claims may be individual or name a completionGroupId (group wallet payee).
 *
 * Every mutation appends a hash-chained AuditEntry (tamper-evident; M6 adds
 * officer signatures over each entry). Backed by types/Store.js (in-memory
 * or `@fabric/core` Store / LevelDB under `stores/` when a path is configured).
 * Keeps the method names/events the rest of the code already uses
 * (createMission/getMission/missions, start/stop) so nothing else breaks.
 *
 * Officer model: settings.officers is an allowlist of actor ids. If EMPTY, the
 * register runs in permissive "bootstrap" mode (everyone is an officer) so it is
 * usable before roles are wired (REST/Discord auth lands in M5.2/M5.3).
 *
 * Optional `settings.isGroupMember(groupId, pubkey)` gates completionGroupId.
 */

// Dependencies
const crypto = require('crypto');
const EventEmitter = require('events');
const secp256k1 = require('tiny-secp256k1');
const Actor = require('@fabric/core/types/actor');
const { Store } = require('../types/Store');

// Local Types
const Mission = require('../types/Mission');
const MissionApplication = require('../types/MissionApplication');

// Constants
const ZERO = '0'.repeat(64);
// TODO: replace with @fabric/core
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/**
 * Mission Manager service.
 * Handles mission lifecycle, applications, and cryptographic verification.
 * Supports both single secp256k1 signatures and Musig2 multisig.
 */
class MissionManager extends EventEmitter {
  /**
   * Create a MissionManager instance.
   * @param {Object} [settings] - Configuration settings.
   */
  constructor (settings = {}) {
    super();
    this.settings = Object.assign({ enable: true, officers: [], dir: null }, settings);
    this.officers = new Set((this.settings.officers || []).map(String));
    this.store = settings.store || new Store({ path: this.settings.dir || this.settings.path || null });
    this._counter = 0;
  }

  // ---- collections ----
  get missions () { return this.store.all('missions'); }
  get applications () { return this.store.all('applications'); }
  get claims () { return this.store.all('claims'); }
  get validations () { return this.store.all('validations'); }
  get audit () { return this.store.all('audit').sort((a, b) => a.seq - b.seq); }

  // Declarative API Properties
  get openMissions () {
    return this.missions.filter(m => m.status === 'open' && !m.isExpired);
  }

  get assignedMissions () {
    return this.missions.filter(m => m.status === 'assigned' || m.status === 'in_progress');
  }

  /** Ensure participantIds exists; seed from legacy assigneeId. */
  _ensureParticipants (m) {
    if (!m) return [];
    if (!Array.isArray(m.participantIds)) m.participantIds = [];
    if (m.assigneeId && !m.participantIds.includes(String(m.assigneeId))) {
      m.participantIds.push(String(m.assigneeId));
    }
    return m.participantIds;
  }

  _isParticipant (m, pubkey) {
    const id = String(pubkey || '');
    if (!id || !m) return false;
    this._ensureParticipants(m);
    if (m.participantIds.includes(id)) return true;
    if (m.assigneeId && String(m.assigneeId) === id) return true;
    return this.applications.some((a) => (
      a.missionId === m.id && a.status === 'accepted' && String(a.applicantId) === id
    ));
  }

  /** Mission still accepts joiners / claims (not terminal). */
  _isJoinable (m) {
    return m && (m.status === 'open' || m.status === 'assigned' || m.status === 'in_progress');
  }

  _addParticipant (m, pubkey) {
    const id = String(pubkey || '');
    if (!id || !m) return false;
    this._ensureParticipants(m);
    if (m.participantIds.includes(id)) return false;
    m.participantIds.push(id);
    if (!m.assigneeId) m.assigneeId = id;
    if (m.status === 'open') m.status = 'assigned';
    return true;
  }

  _supersedeOtherPendingClaims (missionId, keepClaimId, actor = null) {
    const superseded = [];
    for (const c of this.claims) {
      if (c.missionId !== missionId || c.id === keepClaimId) continue;
      if (c.status !== 'pending') continue;
      c.status = 'superseded';
      c.supersededAt = new Date().toISOString();
      c.supersedeReason = 'another claim accepted';
      this.store.put('claims', c.id, c);
      this._audit(actor, 'claim.supersede', 'claim', c.id, keepClaimId);
      this.emit('claim:superseded', c);
      superseded.push(c);
    }
    return superseded;
  }

  get completedMissions () {
    return this.missions.filter(m => m.status === 'completed');
  }

  async start () {
    if (this.store && typeof this.store.start === 'function') await this.store.start();
    this.emit('ready');
    return this;
  }

  async stop () {
    if (this.store && typeof this.store.stop === 'function' && !this.settings.store) {
      // Only stop when we own the store; shared LiveRelay registerStore is stopped by the relay.
      await this.store.stop();
    }
    this.emit('stopped');
    return this;
  }

  _id (prefix) { this._counter += 1; return `${prefix}-${Date.now().toString(36)}-${this._counter}`; }
  _mission (id) { const m = this.store.get('missions', id); if (!m) throw new Error('mission not found'); return m; }

  // ---- officer permission ----
  isOfficer (actor) { return this.officers.size === 0 || this.officers.has(String(actor)); }
  _requireOfficer (actor) { if (!this.isOfficer(actor)) { const e = new Error('forbidden: not an officer'); e.code = 'FORBIDDEN'; throw e; } }

  // ---- audit (hash chain; optional signed authorizations — M6) ----
  // `authorization` is the Schnorr evidence that authorized the mutation:
  // `{ message, signatures: { [pubkey]: sigHex } }`. It is part of the hashed
  // body, so it is tamper-evident, and verifyAudit re-checks the signatures.
  _audit (actor, action, entity, entityId, summary, authorization = null) {
    const chain = this.audit;
    const prevHash = chain.length ? chain[chain.length - 1].hash : ZERO;
    const body = { seq: chain.length, ts: new Date().toISOString(), actor: actor != null ? String(actor) : null, action, entity, entityId, summary: summary || '', authorization: authorization || null };
    const hash = sha256(prevHash + JSON.stringify(body));
    const entry = Object.assign({ id: `audit-${body.seq}` }, body, { prevHash, hash });
    this.store.put('audit', entry.id, entry);
    this.emit('audit', entry);
    return entry;
  }

  // Recompute the chain and confirm nothing was altered. Entries carrying a
  // signed authorization also have each Schnorr signature re-verified.
  verifyAudit () {
    let prev = ZERO;
    for (const e of this.audit) {
      const body = { seq: e.seq, ts: e.ts, actor: e.actor, action: e.action, entity: e.entity, entityId: e.entityId, summary: e.summary, authorization: e.authorization || null };
      if (e.prevHash !== prev || e.hash !== sha256(prev + JSON.stringify(body))) return false;
      if (e.authorization && e.authorization.signatures) {
        try {
          const Key = require('@fabric/core/types/key');
          for (const [pubkey, sig] of Object.entries(e.authorization.signatures)) {
            const key = new Key({ public: pubkey });
            if (!key.verifySchnorr(Buffer.from(String(e.authorization.message)), Buffer.from(String(sig), 'hex'))) return false;
          }
        } catch (_) { return false; }
      }
      prev = e.hash;
    }
    return true;
  }

  // ---- missions ----
  /**
   * Create a new mission.
   * @param {Object} data - Mission data.
   * @returns {Mission} Created mission.
   */
  async createMission (data = {}) {
    const officer = data.createdBy || data.officerId || null;
    this._requireOfficer(officer);
    const id = data.id || this._id('mission');
    // Authorities: pubkeys whose k-of-n signatures accept completion (and
    // unlock any Bitcoin payout). Defaults to the creator alone (1-of-1).
    const authorities = this._normalizeAuthorities(data.authorities, officer);
    const mission = {
      id,
      title: data.title || 'Untitled mission',
      type: data.type || 'bounty',
      description: data.description || '',
      reward: Number(data.reward) || 0,
      requirements: data.requirements || null,
      location: data.location || null,
      deadline: data.deadline || null,
      outOfGame: !!data.outOfGame,
      groupId: data.groupId || null,     // visibility scope (group members only)
      authorities,                        // { keys: [pubkeys], threshold } or null
      escrow: data.escrow || null,        // Bitcoin escrow record (see PayoutManager)
      createdBy: officer != null ? String(officer) : null,
      createdAt: new Date().toISOString(),
      status: 'open',
      assigneeId: null,
      participantIds: [],
      openSignup: data.openSignup === true,
      contract: data.contract || { type: 'single' }
    };
    this.store.put('missions', id, mission);
    this._audit(officer, 'mission.create', 'mission', id, mission.title);
    this.emit('mission:created', mission);
    return mission;
  }

  /**
   * Upsert a mission received from a peer broadcast. Skips the local officer
   * allowlist — the remote creator's pubkey is the provenance. Does not
   * clobber an already-assigned/completed local copy.
   * @param {Object} data Mission snapshot from the wire.
   * @returns {{ mission: Object, created: Boolean }}
   */
  ingestRemote (data = {}) {
    if (!data || !data.id) throw new Error('mission id required');
    const existing = this.getMission(data.id);
    if (existing) {
      if (existing.status === 'open' && (!data.status || data.status === 'open')) {
        existing.title = data.title || existing.title;
        existing.description = data.description != null ? data.description : existing.description;
        existing.reward = data.reward != null ? Number(data.reward) : existing.reward;
        existing.groupId = data.groupId != null ? data.groupId : existing.groupId;
        if (data.authorities) existing.authorities = data.authorities;
        this.store.put('missions', existing.id, existing);
      }
      return { mission: existing, created: false };
    }
    const officer = data.createdBy || null;
    const authorities = data.authorities || this._normalizeAuthorities(null, officer);
    const mission = {
      id: String(data.id),
      title: data.title || 'Untitled mission',
      type: data.type || 'bounty',
      description: data.description || '',
      reward: Number(data.reward) || 0,
      requirements: data.requirements || null,
      location: data.location || null,
      deadline: data.deadline || null,
      outOfGame: !!data.outOfGame,
      groupId: data.groupId || null,
      authorities,
      escrow: data.escrow || null,
      createdBy: officer != null ? String(officer) : null,
      createdAt: data.createdAt || new Date().toISOString(),
      status: data.status || 'open',
      assigneeId: data.assigneeId || null,
      participantIds: Array.isArray(data.participantIds)
        ? data.participantIds.map(String)
        : (data.assigneeId ? [String(data.assigneeId)] : []),
      openSignup: data.openSignup === true,
      contract: data.contract || { type: 'single' },
      source: data.source || 'remote'
    };
    this.store.put('missions', mission.id, mission);
    this._audit(officer || 'remote', 'mission.ingest', 'mission', mission.id, mission.title);
    this.emit('mission:ingested', mission);
    return { mission, created: true };
  }

  // ---- remote lifecycle ingest (peer-to-peer register convergence) ----
  // These apply register mutations that arrived over Fabric. Authorization is
  // verified by the transport layer (LiveRelay: signed envelope + role checks)
  // BEFORE calling these; here we apply idempotently and record the same
  // hash-chained audit every replica keeps. No re-publish happens from ingest.

  /** Upsert a remote application (self-authored by the applicant). Idempotent by id. */
  ingestApplication (app = {}) {
    if (!app || !app.id || !app.missionId) throw new Error('application id + missionId required');
    if (this.store.get('applications', app.id)) return { created: false };
    const m = this.getMission(app.missionId);
    if (!m) return { created: false, skipped: 'mission-unknown' };
    const rec = {
      id: String(app.id),
      missionId: String(app.missionId),
      applicantId: String(app.applicantId || 'unknown'),
      message: app.message || '',
      status: 'pending',
      createdAt: app.createdAt || new Date().toISOString(),
      source: 'remote'
    };
    this.store.put('applications', rec.id, rec);
    this._audit(rec.applicantId, 'application.submit', 'application', rec.id, m.title);
    this.emit('application:ingested', rec);
    return { created: true, application: rec };
  }

  /** Apply a remote officer/authority decision on an application. Idempotent. */
  ingestApplicationDecision (data = {}) {
    const app = this.store.get('applications', data.applicationId);
    if (!app) return { created: false, skipped: 'application-unknown' };
    if (app.status !== 'pending') return { created: false };
    const m = this.getMission(app.missionId);
    if (!m) return { created: false, skipped: 'mission-unknown' };
    app.decidedBy = data.officerId != null ? String(data.officerId) : null;
    app.decidedAt = data.decidedAt || new Date().toISOString();
    if (data.decision === 'accept') {
      if (!this._isJoinable(m)) return { created: false, skipped: 'mission-not-joinable' };
      app.status = 'accepted';
      this._addParticipant(m, app.applicantId);
      this.store.put('missions', m.id, m);
      this.store.put('applications', app.id, app);
      this._audit(data.officerId, 'application.accept', 'application', app.id, m.title);
      this.emit('application:accepted', app);
    } else if (data.decision === 'reject') {
      app.status = 'rejected';
      app.reason = data.reason || null;
      this.store.put('applications', app.id, app);
      this._audit(data.officerId, 'application.reject', 'application', app.id, data.reason || '');
      this.emit('application:rejected', app);
    } else {
      return { created: false, skipped: 'bad-decision' };
    }
    return { created: true, application: app };
  }

  /** Upsert a remote completion claim (self-authored by a participant). Idempotent. */
  ingestClaim (claim = {}) {
    if (!claim || !claim.id || !claim.missionId) throw new Error('claim id + missionId required');
    if (this.store.get('claims', claim.id)) return { created: false };
    const m = this.getMission(claim.missionId);
    if (!m) return { created: false, skipped: 'mission-unknown' };
    if (m.status === 'completed' || m.status === 'cancelled') {
      return { created: false, skipped: 'mission-terminal' };
    }
    const rec = {
      id: String(claim.id),
      missionId: String(claim.missionId),
      claimantId: String(claim.claimantId || 'unknown'),
      note: claim.note || '',
      evidence: Array.isArray(claim.evidence) ? claim.evidence : [],
      completionGroupId: claim.completionGroupId ? String(claim.completionGroupId) : null,
      status: 'pending',
      claimedAt: claim.claimedAt || new Date().toISOString(),
      source: 'remote'
    };
    this.store.put('claims', rec.id, rec);
    this._audit(rec.claimantId, 'claim.submit', 'claim', rec.id, m.title);
    this.emit('claim:submitted', rec);
    return { created: true, claim: rec };
  }

  /**
   * Apply a remote claim validation. When the mission has an authorities set
   * and the decision is approve, the k-of-n Schnorr acceptance is re-verified
   * here (defense in depth) and preserved in the audit authorization. Idempotent.
   */
  ingestValidation (data = {}) {
    const claim = this.store.get('claims', data.claimId);
    if (!claim) return { created: false, skipped: 'claim-unknown' };
    if (claim.status !== 'pending') return { created: false };
    const m = this.getMission(claim.missionId);
    if (!m) return { created: false, skipped: 'mission-unknown' };
    const hasAuthorities = !!(m.authorities && m.authorities.keys && m.authorities.keys.length);
    let authorization = null;
    if (data.decision === 'approve' && hasAuthorities) {
      const signatures = data.authorization && data.authorization.signatures;
      if (!this.verifyAcceptance(m, claim, signatures)) {
        return { created: false, skipped: 'acceptance-unverified' };
      }
      authorization = { message: this.acceptanceMessage(m, claim), signatures };
    }
    const validation = {
      id: data.id || this._id('validation'),
      claimId: claim.id,
      missionId: m.id,
      officerId: data.officerId != null ? String(data.officerId) : null,
      decision: data.decision,
      note: data.note || '',
      validatedAt: data.validatedAt || new Date().toISOString(),
      source: 'remote'
    };
    if (authorization) validation.authorization = authorization;
    if (data.decision === 'approve') {
      claim.status = 'validated';
      m.status = 'completed';
      m.completedAt = validation.validatedAt;
      this.store.put('claims', claim.id, claim);
      this.store.put('missions', m.id, m);
      this.store.put('validations', validation.id, validation);
      this._supersedeOtherPendingClaims(m.id, claim.id, validation.officerId);
      this._audit(validation.officerId, 'claim.validate', 'claim', claim.id, 'approved', authorization);
      this.emit('claim:validated', validation);
      this.emit('mission:completed', m);
      if (m.escrow) this.emit('payout:unlocked', { mission: m, claim, validation });
    } else if (data.decision === 'reject') {
      claim.status = 'rejected';
      this.store.put('claims', claim.id, claim);
      this.store.put('validations', validation.id, validation);
      this._audit(validation.officerId, 'claim.validate', 'claim', claim.id, 'rejected');
      this.emit('claim:rejected', validation);
    } else {
      return { created: false, skipped: 'bad-decision' };
    }
    return { created: true, validation };
  }

  /** Apply a remote mission cancel. Idempotent. */
  ingestCancel (data = {}) {
    const m = this.getMission(data.missionId);
    if (!m) return { created: false, skipped: 'mission-unknown' };
    if (m.status !== 'open' && m.status !== 'assigned' && m.status !== 'in_progress') return { created: false };
    m.status = 'cancelled';
    m.cancelledAt = data.cancelledAt || new Date().toISOString();
    if (data.reason) m.cancelReason = data.reason;
    this.store.put('missions', m.id, m);
    this._audit(data.officerId, 'mission.cancel', 'mission', m.id, data.reason || '');
    this.emit('mission:cancelled', m);
    return { created: true, mission: m };
  }

  /** Normalize the authorities field: `{ keys: [pubkey…], threshold }` or null. */
  _normalizeAuthorities (input, creator) {
    const PUBKEY_RE = /^0[23][0-9a-f]{64}$/;
    if (input && Array.isArray(input.keys) && input.keys.length) {
      const keys = [...new Set(input.keys.map(String))];
      for (const k of keys) { if (!PUBKEY_RE.test(k)) throw new Error(`invalid authority pubkey: ${k}`); }
      const threshold = Math.min(Math.max(1, Number(input.threshold) || 1), keys.length);
      return { keys, threshold };
    }
    // Default: the creator alone, when the creator is a pubkey identity.
    if (creator && PUBKEY_RE.test(String(creator))) return { keys: [String(creator)], threshold: 1 };
    return null;
  }

  /**
   * Get a mission by ID.
   * @param {String} missionId - Mission ID.
   * @returns {Mission|null} Mission instance or null.
   */
  getMission (id) { return this.store.get('missions', id); }

  /**
   * Get applications for a mission.
   * @param {String} missionId - Mission ID.
   * @returns {Array<MissionApplication>} Mission applications.
   */
  getMissionApplications (missionId) { return this.applications.filter((a) => a.missionId === missionId); }

  getMissionClaims (missionId) { return this.claims.filter((c) => c.missionId === missionId); }

  async cancelMission (data = {}) {
    const m = this._mission(data.missionId);
    this._requireOfficer(data.officerId);
    if (m.status === 'completed' || m.status === 'cancelled') throw new Error(`cannot cancel a ${m.status} mission`);
    m.status = 'cancelled';
    m.cancelReason = data.reason || null;
    this.store.put('missions', m.id, m);
    this._audit(data.officerId, 'mission.cancel', 'mission', m.id, data.reason || '');
    this.emit('mission:cancelled', m);
    return m;
  }

  // ---- applications ----
  async applyToMission (data = {}) {
    const m = this._mission(data.missionId);
    if (!this._isJoinable(m)) throw new Error(`mission is ${m.status}, not open`);
    const applicantId = String(data.applicantId || 'unknown');
    const pending = this.applications.find((a) => (
      a.missionId === m.id && a.applicantId === applicantId && a.status === 'pending'
    ));
    if (pending) return pending;
    if (this._isParticipant(m, applicantId)) {
      const existing = this.applications.find((a) => (
        a.missionId === m.id && a.applicantId === applicantId && a.status === 'accepted'
      ));
      if (existing) return existing;
    }
    // Open signup / auto-join: accept into participants immediately.
    if (m.openSignup === true || data.autoAccept === true) {
      return this.joinMission({
        missionId: m.id,
        applicantId,
        message: data.message || '',
        id: data.id
      });
    }
    const id = data.id || this._id('application');
    const app = {
      id,
      missionId: m.id,
      applicantId,
      message: data.message || '',
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    this.store.put('applications', id, app);
    this._audit(app.applicantId, 'application.submit', 'application', id, m.title);
    this.emit('application:submitted', app);
    return app;
  }

  /**
   * Join a mission as an accepted participant (broadcast Accept / openSignup).
   * Idempotent when already a participant.
   * @param {Object} data
   * @returns {Object} Accepted application record
   */
  async joinMission (data = {}) {
    const m = this._mission(data.missionId);
    if (!this._isJoinable(m)) throw new Error(`mission is ${m.status}, cannot join`);
    const applicantId = String(data.applicantId || 'unknown');
    const existingAccepted = this.applications.find((a) => (
      a.missionId === m.id && a.applicantId === applicantId && a.status === 'accepted'
    ));
    if (this._isParticipant(m, applicantId) && existingAccepted) {
      return existingAccepted;
    }
    let app = existingAccepted;
    if (!app) {
      const pending = this.applications.find((a) => (
        a.missionId === m.id && a.applicantId === applicantId && a.status === 'pending'
      ));
      if (pending) {
        app = pending;
        app.status = 'accepted';
        app.decidedBy = applicantId;
        app.decidedAt = new Date().toISOString();
        app.message = data.message != null ? data.message : app.message;
      } else {
        app = {
          id: data.id || this._id('application'),
          missionId: m.id,
          applicantId,
          message: data.message || '',
          status: 'accepted',
          decidedBy: applicantId,
          decidedAt: new Date().toISOString(),
          createdAt: new Date().toISOString()
        };
      }
      this.store.put('applications', app.id, app);
    }
    this._addParticipant(m, applicantId);
    this.store.put('missions', m.id, m);
    this._audit(applicantId, 'application.accept', 'application', app.id, m.title);
    this.emit('application:accepted', app);
    this.emit('mission:joined', { mission: m, application: app });
    return app;
  }

  async decideApplication (data = {}) {
    const app = this.store.get('applications', data.applicationId);
    if (!app) throw new Error('application not found');
    this._requireOfficer(data.officerId);
    if (app.status !== 'pending') throw new Error(`application already ${app.status}`);
    app.decidedBy = data.officerId != null ? String(data.officerId) : null;
    app.decidedAt = new Date().toISOString();

    if (data.decision === 'accept') {
      const m = this._mission(app.missionId);
      if (!this._isJoinable(m)) throw new Error(`mission is ${m.status}, cannot accept participant`);
      app.status = 'accepted';
      this._addParticipant(m, app.applicantId);
      this.store.put('applications', app.id, app);
      this.store.put('missions', m.id, m);
      this._audit(data.officerId, 'application.accept', 'application', app.id, m.title);
      this.emit('application:accepted', app);
    } else if (data.decision === 'reject') {
      app.status = 'rejected';
      app.reason = data.reason || null;
      this.store.put('applications', app.id, app);
      this._audit(data.officerId, 'application.reject', 'application', app.id, data.reason || '');
      this.emit('application:rejected', app);
    } else {
      throw new Error('decision must be "accept" or "reject"');
    }
    return app;
  }

  // ---- completion claims + officer validation ----
  async submitClaim (data = {}) {
    const m = this._mission(data.missionId);
    if (m.status === 'completed' || m.status === 'cancelled') {
      throw new Error(`mission is ${m.status}, cannot claim`);
    }
    if (!this._isJoinable(m) && m.status !== 'assigned') {
      throw new Error(`mission is ${m.status}, not assigned`);
    }
    const claimantId = String(data.claimantId || '');
    if (!this._isParticipant(m, claimantId)) {
      throw new Error('only an accepted participant can claim completion');
    }
    let completionGroupId = data.completionGroupId != null && data.completionGroupId !== ''
      ? String(data.completionGroupId)
      : null;
    if (completionGroupId) {
      const check = this.settings.isGroupMember;
      if (typeof check === 'function') {
        if (!check(completionGroupId, claimantId)) {
          throw new Error('claimant is not a member of the completion group');
        }
      }
    }
    const id = data.id || this._id('claim');
    const claim = {
      id,
      missionId: m.id,
      claimantId,
      note: data.note || '',
      evidence: Array.isArray(data.evidence) ? data.evidence : [],
      completionGroupId,
      status: 'pending',
      claimedAt: new Date().toISOString()
    };
    this.store.put('claims', id, claim);
    this._audit(claim.claimantId, 'claim.submit', 'claim', id, m.title);
    this.emit('claim:submitted', claim);
    return claim;
  }

  /**
   * Deterministic message the mission's authorities must sign to accept a
   * completion claim (and release any escrowed payout).
   * @param {Object} mission Mission record.
   * @param {Object} claim Claim record.
   * @returns {String} Canonical acceptance message.
   */
  acceptanceMessage (mission, claim) {
    return JSON.stringify({
      action: 'mission.accept',
      missionId: mission.id,
      claimId: claim.id,
      claimantId: claim.claimantId,
      completionGroupId: claim.completionGroupId || null
    });
  }

  /**
   * Verify a k-of-n acceptance against the mission's authorities set.
   * Signers sign `acceptanceMessage(mission, claim)` bytes with BIP340
   * Schnorr; only authority pubkeys count.
   * @returns {Boolean}
   */
  verifyAcceptance (mission, claim, signatures) {
    if (!mission.authorities || !mission.authorities.keys || !mission.authorities.keys.length) return false;
    if (!signatures || typeof signatures !== 'object') return false;
    const Group = require('../types/Group');
    const authorityGroup = new Group({
      id: `authorities-${mission.id}`,
      name: 'authorities',
      members: mission.authorities.keys,
      threshold: mission.authorities.threshold || 1
    });
    return authorityGroup.verifyMultiSignature({ message: this.acceptanceMessage(mission, claim), signatures });
  }

  async validateClaim (data = {}) {
    const claim = this.store.get('claims', data.claimId);
    if (!claim) throw new Error('claim not found');
    if (claim.status !== 'pending') throw new Error(`claim already ${claim.status}`);
    const m = this._mission(claim.missionId);

    // Authorization: when the mission has an authorities set, approval requires
    // k-of-n Schnorr signatures over the acceptance message (the officer
    // allowlist is bypassed — the mission's own authority set governs it).
    // Otherwise the legacy officer-allowlist path applies (M5 behavior).
    let authorization = null;
    const hasAuthorities = !!(m.authorities && m.authorities.keys && m.authorities.keys.length);
    if (hasAuthorities && data.decision === 'approve') {
      if (!this.verifyAcceptance(m, claim, data.signatures)) {
        const e = new Error(`acceptance requires ${m.authorities.threshold}-of-${m.authorities.keys.length} authority signature(s) over the acceptance message`);
        e.code = 'FORBIDDEN';
        throw e;
      }
      authorization = { message: this.acceptanceMessage(m, claim), signatures: data.signatures };
    } else {
      this._requireOfficer(data.officerId);
    }

    const validation = { id: this._id('validation'), claimId: claim.id, missionId: m.id, officerId: data.officerId != null ? String(data.officerId) : null, decision: data.decision, note: data.note || '', validatedAt: new Date().toISOString() };
    if (authorization) validation.authorization = authorization;

    if (data.decision === 'approve') {
      claim.status = 'validated';
      m.status = 'completed';
      m.completedAt = validation.validatedAt;
      this.store.put('claims', claim.id, claim);
      this.store.put('missions', m.id, m);
      this.store.put('validations', validation.id, validation);
      this._supersedeOtherPendingClaims(m.id, claim.id, data.officerId);
      this._audit(data.officerId, 'claim.validate', 'claim', claim.id, 'approved', authorization);
      this.emit('claim:validated', validation);
      this.emit('mission:completed', m);
      // Escrowed Bitcoin payouts unlock on acceptance (see PayoutManager).
      if (m.escrow) this.emit('payout:unlocked', { mission: m, claim, validation });
    } else if (data.decision === 'reject') {
      claim.status = 'rejected';                 // mission stays assigned; participants may re-claim
      this.store.put('claims', claim.id, claim);
      this.store.put('validations', validation.id, validation);
      this._audit(data.officerId, 'claim.validate', 'claim', claim.id, 'rejected');
      this.emit('claim:rejected', validation);
    } else {
      throw new Error('decision must be "approve" or "reject"');
    }
    return validation;
  }

  /**
   * Submit an application to accept a mission.
   * @param {Object} applicationData - Application data.
   * @param {String} applicationData.missionId - Mission ID.
   * @param {String} applicationData.applicantId - Combined public key (hex).
   * @param {String} applicationData.signature - Application signature.
   * @param {Object} [applicationData.multisigData] - Musig2 data if applicable.
   * @returns {Promise<MissionApplication>} Created application.
   */
  async submitApplication (applicationData) {
    const missionData = this.store.get('missions', applicationData.missionId);

    if (!missionData) {
      throw new Error('Mission not found');
    }

    const mission = new Mission(missionData);

    if (!mission.isOpen()) {
      throw new Error('Mission is not open for applications');
    }

    const maxApplications = this.settings.maxApplicationsPerMission != null
      ? this.settings.maxApplicationsPerMission : 10;
    const existingApps = this.applications.filter(a => a.missionId === mission._id);
    if (existingApps.length >= maxApplications) {
      throw new Error('Maximum applications reached for this mission');
    }

    const actor = new Actor(JSON.stringify(applicationData));
    const appData = {
      ...applicationData,
      _id: actor.id,
      id: actor.id,
      status: 'pending',
      createdAt: Date.now()
    };

    const application = new MissionApplication(appData);

    const commitment = mission.generateContractCommitment();
    const verified = await this.verifySignature(
      commitment,
      application.signature,
      application.applicantId,
      application.multisigData
    );

    application.verified = verified;

    if (!verified) {
      throw new Error('Invalid signature');
    }

    this.store.put('applications', actor.id, appData);
    this.emit('application:submitted', appData);

    if (this.settings.autoApprove) {
      await this.approveApplication(actor.id);
    }

    return application;
  }

  /**
   * Verify a signature (single or multisig).
   * @param {String} message - Message hash to verify.
   * @param {String} signature - Signature to verify.
   * @param {String} publicKey - Public key for single sig.
   * @param {Object} [multisigData] - Musig2 data for multisig.
   * @returns {Promise<Boolean>} Verification result.
   */
  async verifySignature (message, signature, publicKey, multisigData = null) {
    try {
      const enableMusig2 = this.settings.enableMusig2 !== false;
      if (multisigData && enableMusig2) {
        return await this.verifyMusig2Signature(message, signature, multisigData);
      } else {
        return this.verifySecp256k1Signature(message, signature, publicKey);
      }
    } catch (error) {
      console.error('[MISSION-MANAGER]', 'Signature verification failed:', error);
      return false;
    }
  }

  /**
   * Verify a single secp256k1 signature.
   * @param {String} message - Message hash.
   * @param {String} signature - Signature hex.
   * @param {String} publicKey - Public key hex.
   * @returns {Boolean} Verification result.
   */
  verifySecp256k1Signature (message, signature, publicKey) {
    try {
      const msgBuffer = Buffer.from(message, 'hex');
      const sigBuffer = Buffer.from(signature, 'hex');
      const pubKeyBuffer = Buffer.from(publicKey, 'hex');

      return secp256k1.verify(msgBuffer, pubKeyBuffer, sigBuffer);
    } catch (error) {
      console.error('[MISSION-MANAGER]', 'secp256k1 verification error:', error);
      return false;
    }
  }

  /**
   * Verify a Musig2 multisig signature.
   * @param {String} message - Message hash.
   * @param {String} signature - Aggregated signature.
   * @param {Object} multisigData - Musig2 data.
   * @returns {Promise<Boolean>} Verification result.
   */
  async verifyMusig2Signature (message, signature, multisigData) {
    try {
      const { participantKeys, aggregatedKey, nonces } = multisigData;

      if (!participantKeys || !aggregatedKey) {
        throw new Error('Invalid Musig2 data');
      }

      const msgBuffer = Buffer.from(message, 'hex');
      const sigBuffer = Buffer.from(signature, 'hex');
      const aggKeyBuffer = Buffer.from(aggregatedKey, 'hex');

      return secp256k1.verify(msgBuffer, sigBuffer, aggKeyBuffer);
    } catch (error) {
      console.error('[MISSION-MANAGER]', 'Musig2 verification error:', error);
      return false;
    }
  }

  /**
   * Approve an application.
   * @param {String} applicationId - Application ID.
   * @returns {Promise<MissionApplication>} Approved application.
   */
  async approveApplication (applicationId) {
    const appData = this.store.get('applications', applicationId);
    if (!appData) {
      throw new Error('Application not found');
    }

    const application = new MissionApplication(appData);
    application.approve();

    const missionData = this.store.get('missions', application.missionId);
    if (missionData) {
      const mission = new Mission(missionData);
      mission.status = 'assigned';
      mission.assignee = application.applicantId;
      this.store.put('missions', mission.id, mission.toJSON());
    }

    this.store.put('applications', applicationId, application.toJSON());
    this.emit('application:approved', application.toJSON());

    return application;
  }

  /**
   * Reject an application.
   * @param {String} applicationId - Application ID.
   * @param {String} reason - Rejection reason.
   * @returns {Promise<MissionApplication>} Rejected application.
   */
  async rejectApplication (applicationId, reason) {
    const appData = this.store.get('applications', applicationId);
    if (!appData) {
      throw new Error('Application not found');
    }

    const application = new MissionApplication(appData);
    application.reject(reason);

    this.store.put('applications', applicationId, application.toJSON());
    this.emit('application:rejected', application.toJSON());

    return application;
  }

  /**
   * Complete a mission.
   * @param {String} missionId - Mission ID.
   * @param {Object} completionData - Completion data.
   * @returns {Promise<Mission>} Completed mission.
   */
  async completeMission (missionId, completionData = {}) {
    const missionData = this.store.get('missions', missionId);
    if (!missionData) {
      throw new Error('Mission not found');
    }

    const mission = new Mission(missionData);

    mission.status = 'completed';
    mission.completedAt = Date.now();
    mission.completionData = completionData;

    this.store.put('missions', missionId, mission.toJSON());
    this.emit('mission:completed', mission.toJSON());

    return mission;
  }

  /**
   * Fail a mission.
   * @param {String} missionId - Mission ID.
   * @param {String} reason - Failure reason.
   * @returns {Promise<Mission>} Failed mission.
   */
  async failMission (missionId, reason) {
    const missionData = this.store.get('missions', missionId);
    if (!missionData) {
      throw new Error('Mission not found');
    }

    const mission = new Mission(missionData);

    mission.status = 'failed';
    mission.failureReason = reason;
    mission.failedAt = Date.now();

    this.store.put('missions', missionId, mission.toJSON());
    this.emit('mission:failed', mission.toJSON());

    return mission;
  }

  /**
   * Get applications by applicant.
   * @param {String} applicantId - Combined public key (hex).
   * @returns {Array<MissionApplication>} Applicant's applications.
   */
  getApplicantApplications (applicantId) {
    return this.applications.filter(app => app.applicantId === applicantId);
  }
}

module.exports = MissionManager;
