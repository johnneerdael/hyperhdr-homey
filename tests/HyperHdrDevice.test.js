'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startMockServer } = require('./helpers/mockHyperHdrServer');
const { MockDevice } = require('./helpers/mockHomey');
const { initDevice, bindCapabilityListeners } = require('../drivers/hyperhdr/deviceCore');

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

function makeServer(sent) {
  return startMockServer({
    onMessage: (msg, ws) => {
      sent.push(msg);
      if (msg.command === 'authorize' && msg.subcommand === 'tokenRequired') {
        ws.send(JSON.stringify({ command: 'authorize-tokenRequired', success: true, tan: msg.tan, info: { required: false } }));
      } else if (msg.command === 'serverinfo') {
        ws.send(JSON.stringify({
          command: 'serverinfo', success: true, tan: msg.tan,
          info: { cid: 'srv-1', effects: [{ name: 'Rainbow' }], instance: [{ instance: 0, friendly_name: 'L', running: true }], components: [], priorities: [] }
        }));
      } else {
        ws.send(JSON.stringify({ command: msg.command, success: true, tan: msg.tan }));
      }
    }
  });
}

test('onoff true enables LEDDEVICE and reapplies last solid color', async () => {
  const sent = [];
  const mock = await makeServer(sent);
  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: mock.port, priority: 128, origin: 'Homey' }
  });
  const ctx = await initDevice(device);
  bindCapabilityListeners(device, ctx);

  await device.setCapabilityValue('light_hue', 0);
  await device.setCapabilityValue('light_saturation', 1);
  await device.setCapabilityValue('dim', 1);
  ctx.state.lastBaseRgb = [255, 0, 0];

  sent.length = 0;
  await device.triggerCapability('onoff', true);

  const componentstate = sent.find(m => m.command === 'componentstate');
  assert.ok(componentstate);
  assert.equal(componentstate.componentstate.component, 'LEDDEVICE');
  assert.equal(componentstate.componentstate.state, true);

  const colorCmd = sent.find(m => m.command === 'color');
  assert.ok(colorCmd, 'color reapplied after on');
  assert.deepEqual(colorCmd.color, [255, 0, 0]);

  await ctx.shutdown();
  await mock.stop();
});

test('onoff false disables LEDDEVICE and clears our priority', async () => {
  const sent = [];
  const mock = await makeServer(sent);
  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: mock.port, priority: 128, origin: 'Homey' }
  });
  const ctx = await initDevice(device);
  bindCapabilityListeners(device, ctx);

  sent.length = 0;
  await device.triggerCapability('onoff', false);

  const componentstate = sent.find(m => m.command === 'componentstate');
  assert.equal(componentstate.componentstate.state, false);
  const clearCmd = sent.find(m => m.command === 'clear');
  assert.ok(clearCmd);
  assert.equal(clearCmd.priority, 128);

  await ctx.shutdown();
  await mock.stop();
});

test('setting hue triggers a color command with brightness applied', async () => {
  const sent = [];
  const mock = await makeServer(sent);
  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: mock.port, priority: 100, origin: 'Homey' }
  });
  const ctx = await initDevice(device);
  bindCapabilityListeners(device, ctx);

  await device.setCapabilityValue('light_saturation', 1);
  await device.setCapabilityValue('dim', 0.5);
  sent.length = 0;
  await device.triggerCapability('light_hue', 0);

  const colorCmd = sent.find(m => m.command === 'color');
  assert.ok(colorCmd);
  assert.equal(colorCmd.priority, 100);
  assert.deepEqual(colorCmd.color, [128, 0, 0]);
  assert.equal(colorCmd.origin, 'Homey');

  await ctx.shutdown();
  await mock.stop();
});

test('dim updates color when in solid mode', async () => {
  const sent = [];
  const mock = await makeServer(sent);
  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: mock.port, priority: 100, origin: 'Homey' }
  });
  const ctx = await initDevice(device);
  bindCapabilityListeners(device, ctx);

  await device.setCapabilityValue('light_hue', 0);
  await device.setCapabilityValue('light_saturation', 1);
  await device.setCapabilityValue('dim', 1);
  ctx.state.lastBaseRgb = [255, 0, 0];

  sent.length = 0;
  await device.triggerCapability('dim', 0.25);

  const colorCmd = sent.find(m => m.command === 'color');
  assert.ok(colorCmd);
  assert.deepEqual(colorCmd.color, [64, 0, 0]);

  await ctx.shutdown();
  await mock.stop();
});

