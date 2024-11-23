'use strict';

const Hub = require('@fabric/hub');

class StarCitizen extends Hub {
  constructor (settings = {}) {
    super(this);

    this.settings = merge({}, this.settings, {
      state: {
        status: 'STOPPED'
      }
    }, settings);

    this._state = {
      content: JSON.parse(JSON.stringify(this.settings.state))
    };

    return this;
  }
}

module.exports = StarCitizen;