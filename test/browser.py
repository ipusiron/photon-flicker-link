"""Browser QA. Requires an existing Python Playwright installation and FFmpeg; no npm dependencies.
Run: python -X utf8 test/browser.py [--screenshots] [--url https://.../]
Fixtures and reports remain in .work. Only requested README screenshots go into assets.
"""
from pathlib import Path
from datetime import datetime
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import argparse
import json
import math
import re
import subprocess
from time import monotonic
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.work' / ('browser-' + datetime.now().strftime('%Y%m%d_%H%M%S'))
OUT.mkdir(parents=True, exist_ok=True)


def movie(mode, text='LIGHT', levels=2):
    cfg = json.dumps({'mode': mode, 'levels': levels, 'rate': 8})
    code = 'const C=require("./reliable-codec.js"); console.log(JSON.stringify(C.transmission('
    code += json.dumps(text) + ',C.config(' + cfg + '))));'
    tx = json.loads(subprocess.check_output(['node', '-e', code], cwd=ROOT, text=True, encoding='utf-8'))
    file = OUT / f'{mode}-{levels}.webm'
    process = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo',
        '-pixel_format', 'rgb24', '-video_size', '160x120', '-framerate', '30', '-i', 'pipe:0',
        '-c:v', 'libvpx-vp9', '-lossless', '1', str(file)], stdin=subprocess.PIPE)
    for n in range(math.ceil((tx['seconds'] + 4) * 30)):
        index = math.floor((n / 30 - 3) * 8)
        rgb = tx['frames'][index]['srgb'] if 0 <= index < len(tx['frames']) else [118] * 3
        if mode == 'bicolor' and 0 <= index < len(tx['frames']):
            # Common brightness drift and fixed red/blue imbalance before 8-bit video encoding.
            gain = 0.15 * (1 + 0.5 * math.sin(n / 30 * 2))
            linear = [v * gain * [1.2, 0.9, 0.8][c] + 0.0005 for c, v in enumerate(tx['frames'][index]['rgb'])]
            rgb = [round(255 * (12.92*v if v <= 0.0031308 else 1.055*v**(1/2.4)-0.055)) for v in linear]
        process.stdin.write(bytes(rgb) * 160 * 120)
    process.stdin.close()
    assert process.wait() == 0
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(file), '-pix_fmt',
        'yuv420p', str(OUT / f'{mode}-{levels}.y4m')], check=True)
    return file


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def errors_for(page):
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    return errors


def trace_receiver(context):
    # Synthetic QA only: retain the sampled signal and immutable decoder events for failures.
    context.add_init_script('''window.receiveTrace = {samples:[],events:[],stops:[]};
      Object.defineProperty(window,'PhotonCamera',{configurable:true,set(original) {
        Object.defineProperty(window,'PhotonCamera',{value:{...original,create(...args) {
          const camera=original.create(...args), start=camera.start;
          camera.start=options=>start({...options,onFrame(frame) {
            receiveTrace.samples.push({...frame,at:performance.now()}); options.onFrame(frame);
          },onStop(reason) {receiveTrace.stops.push(reason);options.onStop?.(reason);}});
          return camera;
        }}});
      }});
      Object.defineProperty(window,'PhotonReliable',{configurable:true,set(original) {
        Object.defineProperty(window,'PhotonReliable',{value:{...original,createDecoder(...args) {
          const decoder=original.createDecoder(...args), push=decoder.push;
          decoder.push=(...args)=>{const events=push(...args);
            receiveTrace.events.push(...structuredClone(events));return events;};
          return decoder;
        }}});
      }});''')


def save_receiver_trace(page, name):
    state = page.evaluate('''() => JSON.stringify({...receiveTrace,
      status:document.querySelector('#status').textContent,error:document.querySelector('#error').textContent,
      crc:document.querySelector('#crc').textContent,live:document.querySelector('#live').textContent})''')
    (OUT / f'{name}-trace.json').write_text(json.dumps(json.loads(state), indent=2), encoding='utf-8')


