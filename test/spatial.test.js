'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../spatial-codec.js');

function receive(text, options = {}, disturbance = {}) {
  const cfg = S.config(options), tx = S.transmission(text, cfg), fps = disturbance.fps || 30;
  const frames = disturbance.frames ? disturbance.frames(tx) : tx.frames;
  const boundaries = [disturbance.offset ?? 0.37];
  frames.forEach((frame, index) => boundaries.push(boundaries.at(-1) + cfg.period * (disturbance.hold?.(index) ?? 1)));
  // Receive configuration deliberately need not equal the sender's rate.
  const decoder = S.createDecoder(S.config({ rate: disturbance.receiveRate || 2 })), events = [];
  let index = -1;
  for (let n = 0; n / fps < boundaries.at(-1) + 0.25; n++) {
    const time = n / fps;
    while (index + 1 < frames.length && time >= boundaries[index + 1]) index++;
    if (disturbance.drop?.(time, index, n)) continue;
    const frame = time < boundaries.at(-1) ? frames[index] : null;
    let observation = frame ? { found: true, data: 2 * frame.bit - 1, clock: 2 * frame.clock - 1, quality: 1 } :
      { found: false, data: 0, clock: 0, quality: 0 };
    observation = disturbance.observation?.(observation, time, index, n, tx) ?? observation;
    events.push(...decoder.push(time, observation));
  }
  events.push(...decoder.finish());
  return { tx, events, result: events.find(event => event.type === 'result') };
}
function change(frame, bit) { return { ...frame, bit, values: [bit, 1 - bit, frame.clock, 1 - frame.clock] }; }
function appendFrames(...groups) {
  return groups.flat().map((frame, index) => ({ ...frame, index, clock: index & 1,
    values: [frame.bit, 1 - frame.bit, index & 1, 1 - (index & 1)] }));
}
function replaceBody(packet, blockIndex, bytes) {
  const block = packet.blocks[blockIndex], coded = S.rsEncode(bytes);
  const bits = coded.flatMap(value => Array.from({ length: 8 }, (_, bit) => (value >> (7 - bit)) & 1));
  return packet.frames.map((frame, index) => index >= block.start + 32 && index < block.end ?
    change(frame, bits[index - block.start - 32]) : frame);
}
const failure = trial => JSON.stringify(trial.events.filter(event => !['symbol', 'text'].includes(event.type)));

test('V3 independent CRC16-CCITT-FALSE vectors and byte validation', () => {
  assert.equal(S.crc16([]), 0xffff);
  assert.equal(S.crc16(Array.from(Buffer.from('123456789'))), 0x29b1);
  assert.equal(S.crc16([0]), 0xe1f0);
  assert.throws(() => S.crc16([-1]), /invalidByte/);
  assert.throws(() => S.crc16([256]), /invalidByte/);
});

test('V3 one serial bit, two complementary pairs, constant panel mean and finite guarded durations', () => {
  const cfg = S.config();
  assert.equal(cfg.protocol, 3); assert.equal(cfg.mode, 'mono'); assert.equal(cfg.rate, 2);
  assert.equal(cfg.spatial, true); assert.equal(cfg.bits, 1); assert.equal(cfg.levels, 2);
  assert.equal(S.RECEIVE_SECONDS, 240); assert.equal(S.MAX_VIDEO_SECONDS, 120);
  for (const mode of ['color', 'bicolor']) assert.throws(() => S.config({ mode }), /invalidSettings/);
  assert.throws(() => S.config({ levels: 4 }), /invalidSettings/);
  assert.throws(() => S.duration(9), /tooLong/);
  assert.throws(() => S.transmission('123456789'), /tooLong/);
  for (const text of ['', 'A', 'LIGHT', '12345678']) {
    const tx = S.transmission(text);
    assert.equal(tx.seconds, S.duration(S.bytesOf(text).length));
    assert.equal(tx.frames.at(-1).kind, 'guard'); assert.equal(tx.frames.at(-2).kind, 'guard');
    tx.frames.forEach((frame, index) => {
      assert.deepEqual(frame.values, [frame.bit, 1 - frame.bit, frame.clock, 1 - frame.clock]);
      assert.equal(frame.values.reduce((sum, value) => sum + value, 0), 2);
      assert.equal(frame.clock, index & 1);
    });
    const frozen = S.createDecoder();
    for (let n = 0; n < 3000; n++) assert.ok(!frozen.push(n / 30, {
      found: true, data: 1, clock: -1, quality: 1
    }).some(event => event.type === 'result'));
    assert.equal(frozen.finish()[0].type, 'error');
  }
  assert.equal(S.duration(1), 41); assert.equal(S.duration(5), 93); assert.equal(S.duration(8), 105);
});

