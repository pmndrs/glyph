#!/usr/bin/env node
// Writes a tiny, hand-made outline-stream spike asset into spikes/outline-stream/out/ so the GPU harness can be
// exercised without the encoder. It follows the "Asset format" section of
// .agents/docs/planning/outline-stream-spike.md and the point layout of decisions/outline-stream-format.md.
//
// Usage: node spikes/outline-stream/gpu/test/fake-asset.mjs [--replace]
//   The "fake" entry is merged into an existing out/index.json; --replace writes an index with only the fake.
//   Note prepare.mjs rewrites out/index.json, so run this again after prepare if you want the fake listed.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const outDir = fileURLToPath(new URL('../../out/', import.meta.url));
const UNITS_PER_EM = 2048;
const TEXTURE_WIDTH = 4096;
const H_BANDS = 8;
const V_BANDS = 6;
const BAND_EPSILON = 1 / 1024; // em, as slug-core
const AXIS_EPSILON = 1e-10;
const LINE_EPSILON_FONT_UNITS = 0.125;

// Contours in the font's own point order: [x, y, onCurve]. Outer contours clockwise (y up), holes counter-clockwise.
const on = (x, y) => [x, y, 1];
const off = (x, y) => [x, y, 0];

function circle(cx, cy, r) {
  // TrueType-style circle: one on-curve point at 0 degrees, seven off-curve points (implied midpoints between them),
  // listed clockwise and starting mid-contour so the encoder has to rotate it.
  const k = r / Math.cos(Math.PI / 8);
  const points = [on(cx + r, cy)];
  for (let i = 1; i < 8; i += 1) {
    const angle = (-i * Math.PI) / 4;
    points.push(off(Math.round(cx + k * Math.cos(angle)), Math.round(cy + k * Math.sin(angle))));
  }
  return [...points.slice(3), ...points.slice(0, 3)];
}

const GLYPHS = [
  { name: 'empty', contours: [] },
  { name: 'square', contours: [[on(200, 0), on(200, 1400), on(1400, 1400), on(1400, 0)]] },
  { name: 'circle', contours: [circle(800, 700, 600)] },
  {
    name: 'ring',
    contours: [
      // Rounded square starting on an off-curve corner (forces rotation), with axis-aligned line edges.
      [
        off(0, 0),
        on(0, 400),
        on(0, 1000),
        off(0, 1400),
        on(400, 1400),
        on(1000, 1400),
        off(1400, 1400),
        on(1400, 1000),
        on(1400, 400),
        off(1400, 0),
        on(1000, 0),
        on(400, 0),
      ],
      [on(400, 400), on(1000, 400), on(1000, 1000), on(400, 1000)],
    ],
  },
  {
    name: 'A',
    contours: [
      [on(0, 0), on(600, 1500), on(900, 1500), on(1500, 0), on(1150, 0), on(1000, 400), on(500, 400), on(350, 0)],
      [on(580, 600), on(920, 600), on(750, 1100)],
    ],
  },
  {
    name: 'blob',
    contours: [
      // No on-curve point at all: the encoder synthesizes a midpoint start.
      [off(700, -400), off(100, 300), off(700, 1000), off(1300, 300)],
      // Diamond below the baseline.
      [on(700, -900), on(550, -750), on(700, -600), on(850, -750)],
    ],
  },
  {
    name: 'wave',
    contours: [
      [
        on(0, 600),
        off(300, 1100),
        off(700, 300),
        off(1100, 1100),
        on(1400, 600),
        on(1400, 300),
        off(1100, 800),
        off(700, 0),
        off(300, 800),
        on(0, 300),
      ],
    ],
  },
];

/** Rotate to start on an on-curve point (synthesizing one if needed) and append the wrap point. */
function layoutContour(contour) {
  let start = contour.findIndex((p) => p[2] === 1);
  let points;
  if (start < 0) {
    const a = contour[contour.length - 1];
    const b = contour[0];
    points = [on(Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)), ...contour];
    start = 0;
  } else {
    points = [...contour.slice(start), ...contour.slice(0, start)];
  }
  return [...points, points[0]];
}

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Curves of one laid-out contour by the three-point read rule; `index` is the point that names the curve. */
function contourCurves(points) {
  const curves = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p = points[i];
    const next = points[i + 1];
    if (p[2] === 0) {
      const prev = points[i - 1];
      const p0 = prev[2] === 1 ? [prev[0], prev[1]] : mid(prev, p);
      const p2 = next[2] === 1 ? [next[0], next[1]] : mid(p, next);
      curves.push({ index: i, line: false, p0, p1: [p[0], p[1]], p2 });
    } else if (next[2] === 1) {
      curves.push({ index: i, line: true, p0: [p[0], p[1]], p1: mid(p, next), p2: [next[0], next[1]] });
    }
  }
  return curves;
}

