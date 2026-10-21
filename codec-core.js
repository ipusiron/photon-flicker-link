/* Photon Flicker Link - MIT (c) 2026 ipusiron.
 * CRC and UTF-8 validation adapted from Airborne Tone Link (same author, MIT). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PhotonCodec = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_BYTES = 8;
  const RECEIVE_SECONDS = 60;
  const CONFIDENCE = 0.45;
  const PREAMBLE = Object.freeze([0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1, 0]);
  const END = Object.freeze([1, 0, 1, 1, 0, 0]);
  const EDGES = [2, 3, 4, 5, 6, 8, 10, 13, 14, 15];
  const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
  const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
  const luminance = rgb => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;

  function config(options = {}) {
    const mode = options.mode === undefined ? 'mono' : options.mode;
    const levels = options.levels === undefined ? 2 : options.levels;
    const rate = options.rate === undefined ? 2 : options.rate;
    const contrast = options.contrast === undefined ? 'low' : options.contrast;
    if (!['mono', 'color'].includes(mode) || ![2, 4].includes(levels) || ![2, 4, 8].includes(rate) ||
        !['low', 'high'].includes(contrast)) throw new RangeError('invalidSettings');
    const low = contrast === 'low' ? 0.18 : 0.06;
    const high = contrast === 'low' ? 0.32 : 0.60;
    return { mode, levels, rate, contrast, low, high, period: 1 / rate,
      bits: Math.log2(levels) * (mode === 'color' ? 3 : 1), calibration: mode === 'color' ? 8 : 0 };
  }

  function bytesOf(text) {
    if (typeof text !== 'string') throw new TypeError('invalidText');
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new RangeError('invalidUnicode');
      } else if (code >= 0xdc00 && code <= 0xdfff) throw new RangeError('invalidUnicode');
    }
    const bytes = Array.from(new TextEncoder().encode(text));
    if (bytes.length > MAX_BYTES) throw new RangeError('tooLong');
    return bytes;
  }

  function crc8(bytes) {
    let crc = 0;
    for (const byte of bytes) {
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new RangeError('invalidByte');
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ ((crc & 0x80) ? 0x07 : 0)) & 255;
    }
    return crc;
  }

  function bytesToSymbols(bytes, settings = config()) {
    const bits = [];
    for (const byte of bytes) {
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new RangeError('invalidByte');
      for (let b = 7; b >= 0; b--) bits.push((byte >> b) & 1);
    }
    const symbols = [];
    const channelBits = Math.log2(settings.levels);
    for (let i = 0; i < bits.length; i += settings.bits) {
      const channels = [];
      for (let c = 0; c < settings.bits / channelBits; c++) {
        let value = 0;
        for (let b = 0; b < channelBits; b++) value = value * 2 + (bits[i + c * channelBits + b] || 0);
        channels.push(value);
      }
      symbols.push(settings.mode === 'mono' ? [channels[0], channels[0], channels[0]] : channels);
    }
    return symbols;
  }

  function symbolsToBytes(symbols, settings = config()) {
    const bits = [];
    for (const symbol of symbols) {
      for (const value of settings.mode === 'mono' ? symbol.slice(0, 1) : symbol) {
        const valid = Number.isInteger(value) && value >= 0 && value < settings.levels;
        for (let b = Math.log2(settings.levels) - 1; b >= 0; b--) bits.push(valid ? ((value >> b) & 1) : null);
      }
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      const part = bits.slice(i, i + 8);
      bytes.push(part.includes(null) ? null : part.reduce((a, b) => a * 2 + b, 0));
    }
    return bytes;
  }

  function partialText(bytes, final = false) {
    const decoder = new TextDecoder('utf-8');
    let text = '';
    let run = [];
    for (const byte of bytes) {
      if (byte === null) {
        text += decoder.decode(Uint8Array.from(run)) + '?';
        run = [];
      } else run.push(byte);
    }
    text += decoder.decode(Uint8Array.from(run), { stream: !final });
    return text.replace(/\ufffd/g, '?');
  }

  function srgbToLinear(value) {
    const s = clamp(value / 255);
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }

  function linearToSrgb(value) {
    const v = clamp(value);
    return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  }

  // Linearize EACH pixel before averaging; averaging sRGB first is not equivalent.
  const LINEAR = Float64Array.from({ length: 256 }, (_, i) => srgbToLinear(i));
  function averageRGBA(data) {
    if (!data || !data.length || data.length % 4) throw new RangeError('invalidPixels');
    const rgb = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) rgb[c] += LINEAR[data[i + c]];
    }
    return rgb.map(value => value / (data.length / 4));
  }

  function multiply(matrix, vector) {
    return matrix.map(row => row.reduce((sum, value, c) => sum + value * vector[c], 0));
  }

  function invert3(matrix) {
    if (!Array.isArray(matrix) || matrix.length !== 3 ||
        matrix.some(row => !Array.isArray(row) || row.length !== 3 || row.some(v => !Number.isFinite(v)))) {
      throw new RangeError('invalidMatrix');
    }
    const a = matrix.map((row, i) => [...row, ...[0, 1, 2].map(j => i === j ? 1 : 0)]);
    const norm = Math.max(...matrix.map(row => row.reduce((s, v) => s + Math.abs(v), 0)));
    for (let c = 0; c < 3; c++) {
      let pivot = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
      if (Math.abs(a[pivot][c]) < Math.max(1e-8, norm * 1e-5)) throw new RangeError('singularCalibration');
      [a[c], a[pivot]] = [a[pivot], a[c]];
      const divisor = a[c][c];
      a[c] = a[c].map(v => v / divisor);
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const factor = a[r][c];
        a[r] = a[r].map((v, j) => v - factor * a[c][j]);
      }
    }
    const inverse = a.map(row => row.slice(3));
    const condition = norm * Math.max(...inverse.map(row => row.reduce((s, v) => s + Math.abs(v), 0)));
    if (condition > 40) throw new RangeError('singularCalibration');
    return inverse;
  }

  function calibrate(black, primaries) {
    const matrix = [0, 1, 2].map(r => primaries.map(rgb => rgb[r] - black[r]));
    return { black, matrix, inverse: invert3(matrix) };
  }

  function classify(value, levels = 2) {
    const scaled = value * (levels - 1);
    const level = clamp(Math.round(scaled), 0, levels - 1);
    const confidence = clamp(1 - Math.abs(scaled - level) * 2);
    return { level, confidence, value: confidence < CONFIDENCE ? null : level };
  }

  function transmission(text, settings = config()) {
    const payload = bytesOf(text);
    const body = [payload.length, ...payload];
    body.push(crc8(body));
    const frames = [];
    const add = (kind, values) => {
      const rgb = values.map(v => settings.low + (settings.high - settings.low) * v);
      frames.push({ kind, rgb, srgb: rgb.map(linearToSrgb), index: frames.length });
    };
    if (settings.mode === 'color') {
      for (const rgb of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        add('calibration', rgb);
        add('calibration', rgb);
      }
    }
    PREAMBLE.forEach(v => add('preamble', [v, v, v]));
    bytesToSymbols(body, settings).forEach(rgb => add('data', rgb.map(v => v / (settings.levels - 1))));
    END.forEach(v => add('end', [v, v, v]));
    return { payload, body, frames, settings, seconds: frames.length * settings.period };
  }

  function duration(length, settings = config()) {
    if (!Number.isInteger(length) || length < 0 || length > MAX_BYTES) throw new RangeError('tooLong');
    return (settings.calibration + PREAMBLE.length + Math.ceil((length + 2) * 8 / settings.bits) + END.length) * settings.period;
  }

  function matchRate(expected, actual, role) {
    if (role !== 'offline' || typeof expected !== 'string' || !expected.length) return null;
    const a = Array.from(expected), b = Array.from(actual);
    return 100 * a.filter((value, i) => value === b[i]).length / Math.max(a.length, b.length);
  }

  function windowRGB(samples, start, end) {
    const selected = samples.filter(s => s.time >= start && s.time <= end);
    if (!selected.length) return null;
    return [0, 1, 2].map(c => mean(selected.map(s => s.rgb[c])));
  }

  // Fit known transition positions to timestamps. The receiver does not use the sender's rate setting.
  function findPreamble(samples) {
    if (samples.length < 25) return null;
    const sorted = samples.map(s => luminance(s.rgb)).sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.1)], hi = sorted[Math.floor(sorted.length * 0.9)];
    if (hi - lo < 0.025) return null;
    let state = luminance(samples[0].rgb) > (lo + hi) / 2 ? 1 : 0;
    const edges = [];
    for (let i = 1; i < samples.length; i++) {
      const value = (luminance(samples[i].rgb) - lo) / (hi - lo);
      const next = value > 0.6 ? 1 : value < 0.4 ? 0 : state;
      if (next !== state) {
        edges.push({ time: (samples[i].time + samples[i - 1].time) / 2, up: next === 1 });
        state = next;
      }
    }
    for (let i = edges.length - EDGES.length; i >= 0; i--) {
      const group = edges.slice(i, i + EDGES.length);
      if (!group.every((edge, j) => edge.up === (j % 2 === 0))) continue;
      const mx = mean(EDGES), my = mean(group.map(e => e.time));
      const period = EDGES.reduce((s, x, j) => s + (x - mx) * (group[j].time - my), 0) /
        EDGES.reduce((s, x) => s + (x - mx) ** 2, 0);
      if (period < 0.095 || period > 0.7) continue;
      const start = my - period * mx;
      const error = Math.max(...group.map((e, j) => Math.abs(e.time - start - EDGES[j] * period)));
      if (error > period * 0.24) continue;
      if (samples.at(-1).time < start + (PREAMBLE.length - 0.2) * period) continue;
      const slots = PREAMBLE.map((_, j) => windowRGB(samples, start + (j + 0.22) * period, start + (j + 0.78) * period));
      if (slots.some(v => v === null)) continue;
      const dark = [0, 1, 2].map(c => mean(slots.filter((_, j) => !PREAMBLE[j]).map(rgb => rgb[c])));
      const light = [0, 1, 2].map(c => mean(slots.filter((_, j) => PREAMBLE[j]).map(rgb => rgb[c])));
      const low = luminance(dark), high = luminance(light);
      if (high - low < 0.025) continue;
      if (slots.some((rgb, j) => Math.abs((luminance(rgb) - low) / (high - low) - PREAMBLE[j]) > 0.3)) continue;
      const intervals = samples.slice(1).map((s, j) => s.time - samples[j].time).sort((a, b) => a - b);
      const samplePeriod = intervals[Math.floor(intervals.length / 2)];
      return { start, period, low, high, dark, light, framesPerSymbol: period / samplePeriod, error,
        anchors: group.map((e, j) => ({ x: EDGES[j], y: e.time })) };
    }
    return null;
  }

  function detectCalibration(samples, sync) {
    const slots = [0, 1, 2, 3].map(i => windowRGB(samples,
      sync.start - (8 - i * 2 - 0.35) * sync.period, sync.start - (8 - i * 2 - 1.65) * sync.period));
    if (slots.some(v => !v)) throw new RangeError('missingCalibration');
    const calibration = calibrate(slots[0], slots.slice(1));
    const white = multiply(calibration.matrix, [1, 1, 1]).map((v, c) => v + calibration.black[c]);
    const span = Math.max(...sync.light.map((v, c) => v - sync.dark[c]));
    if (white.some((v, c) => Math.abs(v - sync.light[c]) > span * 0.25) ||
        slots[0].some((v, c) => Math.abs(v - sync.dark[c]) > span * 0.2)) throw new RangeError('unstableCalibration');
    return calibration;
  }

  function createDecoder(settings = config()) {
    let samples = [], sync = null, calibration = null, done = false, searchTime = -Infinity;
    let symbols = [], decisions = [], length = null, dataCount = null, lastTime = -Infinity;
    let endValues = [], priorSample = null, priorLevels = null;
    function push(time, rgb) {
      const events = [];
      if (done || !Number.isFinite(time) || time <= lastTime) return events;
      if (!Array.isArray(rgb) || rgb.length !== 3 || rgb.some(v => !Number.isFinite(v))) return events;
      lastTime = time;
      samples.push({ time, rgb });
      if (samples.length > 8192) samples.shift();
      if (!sync) {
        samples = samples.filter(s => time - s.time < 18);
        if (time - searchTime < 0.08) return events;
        searchTime = time;
        sync = findPreamble(samples);
        if (!sync) return events;
        if (sync.framesPerSymbol < 2) {
          done = true;
          return [{ type: 'error', code: 'fpsTooLow' }];
        }
        if (settings.mode === 'color') {
          try { calibration = detectCalibration(samples, sync); }
          catch (error) { done = true; return [{ type: 'error', code: error.message }]; }
        }
        events.push({ type: 'sync', ...sync, calibration });
      }
      const raw = calibration ? multiply(calibration.inverse, rgb.map((v, c) => v - calibration.black[c])) :
        Array(3).fill((luminance(rgb) - sync.low) / (sync.high - sync.low));
      const rawDecisions = raw.map(v => classify(v, settings.levels));
      const rawLevels = rawDecisions.map(d => d.value);
      if (rawDecisions.every(d => d.confidence > 0.65)) {
        if (priorLevels && priorSample && rawLevels.some((v, c) => v !== priorLevels[c])) {
          const edge = (time + priorSample.time) / 2;
          const x = Math.round((edge - sync.start) / sync.period);
          const residual = edge - sync.start - x * sync.period;
          if (x >= PREAMBLE.length && Math.abs(residual) < sync.period * 0.35 &&
              x > sync.anchors.at(-1).x) {
            sync.anchors.push({ x, y: edge });
            const mx = mean(sync.anchors.map(a => a.x)), my = mean(sync.anchors.map(a => a.y));
            sync.period = sync.anchors.reduce((s, a) => s + (a.x - mx) * (a.y - my), 0) /
              sync.anchors.reduce((s, a) => s + (a.x - mx) ** 2, 0);
            sync.start = my - mx * sync.period;
          }
        }
        priorLevels = rawLevels;
      }
      priorSample = { time };
      const dataStart = sync.start + PREAMBLE.length * sync.period;
      // Central windows reject transitions and rolling-shutter blends.
      while (!done) {
        const slot = symbols.length + endValues.length;
        const center = dataStart + (slot + 0.5) * sync.period;
        if (time < center + 0.28 * sync.period) break;
        const value = windowRGB(samples, center - 0.28 * sync.period, center + 0.28 * sync.period);
        if (dataCount !== null && symbols.length >= dataCount) {
          const normalized = value ? (luminance(value) - sync.low) / (sync.high - sync.low) : NaN;
          const decision = Number.isFinite(normalized) ? classify(normalized) : { value: null };
          endValues.push(decision.value);
          if (endValues.length === END.length) {
            const bytes = symbolsToBytes(symbols, settings).slice(0, length + 2);
            const payload = bytes.slice(1, length + 1);
            const crcOk = bytes.every(v => v !== null) && crc8(bytes.slice(0, -1)) === bytes.at(-1);
            const endOk = endValues.every((v, i) => v === END[i]);
            let utf8Ok = !payload.includes(null);
            try { new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(payload)); }
            catch (_) { utf8Ok = false; }
            done = true;
            events.push({ type: 'result', text: partialText(payload, true), payload, crcOk, endOk, utf8Ok,
              valid: crcOk && endOk && utf8Ok, confidence: Math.min(...decisions.map(d => d.confidence)),
              uncertain: decisions.filter(d => d.confidence < CONFIDENCE).map(d => d.index),
              framesPerSymbol: sync.framesPerSymbol, period: sync.period, decisions: decisions.slice() });
          }
          continue;
        }
        let normalized = [NaN, NaN, NaN];
        if (value) normalized = calibration ? multiply(calibration.inverse, value.map((v, c) => v - calibration.black[c])) :
          Array(3).fill((luminance(value) - sync.low) / (sync.high - sync.low));
        const classified = normalized.map(v => Number.isFinite(v) ? classify(v, settings.levels) : { value: null, confidence: 0 });
        const confidence = Math.min(...classified.map(d => d.confidence));
        const decision = { type: 'symbol', index: symbols.length, time: center, normalized, confidence,
          values: classified.map(d => d.value) };
        decisions.push(decision);
        symbols.push(decision.values);
        events.push(decision);
        const bytes = symbolsToBytes(symbols, settings);
        if (length === null && bytes.length) {
          length = bytes[0];
          if (length === null || length > MAX_BYTES) {
            done = true;
            events.push({ type: 'error', code: 'invalidLength' });
            break;
          }
          dataCount = Math.ceil((length + 2) * 8 / settings.bits);
        }
        if (length !== null) events.push({ type: 'text', text: partialText(bytes.slice(1, length + 1)) });
        // Slow common-mode drift tracking, only at confidently observed binary endpoints.
        if (!calibration && settings.levels === 2 && confidence > 0.65 && value) {
          const y = luminance(value);
          if (decision.values[0] === 0) sync.low += 0.04 * (y - sync.low);
          if (decision.values[0] === 1) sync.high += 0.04 * (y - sync.high);
        }
      }
      return events;
    }
    function finish() {
      if (done) return [];
      done = true;
      return [{ type: 'error', code: sync ? 'incompleteFrame' : 'noPreamble' }];
    }
    function clear() { samples = []; symbols = []; decisions = []; endValues = []; done = true; }
    return { push, finish, clear, get synchronized() { return !!sync; } };
  }

  return Object.freeze({ MAX_BYTES, RECEIVE_SECONDS, CONFIDENCE, PREAMBLE, END, config, clamp, luminance,
    bytesOf, crc8, bytesToSymbols, symbolsToBytes, partialText, srgbToLinear, linearToSrgb, averageRGBA,
    multiply, invert3, calibrate, classify, transmission, duration, matchRate, findPreamble, detectCalibration, createDecoder });
}));