test('V3 clean UTF-8 round trips at all rates, sample phases and independently configured receive rates', () => {
  for (const text of ['', 'A', 'AB', 'ABC', 'ABCD', 'LIGHT', 'ABCDEF', 'ABCDEFG', '12345678', '日本', '🔦', '\0'.repeat(8)]) {
    for (const rate of [2, 4, 8]) for (const offset of [0.13, 0.37, 0.531]) {
      const trial = receive(text, { rate }, { offset, receiveRate: rate === 2 ? 8 : 2 });
      assert.equal(trial.result?.valid, true, `${text}/${rate}/${offset}: ${failure(trial)}`);
      assert.equal(trial.result.text, text);
      assert.equal(trial.result.crcOk, true); assert.equal(trial.result.endOk, true);
      assert.equal(trial.result.blocks, Math.max(1, Math.ceil(S.bytesOf(text).length / 4)));
    }
  }
});

test('V3 spatial differences remove common gain/background and tolerate variable per-step holds', () => {
  for (const rate of [2, 4, 8]) {
    const trial = receive('LIGHT', { rate }, {
      hold: index => index % 2 ? 1.24 : 0.76,
      observation: (observation, time) => {
        if (!observation.found) return observation;
        const gain = 0.45 - Math.min(time, 40) * 0.004, background = 0.25 + 0.1 * Math.sin(time * 0.3);
        const pair = bit => [background + gain * (bit > 0 ? 0.32 : 0.18), background + gain * (bit > 0 ? 0.18 : 0.32)];
        const data = pair(observation.data), clock = pair(observation.clock), span = gain * (0.32 - 0.18);
        return { ...observation, data: (data[0] - data[1]) / span, clock: (clock[0] - clock[1]) / span };
      }
    });
    assert.equal(trial.result?.text, 'LIGHT', `${rate}: ${failure(trial)}`);
  }
});

test('V3 sampled clock-edge intervals preserve a short observed run with two real frames', () => {
  const tx = S.transmission('LIGHT', S.config({ rate: 8 })), decoder = S.createDecoder(), events = [];
  for (const frame of tx.frames) {
    // Two dropped early frames make first-frame spacing 61 ms, below half of a 125 ms step.
    // The surrounding old/new observations still bracket both true edges of the complete 125 ms step.
    const offsets = frame.index === 50 ? [0.065, 0.095] : frame.index === 51 ? [0.001, 0.04, 0.08, 0.11] :
      [0.005, 0.037, 0.069, 0.101];
    for (const offset of offsets) events.push(...decoder.push(0.37 + frame.index * 0.125 + offset, {
      found: true, data: 2 * frame.bit - 1, clock: 2 * frame.clock - 1, quality: 1
    }));
  }
  assert.equal(events.find(event => event.type === 'result')?.text, 'LIGHT');
  assert.equal(events.filter(event => event.type === 'resync').length, 0);
  const short = events.find(event => event.type === 'symbol' && event.samples === 2);
  assert.ok(short.periodLow < 0.125 && short.periodHigh >= 0.125);
});

test('V3 edge uncertainty does not invent missed clock counts or permit a clearly excessive hold', () => {
  for (const offset of [0.13, 0.37, 0.531]) {
    assert.equal(receive('LIGHT', { rate: 8 }, { fps: 16, offset }).result?.text, 'LIGHT');
    for (const index of [32, 40, 48, 56]) {
      const trial = receive('LIGHT', { rate: 8 }, { offset, hold: i => i === index ? 3 : 1 });
      assert.equal(trial.result, undefined);
      assert.ok(trial.events.some(event => event.type === 'resync' && event.code === 'clockLost'));
    }
  }
});

test('V3 robust run median rejects one data/clock outlier without an unprotected end marker', () => {
  for (const rate of [2, 4, 8]) {
    const seen = new Set();
    const trial = receive('A', { rate }, {
      observation: (observation, time, index, n, tx) => {
        const target = tx.blocks[0].end - 1;
        if (index !== target || seen.has(index)) return observation;
        seen.add(index);
        return { ...observation, data: -observation.data, clock: -observation.clock };
      }
    });
    assert.equal(trial.result?.text, 'A', `${rate}: ${failure(trial)}`);
  }
});

