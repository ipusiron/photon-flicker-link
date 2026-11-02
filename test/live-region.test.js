'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const source = name => {
  const start = app.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  return app.slice(start, app.indexOf('\n  }\n', start) + 4);
};
// A minimal element: textContent assignment counts as one DOM write, like a replaced text node.
const element = (text = '') => ({ text, writes: 0, children: [],
  get textContent() { return this.text; },
  set textContent(value) { this.text = String(value); this.children = []; this.writes++; },
  replaceChildren(...children) {
    this.children = children; this.text = children.map(child => child.textContent).join(''); this.writes++;
  },
  append(child) { this.children.push(child); this.text += child.textContent; } });
function helpers() {
  let now = 0;
  const timers = new Map();
  let nextTimer = 1;
  const clock = {
    performance: { now: () => now },
    setTimeout(fn, ms) { const id = nextTimer++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    },
    pending: () => timers.size
  };
  const document = { createElement: () => ({ textContent: '', className: '' }) };
  const pacing = app.match(/  const LIVE_GAP_MS = 1500, pacedLive = new Map\(\);\n/)[0];
  const api = new Function('performance', 'setTimeout', 'clearTimeout', 'document',
    source('setLiveText') + pacing + source('resetLivePacing') + source('announce') + source('paintText') +
    'return { setLiveText, announce, paintText, resetLivePacing };')(clock.performance, clock.setTimeout, clock.clearTimeout, document);
  return { ...api, clock };
}

test('live regions: identical text causes no DOM write', () => {
  const { setLiveText, paintText } = helpers();
  const status = element();
  assert.equal(setLiveText(status, 'Decoding'), true);
  for (let i = 0; i < 100; i++) assert.equal(setLiveText(status, 'Decoding'), false);
  assert.equal(status.writes, 1);
  assert.equal(setLiveText(status, 'Stopped'), true);
  assert.equal(status.writes, 2);
  const live = element();
  assert.equal(paintText(live, 'LI?H'), true);
  assert.equal(live.children.length, 4);
  assert.equal(live.children[2].className, 'uncertain');
  for (let i = 0; i < 100; i++) assert.equal(paintText(live, 'LI?H'), false);
  assert.equal(live.writes, 1);
  assert.equal(paintText(live, 'LIGH'), true);
  assert.equal(live.writes, 2);
});

test('live regions: paced status is spaced 1.5 s, flushes the latest text, and settles at once', () => {
  const { announce, resetLivePacing, clock } = helpers();
  const status = element();
  assert.equal(announce(status, 'Receiving', false), true);
  clock.advance(100);
  assert.equal(announce(status, 'Decoding', false), false);
  assert.equal(announce(status, 'Resynchronizing', false), false);
  assert.equal(status.textContent, 'Receiving');
  clock.advance(1399);
  assert.equal(status.textContent, 'Receiving');
  clock.advance(1);
  assert.equal(status.textContent, 'Resynchronizing');
  assert.equal(status.writes, 2);
  // Repeated frames with the same text neither write nor schedule anything.
  for (let i = 0; i < 50; i++) { clock.advance(90); announce(status, 'Resynchronizing', false); }
  assert.equal(status.writes, 2);
  assert.equal(clock.pending(), 0);
  // A pending intermediate text is dropped when the final state is written immediately.
  clock.advance(10);
  assert.equal(announce(status, 'Decoding', false), true);
  assert.equal(announce(status, 'Waiting for a new preamble', false), false);
  assert.equal(announce(status, 'Complete', true), true);
  assert.equal(clock.pending(), 0);
  clock.advance(5000);
  assert.equal(status.textContent, 'Complete');
  assert.equal(status.writes, 4);
  // A new busy session starts from a clean gap: its first text is announced at once.
  assert.equal(announce(status, 'Receiving', false), true);
  clock.advance(100);
  assert.equal(announce(status, 'Decoding', false), false);
  assert.equal(clock.pending(), 1);
  resetLivePacing();
  assert.equal(clock.pending(), 0);
  assert.equal(announce(status, 'Opening camera', false), true);
  assert.equal(status.writes, 6);
});

test('live regions: render routes every live region through the helpers', () => {
  const regions = [...html.matchAll(/<(?:p|output)\b[^>]*\bid="([^"]+)"[^>]*>/g)]
    .filter(([tag]) => /role="(?:status|alert)"|aria-live="(?:polite|assertive)"|^<output/.test(tag)).map(([, id]) => id);
  assert.deepEqual(regions.sort(), ['block-progress', 'camera-check', 'camera-list-note', 'error', 'live', 'receive-status',
    'result-text', 'status', 'tx-countdown'].sort());
  for (const id of regions) {
    const raw = new RegExp(`\\$\\('${id}'\\)\\.(?:textContent|innerText|innerHTML)\\s*=`);
    assert.ok(!raw.test(app), `${id} is written without setLiveText/announce/paintText`);
    assert.ok(new RegExp(`(?:setLiveText|announce|paintText)\\(\\$\\('${id}'\\)`).test(app) ||
      app.includes(`'${id}'`), id);
  }
  for (const id of ['status', 'receive-status', 'camera-check', 'camera-list-note']) {
    assert.match(app, new RegExp(`announce\\(\\$\\('${id}'\\), [^;]+, settled\\);`), id);
  }
  assert.match(app, /const settled = !busy;/);
  assert.match(app, /function setBusy\(value\) \{\n    busy = value;\n    resetLivePacing\(\);/);
  // The per-frame receive path still repaints the canvas but only rewrites live regions through the helpers.
  assert.match(app, /paintText\(\$\('live'\), live\)/);
});
