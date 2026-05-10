'use strict';

const HyperHdrClient = require('../../lib/HyperHdrClient');
const { hsvToScaledRgb } = require('../../lib/color');

const SUBSCRIPTIONS = ['components-update', 'priorities-update', 'effects-update', 'instance-update'];

async function initDevice(device, opts = {}) {
  const settings = device.getSettings();
  const data = device.getData();
  const token = device.getStoreValue('token') || null;
  const unavailableMessage = opts.unavailableMessage || 'Cannot reach HyperHDR';
  const triggerFlowCard = opts.triggerFlowCard || (() => {});

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

  const ctx = {
    client,
    state,
    triggerFlowCard,
    async shutdown() { await client.stop(); }
  };

  let firstConnectHandled = false;

  client.on('error', err => device.error('client error', err.message));
  client.on('closed', () => device.setUnavailable(unavailableMessage));
  client.on('connected', async () => {
    if (!firstConnectHandled) return; // initial bootstrap runs inline below
    try {
      await bootstrap(client, device, state);
      await device.setAvailable();
    } catch (err) {
      device.error('reconnect bootstrap failed', err.message);
      await device.setUnavailable(err.message);
    }
  });
  client.on('update', msg => onPushUpdate(msg, device, ctx));

  try {
    await client.start();
    await bootstrap(client, device, state);
    firstConnectHandled = true;
    await device.setAvailable();
  } catch (err) {
    firstConnectHandled = true;
    await device.setUnavailable(unavailableMessage);
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

function onPushUpdate(msg, device, ctx) {
  switch (msg.command) {
    case 'components-update':
      handleComponentsUpdate(msg.data, ctx);
      break;
    case 'priorities-update':
      handlePrioritiesUpdate(msg.data, ctx);
      break;
    case 'effects-update':
      if (Array.isArray(msg.data && msg.data.effects)) {
        refreshEffectOptions(device, msg.data.effects).catch(err => device.error(err.message));
      }
      break;
    case 'instance-update':
      // No-op: Homey devices are pinned to a specific instance
      break;
  }
}

function handleComponentsUpdate(data, ctx) {
  if (!data || !data.name) return;
  const tracked = ['LEDDEVICE', 'SMOOTHING', 'HDR'];
  if (!tracked.includes(data.name)) return;
  ctx.triggerFlowCard('component_changed', { component: data.name, state: Boolean(data.enabled) }, {});
}

function handlePrioritiesUpdate(data, ctx) {
  const next = pickEffect(data && data.priorities);
  const prev = ctx.state.activeEffect || null;
  if (next && next !== prev) {
    ctx.triggerFlowCard('effect_started', { effect: next }, {});
  }
  if (!next && prev) {
    ctx.triggerFlowCard('effect_stopped', { effect: prev }, {});
  }
  ctx.state.activeEffect = next;
}

function pickEffect(priorities) {
  if (!Array.isArray(priorities)) return null;
  for (const p of priorities) {
    if (!p.visible) continue;
    if (p.componentId === 'EFFECT' || (p.owner && /effect/i.test(p.owner))) {
      return (p.value && p.value.effect) || p.owner || 'effect';
    }
  }
  return null;
}

function bindCapabilityListeners(device, ctx) {
  device.registerCapabilityListener('onoff', value => onOnOff(device, ctx, value));
  device.registerCapabilityListener('dim', value => onColorComponent(device, ctx, { dim: value }));
  device.registerCapabilityListener('light_hue', value => onColorComponent(device, ctx, { hue: value }));
  device.registerCapabilityListener('light_saturation', value => onColorComponent(device, ctx, { saturation: value }));
  device.registerCapabilityListener('hyperhdr_effect', value => onEffect(device, ctx, value));
}

async function onEffect(device, ctx, name) {
  const settings = device.getSettings();
  if (!name || name === '__none__') {
    await ctx.client.request({ command: 'clear', priority: settings.priority });
    ctx.state.lastEffect = null;
    const dim = device.getCapabilityValue('dim') ?? 1;
    if (dim > 0 && ctx.state.lastBaseRgb) {
      const factor = dim;
      await ctx.client.request({
        command: 'color',
        priority: settings.priority,
        origin: settings.origin || 'Homey',
        color: [
          Math.round(ctx.state.lastBaseRgb[0] * factor),
          Math.round(ctx.state.lastBaseRgb[1] * factor),
          Math.round(ctx.state.lastBaseRgb[2] * factor)
        ]
      });
    }
    return;
  }
  await ctx.client.request({
    command: 'effect',
    priority: settings.priority,
    origin: settings.origin || 'Homey',
    effect: { name }
  });
  ctx.state.lastEffect = name;
}

async function onColorComponent(device, ctx, override) {
  const hue = override.hue ?? device.getCapabilityValue('light_hue') ?? 0;
  const saturation = override.saturation ?? device.getCapabilityValue('light_saturation') ?? 1;
  const dim = override.dim ?? device.getCapabilityValue('dim') ?? 1;
  const settings = device.getSettings();

  const baseRgb = hsvToScaledRgb({ hue, saturation, dim: 1 });
  const finalRgb = hsvToScaledRgb({ hue, saturation, dim });
  ctx.state.lastBaseRgb = baseRgb;
  ctx.state.lastEffect = null;

  await ctx.client.request({
    command: 'color',
    priority: settings.priority,
    origin: settings.origin || 'Homey',
    color: finalRgb
  });
  if (device.getCapabilityValue('hyperhdr_effect') !== '__none__') {
    await device.setCapabilityValue('hyperhdr_effect', '__none__');
  }
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
  pickEffect,
  SUBSCRIPTIONS
};
