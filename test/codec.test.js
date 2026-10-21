'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../codec-core.js');

function synthetic(text, options = {}, noise = {}) {
  const settings = C.config(options);
  const tx = C.transmission(text, settings);
  const fps = noise.fps || 30, period = settings.period * (noise.clock || 1);
  const offset = noise.offset === undefined ? 0.37 : noise.offset;
  const matrix = noise.matrix || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const samples = [];
  let previous = [settings.low, settings.low, settings.low];
  for (let n = 0; n / fps < offset + tx.frames.length * period + 0.3; n++) {
    const time = n / fps;
    const index = Math.floor((time - offset) / period);
    const frame = tx.frames[index];
    let rgb = frame ? frame.rgb.slice() : Array(3).fill(settings.low);
    if (noise.corrupt === index) rgb = rgb.map(v => settings.low + settings.high - v);
    if (noise.ambiguous === index) rgb = Array(3).fill((settings.low + settings.high) / 2);
    rgb = C.multiply(matrix, rgb).map((v, c) => {
      const target = (noise.gain || 1) * v + (noise.background || 0) +
        (noise.jitter || 0) * Math.sin(n * 5.17 + c * 3.13) + (noise.drift || 0) * time;
      return target * (1 - (noise.smoothing || 0)) + previous[c] * (noise.smoothing || 0);
    });
    previous = rgb;
    if (noise.drop && n % noise.drop === 0) continue;
    samples.push({ time, rgb });
  }
  const decoder = C.createDecoder(settings);
  const events = samples.flatMap(s => decoder.push(s.time, s.rgb));
  events.push(...decoder.finish());
  return { samples, events, result: events.find(e => e.type === 'result'), tx };
}

