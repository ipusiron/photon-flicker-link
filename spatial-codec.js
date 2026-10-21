/* Photon Flicker Link - MIT (c) 2026 ipusiron. Serial spatial pairs with an independent optical clock. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./reliable-codec.js'));
  else root.PhotonSpatial = factory(root.PhotonReliable);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';
  const PREAMBLE = Object.freeze(core.PREAMBLE.slice());
  const MIN_SPAN = 0.025;
  const MAX_CANDIDATES = 8;
  const median = values => {
    const sorted = values.slice().sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const cyclePeriod = values => median(values.slice(1).map((value, i) => (value + values[i]) / 2));
  const bitsOf = bytes => bytes.flatMap(value => Array.from({ length: 8 }, (_, i) => (value >> (7 - i)) & 1));
  const bytesOfBits = bits => Array.from({ length: Math.ceil(bits.length / 8) }, (_, i) => {
    const part = bits.slice(i * 8, i * 8 + 8);
    return part.includes(null) || part.length < 8 ? null : part.reduce((value, bit) => value * 2 + bit, 0);
  });

  function config(options = {}) {
    if ((options.mode !== undefined && options.mode !== 'mono') || (options.levels !== undefined && options.levels !== 2)) {
      throw new RangeError('invalidSettings');
    }
    return { ...core.config({ ...options, mode: 'mono', levels: 2 }), protocol: 3, spatial: true, calibration: 0, bits: 1 };
  }
  function crc16(bytes) {
    let crc = 0xffff;
    for (const byte of bytes) {
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new RangeError('invalidByte');
      crc ^= byte << 8;
      for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
    }
    return crc;
  }
  function duration(length, settings = config()) {
    if (!Number.isInteger(length) || length < 0 || length > core.MAX_BYTES) throw new RangeError('tooLong');
    const count = Math.max(1, Math.ceil(length / 4));
    return (count * (16 + 16 + 5 * 8) + length * 8 + 2) * settings.period;
  }
  function transmission(text, settings = config()) {
    const payload = core.bytesOf(text), identity = crc16([payload.length, ...payload]);
    const frames = [], blocks = [], body = [payload.length, ...payload];
    const add = (kind, bit, block) => {
      const index = frames.length, clock = index & 1;
      frames.push({ index, kind, bit, clock, block, values: [bit, 1 - bit, clock, 1 - clock] });
    };
    for (let index = 0; index < Math.max(1, Math.ceil(payload.length / 4)); index++) {
      const header = 0xa0 | (index << 4) | payload.length;
      const data = [identity >> 8, identity & 255, ...payload.slice(index * 4, index * 4 + 4)];
      data.push(core.crc8([header, ...data]));
      const coded = core.rsEncode(data), start = frames.length;
      PREAMBLE.forEach(bit => add('preamble', bit, index));
      [...core.headerEncode(header >> 4), ...core.headerEncode(header & 15)].forEach(bit => add('header', bit, index));
      bitsOf(coded).forEach(bit => add('data', bit, index));
      blocks.push({ index, header, data, coded, start, end: frames.length });
    }
    // Clock edges commit the final data bit. Guard values carry no payload or required end marker.
    add('guard', 0, blocks.length - 1); add('guard', 0, blocks.length - 1);
    return { payload, body, frames, blocks, settings, seconds: frames.length * settings.period, protocol: 3 };
  }

  function createDecoder(settings = config()) {
    let last = -Infinity, lastGood = -Infinity, done = false, run = null, pending = [];
    let history = [], candidates = [], periods = [], clockPeriod = null, attempts = 0, lastFailure = '';
    let sequence = 0, visibleId = null;
    const assemblies = new Map();
    function resync(code, events) {
      lastFailure = code; attempts++;
      events.push({ type: 'resync', code, attempts, protocol: 3 });
    }
    function loseClock(events, keepObservedRun = false) {
      if (candidates.length || history.length) resync('clockLost', events);
      candidates = []; history = []; periods = []; clockPeriod = null; visibleId = null;
      if (!keepObservedRun) { run = null; pending = []; }
    }
    function decision(samples, time, period, periodLow, periodHigh) {
      const selected = samples.length >= 5 ? samples.slice(1, -1) : samples;
      const data = median(selected.map(sample => sample.data));
      const agreeing = selected.filter(sample => Math.sign(sample.data) === Math.sign(data) && Math.abs(sample.data) >= MIN_SPAN);
      const quality = median(selected.map(sample => sample.quality)) * agreeing.length / selected.length;
      const accepted = selected.length >= 2 && Math.abs(data) >= MIN_SPAN && quality >= core.CONFIDENCE &&
        agreeing.length >= Math.ceil(selected.length * 2 / 3);
      const bit = accepted ? Number(data > 0) : null;
      return { type: 'symbol', values: Array(3).fill(bit), normalized: Array(3).fill(core.clamp((data + 1) / 2)),
        confidence: accepted ? quality : 0, time, period, periodLow, periodHigh, clockObserved: true, samples: samples.length };
    }
    function reject(candidate, code, events) {
      candidate.failed = true;
      if (candidate.id === visibleId) resync(code, events);
    }
    function rejected(candidate, code, payload, crcOk, events) {
      if (candidate.id === visibleId) events.push({ type: 'rejected', code, text: core.partialText(payload, true), payload, valid: false,
        crcOk, endOk: true, utf8Ok: false, confidence: 0, uncertain: [], decisions: candidate.decisions.slice(),
        period: candidate.period, framesPerSymbol: candidate.framesPerSymbol, correctedBytes: 0,
        correctedHeaderBits: candidate.correctedHeaderBits || 0, attempts, protocol: 3, blocks: 0 });
      reject(candidate, code, events);
    }
    function announce(candidate, events) {
      if (!candidate || candidate.id === visibleId) return;
      visibleId = candidate.id;
      events.push({ type: 'sync', period: candidate.period, framesPerSymbol: candidate.framesPerSymbol,
        start: candidate.start, protocol: 3, spatial: true });
    }
    function acceptBlock(candidate, events) {
      const restored = core.rsDecode(bytesOfBits(candidate.bits));
      if (!restored) { rejected(candidate, 'packetRejected', [], false, events); return; }
      const bytes = restored.bytes;
      if (core.crc8([candidate.header, ...bytes.slice(0, -1)]) !== bytes.at(-1)) {
        rejected(candidate, 'packetRejected', [], false, events); return;
      }
      candidate.failed = true;
      const identity = bytes[0] * 256 + bytes[1], chunk = bytes.slice(2, -1), key = candidate.length + ':' + identity;
      let assembly = assemblies.get(key);
      if (!assembly) {
        assembly = { identity, length: candidate.length, count: Math.max(1, Math.ceil(candidate.length / 4)), parts: new Map() };
        assemblies.set(key, assembly);
        if (assemblies.size > 4) assemblies.delete(assemblies.keys().next().value);
      }
      const previous = assembly.parts.get(candidate.block);
      if (previous && previous.chunk.some((value, i) => value !== chunk[i])) {
        assemblies.delete(key); rejected(candidate, 'blockConflict', [], false, events); return;
      }
      if (!previous) assembly.parts.set(candidate.block, { chunk, candidate, corrected: restored.corrected });
      events.push({ type: 'block', index: candidate.block, blocks: assembly.parts.size, total: assembly.count,
        duplicate: !!previous, protocol: 3 });
      const prefix = [];
      for (let index = 0; assembly.parts.has(index); index++) prefix.push(...assembly.parts.get(index).chunk);
      events.push({ type: 'text', text: core.partialText(prefix) });
      if (assembly.parts.size !== assembly.count) return;
      const parts = Array.from({ length: assembly.count }, (_, index) => assembly.parts.get(index));
      const payload = parts.flatMap(part => part.chunk), crcOk = crc16([assembly.length, ...payload]) === identity;
      let utf8Ok = true;
      try { new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(payload)); } catch (_) { utf8Ok = false; }
      const decisions = parts.flatMap(part => part.candidate.decisions);
      const result = { type: 'result', text: core.partialText(payload, true), payload, crcOk, utf8Ok, endOk: true,
        valid: crcOk && utf8Ok, confidence: Math.min(...decisions.map(item => item.confidence)),
        uncertain: decisions.flatMap((item, index) => item.confidence < core.CONFIDENCE ? [index] : []), decisions,
        correctedBytes: parts.reduce((sum, part) => sum + part.corrected, 0), attempts, protocol: 3,
        correctedHeaderBits: parts.reduce((sum, part) => sum + part.candidate.correctedHeaderBits, 0),
        framesPerSymbol: candidate.framesPerSymbol, period: candidate.period, blocks: assembly.count };
      if (result.valid) { done = true; events.push(result); }
      else { events.push({ ...result, type: 'rejected' }); assemblies.delete(key); resync('packetRejected', events); }
    }
    function receiveBit(entry, events) {
      for (const candidate of candidates) {
        const bit = entry.values[0];
        const item = { ...entry, index: candidate.decisions.length, total: candidate.total ?? null };
        candidate.decisions.push(item);
        if (candidate.id === visibleId) events.push(item);
        if (candidate.header === null) {
          candidate.headerBits.push(bit);
          const offset = candidate.headerBits.length <= 8 ? 0 : 8;
          if (candidate.headerBits.slice(offset).filter(value => value === null).length > 3) {
            reject(candidate, 'invalidLength', events); continue;
          }
          if (candidate.headerBits.length !== 16) continue;
          const high = core.headerDecode(candidate.headerBits.slice(0, 8)), low = core.headerDecode(candidate.headerBits.slice(8));
          if (!high || !low || ![10, 11].includes(high.value) || low.value > core.MAX_BYTES ||
              (high.value === 11 && low.value <= 4)) { reject(candidate, 'invalidLength', events); continue; }
          candidate.header = high.value * 16 + low.value; candidate.length = low.value; candidate.block = high.value - 10;
          candidate.correctedHeaderBits = high.corrected + low.corrected;
          candidate.count = (Math.min(4, candidate.length - candidate.block * 4) + 5) * 8;
          candidate.total = candidate.count + 16; item.total = candidate.total;
          if (visibleId === null || candidate.id > visibleId) announce(candidate, events);
          continue;
        }
        candidate.bits.push(bit);
        const erased = new Set(candidate.bits.flatMap((value, index) => value === null ? [Math.floor(index / 8)] : []));
        if (erased.size > 2) { reject(candidate, 'tooManyErasures', events); continue; }
        if (candidate.bits.length === candidate.count) acceptBlock(candidate, events);
        if (done) return;
      }
      candidates = candidates.filter(candidate => !candidate.failed);
      if (!candidates.some(candidate => candidate.id === visibleId)) {
        visibleId = null;
        announce(candidates.filter(candidate => candidate.header !== null).at(-1) || candidates.at(-1), events);
      }
      history.push(entry); history = history.slice(-PREAMBLE.length);
      if (history.length !== PREAMBLE.length || history.some((item, i) => item.values[0] !== PREAMBLE[i])) return;
      const period = cyclePeriod(history.map(item => item.period));
      if (history.some(item => item.samples < 2 || item.periodHigh + 1e-9 < 0.5 * period || item.periodLow > 1.65 * period + 1e-9)) {
        return;
      }
      const framesPerSymbol = median(history.map(item => item.samples));
      const candidate = { id: sequence++, header: null, headerBits: [], bits: [], decisions: [], period, framesPerSymbol,
        start: history[0].time - history[0].period / 2 };
      candidates.push(candidate); candidates = candidates.slice(-MAX_CANDIDATES);
      if (!candidates.some(item => item.header !== null)) announce(candidate, events);
    }
    function commit(end, edgeLow, events) {
      // A sampled transition lies between the last old frame and the first new frame, not exactly at either timestamp.
      const startMiddle = (run.edgeLow + run.start) / 2, endMiddle = (edgeLow + end) / 2;
      const period = endMiddle - startMiddle, periodLow = edgeLow - run.start, periodHigh = end - run.edgeLow;
      if (run.samples.length < 2) {
        loseClock(events); return;
      }
      if (clockPeriod && (periodHigh + 1e-9 < clockPeriod * 0.5 || periodLow > clockPeriod * 1.65 + 1e-9)) loseClock(events, true);
      periods.push(period); periods = periods.slice(-8);
      // One short initial run is not a clock estimate; acquire both alternating phases before enforcing a bound.
      clockPeriod = periods.length >= 4 ? cyclePeriod(periods) : null;
      receiveBit(decision(run.samples, (startMiddle + endMiddle) / 2, period, periodLow, periodHigh), events);
    }
    function push(time, observation) {
      const events = [];
      if (done || !Number.isFinite(time) || time <= last) return events;
      last = time;
      const clockQuality = observation?.clockQuality ?? observation?.quality;
      const dataQuality = observation?.dataQuality ?? observation?.quality;
      const valid = observation?.found && Number.isFinite(observation.data) && Number.isFinite(observation.clock) &&
        Number.isFinite(clockQuality) && clockQuality >= core.CONFIDENCE && Math.abs(observation.clock) >= MIN_SPAN;
      if (clockPeriod && time - lastGood > clockPeriod * 0.8) loseClock(events);
      if (!valid) return events;
      lastGood = time;
      // Intact clock fields preserve this bit's position even when its data fields yield an erasure.
      const sample = { time, data: observation.data, quality: Number.isFinite(dataQuality) ? core.clamp(dataQuality) : 0 };
      const clock = Number(observation.clock > 0);
      if (!run) { run = { clock, start: time, edgeLow: time, samples: [sample] }; return events; }
      if (clock === run.clock) {
        pending = []; run.samples.push(sample);
        // A stopped clock must not keep an old block alive until a later retransmission.
        if (clockPeriod && time - run.start > clockPeriod * 1.65) loseClock(events, true);
        return events;
      }
      pending.push(sample);
      if (pending.length < 2) return events;
      const next = { clock, start: pending[0].time, edgeLow: run.samples.at(-1).time, samples: pending.slice() };
      commit(next.start, next.edgeLow, events);
      run = next; pending = [];
      return events;
    }
    function finish() {
      if (done) return [];
      done = true;
      return [{ type: 'error', code: candidates.length || assemblies.size ? 'incompleteFrame' : lastFailure || 'noPreamble' }];
    }
    function clear() { done = true; run = null; pending = []; history = []; candidates = []; assemblies.clear(); }
    return { push, finish, clear, get synchronized() { return candidates.length > 0; } };
  }
  return Object.freeze({ ...core, RECEIVE_SECONDS: 240, MAX_VIDEO_SECONDS: 120, PREAMBLE, MIN_SPAN, MAX_CANDIDATES,
    config, crc16, duration, transmission, createDecoder });
}));
