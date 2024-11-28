/**
 * Core service for Star Citizen.
 */
'use strict';

// Dependencies
const fs = require('fs');
const merge = require('lodash.merge');
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
      logfile: 'C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/logs',
      state: {
        status: 'STOPPED'
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
      { path: '/services/star-citizen/messages', method: 'POST', handler: this.handleGenericRequest.bind(this) }
    ];

    // State
    this._state = {
      content: JSON.parse(JSON.stringify(this.settings.state))
    };

    return this;
  }

  handleGenericRequest (req, res, next) {
    console.debug('received request:', req);
    return res.send('Hello, Star Citizen!');
  }

  handleLogChange (current, previous) {
    console.debug('previous:', previous);
    console.debug('current:', current);
  }

  openLog () {
    this.logwatcher = fs.watch(this.settings.logfile, this.handleLogChange.bind(this));
  }

  async start () {
    this._state.status = 'STARTING';
    await this.http.start();
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
