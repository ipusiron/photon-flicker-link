/* Photon Flicker Link - MIT (c) 2026 ipusiron. One finite transmission, never an automatic repeat. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./codec-core.js'));
  else root.PhotonScreen = factory(root.PhotonCodec);
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
    function start(text, settings, onFrame = () => {}, stopped = () => {}) {
      stop();
      const tx = core.transmission(text, settings);
      if (host.document.hidden) throw new Error('hidden');
      onStop = stopped;
      active = true;
      const began = host.performance.now();
      let last = -1;
      hidden = () => { if (host.document.hidden) stop('hidden'); };
      host.document.addEventListener('visibilitychange', hidden);
      timer = host.setTimeout(() => stop('timeout'), Math.min(core.RECEIVE_SECONDS, tx.seconds + 1) * 1000);
      function draw(now) {
        if (!active) return;
        const index = Math.floor((now - began) / (settings.period * 1000));
        if (index >= tx.frames.length) { stop('sent'); return; }
        // Skipping a symbol makes the packet invalid: stop visibly instead of emitting a shortened frame.
        if (index > last + 1) { stop('displayStalled'); return; }
        if (index !== last) {
          last = index;
          const frame = tx.frames[index];
          ctx.fillStyle = `rgb(${frame.srgb.join(',')})`;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          onFrame({ ...frame, total: tx.frames.length });
        }
        id = host.requestAnimationFrame(draw);
      }
      draw(began);
      return tx.seconds;
    }
    idle();
    return { start, stop, get active() { return active; } };
  }
  return Object.freeze({ create });
}));
