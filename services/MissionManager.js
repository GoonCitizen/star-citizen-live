'use strict';

// Dependencies
const crypto = require('crypto');
// Use tiny-secp256k1 directly (same as @fabric/core uses)
const secp256k1 = require('tiny-secp256k1');

// Fabric Types
const Actor = require('@fabric/core/types/actor');
const Service = require('@fabric/core/types/service');

// Local Types
const Mission = require('../types/Mission');
const MissionApplication = require('../types/MissionApplication');

/**
 * Mission Manager service.
 * Handles mission lifecycle, applications, and cryptographic verification.
 * Supports both single secp256k1 signatures and Musig2 multisig.
 */
class MissionManager extends Service {
  /**
   * Create a MissionManager instance.
   * @param {Object} [settings] - Configuration settings.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: 'MissionManager',
      enableMusig2: true,
      autoApprove: false,
      maxApplicationsPerMission: 10
    }, settings);

    // State
    this._state = {
      content: {
        missions: {},
        applications: {},
        signatures: {}
      }
    };

    return this;
  }

  // Declarative API Properties
  get missions () {
    return Object.values(this.state.missions || {});
  }

  get applications () {
    return Object.values(this.state.applications || {});
  }

  get openMissions () {
    return this.missions.filter(m => m.status === 'open' && !m.isExpired);
  }

  get assignedMissions () {
    return this.missions.filter(m => m.status === 'assigned');
  }

  get completedMissions () {
    return this.missions.filter(m => m.status === 'completed');
  }

  /**
   * Create a new mission.
   * @param {Object} data - Mission data.
   * @returns {Mission} Created mission.
   */
  async createMission (data) {
    // Generate ID from JSON string
    const actor = new Actor(JSON.stringify(data));
    const missionData = {
      ...data,
      _id: actor.id,
      id: actor.id,
      status: 'open',
      createdAt: Date.now()
    };

    const mission = new Mission(missionData);

    this._state.content.missions[actor.id] = missionData;
    this.commit();
    this.emit('mission:created', missionData);

    return mission;
  }

  /**
   * Get a mission by ID.
   * @param {String} missionId - Mission ID.
   * @returns {Mission|null} Mission instance or null.
   */
  getMission (missionId) {
    const data = this._state.content.missions[missionId];
    return data ? new Mission(data) : null;
  }

  /**
   * Submit an application to accept a mission.
   * @param {Object} applicationData - Application data.
   * @param {String} applicationData.missionId - Mission ID.
   * @param {String} applicationData.applicantId - Applicant ID.
   * @param {String} applicationData.publicKey - Applicant's public key.
   * @param {String} applicationData.signature - Application signature.
   * @param {Object} [applicationData.multisigData] - Musig2 data if applicable.
   * @returns {Promise<MissionApplication>} Created application.
   */
  async submitApplication (applicationData) {
    const mission = this.getMission(applicationData.missionId);

    if (!mission) {
      throw new Error('Mission not found');
    }

    if (!mission.isOpen()) {
      throw new Error('Mission is not open for applications');
    }

    // Check application count
    const existingApps = this.applications.filter(a => a.missionId === mission._id);
    if (existingApps.length >= this.settings.maxApplicationsPerMission) {
      throw new Error('Maximum applications reached for this mission');
    }

    // Create application
    const actor = new Actor(JSON.stringify(applicationData));
    const appData = {
      ...applicationData,
      _id: actor.id,
      id: actor.id,
      status: 'pending',
      createdAt: Date.now()
    };

    const application = new MissionApplication(appData);

    // Verify signature
    const commitment = mission.generateContractCommitment();
    const verified = await this.verifySignature(
      commitment,
      application.signature,
      application.publicKey,
      application.multisigData
    );

    application.verified = verified;

    if (!verified) {
      throw new Error('Invalid signature');
    }

    // Store application
    this._state.content.applications[actor.id] = appData;
    this.commit();
    this.emit('application:submitted', appData);

    // Auto-approve if configured
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
      if (multisigData && this.settings.enableMusig2) {
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
      // Message should already be a hash (32 bytes)
      const msgBuffer = Buffer.from(message, 'hex');
      const sigBuffer = Buffer.from(signature, 'hex');
      const pubKeyBuffer = Buffer.from(publicKey, 'hex');

      // Verify signature matches public key for this message
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
      // TODO: Implement Musig2 verification
      // This is a placeholder for Musig2 verification logic
      // Musig2 verification involves:
      // 1. Aggregate public keys
      // 2. Verify nonce commitments
      // 3. Verify partial signatures
      // 4. Verify final aggregated signature

      const { participantKeys, aggregatedKey, nonces } = multisigData;

      if (!participantKeys || !aggregatedKey) {
        throw new Error('Invalid Musig2 data');
      }

      // Placeholder: Basic validation
      const msgBuffer = Buffer.from(message, 'hex');
      const sigBuffer = Buffer.from(signature, 'hex');
      const aggKeyBuffer = Buffer.from(aggregatedKey, 'hex');

      // In production, use a proper Musig2 library
      // For now, verify using the aggregated key as a standard signature
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
    const appData = this._state.content.applications[applicationId];
    if (!appData) {
      throw new Error('Application not found');
    }

    const application = new MissionApplication(appData);
    application.approve();

    // Update mission status
    const mission = this.getMission(application.missionId);
    if (mission) {
      mission.status = 'assigned';
      mission.assignee = application.applicantId;
      this._state.content.missions[mission.id] = mission.toJSON();
    }

    this._state.content.applications[applicationId] = application.toJSON();
    this.commit();
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
    const appData = this._state.content.applications[applicationId];
    if (!appData) {
      throw new Error('Application not found');
    }

    const application = new MissionApplication(appData);
    application.reject(reason);

    this._state.content.applications[applicationId] = application.toJSON();
    this.commit();
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
    const mission = this.getMission(missionId);
    if (!mission) {
      throw new Error('Mission not found');
    }

    mission.status = 'completed';
    mission.completedAt = Date.now();
    mission.completionData = completionData;

    this._state.content.missions[missionId] = mission.toJSON();
    this.commit();
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
    const mission = this.getMission(missionId);
    if (!mission) {
      throw new Error('Mission not found');
    }

    mission.status = 'failed';
    mission.failureReason = reason;
    mission.failedAt = Date.now();

    this._state.content.missions[missionId] = mission.toJSON();
    this.commit();
    this.emit('mission:failed', mission.toJSON());

    return mission;
  }

  /**
   * Get applications for a mission.
   * @param {String} missionId - Mission ID.
   * @returns {Array<MissionApplication>} Mission applications.
   */
  getMissionApplications (missionId) {
    return this.applications.filter(app => app.missionId === missionId);
  }

  /**
   * Get applications by applicant.
   * @param {String} applicantId - Applicant ID.
   * @returns {Array<MissionApplication>} Applicant's applications.
   */
  getApplicantApplications (applicantId) {
    return this.applications.filter(app => app.applicantId === applicantId);
  }

  async start () {
    console.log('[MISSION-MANAGER]', 'Starting Mission Manager...');
    this._state.content.status = 'STARTED';
    this.commit();
    this.emit('ready');
    return this;
  }

  async stop () {
    console.log('[MISSION-MANAGER]', 'Stopping Mission Manager...');
    this._state.content.status = 'STOPPED';
    this.commit();
    return this;
  }
}

module.exports = MissionManager;

