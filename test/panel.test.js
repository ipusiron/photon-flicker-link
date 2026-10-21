'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Panel = require('../optical-panel.js');
const C = require('../codec-core.js');

function blank(width = 640, height = 480, value = 0.42) {
  const data = new Uint8ClampedArray(width * height * 4), byte = C.linearToSrgb(value);
  for (let i = 0; i < data.length; i += 4) { data[i] = byte; data[i + 1] = byte; data[i + 2] = byte; data[i + 3] = 255; }
  return { width, height, data };
}

function context(image) {
  return { fillStyle: '', fillRect(x, y, w, h) {
    const channels = this.fillStyle.match(/\d+/g).map(Number);
    for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(image.height, Math.ceil(y + h)); yy++) {
      for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(image.width, Math.ceil(x + w)); xx++) {
        const i = (yy * image.width + xx) * 4;
        image.data.set([...channels, 255], i);
      }
    }
  } };
}

function transmitter(bit = 1, clock = 0) {
  const image = blank(640, 240);
  Panel.draw(context(image), 640, 240, { bit, clock }, { low: 0.18, high: 0.32 });
  return image;
}

// The camera observes a transformed raster, with an independent optical gain/background model.
function place(scene, source, options = {}) {
  const { x = 80, y = 140, scale = 0.75, angle = 0, gain = 1, offset = 0, gradient = 0, noise = 0, shear = 0 } = options;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  for (let yy = 0; yy < scene.height; yy++) for (let xx = 0; xx < scene.width; xx++) {
    const dx = (xx - x) / scale, dy = (yy - y) / scale;
    const v = -dx * sin + dy * cos, u = dx * cos + dy * sin - shear * v;
    if (u < 0 || v < 0 || u >= source.width || v >= source.height) continue;
    const src = (Math.floor(v) * source.width + Math.floor(u)) * 4, dest = (yy * scene.width + xx) * 4;
    for (let c = 0; c < 3; c++) {
      const value = C.srgbToLinear(source.data[src + c]);
      const perturbation = noise * Math.sin(xx * 19.13 + yy * 33.79 + c * 2.31);
      scene.data[dest + c] = C.linearToSrgb(value * gain + offset + gradient * u / 640 + perturbation);
    }
  }
  return scene;
}

test('Spatial display uses four fields and has invariant total brightness across data and clock states', () => {
  const totals = [];
  for (const bit of [0, 1]) for (const clock of [0, 1]) {
    const image = transmitter(bit, clock);
    totals.push(image.data.reduce((sum, value, i) => sum + (i % 4 === 3 ? 0 : value), 0));
    const observed = Panel.read(image);
    assert.equal(observed.found, true);
    assert.ok(observed.quality > 0.8);
    assert.equal(Math.sign(observed.data), bit ? 1 : -1);
    assert.equal(Math.sign(observed.clock), clock ? 1 : -1);
  }
  assert.equal(new Set(totals).size, 1);
});

test('Camera locates moved/scaled frames and reads concurrent data/clock with common gain and background', () => {
  for (const gain of [0.18, 0.45, 0.9]) for (const offset of [0, 0.12]) for (const bit of [0, 1]) {
    const observed = Panel.read(place(blank(), transmitter(bit, 1), { gain, offset, x: 113, y: 107, scale: 0.6, noise: 0.0003 }));
    assert.equal(observed.found, true, JSON.stringify({ gain, offset, bit, reason: observed.reason }));
    assert.ok(observed.quality > 0.8);
    assert.equal(Math.sign(observed.data), bit ? 1 : -1);
    assert.equal(Math.sign(observed.clock), 1);
    assert.ok(Math.abs(observed.rect.x - 113 / 640) < 0.01);
    assert.ok(Math.abs(observed.rect.w - 0.6) < 0.01);
  }
});

test('Mild rotation/skew and smooth illumination gradient preserve data and clock signs', () => {
  for (const angle of [-0.10, 0.10]) for (const shear of [-0.04, 0.04]) {
    const image = place(blank(), transmitter(0, 1), { x: 80, y: 125, scale: 0.7, angle, shear, gradient: 0.09, noise: 0.001 });
    const observed = Panel.read(image);
    assert.equal(observed.found, true, JSON.stringify({ angle, shear, reason: observed.reason }));
    assert.ok(observed.quality >= 0.8);
    assert.ok(observed.data < 0 && observed.clock > 0);
  }
});

test('Missing, flat, fully clipped, cut-off and excessive-tilt views do not invent a serial symbol', () => {
  const examples = [blank(), blank(640, 480, 0), blank(640, 480, 1),
    place(blank(), transmitter(), { x: -50 }), place(blank(), transmitter(), { angle: 0.5, x: 100, y: 60 })];
  for (const image of examples) {
    const value = Panel.read(image);
    assert.equal(value.found, false);
    assert.equal(value.quality, 0);
    assert.equal(value.clockQuality, 0);
    assert.equal(value.dataQuality, 0);
  }
  const good = place(blank(), transmitter());
  assert.equal(Panel.read(good, { x: 0.3, y: 0.2, w: 0.6, h: 0.5 }).found, false);
});

test('A second transmitter is ambiguous until search crop selects exactly one', () => {
  const scene = blank();
  place(scene, transmitter(1, 0), { x: 30, y: 40, scale: 0.4 });
  place(scene, transmitter(0, 1), { x: 340, y: 300, scale: 0.4 });
  const ambiguous = Panel.read(scene);
  assert.equal(ambiguous.found, false);
  assert.equal(ambiguous.reason, 'panelAmbiguous');
  const selected = Panel.read(scene, { x: 0, y: 0, w: 0.5, h: 0.4 });
  assert.equal(selected.found, true);
  assert.ok(selected.data > 0 && selected.clock < 0);
});

test('Idle display and a lost or contaminated field have no usable bit even when frame remains located', () => {
  const idle = blank(640, 240);
  Panel.idle(context(idle), 640, 240);
  const waiting = Panel.read(idle);
  assert.equal(waiting.found, true);
  assert.equal(waiting.quality, 0);
  assert.equal(waiting.clockQuality, 0);
  const damaged = transmitter(1, 1), ctx = context(damaged);
  ctx.fillStyle = `rgb(${C.linearToSrgb(0.32)}, ${C.linearToSrgb(0.32)}, ${C.linearToSrgb(0.32)})`;
  ctx.fillRect(180, 32, 132, 176);
  const equal = Panel.read(damaged);
  assert.equal(equal.found, true);
  assert.equal(equal.quality, 0);
  assert.equal(equal.dataQuality, 0);
  assert.ok(equal.clockQuality > 0.8, 'A flat data pair must not erase a readable independent clock');
});

test('Independent byte-valued capture preserves signs without assuming display intensity or gamma', () => {
  const image = blank(640, 480), ctx = context(image);
  const fill = (x, y, w, h, gray) => { ctx.fillStyle = `rgb(${gray},${gray},${gray})`; ctx.fillRect(x, y, w, h); };
  fill(80, 90, 480, 180, 210);
  fill(92, 102, 456, 156, 45);
  [[104, 180], [215, 120], [326, 120], [437, 180]].forEach(([x, value]) => fill(x, 114, 99, 132, value));
  const read = Panel.read(image);
  assert.equal(read.found, true);
  assert.ok(read.quality > 0.8 && read.data > 0 && read.clock < 0);
  // Obscuring a required guard must invalidate localization, even with a previous successful result.
  fill(310, 100, 24, 160, 180);
  assert.equal(Panel.read(image, {}, read).found, false);
});
