'use strict';

const Homey = require('homey');
const { listDevicesForServer } = require('./pairing');

class HyperHdrDriver extends Homey.Driver {
  async onInit() {
    this.log('HyperHdrDriver init');
  }

  onPair(session) {
    let pairContext = { host: null, port: 8090, token: null };

    session.setHandler('list_devices', async () => {
      const discovered = this.getDiscoveryStrategy().getDiscoveryResults();
      const results = [];
      for (const d of Object.values(discovered)) {
        const host = d.address;
        const port = d.port || (d.txt && Number(d.txt.port)) || 8090;
        try {
          const devices = await listDevicesForServer({ host, port });
          results.push(...devices);
        } catch (err) {
          if (err.code === 'EAUTHREQUIRED') {
            this.log(`Server ${host} requires auth, skipping silent enumeration`);
          } else {
            this.error(`Failed to enumerate ${host}:`, err.message);
          }
        }
      }
      return results;
    });

    session.setHandler('manual_submit', async ({ host, port }) => {
      pairContext = { host, port: Number(port) || 8090, token: null };
      try {
        const devices = await listDevicesForServer(pairContext);
        return { devices };
      } catch (err) {
        if (err.code === 'EAUTHREQUIRED') {
          await session.showView('auth');
          return { devices: null, requiresAuth: true };
        }
        throw err;
      }
    });

    session.setHandler('auth_submit', async ({ token }) => {
      pairContext.token = token;
      const devices = await listDevicesForServer(pairContext);
      return { devices };
    });
  }
}

module.exports = HyperHdrDriver;