test('V3 one wrong payload byte and two known byte erasures are corrected, three erasures abort early', () => {
  const wrong = receive('A', {}, {
    frames: tx => tx.frames.map((frame, index) => index >= 48 && index < 56 ? change(frame, 1 - frame.bit) : frame)
  });
  assert.equal(wrong.result?.text, 'A', failure(wrong)); assert.equal(wrong.result.correctedBytes, 1);
  const erased = receive('A', {}, {
    observation: (observation, time, index) => [48, 56].includes(index) ? { ...observation, data: 0 } : observation
  });
  assert.equal(erased.result?.text, 'A', failure(erased)); assert.equal(erased.result.correctedBytes, 2);
  const exceeded = receive('12345678', {}, {
    observation: (observation, time, index) => [32, 40, 48].includes(index) ? { ...observation, data: 0 } : observation
  });
  assert.equal(exceeded.result, undefined);
  assert.ok(exceeded.events.some(event => event.type === 'resync' && event.code === 'tooManyErasures'));
  const firstAbort = exceeded.events.findIndex(event => event.type === 'resync' && event.code === 'tooManyErasures');
  assert.ok(exceeded.events.slice(0, firstAbort).filter(event => event.type === 'symbol').length <= 33);
});

test('V3 data quality cannot erase an intact clock, and strong data cannot replace a lost clock', () => {
  for (const rate of [2, 4, 8]) {
    const erased = receive('A', { rate }, {
      observation: (observation, time, index) => [48, 56].includes(index) ?
        { ...observation, data: 0, quality: 0, dataQuality: 0, clockQuality: 1 } : observation
    });
    assert.equal(erased.result?.text, 'A', `${rate}: ${failure(erased)}`);
    assert.equal(erased.result.correctedBytes, 2);
    assert.equal(erased.events.filter(event => event.type === 'resync').length, 0);
    const lostClock = receive('A', { rate }, {
      observation: (observation, time, index) => index === 48 ?
        { ...observation, clock: 0, quality: 0, dataQuality: 1, clockQuality: 0 } : observation
    });
    assert.equal(lostClock.result, undefined);
    assert.ok(lostClock.events.some(event => event.type === 'resync' && event.code === 'clockLost'));
  }
});

test('V3 a missing clock step is not guessed; a clean later transmission is recognized', () => {
  const first = S.transmission('12345678'), second = S.transmission('A');
  const frames = appendFrames(first.frames.slice(0, 60), second.frames);
  const trial = receive('A', {}, {
    frames: () => frames,
    drop: (time, index) => index === 40
  });
  assert.equal(trial.result?.text, 'A', failure(trial));
  assert.ok(trial.events.some(event => event.type === 'resync' && event.code === 'clockLost'));
});

test('V3 continuous preamble recognition does not wait for an unfinished old block', () => {
  const first = S.transmission('12345678'), second = S.transmission('A');
  const trial = receive('A', {}, { frames: () => appendFrames(first.frames.slice(0, 37), second.frames) });
  assert.equal(trial.result?.text, 'A', failure(trial));
  assert.ok(trial.events.filter(event => event.type === 'sync').length >= 2);
});

test('V3 sender rate changes between retries reacquire the complete new preamble', () => {
  const first = S.transmission('12345678'), second = S.transmission('A');
  const frames = appendFrames(first.frames.slice(0, 40), second.frames);
  for (const [before, after] of [[0.25, 1], [1, 0.25]]) {
    const trial = receive('A', {}, { frames: () => frames, hold: index => index < 40 ? before : after });
    assert.equal(trial.result?.text, 'A', failure(trial));
    assert.ok(trial.events.some(event => event.type === 'resync' && event.code === 'clockLost'));
  }
});

test('V3 payload preambles, including a valid protected false header, do not evict the real block', () => {
  for (const text of ['-LP', '51m' + '\0'.repeat(5)]) {
    const trial = receive(text);
    assert.equal(trial.result?.text, text, failure(trial));
    const wire = trial.tx.frames.map(frame => frame.bit).join('');
    assert.ok(wire.split(S.PREAMBLE.join('')).length - 1 > trial.tx.blocks.length);
    if (text === '-LP') {
      assert.equal(trial.events.filter(event => event.type === 'sync').length, 1);
      assert.equal(trial.events.filter(event => event.type === 'resync').length, 0);
    } else assert.ok(trial.events.filter(event => event.type === 'sync').length > trial.tx.blocks.length);
  }
});

