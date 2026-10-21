'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Panel = require('../optical-panel.js');
const Spatial = require('../spatial-codec.js');

// Independent specification fixture: neither Panel.draw nor its geometry/math is used.
const WIDTH = 640, HEIGHT = 320;
const BLACK = 32, WHITE = 224, LOW = 118, HIGH = 156;
const LEVELS = Float64Array.from({ length: 256 }, (_, i) => {
  const v = i / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});
const encode = value => Math.round(255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055));
const inside = (x, y, left, top, w, h) => x >= left && y >= top && x < left + w && y < top + h;

function source(x, y, bit, clock, damage = '') {
  if (damage === 'old') {
    if (!inside(x, y, 16, 16, 608, 208)) return WHITE;
    for (const [i, left] of [32, 180, 328, 476].entries()) {
      if (inside(x, y, left, 32, 132, 176)) return [bit, 1 - bit, clock, 1 - clock][i] ? HIGH : LOW;
    }
    return BLACK;
  }
  let value = WHITE;
  // Four identical inward-opening L shapes, with 80 px arms and 24 px strokes.
  for (const [left, top, right, bottom] of [[16, 16, false, false], [544, 16, true, false],
    [544, 224, true, true], [16, 224, false, true]]) {
    if (inside(x, y, left, top + (bottom ? 56 : 0), 80, 24) ||
        inside(x, y, left + (right ? 56 : 0), top, 24, 80)) value = BLACK;
  }
  // Fixed orientation strokes. These never depend on data, clock, or a message ID.
  if (inside(x, y, 128, 24, 96, 24) || inside(x, y, 272, 24, 24, 48)) value = BLACK;
  if (inside(x, y, 16, 112, 608, 96)) value = BLACK;
  for (const [i, left] of [48, 192, 336, 480].entries()) {
    if (inside(x, y, left, 120, 112, 80)) value = [bit, 1 - bit, clock, 1 - clock][i] ? HIGH : LOW;
  }
  const coveredCorner = /^corner([0-3])$/.exec(damage);
  if (coveredCorner) {
    const [left, top] = [[0, 0], [536, 0], [536, 216], [0, 216]][Number(coveredCorner[1])];
    if (inside(x, y, left, top, 104, 104)) value = WHITE;
  }
  if (damage === 'orientation0' && inside(x, y, 112, 8, 128, 56)) value = WHITE;
  if (damage === 'orientation1' && inside(x, y, 256, 8, 56, 80)) value = WHITE;
  return value;
}

// Closed-form unit-square-to-quad homography, followed by its adjugate inverse.
// This is deliberately independent of the production detector's point fitting.
function inverseMap(q) {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0], dx3 = p0[0] - p1[0] + p2[0] - p3[0];
  const dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1], dy3 = p0[1] - p1[1] + p2[1] - p3[1];
  const denominator = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / denominator;
  const h = (dx1 * dy3 - dx3 * dy1) / denominator;
  const a = p1[0] - p0[0] + g * p1[0], b = p3[0] - p0[0] + h * p3[0], c = p0[0];
  const d = p1[1] - p0[1] + g * p1[1], e = p3[1] - p0[1] + h * p3[1], f = p0[1];
  return [e - f * h, c * h - b, b * f - c * e, f * g - d, a - c * g, c * d - a * f,
    d * h - e * g, b * g - a * h, a * e - b * d];
}

function quad(width = 384, perspective = 0, rotation = 0, mirror = false, cx = 320, cy = 240) {
  const height = width / 2;
  const points = [[-width / 2, -height / 2], [width / 2, -height * (1 - perspective) / 2],
    [width / 2, height * (1 - perspective) / 2], [-width / 2, height / 2]];
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  return points.map(([x, y]) => {
    if (mirror) x = -x;
    return [cx + x * cos - y * sin, cy + x * sin + y * cos];
  });
}

