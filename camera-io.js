/* Photon Flicker Link - MIT (c) 2026 ipusiron. Browser camera lifecycle and frame sampling. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./codec-core.js'));
  else root.PhotonCamera = factory(root.PhotonCodec);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';
  const MAX_FILE_BYTES = 128 * 1024 * 1024;
  const MAX_VIDEO_SECONDS = 60;

  async function listCameras(host = globalThis) {
    if (!host.navigator.mediaDevices?.enumerateDevices) throw new Error('deviceListUnavailable');
    const devices = await host.navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'videoinput').map(device =>
      ({ deviceId: device.deviceId, label: device.label }));
  }

  function errorCode(error) {
    return ({ NotAllowedError: 'permission', SecurityError: 'permission', NotFoundError: 'cameraNotFound',
      NotReadableError: 'cameraInUse', TrackStartError: 'cameraInUse', OverconstrainedError: 'cameraSelectionUnavailable' })
      [error.name] || error.message;
  }

  function region(value = {}) {
    const x = core.clamp(Number.isFinite(value.x) ? value.x : 0.3, 0, 0.9);
    const y = core.clamp(Number.isFinite(value.y) ? value.y : 0.3, 0, 0.9);
    return { x, y, w: core.clamp(Number.isFinite(value.w) ? value.w : 0.4, 0.1, 1 - x),
      h: core.clamp(Number.isFinite(value.h) ? value.h : 0.4, 0.1, 1 - y) };
  }

  async function lockControls(track, supported = {}, isCurrent = () => true) {
    const info = { exposure: 'unsupported', whiteBalance: 'unsupported' };
    let caps = {}, settings = {};
    try { caps = track.getCapabilities ? track.getCapabilities() : {}; } catch (_) { /* Optional API. */ }
    try { settings = track.getSettings ? track.getSettings() : {}; } catch (_) { /* Optional API. */ }
    const manual = (key) => supported[key] && Array.isArray(caps[key]) && caps[key].includes('manual');
    // Mode application must resolve before applying the time/temperature values.
    if (manual('exposureMode') && isCurrent()) {
      try {
        await track.applyConstraints({ advanced: [{ exposureMode: 'manual' }] });
        if (!isCurrent()) return info;
        if (supported.exposureTime && caps.exposureTime) {
          const range = caps.exposureTime;
          const current = Number.isFinite(settings.exposureTime) ? settings.exposureTime : (range.min + range.max) / 2;
          await track.applyConstraints({ advanced: [{ exposureTime: core.clamp(current, range.min, range.max) }] });
        }
        info.exposure = track.getSettings?.().exposureMode === 'manual' ? 'manual' : 'requested';
      } catch (_) { info.exposure = 'failed'; }
    }
    if (manual('whiteBalanceMode') && isCurrent()) {
      try {
        await track.applyConstraints({ advanced: [{ whiteBalanceMode: 'manual' }] });
        info.whiteBalance = track.getSettings?.().whiteBalanceMode === 'manual' ? 'manual' : 'requested';
      } catch (_) { info.whiteBalance = 'failed'; }
    }
    return info;
  }

  function create(video, canvas, host = globalThis) {
    let generation = 0, stream = null, url = null, frameId = null, timer = null, watchdog = null;
    let rvfc = false, active = false, handlers = [], rejectReady = null;
    let onStop = () => {}, lastFrameAt = 0, crop = region(), stats = {};
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    function listen(target, name, handler) {
      target.addEventListener(name, handler);
      handlers.push(() => target.removeEventListener(name, handler));
    }
    function stop(reason = 'stopped') {
      generation++;
      const wasActive = active;
      active = false;
      if (rejectReady) { rejectReady(new Error('cancelled')); rejectReady = null; }
      handlers.splice(0).forEach(remove => remove());
      if (frameId !== null) {
        if (rvfc) video.cancelVideoFrameCallback(frameId);
        else host.cancelAnimationFrame(frameId);
        frameId = null;
      }
      host.clearTimeout(timer);
      host.clearInterval(watchdog);
      if (stream) stream.getTracks().forEach(track => track.stop());
      stream = null;
      video.pause();
      video.srcObject = null;
      video.removeAttribute('src');
      video.load();
      if (url) host.URL.revokeObjectURL(url);
      url = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (wasActive) onStop(reason);
    }
    function ready(ticket) {
      if (video.readyState >= 2) return Promise.resolve();
      return new Promise((resolve, reject) => {
        rejectReady = reject;
        listen(video, 'loadeddata', () => {
          rejectReady = null;
          if (ticket === generation) resolve(); else reject(new Error('cancelled'));
        });
        listen(video, 'error', () => { rejectReady = null; reject(new Error('videoError')); });
      });
    }
    async function start(options) {
      stop();
      const ticket = generation;
      active = true;
      onStop = options.onStop || (() => {});
      stats = { fps: 0, width: 0, height: 0, exposure: 'unsupported', whiteBalance: 'unsupported', deviceId: '', label: '' };
      rvfc = !!host.HTMLVideoElement && 'requestVideoFrameCallback' in host.HTMLVideoElement.prototype;
      stats.callback = rvfc ? 'rVFC' : 'rAF';
      lastFrameAt = host.performance.now();
      timer = host.setTimeout(() => stop('timeout'), core.RECEIVE_SECONDS * 1000);
      video.muted = true;
      video.playsInline = true;
      try {
        if (options.file) {
          if (options.file.size > MAX_FILE_BYTES || options.file.size === 0) throw new Error('fileSize');
          url = host.URL.createObjectURL(options.file);
          video.src = url;
        } else {
          if (!host.navigator.mediaDevices?.getUserMedia) throw new Error('cameraUnavailable');
          const opened = await host.navigator.mediaDevices.getUserMedia({ audio: false, video: {
            ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : { facingMode: { ideal: 'environment' } }),
            width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }
          } });
          if (ticket !== generation) { opened.getTracks().forEach(track => track.stop()); throw new Error('cancelled'); }
          stream = opened;
          const track = stream.getVideoTracks()[0];
          if (!track) throw new Error('cameraUnavailable');
          stats.label = track.label || '';
          try { stats.deviceId = track.getSettings?.().deviceId || ''; } catch (_) { /* Optional device metadata. */ }
          listen(track, 'ended', () => stop('cameraEnded'));
          listen(track, 'mute', () => stop('cameraMuted'));
          stats = { ...stats, ...await lockControls(track,
            host.navigator.mediaDevices.getSupportedConstraints?.() || {}, () => ticket === generation) };
          if (ticket !== generation) throw new Error('cancelled');
          video.srcObject = stream;
        }
        const loaded = ready(ticket);
        await Promise.all([video.play(), loaded]);
        if (ticket !== generation) throw new Error('cancelled');
        if (options.file && (!Number.isFinite(video.duration) || video.duration > MAX_VIDEO_SECONDS)) {
          throw new Error('videoDuration');
        }
        stats.width = video.videoWidth;
        stats.height = video.videoHeight;
        canvas.width = Math.min(640, video.videoWidth);
        canvas.height = Math.max(1, Math.round(canvas.width * video.videoHeight / video.videoWidth));
        if (!stats.width || !stats.height || canvas.height > 1280) throw new Error('videoError');
        listen(video, 'ended', () => stop('videoEnded'));
        listen(video, 'error', () => stop('videoError'));
        listen(host.document, 'visibilitychange', () => { if (host.document.hidden) stop('hidden'); });
        let first = null, last = -1, count = 0, previousCount = -1;
        const sample = (_, metadata) => {
          if (ticket !== generation || !active) return;
          const time = metadata ? metadata.mediaTime : video.currentTime;
          // Pull the video before querying its counters. Chromium otherwise throttles a hidden
          // video's presentation when no rVFC is registered, even while currentTime advances.
          try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); }
          catch (_) { stop('sampleError'); return; }
          const decodedCount = video.getVideoPlaybackQuality?.().totalVideoFrames;
          const fresh = rvfc || decodedCount === undefined || decodedCount === 0 || decodedCount !== previousCount;
          if (fresh && time > last && (rvfc || time - last >= 1 / 60)) {
            previousCount = decodedCount;
            last = time;
            lastFrameAt = host.performance.now();
            if (first === null) first = time;
            count++;
            stats.fps = time > first ? (count - 1) / (time - first) : 0;
            try {
              const rect = region(crop);
              const x = Math.floor(rect.x * canvas.width), y = Math.floor(rect.y * canvas.height);
              const w = Math.max(1, Math.min(canvas.width - x, Math.floor(rect.w * canvas.width)));
              const h = Math.max(1, Math.min(canvas.height - y, Math.floor(rect.h * canvas.height)));
              const pixels = ctx.getImageData(x, y, w, h).data;
              const rgb = core.averageRGBA(pixels);
              options.onFrame({ time, rgb, health: core.pixelHealth(pixels), stats: { ...stats }, rect });
            } catch (_) { stop('sampleError'); return; }
          }
          if (ticket === generation && active) schedule();
        };
        const schedule = () => {
          frameId = rvfc ? video.requestVideoFrameCallback(sample) : host.requestAnimationFrame(sample);
        };
        schedule();
        watchdog = host.setInterval(() => {
          if (host.performance.now() - lastFrameAt > 5000) stop('frameStalled');
        }, 1000);
        return { ...stats };
      } catch (error) {
        if (ticket === generation) stop('failed');
        throw error;
      }
    }
    return { start, stop, setRegion(value) { crop = region(value); return crop; },
      get active() { return active; }, get info() { return { ...stats }; } };
  }
  return Object.freeze({ create, region, lockControls, listCameras, errorCode, MAX_FILE_BYTES, MAX_VIDEO_SECONDS });
}));
