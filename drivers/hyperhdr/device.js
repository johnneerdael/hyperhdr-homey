'use strict';

const Homey = require('homey');
const { initDevice, bindCapabilityListeners } = require('./deviceCore');

class HyperHdrDevice extends Homey.Device {
  async onInit() {
    this._ctx = await initDevice(this, this._initOpts());
    bindCapabilityListeners(this, this._ctx);
  }

  async onDeleted() {
    if (this._ctx) await this._ctx.shutdown();
  }

  async onSettings() {
    if (this._ctx) await this._ctx.shutdown();
    this._ctx = await initDevice(this, this._initOpts());
    bindCapabilityListeners(this, this._ctx);
  }

  _initOpts() {
    return {
      unavailableMessage: this.homey.__('errors.not_connected'),
      triggerFlowCard: async (id, tokens, state) => {
        try {
          const card = this.homey.flow.getDeviceTriggerCard(id);
          await card.trigger(this, tokens, state || {});
        } catch (err) {
          this.error(`triggerFlowCard ${id} failed:`, err.message);
        }
      }
    };
  }
}

module.exports = HyperHdrDevice;