def layout(page):
    actual = page.evaluate('''() => {
      const visible = el => el.getClientRects().length > 0;
      const controls = [...document.querySelectorAll('button,input,select,textarea,summary,footer a,.lesson-sources a')];
      const small = controls.filter(visible).map(el => {
        const target = el.matches('input[type=checkbox]') ? el.labels[0] : el;
        const r = target.getBoundingClientRect(); return [el.id || el.tagName, r.width, r.height];
      }).filter(r => r[1] < 43.999 || r[2] < 43.999);
      return {overflow:document.documentElement.scrollWidth - innerWidth, small};
    }''')
    assert actual['overflow'] == 0, actual
    assert not actual['small'], actual
    if page.locator('#receiver').is_visible():
        boxes = page.locator('#preview,#region-panel,#graph,#live').evaluate_all('''els =>
          Object.fromEntries(els.map(el => {const r=el.getBoundingClientRect();
            return [el.id,{left:r.left,right:r.right,top:r.top,bottom:r.bottom}];}))''')
        if page.viewport_size['width'] >= 900:
            assert boxes['region-panel']['left'] >= boxes['preview']['right'], boxes
        else:
            assert boxes['region-panel']['top'] >= boxes['graph']['bottom'], boxes
        assert boxes['live']['bottom'] <= boxes['graph']['top'], boxes


def no_japanese(page):
    text = page.evaluate('''() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let text = '', node;
      while ((node = walker.nextNode())) {
        if (!node.parentElement.closest('script,noscript,#language')) text += node.textContent;
      }
      return text;
    }''')
    assert not re.search(r'[\u3040-\u30ff\u3400-\u9fff（）]', text), text


def screenshot(page, name, language, selector):
    dest = ROOT / 'assets' / ('en' if language == 'en' else '')
    dest.mkdir(parents=True, exist_ok=True)
    targets = page.locator(selector)
    targets.first.scroll_into_view_if_needed()
    clip = targets.evaluate_all('''els => {
      const boxes = els.map(el => el.getBoundingClientRect());
      const x = Math.min(...boxes.map(r => r.left)), y = Math.min(...boxes.map(r => r.top));
      return {x:x+scrollX,y:y+scrollY,width:Math.max(...boxes.map(r => r.right))-x,
        height:Math.max(...boxes.map(r => r.bottom))-y};
    }''')
    page.screenshot(path=str(dest / (name + '.png')), clip=clip, full_page=True)


def interface(p, urls, report):
    for engine in [p.chromium, p.firefox]:
        browser = engine.launch()
        try:
            for scheme, url in urls:
                for width in [320, 1280]:
                    for theme in ['light', 'dark']:
                        context = browser.new_context(viewport={'width': width, 'height': 1000},
                            color_scheme=theme, reduced_motion='reduce', has_touch=True,
                            **({'is_mobile': True} if engine.name == 'chromium' else {}))
                        page = context.new_page()
                        errors = errors_for(page)
                        page.goto(url + ('&' if '?' in url else '?') + 'lang=ja')
                        assert page.locator('html').get_attribute('data-theme') == theme
                        assert not page.locator('#preview-enabled').is_checked()
                        for language in ['ja', 'en']:
                            if page.locator('html').get_attribute('lang') != language:
                                page.click('#language')
                            for role in ['send', 'receive', 'offline']:
                                page.select_option('#role', role)
                                assert page.locator('#transmitter').is_visible() == (role == 'send')
                                assert page.locator('#receiver').is_visible() == (role != 'send')
                                assert page.locator('#file-fields').is_visible() == (role == 'offline')
                                assert page.locator('#send-fields').is_visible() == (role == 'send')
                                for mode in ['mono', 'color', 'bicolor']:
                                    page.select_option('#mode', mode)
                                    layout(page)
                            page.select_option('#role', 'send')
                            page.fill('#text-input', '123456789')
                            page.click('#start')
                            assert page.locator('#error').inner_text()
                            page.fill('#text-input', 'LIGHT')
                            page.click('#start')
                            assert page.locator('#warning-dialog').is_visible()
                            assert page.locator('#tx-progress').inner_text() == ''
                            layout(page)
                            page.keyboard.press('Escape')
                            assert not page.locator('#warning-dialog').is_visible()
                            page.click('#help')
                            assert page.locator('#help-dialog').is_visible()
                            page.keyboard.press('Escape')
                            assert page.locator('#help').evaluate('(el) => el === document.activeElement')
                            page.locator('#lesson-content details').evaluate_all('els => els.forEach(el => { el.open = true; })')
                            layout(page)
                            if language == 'en':
                                no_japanese(page)
                            page.select_option('#role', 'receive')
                            page.locator('#roi-x').focus()
                            page.keyboard.press('ArrowRight')
                            assert page.locator('#roi-x').input_value() == '31'
                            assert page.locator('#roi-x').evaluate("el => getComputedStyle(el).outlineStyle !== 'none'")
                            page.click('#region-reset')
                            assert page.locator('#roi-x').input_value() == '30'
                        assert not errors, errors
                        report.append({'ui': [engine.name, scheme, width, theme], 'overflow': 0, 'smallTargets': 0})
                        context.close()
        finally:
            browser.close()


