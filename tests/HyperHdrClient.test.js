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

test('authorize sends token and resolves on success', async () => {
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      if (msg.command === 'authorize' && msg.subcommand === 'login' && msg.token === 'good') {
        ws.send(JSON.stringify({ command: 'authorize-login', success: true, tan: msg.tan }));
      } else if (msg.command === 'authorize') {
        ws.send(JSON.stringify({
          command: 'authorize-login', success: false, tan: msg.tan, error: 'No Authorization'
        }));
      }
    }
  });

  const client = new HyperHdrClient({ host: '127.0.0.1', port: mock.port, token: 'good' });
  await client.connect();
  await client.authorize();
  await client.close();
  await mock.stop();
});

test('authorize rejects on bad token', async () => {
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      if (msg.command === 'authorize') {
        ws.send(JSON.stringify({
          command: 'authorize-login', success: false, tan: msg.tan, error: 'No Authorization'
        }));
      }
    }
  });

  const client = new HyperHdrClient({ host: '127.0.0.1', port: mock.port, token: 'bad' });
  await client.connect();
  await assert.rejects(() => client.authorize(), /No Authorization/);
  await client.close();
  await mock.stop();
});

test('tokenRequired probe returns true when server requires auth', async () => {
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      if (msg.command === 'authorize' && msg.subcommand === 'tokenRequired') {
        ws.send(JSON.stringify({
          command: 'authorize-tokenRequired',
          success: true,
          tan: msg.tan,
          info: { required: true }
        }));
      }
    }
  });
  const client = new HyperHdrClient({ host: '127.0.0.1', port: mock.port });
  await client.connect();
  assert.equal(await client.tokenRequired(), true);
  await client.close();
  await mock.stop();
});

test('emits update events for unsolicited push messages', async () => {
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      if (msg.command === 'serverinfo') {
        ws.send(JSON.stringify({
          command: 'serverinfo', success: true, tan: msg.tan, info: { instance: [] }
        }));
        setTimeout(() => ws.send(JSON.stringify({
          command: 'components-update',
          data: { name: 'LEDDEVICE', enabled: false }
        })), 10);
      }
    }
  });

  const client = new HyperHdrClient({ host: '127.0.0.1', port: mock.port });
  await client.connect();
  const updatePromise = new Promise(resolve => client.once('update', resolve));
  await client.request({ command: 'serverinfo' });
  const update = await updatePromise;
  assert.equal(update.command, 'components-update');
  assert.equal(update.data.name, 'LEDDEVICE');
  assert.equal(update.data.enabled, false);
  await client.close();
  await mock.stop();
});

test('subscribe sends serverinfo with subscribe array', async () => {
  let received = null;
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      if (msg.command === 'serverinfo') {
        received = msg;
        ws.send(JSON.stringify({
          command: 'serverinfo', success: true, tan: msg.tan, info: {}
        }));
      }
    }
  });
  const client = new HyperHdrClient({ host: '127.0.0.1', port: mock.port });
  await client.connect();
  await client.subscribe(['components-update', 'priorities-update']);
  assert.deepEqual(received.subscribe, ['components-update', 'priorities-update']);
  await client.close();
  await mock.stop();
});
