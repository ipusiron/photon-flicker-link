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
import base64
import json
import math
import re
import subprocess
from time import monotonic
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.work' / ('browser-' + datetime.now().strftime('%Y%m%d_%H%M%S'))
OUT.mkdir(parents=True, exist_ok=True)


def movie(mode='mono', text='LIGHT', levels=2, rate=8, perspective=False):
    # Rasterize the shipped transmitter, then encode independent camera frames.
    # It carries one temporal bit, not a spatial payload or barcode.
    code = r'''const C=require('./spatial-codec.js'),P=require('./optical-panel.js'),G=require('./codec-core.js');
      const tx=C.transmission(JSON.parse(process.argv[1]),C.config({rate:Number(process.argv[2])})),rasters={};
      for(const key of ['idle','00','01','10','11']) {
        const image=Buffer.alloc(320*240*3,128);
        const ctx={fillStyle:'',fillRect(x,y,w,h) {
          const rgb=this.fillStyle.match(/\d+/g).map(Number).map(v=>G.linearToSrgb(G.srgbToLinear(v)*.65+.07));
          for(let yy=Math.floor(y+48);yy<Math.ceil(y+h+48);yy++)
            for(let xx=Math.floor(x+16);xx<Math.ceil(x+w+16);xx++)
              for(let c=0;c<3;c++)image[(yy*320+xx)*3+c]=rgb[c];
        }};
        if(key==='idle')P.idle(ctx,288,144);
        else P.draw(ctx,288,144,{bit:Number(key[0]),clock:Number(key[1])},tx.settings);
        // Independent camera warp: true perspective with a 15% shorter right edge, plus reflection.
        // Production drawing supplies pixels only; the detector receives no pose information.
        let observed=image;
        if(process.argv[3]==='perspective') {
          observed=Buffer.alloc(320*240*3,128);
          for(let y=0;y<240;y++)for(let x=0;x<320;x++) {
            const qx=(x+.5-16)/288,qy=(y+.5-48)/144,k=.85,a=(1-k)/2;
            const u=k*qx/(1-(1-k)*qx),v=(qy*(k+(1-k)*u)-a*u)/k;
            if(u<0||u>=1||v<0||v>=1)continue;
            const sx=Math.min(303,Math.floor(16+(1-u)*288)),sy=Math.floor(48+v*144);
            for(let c=0;c<3;c++)observed[(y*320+x)*3+c]=image[(sy*320+sx)*3+c];
          }
        }
        rasters[key]=observed.toString('base64');
      }
      console.log(JSON.stringify({tx,rasters}));'''
    generated = json.loads(subprocess.check_output(['node','-e',code,json.dumps(text),str(rate),
        'perspective' if perspective else 'flat'],cwd=ROOT,text=True,encoding='utf-8'))
    tx, rasters = generated['tx'], {key:base64.b64decode(value) for key,value in generated['rasters'].items()}
    suffix = ('' if rate == 8 else f'-rate{rate}') + ('-perspective' if perspective else '')
    file = OUT / f'{mode}-{levels}{suffix}.webm'
    process = subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo',
        '-pixel_format','rgb24','-video_size','320x240','-framerate','30','-i','pipe:0',
        '-c:v','libvpx-vp9','-lossless','1',str(file)],stdin=subprocess.PIPE)
    for n in range(math.ceil((tx['seconds']+.7)*30)):
        index = math.floor((n/30-.2)*rate)
        frame = tx['frames'][index] if 0<=index<len(tx['frames']) else None
        process.stdin.write(rasters[str(frame['bit'])+str(frame['clock'])] if frame else rasters['idle'])
    process.stdin.close()
    assert process.wait()==0
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(file),'-pix_fmt',
        'yuv420p',str(OUT/f'{mode}-{levels}{suffix}.y4m')],check=True)
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
    context.add_init_script('''window.receiveTrace = {samples:[],events:[],stops:[],panelCosts:[]};
      Object.defineProperty(window,'PhotonPanel',{configurable:true,set(original) {
        Object.defineProperty(window,'PhotonPanel',{value:{...original,read(...args) {
          const started=performance.now(),result=original.read(...args);
          receiveTrace.panelCosts.push(performance.now()-started);return result;
        }}});
      }});
      Object.defineProperty(window,'PhotonCamera',{configurable:true,set(original) {
        Object.defineProperty(window,'PhotonCamera',{value:{...original,create(...args) {
          const camera=original.create(...args), start=camera.start;
          camera.start=options=>start({...options,onFrame(frame) {
            const video=document.querySelector('#source'),quality=video?.getVideoPlaybackQuality?.();
            const record={...frame,at:performance.now(),playbackQuality:quality?{
              total:quality.totalVideoFrames,dropped:quality.droppedVideoFrames,decoded:video.webkitDecodedFrameCount}:null};
            receiveTrace.samples.push(record);options.onFrame(frame);
            record.appCost=performance.now()-record.at;
          },onStop(reason) {receiveTrace.stops.push(reason);options.onStop?.(reason);}});
          return camera;
        }}});
      }});
      Object.defineProperty(window,'PhotonSpatial',{configurable:true,set(original) {
        Object.defineProperty(window,'PhotonSpatial',{value:{...original,createDecoder(...args) {
          const decoder=original.createDecoder(...args), push=decoder.push;
          decoder.push=(...args)=>{const events=push(...args);
            receiveTrace.events.push(...structuredClone(events).map(event=>({...event,observedTime:args[0]})));return events;};
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


def signal_panel_accessibility(page, hover=False):
    if hover:
        page.locator('#tx').hover()
    state = page.evaluate('''() => {
      const tx = document.querySelector('#tx'), language = document.documentElement.lang;
      return {title:tx.getAttribute('title'),label:tx.getAttribute('aria-label'),
        expected:PhotonMessages[language].txLabel,cursor:getComputedStyle(tx).cursor,
        controls:['start','stop','help','preview'].map(id=>getComputedStyle(document.getElementById(id)).cursor),
        tooltips:['theme','language','help'].map(id=>{const el=document.getElementById(id);
          return el.title.length>0 && el.title===el.getAttribute('aria-label');})};
    }''')
    assert state['title'] is None, state
    assert state['label'] == state['expected'] and state['label'], state
    assert state['cursor'] == 'none', state
    assert all(cursor != 'none' for cursor in state['controls']), state
    assert all(state['tooltips']), state


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
                                assert page.locator('#mode').count() == 0
                                layout(page)
                            page.select_option('#role', 'send')
                            signal_panel_accessibility(page)
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
                            assert page.locator('#roi-x').input_value() == '1'
                            assert page.locator('#roi-x').evaluate("el => getComputedStyle(el).outlineStyle !== 'none'")
                            page.click('#region-reset')
                            assert page.locator('#roi-x').input_value() == '0'
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
                        test_label = 'Camera test: text is not decoded' if language == 'en' else 'カメラテスト中・文字は復号しません'
                        assert test_label in page.locator('#receive-stage').inner_text()
                        note = 'Camera test does not decode text' if language == 'en' else 'カメラテストでは文字を復号しません'
                        assert note in page.locator('#live-note').inner_text()
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
            page.click('#clear')
            assert 'Video has not started' in page.locator('#receive-stage').inner_text()
            page.click('#camera-test')
            page.wait_for_function('() => typeof window.releaseCamera === "function"')
            page.click('#camera-test-stop')
            assert 'Reception stopped' in page.locator('#receive-stage').inner_text()
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
    for engine in [p.chromium,p.firefox]:
        browser=engine.launch()
        try:
            context=browser.new_context(reduced_motion='no-preference')
            context.add_init_script('''window.sentFrames=[];
              Object.defineProperty(window,'PhotonScreen',{configurable:true,set(original) {
                Object.defineProperty(window,'PhotonScreen',{value:{...original,create(canvas,...args) {
                  const screen=original.create(canvas,...args),start=screen.start;
                  screen.start=(text,cfg,onFrame,onStop,prepare)=>start(text,cfg,frame=>{
                    const ctx=canvas.getContext('2d');
                    const pixels=[104,248,392,536].map(x=>ctx.getImageData(x,160,1,1).data[0]);
                    sentFrames.push({index:frame.index,pixels,time:performance.now(),held:frame.previousHeldSeconds});
                    onFrame(frame);
                  },reason=>{window.senderTiming=screen.info;onStop(reason);},prepare);
                  return screen;
                }}});
              }});''')
            page=context.new_page(); errors=errors_for(page)
            page.goto(url+'?lang=en'); page.fill('#text-input','A')
            idle_panel = '''() => {const canvas=document.querySelector('#tx');
              const panel=PhotonPanel.read(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height));
              return panel.found && panel.data===0 && panel.clock===0 && panel.quality===0;}'''
            assert page.evaluate(idle_panel), 'First-use idle panel is not recognizable'
            signal_panel_accessibility(page)
            assert page.locator('#rate').input_value()=='2'
            expected=page.evaluate("() => PhotonSpatial.transmission('A',PhotonSpatial.config())")
            page.evaluate('''() => {
              window.counts=[];window.countTimes=[];
              const countdown=document.querySelector('#tx-countdown');
              new MutationObserver(()=>{const text=countdown.textContent;
                if(text&&text!==counts.at(-1)){counts.push(text);countTimes.push(performance.now());}
              }).observe(countdown,{childList:true,subtree:true});
            }''')
            page.click('#start')
            assert page.locator('#tx-progress').inner_text()==''
            assert page.evaluate(idle_panel), 'Countdown panel is not recognizable'
            signal_panel_accessibility(page)
            page.wait_for_function('() => sentFrames.length>0',timeout=4000)
            signal_panel_accessibility(page)
            assert page.evaluate('() => counts')==['③','②','①','Start']
            countdown_ms=page.evaluate('() => sentFrames[0].time-countTimes[0]')
            assert 2950<=countdown_ms<=3500,countdown_ms
            started=monotonic()
            page.wait_for_function("() => document.querySelector('#status').textContent==='Transmission finished'",
                timeout=expected['seconds']*1000+2000)
            elapsed=monotonic()-started; frames=page.evaluate('() => sentFrames'); timing=page.evaluate('() => senderTiming')
            expected_pixels=page.evaluate('cfg=>[PhotonCodec.linearToSrgb(cfg.low),PhotonCodec.linearToSrgb(cfg.high)]',expected['settings'])
            assert [f['pixels'] for f in frames]==[[expected_pixels[v] for v in frame['values']] for frame in expected['frames']]
            assert [f['index'] for f in frames]==list(range(len(expected['frames'])))
            assert timing['holds']==len(expected['frames'])
            assert .5-1e-9<=timing['minHeldSeconds']<=timing['maxHeldSeconds']<=.6+1e-9,timing
            actual_holds=[(frames[i]['time']-frames[i-1]['time'])/1000 for i in range(1,len(frames))]
            assert min(actual_holds)>=.49 and max(actual_holds)<=.61,actual_holds
            assert page.locator('#start').is_enabled() and page.locator('#stop').is_disabled()
            signal_panel_accessibility(page)
            assert not page.locator('#error').inner_text() and not errors,errors
            page.select_option('#contrast', 'high')
            page.evaluate('() => {sentFrames.length=0;}')
            page.click('#start')
            assert page.locator('#warning-dialog').is_visible()
            page.click('#warning-cancel')
            assert page.evaluate('() => sentFrames.length') == 0
            page.click('#start')
            page.click('#warning-accept')
            page.wait_for_function('() => sentFrames.length>0', timeout=4000)
            assert sorted(set(page.evaluate('() => sentFrames[0].pixels'))) == [33, 237]
            high_panel = page.evaluate('''() => {const canvas=document.querySelector('#tx');
              const v=PhotonPanel.read(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height));
              return {found:v.found,data:v.dataQuality,clock:v.clockQuality};}''')
            assert high_panel == {'found': True, 'data': 1, 'clock': 1}, high_panel
            page.click('#stop')
            assert page.evaluate(idle_panel), 'High contrast stop must restore the static panel'
            signal_panel_accessibility(page)
            assert not errors, errors
            report.append({'sender':engine.name,'text':'A','symbols':len(frames),'rate':2,'timing':timing,
                'elapsedSeconds':round(elapsed,3),'countdownSeconds':round(countdown_ms/1000,3),'allPixelsMatch':True,
                'signalPanelAccessibility':True,
                'highContrast':'33/237 pixels, confirmation/cancel, readable data and clock'})
            print('sender',engine.name,'PASS',round(elapsed,3),timing,flush=True)
        finally:
            browser.close()


def transmission(p, url, report, capture):
    for mode in ['mono']:
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
            if role == 'offline':
                page.set_input_files('#video-input', str(file))
                page.fill('#expected', 'LIGHT')
            started=monotonic()
            page.click('#start')
            try:
                page.wait_for_function("() => document.querySelector('#live').textContent.length >= 2", timeout=25000)
            except Exception:
                save_receiver_trace(page, f'{mode}-{role}')
                raise
            try:
                remaining=max(1,25000-int((monotonic()-started)*1000))
                page.wait_for_function("() => document.querySelector('#crc').textContent === 'Pass'",timeout=remaining)
            finally:
                save_receiver_trace(page, f'{mode}-{role}')
            assert monotonic()-started<25, 'CRC exceeded the unchanged 25-second reception deadline'
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
                page.select_option('#rate', '4')
                assert page.locator('#graph-legend').inner_text() == legend
                page.select_option('#rate', '2')
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


def perspective_reception(p, url, report):
    file = movie(perspective=True)
    browser = p.chromium.launch()
    try:
        context = browser.new_context()
        trace_receiver(context)
        page = context.new_page()
        errors = errors_for(page)
        page.goto(url + '?lang=en')
        page.select_option('#role', 'offline')
        page.set_input_files('#video-input', str(file))
        page.fill('#expected', 'LIGHT')
        started = monotonic()
        page.click('#start')
        try:
            page.wait_for_function("() => document.querySelector('#crc').textContent === 'Pass'", timeout=25000)
        finally:
            save_receiver_trace(page, 'perspective-reflection')
        elapsed = monotonic() - started
        assert elapsed < 25
        assert page.locator('#result-text').inner_text() == 'LIGHT'
        assert page.locator('#agreement').inner_text() == '100.0% / 0.0%'
        assert not errors, errors
        report.append({'path':['perspective15-reflection','offline'],'text':'LIGHT','crc':True,
            'elapsedSeconds':round(elapsed,3),'fps':page.locator('#env-fps').inner_text()})
        print('perspective/reflection PASS', round(elapsed,3), flush=True)
    finally:
        browser.close()


def default_reception(p, url, report, capture=False):
    # This is a separate 2 symbol/s test. The 8 symbol/s CRC gate remains 25,000 ms.
    movie(rate=2)
    browser = p.chromium.launch(args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
        '--use-file-for-fake-video-capture=' + str(OUT / 'mono-2-rate2.y4m')])
    context = browser.new_context(viewport={'width':1280,'height':1000})
    trace_receiver(context)
    context.add_init_script('''const list=navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
      navigator.mediaDevices.enumerateDevices=async()=>(await list()).map(d=>({kind:d.kind,deviceId:d.deviceId,
        groupId:d.groupId,label:d.kind==='videoinput'?'Synthetic video camera':d.label}));
      const open=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await open(constraints);
        for(const track of stream.getVideoTracks())Object.defineProperty(track,'label',{value:'Synthetic video camera'});
        return stream;};''')
    page=context.new_page();errors=errors_for(page)
    page.goto(url+'?lang=en');page.select_option('#role','receive')
    expected=page.evaluate("() => PhotonSpatial.transmission('LIGHT',PhotonSpatial.config()).seconds")
    assert expected == 93
    deadline_ms=int(expected*1000+2000)
    started=monotonic();page.click('#start')
    try:
        page.wait_for_function("() => document.querySelector('#live').textContent === 'LIGH'",timeout=55000)
        if capture:
            assert 'Synthetic video camera' in page.locator('#camera-details').inner_text()
            screenshot(page,'receive','en','#receiver')
            page.click('#language');screenshot(page,'receive','ja','#receiver');page.click('#language')
        remaining=max(1,deadline_ms-int((monotonic()-started)*1000))
        page.wait_for_function("() => document.querySelector('#crc').textContent === 'Pass'",timeout=remaining)
    finally:
        save_receiver_trace(page,'mono-default-receive')
    assert page.locator('#result-text').inner_text()=='LIGHT'
    elapsed=monotonic()-started;fps=float(page.locator('#env-fps').inner_text().split()[0])
    assert elapsed<deadline_ms/1000 and 25<fps<=31,(elapsed,fps)
    assert not errors,errors
    report.append({'defaultReception':2,'text':'LIGHT','crc':True,'fps':fps,'elapsedSeconds':round(elapsed,3),
        'deadlineSeconds':deadline_ms/1000,'liveScreenshots':capture})
    print('default2sps receive PASS',fps,round(elapsed,3),flush=True)
    context.close();browser.close()


def fallback_and_safety(p, url, report):
    browser = p.chromium.launch()
    context = browser.new_context()
    trace_receiver(context)
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
    try:
        page.wait_for_function("() => document.querySelector('#crc').textContent === 'Pass'", timeout=25000)
    finally:
        save_receiver_trace(page,'mono-offline-raf')
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
    # A hidden live camera can report compositor drops while drawImage still reads decoded frames.
    # Exercise its fallback independently from the local-file video path.
    browser = p.chromium.launch(args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
        '--use-file-for-fake-video-capture=' + str(OUT / 'mono-2.y4m')])
    context = browser.new_context()
    context.add_init_script('delete HTMLVideoElement.prototype.requestVideoFrameCallback;')
    trace_receiver(context)
    page = context.new_page(); errors = errors_for(page)
    page.goto(url + '?lang=en'); page.select_option('#role','receive')
    started = monotonic(); page.click('#start')
    try:
        page.wait_for_function("() => document.querySelector('#crc').textContent === 'Pass'",timeout=25000)
    finally:
        save_receiver_trace(page,'mono-live-raf')
    assert page.locator('#result-text').inner_text() == 'LIGHT'
    fps = float(page.locator('#env-fps').inner_text().split()[0])
    assert 25 < fps <= 31, fps
    assert not errors, errors
    report.append({'fallback':'live rAF','text':'LIGHT','crc':True,'fps':fps,'elapsedSeconds':round(monotonic()-started,3)})
    print('live rAF PASS',fps,flush=True)
    context.close(); browser.close()


def drag_region(page, engine):
    preview = page.locator('#preview')
    preview.evaluate('''el => {window.roiEvents=[];
      for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','mousedown','mousemove'])
        el.addEventListener(type,e=>roiEvents.push([type,e.clientX,e.clientY,e.pointerId,e.button]));}''')
    def values():
        return [int(page.locator('#roi-' + key).input_value()) for key in ['x','y','w','h']]
    def drag(origin, end):
        preview.scroll_into_view_if_needed()
        box = preview.bounding_box()
        point = lambda p: (box['x'] + p[0] * box['width'], box['y'] + p[1] * box['height'])
        old_values, old_image = values(), preview.evaluate('(el) => el.toDataURL()')
        page.mouse.move(*point(origin)); page.mouse.down()
        page.mouse.move(*point(end), steps=5)
        assert values() == old_values, 'Crop must change only on release'
        assert preview.evaluate('(el) => el.toDataURL()') != old_image, {
            'error':'No live drag feedback','engine':engine,'origin':origin,'end':end,
            'enabled':page.locator('#preview-enabled').is_checked(),'events':page.evaluate('() => roiEvents.slice(-15)'),
            'box':box,'hit':page.evaluate('p => document.elementFromPoint(...p)?.outerHTML.slice(0,150)',point(origin))}
        page.mouse.up()
    def reset_small():
        for key,value in zip(['x','y','w','h'],[30,30,40,40]):
            page.locator('#roi-'+key).evaluate('(el,value)=>{el.value=value;el.dispatchEvent(new Event("input"));}',str(value))
    for origin, end, expected in [((.3,.3),(.2,.2),[20,20,50,50]),
            ((.7,.3),(.8,.2),[30,20,50,50]), ((.3,.7),(.2,.8),[20,30,50,50]),
            ((.7,.7),(.8,.8),[30,30,50,50])]:
        reset_small(); drag(origin,end)
        assert values() == expected, values()
    reset_small(); drag((.5,.5),(.4,.4))
    assert values() == [20,20,40,40], values()
    drag((.4,.4),(.95,.95))
    assert values() == [60,60,40,40], values()
    reset_small(); drag((.05,.05),(.25,.25))
    assert values() == [5,5,20,20], values()
    before = values(); preview.click(position={'x':10,'y':10})
    assert values() == before, 'A click must not replace the rectangle'
    reset_small()
    if engine == 'chromium':
        preview.scroll_into_view_if_needed()
        box = preview.bounding_box(); session = page.context.new_cdp_session(page)
        for kind, x, y in [('touchStart',.7,.7),('touchMove',.8,.8)]:
            session.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':[
                {'x':box['x']+x*box['width'],'y':box['y']+y*box['height']} ]})
        session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
        assert values() == [30,30,50,50], values()
        session.detach(); page.click('#region-reset')


def reception_stages(page, engine, report):
    expected = {
        'en': ['Video has not started', 'Camera test: text is not decoded', 'Panel not detected',
            'More than one panel candidate', 'waiting for clock contrast', 'Waiting for the preamble',
            'Receiving the header', 'Receiving this block', 'Waiting for the next block', 'Reception stopped'],
        'ja': ['映像の取得はまだ始まっていません', 'カメラテスト中・文字は復号しません', 'パネルを検出できません',
            'パネルの候補が複数', 'クロックの明暗差を待っています', '同期列を待っています',
            'ヘッダーを受信しています', 'このブロックを受信中', '次のブロックの同期列', '受信停止']
    }
    for width in [320, 1280]:
        page.set_viewport_size({'width': width, 'height': 900})
        for language in ['en', 'ja']:
            if page.locator('html').get_attribute('lang') != language:
                page.click('#language')
            page.click('#clear')
            words = expected[language]
            assert words[0] in page.locator('#receive-stage').inner_text()
            assert '40' in page.locator('#live-empty').inner_text() and '52' in page.locator('#live-empty').inner_text()
            assert page.locator('#receive-stage').get_attribute('aria-live') == 'off'
            assert page.locator('#live').inner_text() == ''
            assert page.locator('#live-empty').is_visible()
            assert page.locator('#receive-meter').evaluate('(el) => [el.value, el.max]') == [0, 1]
            assert page.locator('#receive-estimate').is_hidden()
            assert page.locator('#signal-data').get_attribute('data-state') == 'unmeasured'
            page.click('#camera-test')
            page.evaluate('''() => testReceive.frame(0,{found:false,data:0,clock:0,quality:0,
              reason:'panelMissing',markerCount:0})''')
            assert words[1] in page.locator('#receive-stage').inner_text()
            assert words[2] in page.locator('#receive-stage').inner_text()
            assert page.locator('#live').inner_text() == ''
            page.evaluate('''() => testReceive.frame(.2,{found:true,data:0,clock:0,quality:0,
              dataQuality:0,clockQuality:0,markerCount:4})''')
            assert words[1] in page.locator('#receive-stage').inner_text()
            assert 'Start reception' in page.locator('#receive-stage').inner_text() if language == 'en' else \
                '「受信開始」' in page.locator('#receive-stage').inner_text()
            page.click('#camera-test-stop')
            assert words[9] in page.locator('#receive-stage').inner_text()
            assert words[0] not in page.locator('#receive-stage').inner_text()
            page.click('#start')
            page.evaluate('''() => testReceive.frame(0,{found:false,data:0,clock:0,quality:0,
              reason:'panelMissing',markerCount:2})''')
            assert words[2] in page.locator('#receive-stage').inner_text()
            assert '2 / 4' in page.locator('#receive-stage').inner_text()
            assert page.locator('#signal-panel').get_attribute('data-state') == 'missing'
            assert page.locator('#signal-clock').get_attribute('data-state') == 'unmeasured'
            page.evaluate('''() => testReceive.frame(.2,{found:false,data:0,clock:0,quality:0,
              reason:'panelAmbiguous',markerCount:4})''')
            assert words[3] in page.locator('#receive-stage').inner_text()
            page.evaluate('''() => testReceive.frame(.4,{found:true,data:0,clock:0,quality:0,
              dataQuality:0,clockQuality:0,markerCount:4})''')
            assert words[4] in page.locator('#receive-stage').inner_text()
            assert page.locator('#signal-panel').get_attribute('data-state') == 'found'
            assert page.locator('#signal-data').get_attribute('data-state') == 'insufficient'
            assert page.locator('#signal-clock').get_attribute('data-state') == 'insufficient'
            page.evaluate('''() => testReceive.frame(.6,{found:true,data:.17,clock:.17,quality:1,
              dataQuality:1,clockQuality:1,markerCount:4})''')
            assert words[5] in page.locator('#receive-stage').inner_text()
            assert page.locator('#live').inner_text() == ''
            assert page.locator('#signal-data').get_attribute('data-state') == 'sufficient'
            assert page.locator('#signal-clock').get_attribute('data-state') == 'sufficient'
            assert page.locator('#receive-meter').evaluate('(el) => [el.value, el.max]') == [0, 1]
            assert page.locator('#receive-estimate').is_hidden()
            page.evaluate('''() => testReceive.frame(.8,{found:true,data:.001,clock:.17,quality:0,
              dataQuality:0,clockQuality:1,markerCount:4})''')
            assert page.locator('#signal-data').get_attribute('data-state') == 'insufficient'
            assert page.locator('#signal-clock').get_attribute('data-state') == 'sufficient'
            page.evaluate('''() => {
              const tx=PhotonSpatial.transmission('LIGHT',PhotonSpatial.config({rate:2}));let n=0;
              window.stageUntil = until => {for(;n/30<until;n++) {
                const frame=tx.frames[Math.floor(n/15)];if(!frame)continue;
                testReceive.frame(2+n/30,{found:true,data:frame.bit?.17:-.17,clock:frame.clock?.17:-.17,
                  quality:1,dataQuality:1,clockQuality:1,markerCount:4});
              }};
            }''')
            # Supply the normal 90 ms UI redraw cadence after each protocol event.
            page.evaluate('() => stageUntil(8.2)')
            assert words[6] in page.locator('#receive-stage').inner_text()
            assert page.locator('#live').inner_text() == ''
            assert page.locator('#receive-meter').evaluate('(el) => [el.value, el.max]') == [0, 16]
            assert page.locator('#receive-estimate').is_hidden()
            page.evaluate('() => stageUntil(17.2)')
            assert words[7] in page.locator('#receive-stage').inner_text()
            assert page.locator('#live').inner_text() == ''
            assert page.locator('#crc').inner_text() == '—'
            assert page.locator('#receive-meter').evaluate('(el) => [el.value, el.max]') == [18, 88]
            assert page.locator('#receive-estimate').is_visible()
            assert '35' in page.locator('#receive-estimate').inner_text()
            layout(page)
            if engine == 'chromium':
                page.locator('.receive-monitor').screenshot(
                    path=str(OUT / f'receive-progress-{width}-{language}.png'), caret='initial')
            page.evaluate('() => stageUntil(52.2)')
            assert words[8] in page.locator('#receive-stage').inner_text()
            assert page.locator('#live').inner_text() == 'LIGH'
            assert '1 / 2' in page.locator('#block-progress').inner_text(), page.locator('#block-progress').inner_text()
            assert page.locator('#crc').inner_text() == '—'
            assert page.locator('#live-empty').is_hidden()
            assert page.locator('#receive-estimate').is_hidden()
            # A newly acquired header must replace the previous block's completed bit count.
            page.evaluate('() => stageUntil(60.2)')
            assert words[6] in page.locator('#receive-stage').inner_text()
            assert page.locator('#receive-meter').evaluate('(el) => [el.value, el.max]') == [0, 16]
            assert page.locator('#receive-estimate').is_hidden()
            page.evaluate('() => stageUntil(60.9)')
            assert words[7] in page.locator('#receive-stage').inner_text()
            assert '1 / ?' in page.locator('#receive-stage').inner_text()
            assert page.locator('#receive-meter').evaluate('(el) => [el.value, el.max]') == [1, 16]
            page.evaluate('() => stageUntil(93)')
            assert words[9] in page.locator('#receive-stage').inner_text()
            assert page.locator('#live').inner_text() == 'LIGHT'
            assert page.locator('#crc').inner_text() == ('Pass' if language == 'en' else '成功')
            assert page.locator('#receive-meter').evaluate('(el) => [el.value, el.max]') == [64, 64]
            assert page.locator('#receive-estimate').is_hidden()
            assert page.locator('#signal-data').get_attribute('data-state') == 'unmeasured'
            layout(page)
            if language == 'en':
                no_japanese(page)
    if page.locator('html').get_attribute('lang') != 'en':
        page.click('#language')
    page.set_viewport_size({'width': 320, 'height': 900})
    page.click('#clear')
    report.append({'receptionStages': engine, 'languages': ['en', 'ja'], 'widths': [320, 1280],
        'emptyUntilCheckedBlock': True, 'cameraTestNoDecoding': True, 'secondHeaderReplacesCompletedCount': True,
        'observedBitProgress': '18/88, 35s estimate; header reset 0/16 then 1/16; complete 64/64',
        'independentContrastIndicators': True})


def reception_diagnostics(p, url, report):
    for engine in [p.chromium, p.firefox, p.webkit]:
        browser = engine.launch()
        context = browser.new_context(viewport={'width': 320, 'height': 900}, color_scheme='dark', has_touch=True)
        context.add_init_script('''Object.defineProperty(window,'PhotonCamera',{configurable:true,set(original) {
          Object.defineProperty(window,'PhotonCamera',{value:{...original,create() {
            let active=false, elapsed=0, frames=0;
            const info=()=>({fps:30,frames,width:640,height:480,exposure:'unsupported',whiteBalance:'unsupported',
              callback:'synthetic',elapsedSeconds:elapsed,remainingSeconds:Math.max(0,240-elapsed),
              deviceId:'PRIVATE_DEVICE',label:'PRIVATE_CAMERA'});
            return {async start(options) {active=true;elapsed=0;frames=0;
              window.testReceive = {frame(time,optical) {if(!active)return; elapsed=time;frames++;
                const rgb=[(optical.data+1)/2,(optical.clock+1)/2,optical.quality];
                options.onFrame({time,rgb,optical,health:{white:0,dark:0,clipped:0},stats:info()});},
                timeout(){elapsed=240;active=false;options.onStop('timeout');}};return info();},
              stop(){active=false;},setRegion:original.region,get active(){return active;},get info(){return info();}};
          }}});
        }});''')
        page = context.new_page()
        errors = errors_for(page)
        page.goto(url + '?lang=en')
        signal_panel_accessibility(page, hover=True)
        page.click('#language')
        signal_panel_accessibility(page, hover=True)
        page.click('#clear')
        signal_panel_accessibility(page, hover=True)
        page.click('#language')
        page.select_option('#role', 'receive')
        page.evaluate('''() => {window.packet = (bad,offset=0) => {
          const C=PhotonSpatial,tx=C.transmission('A',C.config({rate:8}));
          for(let n=0;n/30<tx.seconds+1;n++) {
            const time=n/30,index=Math.floor((time-.37)*8);
            const frame=tx.frames[index];
            const erased=bad && index>=48 && index<72;
            testReceive.frame(time+offset,{found:!!frame,data:frame?(frame.bit? .17:-.17):0,
              clock:frame?(frame.clock? .17:-.17):0,quality:frame&&!erased?1:0,
              dataQuality:frame&&!erased?1:0,clockQuality:frame?1:0});
          }
        };}''')
        reception_stages(page, engine.name, report)
        page.click('#start')
        drag_region(page,engine.name)
        page.evaluate('() => packet(true)')
        assert page.locator('#crc').inner_text() != 'Pass'
        first_graph = page.locator('#graph').evaluate('(el) => el.toDataURL()')
        page.evaluate('() => {for(let n=0;n<90;n++)testReceive.frame(25+n/30,{found:true,data:.1+n/1000,clock:0,quality:0});}')
        second_graph = page.locator('#graph').evaluate('(el) => el.toDataURL()')
        assert first_graph != second_graph, 'Graph froze after packet rejection'
        assert 'Measuring' in page.locator('#graph-state').inner_text()
        page.evaluate('() => packet(false,30)')
        assert page.locator('#result-text').inner_text() == 'A'
        assert page.locator('#crc').inner_text() == 'Pass'
        assert 'Measurement stopped' in page.locator('#graph-state').inner_text()
        assert page.locator('#receive-again').is_visible()
        page.locator('details:has(#diagnostic-save)').evaluate('(el) => {el.open=true;}')
        with page.expect_download() as download_info:
            page.click('#diagnostic-save')
        path = OUT / f'diagnostic-{engine.name}.json'
        download_info.value.save_as(str(path))
        diagnostic = json.loads(path.read_text(encoding='utf-8'))
        assert diagnostic['stopReason'] == 'complete'
        assert any(e['type'] == 'resync' for e in diagnostic['events'])
        assert any(e['type'] == 'result' and e['valid'] for e in diagnostic['events'])
        assert not diagnostic['truncated']
        assert 'PRIVATE_' not in path.read_text(encoding='utf-8')
        replay = '''const fs=require('node:fs'),C=require('./spatial-codec.js');
          const log=JSON.parse(fs.readFileSync(process.argv[1],'utf8')),d=C.createDecoder(C.config({mode:log.mode}));
          const events=log.samples.flatMap(s=>d.push(s[0],{data:s[1],clock:s[2],dataQuality:s[3],clockQuality:s[4],
            quality:Math.min(s[3],s[4]),found:!!s[5]}));
          const result=events.find(e=>e.type==='result');
          if(!result?.valid || result.text!=='A')process.exit(1);'''
        subprocess.run(['node', '-e', replay, str(path)], cwd=ROOT, check=True)
        layout(page)
        # Playwright WebKit's screenshot preparation injects a body{} style, rejected by this CSP.
        # Keep all WebKit interaction/layout/console checks; capture with Chromium and Firefox.
        if engine.name != 'webkit':
            page.locator('#graph-state').scroll_into_view_if_needed()
            page.screenshot(path=str(OUT / f'diagnostic-{engine.name}-320.png'), caret='initial')
        old_graph = page.locator('#graph').evaluate('(el) => el.toDataURL()')
        page.click('#receive-again')
        assert page.locator('#graph').evaluate('(el) => el.toDataURL()') != old_graph
        assert page.locator('#diagnostic-save').is_disabled()
        page.evaluate('() => {for(let n=0;n<45;n++)testReceive.frame(n/30,{found:false,data:0,clock:0,quality:0});testReceive.timeout();}')
        assert 'Reception stopped at its time limit' in page.locator('#graph-state').inner_text()
        assert page.locator('#receive-again').is_visible()
        page.click('#receive-again')
        page.evaluate('() => {testReceive.frame(0,{found:true,data:.17,clock:.17,quality:1});testReceive.frame(.2,{found:true,data:-.17,clock:-.17,quality:1});}')
        assert 'Measuring' in page.locator('#graph-state').inner_text()
        page.click('#stop')
        page.set_viewport_size({'width':1280,'height':900})
        page.click('#language')
        assert '測定停止' in page.locator('#graph-state').inner_text()
        layout(page)
        if engine.name != 'webkit':
            page.locator('#receiver').screenshot(path=str(OUT / f'diagnostic-{engine.name}-1280-ja.png'), caret='initial')
        assert not errors, errors
        report.append({'diagnostics':engine.name,'badPacketThenResend':'A CRC pass; graph updated',
            'savedSamples':len(diagnostic['samples']),'replay':'A CRC pass','timeoutRestart':True,
            'signalPanelHover':'no title/cursor; accessible label retained after language change and clear',
            'roi':'4 corners, move, new, clamp, click; Chromium also touch drag'})
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
            reception_diagnostics(p, url, report)
            screen_transmission(p, url, report)
            transmission(p, url, report, args.screenshots)
            perspective_reception(p, url, report)
            default_reception(p, url, report, args.screenshots)
            fallback_and_safety(p, url, report)
    finally:
        server.shutdown()
        (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print('ALL PASS', OUT, flush=True)


if __name__ == '__main__':
    main()