function blank(background = 220) {
  const data = new Uint8ClampedArray(640 * 480 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([background, background, background, 255], i);
  return { width: 640, height: 480, data };
}

function clutter(image, extraL = false) {
  const fill = (left, top, width, height, gray) => {
    for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) {
      image.data.set([gray, gray, gray, 255], (y * image.width + x) * 4);
    }
  };
  // Three dark cards and simple label-like strokes, unrelated to the transmitter.
  for (const [x, y, width, height] of [[12, 16, 140, 100], [476, 356, 148, 108], [12, 360, 144, 104]]) {
    fill(x, y, width, height, 46);
    fill(x + 12, y + 12, width - 24, 16, 196);
    fill(x + 12, y + 44, 12, 40, 196);
    fill(x + 12, y + 72, 44, 12, 196);
    fill(x + 72, y + 44, 12, 40, 196);
    fill(x + 72, y + 44, 40, 12, 196);
    fill(x + 72, y + 60, 28, 8, 196);
  }
  if (extraL) {
    fill(530, 20, 56, 16, BLACK);
    fill(530, 20, 16, 56, BLACK);
  }
  return image;
}

function place(image, bit, clock, options = {}) {
  const { corners = quad(), gain = 1, damage = '', noise = 0 } = options;
  const m = inverseMap(corners), sourceHeight = damage === 'old' ? 240 : HEIGHT;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const px = x + 0.5, py = y + 0.5, z = m[6] * px + m[7] * py + m[8];
    const u = (m[0] * px + m[1] * py + m[2]) / z;
    const v = (m[3] * px + m[4] * py + m[5]) / z;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
    const raw = source(u * WIDTH, v * sourceHeight, bit, clock, damage);
    const value = encode(Math.max(0, Math.min(1, LEVELS[raw] * gain + noise * Math.sin(x * 19.13 + y * 33.79))));
    image.data.set([value, value, value, 255], (y * image.width + x) * 4);
  }
  return image;
}

function blur(image, passes = 3) {
  for (let pass = 0; pass < passes; pass++) {
    const output = new Uint8ClampedArray(image.data.length);
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = Math.min(image.height - 1, Math.max(0, y + dy));
        const xx = Math.min(image.width - 1, Math.max(0, x + dx));
        sum += image.data[(yy * image.width + xx) * 4];
      }
      const v = Math.round(sum / 9);
      output.set([v, v, v, 255], (y * image.width + x) * 4);
    }
    image.data = output;
  }
  return image;
}

function observation(bit, clock, options = {}) {
  const scene = blank(options.background);
  const image = place(options.clutter ? clutter(scene, options.extraL) : scene, bit, clock, options);
  const measured = Panel.read(options.blur ? blur(image, options.blur) : image);
  if (measured.found) {
    const expected = options.corners || quad();
    const tolerance = Math.max(3, Math.hypot(expected[1][0] - expected[0][0], expected[1][1] - expected[0][1]) * 0.01);
    assert.equal(measured.outerGeometry?.length, 4, 'four canonical outer corners');
    for (let i = 0; i < 4; i++) {
      // The renderer tests pixel centers at (x+.5,y+.5); detector coordinates name pixel centers by integers.
      const error = Math.hypot(measured.outerGeometry[i].x - (expected[i][0] - 0.5),
        measured.outerGeometry[i].y - (expected[i][1] - 0.5));
      assert.ok(error <= tolerance, `corner ${i}: ${error.toFixed(3)} px error exceeds ${tolerance.toFixed(3)} px`);
    }
  }
  return measured;
}

function assertState(measured, bit, clock, label) {
  assert.equal(measured.found, true, `${label}: ${measured.reason}`);
  assert.equal(Math.sign(measured.data), bit ? 1 : -1, `${label}: data order`);
  assert.equal(Math.sign(measured.clock), clock ? 1 : -1, `${label}: clock order`);
  assert.ok(measured.dataQuality >= Spatial.CONFIDENCE, `${label}: data quality ${measured.dataQuality}`);
  assert.ok(measured.clockQuality >= Spatial.CONFIDENCE, `${label}: clock quality ${measured.clockQuality}`);
  assert.equal(measured.outerGeometry?.length, 4, `${label}: four projected outer corners`);
}

