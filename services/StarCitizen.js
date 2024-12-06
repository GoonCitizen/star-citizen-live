/**
 * Core service for Star Citizen.
 */
'use strict';

// Dependencies
const fetch = require('cross-fetch');
const merge = require('lodash.merge');
const { Tail } = require('tail');

// Fabric Types
const Actor = require('@fabric/core/types/actor');
const Hub = require('@fabric/hub');

// TODO: render GoonCitizen/goon.vc static site / import / upgrade it to use this tool
/**
 * Core service for Star Citizen.
 */
class StarCitizen extends Hub {
  /**
   * Create an instance of the Star Citizen service.
   * @param {Object} [settings] Configuration for this instance.
   * @param {Object} [settings.logfile=C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log] Path to the log file for Star Citizen.
   * @returns {StarCitizen} A new instance of the Star Citizen service.
   */
  constructor (settings = {}) {
    super(settings);

    // Settings
    this.settings = merge({}, this.settings, {
      authority: 'https://sensemaker.io',
      logfile: 'C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log',
      state: {
        status: 'STOPPED',
        logs: {},
        players: {},
        vehicles: {}
      },
      http: {
        port: 3041
      }
    }, settings);

    // HTTP Server
    this.routes = [
      // TODO: prefix with /services/star-citizen only when imported as library
      { path: '/services/star-citizen', method: 'GET', handler: this.handleGenericRequest.bind(this) },
      { path: '/services/star-citizen', method: 'POST', handler: this.handleGenericRequest.bind(this) },
      { path: '/services/star-citizen/activities', method: 'GET', handler: this.handleGenericRequest.bind(this) },
      { path: '/services/star-citizen/activities', method: 'POST', handler: this.handleGenericRequest.bind(this) },
      { path: '/services/star-citizen/messages', method: 'GET', handler: this.handleGenericRequest.bind(this) },
      { path: '/services/star-citizen/messages', method: 'POST', handler: this.handleGenericRequest.bind(this) },
      { path: '/services/star-citizen/kills', method: 'POST', handler: this.handleCreateKillRequest.bind(this) }
    ];

    this.logwatcher = null;

    // State
    this._state = {
      content: JSON.parse(JSON.stringify(this.settings.state))
    };

    return this;
  }

  get logs () {
    return Object.values(this.state.logs);
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

  handleCreateKillRequest (req, res, next) {
    console.debug('[PLACEHOLDER]', 'Creating kill:', req.body);
  }

  handleGenericRequest (req, res, next) {
    console.debug('received request:', req);
    return res.send('Hello, Star Citizen!');
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

    console.debug('[FABRIC]', '[STAR-CITIZEN]', '[LOG]', `[${actor.id}]`, message);
    this.emit('activity', activity);

    switch (message.parts[1]) {
      case '[Notice]':
      case 'CryAnimation:':
      case 'Warning':
        return this;
    }

    this._state.content.logs[actor.id] = message;
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
      console.error('Could not open log:', exception);
    }
  }

  async start () {
    this._state.status = 'STARTING';
    if (this.settings.http && this.settings.http.enable) await this.http.start();
    this.openLog();
    this._state.status = 'STARTED';
    this.commit();
    return this;
  }

  async stop () {
    this._state.status = 'STOPPING';
    if (this.settings.http && this.settings.http.enable) await this.http.stop();
    this._state.status = 'STOPPED';
    this.commit();
    return this;
  }
}

module.exports = StarCitizen;
