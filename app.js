'use strict';

const Homey = require('homey');

// Optional inspector. Set DEBUG=1 in app env to attach Chrome DevTools at
// chrome://inspect → Configure → 0.0.0.0:9229 → Inspect.
if (process.env.DEBUG === '1') {
  require('inspector').open(9229, '0.0.0.0', false);
}

class HyperHdrApp extends Homey.App {
  async onInit() {
    this.log('HyperHDR app started.');
  }
}

module.exports = HyperHdrApp;