test('V3 invalid protected headers recover on a subsequent start without deleting its history', () => {
  const first = S.transmission('12345678'), second = S.transmission('A');
  const damaged = first.frames.slice(0, 40).map((frame, index) => [16, 17].includes(index) ? change(frame, 1 - frame.bit) : frame);
  const trial = receive('A', {}, { frames: () => appendFrames(damaged, second.frames) });
  assert.equal(trial.result?.text, 'A', failure(trial));
  assert.ok(trial.events.some(event => event.type === 'resync' && event.code === 'invalidLength'));
});

test('V3 valid RS parity cannot bypass block CRC, whole-message CRC or strict UTF-8', () => {
  const tx = S.transmission('A'), bytes = tx.blocks[0].data.slice();
  bytes[bytes.length - 1] ^= 1;
  const blockCrc = receive('A', {}, { frames: () => replaceBody(tx, 0, bytes) });
  assert.equal(blockCrc.result, undefined);
  assert.ok(blockCrc.events.some(event => event.type === 'rejected' && !event.crcOk));
  const incorrectIdentity = tx.blocks[0].data.slice();
  incorrectIdentity[0] ^= 1;
  incorrectIdentity[incorrectIdentity.length - 1] = S.crc8([tx.blocks[0].header, ...incorrectIdentity.slice(0, -1)]);
  const messageCrc = receive('A', {}, { frames: () => replaceBody(tx, 0, incorrectIdentity) });
  assert.equal(messageCrc.result, undefined);
  assert.ok(messageCrc.events.some(event => event.type === 'rejected' && !event.crcOk));
  const identity = S.crc16([1, 255]), invalidUtf8 = [identity >> 8, identity & 255, 255];
  invalidUtf8.push(S.crc8([tx.blocks[0].header, ...invalidUtf8]));
  const encoding = receive('A', {}, { frames: () => replaceBody(tx, 0, invalidUtf8) });
  assert.equal(encoding.result, undefined);
  assert.ok(encoding.events.some(event => event.type === 'rejected' && event.crcOk && !event.utf8Ok));
});

test('V3 independently protected blocks reassemble across retries, duplicates, order and message identities', () => {
  const tx = S.transmission('LIGHT'), other = S.transmission('OTHER'), a = tx.blocks[0], b = tx.blocks[1];
  const part = (packet, block) => packet.frames.slice(block.start, block.end);
  const cases = [
    appendFrames(part(tx, b), part(tx, a), tx.frames.slice(-2)),
    appendFrames(part(tx, a), part(tx, a), part(tx, b), tx.frames.slice(-2)),
    appendFrames(part(other, other.blocks[0]), part(tx, b), part(tx, a), tx.frames.slice(-2))
  ];
  for (const frames of cases) {
    const trial = receive('LIGHT', {}, { frames: () => frames });
    assert.equal(trial.result?.text, 'LIGHT', failure(trial));
  }
  const mixed = receive('LIGHT', {}, {
    frames: () => appendFrames(part(other, other.blocks[0]), part(tx, b), tx.frames.slice(-2))
  });
  assert.equal(mixed.result, undefined);
});

test('V3 conflicting chunks under the same advertised identity discard the partial assembly', () => {
  const tx = S.transmission('LIGHT'), bytes = tx.blocks[0].data.slice(), block = tx.blocks[0];
  bytes[2] ^= 1; bytes[bytes.length - 1] = S.crc8([block.header, ...bytes.slice(0, -1)]);
  const conflicting = replaceBody(tx, 0, bytes);
  const frames = appendFrames(tx.frames.slice(0, block.end), conflicting.slice(0, block.end),
    tx.frames.slice(tx.blocks[1].start));
  const trial = receive('LIGHT', {}, { frames: () => frames });
  assert.equal(trial.result, undefined);
  assert.ok(trial.events.some(event => event.type === 'rejected' && event.code === 'blockConflict'));
});

test('V3 insufficient fps, low quality, missing panels and silent input cannot create a valid message', () => {
  for (const disturbance of [
    { fps: 8 },
    { observation: observation => ({ ...observation, quality: 0.44 }) },
    { observation: observation => ({ ...observation, found: false }) },
    { observation: observation => ({ ...observation, data: 0.024 }) },
    { observation: observation => ({ ...observation, clock: 0.024 }) }
  ]) assert.equal(receive('A', { rate: 8 }, disturbance).result, undefined);
  const decoder = S.createDecoder();
  assert.deepEqual(decoder.push(0, null), []);
  assert.deepEqual(decoder.push(NaN, {}), []);
  assert.deepEqual(decoder.push(-1, {}), []);
  decoder.clear(); assert.deepEqual(decoder.finish(), []);
});
