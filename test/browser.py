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
    code = 'const C=require("./codec-core.js"); console.log(JSON.stringify(C.transmission('
    code += json.dumps(text) + ',C.config(' + cfg + '))));'
    tx = json.loads(subprocess.check_output(['node', '-e', code], cwd=ROOT, text=True, encoding='utf-8'))
    file = OUT / f'{mode}-{levels}.webm'
    process = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo',
        '-pixel_format', 'rgb24', '-video_size', '160x120', '-framerate', '30', '-i', 'pipe:0',
        '-c:v', 'libvpx-vp9', '-lossless', '1', str(file)], stdin=subprocess.PIPE)
    for n in range(math.ceil((tx['seconds'] + 4) * 30)):
        index = math.floor((n / 30 - 3) * 8)
        rgb = tx['frames'][index]['srgb'] if 0 <= index < len(tx['frames']) else [118] * 3
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
                                page.select_option('#mode', 'color')
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


def transmission(p, url, report, capture):
    for mode in ['mono', 'color']:
        file = movie(mode)
        for role in ['offline', 'receive']:
            args = [] if role == 'offline' else ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
                '--use-file-for-fake-video-capture=' + str(OUT / f'{mode}-2.y4m')]
            browser = p.chromium.launch(args=args)
            context = browser.new_context(viewport={'width': 1280, 'height': 1000})
            page = context.new_page()
            errors = errors_for(page)
            page.goto(url + '?lang=en')
            page.select_option('#role', role)
            page.select_option('#mode', mode)
            if role == 'offline':
                page.set_input_files('#video-input', str(file))
                page.fill('#expected', 'LIGHT')
            page.click('#start')
            page.wait_for_function("() => document.querySelector('#live').textContent.length >= 2", timeout=25000)
            if capture and role == 'receive' and mode == 'mono':
                screenshot(page, 'receive', 'en', '#receiver')
                page.click('#language')
                screenshot(page, 'receive', 'ja', '#receiver')
                page.click('#language')
            page.wait_for_function("() => document.querySelector('#crc').textContent === 'Pass'", timeout=25000)
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
                    assert page.locator('#tx-progress').inner_text()
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
            transmission(p, url, report, args.screenshots)
            fallback_and_safety(p, url, report)
    finally:
        server.shutdown()
        (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print('ALL PASS', OUT, flush=True)


if __name__ == '__main__':
    main()