def camera_ui(p, url, report):
    for engine in [p.chromium, p.firefox]:
        options = {'args': ['--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream=device-count=2,fps=30']} if engine.name == 'chromium' else {
            'firefox_user_prefs': {'media.navigator.streams.fake': True, 'media.navigator.permission.disabled': True}}
        browser = engine.launch(**options)
        try:
            context = browser.new_context(reduced_motion='no-preference')
            context.add_init_script('''window.cameraTracks = []; window.cameraRequests = [];
              const openCamera = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
              navigator.mediaDevices.getUserMedia = async constraints => {
                cameraRequests.push(constraints);
                const stream = await openCamera(constraints);
                // Firefox requires explicit opt-in for synthetic events on test media tracks.
                // Actual hardware events are trusted; this override exists only in this fixture.
                for (const track of stream.getVideoTracks()) {
                  const listen = track.addEventListener.bind(track);
                  track.addEventListener = (name, listener, options) => listen(name, listener, options, true);
                }
                cameraTracks.push(...stream.getVideoTracks());
                if (window.holdCamera) await new Promise(resolve => { window.releaseCamera = resolve; });
                return stream;
              };''')
            page = context.new_page()
            errors = errors_for(page)
            page.goto(url + '?lang=en')
            page.select_option('#role', 'receive')
            assert page.locator('#camera-fields').is_visible()
            assert page.evaluate('() => cameraRequests.length') == 0
            assert 'does not start' in page.locator('#role-note').inner_text()
            assert 'Start reception' in page.locator('#preview-note').inner_text()
            page.click('#camera-test')
            page.wait_for_function("() => document.querySelector('#camera-check').textContent.includes('video frames received')")
            page.wait_for_function("() => document.querySelector('#camera-select').value.length > 0")
            assert page.locator('#live').inner_text() == ''
            assert page.locator('#crc').inner_text() == '—'
            assert page.locator('#start').is_enabled()
            assert page.locator('#camera-test-stop').is_enabled()
            first = page.locator('#camera-select').input_value()
            choices = page.locator('#camera-select option').evaluate_all('els => els.map(el => el.value).filter(Boolean)')
            assert len(choices) >= (2 if engine.name == 'chromium' else 1), choices
            second = next((value for value in choices if value != first), '')
            page.select_option('#camera-select', second)
            page.wait_for_function("() => cameraTracks.length === 2 && cameraTracks[0].readyState === 'ended'")
            page.wait_for_function("() => document.querySelector('#camera-check').textContent.includes('video frames received')")
            selected = page.locator('#camera-select').input_value()
            assert page.evaluate('() => cameraTracks[1].getSettings().deviceId') == selected
            assert page.evaluate('() => cameraRequests.every(request => request.audio === false)')
            for width in [320, 1280]:
                page.set_viewport_size({'width': width, 'height': 1000})
                for theme in ['light', 'dark']:
                    if page.locator('html').get_attribute('data-theme') != theme:
                        page.click('#theme')
                    for language in ['en', 'ja']:
                        if page.locator('html').get_attribute('lang') != language:
                            page.click('#language')
                        layout(page)
                        if language == 'en':
                            no_japanese(page)
                        if engine.name == 'chromium' and theme == 'light':
                            page.locator('#receiver').screenshot(path=str(OUT / f'camera-test-{width}-{language}.png'))
            if page.locator('html').get_attribute('lang') != 'en':
                page.click('#language')
            # Start reception directly from testing, retaining the chosen camera.
            page.click('#start')
            page.wait_for_function("() => cameraTracks.length === 3 && document.querySelector('#camera-check').textContent.includes('Receiving')")
            assert page.evaluate("() => cameraTracks[1].readyState === 'ended'")
            assert page.evaluate('() => cameraRequests[2].video.deviceId.exact') == selected
            # Switching during reception also releases the track and starts a new decoder session.
            page.select_option('#camera-select', first if selected != first else '')
            page.wait_for_function("() => cameraTracks.length === 4 && cameraTracks[2].readyState === 'ended'")
            page.wait_for_function("() => document.querySelector('#camera-check').textContent.includes('Receiving')")
            page.click('#stop')
            assert page.evaluate("() => cameraTracks.every(track => track.readyState === 'ended')")
            assert page.evaluate("() => document.querySelector('#source').srcObject === null")
            page.click('#camera-test')
            page.wait_for_function("() => document.querySelector('#camera-check').textContent.includes('video frames received')")
            page.evaluate("() => cameraTracks.at(-1).dispatchEvent(new Event('ended'))")
            assert 'disconnected' in page.locator('#error').inner_text()
            assert page.evaluate("() => cameraTracks.at(-1).readyState === 'ended'")
            page.click('#camera-test')
            page.wait_for_function("() => document.querySelector('#camera-check').textContent.includes('video frames received')")
            page.evaluate('''() => { Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
              document.dispatchEvent(new Event('visibilitychange')); }''')
            assert page.locator('#camera-test-stop').is_disabled()
            assert page.evaluate("() => cameraTracks.every(track => track.readyState === 'ended')")
            page.evaluate('''() => { Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
              window.holdCamera = true; }''')
            page.click('#camera-test')
            page.wait_for_function('() => typeof window.releaseCamera === "function"')
            page.click('#camera-test-stop')
            page.evaluate('() => window.releaseCamera()')
            page.wait_for_function("() => cameraTracks.every(track => track.readyState === 'ended')")
            assert page.locator('#camera-test').is_enabled()
            assert not page.locator('#error').inner_text()
            # A refresh must retain an explicitly selected but currently missing device.
            chosen = page.locator('#camera-select').input_value()
            page.evaluate('() => { navigator.mediaDevices.enumerateDevices = async () => []; }')
            page.click('#camera-refresh')
            page.wait_for_function("() => document.querySelector('#camera-list-note').textContent.includes('list is empty')")
            assert page.locator('#camera-select').input_value() == chosen
            assert 'not in the current list' in page.locator('#camera-select option:checked').inner_text()
            page.evaluate('''() => { navigator.mediaDevices.enumerateDevices = async () => {
              throw new Error('enumeration unavailable'); }; }''')
            page.click('#camera-refresh')
            page.wait_for_function("() => document.querySelector('#camera-list-note').textContent.includes('list is unavailable')")
            assert page.locator('#camera-test').is_enabled()
            assert not errors, errors
            report.append({'cameraUI': engine.name, 'listedCameras': len(choices), 'testAndReceiveSwitch': True,
                'tracksReleased': True, 'hiddenStop': True, 'disconnect': True, 'latePermissionReleased': True,
                'emptyAndUnavailableList': True, 'previewSizes': [320, 1280]})
            print('camera UI', engine.name, 'PASS', len(choices), flush=True)
            context.close()
            for name, message in [('NotAllowedError', 'permission was denied'), ('NotFoundError', 'No available camera'),
                ('NotReadableError', 'Cannot open the camera'), ('OverconstrainedError', 'selected camera is unavailable')]:
                context = browser.new_context()
                context.add_init_script('''navigator.mediaDevices.getUserMedia = async () => {
                  throw new DOMException('test failure', ''' + json.dumps(name) + '''); };''')
                page = context.new_page()
                errors = errors_for(page)
                page.goto(url + '?lang=en')
                page.select_option('#role', 'receive')
                page.click('#camera-test')
                page.wait_for_function('(text) => document.querySelector("#error").textContent.includes(text)', arg=message)
                assert page.locator('#start').is_enabled()
                assert page.locator('#camera-test').is_enabled()
                assert page.locator('#camera-test-stop').is_disabled()
                assert not errors, errors
                context.close()
            report.append({'cameraErrors': engine.name, 'deniedMissingBusyUnavailable': True})
        finally:
            browser.close()


