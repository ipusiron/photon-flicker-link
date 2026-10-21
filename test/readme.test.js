'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../codec-core.js');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const docs = ['README.md', 'README.en.md'].map(read);
const header = text => text.match(/^<!--\r?\n---\r?\n([\s\S]*?)\r?\n---\r?\n-->/)?.[1];

test('README: matching metadata with required block lists and fixed identity', () => {
  assert.ok(header(docs[0]));
  assert.equal(header(docs[0]), header(docs[1]));
  for (const text of docs) {
    const yaml = header(text);
    for (const line of ['id: day122', 'slug: photon-flicker-link', 'hub: true',
      'repo_url: "https://github.com/ipusiron/photon-flicker-link"',
      'demo_url: "https://ipusiron.github.io/photon-flicker-link/"']) assert.ok(yaml.includes(line), line);
    for (const key of ['category_ja', 'category_en', 'tags']) assert.match(yaml, new RegExp(key + ':\\r?\\n  - '));
    assert.match(yaml, /category_ja:\r?\n  - プライバシー\r?\n  - 光学監視/);
    assert.match(yaml, /category_en:\r?\n  - Privacy\r?\n  - Optical Surveillance/);
  }
});
test('README: both throughput tables and UTF-8 examples agree with the codec', () => {
  assert.equal(C.config().rate, 2);
  assert.equal(C.config().levels, 2);
  assert.equal(C.MAX_BYTES, 8);
  for (const [i, text] of docs.entries()) {
    const rows = [...text.matchAll(/^\| (mono|color) \| ([248]) \| ([\d.]+) \| ([\d.]+) \| ([\d.]+) \|$/gm)];
    assert.equal(rows.length, 6);
    assert.equal(new Set(rows.map(r => r[1] + r[2])).size, 6);
    for (const [, mode, rate, raw, duration, net] of rows) {
      const cfg = C.config({ mode, rate: Number(rate) });
      assert.equal(Number(raw), cfg.bits * cfg.rate);
      assert.equal(Number(duration), C.duration(8, cfg));
      assert.equal(Number(net), Number((64 / C.duration(8, cfg)).toFixed(2)));
    }
    for (const word of ['A', 'LIGHT', '日本']) {
      const bytes = C.bytesOf(word).length, seconds = C.duration(bytes);
      assert.ok(text.includes(i === 0 ? `\`${word}\`（${bytes}バイト・${seconds}秒）` :
        `\`${word}\` (${bytes} byte${bytes === 1 ? '' : 's'}, ${seconds} s)`), word);
    }
    assert.ok(text.includes('17') && text.includes(String(17 * 8)) && text.includes('7/15/25/30%'));
  }
});
test('README: three required topics, source qualifications and bilingual section order', () => {
  const sections = docs.map(text => [...text.matchAll(/^## (.+)$/gm)].map(m => m[1]));
  assert.equal(sections[0].length, 14);
  assert.equal(sections[1].length, 14);
  const icons = ['🌐', '📸', '📖', '✨', '🔬', '🔄', '🎯', '🔗', '🔒', '🧪', '📁', '💻', '📄', '🛠️'];
  sections.forEach(list => list.forEach((title, i) => assert.ok(title.startsWith(icons[i]), title)));
  for (const text of docs) {
    for (const term of ['2 frame', '15 symbol/s', '4000 bit/s', 'LED-it-GO', 'MAGNETO / ODINI', 'BitWhisper',
      'AirHopper', 'PowerHammer', '1〜8 bit/hour', 'frame-ancestors', 'X-Frame-Options', '本人確認待ち']) {
      assert.ok(text.replaceAll('–', '〜').includes(term), term);
    }
    for (const url of ['https://akademeia.info/?page_id=53554', 'https://akademeia.info/?page_id=53563',
      'https://ipusiron.github.io/airborne-tone-link/', 'https://ipusiron.github.io/mic-gain-logger/']) {
      assert.ok(text.includes(url), url);
    }
    assert.ok(text.includes('エアギャップとは何か') && text.includes('将来展望'));
  }
  assert.ok(docs[0].includes('第2章') && docs[0].includes('第9章'));
  assert.ok(docs[1].includes('Chapter 2') && docs[1].includes('Chapter 9'));
  assert.match(docs[0], /## 🎯 ユースケース\s+このツールならではの使い方/);
  assert.match(docs[1], /## 🎯 Use cases\s+Ways of using this tool in particular/);
  assert.match(docs[0], /原論文未確認/);
  assert.match(docs[1], /original paper not checked/);
});
function files(dir = root) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (['.git', '.work', '__pycache__', 'node_modules'].includes(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : [path.relative(root, full).replaceAll('\\', '/')];
  });
}
test('README: every shipped file appears in the annotated directory tree', () => {
  for (const text of docs) {
    const tree = text.match(/```text\n([\s\S]+?)```/)[1];
    const stack = [], listed = [];
    for (const line of tree.trimEnd().split('\n')) {
      assert.match(line, / +# \S/);
      const entry = line.split(' # ')[0].trimEnd().replace(/^[│ ├└─]+/, '');
      const depth = line.indexOf(entry) / 4;
      assert.ok(Number.isInteger(depth));
      const full = depth <= 1 ? entry : stack[depth - 1] + entry;
      if (entry.endsWith('/')) stack[depth] = full;
      else listed.push(full);
    }
    assert.deepEqual(listed.sort(), files().sort());
  }
});
test('README: eight real PNGs, correct language paths, no unused images or broken local links', () => {
  const referenced = [];
  for (const [i, text] of docs.entries()) {
    const images = [...text.matchAll(/!\[[^\]]*\]\((assets\/[^)]+)\)/g)].map(m => m[1]);
    assert.equal(images.length, 4);
    for (const name of ['send', 'receive', 'result', 'lesson']) {
      assert.ok(images.includes(`assets/${i ? 'en/' : ''}${name}.png`));
    }
    for (const name of images) {
      const data = fs.readFileSync(path.join(root, name));
      assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.ok(data.length <= 300000 && data.readUInt32BE(16) >= 1000 && data.readUInt32BE(20) >= 500);
      const metadata = `| ${name} | ${data.readUInt32BE(16)}×${data.readUInt32BE(20)} | ${data.length} |`;
      assert.ok(read('docs/verification.md').includes(metadata), metadata);
    }
    referenced.push(...images);
    for (const [, link] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(https?:|#)/.test(link)) continue;
      assert.ok(fs.existsSync(path.join(root, link)), link);
    }
  }
  assert.deepEqual(referenced.sort(), files().filter(f => f.startsWith('assets/')).sort());
});
test('README: prose exclusions, limited emphasis and no obsolete development claims', () => {
  for (const text of [...docs, read('CLAUDE.md'), read('docs/verification.md')]) {
    for (const term of ['照合', '突き合わせ', '効く', '走る', '向き', '盗聴の検知', '乗っ取り', '追跡の判定', '全て', '分かる']) {
      assert.ok(!text.includes(term), term);
    }
  }
  for (const text of docs) {
    assert.ok(!text.includes('実装予定'));
    for (const section of text.split(/^## /m)) assert.ok((section.match(/\*\*[^*]+\*\*/g) || []).length <= 2);
  }
});
