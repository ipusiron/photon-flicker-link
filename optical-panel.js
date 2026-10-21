/* Photon Flicker Link - MIT (c) 2026 ipusiron.
 * Four fields carry one serial bit and its clock. Static corner/pose marks carry no payload. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./codec-core.js'));
  else root.PhotonPanel = factory(root.PhotonCodec);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';
  const WIDTH = 640, HEIGHT = 320, DARK = 0.015, LIGHT = 0.85;
  const FIELDS = Object.freeze([48, 192, 336, 480]);
  const CORNERS = Object.freeze([[16, 16], [624, 16], [624, 304], [16, 304]]);
  const LUT = Float64Array.from({ length: 256 }, (_, i) => C.srgbToLinear(i));
  const gray = value => { const v = C.linearToSrgb(C.clamp(value)); return `rgb(${v}, ${v}, ${v})`; };
  function paint(ctx, width, height, values) {
    const fill = (x, y, w, h, value) => {
      ctx.fillStyle = gray(value);
      ctx.fillRect(x * width / WIDTH, y * height / HEIGHT, w * width / WIDTH, h * height / HEIGHT);
    };
    fill(0, 0, WIDTH, HEIGHT, LIGHT);
    for (let i = 0; i < 4; i++) {
      const [x, y] = CORNERS[i], sx = i === 0 || i === 3 ? 1 : -1, sy = i < 2 ? 1 : -1;
      fill(x + (sx < 0 ? -80 : 0), y + (sy < 0 ? -24 : 0), 80, 24, DARK);
      fill(x + (sx < 0 ? -24 : 0), y + (sy < 0 ? -80 : 0), 24, 80, DARK);
    }
    // Unequal fixed bars establish orientation, including reflection. They never encode data.
    fill(128, 24, 96, 24, DARK); fill(272, 24, 24, 48, DARK);
    fill(16, 112, 608, 96, DARK);
    FIELDS.forEach((x, i) => fill(x, 120, 112, 80, values[i]));
  }
  function draw(ctx, width, height, frame, settings = {}) {
    const low = Number.isFinite(settings.low) ? settings.low : 0.18, high = Number.isFinite(settings.high) ? settings.high : 0.32;
    const bit = frame.bit ? 1 : 0, clock = frame.clock ? 1 : 0;
    paint(ctx, width, height, [bit, 1 - bit, clock, 1 - clock].map(v => v ? high : low));
  }
  function idle(ctx, width, height) { paint(ctx, width, height, [0.25, 0.25, 0.25, 0.25]); }
  function pixel(image, x, y) {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return NaN;
    const n = (y * image.width + x) * 4, p = image.data;
    return 0.2126 * LUT[p[n]] + 0.7152 * LUT[p[n + 1]] + 0.0722 * LUT[p[n + 2]];
  }
  function luminance(image, x, y) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    if (ix < 0 || iy < 0 || ix + 1 >= image.width || iy + 1 >= image.height) return NaN;
    return pixel(image, ix, iy) * (1 - fx) * (1 - fy) + pixel(image, ix + 1, iy) * fx * (1 - fy) +
      pixel(image, ix, iy + 1) * (1 - fx) * fy + pixel(image, ix + 1, iy + 1) * fx * fy;
  }
  function homography(quad) {
    const a = [];
    CORNERS.forEach(([x, y], i) => { const { x: u, y: v } = quad[i];
      a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]); });
    for (let col = 0; col < 8; col++) {
      let pivot = col;
      for (let row = col + 1; row < 8; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
      if (Math.abs(a[pivot][col]) < 1e-9) return null;
      [a[col], a[pivot]] = [a[pivot], a[col]];
      const scale = a[col][col]; for (let k = col; k < 9; k++) a[col][k] /= scale;
      for (let row = 0; row < 8; row++) if (row !== col) {
        const factor = a[row][col]; for (let k = col; k < 9; k++) a[row][k] -= factor * a[col][k];
      }
    }
    const m = a.map(row => row[8]); return m.every(Number.isFinite) ? m : null;
  }
  function project(m, x, y) { const d = m[6] * x + m[7] * y + 1;
    return { x: (m[0] * x + m[1] * y + m[2]) / d, y: (m[3] * x + m[4] * y + m[5]) / d }; }
  function patch(image, m, x, y, width = 8, height = 8) {
    const values = [];
    for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) {
      const p = project(m, x + (col / 4 - 0.5) * width, y + (row / 6 - 0.5) * height), v = luminance(image, p.x, p.y);
      if (!Number.isFinite(v)) return null; values.push(v);
    }
    values.sort((a, b) => a - b);
    const middle = values[17], deviations = values.map(v => Math.abs(v - middle)).sort((a, b) => a - b);
    return { mean: values.slice(7, -7).reduce((sum, v) => sum + v, 0) / 21, noise: deviations[17] * 1.4826,
      white: values.filter(v => v >= 0.98).length / 35, dark: values.filter(v => v <= 0.002).length / 35 };
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  function inspect(image, quad, bounds) {
    const m = homography(quad); if (!m) return null;
    const outerGeometry = [[0, 0], [640, 0], [640, 320], [0, 320]].map(([x, y]) => project(m, x, y));
    // Integer image coordinates denote pixel centers, with physical edges half a pixel outside.
    if (outerGeometry.some(p => !Number.isFinite(p.x + p.y) ||
      p.x < bounds.x - 0.500001 || p.y < bounds.y - 0.500001 ||
      p.x > bounds.right + 0.500001 || p.y > bounds.bottom + 0.500001)) return null;
    // Cheap centers reject wrong poses before computing patch statistics.
    const blacks = [], whites = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = CORNERS[i], sx = i === 0 || i === 3 ? 1 : -1, sy = i < 2 ? 1 : -1;
      const sample = (dx, dy) => { const p = project(m, x + sx * dx, y + sy * dy); return luminance(image, p.x, p.y); };
      const dark = sample(12, 12), light = sample(56, 56);
      if (!Number.isFinite(dark + light) || light - dark < 0.025) return null;
      blacks.push(dark); whites.push(light);
    }
    const reference = (values, x, y) => { const u = C.clamp((x - 16) / 608), v = C.clamp((y - 16) / 288);
      return values[0] * (1 - u) * (1 - v) + values[1] * u * (1 - v) + values[2] * u * v + values[3] * (1 - u) * v; };
    const check = (x, y, dark, detailed = false) => {
      const black = reference(blacks, x, y), white = reference(whites, x, y), span = white - black;
      const point = project(m, x, y), value = detailed ? patch(image, m, x, y) : { mean: luminance(image, point.x, point.y), noise: 0 };
      return value && Number.isFinite(value.mean) && span >= 0.025 &&
        Math.abs(value.mean - (dark ? black : white)) <= span * 0.18 && value.noise <= span * 0.12;
    };
    const pose = [[144, 36, true], [208, 36, true], [284, 36, true], [284, 60, true],
      [112, 36, false], [240, 36, false], [256, 48, false], [320, 48, false],
      [176, 80, false], [284, 88, false], [176, 284, false], [284, 272, false]];
    if (pose.some(([x, y, dark]) => !check(x, y, dark))) return null;
    for (let i = 0; i < 4; i++) {
      const [x, y] = CORNERS[i], sx = i === 0 || i === 3 ? 1 : -1, sy = i < 2 ? 1 : -1;
      for (const [dx, dy, dark] of [[12, 12, true], [56, 12, true], [12, 56, true], [56, 56, false]]) {
        if (!check(x + sx * dx, y + sy * dy, dark, true)) return null;
      }
    }
    if (pose.some(([x, y, dark]) => !check(x, y, dark, true))) return null;
    const dark = [32, 176, 320, 464, 608].map(x => patch(image, m, x, 160, 10, 32));
    // Sample broad white areas, away from the dark signal block: blur must not dim the white reference.
    const white = FIELDS.map(x => [patch(image, m, x + 56, 88, 40, 8), patch(image, m, x + 56, 232, 40, 8)]);
    if (dark.some(v => !v) || white.some(pair => pair.some(v => !v))) return null;
    const measured = FIELDS.map(x => patch(image, m, x + 56, 160, 56, 32)); if (measured.some(v => !v)) return null;
    const spans = white.map((pair, i) => (pair[0].mean + pair[1].mean - dark[i].mean - dark[i + 1].mean) / 2);
    if (Math.min(...spans) < 0.025) return null;
    const panels = measured.map(v => v.mean), normalized = panels.map((v, i) => (v - (dark[i].mean + dark[i + 1].mean) / 2) / spans[i]);
    if (normalized.some(v => v < -0.05 || v > 1.05)) return null;
    const data = C.clamp(normalized[0] - normalized[1], -1, 1), clock = C.clamp(normalized[2] - normalized[3], -1, 1);
    const qualityOf = (a, b, difference) => {
      if (Math.abs(panels[a] - panels[b]) < Math.max(0.002, 6 * Math.max(measured[a].noise, measured[b].noise)) || Math.abs(difference) < 0.04) return 0;
      return C.clamp(Math.abs(difference) / 0.15);
    };
    const dataQuality = qualityOf(0, 1, data), clockQuality = qualityOf(2, 3, clock), quality = Math.min(dataQuality, clockQuality);
    const whiteFraction = measured.reduce((sum, v) => sum + v.white, 0) / 4, darkFraction = measured.reduce((sum, v) => sum + v.dark, 0) / 4;
    const xs = outerGeometry.map(p => p.x), ys = outerGeometry.map(p => p.y);
    return { found: true, data, clock, quality, dataQuality, clockQuality, panels, markerCount: 4,
      rect: { x: Math.min(...xs) / image.width, y: Math.min(...ys) / image.height,
        w: (Math.max(...xs) - Math.min(...xs)) / image.width, h: (Math.max(...ys) - Math.min(...ys)) / image.height },
      geometry: quad, outerGeometry,
      sampleGeometry: FIELDS.map(x => [[x + 28, 144], [x + 84, 144], [x + 84, 176], [x + 28, 176]].map(([xx, yy]) => project(m, xx, yy))),
      health: { white: whiteFraction, dark: darkFraction, clipped: whiteFraction + darkFraction }, reason: quality ? null : 'panelContrast' };
  }
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function hull(points) {
    const sorted = points.sort((a, b) => a.x - b.x || a.y - b.y), lower = [], upper = [];
    for (const p of sorted) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
      upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }
  function edge(image, corner, end, other, step) {
    const length = distance(corner, end), dx = (end.x - corner.x) / length, dy = (end.y - corner.y) / length;
    let nx = -dy, ny = dx; if ((other.x - corner.x) * nx + (other.y - corner.y) * ny < 0) { nx = -nx; ny = -ny; }
    const points = [], radius = Math.max(3, step * 2);
    for (let i = 0; i < 9; i++) {
      const t = 0.22 + i * 0.065, x = corner.x + dx * length * t, y = corner.y + dy * length * t;
      let best = 0;
      const profile = [];
      for (let shift = -radius; shift <= radius; shift += 0.5) {
        const px = x + nx * shift, py = y + ny * shift, gradient = luminance(image, px - nx, py - ny) - luminance(image, px + nx, py + ny);
        if (Number.isFinite(gradient)) { profile.push({ x: px, y: py, gradient }); best = Math.max(best, gradient); }
      }
      // A sharp sampled edge has a flat gradient maximum. Its midpoint is the boundary;
      // selecting the first maximum expands the frame by half a pixel on every side.
      if (best >= 0.002) {
        const peaks = profile.filter(p => p.gradient >= best - 1e-9);
        points.push({ x: peaks.reduce((sum, p) => sum + p.x, 0) / peaks.length,
          y: peaks.reduce((sum, p) => sum + p.y, 0) / peaks.length });
      }
    }
    if (points.length < 6) return null;
    const mx = points.reduce((s, p) => s + p.x, 0) / points.length, my = points.reduce((s, p) => s + p.y, 0) / points.length;
    let xx = 0, yy = 0, xy = 0;
    for (const p of points) { xx += (p.x - mx) ** 2; yy += (p.y - my) ** 2; xy += (p.x - mx) * (p.y - my); }
    const angle = 0.5 * Math.atan2(2 * xy, xx - yy), a = -Math.sin(angle), b = Math.cos(angle);
    const residual = Math.sqrt(points.reduce((s, p) => s + (a * (p.x - mx) + b * (p.y - my)) ** 2, 0) / points.length);
    return residual <= Math.max(0.8, step * 0.6) ? { a, b, c: a * mx + b * my } : null;
  }
  function marker(image, points, step) {
    const outline = hull(points); if (outline.length < 3) return null;
    let diagonal = 0, p, q;
    for (let i = 0; i < outline.length; i++) for (let j = i + 1; j < outline.length; j++) {
      const d = distance(outline[i], outline[j]); if (d > diagonal) { diagonal = d; p = outline[i]; q = outline[j]; }
    }
    let altitude = 0, corner;
    for (const r of outline) { const h = Math.abs(cross(p, q, r)) / diagonal; if (h > altitude) { altitude = h; corner = r; } }
    if (altitude < diagonal * 0.25) return null;
    const a = distance(corner, p), b = distance(corner, q), area = points.length * step * step / (a * b);
    if (Math.min(a, b) < 8 || Math.min(a, b) / Math.max(a, b) < 0.4 || area < 0.2 || area > 0.85) return null;
    const first = edge(image, corner, p, q, step), second = edge(image, corner, q, p, step); if (!first || !second) return null;
    const det = first.a * second.b - second.a * first.b; if (Math.abs(det) < 0.25) return null;
    const refined = { x: (first.c * second.b - second.c * first.b) / det, y: (first.a * second.c - second.a * first.c) / det };
    if (distance(corner, refined) > step * 5) return null;
    // Adaptive masks can trace the outline of a solid card. Its interior is not an L's white opening.
    // Validate actual image values before a false corner consumes the bounded candidate budget.
    const local = (u, v) => {
      const x = refined.x + (p.x - refined.x) * u + (q.x - refined.x) * v;
      const y = refined.y + (p.y - refined.y) * u + (q.y - refined.y) * v;
      const radius = Math.max(0.5, Math.min(a, b) * 0.025);
      return median([[0, 0], [-radius, 0], [radius, 0], [0, -radius], [0, radius]]
        .map(([dx, dy]) => luminance(image, x + dx, y + dy)));
    };
    const dark = [local(0.15, 0.15), local(0.7, 0.15), local(0.15, 0.7)], light = local(0.7, 0.7);
    const span = light - median(dark);
    if (![light, ...dark].every(Number.isFinite) || span < 0.025 || dark.some(v => Math.abs(v - median(dark)) > span * 0.18)) return null;
    return { ...refined, size: (a + b) / 2 };
  }
  function candidates(image, bounds) {
    // At most 320×240 coarse samples. Local means preserve a dim screen in a bright room.
    const step = Math.max(2, Math.ceil(image.width / 320), Math.ceil(image.height / 240));
    const width = Math.floor((bounds.right - bounds.x) / step), height = Math.floor((bounds.bottom - bounds.y) / step);
    if (width < 3 || height < 3) return [];
    const ox = bounds.x + step / 2, oy = bounds.y + step / 2, values = new Float64Array(width * height);
    const stride = width + 1, sums = new Float64Array(stride * (height + 1));
    for (let y = 0; y < height; y++) { let sum = 0; for (let x = 0; x < width; x++) {
      const v = luminance(image, ox + x * step, oy + y * step);
      values[y * width + x] = v; sum += v;
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + sum;
    } }
    const found = [], mask = new Uint8Array(values.length), visited = new Uint8Array(values.length), queue = new Int32Array(values.length);
    // A small window stays inside a dim display's white margin; the larger one joins thick marks.
    for (const pixels of [4, 14]) {
      const radius = Math.ceil(pixels / step);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const left = Math.max(0, x - radius), right = Math.min(width, x + radius + 1);
        const top = Math.max(0, y - radius), bottom = Math.min(height, y + radius + 1);
        const mean = (sums[bottom * stride + right] - sums[top * stride + right] -
          sums[bottom * stride + left] + sums[top * stride + left]) / ((right - left) * (bottom - top));
        mask[y * width + x] = values[y * width + x] < mean - 0.002 ? 1 : 0;
      }
      visited.fill(0);
      for (let start = 0; start < values.length; start++) {
        if (visited[start] || !mask[start]) continue;
        let head = 0, tail = 1, minx = width, maxx = 0, miny = height, maxy = 0; queue[0] = start; visited[start] = 1;
        while (head < tail) {
          const point = queue[head++], x = point % width, y = Math.floor(point / width);
          minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
          for (const next of [x ? point - 1 : -1, x + 1 < width ? point + 1 : -1, y ? point - width : -1, y + 1 < height ? point + width : -1]) {
            if (next >= 0 && !visited[next] && mask[next]) { visited[next] = 1; queue[tail++] = next; }
          }
        }
        const w = maxx - minx + 1, h = maxy - miny + 1, fill = tail / (w * h);
        if (minx === 0 || miny === 0 || maxx === width - 1 || maxy === height - 1 || tail < 12 ||
          Math.min(w, h) * step < 8 || w / h < 0.3 || w / h > 3.3 || fill < 0.15 || fill > 0.85) continue;
        const points = Array.from(queue.subarray(0, tail), n => ({ x: ox + n % width * step, y: oy + Math.floor(n / width) * step }));
        const item = marker(image, points, step);
        if (!item || found.some(p => distance(p, item) < Math.max(3, item.size * 0.15))) continue;
        found.push(item); if (found.length > 8) return found;
      }
    }
    return found;
  }
  function read(image, crop = {}) {
    const absent = (reason, count = 0) => ({ found: false, data: 0, clock: 0, quality: 0, dataQuality: 0, clockQuality: 0,
      panels: [], rect: null, geometry: null, outerGeometry: null, sampleGeometry: null, markerCount: Math.min(count, 4),
      health: { white: 0, dark: 0, clipped: 0 }, reason });
    if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || !image.data ||
      image.width < 96 || image.height < 48 || image.data.length < image.width * image.height * 4) return absent('panelMissing');
    const x = C.clamp(Number.isFinite(crop.x) ? crop.x : 0), y = C.clamp(Number.isFinite(crop.y) ? crop.y : 0);
    const w = C.clamp(Number.isFinite(crop.w) ? crop.w : 1, 0, 1 - x), h = C.clamp(Number.isFinite(crop.h) ? crop.h : 1, 0, 1 - y);
    const bounds = { x: Math.floor(x * image.width), y: Math.floor(y * image.height),
      right: Math.ceil((x + w) * image.width) - 1, bottom: Math.ceil((y + h) * image.height) - 1 };
    const marks = candidates(image, bounds);
    if (marks.length < 4 || marks.length > 8) return absent(marks.length > 8 ? 'panelAmbiguous' : 'panelMissing', marks.length);
    const matches = [];
    // Eight marks permit two complete transmitters, but bound the search to 70 quartets / 560 poses.
    for (let a = 0; a < marks.length - 3; a++) for (let b = a + 1; b < marks.length - 2; b++) {
      for (let c = b + 1; c < marks.length - 1; c++) for (let d = c + 1; d < marks.length; d++) {
      const group = [marks[a], marks[b], marks[c], marks[d]], sizes = group.map(p => p.size), size = median(sizes);
      if (Math.min(...sizes) / Math.max(...sizes) < 0.4) continue;
      const ordered = hull(group.slice()); if (ordered.length !== 4) continue;
      const lengths = ordered.map((p, i) => distance(p, ordered[(i + 1) % 4]));
      if (Math.min(...lengths) < size * 2 || Math.max(...lengths) > size * 12) continue;
      const area = Math.abs(ordered.reduce((sum, p, i) => sum + p.x * ordered[(i + 1) % 4].y - p.y * ordered[(i + 1) % 4].x, 0)) / 2;
      if (area / (size * size) < 10 || area / (size * size) > 60) continue;
      for (const direction of [1, -1]) for (let start = 0; start < 4; start++) {
        const quad = Array.from({ length: 4 }, (_, i) => ordered[(start + i * direction + 8) % 4]), value = inspect(image, quad, bounds);
        if (!value) continue; matches.push(value); if (matches.length > 1) return absent('panelAmbiguous', marks.length);
      }
      }
    }
    return matches.length === 1 ? matches[0] : absent('panelMissing', marks.length);
  }
  return Object.freeze({ draw, idle, read,
    layout: Object.freeze({ width: WIDTH, height: HEIGHT, fields: FIELDS, fieldY: 120, fieldWidth: 112, fieldHeight: 80 }) });
}));
