/**
 * Core service for Star Citizen.
 */
'use strict';

// Dependencies
// const fs = require('fs');
const fetch = require('cross-fetch');
const merge = require('lodash.merge');
const { Tail } = require('tail');
const screenshot = require('screenshot-desktop');

// Fabric Types
const Actor = require('@fabric/core/types/actor');
const Hub = require('@fabric/hub');

// Local Services
const MissionManager = require('./MissionManager');

// TODO: render GoonCitizen/goon.vc static site / import / upgrade it to use this tool
/**
 * Core service for Star Citizen.
 * Provides a Fabric-compatible declarative API with Discord integration.
 * @extends Hub
 * @property {Array} activities - Collection of activities from the game log.
 * @property {Array} players - Collection of known players.
 * @property {Array} vehicles - Collection of known vehicles.
 * @property {Array} logs - Collection of log entries.
 * @property {Array} kills - Collection of kill events.
 * @property {Object} discord - Discord integration instance.
 */
class StarCitizen extends Hub {
  /**
   * Create an instance of the Star Citizen service.
   * @param {Object} [settings] Configuration for this instance.
   * @param {Object} [settings.logfile=C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log] Path to the log file for Star Citizen.
   * @param {Object} [settings.discord] Discord configuration.
   * @param {String} [settings.discord.webhook] Discord webhook URL for posting updates.
   * @param {String} [settings.discord.channel] Discord channel ID for posting updates.
   * @param {Boolean} [settings.discord.enable=false] Enable Discord integration.
   * @returns {StarCitizen} A new instance of the Star Citizen service.
   */
  constructor (settings = {}) {
    super(settings);

    // Settings
    // (also sane defaults)
    this.settings = merge({}, this.settings, {
      authority: 'https://sensemaker.io',
      logfile: '/Users/eric/game.log',
      discord: {
        enable: false,
        webhook: null,
        channel: null,
        announceActivities: true,
        announceKills: true,
        announcePlayerJoins: true
      },
      missions: {
        enable: true,
        enableMusig2: true,
        autoApprove: false,
        maxApplicationsPerMission: 10
      },
      state: {
        status: 'STOPPED',
        activities: {},
        logs: {},
        players: {},
        vehicles: {},
        kills: {},
        missions: {}
      },
      http: {
        port: 3041
      }
    }, settings);

    // HTTP Server Routes
    // Note: Hub/Fabric HTTP expects 'route' key, not 'path'
    // TODO: consolidate into @fabric/http where appropriate
    this.routes = [
      // TODO: prefix with /services/star-citizen only when imported as library
      { method: 'GET', route: '/services/star-citizen', handler: this.handleGenericRequest.bind(this) },
      { method: 'POST', route: '/services/star-citizen', handler: this.handleGenericRequest.bind(this) },
      { method: 'GET', route: '/services/star-citizen/activities', handler: this.handleGetActivitiesRequest.bind(this) },
      { method: 'POST', route: '/services/star-citizen/activities', handler: this.handleCreateActivityRequest.bind(this) },
      // TODO: match GN API as much as possible
      { method: 'GET', route: '/services/star-citizen/players', handler: this.handleGetPlayersRequest.bind(this) },
      { method: 'POST', route: '/services/star-citizen/players', handler: this.handleCreatePlayerRequest.bind(this) },
      { method: 'GET', route: '/services/star-citizen/vehicles', handler: this.handleGetVehiclesRequest.bind(this) },
      { method: 'POST', route: '/services/star-citizen/vehicles', handler: this.handleCreateVehicleRequest.bind(this) },
      { method: 'GET', route: '/services/star-citizen/messages', handler: this.handleGetMessagesRequest.bind(this) },
      { method: 'POST', route: '/services/star-citizen/messages', handler: this.handleCreateMessageRequest.bind(this) },
      { method: 'GET', route: '/services/star-citizen/kills', handler: this.handleGetKillsRequest.bind(this) },
      { method: 'POST', route: '/services/star-citizen/kills', handler: this.handleCreateKillRequest.bind(this) },
      // Mission endpoints
      { method: 'GET', route: '/services/star-citizen/missions', handler: this.handleGetMissionsRequest.bind(this) },
      { method: 'POST', route: '/services/star-citizen/missions', handler: this.handleCreateMissionRequest.bind(this) },
      { method: 'GET', route: '/services/star-citizen/missions/:id', handler: this.handleGetMissionRequest.bind(this) },
      { method: 'POST', route: '/services/star-citizen/missions/:id/complete', handler: this.handleCompleteMissionRequest.bind(this) },
      { method: 'POST', route: '/services/star-citizen/missions/:id/fail', handler: this.handleFailMissionRequest.bind(this) },
      { method: 'GET', route: '/services/star-citizen/missions/:id/applications', handler: this.handleGetMissionApplicationsRequest.bind(this) },
      { method: 'POST', route: '/services/star-citizen/missions/:id/applications', handler: this.handleSubmitApplicationRequest.bind(this) },
      { method: 'POST', route: '/services/star-citizen/applications/:id/approve', handler: this.handleApproveApplicationRequest.bind(this) },
      { method: 'POST', route: '/services/star-citizen/applications/:id/reject', handler: this.handleRejectApplicationRequest.bind(this) }
    ];

    this.logwatcher = null;
    this.discord = null;

    // Initialize Mission Manager
    if (this.settings.missions && this.settings.missions.enable) {
      this.missionManager = new MissionManager(this.settings.missions);
      // TODO: streamline
      this._wireMissionManager();
    }

    // State
    this._state = {
      content: JSON.parse(JSON.stringify(this.settings.state))
    };

    // Wire Discord integration if provided
    if (this.settings.discord && this.settings.discord.enable) {
      this._wireDiscord();
    }

    return this;
  }

