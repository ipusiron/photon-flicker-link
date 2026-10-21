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
  let lessonLanguage = null, dragStart = null;
  let testingCamera = false, cameras = [], selectedCameraId = '', cameraCheck = null;
  let countdownValue = null, quality = null, qualityTrace = [];
  let cameraListState = 'cameraListHint', cameraCheckState = 'cameraUnchecked', listGeneration = 0;
  const sampleCanvas = $('sample'), preview = $('preview'), graph = $('graph');
  const camera = PhotonCamera.create($('source'), sampleCanvas);
  const screen = PhotonScreen.create($('tx'));
  const t = (key, values = {}) => (M[language][key] || M[language].failed).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
  const settings = () => C.config({ mode: $('mode').value, rate: Number($('rate').value), contrast: $('contrast').value });
  function setBusy(value) {
    busy = value;
    ['role', 'mode', 'rate', 'contrast', 'text-input', 'video-input', 'expected', 'start'].forEach(id => { $(id).disabled = value; });
    $('stop').disabled = !value;
    $('start').disabled = value && !testingCamera;
    $('camera-test').disabled = value;
    $('camera-test-stop').disabled = !testingCamera;
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
    $('camera-fields').hidden = $('role').value !== 'receive';
    if ($('role').value === 'receive') $('start').textContent = t('receiveStart');
    $('camera-list-note').textContent = t(cameraListState, { count: cameras.length });
    $('camera-check').textContent = t(cameraCheckState);
    $('camera-details').textContent = cameraCheck ? t('cameraDetails', { name: cameraCheck.label || t('cameraDefault'),
      width: cameraCheck.width, height: cameraCheck.height, fps: cameraCheck.fps.toFixed(1) }) : '';
    $('status').textContent = t(status);
    $('error').textContent = error ? t(error) : '';
    $('graph-legend').textContent = t(currentMode + 'Legend');
    $('tx-countdown').textContent = countdownValue === null ? '' : countdownValue ? ['①', '②', '③'][countdownValue - 1] : t('start');
    $('preview-note').textContent = t(camera.active ? testingCamera ? 'testPreviewNote' : 'activePreviewNote' :
      $('role').value === 'offline' ? 'offlinePreviewNote' : 'receivePreviewNote');
    $('receive-status').textContent = t(status);
    if (quality) {
      $('signal-health').textContent = t('signalHealth', { white: (quality.white * 100).toFixed(0),
        dark: (quality.dark * 100).toFixed(0), clipped: (quality.clipped * 100).toFixed(0), span: quality.span.toFixed(3) });
      $('signal-advice').textContent = t(quality.white > 0.2 ? 'signalWhite' : quality.dark > 0.2 ? 'signalDark' :
        quality.clipped > 0.2 ? 'signalClipped' : 'signalObserve');
    }
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
    renderLessons();
  }
  function renderLessons() {
    if (lessonLanguage === language) return;
    const opened = Array.from($('lesson-content').children).map(d => d.open);
    lessonLanguage = language;
    $('lesson-content').replaceChildren();
    const lang = language === 'ja' ? 0 : 1;
    M.lessons.forEach((lesson, i) => {
      const details = document.createElement('details');
      details.open = !!opened[i];
      const summary = document.createElement('summary'); summary.textContent = `${i + 1}. ${lesson.title[lang]}`;
      const para = document.createElement('p'); para.textContent = lesson.text[lang];
      const wrap = document.createElement('div'); wrap.className = 'table-wrap';
      const table = document.createElement('table');
      const thead = document.createElement('thead'), tbody = document.createElement('tbody');
      const header = document.createElement('tr');
      lesson.headers[lang].split(' / ').forEach(text => {
        const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = text; header.append(cell);
      });
      thead.append(header);
      lesson.rows.forEach(row => {
        const tr = document.createElement('tr');
        row.slice(lang * 2, lang * 2 + 2).forEach((text, c) => {
          const cell = document.createElement(c === 0 ? 'th' : 'td');
          if (c === 0) cell.scope = 'row';
          cell.textContent = text; tr.append(cell);
        });
        tbody.append(tr);
      });
      table.append(thead, tbody); wrap.append(table);
      const sources = document.createElement('div'); sources.className = 'lesson-sources';
      lesson.sources.forEach(([text, href]) => {
        const a = document.createElement('a'); a.textContent = text; a.href = href;
        a.target = '_blank'; a.rel = 'noopener noreferrer'; sources.append(a);
      });
      details.append(summary, para, wrap, sources); $('lesson-content').append(details);
    });
  }
  function clearResult() {
    result = null; sync = null; live = ''; trace = []; marks = []; txFrame = null; environment = null; lastDraw = -Infinity;
    countdownValue = null; resetQuality();
    ['result-text', 'diagnostics', 'live', 'tx-progress', 'sample-value'].forEach(id => { $(id).textContent = ''; });
    ['crc', 'frame-check', 'confidence', 'agreement', 'env-fps', 'env-resolution', 'env-clock', 'env-exposure', 'env-wb']
      .forEach(id => { $(id).textContent = '—'; });
    $('agreement-field').hidden = true;
    drawPreview(); drawGraph();
  }
  function stop(reason = 'stopped') {
    generation++;
    testingCamera = false;
    cameraCheckState = cameraCheck ? 'cameraChecked' : 'cameraUnchecked';
    camera.stop(); screen.stop();
    if (decoder) decoder.clear();
    decoder = null;
    countdownValue = null;
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
    if (['videoEnded', 'timeout'].includes(reason)) { if (!testingCamera) decoder?.finish().forEach(received); }
    else if (reason !== 'hidden') error = reason;
    if (busy) stop(reason === 'videoEnded' ? 'complete' : ['hidden', 'timeout'].includes(reason) ? reason : 'stopped');
  }
  async function start() {
    if (testingCamera) stop();
    if (busy) return;
    error = '';
    const cfg = settings();
    const role = $('role').value;
    let file;
    try {
      if (role === 'send') C.bytesOf($('text-input').value);
      if (role === 'offline') { file = $('video-input').files[0]; if (!file) throw new Error('selectFile'); }
    } catch (e) { error = e.message; render(); return; }
    if (role === 'send' && (cfg.rate > 2 || cfg.contrast === 'high' || cfg.mode !== 'mono' || reduced.matches)) {
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
    status = role === 'send' ? 'preparing' : 'receiving';
    render();
    try {
      if (role === 'send') {
        screen.start($('text-input').value, cfg, frame => {
          txFrame = frame; status = 'sending'; if (frame.index > 0) countdownValue = null; render();
        }, reason => {
          if (ticket !== generation) return;
          if (reason === 'displayStalled') error = reason;
          stop(reason);
        }, { countdown: 3, onCountdown(value) { countdownValue = value; render(); } });
      } else {
        decoder = C.createDecoder(cfg);
        $('video-input').value = '';
        await camera.start({ file, deviceId: selectedCameraId, onStop: cameraStopped, onFrame(frame) {
          if (ticket !== generation) return;
          if (role === 'receive') { cameraCheck = frame.stats; cameraCheckState = 'cameraReceiving'; }
          environment = frame.stats;
          updateQuality(frame, cfg.mode);
          trace.push({ time: frame.time, rgb: frame.rgb });
          if (trace.length > 900) trace.shift();
          decoder.push(frame.time, frame.rgb).forEach(received);
          if (ticket !== generation) return;
          if (frame.time - lastDraw >= (reduced.matches ? 1 : 0.09)) {
            lastDraw = frame.time; drawPreview(); drawGraph(); render();
          }
        } });
        if (ticket === generation && role === 'receive') rememberCamera();
      }
    } catch (e) {
      if (ticket !== generation) return;
      error = PhotonCamera.errorCode(e);
      stop('failed');
    }
  }
  function renderCameraOptions() {
    const select = $('camera-select');
    select.replaceChildren();
    const add = (value, label) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
    };
    add('', t('cameraDefault'));
    cameras.forEach((device, i) => {
      if (device.deviceId) add(device.deviceId, device.label || t('cameraUnnamed', { number: i + 1 }));
    });
    if (selectedCameraId && !cameras.some(device => device.deviceId === selectedCameraId)) add(selectedCameraId, t('cameraMissing'));
    select.value = selectedCameraId;
  }
  async function refreshCameras() {
    const ticket = ++listGeneration;
    cameraListState = 'cameraListLoading'; $('camera-refresh').disabled = true; render();
    try {
      const found = await PhotonCamera.listCameras();
      if (ticket !== listGeneration) return;
      cameras = found; cameraListState = found.length ? 'cameraListCount' : 'cameraListEmpty';
    } catch (_) {
      if (ticket !== listGeneration) return;
      cameraListState = 'deviceListUnavailable';
    } finally {
      if (ticket === listGeneration) { $('camera-refresh').disabled = false; renderCameraOptions(); render(); }
    }
  }
  function rememberCamera() {
    if (!selectedCameraId && camera.info.deviceId) selectedCameraId = camera.info.deviceId;
    refreshCameras();
  }
  async function testCamera() {
    if (busy) return;
    const ticket = ++generation;
    testingCamera = true; cameraCheck = null; cameraCheckState = 'cameraOpening'; error = ''; resetQuality();
    setBusy(true); status = 'cameraOpening'; render();
    let paintedAt = -Infinity;
    try {
      await camera.start({ deviceId: selectedCameraId, onStop: cameraStopped, onFrame(frame) {
        if (ticket !== generation) return;
        cameraCheck = frame.stats; cameraCheckState = 'cameraTesting'; status = 'cameraTesting';
        updateQuality(frame, $('mode').value);
        if (frame.time - paintedAt >= (reduced.matches ? 1 : 0.09)) {
          paintedAt = frame.time; drawPreview(); render();
        }
      } });
      if (ticket === generation) rememberCamera();
    } catch (e) {
      if (ticket !== generation) return;
      error = PhotonCamera.errorCode(e); stop('failed'); cameraCheckState = 'cameraTestFailed'; render();
    }
  }
  function resetQuality() {
    quality = null; qualityTrace = [];
    $('signal-health').textContent = ''; $('signal-advice').textContent = '';
  }
  function updateQuality(frame, mode) {
    qualityTrace.push({ time: frame.time, value: C.signal(frame.rgb, mode) });
    qualityTrace = qualityTrace.filter(sample => frame.time - sample.time <= 2);
    const values = qualityTrace.map(sample => sample.value);
    quality = { ...frame.health, span: Math.max(...values) - Math.min(...values) };
  }
  // The marked preview is separate from the unmarked sampling canvas.
  function drawPreview() {
    const ctx = preview.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    if (camera.active) { preview.width = sampleCanvas.width; preview.height = sampleCanvas.height; }
    ctx.clearRect(0, 0, preview.width, preview.height);
    if (camera.active && $('preview-enabled').checked) {
      ctx.drawImage(sampleCanvas, 0, 0, preview.width, preview.height);
      const { x, y, w, h } = selectedRegion;
      ctx.lineWidth = 5; ctx.strokeStyle = css.getPropertyValue('--roi-dark');
      ctx.strokeRect(x * preview.width, y * preview.height, w * preview.width, h * preview.height);
      ctx.lineWidth = 2; ctx.strokeStyle = css.getPropertyValue('--roi-light'); ctx.setLineDash([8, 5]);
      ctx.strokeRect(x * preview.width, y * preview.height, w * preview.width, h * preview.height);
      ctx.setLineDash([]);
    } else {
      const scale = preview.width / (preview.clientWidth || preview.width);
      ctx.fillStyle = css.getPropertyValue('--muted'); ctx.font = `${14 * scale}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText(t(camera.active ? 'previewHidden' : 'emptyPreview'), preview.width / 2, preview.height / 2, preview.width - 32);
    }
  }
  function drawGraph() {
    const width = Math.max(240, graph.clientWidth), height = 240, dpr = window.devicePixelRatio || 1;
    graph.width = Math.round(width * dpr); graph.height = Math.round(height * dpr);
    const ctx = graph.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const color = key => css.getPropertyValue(key).trim();
    const left = 36, right = width - 12, top = 18, bottom = height - 32;
    const end = trace.length ? trace.at(-1).time : 20, start = Math.max(0, end - 20);
    const x = time => left + (time - start) / Math.max(1, end - start) * (right - left);
    const y = value => bottom - C.clamp(value) * (bottom - top);
    ctx.font = '12px system-ui'; ctx.textAlign = 'right';
    for (const value of [0, 0.25, 0.5, 0.75, 1]) {
      ctx.strokeStyle = color('--line'); ctx.beginPath(); ctx.moveTo(left, y(value)); ctx.lineTo(right, y(value)); ctx.stroke();
      ctx.fillStyle = color('--muted'); ctx.fillText(String(value), left - 5, y(value) + 4);
    }
    ctx.textAlign = 'left'; ctx.fillText(start.toFixed(1) + ' s', left, height - 9);
    ctx.textAlign = 'right'; ctx.fillText(end.toFixed(1) + ' s', right, height - 9);
    ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
    const corrected = rgb => currentMode === 'color' && sync?.calibration ?
      C.multiply(sync.calibration.inverse, rgb.map((v, c) => v - sync.calibration.black[c])) : rgb;
    const threshold = currentMode === 'color' ? 0.5 : sync ? (sync.low + sync.high) / 2 : null;
    if (threshold !== null) {
      ctx.strokeStyle = color('--muted'); ctx.setLineDash([5, 5]); ctx.beginPath();
      ctx.moveTo(left, y(threshold)); ctx.lineTo(right, y(threshold)); ctx.stroke(); ctx.setLineDash([]);
    }
    const channels = currentMode === 'color' ? [0, 1, 2] : [0];
    const colors = ['--plot-ink', '--plot-secondary', '--plot-tertiary'];
    channels.forEach(c => {
      ctx.strokeStyle = color(colors[c]); ctx.lineWidth = 2; ctx.setLineDash([[], [10, 5], [2, 4]][c]);
      ctx.beginPath(); let first = true;
      trace.filter(s => s.time >= start).forEach(s => {
        const value = currentMode === 'color' ? corrected(s.rgb)[c] : C.signal(s.rgb, currentMode);
        if (first) ctx.moveTo(x(s.time), y(value)); else ctx.lineTo(x(s.time), y(value));
        first = false;
      });
      ctx.stroke();
    });
    ctx.setLineDash([]); ctx.lineWidth = 1;
    for (const mark of marks.filter(m => m.time >= start)) {
      ctx.strokeStyle = color(mark.confidence < C.CONFIDENCE ? '--warning' : '--border');
      ctx.beginPath(); ctx.moveTo(x(mark.time), bottom - 12); ctx.lineTo(x(mark.time), bottom); ctx.stroke();
      if (mark.confidence < C.CONFIDENCE) {
        ctx.fillStyle = color('--warning'); ctx.textAlign = 'center'; ctx.fillText('?', x(mark.time), top + 12);
      }
    }
    ctx.restore();
    if (trace.length) {
      const values = currentMode === 'color' ? corrected(trace.at(-1).rgb) : [C.signal(trace.at(-1).rgb, currentMode)];
      const label = currentMode === 'color' ? 'RGB: ' : currentMode === 'bicolor' ? 'R/(R+B): ' : 'Y: ';
      $('sample-value').textContent = label + values.map(v => v.toFixed(3)).join(' / ');
    }
  }
  function updateRegion() {
    resetQuality();
    selectedRegion = camera.setRegion(Object.fromEntries(['x', 'y', 'w', 'h'].map(key => [key, Number($('roi-' + key).value) / 100])));
    $('region-value').textContent = Object.entries(selectedRegion).map(([k, v]) => `${k}: ${(v * 100).toFixed(0)}%`).join(' · ');
    if (busy && currentRole !== 'send' && !testingCamera) {
      decoder?.clear(); decoder = C.createDecoder(settings()); sync = null; live = ''; trace = []; marks = [];
      status = 'receiving'; render();
    }
    drawPreview();
  }
  $('start').addEventListener('click', start);
  $('stop').addEventListener('click', () => stop());
  $('clear').addEventListener('click', () => { stop(); clearResult(); error = ''; status = 'idle'; render(); });
  ['role', 'mode', 'rate', 'contrast'].forEach(id => $(id).addEventListener('change', () => {
    if (!trace.length) currentMode = $('mode').value;
    render(); drawGraph(); drawPreview();
    if (id === 'role' && $('role').value === 'receive') refreshCameras();
  }));
  $('camera-refresh').addEventListener('click', refreshCameras);
  $('camera-test').addEventListener('click', testCamera);
  $('camera-test-stop').addEventListener('click', () => stop());
  $('camera-select').addEventListener('change', () => {
    const choice = $('camera-select').value, wasTesting = testingCamera, resume = busy;
    if (busy) stop();
    selectedCameraId = choice; cameraCheck = null; cameraCheckState = 'cameraUnchecked'; error = ''; render();
    if (resume) { if (wasTesting) testCamera(); else begin('receive', settings()); }
  });
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    if ($('role').value === 'receive' && !document.hidden) refreshCameras();
  });
  $('text-input').addEventListener('input', inputInfo);
  $('theme').addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark'; save('theme', theme); render(); drawGraph(); drawPreview();
  });
  $('language').addEventListener('click', () => {
    language = language === 'ja' ? 'en' : 'ja'; save('language', language); renderCameraOptions(); render(); drawPreview();
  });
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
  function pointerPosition(event) {
    const rect = preview.getBoundingClientRect();
    return { x: C.clamp((event.clientX - rect.left) / rect.width), y: C.clamp((event.clientY - rect.top) / rect.height) };
  }
  preview.addEventListener('pointerdown', event => { dragStart = pointerPosition(event); preview.setPointerCapture(event.pointerId); });
  preview.addEventListener('pointerup', event => {
    if (!dragStart) return;
    const end = pointerPosition(event);
    const rect = { x: Math.min(dragStart.x, end.x), y: Math.min(dragStart.y, end.y),
      w: Math.abs(dragStart.x - end.x), h: Math.abs(dragStart.y - end.y) };
    dragStart = null;
    Object.entries(rect).forEach(([key, value]) => { $('roi-' + key).value = Math.round(value * 100); });
    updateRegion();
  });
  preview.addEventListener('pointercancel', () => { dragStart = null; });
  window.addEventListener('resize', () => { drawGraph(); drawPreview(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && busy) stop('hidden'); });
  window.addEventListener('pagehide', () => stop('stopped'));
  renderCameraOptions(); updateRegion(); render(); drawGraph(); drawPreview();
}());
