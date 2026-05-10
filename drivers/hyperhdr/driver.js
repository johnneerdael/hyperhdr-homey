'use strict';

const Homey = require('homey');

class HyperHdrDriver extends Homey.Driver {
  async onInit() {
    this.log('HyperHdrDriver init');
  }

  async onPairListDevices() {
    return [];
  }
}

module.exports = HyperHdrDriver;
