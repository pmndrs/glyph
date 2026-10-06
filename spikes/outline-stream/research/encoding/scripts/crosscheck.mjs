// Compare candidate stencil outlines with the shipped decoder as sets of curves per contour (start-point rotation
// ignored). Usage: node crosscheck.mjs <bench3-dir> <key> <decoders.wasm> <text-shaper.wasm>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const [dir, key, decWasm, shaperWasm] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf8'));
const G = meta.glyphs,
  C = meta.contours,
  P = meta.points;
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
const blob = new Uint8Array(readFileSync(join(dir, `${key}.varint.bin`)));
const base = alloc(blob.length);
new Uint8Array(mem.buffer, base, blob.length).set(blob);
const L = Object.fromEntries(Object.entries(meta.varint).map(([k, [o]]) => [k, base + o]));
const gp = alloc(4 * G),
  cs = alloc(2 * C),
  X = alloc(2 * P),
  Y = alloc(2 * P),
  T = alloc(P),
  out = alloc(64 + 4 * C + 8 * (3 * P + 4 * C));
dec.decode_varint(L.hdr, G, L.cn, L.flags, L.xy, gp, cs, X, Y, T);
const csz = new Uint16Array(mem.buffer, cs, C).slice(),
  gpts = new Uint32Array(mem.buffer, gp, G).slice();
const gcont = new Uint32Array(G + 1),
  gbase = new Uint32Array(G + 1);
{
  let c = 0;
  for (let g = 0; g < G; g++) {
    gcont[g] = c;
    gbase[g + 1] = gbase[g] + gpts[g];
    let n = 0;
    while (n < gpts[g]) n += csz[c++];
  }
  gcont[G] = c;
}
const sh = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(shaperWasm)), {}).exports;
const font = new Uint8Array(readFileSync(meta.font));
const fp = sh.pmndrs_glyph_shaper_alloc(font.length);
new Uint8Array(sh.memory.buffer, fp, font.length).set(font);
const curves = (bytes) => {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = v.getUint32(0, true);
  const po = 4 + 4 * n;
  const res = [];
  let s = 0;
  for (let c = 0; c < n; c++) {
    const e = v.getUint32(4 + 4 * c, true);
    const list = [];
    for (let p = s; p + 2 < e; p += 2) {
      const q = [];
      for (let k = 0; k < 3; k++)
        q.push(v.getFloat32(po + (p + k) * 8, true), v.getFloat32(po + (p + k) * 8 + 4, true));
      list.push(q.join(','));
    }
    res.push(list.sort().join('|'));
    s = e;
  }
  return res.sort().join('#');
};
let same = 0,
  n = 0,
  firstBad = -1;
for (let g = 0; g < G; g++) {
  const nc = gcont[g + 1] - gcont[g];
  if (!nc) continue;
  n++;
  const k = dec.emit_outline(X + 2 * gbase[g], Y + 2 * gbase[g], T + gbase[g], cs + 2 * gcont[g], nc, out);
  const a = curves(new Uint8Array(mem.buffer, out, k).slice());
  sh.pmndrs_glyph_shaper_glyph_outline(fp, font.length, g);
  const b = curves(
    new Uint8Array(
      sh.memory.buffer,
      sh.pmndrs_glyph_shaper_glyph_outline_ptr(),
      sh.pmndrs_glyph_shaper_glyph_outline_len(),
    ).slice(),
  );
  if (a === b) same++;
  else if (firstBad < 0) firstBad = g;
}
console.log(
  `${key}: ${same}/${n} glyphs have identical curve sets (start rotation ignored); first differing gid ${firstBad}`,
);
if (process.env.DUMP) {
  const g = +process.env.DUMP;
  const nc = gcont[g + 1] - gcont[g];
  const k = dec.emit_outline(X + 2 * gbase[g], Y + 2 * gbase[g], T + gbase[g], cs + 2 * gcont[g], nc, out);
  const v = new DataView(mem.buffer, out, k);
  const n = v.getUint32(0, true);
  const ends = [];
  for (let c = 0; c < n; c++) ends.push(v.getUint32(4 + 4 * c, true));
  const pts = [];
  for (let p = 0; p < 12; p++)
    pts.push([v.getFloat32(4 + 4 * n + p * 8, true), v.getFloat32(4 + 4 * n + p * 8 + 4, true)]);
  console.log(ends, JSON.stringify(pts));
}
