/* Photon Flicker Link - MIT (c) 2026 ipusiron. Version 2: paired symbols and bounded error correction. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./codec-core.js'));
  else root.PhotonReliable = factory(root.PhotonCodec);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';
  const PREAMBLE = Object.freeze(core.PREAMBLE.map(v => 1 - v));
  const END_BITS = [1, 0, 1];
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const xor = a => a.reduce((s, v) => s ^ v, 0);
  const bitsOf = bytes => bytes.flatMap(v => Array.from({ length: 8 }, (_, i) => v === null ? null : (v >> (7 - i)) & 1));
  function bytesOfBits(bits) {
    return Array.from({ length: Math.floor(bits.length / 8) }, (_, i) => {
      const part = bits.slice(i * 8, i * 8 + 8);
      return part.includes(null) ? null : part.reduce((s, v) => s * 2 + v, 0);
    });
  }
  function config(options = {}) {
    const value = core.config(options);
    if (value.levels !== 2) throw new RangeError('invalidSettings');
    return { ...value, reliable: true };
  }

  // Extended Hamming(8,4), parity at positions 1,2,4,8. Decode all codewords before checking length <= 8.
  function headerEncode(value) {
    if (!Number.isInteger(value) || value < 0 || value > 15) throw new RangeError('invalidLength');
    const b = [0, 0, (value >> 3) & 1, 0, (value >> 2) & 1, (value >> 1) & 1, value & 1, 0];
    b[0] = b[2] ^ b[4] ^ b[6]; b[1] = b[2] ^ b[5] ^ b[6]; b[3] = b[4] ^ b[5] ^ b[6];
    b[7] = xor(b);
    return b;
  }
  function headerDecode(bits) {
    if (bits.length !== 8 || bits.some(v => v !== null && v !== 0 && v !== 1)) return null;
    const erased = bits.filter(v => v === null).length, candidates = [];
    for (let value = 0; value < 16; value++) {
      const code = headerEncode(value), errors = bits.filter((v, i) => v !== null && v !== code[i]).length;
      if (2 * errors + erased < 4) candidates.push({ value, corrected: errors + erased });
    }
    return candidates.length === 1 ? candidates[0] : null;
  }

  // Shortened RS over GF(256), primitive polynomial 0x11d. Two parity checks: sum(c_i), sum(alpha^i c_i).
  const exp = new Uint8Array(510), log = new Uint8Array(256);
  let power = 1;
  for (let i = 0; i < 255; i++) { exp[i] = power; log[power] = i; power <<= 1; if (power & 256) power ^= 0x11d; }
  for (let i = 255; i < 510; i++) exp[i] = exp[i - 255];
  const mul = (a, b) => a && b ? exp[log[a] + log[b]] : 0;
  const div = (a, b) => { if (!b) throw new RangeError('zeroDivisor'); return a ? exp[(log[a] - log[b] + 255) % 255] : 0; };
  const syndrome = a => [xor(a), xor(a.map((v, i) => mul(exp[i], v)))];
  function parityPair(a, b, s0, s1) {
    const first = div(s1 ^ mul(b, s0), a ^ b);
    return [first, s0 ^ first];
  }
  function rsEncode(data) {
    if (!data.length || data.length > 253 || data.some(v => !Number.isInteger(v) || v < 0 || v > 255)) {
      throw new RangeError('invalidByte');
    }
    return [...data, ...parityPair(exp[data.length], exp[data.length + 1], ...syndrome(data))];
  }
  function rsDecode(input) {
    if (input.length < 3 || input.length > 255 || input.some(v => v !== null && (!Number.isInteger(v) || v < 0 || v > 255))) {
      return null;
    }
    const missing = input.flatMap((v, i) => v === null ? [i] : []), code = input.map(v => v ?? 0);
    if (missing.length > 2) return null;
    const [s0, s1] = syndrome(code);
    let corrected = missing.length;
    if (missing.length === 2) {
      const [a, b] = missing;
      [code[a], code[b]] = parityPair(exp[a], exp[b], s0, s1);
    } else if (missing.length === 1) code[missing[0]] = s0;
    else if (s0 || s1) {
      if (!s0 || !s1) return null;
      const position = log[div(s1, s0)];
      if (position >= code.length) return null;
      code[position] ^= s0;
      corrected = 1;
    }
    if (syndrome(code).some(v => v !== 0)) return null;
    return { bytes: code.slice(0, -2), corrected };
  }

  function transmission(text, settings = config()) {
    if (!settings.reliable) return core.transmission(text, settings);
    const payload = core.bytesOf(text), body = [payload.length, ...payload];
    body.push(core.crc8(body));
    const coded = rsEncode(body.slice(1)), bits = [...headerEncode(payload.length), ...bitsOf(coded)], frames = [];
    const add = (kind, values) => {
      let rgb = values.map(v => settings.low + (settings.high - settings.low) * v);
      if (settings.mode === 'bicolor') {
        const lo = settings.contrast === 'low' ? 0.06 : 0.02, hi = settings.contrast === 'low' ? 0.32 : 0.60;
        rgb = values[0] ? [hi, lo, lo] : [lo, lo, hi];
      }
      frames.push({ kind, rgb, srgb: rgb.map(core.linearToSrgb), index: frames.length });
    };
    if (settings.mode === 'color') for (const rgb of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      add('calibration', rgb); add('calibration', rgb);
    }
    PREAMBLE.forEach(v => add('preamble', [v, v, v]));
    for (let i = 0; i < bits.length; i += settings.bits) {
      const values = settings.mode === 'color' ? [bits[i] || 0, bits[i + 1] || 0, bits[i + 2] || 0] : Array(3).fill(bits[i]);
      add('data', values); add('complement', values.map(v => 1 - v));
    }
    END_BITS.forEach(v => { add('end', [v, v, v]); add('end', [1 - v, 1 - v, 1 - v]); });
    return { payload, body, coded, frames, settings, seconds: frames.length * settings.period, protocol: 2 };
  }
  function duration(length, settings = config()) {
    if (!settings.reliable) return core.duration(length, settings);
    if (!Number.isInteger(length) || length < 0 || length > core.MAX_BYTES) throw new RangeError('tooLong');
    return (settings.calibration + 22 + 2 * Math.ceil((length + 4) * 8 / settings.bits)) * settings.period;
  }

  function createDecoder(settings = config()) {
    if (!settings.reliable) return core.createDecoder(settings);
    let samples = [], sync = null, calibration = null, last = -Infinity, search = -Infinity, done = false;
    let bits = [], decisions = [], length = null, count = null, end = [], pair = 0, next = 0, anchors = [], header = null;
    let attempts = 0, lastFailure = '', initialPeriod = 0;
    function reset(code) {
      sync = null; calibration = null; bits = []; decisions = []; length = null; count = null; end = []; pair = 0;
      anchors = []; header = null; samples = samples.slice(-1); search = -Infinity; attempts++; lastFailure = code;
      return { type: 'resync', code, attempts };
    }
    function windowAt(center, period) {
      let selected = samples.filter(s => Math.abs(s.time - center) <= 0.28 * period);
      if (!selected.length) {
        const before = samples.findLast(s => s.time < center), after = samples.find(s => s.time > center);
        if (!before || !after || center - before.time > 0.4 * period || after.time - center > 0.4 * period) return null;
        // A short empty central window is bracketed inside the same half, with a 10% boundary guard.
        // Disagreement increases measured noise and is rejected by the unchanged six-noise-span requirement.
        selected = [before, after];
      }
      const rgb = [0, 1, 2].map(c => mean(selected.map(s => s.rgb[c])));
      const noise = [0, 1, 2].map(c => Math.sqrt(mean(selected.map(s => (s.rgb[c] - rgb[c]) ** 2))));
      return { rgb, noise };
    }
    function normalize(rgb) {
      return calibration ? core.multiply(calibration.inverse, rgb.map((v, c) => v - calibration.black[c])) :
        Array(3).fill(core.signal(rgb, settings.mode));
    }
    function paired(a, b) {
      if (!a || !b) return { values: Array(3).fill(null), normalized: Array(3).fill(NaN), confidence: 0 };
      const x = normalize(a.rgb), y = normalize(b.rgb);
      const values = [], confidence = [], normalized = [];
      for (let c = 0; c < 3; c++) {
        // Pairwise comparison removes a gain shared by both halves. Noise and contrast checks remain mandatory.
        const delta = x[c] - y[c], scale = Math.abs(x[c]) + Math.abs(y[c]) + 0.000001;
        const relative = Math.abs(delta) / scale;
        const sensorSpan = Math.max(...a.rgb.map((v, j) => Math.abs(v - b.rgb[j])));
        const noise = Math.max(...a.noise, ...b.noise);
        const quality = sensorSpan >= Math.max(0.002, 6 * noise) && relative >= 0.1 ?
          core.clamp(relative / 0.2) : 0;
        confidence.push(quality); normalized.push(delta > 0 ? 1 : 0);
        values.push(quality >= core.CONFIDENCE ? Number(delta > 0) : null);
      }
      return { values, normalized, confidence: Math.min(...confidence) };
    }
    function trackClock(a, b, middle, period) {
      if (!a || !b) return null;
      const vector = b.rgb.map((v, c) => v - a.rgb[c]), norm = vector.reduce((s, v) => s + v * v, 0);
      if (norm < 0.000004) return null;
      // Keep the samples bracketing a transition even when one is outside its acceptance interval.
      // The interpolated crossing itself still must lie within 0.4 physical symbols of the predicted midpoint.
      const near = samples.filter(s => Math.abs(s.time - middle) <= 0.8 * period);
      const crossings = [];
      for (let i = 1; i < near.length; i++) {
        const project = s => s.rgb.reduce((sum, v, c) => sum + (v - a.rgb[c]) * vector[c], 0) / norm;
        const u = project(near[i - 1]), v = project(near[i]);
        if (u < 0.5 && v >= 0.5 && near[i].time - near[i - 1].time <= 0.5 * period) {
          const edge = near[i - 1].time + (near[i].time - near[i - 1].time) * (0.5 - u) / (v - u);
          if (Math.abs(edge - middle) <= 0.4 * period) crossings.push(edge);
        }
      }
      if (crossings.length !== 1) return null;
      const edge = crossings[0];
      anchors.push({ x: pair * 2 + 1, y: edge });
      anchors = anchors.slice(-8);
      let estimated = edge;
      if (anchors.length >= 3) {
        const mx = mean(anchors.map(a => a.x)), my = mean(anchors.map(a => a.y));
        const fitted = anchors.reduce((s, a) => s + (a.x - mx) * (a.y - my), 0) /
          anchors.reduce((s, a) => s + (a.x - mx) ** 2, 0);
        if (Math.abs(fitted / initialPeriod - 1) <= 0.2) {
          sync.period = fitted;
          estimated = my + (pair * 2 + 1 - mx) * fitted;
        }
      }
      return estimated;
    }
    function finishPacket() {
      const raw = bytesOfBits(bits.slice(8, (length + 4) * 8)), restored = rsDecode(raw);
      const bytes = restored?.bytes || raw.slice(0, -2), payload = bytes.slice(0, length);
      const crcOk = !!restored && core.crc8([length, ...payload]) === bytes[length];
      const endOk = end.every((v, i) => v === END_BITS[i]);
      let utf8Ok = !payload.includes(null);
      try { new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(payload)); } catch (_) { utf8Ok = false; }
      const paddingOk = bits.slice((length + 4) * 8).every(v => v === 0);
      return { type: 'result', text: core.partialText(payload, true), payload, crcOk, endOk, utf8Ok,
        valid: crcOk && endOk && utf8Ok && paddingOk, confidence: Math.min(...decisions.map(d => d.confidence)),
        uncertain: decisions.filter(d => d.confidence < core.CONFIDENCE).map(d => d.index),
        framesPerSymbol: sync.framesPerSymbol, period: sync.period, decisions: decisions.slice(),
        correctedBytes: restored?.corrected ?? 0, correctedHeaderBits: header.corrected, attempts, protocol: 2 };
    }
    function push(time, rgb) {
      const events = [];
      if (done || !Number.isFinite(time) || time <= last || !Array.isArray(rgb) || rgb.length !== 3 ||
          rgb.some(v => !Number.isFinite(v))) return events;
      last = time; samples.push({ time, rgb });
      samples = samples.filter(s => time - s.time < (sync ? 3 : 18));
      if (!sync) {
        if (time - search < 0.08) return events;
        search = time;
        sync = core.findPreamble(samples, settings.mode, PREAMBLE, true);
        if (!sync) return events;
        if (sync.framesPerSymbol < 2) return [reset('fpsTooLow')];
        if (settings.mode === 'color') {
          try { calibration = core.detectCalibration(samples, sync); }
          catch (error) { return [reset(error.message)]; }
        }
        initialPeriod = sync.period;
        anchors = sync.anchors.map(a => ({ x: a.x - PREAMBLE.length, y: a.y })).slice(-8);
        next = sync.start + PREAMBLE.length * sync.period;
        events.push({ type: 'sync', ...sync, calibration, protocol: 2 });
      }
      while (sync && time >= next + 1.78 * sync.period) {
        const period = sync.period, middle = next + period;
        const a = windowAt(next + 0.5 * period, period), b = windowAt(next + 1.5 * period, period);
        const decision = paired(a, b), edge = decision.confidence >= core.CONFIDENCE ? trackClock(a, b, middle, period) : null;
        const ending = count !== null && pair >= count;
        next = (edge ?? middle) + sync.period;
        const entry = { type: 'symbol', ...decision, index: pair, time: middle, period: sync.period, clockObserved: edge !== null };
        pair++;
        if (ending) {
          end.push(decision.values.every(v => v === decision.values[0]) ? decision.values[0] : null);
          if (end.length === END_BITS.length) {
            const result = finishPacket();
            if (result.valid) { done = true; events.push(result); }
            else { events.push({ ...result, type: 'rejected' }, reset('packetRejected')); }
            break;
          }
          continue;
        }
        decisions.push(entry); events.push(entry);
        bits.push(...(settings.mode === 'color' ? decision.values : decision.values.slice(0, 1)));
        if (length === null && bits.length >= 8) {
          header = headerDecode(bits.slice(0, 8));
          if (!header || header.value > core.MAX_BYTES) { events.push(reset('invalidLength')); break; }
          length = header.value; count = Math.ceil((length + 4) * 8 / settings.bits);
        }
        entry.total = count;
        if (length !== null) events.push({ type: 'text', text: core.partialText(bytesOfBits(bits.slice(8)).slice(0, length)) });
      }
      return events;
    }
    function finish() {
      if (done) return [];
      done = true;
      return [{ type: 'error', code: sync ? 'incompleteFrame' : lastFailure || 'noPreamble' }];
    }
    function clear() { samples = []; bits = []; decisions = []; done = true; }
    return { push, finish, clear, get synchronized() { return !!sync; } };
  }
  return Object.freeze({ ...core, RECEIVE_SECONDS: 120, PREAMBLE, config, transmission, duration, createDecoder,
    headerEncode, headerDecode, rsEncode, rsDecode });
}));