  // Declarative API Properties
  get activities () {
    return Object.values(this.state.activities || {});
  }

  get applications () {
    return this.missionManager ? this.missionManager.applications : [];
  }

  get logs () {
    return Object.values(this.state.logs || {});
  }

  get players () {
    return Object.values(this.state.players || {});
  }

  get vehicles () {
    return Object.values(this.state.vehicles || {});
  }

  get kills () {
    return Object.values(this.state.kills || {});
  }

  get missions () {
    return this.missionManager ? this.missionManager.missions : [];
  }

  get status () {
    return this.state.status;
  }

  /**
   * Wire Discord integration into the service.
   * @private
   */
  _wireDiscord () {
    // Listen for activity events and relay to Discord
    this.on('activity', this._handleActivityForDiscord.bind(this));
    this.on('kill', this._handleKillForDiscord.bind(this));
    this.on('player:join', this._handlePlayerJoinForDiscord.bind(this));
    this.on('log', this._handleLogForDiscord.bind(this));
  }

  /**
   * Wire Mission Manager events.
   * @private
   */
  _wireMissionManager () {
    if (!this.missionManager) return;

    // Forward mission events
    this.missionManager.on('mission:created', (mission) => {
      this.emit('mission:created', mission);
      if (this.settings.discord && this.settings.discord.enable) {
        this._announceMissionToDiscord(mission, 'created');
      }
    });

    this.missionManager.on('application:submitted', (application) => {
      this.emit('application:submitted', application);
      if (this.settings.discord && this.settings.discord.enable) {
        this._announceApplicationToDiscord(application, 'submitted');
      }
    });

    this.missionManager.on('application:approved', (application) => {
      this.emit('application:approved', application);
      if (this.settings.discord && this.settings.discord.enable) {
        this._announceApplicationToDiscord(application, 'approved');
      }
    });

    this.missionManager.on('mission:completed', (mission) => {
      this.emit('mission:completed', mission);
      if (this.settings.discord && this.settings.discord.enable) {
        this._announceMissionToDiscord(mission, 'completed');
      }
    });
  }

