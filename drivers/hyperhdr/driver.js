'use strict';

const Homey = require('homey');
const { hexToRgb, rgbToHsv } = require('../../lib/color');
const { listDevicesForServer } = require('./pairing');

class HyperHdrDriver extends Homey.Driver {
  async onInit() {
    this.log('HyperHdrDriver init');

    const startEffect = this.homey.flow.getActionCard('start_effect');
    startEffect.registerArgumentAutocompleteListener('effect', async (query, args) => {
      const device = args.device;
      const effects = device._ctx?.state?.snapshot?.effects || [];
      return effects
        .filter(e => e && e.name)
        .filter(e => !query || e.name.toLowerCase().includes(query.toLowerCase()))
        .map(e => ({ name: e.name }));
    });
    startEffect.registerRunListener(async (args) => {
      const device = args.device;
      const settings = device.getSettings();
      const payload = {
        command: 'effect',
        priority: settings.priority,
        origin: settings.origin || 'Homey',
        effect: { name: args.effect.name }
      };
      if (args.duration && args.duration > 0) payload.duration = args.duration;
      await device._ctx.client.request(payload);
      device._ctx.state.lastEffect = args.effect.name;
    });

    const setColor = this.homey.flow.getActionCard('set_color');
    setColor.registerRunListener(async (args) => {
      const device = args.device;
      const settings = device.getSettings();
      const baseRgb = hexToRgb(args.color);
      const dim = device.getCapabilityValue('dim') ?? 1;
      const finalRgb = baseRgb.map(c => Math.round(c * dim));
      const payload = {
        command: 'color',
        priority: settings.priority,
        origin: settings.origin || 'Homey',
        color: finalRgb
      };
      if (args.duration && args.duration > 0) payload.duration = args.duration;
      await device._ctx.client.request(payload);

      const hsv = rgbToHsv(baseRgb);
      device._ctx.state.lastBaseRgb = baseRgb;
      device._ctx.state.lastEffect = null;
      await device.setCapabilityValue('light_hue', hsv.hue);
      await device.setCapabilityValue('light_saturation', hsv.saturation);
      if (device.getCapabilityValue('hyperhdr_effect') !== '__none__') {
        await device.setCapabilityValue('hyperhdr_effect', '__none__');
      }
    });

    const clearEffect = this.homey.flow.getActionCard('clear_effect');
    clearEffect.registerRunListener(async (args) => {
      const device = args.device;
      const settings = device.getSettings();
      await device._ctx.client.request({ command: 'clear', priority: settings.priority });
      device._ctx.state.lastEffect = null;
      const dim = device.getCapabilityValue('dim') ?? 1;
      if (dim > 0 && device._ctx.state.lastBaseRgb) {
        await device._ctx.client.request({
          command: 'color',
          priority: settings.priority,
          origin: settings.origin || 'Homey',
          color: device._ctx.state.lastBaseRgb.map(c => Math.round(c * dim))
        });
      }
    });
  }

  onPair(session) {
    let pendingDevices = [];
    let pairContext = { host: null, port: 8090, token: null };

    session.setHandler('discover_servers', async () => {
      const discovered = this.getDiscoveryStrategy().getDiscoveryResults() || {};
      const servers = [];
      for (const d of Object.values(discovered)) {
        const host = d.address;
        const port = d.port || 8090;
        const name = d.name || `${host}:${port}`;
        servers.push({ host, port, name });
      }
      this.log(`Pair discover_servers: ${servers.length} server(s) found`);
      return servers;
    });

    session.setHandler('manual_submit', async ({ host, port }) => {
      pairContext = { host, port: Number(port) || 8090, token: null };
      try {
        const devices = await listDevicesForServer(pairContext);
        pendingDevices = devices;
        return { devices };
      } catch (err) {
        if (err.code === 'EAUTHREQUIRED') {
          return { devices: null, requiresAuth: true };
        }
        this.error('manual_submit failed:', err.message);
        throw err;
      }
    });

    session.setHandler('auth_submit', async ({ token }) => {
      pairContext.token = token;
      const devices = await listDevicesForServer(pairContext);
      pendingDevices = devices;
      return { devices };
    });

    session.setHandler('list_devices', async () => {
      // Called by the `add_devices` template. Return whatever the user lined up.
      return pendingDevices;
    });
  }
}

module.exports = HyperHdrDriver;
