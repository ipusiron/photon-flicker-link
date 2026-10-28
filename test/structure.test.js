'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('index.html'), css = read('style.css'), M = require('../messages.js');
const scripts = ['codec-core.js', 'reliable-codec.js', 'spatial-codec.js', 'optical-panel.js',
  'camera-io.js', 'screen-tx.js', 'messages.js', 'app.js'];

test('F: restrictive CSP, blob-only local media addition, no inline script/style/handlers', () => {
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1].replace(/\s+/g, ' ');
  for (const item of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "media-src 'self' blob:",
    "connect-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-src 'none'", "object-src 'none'"]) {
    assert.ok(csp.includes(item), item);
  }
  assert.ok(!/unsafe-|frame-ancestors/.test(csp));
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.ok(!/\son\w+\s*=|\sstyle\s*=|<style\b|type="module"/.test(html));
  assert.equal([...html.matchAll(/<script\b/g)].length, scripts.length + 1);
  assert.equal([...html.matchAll(/<script src="[^"]+" defer><\/script>/g)].length, scripts.length);
  assert.ok(html.includes('<script src="theme-init.js"></script>'), 'theme-init.js runs before the first paint');
  assert.match(html, /<noscript>/);
  for (const script of scripts) assert.ok(html.includes(`src="${script}"`));
});
test('F: bilingual keys, visible prose and lesson structure', () => {
  assert.deepEqual(Object.keys(M.ja), Object.keys(M.en));
  for (const [, key] of html.matchAll(/data-(?:i18n|label)="([^"]+)"/g)) {
    assert.equal(typeof M.ja[key], 'string', key);
    assert.equal(typeof M.en[key], 'string', key);
  }
  assert.equal(M.lessons.length, 8);
  for (const lesson of M.lessons) {
    assert.equal(lesson.title.length, 2);
    assert.equal(lesson.text.length, 2);
    assert.ok(lesson.rows.length >= 2 && lesson.sources.length >= 1);
    lesson.rows.forEach(row => assert.equal(row.length, 4));
    lesson.sources.forEach(([, url]) => assert.match(url, /^https:\/\//));
  }
});
test('F: forbidden APIs/prose and only two persisted preferences', () => {
  const source = [...scripts, 'theme-init.js'].map(read).join('\n');
  for (const word of ['Worklet', 'WASM', 'fetch(', 'innerHTML', 'eval(', 'MediaRecorder', 'WebSocket']) {
    assert.ok(!source.includes(word), word);
  }
  for (const word of ['盗聴の検知', '乗っ取り', '追跡の判定', '照合', '突き合わせ', '効く', '走る', '向き', '全て', '分かる']) {
    assert.ok(!html.includes(word) && !read('messages.js').includes(word), word);
  }
  assert.match(read('app.js'), /save\('theme', theme\)/);
  assert.match(read('app.js'), /save\('language', language\)/);
  assert.equal((read('app.js').match(/localStorage\.setItem/g) || []).length, 1);
  assert.ok(!/sessionStorage|indexedDB|document\.cookie/.test(source));
});
test('F: unique IDs, all literal app element references exist and role count is three', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const [, id] of read('app.js').matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(id), id);
  const roles = html.match(/<select id="role">([\s\S]+?)<\/select>/)[1];
  assert.equal((roles.match(/<option/g) || []).length, 3);
});
test('F: readable source format and minimum module size', () => {
  const files = [...scripts, 'theme-init.js', 'style.css', ...fs.readdirSync(__dirname).filter(n => n.endsWith('.js')).map(n => 'test/' + n)];
  for (const file of files) read(file).split('\n').forEach((line, i) => assert.ok(line.length <= 160, `${file}:${i + 1}: ${line.length}`));
  html.split('\n').forEach((line, i) => assert.ok(line.length <= 250, `index.html:${i + 1}`));
  for (const file of scripts) assert.ok(read(file).split('\n').length > 50, file);
  assert.ok(css.split('\n').length > 140);
});
function luminance(hex) {
  const rgb = hex.match(/\w\w/g).map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
test('F: text >=4.5 and boundaries/focus >=3 in light and dark', () => {
  const blocks = [css.match(/:root \{([^}]+)\}/)[1], css.match(/:root\[data-theme="dark"\] \{([^}]+)\}/)[1]];
  const base = Object.fromEntries([...blocks[0].matchAll(/(--[\w-]+): (#[a-f0-9]{6});/g)].map(m => [m[1], m[2]]));
  for (const block of blocks) {
    const colors = { ...base, ...Object.fromEntries([...block.matchAll(/(--[\w-]+): (#[a-f0-9]{6});/g)].map(m => [m[1], m[2]])) };
    for (const foreground of ['--fg', '--muted', '--accent', '--warning', '--border', '--focus']) {
      for (const background of ['--bg', '--surface']) {
        const values = [luminance(colors[foreground]), luminance(colors[background])].sort((a, b) => b - a);
        const ratio = (values[0] + 0.05) / (values[1] + 0.05);
        assert.ok(ratio >= (['--border', '--focus'].includes(foreground) ? 3 : 4.5), `${foreground}/${background}: ${ratio}`);
      }
    }
    const a = luminance(colors['--accent']), b = luminance(colors['--on-accent']);
    assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5);
  }
});
