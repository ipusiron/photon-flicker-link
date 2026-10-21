/* Photon Flicker Link - MIT (c) 2026 ipusiron. One finite transmission, never an automatic repeat. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./reliable-codec.js'));
  else root.PhotonScreen = factory(root.PhotonReliable);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';
  function create(canvas, host = globalThis) {
    const ctx = canvas.getContext('2d');
    let id = null, timer = null, active = false, onStop = () => {}, hidden = null;
    function idle() {
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
      const tx = core.transmission(text, settings);
      if (host.document.hidden) throw new Error('hidden');
      onStop = stopped;
      active = true;
      const requested = host.performance.now(), countdown = preparation.countdown === 3 ? 3 : 0;
      let began = countdown ? null : requested, last = -1, lastCount = null;
      hidden = () => { if (host.document.hidden) stop('hidden'); };
      host.document.addEventListener('visibilitychange', hidden);
      timer = host.setTimeout(() => stop('timeout'), Math.min(core.RECEIVE_SECONDS, tx.seconds + countdown + 1) * 1000);
      function draw(now) {
        if (!active) return;
        if (began === null) {
          const remaining = Math.max(0, countdown - Math.floor(Math.max(0, now - requested) / 1000));
          if (remaining !== lastCount) { lastCount = remaining; preparation.onCountdown?.(remaining); }
          if (remaining) { id = host.requestAnimationFrame(draw); return; }
          // Begin at the first actual frame after the countdown, never skip the preamble.
          began = now;
        }
        // The first rAF timestamp can precede Start within the same display frame.
        // Keep symbol zero until the elapsed time reaches the first full period.
        const index = Math.floor(Math.max(0, now - began) / (settings.period * 1000));
        if (index >= tx.frames.length) { stop('sent'); return; }
        // Skipping a symbol makes the packet invalid: stop visibly instead of emitting a shortened frame.
        if (index > last + 1) { stop('displayStalled'); return; }
        if (index !== last) {
          last = index;
          const frame = tx.frames[index];
          ctx.fillStyle = `rgb(${frame.srgb.join(',')})`;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          onFrame({ ...frame, total: tx.frames.length, remaining: (tx.frames.length - index) * settings.period });
        }
        id = host.requestAnimationFrame(draw);
      }
      draw(requested);
      return tx.seconds;
    }
    idle();
    return { start, stop, get active() { return active; } };
  }
  return Object.freeze({ create });
}));
