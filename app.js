'use strict';

const Homey = require('homey');

class HyperHdrApp extends Homey.App {
  async onInit() {
    this.log('HyperHDR app started.');
  }
}

module.exports = HyperHdrApp;
