// Decode-speed benchmark for the leading outline wire candidates, plus load-time Slug band building.
// Usage: node bench.mjs <bench-dir> <key> [meshopt-bin meshopt-json]
// Every decoder produces the same expanded (composites decomposed) absolute i16 x,y points; the checksum
// is compared against the Python reference in <key>.json.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, key, moBin, moJson] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf8'));
const files = Object.fromEntries(
  ['varint', 'u16shuf', 'abs', 'triplet'].map((t) => [t, new Uint8Array(readFileSync(join(dir, `${key}.${t}.bin`)))]),
);

function planes(buf, layout) {
  const out = {};
  let o = 0;
  for (const [name, len] of layout) {
    out[name] = buf.subarray(o, o + len);
    o += len;
  }
  return out;
}

// ---- shared: header + contour counts + components -> structure
function readStructure(p, G) {
  const hdr = p.hdr,
    _cnb = p.cn;
  let o = 0;
  const kind = new Uint32Array(G);
  for (let g = 0; g < G; g++) {
    let v = 0,
      s = 0,
      b;
    do {
      b = hdr[o++];
      v |= (b & 127) << s;
      s += 7;
    } while (b & 128);
    kind[g] = v;
  }
  return kind;
}

function readVarints(bytes, count) {
  const out = new Uint32Array(count);
  let o = 0;
  for (let i = 0; i < count; i++) {
    let v = 0,
      s = 0,
      b;
    do {
      b = bytes[o++];
      v |= (b & 127) << s;
      s += 7;
    } while (b & 128);
    out[i] = v;
  }
  return out;
}

// After compact (pre-expansion) absolute points are known, expand composites into one decomposed buffer.
function expand(G, kind, cnArr, compBytes, compactX, compactY) {
  // compact point / contour offsets per simple glyph
  const pBase = new Uint32Array(G + 1),
    cBase = new Uint32Array(G + 1);
  let pc = 0,
    cc = 0;
  for (let g = 0; g < G; g++) {
    pBase[g] = pc;
    cBase[g] = cc;
    const k = kind[g];
    if (k && !(k & 1)) {
      const nc = k >>> 1;
      for (let i = 0; i < nc; i++) pc += cnArr[cc + i];
      cc += nc;
    }
  }
  pBase[G] = pc;
  cBase[G] = cc;
  // parse components
  const compStart = new Int32Array(G).fill(-1);
  const comps = [];
  let o = 0;
  const rv = () => {
    let v = 0,
      s = 0,
      b;
    do {
      b = compBytes[o++];
      v |= (b & 127) << s;
      s += 7;
    } while (b & 128);
    return v;
  };
  for (let g = 0; g < G; g++) {
    const k = kind[g];
    if (!(k & 1)) continue;
    compStart[g] = comps.length / 4;
    for (let i = 0; i < k >>> 1; i++) {
      const gid = rv();
      const zx = rv(),
        zy = rv();
      const dx = (zx >>> 1) ^ -(zx & 1),
        dy = (zy >>> 1) ^ -(zy & 1);
      const t = compBytes[o++];
      let m = null;
      if (t) {
        const dv = new DataView(compBytes.buffer, compBytes.byteOffset + o, 8);
        m = [0, 2, 4, 6].map((q) => dv.getInt16(q, true) / 16384);
        o += 8;
      }
      comps.push(gid, dx, dy, m);
    }
  }
  // expanded counts
  const eCount = new Int32Array(G).fill(-1);
  const count = (g) => {
    if (eCount[g] >= 0) return eCount[g];
    const k = kind[g];
    let n = 0;
    if (k & 1) {
      for (let i = 0; i < k >>> 1; i++) n += count(comps[(compStart[g] + i) * 4]);
    } else n = pBase[g + 1] - pBase[g];
    return (eCount[g] = n);
  };
  let total = 0;
  const eBase = new Uint32Array(G + 1);
  for (let g = 0; g < G; g++) {
    eBase[g] = total;
    total += count(g);
  }
  eBase[G] = total;
  const xy = new Int16Array(total * 2);
  const write = (g, at, ox, oy, m) => {
    const k = kind[g];
    if (k & 1) {
      for (let i = 0; i < k >>> 1; i++) {
        const c = (compStart[g] + i) * 4;
        const sub = comps[c];
        const mm = comps[c + 3];
        // nested transforms are rare; compose by applying inner first (approximation adequate for timing)
        write(sub, at, ox + comps[c + 1], oy + comps[c + 2], mm || m);
        at += count(sub);
      }
      return;
    }
    const a = pBase[g],
      b = pBase[g + 1];
    if (!m) {
      for (let i = a, j = at * 2; i < b; i++, j += 2) {
        xy[j] = compactX[i] + ox;
        xy[j + 1] = compactY[i] + oy;
      }
    } else {
      for (let i = a, j = at * 2; i < b; i++, j += 2) {
        const x = compactX[i],
          y = compactY[i];
        xy[j] = Math.round(x * m[0] + y * m[2]) + ox;
        xy[j + 1] = Math.round(x * m[1] + y * m[3]) + oy;
      }
    }
  };
  for (let g = 0; g < G; g++) write(g, eBase[g], 0, 0, null);
  return { xy, eBase, pBase, cBase };
}