test('setting effect sends effect command at priority', async () => {
  const sent = [];
  const mock = await makeServer(sent);
  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: mock.port, priority: 128, origin: 'Homey' }
  });
  const ctx = await initDevice(device);
  bindCapabilityListeners(device, ctx);

  sent.length = 0;
  await device.triggerCapability('hyperhdr_effect', 'Rainbow');
  const effectCmd = sent.find(m => m.command === 'effect');
  assert.ok(effectCmd);
  assert.equal(effectCmd.priority, 128);
  assert.equal(effectCmd.effect.name, 'Rainbow');
  assert.equal(ctx.state.lastEffect, 'Rainbow');

  await ctx.shutdown();
  await mock.stop();
});

test('setting effect to __none__ clears priority and restores last color', async () => {
  const sent = [];
  const mock = await makeServer(sent);
  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: mock.port, priority: 128, origin: 'Homey' }
  });
  const ctx = await initDevice(device);
  bindCapabilityListeners(device, ctx);

  await device.setCapabilityValue('dim', 1);
  ctx.state.lastBaseRgb = [10, 20, 30];
  ctx.state.lastEffect = 'Rainbow';

  sent.length = 0;
  await device.triggerCapability('hyperhdr_effect', '__none__');
  const clearCmd = sent.find(m => m.command === 'clear');
  assert.ok(clearCmd);
  assert.equal(clearCmd.priority, 128);
  const colorCmd = sent.find(m => m.command === 'color');
  assert.ok(colorCmd);
  assert.deepEqual(colorCmd.color, [10, 20, 30]);
  assert.equal(ctx.state.lastEffect, null);

  await ctx.shutdown();
  await mock.stop();
});

test('component change push fires component_changed trigger', async () => {
  const sent = [];
  const mock = await makeServer(sent);
  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: mock.port, priority: 128, origin: 'Homey' }
  });
  const ctx = await initDevice(device);
  bindCapabilityListeners(device, ctx);

  for (const ws of mock.wss.clients) {
    ws.send(JSON.stringify({ command: 'components-update', data: { name: 'LEDDEVICE', enabled: false } }));
  }
  await new Promise(r => setTimeout(r, 30));

  const triggers = device.flowTriggers();
  const cc = triggers.find(t => t.id === 'component_changed');
  assert.ok(cc, 'component_changed fired');
  assert.equal(cc.tokens.component, 'LEDDEVICE');
  assert.equal(cc.tokens.state, false);

  await ctx.shutdown();
  await mock.stop();
});

test('priorities-update fires effect_started then effect_stopped', async () => {
  const sent = [];
  const mock = await makeServer(sent);
  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: mock.port, priority: 128, origin: 'Homey' }
  });
  const ctx = await initDevice(device);
  bindCapabilityListeners(device, ctx);

  for (const ws of mock.wss.clients) {
    ws.send(JSON.stringify({
      command: 'priorities-update',
      data: { priorities: [{ priority: 200, owner: 'EFFECT', componentId: 'EFFECT', visible: true, value: { effect: 'Rainbow' } }] }
    }));
  }
  await new Promise(r => setTimeout(r, 30));
  let triggers = device.flowTriggers();
  assert.ok(triggers.find(t => t.id === 'effect_started' && t.tokens.effect === 'Rainbow'));

  for (const ws of mock.wss.clients) {
    ws.send(JSON.stringify({ command: 'priorities-update', data: { priorities: [] } }));
  }
  await new Promise(r => setTimeout(r, 30));
  triggers = device.flowTriggers();
  assert.ok(triggers.find(t => t.id === 'effect_stopped' && t.tokens.effect === 'Rainbow'));

  await ctx.shutdown();
  await mock.stop();
});
