'use strict';

const { EventEmitter } = require('node:events');

class MockDevice extends EventEmitter {
  constructor({ data, settings = {}, store = {} } = {}) {
    super();
    this._data = data;
    this._settings = settings;
    this._store = store;
    this._capabilities = new Map();
    this._capabilityOptions = new Map();
    this._available = true;
    this._unavailableReason = null;
    this._listeners = new Map();
    this._triggers = [];
  }

  getData() { return this._data; }
  getSettings() { return this._settings; }
  getStoreValue(key) { return this._store[key]; }
  async setStoreValue(key, val) { this._store[key] = val; }
  getCapabilityValue(cap) { return this._capabilities.get(cap); }
  async setCapabilityValue(cap, val) { this._capabilities.set(cap, val); }
  async setCapabilityOptions(cap, opts) { this._capabilityOptions.set(cap, opts); }
  registerCapabilityListener(cap, fn) { this._listeners.set(cap, fn); }
  async setAvailable() { this._available = true; this._unavailableReason = null; }
  async setUnavailable(reason) { this._available = false; this._unavailableReason = reason; }
  log() { /* noop */ }
  error() { /* noop */ }

  triggerCapability(cap, val) {
    const fn = this._listeners.get(cap);
    if (!fn) throw new Error(`no listener for ${cap}`);
    return fn(val, {});
  }
  getCapabilityOptions(cap) { return this._capabilityOptions.get(cap); }
  isAvailable() { return this._available; }
  unavailableReason() { return this._unavailableReason; }
  flowTriggers() { return this._triggers; }

  // Returns a triggerFlowCard fn suitable for `initDevice(this, { triggerFlowCard })`
  triggerFlowCard() {
    return (id, tokens, state) => this._triggers.push({ id, tokens, state });
  }
}

module.exports = { MockDevice };