function decodeVarint(buf) {
  const G = meta.glyphs,
    P = meta.points;
  const p = planes(buf, meta.varint);
  const kind = readStructure(p, G);
  const cn = readVarints(p.cn, meta.contours);
  const X = new Int16Array(P),
    Y = new Int16Array(P);
  const d = p.xy;
  let o = 0,
    i = 0,
    ci = 0;
  for (let g = 0; g < G; g++) {
    const k = kind[g];
    if (!k || k & 1) continue;
    let n = 0;
    for (let c = 0; c < k >>> 1; c++) n += cn[ci++];
    let x = 0,
      y = 0;
    for (const end = i + n; i < end; i++) {
      let v = 0,
        s = 0,
        b;
      do {
        b = d[o++];
        v |= (b & 127) << s;
        s += 7;
      } while (b & 128);
      x += (v >>> 1) ^ -(v & 1);
      v = 0;
      s = 0;
      do {
        b = d[o++];
        v |= (b & 127) << s;
        s += 7;
      } while (b & 128);
      y += (v >>> 1) ^ -(v & 1);
      X[i] = x;
      Y[i] = y;
    }
  }
  return { ...expand(G, kind, cn, p.comp, X, Y), flags: p.flags, cn, kind };
}

function decodeShuf(buf) {
  const G = meta.glyphs,
    P = meta.points;
  const p = planes(buf, meta.u16shuf);
  const kind = readStructure(p, G);
  const cn = readVarints(p.cn, meta.contours);
  const X = new Int16Array(P),
    Y = new Int16Array(P);
  const xl = p.xlo,
    xh = p.xhi,
    yl = p.ylo,
    yh = p.yhi;
  let i = 0,
    ci = 0;
  for (let g = 0; g < G; g++) {
    const k = kind[g];
    if (!k || k & 1) continue;
    let n = 0;
    for (let c = 0; c < k >>> 1; c++) n += cn[ci++];
    let x = 0,
      y = 0;
    for (const end = i + n; i < end; i++) {
      const zx = xl[i] | (xh[i] << 8),
        zy = yl[i] | (yh[i] << 8);
      x += (zx >>> 1) ^ -(zx & 1);
      y += (zy >>> 1) ^ -(zy & 1);
      X[i] = x;
      Y[i] = y;
    }
  }
  return { ...expand(G, kind, cn, p.comp, X, Y), flags: p.flags, cn, kind };
}

// WOFF2-style triplets: one flag byte (on/off + size class) and 1-4 data bytes per point.
function decodeTriplet(buf) {
  const G = meta.glyphs,
    P = meta.points;
  const p = planes(buf, meta.triplet);
  const kind = readStructure(p, G);
  const cn = readVarints(p.cn, meta.contours);
  const X = new Int16Array(P),
    Y = new Int16Array(P);
  const fl = p.flags,
    d = p.data;
  let o = 0,
    i = 0,
    ci = 0;
  for (let g = 0; g < G; g++) {
    const k = kind[g];
    if (!k || k & 1) continue;
    let n = 0;
    for (let c = 0; c < k >>> 1; c++) n += cn[ci++];
    let x = 0,
      y = 0;
    for (const end = i + n; i < end; i++) {
      const f = fl[i] & 127;
      let dx, dy;
      if (f < 10) {
        dx = 0;
        dy = ((f >> 1) << 8) | d[o++];
        if (f & 1) dy = -dy;
      } else if (f < 20) {
        const q = f - 10;
        dy = 0;
        dx = ((q >> 1) << 8) | d[o++];
        if (q & 1) dx = -dx;
      } else if (f < 84) {
        const q = f - 20,
          b = d[o++];
        dx = 1 + (q & 0x30) + (b >> 4);
        dy = 1 + ((q & 0x0c) << 2) + (b & 15);
        if (q & 2) dx = -dx;
        if (q & 1) dy = -dy;
      } else if (f < 120) {
        const q = f - 84;
        dx = 1 + (((q / 12) | 0) << 8) + d[o++];
        dy = 1 + (((q % 12) >> 2) << 8) + d[o++];
        if (q & 2) dx = -dx;
        if (q & 1) dy = -dy;
      } else if (f < 124) {
        const b0 = d[o++],
          b1 = d[o++],
          b2 = d[o++];
        dx = (b0 << 4) | (b1 >> 4);
        dy = ((b1 & 15) << 8) | b2;
        if (f & 2) dx = -dx;
        if (f & 1) dy = -dy;
      } else {
        dx = (d[o] << 8) | d[o + 1];
        dy = (d[o + 2] << 8) | d[o + 3];
        o += 4;
        if (f & 2) dx = -dx;
        if (f & 1) dy = -dy;
      }
      x += dx;
      y += dy;
      X[i] = x;
      Y[i] = y;
    }
  }
  return { ...expand(G, kind, cn, p.comp, X, Y), flags: fl, cn, kind };
}