  /**
   * Announce mission to Discord.
   * @param {Object} mission - Mission data.
   * @param {String} action - Action type.
   * @private
   */
  async _announceMissionToDiscord (mission, action) {
    if (!this.settings.discord.webhook) return;

    const colors = {
      created: 0x00FF00,
      completed: 0x0000FF,
      failed: 0xFF0000
    };

    const icons = {
      created: '📋',
      completed: '✅',
      failed: '❌'
    };

    try {
      await this.postToDiscord({
        embeds: [{
          title: `${icons[action]} Mission ${action.charAt(0).toUpperCase() + action.slice(1)}`,
          description: mission.title,
          fields: [
            { name: 'Type', value: mission.type, inline: true },
            { name: 'Reward', value: `${mission.reward} UEC`, inline: true },
            { name: 'Status', value: mission.status, inline: true },
            { name: 'Contract Type', value: mission.contract.type, inline: true }
          ],
          color: colors[action] || 0xFFFFFF,
          timestamp: new Date().toISOString()
        }]
      });
    } catch (error) {
      console.error('[STAR-CITIZEN]', '[DISCORD]', 'Error announcing mission:', error);
    }
  }

  /**
   * Announce application to Discord.
   * @param {Object} application - Application data.
   * @param {String} action - Action type.
   * @private
   */
  async _announceApplicationToDiscord (application, action) {
    if (!this.settings.discord.webhook) return;

    const colors = {
      submitted: 0xFFFF00,
      approved: 0x00FF00,
      rejected: 0xFF0000
    };

    const icons = {
      submitted: '📝',
      approved: '✅',
      rejected: '❌'
    };

    try {
      await this.postToDiscord({
        embeds: [{
          title: `${icons[action]} Application ${action.charAt(0).toUpperCase() + action.slice(1)}`,
          description: application.message || 'Mission application',
          fields: [
            { name: 'Mission ID', value: application.missionId, inline: true },
            { name: 'Applicant', value: application.applicantId, inline: true },
            { name: 'Type', value: application.isMultisig ? 'Multisig' : 'Single', inline: true },
            { name: 'Verified', value: application.verified ? 'Yes' : 'No', inline: true }
          ],
          color: colors[action] || 0xFFFFFF,
          timestamp: new Date().toISOString()
        }]
      });
    } catch (error) {
      console.error('[STAR-CITIZEN]', '[DISCORD]', 'Error announcing application:', error);
    }
  }

  /**
   * Handle activity events for Discord.
   * @param {Object} activity - The activity to announce.
   * @private
   */
  async _handleActivityForDiscord (activity) {
    if (!this.settings.discord.announceActivities) return;
    if (!this.settings.discord.webhook) return;

    try {
      await this.postToDiscord({
        embeds: [{
          title: '🎮 Star Citizen Activity',
          description: activity.type,
          fields: [
            { name: 'Actor', value: activity.actor.id, inline: true },
            { name: 'Object', value: activity.object.id, inline: true },
            { name: 'Target', value: activity.target, inline: true }
          ],
          timestamp: new Date().toISOString(),
          color: 0x00FF00
        }]
      });
    } catch (error) {
      console.error('[STAR-CITIZEN]', '[DISCORD]', 'Error posting activity:', error);
    }
  }

  /**
   * Handle kill events for Discord.
   * @param {Object} kill - The kill event to announce.
   * @private
   */
  async _handleKillForDiscord (kill) {
    if (!this.settings.discord.announceKills) return;
    if (!this.settings.discord.webhook) return;

    try {
      await this.postToDiscord({
        embeds: [{
          title: '💀 Kill Event',
          description: `${kill.killer} eliminated ${kill.victim}`,
          fields: [
            { name: 'Killer', value: kill.killer, inline: true },
            { name: 'Victim', value: kill.victim, inline: true },
            { name: 'Weapon', value: kill.weapon || 'Unknown', inline: true }
          ],
          timestamp: new Date().toISOString(),
          color: 0xFF0000
        }]
      });
    } catch (error) {
      console.error('[STAR-CITIZEN]', '[DISCORD]', 'Error posting kill:', error);
    }
  }