def camera_adapter(p, url, report):
    browser = p.chromium.launch(args=['--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream=device-count=2,fps=30'])
    try:
        page = browser.new_page()
        errors = errors_for(page)
        page.goto(url + '?lang=en')
        page.evaluate('''async () => {
          window.adapterFrames = 0;
          window.adapterVideo = document.createElement('video');
          window.adapter = PhotonCamera.create(adapterVideo, document.createElement('canvas'));
          await adapter.start({onFrame() { window.adapterFrames++; }});
          window.adapterDevices = await PhotonCamera.listCameras();
          window.oldTrack = adapterVideo.srcObject.getVideoTracks()[0];
        }''')
        page.wait_for_function('() => window.adapterFrames >= 30')
        assert page.evaluate('() => adapterDevices.length') == 2
        page.evaluate('''async () => {
          const next = adapterDevices.find(device => device.deviceId !== adapter.info.deviceId);
          window.nextDevice = next.deviceId;
          window.adapterFrames = 0;
          await adapter.start({deviceId:next.deviceId,onFrame() { window.adapterFrames++; }});
        }''')
        page.wait_for_function('() => window.adapterFrames >= 30')
        assert page.evaluate("() => oldTrack.readyState === 'ended' && adapter.info.deviceId === nextDevice")
        info = page.evaluate('() => ({width:adapter.info.width,height:adapter.info.height,fps:adapter.info.fps})')
        assert info['width'] == 640 and info['height'] == 480 and 25 < info['fps'] <= 31, info
        assert page.evaluate("""() => { const track=adapterVideo.srcObject.getVideoTracks()[0]; adapter.stop();
          return track.readyState === 'ended' && adapterVideo.srcObject === null; }""")
        assert not errors, errors
        report.append({'cameraAdapter': 'two devices; exact selection; old and final tracks released', **info})
        print('camera adapter PASS', info, flush=True)
    finally:
        browser.close()


