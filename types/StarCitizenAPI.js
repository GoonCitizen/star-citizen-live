'use strict';

/**
 * @typedef {Object} StarCitizenActivity
 * @property {String} id - Unique identifier for the activity
 * @property {String} type - Type of activity (e.g., 'StarCitizenLogEntry', 'MissionComplete')
 * @property {Object} actor - The actor performing the activity
 * @property {String} actor.id - Actor ID
 * @property {String} [actor.name] - Actor name
 * @property {Object} object - The object of the activity
 * @property {String} object.id - Object ID
 * @property {String} [object.content] - Object content
 * @property {String} target - Target path of the activity
 * @property {String} timestamp - ISO timestamp of the activity
 */

/**
 * @typedef {Object} StarCitizenPlayer
 * @property {String} id - Unique identifier for the player
 * @property {String} name - Player name
 * @property {String} timestamp - ISO timestamp when player was registered
 * @property {Object} [metadata] - Additional player metadata
 */

/**
 * @typedef {Object} StarCitizenVehicle
 * @property {String} id - Unique identifier for the vehicle
 * @property {String} name - Vehicle name
 * @property {String} [type] - Vehicle type (e.g., 'fighter', 'transport')
 * @property {String} [owner] - Owner player ID
 * @property {String} timestamp - ISO timestamp when vehicle was registered
 */

/**
 * @typedef {Object} StarCitizenKill
 * @property {String} id - Unique identifier for the kill event
 * @property {String} killer - Name or ID of the killer
 * @property {String} victim - Name or ID of the victim
 * @property {String} [weapon] - Weapon used for the kill
 * @property {String} timestamp - ISO timestamp of the kill event
 */

/**
 * @typedef {Object} StarCitizenLogEntry
 * @property {String} id - Unique identifier for the log entry
 * @property {String} timestamp - Timestamp from the log file
 * @property {Array<String>} parts - Parsed parts of the log entry
 * @property {String} [content] - Raw log content
 */

/**
 * @typedef {Object} DiscordConfig
 * @property {Boolean} enable - Whether Discord integration is enabled
 * @property {String} [webhook] - Discord webhook URL
 * @property {String} [channel] - Discord channel ID
 * @property {Boolean} announceActivities - Whether to announce activities to Discord
 * @property {Boolean} announceKills - Whether to announce kills to Discord
 * @property {Boolean} announcePlayerJoins - Whether to announce player joins to Discord
 */

/**
 * @typedef {Object} StarCitizenSettings
 * @property {String} [name] - Service name
 * @property {String} [authority] - Authority URL for announcements
 * @property {String} [logfile] - Path to Star Citizen game log file
 * @property {Object} [http] - HTTP server configuration
 * @property {Boolean} [http.enable] - Whether to enable HTTP server
 * @property {Number} [http.port] - HTTP server port
 * @property {DiscordConfig} [discord] - Discord integration configuration
 */

/**
 * Declarative API interface for Star Citizen Live service.
 *
 * This interface defines the properties and methods exposed by the
 * StarCitizen service for programmatic access to game data.
 *
 * @interface StarCitizenAPI
 */
class StarCitizenAPI {
  /**
   * Get all activities.
   * @returns {Array<StarCitizenActivity>} Array of activities
   */
  get activities () {
    return [];
  }

  /**
   * Get all players.
   * @returns {Array<StarCitizenPlayer>} Array of players
   */
  get players () {
    return [];
  }

  /**
   * Get all vehicles.
   * @returns {Array<StarCitizenVehicle>} Array of vehicles
   */
  get vehicles () {
    return [];
  }

  /**
   * Get all kills.
   * @returns {Array<StarCitizenKill>} Array of kill events
   */
  get kills () {
    return [];
  }

  /**
   * Get all log entries.
   * @returns {Array<StarCitizenLogEntry>} Array of log entries
   */
  get logs () {
    return [];
  }

  /**
   * Get service status.
   * @returns {String} Current status ('STOPPED', 'STARTING', 'STARTED', 'STOPPING')
   */
  get status () {
    return 'STOPPED';
  }

  /**
   * Post a message to Discord via webhook.
   * @param {Object} payload - Discord webhook payload
   * @param {Array<Object>} [payload.embeds] - Array of Discord embeds
   * @returns {Promise<Response>} Fetch response
   */
  async postToDiscord (payload) {
    throw new Error('Not implemented');
  }

  /**
   * Announce an activity to the configured authority.
   * @param {StarCitizenActivity} activity - Activity to announce
   * @returns {Promise<Response>} Fetch response
   */
  async announceActivity (activity) {
    throw new Error('Not implemented');
  }

  /**
   * Take a screenshot of the current display.
   * @returns {Promise<Buffer>} Screenshot image buffer
   */
  async screenshot () {
    throw new Error('Not implemented');
  }

  /**
   * Start the service.
   * Begins monitoring the game log and starts HTTP server if configured.
   * @returns {Promise<StarCitizenAPI>} Returns this for chaining
   * @emits ready When service is fully started
   * @emits error If an error occurs during startup
   */
  async start () {
    throw new Error('Not implemented');
  }

  /**
   * Stop the service.
   * Stops monitoring the game log and stops HTTP server if running.
   * @returns {Promise<StarCitizenAPI>} Returns this for chaining
   * @emits stopped When service is fully stopped
   */
  async stop () {
    throw new Error('Not implemented');
  }
}

module.exports = StarCitizenAPI;

