/* Photon Flicker Link - MIT (c) 2026 ipusiron. One finite transmission, never an automatic repeat. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./reliable-codec.js'), require('./spatial-codec.js'), require('./optical-panel.js'));
  } else root.PhotonScreen = factory(root.PhotonReliable, root.PhotonSpatial, root.PhotonPanel);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (core, spatial, panel) {
  'use strict';
  function create(canvas, host = globalThis, initial = {}) {
    const ctx = canvas.getContext('2d');
    let id = null, timer = null, active = false, onStop = () => {}, hidden = null, spatialMode = !!initial.spatial;
    let timing = { frames: 0, holds: 0, minHeldSeconds: null, maxHeldSeconds: null, lastHeldSeconds: null };
    function idle() {
      if (spatialMode) { panel.idle(ctx, canvas.width, canvas.height); return; }
      ctx.fillStyle = 'rgb(128,128,128)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    function stop(reason = 'stopped') {
      if (id !== null) host.cancelAnimationFrame(id);
      host.clearTimeout(timer);
      id = null;
      if (hidden) host.document.removeEventListener('visibilitychange', hidden);
      hidden = null;
      const notify = active;
      active = false;
      idle();
      if (notify) onStop(reason);
    }
    function start(text, settings, onFrame = () => {}, stopped = () => {}, preparation = {}) {
      stop();
      spatialMode = !!settings.spatial;
      idle();
      const tx = (spatialMode ? spatial : core).transmission(text, settings);
      if (host.document.hidden) throw new Error('hidden');
      onStop = stopped;
      active = true;
      const requested = host.performance.now(), countdown = preparation.countdown === 3 ? 3 : 0;
      let began = countdown ? null : requested, last = -1, lastCount = null, paintedAt = null;
      timing = { frames: 0, holds: 0, minHeldSeconds: null, maxHeldSeconds: null, lastHeldSeconds: null };
      hidden = () => { if (host.document.hidden) stop('hidden'); };
      host.document.addEventListener('visibilitychange', hidden);
      timer = host.setTimeout(() => stop('timeout'), (tx.seconds * 1.2 + countdown + 1) * 1000);
      function draw(now) {
        if (!active) return;
        // rAF's argument belongs to the display frame, not the instant this callback actually runs.
        now = Math.max(requested, host.performance.now());
        if (began === null) {
          const remaining = Math.max(0, countdown - Math.floor(Math.max(0, now - requested) / 1000));
          if (remaining !== lastCount) { lastCount = remaining; preparation.onCountdown?.(remaining); }
          if (remaining) { id = host.requestAnimationFrame(draw); return; }
          // Begin at the first actual frame after the countdown, never skip the preamble.
          began = now;
        }
        const held = paintedAt === null ? null : (now - paintedAt) / 1000;
        // Schedule from the actual previous paint. A late paint must never shorten the next symbol.
        if (held === null || held + 1e-9 >= settings.period) {
          if (held !== null) {
            timing.holds++;
            timing.lastHeldSeconds = held;
            timing.minHeldSeconds = Math.min(timing.minHeldSeconds ?? held, held);
            timing.maxHeldSeconds = Math.max(timing.maxHeldSeconds ?? held, held);
            if (held > settings.period * 1.2 + 1e-9) { stop('displayStalled'); return; }
          }
          const index = last + 1;
          if (index >= tx.frames.length) { stop('sent'); return; }
          last = index;
          paintedAt = Math.max(began, now);
          timing.frames++;
          const frame = tx.frames[index];
          if (spatialMode) panel.draw(ctx, canvas.width, canvas.height, frame, settings);
          else {
            ctx.fillStyle = `rgb(${frame.srgb.join(',')})`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          onFrame({ ...frame, total: tx.frames.length, remaining: (tx.frames.length - index) * settings.period,
            displayTime: paintedAt / 1000, previousHeldSeconds: held });
        }
        id = host.requestAnimationFrame(draw);
      }
      draw(requested);
      return tx.seconds;
    }
    idle();
    return { start, stop, get active() { return active; }, get info() { return { ...timing }; } };
  }
  return Object.freeze({ create });
}));