def screen_transmission(p, url, report):
    for engine in [p.chromium, p.firefox]:
        browser = engine.launch()
        try:
            for mode in ['mono', 'color', 'bicolor']:
                context = browser.new_context(reduced_motion='no-preference')
                page = context.new_page()
                errors = errors_for(page)
                page.goto(url + '?lang=en')
                page.select_option('#mode', mode)
                assert page.locator('#rate').input_value() == '2'
                expected = page.evaluate('''() => PhotonReliable.transmission('LIGHT',
                  PhotonReliable.config({mode:document.querySelector('#mode').value}))''')
                # Read the canvas after each UI progress update, including the synchronous first symbol.
                page.evaluate('''() => {
                  window.sentFrames = []; window.counts = []; window.countTimes = [];
                  const countdown = document.querySelector('#tx-countdown');
                  new MutationObserver(() => {
                    const text = countdown.textContent;
                    if (text && text !== window.counts.at(-1)) {
                      window.counts.push(text); window.countTimes.push(performance.now());
                    }
                  }).observe(countdown,{childList:true,subtree:true});
                  const progress = document.querySelector('#tx-progress');
                  const ctx = document.querySelector('#tx').getContext('2d');
                  let last = 0;
                  new MutationObserver(() => {
                    const match = progress.textContent.match(/·\s*(\d+)\s*\/\s*(\d+)/);
                    if (!match || Number(match[1]) === last) return;
                    last = Number(match[1]);
                    if (!window.sentFrames.length) window.firstSymbolAt = performance.now();
                    window.sentFrames.push({index:last-1,
                      srgb:Array.from(ctx.getImageData(10,10,1,1).data).slice(0,3)});
                  }).observe(progress, {childList:true,subtree:true,characterData:true});
                }''')
                page.click('#start')
                if mode != 'mono':
                    assert page.locator('#warning-dialog').is_visible()
                    page.click('#warning-accept')
                # This new preparation phase is checked separately. The original packet deadline stays unchanged.
                assert page.locator('#tx-progress').inner_text() == ''
                assert page.evaluate('''() => Array.from(document.querySelector('#tx').getContext('2d')
                  .getImageData(10,10,1,1).data)''') == [128,128,128,255]
                page.wait_for_function('() => window.sentFrames.length > 0', timeout=4000)
                assert page.evaluate('() => window.counts') == ['③', '②', '①', 'Start']
                countdown_ms = page.evaluate('() => firstSymbolAt - countTimes[0]')
                assert 2950 <= countdown_ms <= 3500, countdown_ms
                started = monotonic()
                page.wait_for_function("() => document.querySelector('#status').textContent === 'Transmission finished'",
                    timeout=expected['seconds'] * 1000 + 2000)
                elapsed = monotonic() - started
                frames = page.evaluate('() => window.sentFrames')
                assert frames == [{'index': i, 'srgb': frame['srgb']}
                    for i, frame in enumerate(expected['frames'])], frames
                assert page.evaluate('''() => Array.from(document.querySelector('#tx').getContext('2d')
                  .getImageData(10,10,1,1).data)''') == [128, 128, 128, 255]
                assert page.locator('#start').is_enabled()
                assert page.locator('#stop').is_disabled()
                assert not page.locator('#error').inner_text()
                assert not errors, errors
                report.append({'sender': [engine.name, mode], 'symbols': len(frames), 'rate': 2,
                    'expectedSeconds': expected['seconds'], 'elapsedSeconds': round(elapsed, 3),
                    'countdownSeconds': round(countdown_ms/1000, 3), 'allPixelsMatch': True, 'finished': True})
                print('sender', engine.name, mode, len(frames), 'PASS', round(elapsed, 3), flush=True)
                context.close()
        finally:
            browser.close()


