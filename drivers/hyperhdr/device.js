'use strict';

const Homey = require('homey');
const { initDevice } = require('./deviceCore');

class HyperHdrDevice extends Homey.Device {
  async onInit() {
    this._ctx = await initDevice(this);
    this._bindCapabilityListeners();
  }

  async onDeleted() {
    if (this._ctx) await this._ctx.shutdown();
  }

  async onSettings({ newSettings }) {
    if (this._ctx) await this._ctx.shutdown();
    this._ctx = await initDevice(this);
    this._bindCapabilityListeners();
  }

  _bindCapabilityListeners() {
    // Filled in subsequent tasks
  }
}

module.exports = HyperHdrDevice;