  /**
   * Handle player join events for Discord.
   * @param {Object} player - The player that joined.
   * @private
   */
  async _handlePlayerJoinForDiscord (player) {
    if (!this.settings.discord.announcePlayerJoins) return;
    if (!this.settings.discord.webhook) return;

    try {
      await this.postToDiscord({
        embeds: [{
          title: '👤 Player Joined',
          description: `${player.name} has entered the verse`,
          fields: [
            { name: 'Player', value: player.name, inline: true },
            { name: 'ID', value: player.id, inline: true }
          ],
          timestamp: new Date().toISOString(),
          color: 0x0000FF
        }]
      });
    } catch (error) {
      console.error('[STAR-CITIZEN]', '[DISCORD]', 'Error posting player join:', error);
    }
  }

  /**
   * Handle log events for Discord.
   * @param {String} log - The log message.
   * @private
   */
  async _handleLogForDiscord (log) {
    // Only post important logs to Discord
    if (!this.settings.discord.webhook) return;
    // Implement custom filtering logic here if needed
  }

  /**
   * Post a message to Discord via webhook.
   * @param {Object} payload - The Discord webhook payload.
   * @returns {Promise<Response>} The fetch response.
   */
  async postToDiscord (payload) {
    if (!this.settings.discord.webhook) {
      throw new Error('Discord webhook URL not configured');
    }

    return fetch(this.settings.discord.webhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  }

  async announceActivity (activity) {
    return new Promise((resolve, reject) => {
      const url = `${this.settings.authority}/services/star-citizen/activities`;
      const announcement = fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(activity)
      });

      announcement.catch((error) => {
        console.error('Could not announce activity:', error);
        reject(error);
      });

      announcement.then((response) => {
        resolve(response);
      });
    });
  }

  // HTTP Request Handlers
  handleGetActivitiesRequest (req, res, next) {
    return res.send({
      type: 'Collection',
      data: this.activities
    });
  }

  handleCreateActivityRequest (req, res, next) {
    const actor = new Actor(req.body);
    this._state.content.activities[actor.id] = req.body;
    this.commit();
    this.emit('activity', req.body);
    return res.send({
      type: 'Activity',
      data: req.body
    });
  }

  handleGetPlayersRequest (req, res, next) {
    return res.send({
      type: 'Collection',
      data: this.players
    });
  }

  handleCreatePlayerRequest (req, res, next) {
    const actor = new Actor(req.body);
    this._state.content.players[actor.id] = req.body;
    this.commit();
    this.emit('player:join', req.body);
    return res.send({
      type: 'Player',
      data: req.body
    });
  }

  handleGetVehiclesRequest (req, res, next) {
    return res.send({
      type: 'Collection',
      data: this.vehicles
    });
  }

  handleCreateVehicleRequest (req, res, next) {
    const actor = new Actor(req.body);
    this._state.content.vehicles[actor.id] = req.body;
    this.commit();
    return res.send({
      type: 'Vehicle',
      data: req.body
    });
  }

  handleGetMessagesRequest (req, res, next) {
    return res.send({
      type: 'Collection',
      data: this.logs
    });
  }

  handleCreateMessageRequest (req, res, next) {
    const actor = new Actor(req.body);
    this._state.content.logs[actor.id] = req.body;
    this.commit();
    return res.send({
      type: 'Message',
      data: req.body
    });
  }

  handleGetKillsRequest (req, res, next) {
    return res.send({
      type: 'Collection',
      data: this.kills
    });
  }

  handleCreateKillRequest (req, res, next) {
    const actor = new Actor(req.body);
    this._state.content.kills[actor.id] = req.body;
    this.commit();
    this.emit('kill', req.body);
    return res.send({
      type: 'Kill',
      data: req.body
    });
  }

  handleGenericRequest (req, res, next) {
    console.debug('received request:', req);
    return res.send({
      type: 'StarCitizen',
      data: {
        id: this.id,
        status: this.status,
        activities: this.activities.length,
        players: this.players.length,
        vehicles: this.vehicles.length,
        kills: this.kills.length,
        logs: this.logs.length
      }
    });
  }

  handleLogChange (entry) {
    const actor = new Actor({ content: entry });
    const message = this.parseLogEntry(entry);
    const activity = {
      type: 'StarCitizenLogEntry',
      actor: {
        id: this.id
      },
      object: {
        id: actor.id,
        content: entry
      },
      target: '/logs'
    };

    this.emit('activity', activity);

    switch (message.parts[1]) {
      case '[Notice]':
      case 'CryAnimation:':
      case 'Warning':
        return this;
    }

    console.debug('[FABRIC]', '[STAR-CITIZEN]', '[LOG]', `[${actor.id}]`, message);
    this._state.content.logs[actor.id] = message;
    this._state.content.activities[actor.id] = activity;
    this.commit();
    this.announceActivity(activity).catch((error) => { console.error('Could not announce activity:', error); });

    return this;
  }

  parseLogEntry (entry) {
    const parts = entry.split(' ');
    const object = {
      timestamp: parts[0],
      parts: parts
    };

    return object;
  }

  handleLogError (error) {
    console.error('Error reading log:', error);
  }

  openLog () {
    try {
      this.logwatcher = new Tail(this.settings.logfile);
      this.logwatcher.on('line', this.handleLogChange.bind(this));
      this.logwatcher.on('error', this.handleLogError.bind(this));
    } catch (exception) {
      this.emit('error', `Could not open log: ${exception.toString()}`);
    }
  }

  replayLog () {
    // TODO: implement log replay functionality
  }

  async screenshot () {
    return new Promise((resolve, reject) => {
      screenshot({
        format: 'png'
      }).then((image) => {
        resolve(image);
      }).catch((error) => {
        reject(error);
      });
    });
  }

  // Mission HTTP Request Handlers
  handleGetMissionsRequest (req, res, next) {
    if (!this.missionManager) {
      return res.status(503).send({ error: 'Mission system not available' });
    }

    const status = req.query.status;
    let missions = this.missions;

    if (status) {
      missions = missions.filter(m => m.status === status);
    }

    return res.send({
      type: 'Collection',
      data: missions
    });
  }

  async handleCreateMissionRequest (req, res, next) {
    if (!this.missionManager) {
      return res.status(503).send({ error: 'Mission system not available' });
    }

    try {
      const mission = await this.missionManager.createMission(req.body);
      return res.send({
        type: 'Mission',
        data: mission.toJSON()
      });
    } catch (error) {
      return res.status(400).send({ error: error.message });
    }
  }

  handleGetMissionRequest (req, res, next) {
    if (!this.missionManager) {
      return res.status(503).send({ error: 'Mission system not available' });
    }

    const mission = this.missionManager.getMission(req.params.id);
    if (!mission) {
      return res.status(404).send({ error: 'Mission not found' });
    }

    return res.send({
      type: 'Mission',
      data: mission.toJSON()
    });
  }

  async handleCompleteMissionRequest (req, res, next) {
    if (!this.missionManager) {
      return res.status(503).send({ error: 'Mission system not available' });
    }

    try {
      const mission = await this.missionManager.completeMission(req.params.id, req.body);
      return res.send({
        type: 'Mission',
        data: mission.toJSON()
      });
    } catch (error) {
      return res.status(400).send({ error: error.message });
    }
  }

  async handleFailMissionRequest (req, res, next) {
    if (!this.missionManager) {
      return res.status(503).send({ error: 'Mission system not available' });
    }

    try {
      const mission = await this.missionManager.failMission(req.params.id, req.body.reason);
      return res.send({
        type: 'Mission',
        data: mission.toJSON()
      });
    } catch (error) {
      return res.status(400).send({ error: error.message });
    }
  }

  handleGetMissionApplicationsRequest (req, res, next) {
    if (!this.missionManager) {
      return res.status(503).send({ error: 'Mission system not available' });
    }

    const applications = this.missionManager.getMissionApplications(req.params.id);
    return res.send({
      type: 'Collection',
      data: applications
    });
  }

  async handleSubmitApplicationRequest (req, res, next) {
    if (!this.missionManager) {
      return res.status(503).send({ error: 'Mission system not available' });
    }

    try {
      const applicationData = {
        ...req.body,
        missionId: req.params.id
      };
      const application = await this.missionManager.submitApplication(applicationData);
      return res.send({
        type: 'MissionApplication',
        data: application.toJSON()
      });
    } catch (error) {
      return res.status(400).send({ error: error.message });
    }
  }

  async handleApproveApplicationRequest (req, res, next) {
    if (!this.missionManager) {
      return res.status(503).send({ error: 'Mission system not available' });
    }

    try {
      const application = await this.missionManager.approveApplication(req.params.id);
      return res.send({
        type: 'MissionApplication',
        data: application.toJSON()
      });
    } catch (error) {
      return res.status(400).send({ error: error.message });
    }
  }

  async handleRejectApplicationRequest (req, res, next) {
    if (!this.missionManager) {
      return res.status(503).send({ error: 'Mission system not available' });
    }

    try {
      const application = await this.missionManager.rejectApplication(req.params.id, req.body.reason);
      return res.send({
        type: 'MissionApplication',
        data: application.toJSON()
      });
    } catch (error) {
      return res.status(400).send({ error: error.message });
    }
  }

  async start () {
    console.log('[STAR-CITIZEN]', 'Starting service...');
    this._state.content.status = 'STARTING';

    // Start Mission Manager
    if (this.missionManager) {
      await this.missionManager.start();
    }

    if (this.settings.http && this.settings.http.enable) {
      await this.http.start();
    }

    this.openLog();

    this._state.content.status = 'STARTED';
    this.commit();

    console.log('[STAR-CITIZEN]', 'Service started');
    this.emit('ready');

    return this;
  }

  async stop () {
    console.log('[STAR-CITIZEN]', 'Stopping service...');
    this._state.content.status = 'STOPPING';

    if (this.logwatcher) {
      this.logwatcher.unwatch();
      this.logwatcher = null;
    }

    // Stop Mission Manager
    if (this.missionManager) {
      await this.missionManager.stop();
    }

    if (this.settings.http && this.settings.http.enable) {
      await this.http.stop();
    }

    this._state.content.status = 'STOPPED';
    this.commit();

    console.log('[STAR-CITIZEN]', 'Service stopped');
    this.emit('stopped');

    return this;
  }

  /**
   * Get UI component configuration for Sensemaker integration.
   * Services can override this method to declare their UI components.
   * @returns {Object|null} UI component configuration or null
   */
  getUIConfig () {
    return {
      name: 'Star Citizen',
      icon: 'space shuttle',
      basePath: '/services/star-citizen',
      routes: [
        {
          path: '',
          component: '@rsi/star-citizen/components/StarCitizenHome',
          title: 'Star Citizen',
          icon: 'space shuttle',
          exact: true
        },
        {
          path: '/missions',
          component: '@rsi/star-citizen/components/MissionHome',
          title: 'Missions',
          icon: 'tasks',
          exact: true
        }
      ],
      metadata: {
        packageName: '@rsi/star-citizen',
        description: 'Star Citizen Live service with missions, activities, and Discord integration'
      }
    };
  }
}

module.exports = StarCitizen;
