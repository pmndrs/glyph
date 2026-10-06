// Decode speed: candidate Wasm decoders (decoder/, built to wasm/all.wasm) vs the shipped shaper's outline decoder
// (packages/glyph/dist/text-shaper.wasm, pmndrs_glyph_shaper_glyph_outline = read-fonts glyf loader or CFF
// charstring interpreter + cubic_to_quadratics_into(.., 4), then its f32 2n+1 encoding).
// Usage: node bench3.mjs <bench3-dir> <key> <decoders.wasm> <text-shaper.wasm> [glyph-outline.js]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, key, decWasm, shaperWasm, outlineJs] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf8'));
const G = meta.glyphs,
  C = meta.contours,
  P = meta.points;

function time(fn, reps = 21) {
  fn();
  fn();
  const ts = [];
  for (let i = 0; i < reps; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    ts.push(Number(process.hrtime.bigint() - t0) / 1e3);
  }
  ts.sort((a, b) => a - b);
  return { med: ts[ts.length >> 1], min: ts[0] };
}
const _fmt = (label, t, n, unit = 'glyph') =>
  console.log(
    `${key.padEnd(8)} ${label.padEnd(46)} median ${(t.med / 1e3).toFixed(3).padStart(8)} ms  ${(t.med / n).toFixed(3).padStart(7)} us/${unit}  ${(((t.med / n) * 1000) / 1e3).toFixed(1).padStart(7)} us/1000 ${unit}s->ms? `,
  );
const line = (label, t, n) =>
  console.log(
    `${key.padEnd(8)} ${label.padEnd(48)} total ${(t.med / 1e3).toFixed(3).padStart(8)} ms   ${(t.med / n).toFixed(3).padStart(7)} us/glyph   ${(t.med / n).toFixed(1).padStart(6)} ms/1000 glyphs`,
  );

// ---------------------------------------------------------------- candidate decoders
const dec = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(decWasm)), {}).exports;
const mem = dec.memory;
let top = mem.buffer.byteLength;
const alloc = (n) => {
  const a = (top + 15) & ~15;
  top = a + n;
  const need = top - mem.buffer.byteLength;
  if (need > 0) mem.grow(Math.ceil(need / 65536));
  return a;
};
const put = (bytes) => {
  const p = alloc(bytes.length);
  new Uint8Array(mem.buffer, p, bytes.length).set(bytes);
  return p;
};
const inputs = {};
for (const f of ['varint', 'triplet', 'bp16']) {
  const blob = new Uint8Array(readFileSync(join(dir, `${key}.${f}.bin`)));
  const base = put(blob);
  inputs[f] = Object.fromEntries(Object.entries(meta[f]).map(([k, [o]]) => [k, base + o]));
  inputs[f].bytes = blob.length;
}
const gp = alloc(4 * G),
  cs = alloc(2 * C),
  X = alloc(2 * P),
  Y = alloc(2 * P),
  T = alloc(P);
const out = alloc(64 + 4 * C + 8 * (3 * P + 4 * C)); // generous: explicit points <= 2*points + contours
const run = {
  varint: () =>
    dec.decode_varint(inputs.varint.hdr, G, inputs.varint.cn, inputs.varint.flags, inputs.varint.xy, gp, cs, X, Y, T),
  triplet: () =>
    dec.decode_triplet(
      inputs.triplet.hdr,
      G,
      inputs.triplet.cn,
      inputs.triplet.flags,
      inputs.triplet.data,
      gp,
      cs,
      X,
      Y,
      T,
    ),
  bp16: () =>
    dec.decode_bp16(
      G,
      inputs.bp16.point_count,
      inputs.bp16.contour_count,
      inputs.bp16.bbox,
      inputs.bp16.contour_ends,
      inputs.bp16.flags_u64,
      inputs.bp16.x_width,
      inputs.bp16.x_bits,
      inputs.bp16.y_width,
      inputs.bp16.y_bits,
      cs,
      X,
      Y,
      T,
    ),
};
function check(label) {
  const x = new Int16Array(mem.buffer, X, P),
    y = new Int16Array(mem.buffer, Y, P),
    t = new Uint8Array(mem.buffer, T, P);
  let sx = 0,
    sy = 0,
    on = 0;
  for (let i = 0; i < P; i++) {
    sx += x[i];
    sy += y[i];
    on += t[i] === 0;
  }
  const ok = sx === meta.sumX && sy === meta.sumY && on === meta.onCurve;
  if (!ok)
    console.log(`  ${label} CHECKSUM MISMATCH x ${sx}/${meta.sumX} y ${sy}/${meta.sumY} on ${on}/${meta.onCurve}`);
  return ok;
}
for (const [f, fn] of Object.entries(run)) {
  fn();
  check(f);
  const t = time(fn, 51);
  line(`load: decode whole font, ${f} (${inputs[f].bytes} B)`, t, G);
}
// per-glyph bases from the decoded structure (bp16 path writes contour sizes too)
run.varint();
const csz = new Uint16Array(mem.buffer, cs, C).slice();
const gpts = new Uint32Array(mem.buffer, gp, G).slice();
const gcont = new Uint32Array(G + 1),
  gbase = new Uint32Array(G + 1);
{
  // contour count per glyph: walk contour sizes against glyph point counts
  let c = 0;
  for (let g = 0; g < G; g++) {
    gcont[g] = c;
    gbase[g + 1] = gbase[g] + gpts[g];
    let n = 0;
    while (n < gpts[g]) n += csz[c++];
  }
  gcont[G] = c;
}
const emitAll = () => {
  let bytes = 0;
  for (let g = 0; g < G; g++) {
    const nc = gcont[g + 1] - gcont[g];
    if (!nc) continue;
    bytes += dec.emit_outline(X + 2 * gbase[g], Y + 2 * gbase[g], T + gbase[g], cs + 2 * gcont[g], nc, out);
  }
  return bytes;
};
line('outlineAt core: stencil -> f32 2n+1 (all glyphs)', time(emitAll), G);
let refs = 0;
const bandsAll = () => {
  refs = 0;
  for (let g = 0; g < G; g++) {
    const nc = gcont[g + 1] - gcont[g];
    if (!nc) continue;
    const r = dec.build_bands(X + 2 * gbase[g], Y + 2 * gbase[g], T + gbase[g], cs + 2 * gcont[g], nc, meta.upm);
    if (r === 0xffffffff) throw new Error(`bands failed g=${g}`);
    refs += r;
  }
};
line(`Slug bands at load, slug-core 16+16 (refs=${(bandsAll(), refs)})`, time(bandsAll, 7), G);

