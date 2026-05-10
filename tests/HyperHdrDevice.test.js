'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startMockServer } = require('./helpers/mockHyperHdrServer');
const { MockDevice } = require('./helpers/mockHomey');
const { initDevice } = require('../drivers/hyperhdr/deviceCore');

function serverinfoReply(tan, instance = 0) {
  return {
    command: 'serverinfo', success: true, tan,
    info: {
      cid: 'srv-1',
      effects: [{ name: 'Rainbow' }, { name: 'Knight rider' }],
      instance: [{ instance, friendly_name: 'Living', running: true }],
      priorities: [],
      components: [
        { name: 'LEDDEVICE', enabled: true },
        { name: 'SMOOTHING', enabled: true }
      ]
    }
  };
}

test('initDevice connects, subscribes, populates effect options', async () => {
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      if (msg.command === 'authorize' && msg.subcommand === 'tokenRequired') {
        ws.send(JSON.stringify({ command: 'authorize-tokenRequired', success: true, tan: msg.tan, info: { required: false } }));
      } else if (msg.command === 'instance') {
        ws.send(JSON.stringify({ command: 'instance', success: true, tan: msg.tan }));
      } else if (msg.command === 'serverinfo') {
        ws.send(JSON.stringify(serverinfoReply(msg.tan)));
      }
    }
  });

  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: mock.port, priority: 128, origin: 'Homey' }
  });

  const ctx = await initDevice(device);
  const opts = device.getCapabilityOptions('hyperhdr_effect');
  assert.ok(opts, 'effect options were set');
  const ids = opts.values.map(v => v.id);
  assert.ok(ids.includes('__none__'));
  assert.ok(ids.includes('Rainbow'));
  assert.ok(ids.includes('Knight rider'));
  assert.equal(device.isAvailable(), true);

  await ctx.shutdown();
  await mock.stop();
});

test('initDevice marks unavailable when server is unreachable', async () => {
  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: 1, priority: 128, origin: 'Homey' }
  });
  const ctx = await initDevice(device, { reconnect: { initialDelayMs: 5, maxDelayMs: 20, jitter: false } });
  assert.equal(device.isAvailable(), false);
  assert.match(device.unavailableReason() || '', /reach/i);
  await ctx.shutdown();
});
