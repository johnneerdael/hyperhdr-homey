'use strict';

const HyperHdrClient = require('../../lib/HyperHdrClient');
const { hsvToScaledRgb } = require('../../lib/color');

const SUBSCRIPTIONS = ['components-update', 'priorities-update', 'instance-update', 'settings-update'];

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
    shuttingDown: false,
    async shutdown() {
      this.shuttingDown = true;
      await client.stop();
    }
  };

  let firstConnectHandled = false;

  client.on('error', err => device.error(`HyperHDR client error: ${err.message}`));
  client.on('closed', async () => {
    if (ctx.shuttingDown) return; // intentional shutdown — don't touch the device
    device.log('HyperHDR connection closed, reconnect will be attempted');
    try {
      await device.setUnavailable(unavailableMessage);
    } catch (err) {
      // Device may already be deleted — silently ignore
    }
  });
  client.on('connected', async () => {
    if (!firstConnectHandled) return; // initial bootstrap runs inline below
    device.log('HyperHDR reconnected, re-bootstrapping');
    try {
      await bootstrap(client, device, state);
      await device.setAvailable();
    } catch (err) {
      device.error(`reconnect bootstrap failed: ${err.message}`);
      try { await device.setUnavailable(err.message); } catch (_) {}
    }
  });
  client.on('update', msg => onPushUpdate(msg, device, ctx));

  try {
    await client.start();
    await bootstrap(client, device, state);
    firstConnectHandled = true;
    await device.setAvailable();
    device.log(`HyperHDR initialised: ${settings.host}:${settings.port || 8090} instance ${state.instance}`);
  } catch (err) {
    firstConnectHandled = true;
    device.error(`HyperHDR init failed for ${settings.host}:${settings.port || 8090}: ${err.message}`);
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
  await primeCapabilities(device, state);
}

async function primeCapabilities(device, state) {
  const components = state.snapshot.components || [];
  const ledDevice = components.find(c => c.name === 'LEDDEVICE');
  const onoff = ledDevice ? Boolean(ledDevice.enabled) : true;

  const activeEffect = pickEffect(state.snapshot.priorities);
  state.activeEffect = activeEffect;

  // Seed capability state so Homey marks the device as ready.
  // Use ?? checks so we don't overwrite values the user already set
  // (matters across reconnects).
  if (device.getCapabilityValue('onoff') === null || device.getCapabilityValue('onoff') === undefined) {
    await device.setCapabilityValue('onoff', onoff);
  }
  if (device.getCapabilityValue('dim') == null) {
    await device.setCapabilityValue('dim', 1);
  }
  if (device.getCapabilityValue('light_hue') == null) {
    await device.setCapabilityValue('light_hue', 0);
  }
  if (device.getCapabilityValue('light_saturation') == null) {
    await device.setCapabilityValue('light_saturation', 0);
  }
  if (device.getCapabilityValue('light_mode') == null) {
    await device.setCapabilityValue('light_mode', 'color');
  }
  await device.setCapabilityValue('hyperhdr_effect', activeEffect || '__none__');
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
    case 'settings-update':
      // Settings changed (could include the effects directory). Re-fetch
      // serverinfo and refresh the effect picker.
      refreshSnapshot(device, ctx).catch(err => device.error(`refreshSnapshot: ${err.message}`));
      break;
    case 'instance-update':
      // No-op: Homey devices are pinned to a specific instance
      break;
  }
}

async function refreshSnapshot(device, ctx) {
  const reply = await ctx.client.request({ command: 'serverinfo' });
  ctx.state.snapshot = reply.info || {};
  await refreshEffectOptions(device, ctx.state.snapshot.effects || []);
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
  device.registerCapabilityListener('onoff', async (value) => {
    device.log(`cap onoff → ${value}`);
    try { await onOnOff(device, ctx, value); }
    catch (err) { device.error(`onoff failed: ${err.message}`); throw err; }
  });
  device.registerCapabilityListener('dim', async (value) => {
    device.log(`cap dim → ${value}`);
    try { await onColorComponent(device, ctx, { dim: value }); }
    catch (err) { device.error(`dim failed: ${err.message}`); throw err; }
  });
  device.registerCapabilityListener('light_hue', async (value) => {
    device.log(`cap light_hue → ${value}`);
    try { await onColorComponent(device, ctx, { hue: value }); }
    catch (err) { device.error(`light_hue failed: ${err.message}`); throw err; }
  });
  device.registerCapabilityListener('light_saturation', async (value) => {
    device.log(`cap light_saturation → ${value}`);
    try { await onColorComponent(device, ctx, { saturation: value }); }
    catch (err) { device.error(`light_saturation failed: ${err.message}`); throw err; }
  });
  device.registerCapabilityListener('hyperhdr_effect', async (value) => {
    device.log(`cap hyperhdr_effect → ${value}`);
    try { await onEffect(device, ctx, value); }
    catch (err) { device.error(`hyperhdr_effect failed: ${err.message}`); throw err; }
  });
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

async function onColorComponent(device, ctx, override = {}) {
  // Accept both shorthand keys ({hue, saturation, dim}) and Homey capability
  // names ({light_hue, light_saturation, dim}) so the same helper works for
  // single-cap listeners and registerMultipleCapabilityListener.
  const hue = override.hue ?? override.light_hue ?? device.getCapabilityValue('light_hue') ?? 0;
  const saturation = override.saturation ?? override.light_saturation ?? device.getCapabilityValue('light_saturation') ?? 1;
  const dim = override.dim ?? device.getCapabilityValue('dim') ?? 1;
  const settings = device.getSettings();
  device.log(`onColorComponent: hue=${hue} sat=${saturation} dim=${dim} priority=${settings.priority}`);

  const baseRgb = hsvToScaledRgb({ hue, saturation, dim: 1 });
  const finalRgb = hsvToScaledRgb({ hue, saturation, dim });
  ctx.state.lastBaseRgb = baseRgb;
  ctx.state.lastEffect = null;

  const payload = {
    command: 'color',
    priority: settings.priority,
    origin: settings.origin || 'Homey',
    color: finalRgb
  };
  device.log(`→ color request: ${JSON.stringify(payload)}`);
  const reply = await ctx.client.request(payload);
  device.log(`← color reply: ${JSON.stringify(reply)}`);

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
