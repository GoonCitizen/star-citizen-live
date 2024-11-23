'use strict';

const merge = require('lodash.merge');
const Hub = require('@fabric/hub');

class StarCitizen extends Hub {
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({}, this.settings, {
      state: {
        status: 'STOPPED'
      },
      http: {
        port: 3041
      }
    }, settings);

    this.routes = [
      { path: '/services/star-citizen', method: 'GET', handler: this.handleGenericRequest.bind(this) }
    ];

    this._state = {
      content: JSON.parse(JSON.stringify(this.settings.state))
    };

    return this;
  }

  handleGenericRequest (req, res, next) {
    console.debug('received request:', req);
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