// ---------------------------------------------------------------- shipped decoder
const sh = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(shaperWasm)), {}).exports;
const font = new Uint8Array(readFileSync(meta.font));
const fp = sh.pmndrs_glyph_shaper_alloc(font.length);
new Uint8Array(sh.memory.buffer, fp, font.length).set(font);
let bad = 0;
const shippedAll = () => {
  bad = 0;
  for (let g = 0; g < G; g++) if (sh.pmndrs_glyph_shaper_glyph_outline(fp, font.length, g) !== 0) bad++;
};
shippedAll();
line(`SHIPPED shaper outline decode (all glyphs, ${bad} failed)`, time(shippedAll, 7), G);
// correctness cross-check vs the candidate stencil emitter (TrueType: same points, same order expected)
let same = 0,
  sameCurves = 0,
  outlined = 0;
for (let g = 0; g < G; g++) {
  const nc = gcont[g + 1] - gcont[g];
  if (!nc) continue;
  outlined++;
  const n = dec.emit_outline(X + 2 * gbase[g], Y + 2 * gbase[g], T + gbase[g], cs + 2 * gcont[g], nc, out);
  const a = new Uint8Array(mem.buffer, out, n);
  sh.pmndrs_glyph_shaper_glyph_outline(fp, font.length, g);
  const b = new Uint8Array(
    sh.memory.buffer,
    sh.pmndrs_glyph_shaper_glyph_outline_ptr(),
    sh.pmndrs_glyph_shaper_glyph_outline_len(),
  );
  if (a.length === b.length) {
    sameCurves++;
    let eq = true;
    for (let i = 0; i < a.length; i++)
      if (a[i] !== b[i]) {
        eq = false;
        break;
      }
    same += eq;
  }
}
console.log(
  `${key.padEnd(8)} cross-check vs shipped: ${outlined} outlined glyphs, ${sameCurves} same byte length, ${same} byte-identical`,
);
if (outlineJs) {
  const { readGlyphOutline } = await import(outlineJs);
  const glyph = { x: 0, y: 0, fontSize: 16 };
  const fullShipped = () => {
    for (let g = 0; g < G; g++) {
      if (sh.pmndrs_glyph_shaper_glyph_outline(fp, font.length, g) !== 0) continue;
      readGlyphOutline(
        new Uint8Array(
          sh.memory.buffer,
          sh.pmndrs_glyph_shaper_glyph_outline_ptr(),
          sh.pmndrs_glyph_shaper_glyph_outline_len(),
        ),
        meta.upm,
        glyph,
      );
    }
  };
  line('SHIPPED outlineAt path: Wasm decode + readGlyphOutline', time(fullShipped, 7), G);
  const fullNew = () => {
    for (let g = 0; g < G; g++) {
      const nc = gcont[g + 1] - gcont[g];
      if (!nc) continue;
      const n = dec.emit_outline(X + 2 * gbase[g], Y + 2 * gbase[g], T + gbase[g], cs + 2 * gcont[g], nc, out);
      readGlyphOutline(new Uint8Array(mem.buffer, out, n), meta.upm, glyph);
    }
  };
  line('candidate outlineAt path: stencil emit + readGlyphOutline', time(fullNew, 7), G);
}