if (require.main === module) {
  test('Independent marker raster retains all four bit/clock states under real projective distortion', () => {
    for (const perspective of [0.10, 0.15, 0.20]) for (const bit of [0, 1]) for (const clock of [0, 1]) {
      assertState(observation(bit, clock, { corners: quad(384, perspective) }), bit, clock, `perspective ${perspective}`);
    }
  });

  test('Local marker contrast handles a dim panel against a bright scene and a small blurred panel', () => {
    for (const bit of [0, 1]) for (const clock of [0, 1]) {
      assertState(observation(bit, clock, { gain: 0.25, background: 232 }), bit, clock, '25% gain');
      assertState(observation(bit, clock, { corners: quad(224), blur: 3 }), bit, clock, '224 px / radius 1 / three passes');
    }
  });

  test('Static orientation strokes resolve rotation and reflection without reversing data or clock', () => {
    for (const rotation of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) for (const mirror of [false, true]) {
      for (const bit of [0, 1]) for (const clock of [0, 1]) {
        assertState(observation(bit, clock, { corners: quad(320, 0.10, rotation, mirror) }), bit, clock,
          `rotation ${rotation}, mirror ${mirror}`);
      }
    }
  });

  test('Unrelated dark cards and label strokes do not replace the uniquely identified sender', () => {
    for (const gain of [1, 0.25]) for (const bit of [0, 1]) for (const clock of [0, 1]) {
      assertState(observation(bit, clock, { clutter: true, gain, corners: quad(384, 0.15) }),
        bit, clock, `three cards, gain ${gain}`);
    }
  });

  test('Three cards plus one unrelated L do not exhaust the candidate budget with false marker shapes', () => {
    for (const bit of [0, 1]) for (const clock of [0, 1]) {
      assertState(observation(bit, clock, { clutter: true, extraL: true, corners: quad(384, 0.10) }),
        bit, clock, 'three cards plus one L');
    }
  });

  test('Independent camera measurements decode A at 2, 4 and 8 symbol/s without changing wire expectations', () => {
    const scenarios = [{ corners: quad(384, 0.20), gain: 0.25 }, { corners: quad(224), blur: 3 },
      { corners: quad(320, 0.10, Math.PI, true) }];
    for (const options of scenarios) {
      const observed = new Map();
      for (const bit of [0, 1]) for (const clock of [0, 1]) {
        const measured = observation(bit, clock, options);
        assertState(measured, bit, clock, 'message fixture');
        observed.set(`${bit}/${clock}`, measured);
      }
      for (const rate of [2, 4, 8]) {
        const tx = Spatial.transmission('A', Spatial.config({ rate })), decoder = Spatial.createDecoder(), events = [];
        for (let frame = 0; frame / 30 < tx.seconds + 0.8; frame++) {
          const time = frame / 30, symbol = tx.frames[Math.floor((time - 0.37) * rate)];
          events.push(...decoder.push(time, symbol ? observed.get(`${symbol.bit}/${symbol.clock}`) :
            { found: false, quality: 0, dataQuality: 0, clockQuality: 0, data: 0, clock: 0 }));
        }
        const result = events.find(event => event.type === 'result');
        assert.equal(result?.text, 'A', `${rate} symbol/s: ${JSON.stringify(events.filter(e => e.type === 'resync'))}`);
        assert.equal(result.crcOk, true);
        assert.equal(result.utf8Ok, true);
      }
    }
  });

  test('Partial corners, missing orientation, old panels and competing panels never become a valid sender', () => {
    const cases = ['corner0', 'corner1', 'corner2', 'corner3', 'orientation0', 'orientation1', 'old']
      .map(damage => place(blank(), 1, 0, { damage }));
    cases.push(place(blank(), 1, 0, { corners: quad(384, 0, 0, false, 140, 240) }));
    const two = place(blank(), 1, 0, { corners: quad(256, 0, 0, false, 160, 140) });
    place(two, 0, 1, { corners: quad(256, 0, 0, false, 480, 340) });
    cases.push(two, blank());
    const noise = blank();
    let state = 0x12345678;
    for (let i = 0; i < noise.data.length; i += 4) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const value = state >>> 24;
      noise.data.set([value, value, value, 255], i);
    }
    cases.push(noise);
    for (const [i, image] of cases.entries()) {
      const measured = Panel.read(image);
      assert.equal(measured.found, false, `rejection case ${i}`);
      assert.equal(measured.dataQuality, 0, `rejection case ${i}: data`);
      assert.equal(measured.clockQuality, 0, `rejection case ${i}: clock`);
    }
  });
}

module.exports = { blank, clutter, place, quad, blur, observation };
