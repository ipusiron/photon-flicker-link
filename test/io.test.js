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

test('Camera inventory includes only video inputs and does not request permission', async () => {
  const f = fixture();
  f.host.navigator.mediaDevices.getUserMedia = () => { throw new Error('must not open'); };
  f.host.navigator.mediaDevices.enumerateDevices = async () => [
    { kind: 'audioinput', deviceId: 'mic', label: 'Microphone' },
    { kind: 'videoinput', deviceId: 'front', label: 'Front camera' },
    { kind: 'videoinput', deviceId: 'usb', label: '<USB camera>' }
  ];
  assert.deepEqual(await Camera.listCameras(f.host), [
    { deviceId: 'front', label: 'Front camera' }, { deviceId: 'usb', label: '<USB camera>' }
  ]);
  delete f.host.navigator.mediaDevices.enumerateDevices;
  await assert.rejects(Camera.listCameras(f.host), /deviceListUnavailable/);
});

function readyCameraFixture() {
  const f = fixture();
  Object.assign(f.video, { readyState: 2, videoWidth: 640, videoHeight: 480, currentTime: 0, play: async () => {} });
  f.canvas.getContext().getImageData = () => ({ data: new Uint8ClampedArray([128, 128, 128, 255]) });
  return f;
}

function mockStream(id) {
  const track = Object.assign(new EventTarget(), { label: id + ' camera', stopped: false,
    stop() { this.stopped = true; }, getSettings: () => ({ deviceId: id }) });
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}

test('Reception deadline, sampled frame count and restart are independent of packet attempts', async () => {
  const f = readyCameraFixture(), stops = [], frames = [];
  let now = 1000;
  f.host.performance.now = () => now;
  f.host.navigator.mediaDevices.getUserMedia = async () => mockStream('camera');
  const camera = Camera.create(f.video, f.canvas, f.host);
  await camera.start({ onFrame: frame => frames.push(frame), onStop: reason => stops.push(reason) });
  f.video.currentTime = 0.1; f.tick(0);
  now += 54000;
  f.video.currentTime = 54.1; f.tick(0);
  assert.equal(camera.info.remainingSeconds, 66);
  assert.equal(camera.info.frames, 2);
  assert.equal(frames.at(-1).stats.elapsedSeconds, 54);
  now += 66000; f.timeout();
  assert.deepEqual(stops, ['timeout']);
  assert.equal(camera.active, false);
  assert.equal(camera.info.remainingSeconds, 0);
  now += 30000;
  assert.equal(camera.info.elapsedSeconds, 120);
  await camera.start({ onFrame: frame => frames.push(frame) });
  assert.equal(camera.info.remainingSeconds, 120);
  assert.equal(camera.info.frames, 0);
  f.video.currentTime = 0.1; f.tick(0);
  assert.equal(camera.info.frames, 1);
  camera.stop();
});

test('Switching cameras releases the old track before requesting the exact new device', async () => {
  const f = readyCameraFixture(), first = mockStream('front'), second = mockStream('usb'), calls = [];
  f.host.navigator.mediaDevices.getUserMedia = async constraints => {
    calls.push(constraints);
    if (calls.length === 1) return first;
    assert.equal(first.track.stopped, true);
    return second;
  };
  const camera = Camera.create(f.video, f.canvas, f.host);
  await camera.start({ onFrame() {} });
  assert.deepEqual(calls[0].video.facingMode, { ideal: 'environment' });
  const info = await camera.start({ deviceId: 'usb', onFrame() {} });
  assert.deepEqual(calls[1].video.deviceId, { exact: 'usb' });
  assert.equal(calls[1].audio, false);
  assert.equal('facingMode' in calls[1].video, false);
  assert.equal(info.deviceId, 'usb');
  assert.equal(info.label, 'usb camera');
  camera.stop();
  assert.equal(second.track.stopped, true);
  assert.equal(f.video.srcObject, null);
});

test('A delayed old camera cannot replace a newly selected camera', async () => {
  const f = readyCameraFixture(), old = mockStream('front'), current = mockStream('usb');
  let resolveOld;
  f.host.navigator.mediaDevices.getUserMedia = ({ video }) => video.deviceId.exact === 'front' ?
    new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(current);
  const camera = Camera.create(f.video, f.canvas, f.host);
  const pending = camera.start({ deviceId: 'front', onFrame() {} });
  await camera.start({ deviceId: 'usb', onFrame() {} });
  resolveOld(old);
  await assert.rejects(pending, /cancelled/);
  assert.equal(old.track.stopped, true);
  assert.equal(current.track.stopped, false);
  assert.equal(camera.info.deviceId, 'usb');
  assert.equal(f.video.srcObject, current);
  camera.stop();
});