def transmission(p, url, report, capture):
    for mode in ['mono', 'color', 'bicolor']:
        file = movie(mode)
        for role in ['offline', 'receive']:
            args = [] if role == 'offline' else ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
                '--use-file-for-fake-video-capture=' + str(OUT / f'{mode}-2.y4m')]
            browser = p.chromium.launch(args=args)
            context = browser.new_context(viewport={'width': 1280, 'height': 1000})
            trace_receiver(context)
            if capture and role == 'receive':
                # Name the synthetic fixture explicitly instead of publishing its local file path.
                context.add_init_script('''const list = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
                  navigator.mediaDevices.enumerateDevices = async () => (await list()).map(device => ({
                    kind:device.kind,deviceId:device.deviceId,groupId:device.groupId,
                    label:device.kind === 'videoinput' ? 'Synthetic video camera' : device.label}));
                  const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
                  navigator.mediaDevices.getUserMedia = async constraints => {
                    const stream = await open(constraints);
                    for (const track of stream.getVideoTracks()) {
                      Object.defineProperty(track,'label',{value:'Synthetic video camera'});
                    }
                    return stream;
                  };''')
            page = context.new_page()
            errors = errors_for(page)
            page.goto(url + '?lang=en')
            page.select_option('#role', role)
            page.select_option('#mode', mode)
            if role == 'offline':
                page.set_input_files('#video-input', str(file))
                page.fill('#expected', 'LIGHT')
            page.click('#start')
            try:
                page.wait_for_function("() => document.querySelector('#live').textContent.length >= 2", timeout=25000)
            except Exception:
                save_receiver_trace(page, f'{mode}-{role}')
                raise
            if capture and role == 'receive' and mode == 'mono':
                assert 'Synthetic video camera' in page.locator('#camera-details').inner_text()
                screenshot(page, 'receive', 'en', '#receiver')
                page.click('#language')
                screenshot(page, 'receive', 'ja', '#receiver')
                page.click('#language')
            try:
                page.wait_for_function("() => document.querySelector('#crc').textContent === 'Pass'", timeout=25000)
            finally:
                save_receiver_trace(page, f'{mode}-{role}')
            assert page.locator('#result-text').inner_text() == 'LIGHT'
            assert page.locator('#agreement-field').is_visible() == (role == 'offline')
            assert page.evaluate("() => document.querySelector('#source').srcObject === null")
            assert page.locator('#video-input').input_value() == ''
            fps = page.locator('#env-fps').inner_text()
            assert 25 < float(fps.split()[0]) <= 31, fps
            if role == 'offline':
                assert page.locator('#agreement').inner_text() == '100.0% / 0.0%'
                # Next-session settings must not reinterpret the saved graph.
                legend = page.locator('#graph-legend').inner_text()
                page.select_option('#mode', 'color' if mode == 'mono' else 'mono')
                assert page.locator('#graph-legend').inner_text() == legend
                page.select_option('#mode', mode)
                # Language changes must render the saved result, not recalculate against edited expected text.
                page.fill('#expected', 'DIFFERENT')
                page.click('#language')
                assert page.locator('#agreement').inner_text() == '100.0% / 0.0%'
                page.click('#language')
            if capture and role == 'offline' and mode == 'mono':
                for language in ['en', 'ja']:
                    if page.locator('html').get_attribute('lang') != language:
                        page.click('#language')
                    assert page.locator('#result-text').inner_text() == 'LIGHT'
                    screenshot(page, 'result', language, '#results')
                    page.locator('#lesson-content details').nth(3).evaluate('el => { el.open = true; }')
                    screenshot(page, 'lesson', language, '#lessons')
                for language in ['en', 'ja']:
                    if page.locator('html').get_attribute('lang') != language:
                        page.click('#language')
                    page.select_option('#role', 'send')
                    page.click('#start')
                    page.wait_for_function("() => document.querySelector('#tx-progress').textContent.length > 0", timeout=4000)
                    screenshot(page, 'send', language, 'section:has(#role),#transmitter')
                    page.click('#stop')
            assert not errors, errors
            report.append({'path': [mode, role], 'text': 'LIGHT', 'crc': True, 'fps': fps})
            print(mode, role, 'PASS', fps, flush=True)
            context.close()
            browser.close()


