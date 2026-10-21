'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Camera = require('../camera-io.js');
const Screen = require('../screen-tx.js');
const C = require('../codec-core.js');
const Spatial = require('../spatial-codec.js');
const Panel = require('../optical-panel.js');

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
  const track = { getCapabilities: () => ({ exposureMode: ['manual'], exposureTime: { min: 10, max: 100 } }),
    getSettings: () => ({ exposureTime: 40 }),
    applyConstraints: async () => { throw new Error('unsupported'); } };
  assert.equal((await Camera.lockControls(track, { exposureMode: true, exposureTime: true })).exposure, 'failed');
  track.applyConstraints = async () => {};
  assert.equal((await Camera.lockControls(track, { exposureMode: true, exposureTime: true })).exposure, 'requested');
});
test('Unknown or invalid current exposure never selects an arbitrary manual exposure', async () => {
  for (const exposureTime of [undefined, NaN, 0, 101]) {
    const track = { getCapabilities: () => ({ exposureMode: ['manual'], exposureTime: { min: 10, max: 100 } }),
      getSettings: () => ({ exposureMode: 'continuous', exposureTime }),
      applyConstraints: async () => assert.fail('must preserve automatic exposure') };
    assert.equal((await Camera.lockControls(track, { exposureMode: true, exposureTime: true })).exposure, 'auto');
  }
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
  let tick, timeout, pendingResolve, timeoutMs, clock = 0;
  const host = { document: Object.assign(events, { hidden: false }), performance: { now: () => clock },
    requestAnimationFrame(fn) { tick = fn; return 1; }, cancelAnimationFrame() { tick = null; },
    setTimeout(fn, ms) { timeout = fn; timeoutMs = ms; return 2; }, clearTimeout() { timeout = null; },
    setInterval() { return 3; }, clearInterval() {}, URL: { revokeObjectURL() {} },
    navigator: { mediaDevices: { getUserMedia: () => new Promise(resolve => { pendingResolve = resolve; }) } } };
  const video = Object.assign(new EventTarget(), { pause() {}, load() {}, removeAttribute() {}, srcObject: null });
  return { canvas, host, video, drawn, tick: (time, ...args) => { clock = Math.max(clock, time); tick?.(time, ...args); },
    timeout: () => timeout?.(),
    get timeoutMs() { return timeoutMs; },
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
  assert.equal(camera.info.remainingSeconds, 186);
  assert.equal(camera.info.frames, 2);
  assert.equal(frames.at(-1).stats.elapsedSeconds, 54);
  now += 186000; f.timeout();
  assert.deepEqual(stops, ['timeout']);
  assert.equal(camera.active, false);
  assert.equal(camera.info.remainingSeconds, 0);
  now += 30000;
  assert.equal(camera.info.elapsedSeconds, 240);
  await camera.start({ onFrame: frame => frames.push(frame) });
  assert.equal(camera.info.remainingSeconds, 240);
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

test('Opening has its own deadline and does not consume the live reception allowance', async () => {
  const f = readyCameraFixture(), stream = mockStream('camera');
  let now = 1000;
  f.host.performance.now = () => now;
  const camera = Camera.create(f.video, f.canvas, f.host);
  const pending = camera.start({ onFrame() {} });
  assert.equal(f.timeoutMs, 30000);
  now += 29000;
  f.resolve(stream);
  await pending;
  assert.equal(camera.info.remainingSeconds, 240);
  now += 1000;
  f.video.currentTime = 0.1; f.tick(0);
  assert.equal(f.timeoutMs, 240000);
  assert.equal(camera.info.elapsedSeconds, 0);
  now += 2000;
  assert.equal(camera.info.remainingSeconds, 238);
  camera.stop();
});

test('Opening timeout rejects a late camera without retaining any tracks', async () => {
  const f = readyCameraFixture(), stream = mockStream('late'), stops = [];
  const camera = Camera.create(f.video, f.canvas, f.host);
  const pending = camera.start({ onFrame() {}, onStop: reason => stops.push(reason) });
  f.timeout();
  assert.equal(camera.active, false);
  assert.deepEqual(stops, ['openingTimeout']);
  f.resolve(stream);
  await assert.rejects(pending, /cancelled/);
  assert.equal(stream.track.stopped, true);
});

test('Video files keep a 120 second playback deadline after their first frame', async () => {
  const f = readyCameraFixture();
  f.host.URL.createObjectURL = () => 'blob:test';
  f.video.duration = 10;
  const camera = Camera.create(f.video, f.canvas, f.host);
  await camera.start({ file: { size: 1 }, onFrame() {} });
  assert.equal(camera.info.remainingSeconds, 120);
  f.video.currentTime = 0.1; f.tick(0);
  assert.equal(f.timeoutMs, 120000);
  camera.stop();
});

test('Spatial capture preserves observed camera controls without a startup manual lock', async () => {
  const f = readyCameraFixture(), stream = mockStream('automatic');
  stream.track.getSettings = () => ({ exposureMode: 'continuous', whiteBalanceMode: 'manual' });
  stream.track.getCapabilities = () => ({ exposureMode: ['manual'], exposureTime: { min: 1, max: 100 } });
  stream.track.applyConstraints = async () => assert.fail('startup must leave capture controls unchanged');
  f.host.navigator.mediaDevices.getSupportedConstraints = () => ({ exposureMode: true, exposureTime: true });
  f.host.navigator.mediaDevices.getUserMedia = async () => stream;
  const camera = Camera.create(f.video, f.canvas, f.host);
  const info = await camera.start({ spatial: true, onFrame() {} });
  assert.equal(info.exposure, 'auto');
  assert.equal(info.whiteBalance, 'manual');
  camera.stop();
});

test('File rAF counts presented frames, excluding increased dropped-frame counters', async () => {
  const f = readyCameraFixture(), frames = [];
  f.host.URL.createObjectURL = () => 'blob:test'; f.video.duration = 10;
  let total = 1, dropped = 0;
  f.video.getVideoPlaybackQuality = () => ({ totalVideoFrames: total, droppedVideoFrames: dropped });
  const camera = Camera.create(f.video, f.canvas, f.host);
  await camera.start({ file: { size: 1 }, onFrame: value => frames.push(value) });
  for (const [time, nextTotal, nextDropped] of [[0.1, 1, 0], [0.2, 2, 1], [0.3, 3, 2], [0.4, 4, 2]]) {
    total = nextTotal; dropped = nextDropped;
    f.video.currentTime = time; f.tick(time * 1000);
  }
  assert.deepEqual(frames.map(value => value.time), [0.1, 0.4]);
  assert.equal(camera.info.droppedFrames, 2);
  camera.stop();
});

test('Live rAF uses decoded frames when hidden-video compositor drops increase', async () => {
  const f = readyCameraFixture(), frames = [];
  f.host.navigator.mediaDevices.getUserMedia = async () => mockStream('camera');
  let total = 1, dropped = 0;
  f.video.getVideoPlaybackQuality = () => ({ totalVideoFrames: total, droppedVideoFrames: dropped });
  const camera = Camera.create(f.video, f.canvas, f.host);
  await camera.start({ onFrame: value => frames.push(value) });
  for (const [time, nextTotal, decoded] of [[0.1, 1, 1], [0.2, 2, 2], [0.3, 3, 3], [0.4, 4, 3]]) {
    total = nextTotal; dropped = total - 1;
    f.video.webkitDecodedFrameCount = decoded;
    f.video.currentTime = time; f.tick(time * 1000);
  }
  assert.deepEqual(frames.map(value => value.time), [0.1, 0.2, 0.3]);
  assert.equal(camera.info.frameCounter, 'decodedFrames');
  assert.equal(camera.info.droppedFrames, 3);
  camera.stop();
});

test('File rAF ignores decoded frames buffered ahead of playback', async () => {
  const f = readyCameraFixture(), frames = [];
  f.host.URL.createObjectURL = () => 'blob:test'; f.video.duration = 10;
  let total = 1;
  f.video.getVideoPlaybackQuality = () => ({ totalVideoFrames: total, droppedVideoFrames: 0 });
  const camera = Camera.create(f.video, f.canvas, f.host);
  await camera.start({ file: { size: 1 }, onFrame: value => frames.push(value) });
  for (const [time, nextTotal, decoded] of [[0.1, 1, 20], [0.12, 1, 21], [0.14, 2, 22]]) {
    total = nextTotal; f.video.webkitDecodedFrameCount = decoded;
    f.video.currentTime = time; f.tick(time * 1000);
  }
  assert.deepEqual(frames.map(value => value.time), [0.1, 0.14]);
  assert.equal(camera.info.frameCounter, 'playbackQuality');
  camera.stop();
});

function rvfcFixture() {
  const f = readyCameraFixture();
  f.host.HTMLVideoElement = function () {};
  f.host.HTMLVideoElement.prototype.requestVideoFrameCallback = () => {};
  f.video.requestVideoFrameCallback = f.host.requestAnimationFrame;
  f.video.cancelVideoFrameCallback = f.host.cancelAnimationFrame;
  f.host.navigator.mediaDevices.getUserMedia = async () => mockStream('camera');
  return f;
}

test('Live rVFC recovers a frozen mediaTime using advancing frames and one anchored clock', async () => {
  for (const alternate of ['captureTime', 'presentationTime']) {
    const f = rvfcFixture(), frames = [];
    const camera = Camera.create(f.video, f.canvas, f.host);
    await camera.start({ onFrame: value => frames.push(value) });
    for (let i = 0; i < 5; i++) {
      f.tick(0, { mediaTime: i > 2 ? 100 + i / 30 : 0, presentedFrames: i + 1, [alternate]: 500000 + i * 1000 / 30 });
    }
    assert.equal(frames.length, 5);
    frames.forEach((frame, i) => assert.ok(Math.abs(frame.time - i / 30) < 1e-9));
    assert.equal(camera.info.timeSource, alternate);
    f.tick(0, { mediaTime: 101, presentedFrames: 5, [alternate]: 500200 });
    assert.equal(frames.length, 5, 'repeated presentedFrames cannot create another sample');
    camera.stop();
  }
});

test('File rVFC never substitutes callback time for paused media progress', async () => {
  const f = rvfcFixture(), frames = [];
  f.host.URL.createObjectURL = () => 'blob:test'; f.video.duration = 10;
  const camera = Camera.create(f.video, f.canvas, f.host);
  await camera.start({ file: { size: 1 }, onFrame: value => frames.push(value) });
  for (let i = 0; i < 4; i++) f.tick(0, { mediaTime: 0, presentedFrames: i + 1, presentationTime: 1000 + i * 33 });
  assert.equal(frames.length, 1);
  assert.equal(camera.info.timeSource, 'mediaTime');
  camera.stop();
});

test('Spatial transmitter aborts a 120 ms delay instead of reporting an invalid packet sent', () => {
  const f = fixture(), stops = [], frames = [];
  const screen = Screen.create(f.canvas, f.host), cfg = Spatial.config();
  screen.start('A', cfg, frame => frames.push(frame), reason => stops.push(reason));
  f.tick(620);
  assert.deepEqual(stops, ['displayStalled']);
  assert.equal(frames.length, 1);
  assert.equal(screen.info.maxHeldSeconds, 0.62);
  assert.equal(screen.active, false);
});

test('Spatial initial panel is detectable and stays unchanged through preparation, stop and hide', () => {
  const f = fixture(), frames = [], counts = [], stops = [];
  f.canvas.width = 640; f.canvas.height = 320;
  const width = f.canvas.width, height = f.canvas.height, data = new Uint8ClampedArray(width * height * 4);
  f.canvas.getContext().fillRect = function (x, y, w, h) {
    const value = Number(this.fillStyle.match(/\d+/)[0]);
    for (let row = Math.floor(y); row < Math.ceil(y + h); row++) for (let col = Math.floor(x); col < Math.ceil(x + w); col++) {
      data.set([value, value, value, 255], (row * width + col) * 4);
    }
  };
  const screen = Screen.create(f.canvas, f.host, { spatial: true });
  const image = { width, height, data }, initial = data.slice(), idle = Panel.read(image);
  assert.equal(idle.found, true, 'a new page must allow locating the panel before Send');
  assert.equal(idle.dataQuality, 0);
  assert.equal(idle.clockQuality, 0);
  assert.equal(screen.active, false);
  const preparation = { countdown: 3, onCountdown: value => counts.push(value) };
  screen.start('A', Spatial.config(), frame => frames.push(frame), reason => stops.push(reason), preparation);
  for (const time of [0, 999, 1000, 1999, 2000, 2999]) {
    f.tick(time);
    assert.deepEqual(data, initial, 'countdown must preserve the complete static locator');
  }
  assert.deepEqual(counts, [3, 2, 1]);
  assert.equal(frames.length, 0);
  f.tick(3000);
  assert.deepEqual(counts, [3, 2, 1, 0]);
  assert.equal(frames.length, 1);
  const transmitting = Panel.read(image);
  assert.equal(transmitting.found, true);
  assert.ok(transmitting.dataQuality >= Spatial.CONFIDENCE);
  assert.ok(transmitting.clockQuality >= Spatial.CONFIDENCE);
  screen.stop();
  assert.deepEqual(data, initial);
  screen.start('A', Spatial.config(), frame => frames.push(frame), reason => stops.push(reason), preparation);
  f.host.document.hidden = true;
  f.host.document.dispatchEvent(new Event('visibilitychange'));
  f.tick(6000);
  assert.equal(frames.length, 1, 'hiding during preparation must not begin transmission');
  assert.equal(stops.at(-1), 'hidden');
  assert.deepEqual(data, initial);
  f.host.document.hidden = false;
  screen.start('A', C.config(), () => assert.fail('legacy countdown must remain still'), () => {}, preparation);
  assert.ok(data.every((value, index) => value === (index % 4 === 3 ? 255 : 128)), 'explicit legacy mode keeps its gray idle');
  screen.stop();
});

test('Spatial hold validation uses actual callback time rather than a stale rAF timestamp', () => {
  const f = fixture(), stops = [];
  let actual = 0;
  f.host.performance.now = () => actual;
  const screen = Screen.create(f.canvas, f.host);
  screen.start('A', Spatial.config(), () => {}, reason => stops.push(reason));
  actual = 620;
  f.tick(500);
  assert.deepEqual(stops, ['displayStalled']);
  assert.equal(screen.info.lastHeldSeconds, 0.62);
});

test('Spatial transmitter records every hold and never shortens the next symbol to catch up', () => {
  const f = fixture(), stops = [], frames = [];
  const screen = Screen.create(f.canvas, f.host), cfg = Spatial.config(), tx = Spatial.transmission('A', cfg);
  screen.start('A', cfg, frame => frames.push(frame), reason => stops.push(reason));
  f.tick(550); f.tick(1000);
  assert.equal(frames.length, 2, 'second symbol is still held until 1050 ms');
  for (let i = 2; i <= tx.frames.length; i++) f.tick(50 + i * 500);
  assert.deepEqual(stops, ['sent']);
  assert.deepEqual(frames.map(frame => frame.bit), tx.frames.map(frame => frame.bit));
  assert.deepEqual(frames.map(frame => frame.clock), tx.frames.map(frame => frame.clock));
  assert.equal(frames[1].displayTime, 0.55);
  assert.equal(frames[1].previousHeldSeconds, 0.55);
  assert.equal(screen.info.holds, tx.frames.length, 'the last displayed symbol is measured too');
  assert.equal(screen.info.minHeldSeconds, 0.5);
  assert.equal(screen.info.maxHeldSeconds, 0.55);
});

test('Spatial transmitter accepts ordinary display jitter at each supported rate', () => {
  for (const rate of [2, 4, 8]) {
    const f = fixture(), stops = [];
    const screen = Screen.create(f.canvas, f.host), cfg = Spatial.config({ rate });
    const tx = Spatial.transmission('A', cfg);
    screen.start('A', cfg, () => {}, reason => stops.push(reason));
    for (let i = 1; screen.active && i < 20000; i++) f.tick(i * 1000 / 60);
    assert.deepEqual(stops, ['sent']);
    assert.equal(screen.info.frames, tx.frames.length);
    assert.ok(screen.info.minHeldSeconds >= cfg.period - 1e-9);
    assert.ok(screen.info.maxHeldSeconds <= cfg.period + 1 / 60 + 1e-9);
  }
});

test('Actual scheduled spatial paints remain decodable with independent 30 fps capture', () => {
  for (const rate of [2, 4, 8]) {
    const f = fixture(), paints = [], stops = [], cfg = Spatial.config({ rate });
    const screen = Screen.create(f.canvas, f.host), decoder = Spatial.createDecoder(cfg), events = [];
    screen.start('LIGHT', cfg, frame => paints.push(frame), reason => stops.push(reason));
    for (let i = 1; screen.active && i < 20000; i++) f.tick(i * 1000 / 60);
    assert.deepEqual(stops, ['sent']);
    let index = 0;
    const until = paints.at(-1).displayTime + cfg.period;
    for (let time = 0.013; time < until; time += 1 / 30) {
      while (index + 1 < paints.length && paints[index + 1].displayTime <= time) index++;
      const frame = paints[index];
      events.push(...decoder.push(time, { found: true, data: frame.bit ? 0.15 : -0.15,
        clock: frame.clock ? 0.15 : -0.15, quality: 1 }));
    }
    assert.ok(events.some(event => event.type === 'result' && event.valid && event.crcOk && event.text === 'LIGHT'), `rate=${rate}`);
  }
});

test('Spatial camera passes full image geometry and crop to the optical reader', async () => {
  const f = readyCameraFixture(), frames = [], width = 640, height = 320;
  const data = new Uint8ClampedArray(width * height * 4);
  const painter = { fillStyle: '', fillRect(x, y, w, h) {
    const value = Number(this.fillStyle.match(/\d+/)[0]);
    for (let row = Math.floor(y); row < Math.ceil(y + h); row++) for (let col = Math.floor(x); col < Math.ceil(x + w); col++) {
      const offset = (row * width + col) * 4;
      data.set([value, value, value, 255], offset);
    }
  } };
  Panel.draw(painter, width, height, { bit: 1, clock: 0 }, Spatial.config());
  f.video.videoHeight = height;
  f.canvas.getContext().getImageData = (x, y, w, h) => {
    assert.deepEqual([x, y, w, h], [0, 0, width, height]);
    return { width, height, data };
  };
  f.host.navigator.mediaDevices.getUserMedia = async () => mockStream('camera');
  const camera = Camera.create(f.video, f.canvas, f.host);
  camera.setRegion({ x: 0, y: 0, w: 1, h: 1 });
  await camera.start({ spatial: true, onFrame: value => frames.push(value) });
  f.video.currentTime = 0.1; f.tick(0);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].optical.found, true);
  assert.ok(frames[0].rgb[0] > 0.5);
  assert.ok(frames[0].rgb[1] < 0.5);
  assert.equal(frames[0].rgb[2], frames[0].optical.quality);
  camera.setRegion({ x: 0.3, y: 0.3, w: 0.4, h: 0.4 });
  f.video.currentTime = 0.2; f.tick(0);
  assert.equal(frames[1].optical.found, false, 'cropping away the locator must not produce a decoded sample');
  camera.stop();
});
