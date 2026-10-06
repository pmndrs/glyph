// Wasm (scalar, no SIMD) timings of every band step, in Node 22.
// Usage: node bench.mjs <bandlab.wasm> <data/key-set.vfb> <out.json> [--quick]
// The data's .json sidecar (written by vfb_emit.py) names the specs and locations. Per glyph set (subset 0 = the
// distinct glyphs of a ~200-character text, 1 = 200 distinct glyphs, 255 = every glyph, 254 = every k-th glyph to
// about 5,000 for CJK) and per spec, each step runs on alternating instance slots (two random locations of the
// spec's kind), and the median of 9 samples is reported in microseconds per glyph.
import { readFileSync, writeFileSync } from 'node:fs';

const [wasmPath, vfbPath, outPath] = process.argv.slice(2);
const quick = process.argv.includes('--quick');
const meta = JSON.parse(readFileSync(vfbPath.replace(/\.vfb$/, '.json'), 'utf8'));
const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {});
const w = instance.exports;
const bytes = readFileSync(vfbPath);
const ptr = w.alloc(bytes.length);
new Uint8Array(w.memory.buffer, ptr, bytes.length).set(bytes);
const glyphCount = w.load(ptr, bytes.length);

const STEPS = {
  instance: 0,
  curves: 1,
  hulls: 2,
  s1_slug: 3,
  s1_fast: 4,
  s2_load: 5,
  '5a_bin': 6,
  resort: 7,
  '5c_filter_sort': 8,
  '5c_filter_only': 9,
  fixed_exact: 10,
  '5b_linear': 11,
  s1_hint: 12,
};
const SPEC_INDEPENDENT = ['instance', 'curves', 'hulls', 's1_slug', 's1_fast', 's1_hint', '5b_linear'];
const SPEC_DEPENDENT = ['s2_load', '5a_bin', 'resort', '5c_filter_sort', '5c_filter_only', 'fixed_exact'];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

function measure(step, glyphs) {
  let slot = 0;
  const call = () => {
    slot ^= 1;
    return w.run(step, slot);
  };
  const minMs = quick ? 5 : 25;
  let reps = 1;
  for (;;) {
    const t = performance.now();
    for (let i = 0; i < reps; i++) call();
    if (performance.now() - t >= minMs || reps > 1 << 20) break;
    reps *= 2;
  }
  const samples = [];
  for (let s = 0; s < 9; s++) {
    const t = performance.now();
    for (let i = 0; i < reps; i++) call();
    samples.push((performance.now() - t) / reps);
  }
  return (median(samples) * 1000) / glyphs;
}

// location kinds: 3 random over all axes (6 when the font has exactly opsz+wght), 4 wght only, 5 wght+wdth
function locationsFor(specKind) {
  const multi = meta.axes.length > 1;
  const wanted = specKind === 1 ? [4] : specKind === 2 ? [5] : multi ? [3, 6] : [4];
  const found = meta.locations.flatMap((l, i) => (wanted.includes(l.kind) ? [i] : []));
  return [found[0], found[1]];
}

const specs = meta.specs.flatMap((s, i) => (s.kind <= 2 ? [{ index: i, name: s.name, kind: s.kind }] : []));
const subsets = meta.key === 'cjk' ? [0, 1, 254] : [0, 1, 255];
const out = { key: meta.key, set: meta.set, glyphs: glyphCount, wasm: wasmPath, quick, configs: [] };
for (const subset of subsets) {
  for (const [k, spec] of specs.entries()) {
    const [a, b] = locationsFor(spec.kind);
    const glyphs = w.prepare(subset, spec.index, a, b);
    const curves = w.curve_count();
    const steps = {};
    for (const name of k === 0 ? [...SPEC_INDEPENDENT, ...SPEC_DEPENDENT] : SPEC_DEPENDENT) {
      steps[name] = Number(measure(STEPS[name], glyphs).toFixed(4));
    }
    out.configs.push({ subset, spec: spec.name, locations: [a, b], glyphs, curves, steps });
    console.log(
      meta.key,
      meta.set,
      'subset',
      subset,
      spec.name,
      'glyphs',
      glyphs,
      'curves',
      curves,
      JSON.stringify(steps),
    );
  }
}
writeFileSync(outPath, JSON.stringify(out, null, 1));
