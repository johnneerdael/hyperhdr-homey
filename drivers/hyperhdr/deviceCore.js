'use strict';

const HyperHdrClient = require('../../lib/HyperHdrClient');

const SUBSCRIPTIONS = ['components-update', 'priorities-update', 'effects-update', 'instance-update'];

async function initDevice(device, opts = {}) {
  const settings = device.getSettings();
  const data = device.getData();
  const token = device.getStoreValue('token') || null;

  const client = new HyperHdrClient({
    host: settings.host,
    port: settings.port || 8090,
    token,
    reconnect: opts.reconnect
  });

  const state = {
    instance: data.instance,
    snapshot: null,
    lastBaseRgb: [255, 255, 255],
    lastEffect: null,
    activeEffect: null
  };

  const ctx = { client, state, async shutdown() { await client.stop(); } };

  client.on('error', err => device.error('client error', err.message));
  client.on('closed', () => device.setUnavailable(opts.unavailableMessage || 'Cannot reach HyperHDR'));
  client.on('connected', async () => {
    try {
      await bootstrap(client, device, state);
      await device.setAvailable();
    } catch (err) {
      device.error('bootstrap failed', err.message);
      await device.setUnavailable(err.message);
    }
  });
  client.on('update', msg => onPushUpdate(msg, device, state));

  try {
    await client.start();
    await bootstrap(client, device, state);
    await device.setAvailable();
  } catch (err) {
    await device.setUnavailable(opts.unavailableMessage || 'Cannot reach HyperHDR');
  }

  return ctx;
}

async function bootstrap(client, device, state) {
  if (await client.tokenRequired()) {
    await client.authorize();
  }
  await client.request({ command: 'instance', subcommand: 'switchTo', instance: state.instance });
  await client.subscribe(SUBSCRIPTIONS);
  const reply = await client.request({ command: 'serverinfo' });
  state.snapshot = reply.info || {};
  await refreshEffectOptions(device, state.snapshot.effects || []);
}

async function refreshEffectOptions(device, effects) {
  const values = [{ id: '__none__', title: { en: 'No effect' } }];
  for (const e of effects) {
    if (!e || !e.name) continue;
    values.push({ id: e.name, title: { en: e.name } });
  }
  await device.setCapabilityOptions('hyperhdr_effect', { values });
}

function onPushUpdate(msg, device, state) {
  // Filled in Task 16
}

function bindCapabilityListeners(device, ctx) {
  device.registerCapabilityListener('onoff', value => onOnOff(device, ctx, value));
}

async function onOnOff(device, ctx, value) {
  const settings = device.getSettings();
  await ctx.client.request({
    command: 'componentstate',
    componentstate: { component: 'LEDDEVICE', state: Boolean(value) }
  });
  if (value) {
    await applyLastColor(device, ctx);
  } else {
    await ctx.client.request({ command: 'clear', priority: settings.priority });
  }
}

async function applyLastColor(device, ctx) {
  const settings = device.getSettings();
  const rgb = ctx.state.lastBaseRgb || [255, 255, 255];
  const dim = device.getCapabilityValue('dim');
  const factor = typeof dim === 'number' ? dim : 1;
  const scaled = [
    Math.round(rgb[0] * factor),
    Math.round(rgb[1] * factor),
    Math.round(rgb[2] * factor)
  ];
  await ctx.client.request({
    command: 'color',
    priority: settings.priority,
    origin: settings.origin || 'Homey',
    color: scaled
  });
}

module.exports = {
  initDevice,
  refreshEffectOptions,
  onPushUpdate,
  bindCapabilityListeners,
  applyLastColor,
  SUBSCRIPTIONS
};
