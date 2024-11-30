/**
 * Core service for Star Citizen.
 */
'use strict';

// Dependencies
const merge = require('lodash.merge');
const { Tail } = require('tail');

const Hub = require('@fabric/hub');

// TODO: render GoonCitizen/goon.vc static site / import / upgrade it to use this tool
/**
 * Core service for Star Citizen.
 */
class StarCitizen extends Hub {
  /**
   * Create an instance of the Star Citizen service.
   * @param {Object} settings Configuration for this instance.
   * @returns {StarCitizen} A new instance of the Star Citizen service.
   */
  constructor (settings = {}) {
    super(settings);

    // Settings
    this.settings = merge({}, this.settings, {
      logfile: 'C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log',
      state: {
        status: 'STOPPED',
        players: {},
        vehicles: {}
      },
      http: {
        port: 3041
      }
    }, settings);

    // HTTP Server
    this.routes = [
      { path: '/services/star-citizen', method: 'GET', handler: this.handleGenericRequest.bind(this) },
      { path: '/services/star-citizen', method: 'POST', handler: this.handleGenericRequest.bind(this) },
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

  handleCreateKillRequest (req, res, next) {
    console.debug('[PLACEHOLDER]', 'Creating kill:', req.body);
  }

  handleGenericRequest (req, res, next) {
    console.debug('received request:', req);
    return res.send('Hello, Star Citizen!');
  }

  handleLogChange (entry) {
    console.debug('entry:', entry);
  }

  handleLogError (error) {
    console.error('Error reading log:', error);
  }

  openLog () {
    // this.logwatcher = fs.watchFile(this.settings.logfile, this.handleLogChange.bind(this));
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
    await this.http.start();
    this.openLog();
    this._state.status = 'STARTED';
    this.commit();
    return this;
  }

  async stop () {
    this._state.status = 'STOPPING';
    await this.http.stop();
    this._state.status = 'STOPPED';
    this.commit();
    return this;
  }
}

module.exports = StarCitizen;