/** slug-core::line_to_quadratic, in em units: Slug V0 bows non-axis lines by 1/8 font unit. */
function lineToQuadratic(p0, p2) {
  const m = mid(p0, p2);
  const dx = p2[0] - p0[0];
  const dy = p2[1] - p0[1];
  if (Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6) return m;
  const s = LINE_EPSILON_FONT_UNITS / UNITS_PER_EM / Math.hypot(dx, dy);
  return [m[0] - dy * s, m[1] + dx * s];
}

function quadraticExtent(a, b, c, bounds) {
  bounds[0] = Math.min(bounds[0], a, c);
  bounds[1] = Math.max(bounds[1], a, c);
  const den = a - 2 * b + c;
  if (den === 0) return;
  const t = (a - b) / den;
  if (t < 0 || t >= 1) return;
  const v = (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
  bounds[0] = Math.min(bounds[0], v);
  bounds[1] = Math.max(bounds[1], v);
}

/** slug-core::build_axis_bands over em-space curves; axis 1 = horizontal bands (y), 0 = vertical bands (x). */
function buildAxisBands(curves, min, max, count, axis) {
  const bands = Array.from({ length: count }, () => []);
  const range = max - min;
  if (range <= 0) return bands;
  const size = range / count;
  curves.forEach((curve, index) => {
    const values = [curve.p0[axis], curve.p1[axis], curve.p2[axis]];
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    if (hi - lo < AXIS_EPSILON) return;
    const first = Math.min(Math.max(Math.floor((lo - min - BAND_EPSILON) / size), 0), count - 1);
    const last = Math.min(Math.max(Math.floor((hi - min + BAND_EPSILON) / size), 0), count - 1);
    for (let band = first; band <= last; band += 1) bands[band].push(index);
  });
  const sortAxis = axis === 1 ? 0 : 1;
  const key = (c) => Math.max(curves[c].p0[sortAxis], curves[c].p1[sortAxis], curves[c].p2[sortAxis]);
  for (const band of bands) band.sort((l, r) => key(r) - key(l));
  return bands;
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
/** IEEE binary16 bits of a number, round to nearest even. */
function toHalf(value) {
  f32[0] = value;
  const bits = u32[0];
  const sign = (bits >>> 16) & 0x8000;
  const exponent = (bits >>> 23) & 0xff;
  let mantissa = bits & 0x7fffff;
  if (exponent === 0xff) return sign | 0x7c00 | (mantissa ? 0x200 : 0);
  let e = exponent - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    mantissa |= 0x800000;
    const shift = 14 - e;
    let half = mantissa >>> shift;
    const rest = mantissa & ((1 << shift) - 1);
    const halfway = 1 << (shift - 1);
    if (rest > halfway || (rest === halfway && half & 1)) half += 1;
    return sign | half;
  }
  let half = (e << 10) | (mantissa >>> 13);
  const rest = mantissa & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && half & 1)) half += 1;
  return sign | half;
}

const glyphRecords = [];
const curveTexels = []; // [x1, y1, x2, y2] em
const points = []; // [xWord, y]
const bandHeaders = [];
const bandRefsA = [];
const bandRefsB = [];

for (const glyph of GLYPHS) {
  const curveBase = curveTexels.length;
  const pointBase = points.length;
  const bandBase = bandHeaders.length;
  const curves = []; // font units, with A texel offset and B point offset
  for (const contour of glyph.contours) {
    const laid = layoutContour(contour);
    const contourPointBase = points.length - pointBase;
    for (const [x, y, onCurve] of laid) points.push([(x << 1) | (onCurve ? 0 : 1), y]);
    const contourCurveList = contourCurves(laid);
    const texelStart = curveTexels.length - curveBase;
    contourCurveList.forEach((curve, k) => {
      const e = (p) => [p[0] / UNITS_PER_EM, p[1] / UNITS_PER_EM];
      const p0 = e(curve.p0);
      const p2 = e(curve.p2);
      const p1 = curve.line ? lineToQuadratic(p0, p2) : e(curve.p1);
      curveTexels.push([p0[0], p0[1], p1[0], p1[1]]);
      curves.push({ ...curve, texel: texelStart + k, point: contourPointBase + curve.index });
    });
    const last = contourCurveList[contourCurveList.length - 1].p2;
    curveTexels.push([last[0] / UNITS_PER_EM, last[1] / UNITS_PER_EM, 0, 0]);
  }
  const xb = [Infinity, -Infinity];
  const yb = [Infinity, -Infinity];
  for (const c of curves) {
    quadraticExtent(c.p0[0], c.p1[0], c.p2[0], xb);
    quadraticExtent(c.p0[1], c.p1[1], c.p2[1], yb);
  }
  if (curves.length === 0) {
    glyphRecords.push({ curveBase, pointBase, bandBase, h: 0, v: 0, bounds: [0, 0, 0, 0] });
    continue;
  }
  const em = curves.map((c) => ({
    p0: c.p0.map((v) => v / UNITS_PER_EM),
    p1: c.p1.map((v) => v / UNITS_PER_EM),
    p2: c.p2.map((v) => v / UNITS_PER_EM),
  }));
  const horizontal = buildAxisBands(em, yb[0] / UNITS_PER_EM, yb[1] / UNITS_PER_EM, H_BANDS, 1);
  const vertical = buildAxisBands(em, xb[0] / UNITS_PER_EM, xb[1] / UNITS_PER_EM, V_BANDS, 0);
  // Reference-texture style packing: headers at bandBase + band, then the references in the same index space,
  // so refOffset (relative to bandBase) starts after the headers. Both arrays share the index space.
  const all = [...horizontal, ...vertical];
  let refOffset = all.length;
  for (const band of all) {
    bandHeaders.push((band.length << 16) | refOffset);
    bandRefsA.push(0);
    bandRefsB.push(0);
    refOffset += band.length;
  }
  for (const band of all) {
    for (const index of band) {
      bandHeaders.push(0);
      bandRefsA.push(curves[index].texel);
      bandRefsB.push(curves[index].point);
    }
  }
  glyphRecords.push({ curveBase, pointBase, bandBase, h: H_BANDS, v: V_BANDS, bounds: [xb[0], yb[0], xb[1], yb[1]] });
}

