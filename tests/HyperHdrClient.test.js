'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startMockServer } = require('./helpers/mockHyperHdrServer');
const HyperHdrClient = require('../lib/HyperHdrClient');

test('connects, sends serverinfo, receives reply, closes cleanly', async () => {
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      if (msg.command === 'serverinfo') {
        ws.send(JSON.stringify({
          command: 'serverinfo',
          success: true,
          tan: msg.tan,
          info: { instance: [{ instance: 0, friendly_name: 'HyperHDR', running: true }] }
        }));
      }
    }
  });

  const client = new HyperHdrClient({ host: '127.0.0.1', port: mock.port });
  await client.connect();
  const reply = await client.request({ command: 'serverinfo' });
  assert.equal(reply.success, true);
  assert.deepEqual(reply.info.instance[0].friendly_name, 'HyperHDR');
  await client.close();
  await mock.stop();
});
