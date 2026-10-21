/* Photon Flicker Link - MIT (c) 2026 ipusiron.
 * Four simultaneous fields carry one serial bit and its separate clock.
 * The fixed frame carries no data. It only locates the fields and references. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./codec-core.js'));
  else root.PhotonPanel = factory(root.PhotonCodec);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';

  const WIDTH = 640, HEIGHT = 240, DARK = 0.015, LIGHT = 0.85;
  const FIELDS = Object.freeze([32, 180, 328, 476]);
  const LUT = Float64Array.from({ length: 256 }, (_, i) => C.srgbToLinear(i));
  const gray = value => {
    const channel = C.linearToSrgb(C.clamp(value));
    return `rgb(${channel}, ${channel}, ${channel})`;
  };

  function paint(ctx, width, height, values) {
    const fill = (x, y, w, h, value) => {
      ctx.fillStyle = gray(value);
      ctx.fillRect(x * width / WIDTH, y * height / HEIGHT, w * width / WIDTH, h * height / HEIGHT);
    };
    fill(0, 0, WIDTH, HEIGHT, LIGHT);
    fill(16, 16, 608, 208, DARK);
    FIELDS.forEach((x, i) => fill(x, 32, 132, 176, values[i]));
  }

  function draw(ctx, width, height, frame, settings = {}) {
    const low = Number.isFinite(settings.low) ? settings.low : 0.18;
    const high = Number.isFinite(settings.high) ? settings.high : 0.32;
    const bit = frame.bit ? 1 : 0, clock = frame.clock ? 1 : 0;
    paint(ctx, width, height, [bit, 1 - bit, clock, 1 - clock].map(value => value ? high : low));
  }

  function idle(ctx, width, height) { paint(ctx, width, height, [0.25, 0.25, 0.25, 0.25]); }

  function project(quad, x, y) {
    const u = (x - 16) / 608, v = (y - 16) / 208;
    return {
      x: quad[0].x * (1 - u) * (1 - v) + quad[1].x * u * (1 - v) + quad[2].x * u * v + quad[3].x * (1 - u) * v,
      y: quad[0].y * (1 - u) * (1 - v) + quad[1].y * u * (1 - v) + quad[2].y * u * v + quad[3].y * (1 - u) * v
    };
  }

  function luminance(image, x, y) {
    const ix = Math.round(x), iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) return NaN;
    const offset = (iy * image.width + ix) * 4, p = image.data;
    return 0.2126 * LUT[p[offset]] + 0.7152 * LUT[p[offset + 1]] + 0.0722 * LUT[p[offset + 2]];
  }

  function patch(image, quad, x, y, width = 6, height = 48) {
    const values = [];
    for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) {
      const point = project(quad, x + (col / 4 - 0.5) * width, y + (row / 6 - 0.5) * height);
      const value = luminance(image, point.x, point.y);
      if (!Number.isFinite(value)) return null;
      values.push(value);
    }
    values.sort((a, b) => a - b);
    const median = values[17], deviations = values.map(value => Math.abs(value - median)).sort((a, b) => a - b);
    const trimmed = values.slice(7, -7);
    return { mean: trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length,
      noise: deviations[17] * 1.4826, white: values.filter(value => value >= 0.98).length / values.length,
      dark: values.filter(value => value <= 0.002).length / values.length };
  }

  function inspect(image, quad, bounds) {
    const corners = [[0, 0], [640, 0], [640, 240], [0, 240]].map(([x, y]) => project(quad, x, y));
    if (corners.some(p => p.x < bounds.x - 1 || p.y < bounds.y - 1 || p.x > bounds.right || p.y > bounds.bottom)) return null;
    const dark = [24, 172, 320, 468, 616].map(x => patch(image, quad, x, 120));
    const white = [8, 632].map(x => patch(image, quad, x, 120));
    if ([...dark, ...white].some(value => !value)) return null;
    const blackAt = x => {
      const position = C.clamp((x - 24) / 148, 0, 4), index = Math.min(3, Math.floor(position));
      return dark[index].mean * (1 - position + index) + dark[index + 1].mean * (position - index);
    };
    const whiteAt = x => white[0].mean + (white[1].mean - white[0].mean) * (x - 8) / 624;
    const spans = FIELDS.map(x => whiteAt(x + 66) - blackAt(x + 66));
    if (Math.min(...spans) < 0.025) return null;
    // Validate both long rails at several positions; a plain rectangle is not a transmitter.
    for (const x of [56, 188, 320, 452, 584]) for (const y of [8, 24, 216, 232]) {
      const value = patch(image, quad, x, y, 20, 5);
      if (!value) return null;
      const span = whiteAt(x) - blackAt(x);
      const expected = y === 8 || y === 232 ? whiteAt(x) : blackAt(x);
      if (Math.abs(value.mean - expected) > span * 0.18 || value.noise > span * 0.12) return null;
    }
    const measured = FIELDS.map(x => patch(image, quad, x + 66, 120, 70, 80));
    if (measured.some(value => !value)) return null;
    const panels = measured.map(value => value.mean);
    const normalized = panels.map((value, i) => (value - blackAt(FIELDS[i] + 66)) / spans[i]);
    if (normalized.some(value => value < -0.05 || value > 1.05)) return null;
    const data = C.clamp(normalized[0] - normalized[1], -1, 1);
    const clock = C.clamp(normalized[2] - normalized[3], -1, 1);
    const qualityOf = (a, b, difference) => {
      const sensorSpan = Math.abs(panels[a] - panels[b]);
      const noise = Math.max(measured[a].noise, measured[b].noise);
      if (sensorSpan < Math.max(0.002, 6 * noise) || Math.abs(difference) < 0.04) return 0;
      return C.clamp(Math.abs(difference) / 0.15);
    };
    const dataQuality = qualityOf(0, 1, data), clockQuality = qualityOf(2, 3, clock);
    const quality = Math.min(dataQuality, clockQuality);
    const whiteFraction = measured.reduce((sum, value) => sum + value.white, 0) / 4;
    const darkFraction = measured.reduce((sum, value) => sum + value.dark, 0) / 4;
    const xs = corners.map(point => point.x), ys = corners.map(point => point.y);
    const rect = { x: Math.min(...xs) / image.width, y: Math.min(...ys) / image.height,
      w: (Math.max(...xs) - Math.min(...xs)) / image.width, h: (Math.max(...ys) - Math.min(...ys)) / image.height };
    return { found: true, data, clock, quality, dataQuality, clockQuality, panels, rect, geometry: quad,
      health: { white: whiteFraction, dark: darkFraction, clipped: whiteFraction + darkFraction },
      reason: quality ? null : 'panelContrast' };
  }

  function componentQuad(points, gridWidth, step, offset) {
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (const point of points) {
      const x = point % gridWidth, y = Math.floor(point / gridWidth);
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    }
    const count = points.length, vx = sxx - sx * sx / count, vy = syy - sy * sy / count, covariance = sxy - sx * sy / count;
    const angle = 0.5 * Math.atan2(2 * covariance, vx - vy);
    if (Math.abs(angle) > Math.PI / 12) return null;
    const cos = Math.cos(angle), sin = Math.sin(angle), extrema = [Infinity, -Infinity, -Infinity, Infinity], corners = [];
    for (const point of points) {
      const x = point % gridWidth, y = Math.floor(point / gridWidth), u = x * cos + y * sin, v = -x * sin + y * cos;
      for (let i = 0; i < 4; i++) {
        const score = i % 2 ? u - v : u + v;
        if (i === 0 || i === 3 ? score < extrema[i] : score > extrema[i]) {
          extrema[i] = score;
          corners[i] = { x: x * step + offset.x, y: y * step + offset.y };
        }
      }
    }
    const length = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const top = length(corners[0], corners[1]), bottom = length(corners[3], corners[2]);
    const left = length(corners[0], corners[3]), right = length(corners[1], corners[2]);
    const ratio = (top + bottom) / (left + right);
    if (Math.min(top, bottom) < 90 || Math.min(left, right) < 30 || ratio < 2.2 || ratio > 3.8) return null;
    if (Math.min(top, bottom) / Math.max(top, bottom) < 0.75 || Math.min(left, right) / Math.max(left, right) < 0.75) return null;
    return corners;
  }

  function locate(image, bounds) {
    // Coarse connected components only locate the frame; all guard and field measurements use original pixels.
    const step = Math.max(2, Math.ceil(image.width / 320), Math.ceil(image.height / 240));
    const width = Math.floor((bounds.right - bounds.x) / step), height = Math.floor((bounds.bottom - bounds.y) / step);
    const offset = { x: bounds.x + step / 2, y: bounds.y + step / 2 };
    const values = new Float64Array(width * height), histogram = new Uint32Array(256);
    values.forEach((_, i) => {
      const value = luminance(image, offset.x + i % width * step, offset.y + Math.floor(i / width) * step);
      values[i] = value;
      histogram[Math.round(value * 255)]++;
    });
    let lower = 0, upper = 255, total = 0;
    while (lower < 255 && (total += histogram[lower]) < values.length * 0.005) lower++;
    total = 0;
    while (upper > lower && (total += histogram[upper]) < values.length * 0.005) upper--;
    if ((upper - lower) / 255 < 0.025) return [];
    const found = [], queue = new Int32Array(values.length), visited = new Uint8Array(values.length);
    for (const fraction of [0.10, 0.25, 0.45, 0.65, 0.80]) {
      const threshold = (lower + (upper - lower) * fraction) / 255;
      visited.fill(0);
      for (let start = 0; start < values.length; start++) {
        if (visited[start] || values[start] > threshold) continue;
        let head = 0, tail = 1, minx = width, maxx = 0, miny = height, maxy = 0;
        queue[0] = start; visited[start] = 1;
        while (head < tail) {
          const point = queue[head++], x = point % width, y = Math.floor(point / width);
          minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
          for (let direction = 0; direction < 4; direction++) {
            const next = direction === 0 ? (x ? point - 1 : -1) : direction === 1 ? (x + 1 < width ? point + 1 : -1) :
              direction === 2 ? (y ? point - width : -1) : (y + 1 < height ? point + width : -1);
            if (next >= 0 && !visited[next] && values[next] <= threshold) { visited[next] = 1; queue[tail++] = next; }
          }
        }
        if (minx === 0 || miny === 0 || maxx === width - 1 || maxy === height - 1) continue;
        const ratio = (maxx - minx) / (maxy - miny);
        if ((maxx - minx) * step < 90 || (maxy - miny) * step < 30 || tail < 45 || ratio < 1.5 || ratio > 4.5) continue;
        const alreadyLocated = found.some(item => {
          const xs = item.geometry.map(point => point.x), ys = item.geometry.map(point => point.y);
          return Math.abs(Math.min(...xs) - (minx * step + offset.x)) <= step &&
            Math.abs(Math.max(...xs) - (maxx * step + offset.x)) <= step &&
            Math.abs(Math.min(...ys) - (miny * step + offset.y)) <= step &&
            Math.abs(Math.max(...ys) - (maxy * step + offset.y)) <= step;
        });
        if (alreadyLocated) continue;
        const quad = componentQuad(queue.subarray(0, tail), width, step, offset);
        const candidate = quad && inspect(image, quad, bounds);
        if (!candidate) continue;
        const duplicate = found.some(item => Math.abs(item.rect.x - candidate.rect.x) < 0.025 &&
          Math.abs(item.rect.y - candidate.rect.y) < 0.025 && Math.abs(item.rect.w - candidate.rect.w) < 0.05);
        if (!duplicate) found.push(candidate);
      }
      if (found.length > 1) return found;
    }
    return found;
  }

  function read(image, crop = {}, previous) {
    const absent = reason => ({ found: false, data: 0, clock: 0, quality: 0, dataQuality: 0, clockQuality: 0, panels: [], rect: null,
      health: { white: 0, dark: 0, clipped: 0 }, reason });
    if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || !image.data ||
        image.width < 96 || image.height < 36 || image.data.length < image.width * image.height * 4) return absent('panelMissing');
    const x = C.clamp(Number.isFinite(crop.x) ? crop.x : 0), y = C.clamp(Number.isFinite(crop.y) ? crop.y : 0);
    const w = C.clamp(Number.isFinite(crop.w) ? crop.w : 1, 0, 1 - x), h = C.clamp(Number.isFinite(crop.h) ? crop.h : 1, 0, 1 - y);
    const bounds = { x: Math.floor(x * image.width), y: Math.floor(y * image.height),
      right: Math.ceil((x + w) * image.width) - 1, bottom: Math.ceil((y + h) * image.height) - 1 };
    // Scan every frame so a second transmitter or a moved frame cannot inherit an old lock.
    const candidates = locate(image, bounds);
    if (candidates.length !== 1) return absent(candidates.length ? 'panelAmbiguous' : 'panelMissing');
    return candidates[0];
  }

  return Object.freeze({ draw, idle, read, layout: Object.freeze({ width: WIDTH, height: HEIGHT, fields: FIELDS }) });
}));
