import { readFileSync } from 'node:fs';
const [shaperWasm, fontPath, gid] = process.argv.slice(2);
const sh = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(shaperWasm)), {}).exports;
const font = new Uint8Array(readFileSync(fontPath));
const fp = sh.pmndrs_glyph_shaper_alloc(font.length);
new Uint8Array(sh.memory.buffer, fp, font.length).set(font);
sh.pmndrs_glyph_shaper_glyph_outline(fp, font.length, +gid);
const b = new Uint8Array(
  sh.memory.buffer,
  sh.pmndrs_glyph_shaper_glyph_outline_ptr(),
  sh.pmndrs_glyph_shaper_glyph_outline_len(),
).slice();
const v = new DataView(b.buffer);
const n = v.getUint32(0, true);
const ends = [];
for (let c = 0; c < n; c++) ends.push(v.getUint32(4 + 4 * c, true));
const pts = [];
for (let p = 0; p < ends[ends.length - 1]; p++)
  pts.push([v.getFloat32(4 + 4 * n + p * 8, true), v.getFloat32(4 + 4 * n + p * 8 + 4, true)]);
console.log(ends, JSON.stringify(pts.slice(0, 12)));
