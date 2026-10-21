'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Camera = require('../camera-io.js');
const Screen = require('../screen-tx.js');
const C = require('../codec-core.js');

test('Camera controls: exposure mode resolves before exposure time; WB is independent', async () => {
  const calls = [];
  let mode = 'continuous';
  const track = {
    getCapabilities: () => ({ exposureMode: ['manual'], exposureTime: { min: 10, max: 100 }, whiteBalanceMode: ['manual'] }),
    getSettings: () => ({ exposureTime: 40, exposureMode: mode, whiteBalanceMode: mode }),
    async applyConstraints(value) {
      calls.push(value.advanced[0]);
      if (value.advanced[0].exposureTime) assert.equal(mode, 'manual');
      await Promise.resolve();
      mode = 'manual';
    }
  };
  assert.deepEqual(await Camera.lockControls(track, { exposureMode: true, exposureTime: true, whiteBalanceMode: true }),
    { exposure: 'manual', whiteBalance: 'manual' });
  assert.deepEqual(calls, [{ exposureMode: 'manual' }, { exposureTime: 40 }, { whiteBalanceMode: 'manual' }]);
});
test('Unsupported, rejected and ignored manual controls remain usable', async () => {
  assert.deepEqual(await Camera.lockControls({}), { exposure: 'unsupported', whiteBalance: 'unsupported' });
  const track = { getCapabilities: () => ({ exposureMode: ['manual'] }), getSettings: () => ({}),
    applyConstraints: async () => { throw new Error('unsupported'); } };
  assert.equal((await Camera.lockControls(track, { exposureMode: true })).exposure, 'failed');
  track.applyConstraints = async () => {};
  assert.equal((await Camera.lockControls(track, { exposureMode: true })).exposure, 'requested');
});
test('Measurement rectangle stays inside the image with nonzero area', () => {
  assert.deepEqual(Camera.region(), { x: 0.3, y: 0.3, w: 0.4, h: 0.4 });
  const rect = Camera.region({ x: 2, y: -3, w: 2, h: 0 });
  assert.ok(rect.x + rect.w <= 1 && rect.y + rect.h <= 1 && rect.h >= 0.1);
});

function fixture() {
  const events = new EventTarget();
  const drawn = [];
  const context = { fillStyle: '', fillRect() { drawn.push(this.fillStyle); }, clearRect() {}, drawImage() {} };
  const canvas = { width: 320, height: 180, getContext: () => context };
  let tick, timeout, pendingResolve;
  const host = { document: Object.assign(events, { hidden: false }), performance: { now: () => 0 },
    requestAnimationFrame(fn) { tick = fn; return 1; }, cancelAnimationFrame() { tick = null; },
    setTimeout(fn) { timeout = fn; return 2; }, clearTimeout() { timeout = null; },
    setInterval() { return 3; }, clearInterval() {}, URL: { revokeObjectURL() {} },
    navigator: { mediaDevices: { getUserMedia: () => new Promise(resolve => { pendingResolve = resolve; }) } } };
  const video = Object.assign(new EventTarget(), { pause() {}, load() {}, removeAttribute() {}, srcObject: null });
  return { canvas, host, video, drawn, tick: time => tick?.(time), timeout: () => timeout?.(),
    resolve: value => pendingResolve(value) };
}
test('A permission result arriving after Stop has every track stopped', async () => {
  const f = fixture();
  const camera = Camera.create(f.video, f.canvas, f.host);
  const pending = camera.start({ onFrame() {} });
  camera.stop();
  let stopped = 0;
  f.resolve({ getTracks: () => [{ stop() { stopped++; } }] });
  await assert.rejects(pending, /cancelled/);
  assert.equal(stopped, 1);
  assert.equal(camera.active, false);
});
test('Transmission uses the exact core sequence, stops once and removes flashing on hide', () => {
  const f = fixture();
  const screen = Screen.create(f.canvas, f.host);
  const frames = [], stops = [];
  const tx = C.transmission('A');
  screen.start('A', C.config(), event => frames.push(event.srgb), reason => stops.push(reason));
  for (let i = 1; i <= tx.frames.length; i++) f.tick(i * 500);
  assert.deepEqual(frames, tx.frames.map(frame => frame.srgb));
  assert.deepEqual(stops, ['sent']);
  assert.equal(screen.active, false);
  screen.start('A', C.config(), () => {}, reason => stops.push(reason));
  f.host.document.hidden = true;
  f.host.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(screen.active, false);
  assert.equal(stops.at(-1), 'hidden');
  assert.equal(f.drawn.at(-1), 'rgb(128,128,128)');
});
test('A blocked display scheduler cannot skip symbols silently', () => {
  const f = fixture(), stops = [];
  const screen = Screen.create(f.canvas, f.host);
  screen.start('A', C.config(), () => {}, reason => stops.push(reason));
  f.tick(1100);
  assert.deepEqual(stops, ['displayStalled']);
});
test('Both IO paths have a hard timeout', () => {
  const f = fixture(), stops = [];
  const screen = Screen.create(f.canvas, f.host);
  screen.start('A', C.config(), () => {}, reason => stops.push(reason));
  f.timeout();
  assert.equal(screen.active, false);
  assert.deepEqual(stops, ['timeout']);
});
