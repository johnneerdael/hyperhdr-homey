'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startMockServer } = require('./helpers/mockHyperHdrServer');
const { listDevicesForServer } = require('../drivers/hyperhdr/pairing');

test('listDevicesForServer returns one device per running instance', async () => {
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      if (msg.command === 'authorize' && msg.subcommand === 'tokenRequired') {
        ws.send(JSON.stringify({
          command: 'authorize-tokenRequired', success: true, tan: msg.tan,
          info: { required: false }
        }));
      } else if (msg.command === 'serverinfo') {
        ws.send(JSON.stringify({
          command: 'serverinfo', success: true, tan: msg.tan,
          info: {
            cid: 'srv-abc',
            instance: [
              { instance: 0, friendly_name: 'Living Room', running: true },
              { instance: 1, friendly_name: 'Kitchen',     running: true },
              { instance: 2, friendly_name: 'Disabled',    running: false }
            ]
          }
        }));
      }
    }
  });

  const devices = await listDevicesForServer({ host: '127.0.0.1', port: mock.port });
  assert.equal(devices.length, 2);
  assert.equal(devices[0].name, 'HyperHDR — Living Room');
  assert.deepEqual(devices[0].data, { serverId: 'srv-abc', instance: 0 });
  assert.equal(devices[0].settings.host, '127.0.0.1');
  assert.equal(devices[0].settings.port, mock.port);
  await mock.stop();
});
