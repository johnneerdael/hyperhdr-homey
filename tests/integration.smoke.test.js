'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const HyperHdrClient = require('../lib/HyperHdrClient');

const host = process.env.HYPERHDR_HOST;
const port = Number(process.env.HYPERHDR_PORT || 8090);
const token = process.env.HYPERHDR_TOKEN || null;

test('integration smoke: red, effect, clear', { skip: !host }, async () => {
  const client = new HyperHdrClient({ host, port, token });
  await client.start();
  if (await client.tokenRequired()) await client.authorize();

  await client.request({ command: 'color', priority: 128, origin: 'HomeySmoke', color: [255, 0, 0] });
  await new Promise(r => setTimeout(r, 1500));

  const info = await client.request({ command: 'serverinfo' });
  const effects = info.info.effects || [];
  if (effects.length) {
    await client.request({ command: 'effect', priority: 128, origin: 'HomeySmoke', effect: { name: effects[0].name } });
    await new Promise(r => setTimeout(r, 1500));
  }

  await client.request({ command: 'clear', priority: 128 });
  await client.stop();
  assert.ok(true);
});