test('A: CRC-8/SMBUS known answer, not only a round trip', () => {
  assert.equal(C.crc8(Array.from(Buffer.from('123456789'))), 0xf4);
  assert.equal(C.crc8([]), 0);
  assert.throws(() => C.crc8([256]));
});
for (const mode of ['mono', 'color']) {
  for (const levels of [2, 4]) {
    test(`A: all 256 byte values round trip through ${mode} ${levels} levels`, () => {
      const cfg = C.config({ mode, levels });
      const bytes = Array.from({ length: 256 }, (_, i) => i);
      assert.deepEqual(C.symbolsToBytes(C.bytesToSymbols(bytes, cfg), cfg).slice(0, 256), bytes);
    });
    for (const text of ['', 'LIGHT', '日本', '🔦', '12345678']) {
      test(`A/B: end-to-end ${mode}/${levels} ${JSON.stringify(text)}`, () => {
        const { result, events, tx } = synthetic(text, { mode, levels });
        assert.equal(result?.text, text, JSON.stringify(events.filter(e => e.type !== 'symbol')));
        assert.equal(result.valid, true);
        assert.equal(tx.body[0], Buffer.byteLength(text));
        assert.equal(tx.seconds, C.duration(tx.body[0], tx.settings));
      });
    }
  }
}
test('A: input type, surrogate pairs and UTF-8 byte limit', () => {
  assert.deepEqual(C.bytesOf('A'), [65]);
  for (const text of ['\ud800', '\udc00', '123456789', '日本語']) assert.throws(() => C.bytesOf(text));
  assert.throws(() => C.bytesOf(123));
  assert.equal(C.partialText([0xe6, 0x97]), '');
  assert.equal(C.partialText([0xe6, 0x97, 0xa5]), '日');
  assert.equal(C.partialText([null, 65], true), '?A');
});
test('A: known MSB-first symbol mapping', () => {
  assert.deepEqual(C.bytesToSymbols([0xa5]).map(s => s[0]), [1, 0, 1, 0, 0, 1, 0, 1]);
  assert.deepEqual(C.bytesToSymbols([0xa5], C.config({ levels: 4 })).map(s => s[0]), [2, 2, 1, 1]);
  assert.deepEqual(C.bytesToSymbols([0xa5], C.config({ mode: 'color' })), [[1, 0, 1], [0, 0, 1], [0, 1, 0]]);
});
for (const clock of [0.97, 1.025]) {
  test(`B: clock estimate at ratio ${clock}, 24 fps and asynchronous start`, () => {
    const { result } = synthetic('CLOCK', { rate: 4 }, { clock, fps: 24, offset: 0.531, drop: 29 });
    assert.equal(result?.valid, true);
    assert.equal(result.text, 'CLOCK');
    assert.ok(Math.abs(result.period - 0.25 * clock) < 0.003);
    assert.ok(Math.abs(result.framesPerSymbol - 24 * 0.25 * clock) < 0.08);
  });
}
test('B: flat field and isolated edges never become a preamble', () => {
  assert.equal(C.findPreamble(Array.from({ length: 400 }, (_, n) => ({ time: n / 30, rgb: [0.2, 0.2, 0.2] }))), null);
  const dec = C.createDecoder();
  assert.deepEqual(dec.finish(), [{ type: 'error', code: 'noPreamble' }]);
});
test('C: background, amplitude normalization and AE-like smoothing without manual camera controls', () => {
  const { result } = synthetic('NORMAL', {}, { gain: 0.6, background: 0.12, smoothing: 0.4, jitter: 0.003, drift: 0.0001 });
  assert.equal(result?.valid, true);
  assert.equal(result.text, 'NORMAL');
});
test('C: a shifted symbol fails CRC, ambiguous symbols are erased', () => {
  const base = C.PREAMBLE.length + 8 + 2;
  const bad = synthetic('A', {}, { corrupt: base }).result;
  assert.equal(bad?.crcOk, false);
  const unsure = synthetic('A', {}, { ambiguous: base }).result;
  assert.equal(unsure?.valid, false);
  assert.ok(unsure.uncertain.length > 0);
  assert.equal(unsure.text, '?');
  assert.equal(C.classify(0.5).value, null);
  assert.equal(C.classify(1 / 6, 4).value, null);
});
test('C: truncated and invalid-length frames fail explicitly', () => {
  const { samples } = synthetic('ABC');
  const decoder = C.createDecoder();
  samples.slice(0, 450).forEach(s => decoder.push(s.time, s.rgb));
  assert.equal(decoder.finish()[0].code, 'incompleteFrame');
  const bad = synthetic('A', {}, { ambiguous: C.PREAMBLE.length }).events;
  assert.ok(bad.some(e => e.code === 'invalidLength'));
});
test('C: sRGB endpoints and linear-light averaging', () => {
  assert.equal(C.srgbToLinear(0), 0);
  assert.equal(C.srgbToLinear(255), 1);
  assert.ok(Math.abs(C.srgbToLinear(128) - 0.2158605001) < 1e-9);
  assert.deepEqual(C.averageRGBA([0, 0, 0, 255, 255, 255, 255, 255]), [0.5, 0.5, 0.5]);
  assert.equal(C.linearToSrgb(0.5), 188);
});
test('D: 3x3 inverse restores a known mixed vector; singular matrices fail', () => {
  const matrix = [[0.8, 0.12, 0.08], [0.09, 0.75, 0.16], [0.05, 0.2, 0.75]];
  const actual = C.multiply(C.invert3(matrix), C.multiply(matrix, [0.2, 0.6, 0.8]));
  actual.forEach((v, i) => assert.ok(Math.abs(v - [0.2, 0.6, 0.8][i]) < 1e-12));
  assert.throws(() => C.invert3([[1, 1, 1], [1, 1, 1], [1, 1, 1]]));
  const { result, events } = synthetic('COLOR', { mode: 'color', rate: 4 }, { matrix, background: 0.05, jitter: 0.001 });
  assert.equal(result?.valid, true);
  assert.equal(result.text, 'COLOR');
  assert.ok(events.find(e => e.type === 'sync').calibration);
});
test('D: missing calibration is not silently treated as independent RGB', () => {
  const { samples } = synthetic('A', { mode: 'mono' });
  const decoder = C.createDecoder(C.config({ mode: 'color' }));
  const events = samples.flatMap(s => decoder.push(s.time, s.rgb));
  assert.ok(events.some(e => e.type === 'error' && /Calibration/.test(e.code)));
});
test('E: positional character agreement requires known offline text', () => {
  assert.equal(C.matchRate('ABC', 'ADC', 'offline'), 100 * 2 / 3);
  assert.equal(C.matchRate('日A', '日B', 'offline'), 50);
  assert.equal(C.matchRate('A', 'AA', 'offline'), 50);
  assert.equal(C.matchRate('ABC', 'ABC', 'receive'), null);
  assert.equal(C.matchRate('', '', 'offline'), null);
});
test('Configuration and duration bounds', () => {
  assert.equal(C.duration(8), 51);
  assert.equal(C.duration(8, C.config({ mode: 'color' })), 28.5);
  for (const options of [{ mode: 'x' }, { rate: 60 }, { levels: 3 }, { contrast: 'x' }]) assert.throws(() => C.config(options));
});

module.exports = { synthetic };

test('Published synthetic comparison reproduces all 216 fixed conditions', () => {
  const report = require('../docs/measurements.json');
  assert.equal(report.rows.length, 4);
  for (const expected of report.rows) {
    const { mode, levels } = expected;
    let valid = 0, wrongValid = 0, total = 0;
    for (const fps of report.fps) for (const rate of report.rate) {
      for (const clock of report.clock) for (const offset of report.offset) {
        const noise = { fps, clock, offset, gain: report.gain, background: report.background,
          jitter: report.jitterAmplitude, smoothing: report.smoothing, drop: report.dropEvery };
        if (mode === 'color') noise.matrix = [[0.8, 0.12, 0.08], [0.09, 0.75, 0.16], [0.05, 0.2, 0.75]];
        const { result } = synthetic(report.text, { mode, levels, rate }, noise);
        total++;
        if (result?.valid && result.text === report.text) valid++;
        if (result?.valid && result.text !== report.text) wrongValid++;
      }
    }
    assert.equal(total, 54);
    assert.deepEqual({ mode, levels, valid, total, wrongValid }, expected);
  }
});