test('Missing, busy, denied and unavailable selected cameras have distinct error codes', () => {
  for (const [name, code] of [['NotAllowedError', 'permission'], ['NotFoundError', 'cameraNotFound'],
    ['NotReadableError', 'cameraInUse'], ['OverconstrainedError', 'cameraSelectionUnavailable']]) {
    assert.equal(Camera.errorCode({ name, message: 'browser detail' }), code);
  }
  assert.equal(Camera.errorCode(new Error('videoError')), 'videoError');
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

test('Three-second preparation keeps a still canvas, emits the full packet and can be cancelled', () => {
  const f = fixture(), frames = [], counts = [], stops = [];
  const screen = Screen.create(f.canvas, f.host), cfg = C.config();
  const preparation = { countdown: 3, onCountdown: value => counts.push(value) };
  screen.start('A', cfg, frame => frames.push(frame.index), reason => stops.push(reason), preparation);
  assert.deepEqual(counts, [3]);
  for (const time of [-3.54, 999, 1000, 1999, 2000, 2999]) f.tick(time);
  assert.deepEqual(counts, [3, 2, 1]);
  assert.equal(frames.length, 0);
  assert.ok(f.drawn.every(value => value === 'rgb(128,128,128)'));
  f.tick(3000);
  assert.deepEqual(counts, [3, 2, 1, 0]);
  const tx = C.transmission('A', cfg);
  for (let i = 1; i <= tx.frames.length; i++) f.tick(3000 + i * 500);
  assert.deepEqual(frames, tx.frames.map(frame => frame.index));
  assert.deepEqual(stops, ['sent']);
  screen.start('A', cfg, () => assert.fail('must not transmit after stop'), () => {}, preparation);
  screen.stop(); f.tick(3000);
  assert.equal(screen.active, false);
  screen.start('A', cfg, () => assert.fail('must not transmit while hidden'), reason => stops.push(reason), preparation);
  f.host.document.hidden = true; f.host.document.dispatchEvent(new Event('visibilitychange'));
  f.tick(3000);
  assert.equal(stops.at(-1), 'hidden');
});
test('A first animation timestamp before Start keeps symbol zero and still completes', () => {
  const f = fixture(), frames = [], stops = [];
  const screen = Screen.create(f.canvas, f.host);
  const tx = C.transmission('LIGHT');
  screen.start('LIGHT', C.config(), frame => frames.push(frame.srgb), reason => stops.push(reason));
  f.tick(-3.54);
  f.tick(0);
  f.tick(499);
  assert.equal(frames.length, 1);
  assert.equal(screen.active, true);
  for (let i = 1; i <= tx.frames.length; i++) f.tick(i * 500);
  assert.deepEqual(frames, tx.frames.map(frame => frame.srgb));
  assert.deepEqual(stops, ['sent']);
  assert.equal(screen.active, false);
  assert.equal(f.drawn.at(-1), 'rgb(128,128,128)');
});
test('Both IO paths have a hard timeout', () => {
  const f = fixture(), stops = [];
  const screen = Screen.create(f.canvas, f.host);
  screen.start('A', C.config(), () => {}, reason => stops.push(reason));
  f.timeout();
  assert.equal(screen.active, false);
  assert.deepEqual(stops, ['timeout']);
});
test('rAF pulls hidden video before checking frame progress and suppresses duplicate frames', async () => {
  const f = fixture(), frames = [];
  let presented = 0, available = 1;
  const ctx = f.canvas.getContext();
  ctx.drawImage = () => { presented = available; };
  ctx.getImageData = () => ({ data: new Uint8ClampedArray([118, 118, 118, 255]) });
  Object.assign(f.video, { readyState: 2, videoWidth: 160, videoHeight: 120, currentTime: 0,
    duration: 10, play: async () => {}, getVideoPlaybackQuality: () => ({ totalVideoFrames: presented }) });
  f.host.URL.createObjectURL = () => 'blob:test';
  const camera = Camera.create(f.video, f.canvas, f.host);
  await camera.start({ file: { size: 10 }, onFrame: frame => frames.push(frame) });
  for (const [time, frame] of [[0.01, 1], [0.03, 1], [0.043, 2], [0.06, 2], [0.076, 3]]) {
    f.video.currentTime = time;
    available = frame;
    f.tick(time * 1000);
  }
  assert.deepEqual(frames.map(frame => frame.time), [0.01, 0.043, 0.076]);
  assert.ok(Math.abs(camera.info.fps - 30.303) < 0.001);
  camera.stop();
});
test('Playback rejection settles the pending load without an unhandled rejection', async () => {
  const f = fixture();
  f.host.URL.createObjectURL = () => 'blob:test';
  f.video.play = async () => { throw new Error('playDenied'); };
  const camera = Camera.create(f.video, f.canvas, f.host);
  await assert.rejects(camera.start({ file: { size: 10 }, onFrame() {} }), /playDenied/);
  assert.equal(camera.active, false);
  await new Promise(resolve => setImmediate(resolve));
});
