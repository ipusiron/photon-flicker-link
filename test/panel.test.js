'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Panel = require('../optical-panel.js');
const C = require('../codec-core.js');
const S = require('../spatial-codec.js');

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

function transmitter(bit = 1, clock = 0, settings = S.config()) {
  const image = blank(640, 320);
  Panel.draw(context(image), 640, 320, { bit, clock }, settings);
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

test('V3 near-black/near-white data preserves all four states and decodes with the receiver at low contrast', () => {
  const observations = new Map(), totals = [], high = S.config({ contrast: 'high' });
  for (const bit of [0, 1]) for (const clock of [0, 1]) {
    const source = transmitter(bit, clock, high);
    totals.push(source.data.reduce((sum, value, i) => sum + (i % 4 === 3 ? 0 : value), 0));
    const measured = Panel.read(place(blank(), source, { x: 113, y: 107, scale: 0.6, gain: 0.25, offset: 0.12, noise: 0.0003 }));
    assert.equal(measured.found, true);
    assert.equal(Math.sign(measured.data), bit ? 1 : -1);
    assert.equal(Math.sign(measured.clock), clock ? 1 : -1);
    assert.ok(measured.dataQuality >= S.CONFIDENCE && measured.clockQuality >= S.CONFIDENCE);
    assert.ok(Math.abs(measured.data) > 0.95 && Math.abs(measured.clock) > 0.95);
    observations.set(`${bit}/${clock}`, measured);
  }
  assert.equal(new Set(totals).size, 1);
  for (const rate of [2, 4, 8]) {
    const tx = S.transmission('A', S.config({ rate, contrast: 'high' }));
    const decoder = S.createDecoder(S.config({ contrast: 'low' })), events = [];
    for (let frame = 0; frame / 30 < tx.seconds + 0.8; frame++) {
      const time = frame / 30, symbol = tx.frames[Math.floor((time - 0.37) * rate)];
      events.push(...decoder.push(time, symbol ? observations.get(`${symbol.bit}/${symbol.clock}`) :
        { found: false, data: 0, clock: 0, dataQuality: 0, clockQuality: 0, quality: 0 }));
    }
    const result = events.find(event => event.type === 'result');
    assert.equal(result?.text, 'A', `${rate} symbol/s high sender / low receiver`);
    assert.equal(result.crcOk, true);
    assert.equal(result.utf8Ok, true);
  }
});

test('Broad white references preserve near-white signals after independent perspective and blur', () => {
  const fixture = require('./marker-camera.test.js'), observed = new Map();
  for (const bit of [0, 1]) for (const clock of [0, 1]) {
    const image = fixture.place(fixture.blank(232), bit, clock, { corners: fixture.quad(224, 0.10) });
    // Map the independent fixture's explicit byte palette before camera blur. No production draw is involved.
    const palette = new Map([[32, 33], [224, 237], [118, 33], [156, 237]]);
    for (let i = 0; i < image.data.length; i += 4) {
      const value = palette.get(image.data[i]);
      if (value !== undefined) image.data.set([value, value, value, 255], i);
    }
    const measurement = Panel.read(fixture.blur(image, 3));
    assert.equal(measurement.found, true, `bit ${bit}, clock ${clock}`);
    assert.equal(Math.sign(measurement.data), bit ? 1 : -1);
    assert.equal(Math.sign(measurement.clock), clock ? 1 : -1);
    assert.ok(measurement.dataQuality >= S.CONFIDENCE && measurement.clockQuality >= S.CONFIDENCE);
    observed.set(`${bit}/${clock}`, measurement);
  }
  for (const rate of [2, 4, 8]) {
    const tx = S.transmission('A', S.config({ rate, contrast: 'high' }));
    const decoder = S.createDecoder(), events = [];
    for (let n = 0; n / 30 < tx.seconds + 0.8; n++) {
      const time = n / 30, frame = tx.frames[Math.floor((time - 0.37) * rate)];
      events.push(...decoder.push(time, frame ? observed.get(`${frame.bit}/${frame.clock}`) : { found: false }));
    }
    const result = events.find(e => e.type === 'result');
    assert.equal(result?.text, 'A', `${rate} symbol/s after blur`);
    assert.equal(result.crcOk, true);
  }
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

test('Missing, flat, fully clipped and cut-off views do not invent a serial symbol', () => {
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
  const idle = blank(640, 320);
  Panel.idle(context(idle), 640, 320);
  const waiting = Panel.read(idle);
  assert.equal(waiting.found, true);
  assert.equal(waiting.quality, 0);
  assert.equal(waiting.clockQuality, 0);
  const damaged = transmitter(1, 1), ctx = context(damaged);
  ctx.fillStyle = `rgb(${C.linearToSrgb(0.32)}, ${C.linearToSrgb(0.32)}, ${C.linearToSrgb(0.32)})`;
  ctx.fillRect(192, 120, 112, 80);
  const equal = Panel.read(damaged);
  assert.equal(equal.found, true);
  assert.equal(equal.quality, 0);
  assert.equal(equal.dataQuality, 0);
  assert.ok(equal.clockQuality > 0.8, 'A flat data pair must not erase a readable independent clock');
});

test('Legacy frames cannot impersonate new markers, and a prior detection cannot hide a missing corner', () => {
  const image = blank(640, 480), ctx = context(image);
  const fill = (x, y, w, h, gray) => { ctx.fillStyle = `rgb(${gray},${gray},${gray})`; ctx.fillRect(x, y, w, h); };
  fill(80, 90, 480, 180, 210);
  fill(92, 102, 456, 156, 45);
  [[104, 180], [215, 120], [326, 120], [437, 180]].forEach(([x, value]) => fill(x, 114, 99, 132, value));
  assert.equal(Panel.read(image).found, false);
  const current = transmitter(1, 0), read = Panel.read(current);
  assert.equal(read.found, true);
  assert.equal(read.outerGeometry.length, 4);
  assert.equal(read.sampleGeometry.length, 4);
  const brush = context(current);
  brush.fillStyle = 'rgb(240,240,240)';
  brush.fillRect(8, 8, 96, 96);
  assert.equal(Panel.read(current, {}, read).found, false);
});
