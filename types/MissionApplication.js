'use strict';

// Fabric Types
const Actor = require('@fabric/core/types/actor');
const Entity = require('@fabric/core/types/entity');

/**
 * Represents an application to accept a Mission.
 * @extends Entity
 */
class MissionApplication extends Entity {
  /**
   * Create a MissionApplication instance.
   * @param {Object} data - Application data.
   * @param {String} data.missionId - Mission ID being applied to.
   * @param {String} data.applicantId - Combined public key (hex). Single secp256k1
   *   or Musig2-aggregated key — same opaque format as any other public key in the
   *   system; not a separate player/handle identity.
   * @param {String} data.signature - Application signature.
   * @param {String} [data.message] - Optional message from applicant.
   * @param {String} data.status - Application status ('pending', 'approved', 'rejected').
   * @param {Object} [data.multisigData] - Musig2 multisig data if applicable.
   * @param {Array<String>} [data.multisigData.participantKeys] - Participant public keys.
   * @param {String} [data.multisigData.aggregatedKey] - Aggregated public key.
   * @param {Array<Object>} [data.multisigData.nonces] - Musig2 nonces.
   * @param {Number} data.createdAt - Application timestamp.
   */
  constructor (data = {}) {
    // Pass string data to Entity
    super(JSON.stringify(data));

    this._id = data._id || data.id;
    this.missionId = data.missionId;
    this.applicantId = data.applicantId;
    this.signature = data.signature;
    this.message = data.message || '';
    this.status = data.status || 'pending';
    this.multisigData = data.multisigData || null;
    this.verified = data.verified || false;
    this.createdAt = data.createdAt || Date.now();

    return this;
  }

  /**
   * Check if application is for multisig.
   * @returns {Boolean} Whether this is a multisig application.
   */
  isMultisig () {
    return !!this.multisigData;
  }

  /**
   * Check if application is approved.
   * @returns {Boolean} Whether application is approved.
   */
  isApproved () {
    return this.status === 'approved';
  }

  /**
   * Check if application is pending.
   * @returns {Boolean} Whether application is pending.
   */
  isPending () {
    return this.status === 'pending';
  }

  /**
   * Approve the application.
   */
  approve () {
    this.status = 'approved';
  }

  /**
   * Reject the application.
   * @param {String} reason - Rejection reason.
   */
  reject (reason) {
    this.status = 'rejected';
    this.rejectionReason = reason;
  }

  /**
   * Convert application to JSON.
   * @returns {Object} Application data.
   */
  toJSON () {
    return {
      id: this.id,
      missionId: this.missionId,
      applicantId: this.applicantId,
      signature: this.signature,
      message: this.message,
      status: this.status,
      multisigData: this.multisigData,
      verified: this.verified,
      createdAt: this.createdAt,
      isMultisig: this.isMultisig(),
      isApproved: this.isApproved(),
      isPending: this.isPending()
    };
  }
}

module.exports = MissionApplication;

