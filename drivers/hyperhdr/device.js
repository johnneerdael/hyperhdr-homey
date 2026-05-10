'use strict';

const Homey = require('homey');
const { initDevice, bindCapabilityListeners } = require('./deviceCore');

class HyperHdrDevice extends Homey.Device {
  async onInit() {
    this._ctx = await initDevice(this, this._initOpts());
    bindCapabilityListeners(this, this._ctx);
    try { await this.setAvailable(); } catch (_) {}
    this.log(`onInit complete; available=${this.getAvailable()} capabilities=${JSON.stringify(this.getCapabilities())}`);
  }

  async onAdded() {
    this.log('Device added (newly paired). Forcing setAvailable.');
    try { await this.setAvailable(); } catch (_) {}
  }

  async onDeleted() {
    if (this._ctx) await this._ctx.shutdown();
  }

  async onSettings() {
    if (this._ctx) await this._ctx.shutdown();
    this._ctx = await initDevice(this, this._initOpts());
    bindCapabilityListeners(this, this._ctx);
  }

  // Discovery lifecycle. Required when the driver has `discovery` configured —
  // without these the SDK's default onDiscoveryResult matches data.id and we
  // have no id, leaving the device "discovered but unmatched" → unavailable.

  onDiscoveryResult(result) {
    const settings = this.getSettings();
    const settingsHost = (settings.host || '').toLowerCase();
    if (!settingsHost) return false;
    if (result.address && result.address.toLowerCase() === settingsHost) return true;
    if (result.host && result.host.toLowerCase().replace(/\.$/, '') === settingsHost.replace(/\.local$/, '.local')) return true;
    if (result.name && result.name.toLowerCase() === settingsHost) return true;
    return false;
  }

  async onDiscoveryAvailable(result) {
    this.log(`Discovery match: address=${result.address} port=${result.port} name=${result.name}`);
    try { await this.setAvailable(); } catch (_) {}
  }

  async onDiscoveryAddressChanged(result) {
    this.log(`Discovery address changed → ${result.address}`);
    await this.setSettings({ host: result.address });
    if (this._ctx) {
      await this._ctx.shutdown();
      this._ctx = await initDevice(this, this._initOpts());
      bindCapabilityListeners(this, this._ctx);
      try { await this.setAvailable(); } catch (_) {}
    }
  }

  async onDiscoveryLastSeenChanged(result) {
    // Re-confirm availability when we see the device on the network again.
    try { await this.setAvailable(); } catch (_) {}
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
