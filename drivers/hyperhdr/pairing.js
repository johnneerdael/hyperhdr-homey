'use strict';

const HyperHdrClient = require('../../lib/HyperHdrClient');

async function listDevicesForServer({ host, port = 8090, token = null } = {}) {
  const client = new HyperHdrClient({ host, port, token });
  await client.connect();
  try {
    if (await client.tokenRequired()) {
      if (!token) {
        const err = new Error('token required');
        err.code = 'EAUTHREQUIRED';
        throw err;
      }
      await client.authorize();
    }
    const reply = await client.request({ command: 'serverinfo' });
    const info = reply.info || {};
    if (!info.cid) {
      const err = new Error('HyperHDR server did not report a stable id (cid). Update HyperHDR or contact the maintainer.');
      err.code = 'ENOSERVERID';
      throw err;
    }
    const serverId = info.cid;
    const instances = (info.instance || []).filter(i => i.running);
    return instances.map(i => ({
      name: `HyperHDR — ${i.friendly_name}`,
      data: { serverId, instance: i.instance },
      settings: { host, port, priority: 128, origin: 'Homey' },
      store: token ? { token } : {}
    }));
  } finally {
    await client.close();
  }
}

module.exports = { listDevicesForServer };
