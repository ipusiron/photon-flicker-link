'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../reliable-codec.js');

function simulate(text, options = {}, disturbance = {}) {
  const cfg = R.config(options), tx = R.transmission(text, cfg), fps = disturbance.fps || 30;
  const boundaries = [disturbance.offset ?? 0.37];
  tx.frames.forEach((f, i) => boundaries.push(boundaries.at(-1) + cfg.period * (disturbance.period?.(i) ?? 1)));
  const decoder = R.createDecoder(cfg), events = [], samples = [];
  let index = -1;
  for (let n = 0; n / fps < boundaries.at(-1) + 0.4; n++) {
    const time = n / fps;
    while (index + 1 < tx.frames.length && time >= boundaries[index + 1]) index++;
    if (disturbance.drop?.(time, index, n)) continue;
    let rgb = time < boundaries.at(-1) && tx.frames[index] ? tx.frames[index].rgb : [cfg.low, cfg.low, cfg.low];
    if (disturbance.flip?.(index)) rgb = tx.frames[index ^ 1]?.rgb || rgb;
    const gain = disturbance.gain?.(time) ?? 1;
    if (disturbance.matrix) rgb = R.multiply(disturbance.matrix, rgb);
    rgb = rgb.map((v, c) => R.srgbToLinear(R.linearToSrgb(v * gain + (disturbance.noise || 0) * Math.sin(n * 5.17 + c))));
    samples.push({ time, rgb }); events.push(...decoder.push(time, rgb));
  }
  events.push(...decoder.finish());
  return { tx, events, samples, result: events.find(e => e.type === 'result') };
}