def fallback_and_safety(p, url, report):
    browser = p.chromium.launch()
    context = browser.new_context()
    context.add_init_script('''delete HTMLVideoElement.prototype.requestVideoFrameCallback;
      Object.defineProperty(window, 'localStorage', {get() { throw new DOMException('blocked', 'SecurityError'); }});''')
    page = context.new_page()
    errors = errors_for(page)
    page.goto(url + '?lang=en')
    assert page.locator('#env-callback').inner_text() == 'rAF'
    page.select_option('#role', 'offline')
    page.set_input_files('#video-input', str(OUT / 'mono-2.webm'))
    started = monotonic()
    page.click('#start')
    page.wait_for_function("() => document.querySelector('#crc').textContent === 'Pass'", timeout=25000)
    assert page.locator('#result-text').inner_text() == 'LIGHT'
    elapsed = monotonic() - started
    fps = float(page.locator('#env-fps').inner_text().split()[0])
    assert 25 < fps <= 31, fps
    report.append({'fallback': 'rAF', 'text': 'LIGHT', 'crc': True, 'fps': fps, 'elapsedSeconds': round(elapsed, 3)})
    print('rAF PASS', fps, round(elapsed, 3), flush=True)
    assert not errors, errors
    # Reception also releases its local media when the tab becomes hidden.
    page.set_input_files('#video-input', str(OUT / 'mono-2.webm'))
    page.click('#start')
    page.wait_for_function("() => document.querySelector('#source').currentTime > 0.1")
    page.evaluate('''() => { Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
      document.dispatchEvent(new Event('visibilitychange')); }''')
    assert page.locator('#stop').is_disabled()
    assert page.evaluate("() => !document.querySelector('#source').hasAttribute('src')")
    assert 'hidden' in page.locator('#status').inner_text()
    page.evaluate("() => { Object.defineProperty(document,'hidden',{configurable:true,get:()=>false}); }")
    page.select_option('#role', 'send')
    page.select_option('#rate', '8')
    page.click('#start')
    assert page.locator('#warning-dialog').is_visible()
    page.click('#warning-accept')
    assert page.locator('#stop').is_enabled()
    page.evaluate('''() => { Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
      document.dispatchEvent(new Event('visibilitychange')); }''')
    assert page.locator('#stop').is_disabled()
    assert 'hidden' in page.locator('#status').inner_text()
    assert not errors, errors
    report.append({'fallback': 'rAF decoded LIGHT; storage blocked; warning and hidden-stop passed'})
    context.close()
    context = browser.new_context()
    context.add_init_script('''navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('denied','NotAllowedError'); };''')
    page = context.new_page()
    errors = errors_for(page)
    page.goto(url + '?lang=en')
    page.select_option('#role', 'receive')
    page.click('#start')
    page.wait_for_function("() => document.querySelector('#error').textContent.includes('denied')")
    assert page.locator('#start').is_enabled()
    assert not errors, errors
    report.append({'permissionDenied': 'error displayed; Start enabled; no uncaught errors'})
    context.close()
    browser.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--screenshots', action='store_true')
    parser.add_argument('--url')
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    url = args.url or f'http://127.0.0.1:{server.server_port}/'
    urls = [('https', url)] if args.url else [('http', url), ('file', (ROOT / 'index.html').as_uri())]
    report = []
    try:
        with sync_playwright() as p:
            interface(p, urls, report)
            print('UI PASS', len(report), flush=True)
            camera_adapter(p, url, report)
            camera_ui(p, url, report)
            screen_transmission(p, url, report)
            transmission(p, url, report, args.screenshots)
            fallback_and_safety(p, url, report)
    finally:
        server.shutdown()
        (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print('ALL PASS', OUT, flush=True)


if __name__ == '__main__':
    main()
