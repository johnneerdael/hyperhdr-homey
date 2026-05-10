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

test('correlates concurrent requests by tan', async () => {
  const replies = new Map([
    ['serverinfo', { command: 'serverinfo', success: true, info: {} }],
    ['sysinfo', { command: 'sysinfo', success: true, info: { hostname: 'h' } }]
  ]);
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      const base = replies.get(msg.command);
      if (!base) return;
      const delay = msg.command === 'serverinfo' ? 30 : 5;
      setTimeout(() => ws.send(JSON.stringify({ ...base, tan: msg.tan })), delay);
    }
  });

  const client = new HyperHdrClient({ host: '127.0.0.1', port: mock.port });
  await client.connect();
  const [a, b] = await Promise.all([
    client.request({ command: 'serverinfo' }),
    client.request({ command: 'sysinfo' })
  ]);
  assert.equal(a.command, 'serverinfo');
  assert.equal(b.command, 'sysinfo');
  await client.close();
  await mock.stop();
});