test('V2 header independently known extended-Hamming codewords, every single error and up to 3 erasures', () => {
  assert.deepEqual(R.headerEncode(0), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(R.headerEncode(1), [1, 1, 0, 1, 0, 0, 1, 0]);
  assert.deepEqual(R.headerEncode(15), [1, 1, 1, 1, 1, 1, 1, 1]);
  for (let value = 0; value < 16; value++) {
    const bits = R.headerEncode(value);
    for (let a = 0; a < 8; a++) {
      const damaged = bits.slice(); damaged[a] ^= 1;
      assert.deepEqual(R.headerDecode(damaged), { value, corrected: 1 });
      for (let b = a + 1; b < 8; b++) {
        const two = damaged.slice(); two[b] ^= 1;
        assert.equal(R.headerDecode(two), null);
        for (let c = b + 1; c < 8; c++) {
          const erased = bits.map((v, i) => [a, b, c].includes(i) ? null : v);
          assert.deepEqual(R.headerDecode(erased), { value, corrected: 3 });
        }
      }
    }
  }
});

test('V2 RS independent polynomial parity checks, all single-byte magnitudes and every pair of erasures', () => {
  function polynomialMultiply(a, b) {
    let value = 0;
    while (b) { if (b & 1) value ^= a; b >>= 1; a <<= 1; if (a & 256) a ^= 0x11d; }
    return value;
  }
  for (let length = 1; length <= 9; length++) {
    const data = Array.from({ length }, (_, i) => (i * 73 + length * 29) & 255), code = R.rsEncode(data);
    let s0 = 0, s1 = 0, weight = 1;
    code.forEach(v => { s0 ^= v; s1 ^= polynomialMultiply(v, weight); weight = polynomialMultiply(weight, 2); });
    assert.deepEqual([s0, s1], [0, 0]);
    for (let a = 0; a < code.length; a++) {
      for (let error = 1; error <= 255; error++) {
        const input = code.slice(); input[a] ^= error;
        assert.deepEqual(R.rsDecode(input), { bytes: data, corrected: 1 });
      }
      for (let b = a + 1; b < code.length; b++) {
        const input = code.map((v, i) => i === a || i === b ? null : v);
        assert.deepEqual(R.rsDecode(input), { bytes: data, corrected: 2 });
      }
    }
    const lost = code.slice(); lost[0] = lost[1] = lost[2] = null;
    assert.equal(R.rsDecode(lost), null);
  }
});

for (const mode of ['mono', 'bicolor', 'color']) {
  test(`V2 ${mode}: clean round trips, lengths, UTF-8, all supported rates`, () => {
    for (const text of ['', 'A', 'LIGHT', '日本', '🔦', '12345678', '\0'.repeat(8)]) for (const rate of [2, 4, 8]) {
      const { result, tx, events } = simulate(text, { mode, rate });
      assert.equal(result?.valid, true, JSON.stringify({ mode, rate, text, events: events.filter(e => e.type !== 'symbol') }));
      assert.equal(result.text, text);
      assert.equal(tx.seconds, R.duration(R.bytesOf(text).length, tx.settings));
    }
  });
  test(`V2 ${mode}: gain change, slow gain drift, clock step after a long identical bit run, complete symbol loss`, () => {
    const conditions = [
      ['gain-half-after-sync', 'LIGHT', { gain: t => t < 15 ? 0.6 : 0.3 }],
      ['gain-slow-drift', 'LIGHT', { gain: t => 0.8 - Math.min(t, 40) * 0.01 }],
      ['clock-step-three-percent', '\0'.repeat(8), { period: i => i < 24 ? 1 : 1.03 }],
      ['whole-symbol-loss', 'LIGHT', { drop: (t, i) => i === 50 }]
    ];
    for (const [name, text, disturbance] of conditions) {
      const { result, events } = simulate(text, { mode }, disturbance);
      assert.equal(result?.valid, true, JSON.stringify({ name, mode, events: events.filter(e => e.type !== 'symbol') }));
      assert.equal(result.text, text);
      if (name === 'whole-symbol-loss') assert.ok(result.correctedBytes > 0);
    }
  });
  test(`V2 ${mode}: cannot accept flat light, clipping, or losses beyond parity capacity`, () => {
    for (const rgb of [[0, 0, 0], [1, 1, 1], [0.3, 0.1, 0.2]]) {
      const dec = R.createDecoder(R.config({ mode }));
      const events = Array.from({ length: 600 }, (_, n) => dec.push(n / 30, rgb)).flat();
      assert.equal(events.some(e => e.type === 'result'), false);
      assert.equal(dec.finish()[0].code, 'noPreamble');
    }
    const broken = simulate('LIGHT', { mode }, { drop: (t, i) => i >= 44 && i < 92 });
    assert.equal(broken.result, undefined);
    assert.ok(broken.events.some(e => ['resync', 'error'].includes(e.type)));
  });
}

test('V2 physical symbols stay at 2/s and at most 8 bytes; pair midpoint always changes', () => {
  assert.equal(R.duration(8), 107);
  assert.equal(R.duration(8, R.config({ mode: 'color' })), 47);
  assert.equal(R.duration(5), 83);
  assert.equal(R.duration(5, R.config({ mode: 'color' })), 39);
  assert.throws(() => R.config({ levels: 4 }));
  assert.throws(() => R.transmission('123456789'));
  for (const mode of ['mono', 'bicolor', 'color']) {
    const cfg = R.config({ mode }), tx = R.transmission('00000000', cfg);
    for (let i = cfg.calibration + R.PREAMBLE.length; i < tx.frames.length; i += 2) {
      assert.notDeepEqual(tx.frames[i].rgb, tx.frames[i + 1].rgb);
    }
  }
});

test('V2 receiver resynchronizes on a later clean frame after a rejected header', () => {
  const cfg = R.config({ rate: 8 });
  const bad = simulate('LIGHT', { rate: 8 }, { drop: (t, i) => i >= 16 && i < 28 });
  const good = simulate('AGAIN', { rate: 8 });
  const dec = R.createDecoder(cfg), events = [];
  for (const s of bad.samples) events.push(...dec.push(s.time, s.rgb));
  const offset = bad.samples.at(-1).time + 0.1;
  for (const s of good.samples) events.push(...dec.push(s.time + offset, s.rgb));
  assert.ok(events.some(e => e.type === 'resync'));
  assert.equal(events.find(e => e.type === 'result')?.text, 'AGAIN');
});

test('V2 optical decoding corrects an inverted data byte or two fully erased bytes before CRC validation', () => {
  for (const mode of ['mono', 'bicolor']) for (const scenario of ['error', 'erasures']) {
    const disturbance = scenario === 'error' ? { flip: i => i >= 32 && i < 48 } : { drop: (t, i) => i >= 32 && i < 64 };
    const { result } = simulate('LIGHT', { mode }, disturbance);
    assert.equal(result?.valid, true, mode + '/' + scenario);
    assert.equal(result.text, 'LIGHT');
    assert.equal(result.correctedBytes, scenario === 'error' ? 1 : 2);
  }
});

test('V2 camera sampling matrix: 162 fixed cases, every result must be correct', () => {
  for (const mode of ['mono', 'bicolor', 'color']) for (const fps of [24, 30, 60]) for (const rate of [2, 4, 8]) {
    for (const clock of [0.97, 1.025]) for (const offset of [0.13, 0.37, 0.531]) {
      const noise = { fps, offset, period: () => clock, gain: t => 0.7 - Math.min(t, 30) * 0.004,
        noise: 0.001, drop: (t, i, n) => n % 29 === 0 };
      if (mode === 'color') noise.matrix = [[0.8, 0.12, 0.08], [0.09, 0.75, 0.16], [0.05, 0.2, 0.75]];
      const { result, events } = simulate('LIGHT', { mode, rate }, noise);
      assert.equal(result?.valid, true, JSON.stringify({ mode, fps, rate, clock, offset,
        errors: events.filter(e => ['error', 'resync', 'rejected'].includes(e.type)).map(e =>
          ({ type: e.type, code: e.code, uncertain: e.uncertain, text: e.text })) }));
      assert.equal(result.text, 'LIGHT');
    }
  }
});

module.exports = { simulate };
