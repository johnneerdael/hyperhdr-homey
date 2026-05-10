'use strict';

const Homey = require('homey');
const { initDevice, bindCapabilityListeners } = require('./deviceCore');

class HyperHdrDevice extends Homey.Device {
  async onInit() {
    this.driver.triggerCardFire = async (id, tokens, state) => {
      const card = this.homey.flow.getDeviceTriggerCard(id);
      await card.trigger(this, tokens, state || {});
    };
    this._ctx = await initDevice(this);
    bindCapabilityListeners(this, this._ctx);
  }

  async onDeleted() {
    if (this._ctx) await this._ctx.shutdown();
  }

  async onSettings({ newSettings }) {
    if (this._ctx) await this._ctx.shutdown();
    this._ctx = await initDevice(this);
    bindCapabilityListeners(this, this._ctx);
  }
}

module.exports = HyperHdrDevice;
