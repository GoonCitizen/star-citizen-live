'use strict';

// Dependencies
const crypto = require('crypto');

// Fabric Types
const Actor = require('@fabric/core/types/actor');
const Entity = require('@fabric/core/types/entity');

/**
 * Represents a Mission in the Star Citizen universe.
 * Missions can be accepted by signing with secp256k1 or Musig2 multisig.
 * @extends Entity
 */
class Mission extends Entity {
  /**
   * Create a Mission instance.
   * @param {Object} data - Mission data.
   * @param {String} data.id - Unique mission identifier.
   * @param {String} data.title - Mission title.
   * @param {String} data.description - Mission description.
   * @param {String} data.type - Mission type (e.g., 'bounty', 'cargo', 'exploration').
   * @param {Number} data.reward - Reward amount in UEC.
   * @param {String} data.status - Mission status ('open', 'assigned', 'completed', 'failed').
   * @param {Object} data.requirements - Mission requirements.
   * @param {Number} [data.requirements.minReputation] - Minimum reputation required.
   * @param {Array<String>} [data.requirements.skills] - Required skills.
   * @param {String} [data.requirements.vehicleType] - Required vehicle type.
   * @param {Object} data.location - Mission location.
   * @param {String} data.location.system - Star system.
   * @param {String} data.location.planet - Planet or station.
   * @param {Object} data.contract - Contract configuration.
   * @param {String} data.contract.type - 'single' or 'multisig'.
   * @param {Number} [data.contract.requiredSignatures] - Required signatures for multisig.
   * @param {Array<String>} [data.contract.authorizedSigners] - Authorized signer public keys.
   * @param {String} data.issuer - Mission issuer ID.
   * @param {String} [data.assignee] - Current assignee ID.
   * @param {Number} data.expiresAt - Expiration timestamp.
   * @param {Number} data.createdAt - Creation timestamp.
   */
  constructor (data = {}) {
    // Pass string data to Entity to avoid issues
    super(JSON.stringify(data));

    // Set properties from data
    this._id = data._id || data.id;
    this.title = data.title;
    this.description = data.description;
    this.status = data.status || 'open';
    this.type = data.type || 'generic';
    this.reward = data.reward || 0;
    this.requirements = data.requirements || {};
    this.location = data.location || {};
    this.contract = data.contract || { type: 'single' };
    this.issuer = data.issuer;
    this.assignee = data.assignee;
    this.expiresAt = data.expiresAt;
    this.createdAt = data.createdAt;
    this.applications = data.applications || [];
    this.signatures = data.signatures || [];

    return this;
  }

  /**
   * Check if a player meets the mission requirements.
   * @param {Object} player - Player data.
   * @returns {Boolean} Whether player meets requirements.
   */
  meetsRequirements (player) {
    if (this.requirements.minReputation && player.reputation < this.requirements.minReputation) {
      return false;
    }

    if (this.requirements.skills && this.requirements.skills.length > 0) {
      const hasAllSkills = this.requirements.skills.every(skill =>
        player.skills && player.skills.includes(skill)
      );
      if (!hasAllSkills) return false;
    }

    if (this.requirements.vehicleType) {
      const hasVehicle = player.vehicles && player.vehicles.some(v =>
        v.type === this.requirements.vehicleType
      );
      if (!hasVehicle) return false;
    }

    return true;
  }

  /**
   * Check if the mission is expired.
   * @returns {Boolean} Whether mission is expired.
   */
  isExpired () {
    return this.expiresAt && Date.now() > this.expiresAt;
  }

  /**
   * Check if mission can accept more applications.
   * @returns {Boolean} Whether mission is open for applications.
   */
  isOpen () {
    return this.status === 'open' && !this.isExpired();
  }

  /**
   * Check if mission requires multisig.
   * @returns {Boolean} Whether mission requires multiple signatures.
   */
  isMultisig () {
    return this.contract.type === 'multisig';
  }

  /**
   * Get required number of signatures.
   * @returns {Number} Required signature count.
   */
  getRequiredSignatures () {
    if (!this.isMultisig()) return 1;
    return this.contract.requiredSignatures || 1;
  }

  /**
   * Check if signature threshold is met.
   * @returns {Boolean} Whether enough signatures have been collected.
   */
  hasEnoughSignatures () {
    const required = this.getRequiredSignatures();
    const collected = this.signatures.filter(sig => sig.verified).length;
    return collected >= required;
  }

  /**
   * Generate a contract commitment for signing.
   * @returns {String} Hex-encoded contract hash.
   */
  generateContractCommitment () {
    const commitment = {
      missionId: this._id,
      title: this.title,
      reward: this.reward,
      type: this.type,
      expiresAt: this.expiresAt,
      timestamp: Date.now()
    };

    const hash = crypto.createHash('sha256')
      .update(JSON.stringify(commitment))
      .digest('hex');

    return hash;
  }

  /**
   * Convert mission to JSON.
   * @returns {Object} Mission data.
   */
  toJSON () {
    const obj = {
      title: this.title,
      description: this.description,
      type: this.type,
      reward: this.reward,
      status: this.status,
      requirements: this.requirements,
      location: this.location,
      contract: this.contract,
      issuer: this.issuer,
      assignee: this.assignee,
      expiresAt: this.expiresAt,
      createdAt: this.createdAt,
      applications: this.applications ? this.applications.length : 0,
      signatures: this.signatures ? this.signatures.length : 0
    };

    // Add ID if available (avoid circular reference)
    if (this._id) {
      obj.id = this._id;
    }

    return obj;
  }
}

module.exports = Mission;
