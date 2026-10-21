'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../spatial-codec.js'), P = require('../optical-panel.js');

// Render the production transmitter through a byte raster and a separate camera model.
// The camera sees the panel at half size in a larger, illuminated background.
function cameraImage(frame, gain, background, obscured = '') {
  const width = 640, height = 480, raw = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < raw.length; i += 4) {
    raw.set([170, 170, 170, 255], i);
  }
  const ctx = { fillStyle: '', fillRect(x, y, w, h) {
    const channels = this.fillStyle.match(/\d+/g).map(Number);
    for (let row = Math.floor(y / 2 + 160); row < Math.ceil((y + h) / 2 + 160); row++) {
      for (let col = Math.floor(x / 2 + 144); col < Math.ceil((x + w) / 2 + 144); col++) {
        const gradient = 0.03 * col / width;
        const pixel = channels.map((value, c) => S.linearToSrgb(
          S.srgbToLinear(value) * gain + background + gradient + 0.0002 * Math.sin(row * 17 + col * 3 + c)));
        raw.set([...pixel, 255], (row * width + col) * 4);
      }
    }
  } };
  P.draw(ctx, 640, 240, frame, S.config());
  if (obscured) {
    const gray = S.linearToSrgb(0.25);
    ctx.fillStyle = `rgb(${gray}, ${gray}, ${gray})`;
    const fields = obscured === 'data' ? [32, 180] : [328, 476];
    fields.forEach(x => ctx.fillRect(x, 32, 132, 176));
  }
  return { width, height, data: raw };
}

test('V3 image-to-message pipeline tolerates the former background-dilution failure with changing exposure', () => {
  const observed = new Map();
  for (let phase = 0; phase < 5; phase++) for (const bit of [0, 1]) for (const clock of [0, 1]) {
    const gain = 0.20 + phase * 0.08, background = 0.24 - phase * 0.025;
    const measurement = P.read(cameraImage({ bit, clock }, gain, background));
    assert.equal(measurement.found, true);
    assert.ok(measurement.quality >= S.CONFIDENCE);
    observed.set(`${phase}/${bit}/${clock}`, measurement);
  }
  for (const rate of [2, 4, 8]) {
    const tx = S.transmission('LIGHT', S.config({ rate })), decoder = S.createDecoder(), events = [];
    for (let n = 0; n / 30 < tx.seconds + 0.8; n++) {
      const time = n / 30, index = Math.floor((time - 0.37) * rate), frame = tx.frames[index];
      const phase = Math.floor(time / 2) % 5;
      const observation = frame ? observed.get(`${phase}/${frame.bit}/${frame.clock}`) :
        { found: false, data: 0, clock: 0, quality: 0 };
      events.push(...decoder.push(time, observation));
    }
    const result = events.find(event => event.type === 'result');
    assert.equal(result?.text, 'LIGHT', `${rate} symbol/s: ${JSON.stringify(events.filter(e => e.type === 'resync'))}`);
    assert.equal(result.crcOk, true);
    assert.equal(result.utf8Ok, true);
    assert.equal(result.blocks, 2);
  }
});

test('V3 actual images recover one or two data-byte erasures without discarding the separately visible clock', () => {
  const observations = new Map();
  for (const obscured of ['', 'data', 'clock']) for (const bit of [0, 1]) for (const clock of [0, 1]) {
    const measured = P.read(cameraImage({ bit, clock }, 0.45, 0.12, obscured));
    assert.equal(measured.found, true);
    if (obscured === 'data') {
      assert.equal(measured.dataQuality, 0);
      assert.ok(measured.clockQuality >= S.CONFIDENCE);
      assert.equal(measured.quality, 0);
    } else if (obscured === 'clock') {
      assert.equal(measured.clockQuality, 0);
      assert.ok(measured.dataQuality >= S.CONFIDENCE);
    }
    observations.set(`${obscured}/${bit}/${clock}`, measured);
  }
  for (const rate of [2, 4, 8]) for (const erasedCount of [1, 2, 3]) {
    const tx = S.transmission('A', S.config({ rate })), decoder = S.createDecoder(), events = [];
    const erasedBits = [32, 40, 48].slice(0, erasedCount);
    for (let n = 0; n / 30 < tx.seconds + 0.8; n++) {
      const time = n / 30, index = Math.floor((time - 0.37) * rate), frame = tx.frames[index];
      const obscured = erasedBits.includes(index) ? 'data' : '';
      const observation = frame ? observations.get(`${obscured}/${frame.bit}/${frame.clock}`) :
        { found: false, data: 0, clock: 0, quality: 0 };
      events.push(...decoder.push(time, observation));
    }
    events.push(...decoder.finish());
    const result = events.find(event => event.type === 'result');
    if (erasedCount <= 2) {
      assert.equal(result?.text, 'A', `${rate} symbol/s, ${erasedCount} erased bytes`);
      assert.equal(result.crcOk, true);
      assert.equal(result.correctedBytes, erasedCount);
      assert.equal(events.filter(event => event.type === 'resync').length, 0);
    } else {
      assert.equal(result, undefined);
      const abort = events.findIndex(event => event.type === 'resync' && event.code === 'tooManyErasures');
      assert.ok(abort >= 0);
      assert.ok(events.slice(0, abort).filter(event => event.type === 'symbol').length <= 33);
    }
  }
  const tx = S.transmission('A'), decoder = S.createDecoder(), events = [];
  for (let n = 0; n < tx.seconds * 30; n++) {
    const frame = tx.frames[Math.floor(n / 15)], obscured = frame.index === 48 ? 'clock' : '';
    events.push(...decoder.push(n / 30, observations.get(`${obscured}/${frame.bit}/${frame.clock}`)));
  }
  assert.ok(events.some(event => event.type === 'resync' && event.code === 'clockLost'));
  assert.ok(!events.some(event => event.type === 'result'));
});