function decodeAbs(buf) {
  // GPU-direct: planes are already absolute; only composite expansion remains (none for CFF).
  const G = meta.glyphs,
    _P = meta.points;
  const p = planes(buf, meta.abs);
  const al = (u8) => new Int16Array(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
  const X = al(p.x),
    Y = al(p.y);
  const off = new Uint32Array(
    p.offsets.buffer.slice(p.offsets.byteOffset, p.offsets.byteOffset + p.offsets.byteLength),
  );
  // rebuild kind from offsets is not possible for composites; the abs layout keeps hdr implicitly in offsets,
  // so reuse the varint hdr only for the composite case (cost included: it is tiny).
  const kind = readStructure(planes(files.varint, meta.varint), G);
  const cn = new Uint16Array(p.cn.buffer.slice(p.cn.byteOffset, p.cn.byteOffset + p.cn.byteLength));
  if (!kind.some((k) => k & 1)) return { xy: null, X, Y, off, cn, kind, flags: p.flags };
  return { ...expand(G, kind, cn, p.comp, X, Y), flags: p.flags, cn, kind };
}

function checksum(r) {
  if (!r.xy) {
    // abs CFF path: points stay split; build interleaved only for the checksum
    let s = 0;
    for (let i = 0; i < r.X.length; i++) s += r.X[i] + r.Y[i];
    return { n: r.X.length, s };
  }
  let s = 0;
  for (let i = 0; i < r.xy.length; i++) s += r.xy[i];
  return { n: r.xy.length / 2, s };
}

// ---- load-time Slug bands: 16 horizontal + 16 vertical per glyph, curve refs sorted by descending max.
// Works on the compact (pre-expansion) structure for simple glyphs; composites would reuse component bands
// at an offset or be banded after expansion (here: after expansion, conservative upper bound on cost).
function buildBands(r, flagsBits, cubic, expandedFlags) {
  const BANDS = 16;
  const xy = r.xy || interleave(r.X, r.Y);
  // Expanded contour lists are needed; derive per-glyph contour sizes by walking expanded glyph composition.
  // For timing we treat each glyph's point range as one flags-tagged sequence and use its contour counts.
  const { segs, glyphSeg } = segments(r, xy, cubic, expandedFlags);
  const refs = new Uint16Array(segs.count * 32);
  const headers = new Uint32Array((glyphSeg.length - 1) * BANDS * 2);
  let refTotal = 0;
  const bucket = Array.from({ length: BANDS }, () => []);
  for (let g = 0; g + 1 < glyphSeg.length; g++) {
    const a = glyphSeg[g],
      b = glyphSeg[g + 1];
    if (a === b) continue;
    let minx = Infinity,
      miny = Infinity,
      maxx = -Infinity,
      maxy = -Infinity;
    for (let s = a; s < b; s++) {
      minx = Math.min(minx, segs.minx[s]);
      maxx = Math.max(maxx, segs.maxx[s]);
      miny = Math.min(miny, segs.miny[s]);
      maxy = Math.max(maxy, segs.maxy[s]);
    }
    for (let axis = 0; axis < 2; axis++) {
      const lo = axis ? minx : miny,
        hi = axis ? maxx : maxy;
      const size = (hi - lo) / BANDS || 1;
      for (const bk of bucket) bk.length = 0;
      for (let s = a; s < b; s++) {
        const smin = axis ? segs.minx[s] : segs.miny[s],
          smax = axis ? segs.maxx[s] : segs.maxy[s];
        if (smax - smin === 0) continue;
        const b0 = Math.max(0, Math.min(BANDS - 1, Math.floor((smin - lo) / size))),
          b1 = Math.max(0, Math.min(BANDS - 1, Math.floor((smax - lo) / size)));
        for (let k = b0; k <= b1; k++) bucket[k].push(s - a);
      }
      const key = axis ? segs.maxy : segs.maxx;
      for (let k = 0; k < BANDS; k++) {
        const list = bucket[k];
        list.sort((p, q) => key[q + a] - key[p + a]);
        headers[(g * 2 + axis) * BANDS + k] = (list.length << 16) | (refTotal & 0xffff);
        if (refTotal + list.length > refs.length) throw new Error('refs overflow');
        for (let j = 0; j < list.length; j++) refs[refTotal++] = list[j];
      }
    }
  }
  return { refTotal, segCount: segs.count };
}

function interleave(X, Y) {
  const o = new Int16Array(X.length * 2);
  for (let i = 0; i < X.length; i++) {
    o[2 * i] = X[i];
    o[2 * i + 1] = Y[i];
  }
  return o;
}

// Segment bounds (control hull) from TT/CFF tagged points. Contour boundaries come from the structure.
function segments(r, xy, cubic, expandedFlags) {
  const { contourSizes, glyphContours } = expandedFlags;
  const P = xy.length / 2;
  const cap = P + 16;
  const segs = {
    minx: new Float32Array(cap),
    maxx: new Float32Array(cap),
    miny: new Float32Array(cap),
    maxy: new Float32Array(cap),
    count: 0,
  };
  const glyphSeg = new Uint32Array(glyphContours.length);
  const tag = expandedFlags.tags;
  let pi = 0,
    _ci = 0,
    s = 0;
  for (let g = 0; g + 1 < glyphContours.length; g++) {
    glyphSeg[g] = s;
    for (let c = glyphContours[g]; c < glyphContours[g + 1]; c++) {
      const n = contourSizes[c];
      const base = pi;
      for (let k = 0; k < n; k++) {
        const i = base + k,
          t = tag[i];
        if (t === 0) {
          const j = base + ((k + 1) % n);
          if (tag[j] !== 0) continue; // line on->on
          const x0 = xy[2 * i],
            y0 = xy[2 * i + 1],
            x1 = xy[2 * j],
            y1 = xy[2 * j + 1];
          segs.minx[s] = Math.min(x0, x1);
          segs.maxx[s] = Math.max(x0, x1);
          segs.miny[s] = Math.min(y0, y1);
          segs.maxy[s] = Math.max(y0, y1);
          s++;
        } else if (t === 1) {
          // quadratic: prev, this, next (implied midpoints lie inside this hull)
          const h = base + ((k + n - 1) % n),
            j = base + ((k + 1) % n);
          segs.minx[s] = Math.min(xy[2 * h], xy[2 * i], xy[2 * j]);
          segs.maxx[s] = Math.max(xy[2 * h], xy[2 * i], xy[2 * j]);
          segs.miny[s] = Math.min(xy[2 * h + 1], xy[2 * i + 1], xy[2 * j + 1]);
          segs.maxy[s] = Math.max(xy[2 * h + 1], xy[2 * i + 1], xy[2 * j + 1]);
          s++;
        } else if (t === 2 && (k === 0 || tag[base + k - 1] !== 2)) {
          // first control of a cubic
          const h = base + ((k + n - 1) % n),
            j = base + ((k + 1) % n),
            e = base + ((k + 2) % n);
          segs.minx[s] = Math.min(xy[2 * h], xy[2 * i], xy[2 * j], xy[2 * e]);
          segs.maxx[s] = Math.max(xy[2 * h], xy[2 * i], xy[2 * j], xy[2 * e]);
          segs.miny[s] = Math.min(xy[2 * h + 1], xy[2 * i + 1], xy[2 * j + 1], xy[2 * e + 1]);
          segs.maxy[s] = Math.max(xy[2 * h + 1], xy[2 * i + 1], xy[2 * j + 1], xy[2 * e + 1]);
          s++;
        }
      }
      pi += n;
    }
  }
  glyphSeg[glyphContours.length - 1] = s;
  segs.count = s;
  return { segs, glyphSeg };
}

// expanded contour structure + per-point tags (needed by band building and by outlineAt)
function expandedStructure(r, cubic) {
  const G = meta.glyphs;
  const kind = r.kind;
  const cn = r.cn;
  const fb = r.flags;
  const tagsCompact = new Uint8Array(meta.points);
  if (cubic) for (let i = 0; i < meta.points; i++) tagsCompact[i] = (fb[i >> 2] >> ((i & 3) * 2)) & 3;
  else for (let i = 0; i < meta.points; i++) tagsCompact[i] = (fb[i >> 3] >> (i & 7)) & 1;
  // composites: expand tag and contour lists the same way as points (done via recursion on kind/comps is
  // in expand(); for the benchmark we approximate composite contour structure by reusing component order).
  const compBytes = planes(files.varint, meta.varint).comp;
  let o = 0;
  const rv = () => {
    let v = 0,
      s = 0,
      b;
    do {
      b = compBytes[o++];
      v |= (b & 127) << s;
      s += 7;
    } while (b & 128);
    return v;
  };
  const comps = new Map();
  for (let g = 0; g < G; g++) {
    const k = kind[g];
    if (!(k & 1)) continue;
    const list = [];
    for (let i = 0; i < k >>> 1; i++) {
      list.push(rv());
      rv();
      rv();
      if (compBytes[o++]) o += 8;
    }
    comps.set(g, list);
  }
  const pBase = [],
    cBase = [];
  let pc = 0,
    cc = 0;
  for (let g = 0; g < G; g++) {
    pBase.push(pc);
    cBase.push(cc);
    const k = kind[g];
    if (k && !(k & 1)) {
      for (let i = 0; i < k >>> 1; i++) pc += cn[cc + i];
      cc += k >>> 1;
    }
  }
  const tags = [],
    sizes = [],
    gc = [0];
  const emit = (g) => {
    const k = kind[g];
    if (k & 1) {
      for (const s of comps.get(g)) emit(s);
      return;
    }
    if (!k) return;
    let p = pBase[g];
    for (let i = 0; i < k >>> 1; i++) {
      const n = cn[cBase[g] + i];
      sizes.push(n);
      for (let q = 0; q < n; q++) tags.push(tagsCompact[p++]);
    }
  };
  for (let g = 0; g < G; g++) {
    emit(g);
    gc.push(sizes.length);
  }
  return { tags: Uint8Array.from(tags), contourSizes: Uint32Array.from(sizes), glyphContours: Uint32Array.from(gc) };
}

function time(label, fn, bytes, reps = 31) {
  fn();
  fn();
  const ts = [];
  let r;
  for (let i = 0; i < reps; i++) {
    const t0 = process.hrtime.bigint();
    r = fn();
    ts.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  ts.sort((a, b) => a - b);
  const med = ts[ts.length >> 1];
  console.log(
    `${key} ${label.padEnd(34)} median ${med.toFixed(3)} ms  min ${ts[0].toFixed(3)} ms  ${bytes ? (bytes / 1e6 / (med / 1e3)).toFixed(0) + ' MB/s of input' : ''}`,
  );
  return r;
}

const ref = { n: meta.expandedPoints, s: meta.expandedSum };
for (const [label, fn, buf] of [
  ['varint planes decode+expand', decodeVarint, files.varint],
  ['u16 shuffled planes decode+expand', decodeShuf, files.u16shuf],
  ['abs i16 planes (GPU-direct) +expand', decodeAbs, files.abs],
  ['triplet planes decode+expand', decodeTriplet, files.triplet],
]) {
  const r = time(label, () => fn(buf), buf.length);
  const c = checksum(r);
  if (c.n !== ref.n || c.s !== ref.s) console.log(`  CHECKSUM MISMATCH ${JSON.stringify(c)} vs ${JSON.stringify(ref)}`);
}
if (moBin) {
  const { MeshoptDecoder } =
    await import('/home/user/glyph/node_modules/.pnpm/meshoptimizer@1.1.1/node_modules/meshoptimizer/index.js');
  await MeshoptDecoder.ready;
  const mj = JSON.parse(readFileSync(moJson, 'utf8'));
  const mb = new Uint8Array(readFileSync(moBin));
  let o = 0;
  for (const k of ['offsets', 'cn', 'comp', 'flags']) o += mj[k];
  const enc = mb.subarray(o, o + mj.xy);
  const out = new Uint8Array(mj.points * 4);
  time(
    `meshopt decodeVertexBuffer (${MeshoptDecoder.supported ? 'wasm' : 'n/a'})`,
    () => MeshoptDecoder.decodeVertexBuffer(out, mj.points, 4, enc),
    enc.length,
  );
}
const r = decodeVarint(files.varint);
const st = time('expanded structure (tags/contours)', () => expandedStructure(r, meta.cubic), 0, 5);
const b = time('Slug bands at load (16+16/glyph)', () => buildBands(r, r.flags, meta.cubic, st), 0, 5);
console.log(`${key} bands: segments=${b.segCount} refs=${b.refTotal}`);
