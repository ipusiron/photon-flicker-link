/* Photon Flicker Link - MIT (c) 2026 ipusiron. */
(function () {
  'use strict';
  const C = window.PhotonCodec, M = window.PhotonMessages;
  const $ = id => document.getElementById(id);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const stored = key => { try { return localStorage.getItem('photon-flicker-link.' + key); } catch (_) { return null; } };
  const save = (key, value) => { try { localStorage.setItem('photon-flicker-link.' + key, value); } catch (_) { /* Optional. */ } };
  const requestedLanguage = new URLSearchParams(location.search).get('lang');
  let language = [requestedLanguage, stored('language')].find(v => v === 'ja' || v === 'en') ||
    (navigator.language.startsWith('ja') ? 'ja' : 'en');
  let theme = stored('theme');
  if (!['light', 'dark'].includes(theme)) theme = dark.matches ? 'dark' : 'light';
  let busy = false, generation = 0, decoder = null, result = null, sync = null, environment = null;
  let currentRole = 'send', currentMode = 'mono', expected = '', status = 'idle', error = '', live = '';
  let trace = [], marks = [], txFrame = null, lastDraw = -Infinity, selectedRegion = PhotonCamera.region();
  const sampleCanvas = $('sample'), preview = $('preview'), graph = $('graph');
  const camera = PhotonCamera.create($('source'), sampleCanvas);
  const screen = PhotonScreen.create($('tx'));
  const t = (key, values = {}) => (M[language][key] || M[language].failed).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
  const settings = () => C.config({ mode: $('mode').value, rate: Number($('rate').value), contrast: $('contrast').value });
  function setBusy(value) {
    busy = value;
    ['role', 'mode', 'rate', 'contrast', 'text-input', 'video-input', 'expected', 'start'].forEach(id => { $(id).disabled = value; });
    $('stop').disabled = !value;
  }
  function paintText(target, value) {
    target.replaceChildren();
    for (const character of value) {
      const span = document.createElement('span');
      span.textContent = character;
      if (character === '?') span.className = 'uncertain';
      target.append(span);
    }
  }
  function inputInfo() {
    try {
      const bytes = C.bytesOf($('text-input').value);
      $('byte-count').textContent = t('byteCount', { count: bytes.length });
      $('duration').textContent = t('seconds', { seconds: C.duration(bytes.length, settings()).toFixed(1) });
    } catch (e) { $('byte-count').textContent = t(e.message); $('duration').textContent = ''; }
  }
  function render() {
    document.documentElement.lang = language;
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-label]').forEach(el => {
      el.setAttribute('aria-label', t(el.dataset.label)); el.title = t(el.dataset.label);
    });
    $('language').firstElementChild.textContent = language === 'ja' ? 'A' : '文';
    $('role-note').textContent = t($('role').value + 'Note');
    $('send-fields').hidden = $('role').value !== 'send';
    $('file-fields').hidden = $('role').value !== 'offline';
    $('transmitter').hidden = $('role').value !== 'send';
    $('receiver').hidden = $('role').value === 'send';
    $('status').textContent = t(status);
    $('error').textContent = error ? t(error) : '';
    $('graph-legend').textContent = t(currentMode === 'color' ? 'colorLegend' : 'monoLegend');
    $('env-callback').textContent = environment?.callback ||
      ('requestVideoFrameCallback' in HTMLVideoElement.prototype ? 'rVFC' : 'rAF');
    if (environment) {
      $('env-fps').textContent = environment.fps.toFixed(1) + ' fps';
      $('env-resolution').textContent = environment.width + ' × ' + environment.height;
      const state = v => t(currentRole === 'offline' ? 'notApplicable' : v === 'failed' ? 'controlFailed' : v);
      $('env-exposure').textContent = state(environment.exposure);
      $('env-wb').textContent = state(environment.whiteBalance);
    }
    if (sync) $('env-clock').textContent = `${sync.period.toFixed(3)} s · ${sync.framesPerSymbol.toFixed(2)} frame/symbol`;
    paintText($('live'), live);
    if (result) {
      paintText($('result-text'), result.text);
      $('crc').textContent = t(result.crcOk ? 'ok' : 'fail');
      $('frame-check').textContent = t(result.endOk ? 'ok' : 'fail') + ' / ' + t(result.utf8Ok ? 'ok' : 'fail');
      $('confidence').textContent = result.confidence.toFixed(3);
      const agreement = C.matchRate(expected, result.text, currentRole);
      $('agreement-field').hidden = agreement === null;
      $('agreement').textContent = agreement === null ? '—' : agreement.toFixed(1) + '% / ' + (100 - agreement).toFixed(1) + '%';
      $('diagnostics').textContent = t('symbolRow') + '\n' + result.decisions.map(d =>
        `${d.index} / ${d.time.toFixed(3)} / ${d.values.map(v => v === null ? '?' : v).join('')} / ${d.confidence.toFixed(3)}`).join('\n');
    }
    if (txFrame) $('tx-progress').textContent = t(txFrame.kind) + ` · ${txFrame.index + 1} / ${txFrame.total}`;
    inputInfo();
  }
  function clearResult() {
    result = null; sync = null; live = ''; trace = []; marks = []; txFrame = null; environment = null; lastDraw = -Infinity;
    ['result-text', 'diagnostics', 'live', 'tx-progress', 'sample-value'].forEach(id => { $(id).textContent = ''; });
    ['crc', 'frame-check', 'confidence', 'agreement', 'env-fps', 'env-resolution', 'env-clock', 'env-exposure', 'env-wb']
      .forEach(id => { $(id).textContent = '—'; });
    $('agreement-field').hidden = true;
    drawPreview(); drawGraph();
  }
  function stop(reason = 'stopped') {
    generation++;
    camera.stop(); screen.stop();
    if (decoder) decoder.clear();
    decoder = null;
    setBusy(false);
    status = reason;
    drawPreview();
    render();
  }
  function received(event) {
    if (event.type === 'sync') { sync = event; status = 'decoding'; }
    if (event.type === 'symbol') marks.push(event);
    if (event.type === 'text' && event.text !== live) { live = event.text; paintText($('live'), live); }
    if (event.type === 'error') { error = event.code; stop('stopped'); }
    if (event.type === 'result') { result = event; live = event.text; stop('complete'); drawGraph(); }
  }
  function cameraStopped(reason) {
    if (!busy) return;
    if (reason === 'stopped' || reason === 'failed') return;
    if (['videoEnded', 'timeout'].includes(reason)) decoder?.finish().forEach(received);
    else if (reason !== 'hidden') error = reason;
    if (busy) stop(reason === 'videoEnded' ? 'complete' : reason === 'hidden' ? 'hidden' : 'stopped');
  }
  async function start() {
    error = '';
    const cfg = settings();
    const role = $('role').value;
    let file;
    try {
      if (role === 'send') C.bytesOf($('text-input').value);
      if (role === 'offline') { file = $('video-input').files[0]; if (!file) throw new Error('selectFile'); }
    } catch (e) { error = e.message; render(); return; }
    if (role === 'send' && (cfg.rate > 2 || cfg.contrast === 'high' || cfg.mode === 'color' || reduced.matches)) {
      $('warning-dialog').showModal();
      return;
    }
    await begin(role, cfg, file);
  }
  async function begin(role, cfg, file) {
    if (busy) return;
    clearResult(); error = ''; currentRole = role; currentMode = cfg.mode; expected = $('expected').value;
    const ticket = ++generation;
    setBusy(true);
    status = role === 'send' ? 'sending' : 'receiving';
    render();
    try {
      if (role === 'send') {
        screen.start($('text-input').value, cfg, frame => { txFrame = frame; render(); }, reason => {
          if (ticket !== generation) return;
          if (reason === 'displayStalled') error = reason;
          stop(reason);
        });
      } else {
        decoder = C.createDecoder(cfg);
        $('video-input').value = '';
        await camera.start({ file, onStop: cameraStopped, onFrame(frame) {
          if (ticket !== generation) return;
          environment = frame.stats;
          trace.push({ time: frame.time, rgb: frame.rgb });
          if (trace.length > 900) trace.shift();
          decoder.push(frame.time, frame.rgb).forEach(received);
          if (ticket !== generation) return;
          if (frame.time - lastDraw >= (reduced.matches ? 1 : 0.09)) {
            lastDraw = frame.time; drawPreview(); drawGraph(); render();
          }
        } });
      }
    } catch (e) {
      if (ticket !== generation) return;
      error = e.name === 'NotAllowedError' ? 'permission' : e.message;
      stop('failed');
    }
  }
  // Visual rendering is expanded in stage 1d. Sampling always reads the unmarked canvas.
  function drawPreview() {
    const ctx = preview.getContext('2d');
    ctx.clearRect(0, 0, preview.width, preview.height);
    if (camera.active && $('preview-enabled').checked) ctx.drawImage(sampleCanvas, 0, 0, preview.width, preview.height);
  }
  function drawGraph() {
    graph.getContext('2d').clearRect(0, 0, graph.width, graph.height);
  }
  function updateRegion() {
    selectedRegion = camera.setRegion(Object.fromEntries(['x', 'y', 'w', 'h'].map(key => [key, Number($('roi-' + key).value) / 100])));
    $('region-value').textContent = Object.entries(selectedRegion).map(([k, v]) => `${k}: ${(v * 100).toFixed(0)}%`).join(' · ');
    if (busy && currentRole !== 'send') {
      decoder?.clear(); decoder = C.createDecoder(settings()); sync = null; live = ''; trace = []; marks = [];
      status = 'receiving'; render();
    }
    drawPreview();
  }
  $('start').addEventListener('click', start);
  $('stop').addEventListener('click', () => stop());
  $('clear').addEventListener('click', () => { stop(); clearResult(); error = ''; status = 'idle'; render(); });
  ['role', 'mode', 'rate', 'contrast'].forEach(id => $(id).addEventListener('change', () => {
    currentMode = $('mode').value; render(); drawGraph();
  }));
  $('text-input').addEventListener('input', inputInfo);
  $('theme').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; save('theme', theme); render(); drawGraph(); });
  $('language').addEventListener('click', () => { language = language === 'ja' ? 'en' : 'ja'; save('language', language); render(); });
  $('help').addEventListener('click', () => $('help-dialog').showModal());
  $('help-close').addEventListener('click', () => $('help-dialog').close());
  $('warning-cancel').addEventListener('click', () => $('warning-dialog').close());
  $('warning-accept').addEventListener('click', () => { $('warning-dialog').close(); begin('send', settings()); });
  ['x', 'y', 'w', 'h'].forEach(key => $('roi-' + key).addEventListener('input', updateRegion));
  $('region-reset').addEventListener('click', () => {
    ['x', 'y', 'w', 'h'].forEach((key, i) => { $('roi-' + key).value = i < 2 ? 30 : 40; }); updateRegion();
  });
  $('preview-enabled').checked = !reduced.matches;
  $('preview-enabled').addEventListener('change', drawPreview);
  document.addEventListener('visibilitychange', () => { if (document.hidden && busy) stop('hidden'); });
  window.addEventListener('pagehide', () => stop('stopped'));
  updateRegion(); render();
}());
