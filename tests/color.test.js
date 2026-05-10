'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hsvToRgb, scaleRgb, hsvToScaledRgb } = require('../lib/color');

test('hsvToRgb red, green, blue, white', () => {
  assert.deepEqual(hsvToRgb(0,   1, 1), [255, 0, 0]);
  assert.deepEqual(hsvToRgb(120, 1, 1), [0, 255, 0]);
  assert.deepEqual(hsvToRgb(240, 1, 1), [0, 0, 255]);
  assert.deepEqual(hsvToRgb(0,   0, 1), [255, 255, 255]);
});

test('scaleRgb scales each channel', () => {
  assert.deepEqual(scaleRgb([200, 100, 0], 0.5), [100, 50, 0]);
  assert.deepEqual(scaleRgb([255, 255, 255], 0), [0, 0, 0]);
  assert.deepEqual(scaleRgb([255, 255, 255], 1), [255, 255, 255]);
});

test('hsvToScaledRgb takes Homey 0..1 hue/sat with dim', () => {
  assert.deepEqual(hsvToScaledRgb({ hue: 0, saturation: 1, dim: 1 }), [255, 0, 0]);
  assert.deepEqual(hsvToScaledRgb({ hue: 0, saturation: 1, dim: 0.5 }), [128, 0, 0]);
  assert.deepEqual(hsvToScaledRgb({ hue: 0, saturation: 0, dim: 0.2 }), [51, 51, 51]);
});
