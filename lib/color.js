'use strict';

function hsvToRgb(hueDeg, saturation, value) {
  const h = ((hueDeg % 360) + 360) % 360;
  const s = saturation;
  const v = value;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0, gp = 0, bp = 0;
  if (h < 60)       [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else              [rp, gp, bp] = [c, 0, x];
  return [
    Math.round((rp + m) * 255),
    Math.round((gp + m) * 255),
    Math.round((bp + m) * 255)
  ];
}

function scaleRgb([r, g, b], factor) {
  const f = Math.max(0, Math.min(1, factor));
  return [Math.round(r * f), Math.round(g * f), Math.round(b * f)];
}

function hsvToScaledRgb({ hue, saturation, dim }) {
  const rgb = hsvToRgb(hue * 360, saturation, 1);
  return scaleRgb(rgb, dim);
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`bad hex: ${hex}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function rgbToHsv([r, g, b]) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { hue: h / 360, saturation: s, value: v };
}

module.exports = { hsvToRgb, scaleRgb, hsvToScaledRgb, hexToRgb, rgbToHsv };
