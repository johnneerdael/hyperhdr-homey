'use strict';

const Homey = require('homey');
const { initDevice, bindCapabilityListeners } = require('./deviceCore');

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
    bindCapabilityListeners(this, this._ctx);
  }
}

module.exports = HyperHdrDevice;