// Assemble the binary.
const sections = {};
const parts = [];
let cursor = 0;
function section(name, bytes) {
  const padded = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4);
  padded.set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  sections[name] = { offset: cursor, length: bytes.byteLength };
  parts.push(padded);
  cursor += padded.byteLength;
}

const glyphBytes = new DataView(new ArrayBuffer(glyphRecords.length * 32));
glyphRecords.forEach((g, i) => {
  const o = i * 32;
  glyphBytes.setUint32(o, g.curveBase, true);
  glyphBytes.setUint32(o + 4, g.pointBase, true);
  glyphBytes.setUint32(o + 8, g.bandBase, true);
  glyphBytes.setUint16(o + 12, g.h, true);
  glyphBytes.setUint16(o + 14, g.v, true);
  g.bounds.forEach((v, k) => glyphBytes.setFloat32(o + 16 + k * 4, v, true));
});
section('glyphs', new Uint8Array(glyphBytes.buffer));

const halfs = new Uint16Array(curveTexels.length * 4);
curveTexels.forEach((t, i) => t.forEach((v, k) => (halfs[i * 4 + k] = toHalf(v))));
section('curvesF16', halfs);

const pointWords = new Int16Array(points.length * 2);
points.forEach(([x, y], i) => {
  pointWords[i * 2] = x;
  pointWords[i * 2 + 1] = y;
});
section('pointsI16', pointWords);
section('bandHeaders', Uint32Array.from(bandHeaders));
section('bandRefsA', Uint16Array.from(bandRefsA));
section('bandRefsB', Uint16Array.from(bandRefsB));

const bin = new Uint8Array(cursor);
let at = 0;
for (const part of parts) {
  bin.set(part, at);
  at += part.byteLength;
}

const meta = {
  format: 'outline-stream-spike',
  version: 1,
  font: 'fake',
  source: 'gpu/test/fake-asset.mjs (hand-made test shapes, not a real font)',
  unitsPerEm: UNITS_PER_EM,
  rowTexels: TEXTURE_WIDTH,
  glyphCount: glyphRecords.length,
  glyphNames: GLYPHS.map((g) => g.name),
  counts: {
    curveTexels: curveTexels.length,
    points: points.length,
    bandHeaders: bandHeaders.length,
    bandRefs: bandRefsA.length,
  },
  bin: 'fake.spike.bin',
  sections,
};

await mkdir(outDir, { recursive: true });
await writeFile(new URL('fake.spike.bin', `file://${outDir}`), bin);
await writeFile(new URL('fake.spike.json', `file://${outDir}`), `${JSON.stringify(meta, null, 2)}\n`);

// Same shape as prepare.mjs writes, merged into an existing index unless --replace is given.
const entry = {
  name: 'fake',
  source: 'gpu/test/fake-asset.mjs',
  test: true,
  unitsPerEm: UNITS_PER_EM,
  variants: { shapes: { json: 'fake.spike.json', bin: 'fake.spike.bin', glyphCount: glyphRecords.length } },
};
let index = { format: 'outline-stream-spike-v0', fonts: [entry] };
if (!process.argv.includes('--replace')) {
  try {
    const existing = JSON.parse(await readFile(new URL('index.json', `file://${outDir}`), 'utf8'));
    index = { ...existing, fonts: [...(existing.fonts ?? []).filter((f) => f?.name !== 'fake'), entry] };
  } catch {
    // No index yet: write a fresh one.
  }
}
await writeFile(new URL('index.json', `file://${outDir}`), `${JSON.stringify(index, null, 2)}\n`);
console.log(
  `wrote ${outDir}fake.spike.{json,bin}: ${glyphRecords.length} glyphs, ${points.length} points, ` +
    `${curveTexels.length} curve texels, ${bandHeaders.length} band slots`,
);
