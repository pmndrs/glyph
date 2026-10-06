// Decode + instance benchmark and verification dump for one font set.
// Usage: node bench.mjs <bench-dir> <key-set> <wasm-dir> <out-dir> [--quick]
// Builds: <wasm-dir>/scalar-release.wasm (-simd128) and simd-release.wasm (+simd128).
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const [benchDir, ks, wasmDir, outDir, ...flags] = process.argv.slice(2);
const quick = flags.includes('--quick');
const lean = flags.includes('--lean'); // CJK-size fonts: dump only two variants and only the own var points
const meta = JSON.parse(readFileSync(`${benchDir}/${ks}.json`, 'utf8'));
const bin = readFileSync(`${benchDir}/${ks}.bin`);
const G = meta.glyphs,
  A = meta.axes,
  R = meta.regions;

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
}
function bench(fn, minMs = quick ? 5 : 40, samples = quick ? 3 : 9) {
  let reps = 1;
  for (;;) {
    const t = performance.now();
    for (let i = 0; i < reps; i++) fn();
    if (performance.now() - t >= minMs / 4 || reps > 1e6) break;
    reps *= 2;
  }
  const out = [];
  for (let s = 0; s < samples; s++) {
    const t = performance.now();
    for (let i = 0; i < reps; i++) fn();
    out.push((performance.now() - t) / reps);
  }
  return median(out); // ms per call
}

async function load(name) {
  const { instance } = await WebAssembly.instantiate(readFileSync(`${wasmDir}/${name}.wasm`), {});
  const e = instance.exports;
  const M = { e, mem: e.memory };
  M.alloc = (n) => {
    const p = e.alloc(n);
    if (!p) throw new Error('oom');
    return p;
  };
  M.u8 = () => new Uint8Array(e.memory.buffer);
  M.put = (bytes) => {
    const p = M.alloc(bytes.length + 16);
    M.u8().set(bytes, p);
    return p;
  };
  M.sec = (k) => {
    const [o, l] = meta.sections[k];
    return M.put(bin.subarray(o, o + l));
  };
  M.view = (T, p, n) => new T(e.memory.buffer, p, n);
  return M;
}

function setup(M) {
  const e = M.e,
    S = {};
  for (const k of Object.keys(meta.sections)) S[k] = M.sec(k);
  const C = meta.contours,
    NC = meta.comps,
    P = meta.points,
    NV = meta.varpoints;
  const a = (n) => M.alloc(n);
  const st = {
    kind: a(G),
    npts: a(4 * G),
    nvar: a(4 * G),
    cfirst: a(4 * G),
    csize: a(2 * C),
    gid: a(4 * NC),
    cdx: a(2 * NC),
    cdy: a(2 * NC),
    sx: a(2 * P + 32),
    sy: a(2 * P + 32),
    stags: a(P + 32),
    vbase: a(4 * (G + 1)),
    vx: a(2 * NV + 32),
    vy: a(2 * NV + 32),
    vtags: a(NV + 32),
    cfc: a(4 * G),
  };
  const baseLoad = () => {
    e.structure(S.base_hdr, G, S.base_cn, st.kind, st.npts, st.nvar, st.cfirst, st.csize);
    if (e.components(S.base_comp, NC, st.gid, st.cdx, st.cdy) !== 0) throw new Error('transform');
  };
  const unify = () =>
    e.unify(G, st.kind, st.nvar, st.sx, st.sy, st.stags, st.cdx, st.cdy, st.vbase, st.vx, st.vy, st.vtags, st.cfc);
  baseLoad();
  // deltas
  const D = {};
  for (const mode of ['dense', 'sparse']) {
    const slots = mode === 'dense' ? meta.slots_dense : meta.slots_sparse,
      T = meta.tuples;
    const d = {
      tfirst: a(4 * (G + 1)),
      tg: a(4 * T),
      tr: a(4 * T),
      tl: a(4 * T),
      to: a(4 * T),
      idx: a(2 * slots + 32),
      vxs: a(2 * slots + 32),
      vys: a(2 * slots + 32),
      slots,
    };
    d.structure = () =>
      e.delta_structure(
        G,
        S[`${mode}_tcount`],
        S[`${mode}_rid`],
        mode === 'sparse' ? S.sparse_points : 0,
        st.nvar,
        d.tfirst,
        d.tg,
        d.tr,
        d.tl,
        d.to,
        d.idx,
      );
    if (d.structure() !== T) throw new Error('tuple count');
    D[mode] = d;
  }
  const sp = D.sparse;
  sp.doff = a(4 * meta.tuples);
  sp.px32 = a(4 * meta.slots_dense + 64);
  sp.py32 = a(4 * meta.slots_dense + 64);
  sp.px64 = a(8 * meta.slots_dense + 64);
  sp.py64 = a(8 * meta.slots_dense + 64);
  sp.scratch = a(meta.max_glyph_varpoints + 16);
  sp.sdx = a(8 * meta.max_glyph_varpoints + 16);
  sp.sdy = a(8 * meta.max_glyph_varpoints + 16);
  sp.iup = (wide) =>
    e.iup_expand(
      meta.tuples,
      sp.tg,
      sp.tl,
      sp.to,
      sp.idx,
      sp.vxs,
      sp.vys,
      st.kind,
      st.nvar,
      st.vbase,
      st.cfirst,
      st.csize,
      st.vx,
      st.vy,
      wide,
      wide ? sp.px64 : sp.px32,
      wide ? sp.py64 : sp.py32,
      sp.doff,
      sp.scratch,
      sp.sdx,
      sp.sdy,
    );
  // instance + decomposition buffers
  const norm = a(4 * A),
    s64 = a(8 * R),
    s32 = a(4 * R),
    user = a(8 * A);
  const ox = a(2 * NV + 32),
    oy = a(2 * NV + 32);
  const DP = meta.decomposed_points,
    dbase = a(4 * (G + 1)),
    dx = a(2 * DP + 32),
    dy = a(2 * DP + 32),
    bnd = a(8 * G);
  return { S, st, D, baseLoad, unify, norm, s64, s32, user, ox, oy, DP, dbase, dx, dy, bnd };
}

function decodeBase(M, X, fn, g = 0) {
  return M.e[fn](0, X.S.base_flags, X.S.base_data, X.st.npts, G, X.st.sx, X.st.sy, X.st.stags, g);
}
function decodeDeltas(M, X, mode, fn, g = 0) {
  const d = X.D[mode];
  return M.e[fn](1, X.S[`${mode}_dflags`], X.S[`${mode}_ddata`], d.tl, meta.tuples, d.vxs, d.vys, 0, g);
}
const SIMD_DECODERS = [
  ['trip_decode_simd', 0, 'SIMD v1: scalar gathers'],
  ['trip_decode_simd2', 0, 'SIMD v2: swizzle window'],
  ['trip_decode_simd2', 1, 'SIMD v2: swizzle window + global prefix'],
];
function setLoc(M, X, li) {
  M.view(Float64Array, X.user, A).set(meta.locations_user[li]);
  M.e.normalize(A, X.S.axes, X.S.avar_counts, X.S.avar_pairs, X.user, X.norm);
  M.e.scalars(R, A, X.S.regions, X.norm, X.s64, X.s32);
}
function dbaseFill(M, X) {
  const kind = M.view(Uint8Array, X.st.kind, G),
    nvar = M.view(Uint32Array, X.st.nvar, G),
    cfc = M.view(Uint32Array, X.st.cfc, G);
  const gid = M.view(Uint32Array, X.st.gid, meta.comps),
    db = M.view(Uint32Array, X.dbase, G + 1);
  let w = 0;
  for (let g = 0; g < G; g++) {
    db[g] = w;
    if (kind[g] === 2) {
      for (let c = 0; c < nvar[g]; c++) w += nvar[gid[cfc[g] + c]];
    } else w += nvar[g];
  }
  db[G] = w;
  if (w !== X.DP) throw new Error(`decomposed ${w} != ${X.DP}`);
}
// variant: [fnName, pool kind, scalar ptr name, dx, dy, doff]
function inst(M, X, v, g0 = 0, g1 = G) {
  const d = v.mode === 'dense' ? X.D.dense : X.D.sparse;
  const doff = v.mode === 'dense' ? d.to : d.doff;
  const [px, py] = v.mode === 'dense' ? [d.vxs, d.vys] : v.pool === 2 ? [d.px64, d.py64] : [d.px32, d.py32];
  const sc = v.fn === 'instance_f64' || v.fn === 'instance_simd64' ? X.s64 : X.s32;
  M.e[v.fn](g0, g1, X.st.nvar, X.st.vbase, d.tfirst, d.tr, doff, sc, X.st.vx, X.st.vy, v.pool, px, py, X.ox, X.oy);
}

meta.locations_user = meta.locations.map(() => []);
// fvar order from the axes section
{
  const [o] = meta.sections.axes;
  const ax = new Float64Array(bin.buffer.slice(bin.byteOffset + o, bin.byteOffset + o + 24 * A));
  const [lo] = meta.sections.locations;
  const lv = new Float64Array(
    bin.buffer.slice(bin.byteOffset + lo, bin.byteOffset + lo + 8 * A * meta.locations.length),
  );
  meta.locations_user = meta.locations.map((_, i) => Array.from(lv.subarray(i * A, (i + 1) * A)));
  void ax;
}

const builds = { scalar: await load('scalar-release'), simd: await load('simd-release') };
const X = { scalar: setup(builds.scalar), simd: setup(builds.simd) };
const res = {
  key: meta.key,
  set: meta.set,
  glyphs: G,
  points: meta.points,
  varpoints: meta.varpoints,
  tuples: meta.tuples,
  slots_dense: meta.slots_dense,
  slots_sparse: meta.slots_sparse,
  regions: R,
  timings: {},
  checks: {},
};
const T = res.timings;

// ---------------------------------------------------------------- decode correctness: scalar vs SIMD byte-identical
for (const b of ['scalar', 'simd']) {
  const M = builds[b],
    Y = X[b];
  decodeBase(M, Y, 'trip_decode');
  Y.unify();
  for (const m of ['dense', 'sparse']) decodeDeltas(M, Y, m, 'trip_decode');
}
{
  const M = builds.simd,
    Y = X.simd;
  const keep = (p, n) => M.view(Uint8Array, p, n).slice();
  const refx = keep(Y.st.sx, 2 * meta.points),
    refy = keep(Y.st.sy, 2 * meta.points),
    reft = keep(Y.st.stags, meta.points);
  const refd = ['dense', 'sparse'].map((m) => [keep(Y.D[m].vxs, 2 * Y.D[m].slots), keep(Y.D[m].vys, 2 * Y.D[m].slots)]);
  const same = (p, r) => Buffer.compare(Buffer.from(M.view(Uint8Array, p, r.length)), Buffer.from(r)) === 0;
  for (const [fn, g, label] of SIMD_DECODERS) {
    M.view(Uint8Array, Y.st.sx, 2 * meta.points).fill(0x55);
    const used = decodeBase(M, Y, fn, g);
    res.checks[`base ${label} equals scalar`] =
      same(Y.st.sx, refx) && same(Y.st.sy, refy) && same(Y.st.stags, reft) && used === meta.sections.base_data[1];
    ['dense', 'sparse'].forEach((m, i) => {
      M.view(Uint8Array, Y.D[m].vxs, 2 * Y.D[m].slots).fill(0x55);
      decodeDeltas(M, Y, m, fn, g);
      res.checks[`${m} ${label} equals scalar`] = same(Y.D[m].vxs, refd[i][0]) && same(Y.D[m].vys, refd[i][1]);
    });
  }
}
for (const b of ['scalar', 'simd']) {
  const M = builds[b],
    Y = X[b];
  Y.unify();
  Y.D.sparse.iup(0);
  dbaseFill(M, Y);
}

// ---------------------------------------------------------------- verification dump
const variants = {
  'dense i16, f32 scalar': { b: 'scalar', fn: 'instance_f32', mode: 'dense', pool: 0 },
  'dense i16, f64 scalar': { b: 'scalar', fn: 'instance_f64', mode: 'dense', pool: 0 },
  'dense i16, f32 SIMD': { b: 'simd', fn: 'instance_simd', mode: 'dense', pool: 0 },
  'sparse, IUP at load to f32, f32 scalar': { b: 'scalar', fn: 'instance_f32', mode: 'sparse', pool: 1 },
  'sparse, IUP at load to f32, f32 SIMD': { b: 'simd', fn: 'instance_simd', mode: 'sparse', pool: 1 },
  'sparse, IUP at load to f64, f64 scalar': { b: 'scalar', fn: 'instance_f64', mode: 'sparse', pool: 2 },
  'sparse, IUP at load to f64, f64x2 SIMD': { b: 'simd', fn: 'instance_simd64', mode: 'sparse', pool: 2 },
  'dense i16, f64x2 SIMD': { b: 'simd', fn: 'instance_simd64', mode: 'dense', pool: 0 },
};
const dump = [];
const index = [];
for (let li = 0; li < meta.locations.length; li++) {
  for (const [name, v] of Object.entries(variants)) {
    if (lean && name !== 'dense i16, f64 scalar' && name !== 'dense i16, f32 SIMD') continue;
    const M = builds[v.b],
      Y = X[v.b];
    if (v.pool === 2) Y.D.sparse.iup(1);
    else if (v.mode === 'sparse') Y.D.sparse.iup(0);
    setLoc(M, Y, li);
    inst(M, Y, v);
    M.e.expand(0, G, Y.st.kind, Y.st.nvar, Y.st.vbase, Y.st.cfc, Y.st.gid, Y.ox, Y.oy, Y.dbase, Y.dx, Y.dy);
    (v.b === 'simd' ? M.e.bounds_simd : M.e.bounds)(0, G, Y.dbase, Y.dx, Y.dy, Y.bnd);
    const parts = lean
      ? [M.view(Int16Array, Y.ox, meta.varpoints), M.view(Int16Array, Y.oy, meta.varpoints)]
      : [
          M.view(Int16Array, Y.ox, meta.varpoints),
          M.view(Int16Array, Y.oy, meta.varpoints),
          M.view(Int16Array, Y.dx, Y.DP),
          M.view(Int16Array, Y.dy, Y.DP),
          M.view(Int16Array, Y.bnd, 4 * G),
        ];
    index.push({ loc: li, variant: name, offset: dump.reduce((s, p) => s + p.byteLength, 0) });
    for (const p of parts) dump.push(Buffer.from(p.slice().buffer));
  }
}
const vb = builds.scalar;
const vy = X.scalar;
writeFileSync(`${outDir}/inst-${ks}.bin`, Buffer.concat(dump));
writeFileSync(
  `${outDir}/inst-${ks}.json`,
  JSON.stringify({
    index,
    lean,
    varpoints: meta.varpoints,
    decomposed: X.scalar.DP,
    glyphs: G,
    vbase: Array.from(vb.view(Uint32Array, vy.st.vbase, G + 1)),
    dbase: Array.from(vb.view(Uint32Array, vy.dbase, G + 1)),
    kind: Array.from(vb.view(Uint8Array, vy.st.kind, G)),
    locations: meta.locations,
  }),
);

// ---------------------------------------------------------------- timings (ms per call)
for (let pass = 0; pass < 2; pass++)
  for (const b of ['scalar', 'simd']) {
    if (pass === 0) {
      const M = builds[b],
        Y = X[b];
      for (let r = 0; r < 20; r++) {
        decodeBase(M, Y, 'trip_decode');
        decodeDeltas(M, Y, 'dense', 'trip_decode');
        if (b === 'simd')
          for (const [fn, g] of SIMD_DECODERS) {
            decodeBase(M, Y, fn, g);
            decodeDeltas(M, Y, 'dense', fn, g);
          }
      }
      continue;
    }
    const M = builds[b],
      Y = X[b];
    T[`${b}: base structure + components`] = bench(() => Y.baseLoad());
    T[`${b}: base triplets (scalar code)`] = bench(() => decodeBase(M, Y, 'trip_decode'));
    if (b === 'simd')
      for (const [fn, g, label] of SIMD_DECODERS)
        T[`simd: base triplets (${label})`] = bench(() => decodeBase(M, Y, fn, g));
    T[`${b}: unify to var points`] = bench(() => Y.unify());
    for (const m of ['dense', 'sparse']) {
      T[`${b}: ${m} delta structure`] = bench(() => Y.D[m].structure());
      T[`${b}: ${m} delta triplets (scalar code)`] = bench(() => decodeDeltas(M, Y, m, 'trip_decode'));
      if (b === 'simd')
        for (const [fn, g, label] of SIMD_DECODERS)
          T[`simd: ${m} delta triplets (${label})`] = bench(() => decodeDeltas(M, Y, m, fn, g));
    }
    T[`${b}: sparse IUP at load, to f32`] = bench(() => Y.D.sparse.iup(0));
    T[`${b}: sparse IUP at load, to f64`] = bench(() => Y.D.sparse.iup(1));
    Y.D.sparse.iup(0);
    const li = meta.locations.length - 1; // a random interior location: every region active where its tent covers it
    setLoc(M, Y, li);
    T[`${b}: normalize + region scalars`] = bench(() => setLoc(M, Y, li));
    const active = Array.from(M.view(Float64Array, Y.s64, R)).filter((s) => s !== 0).length;
    res.active_regions_at_timed_location = active;
    for (const [name, v] of Object.entries(variants)) {
      if (v.b !== b && !(b === 'simd' && v.b === 'scalar')) continue;
      const fnOk = M.e[v.fn];
      if (!fnOk) continue;
      if (v.pool === 2) Y.D.sparse.iup(1);
      else Y.D.sparse.iup(0);
      T[`${b}: instance whole font, ${name}`] = bench(() => inst(M, Y, v));
      if (name === 'dense i16, f32 scalar' || name === 'dense i16, f32 SIMD') {
        T[`${b}: instance glyph by glyph (one call per glyph), ${name}`] = bench(() => {
          for (let g = 0; g < G; g++) inst(M, Y, v, g, g + 1);
        });
      }
    }
    Y.D.sparse.iup(0);
    T[`${b}: expand composites`] = bench(() =>
      M.e.expand(0, G, Y.st.kind, Y.st.nvar, Y.st.vbase, Y.st.cfc, Y.st.gid, Y.ox, Y.oy, Y.dbase, Y.dx, Y.dy),
    );
    T[`${b}: ink bounds (scalar code)`] = bench(() => M.e.bounds(0, G, Y.dbase, Y.dx, Y.dy, Y.bnd));
    if (b === 'simd')
      T['simd: ink bounds (SIMD code)'] = bench(() => M.e.bounds_simd(0, G, Y.dbase, Y.dx, Y.dy, Y.bnd));
  }
writeFileSync(`${outDir}/bench-${ks}.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res.checks));
for (const [k, v] of Object.entries(T))
  console.log(
    `${k.padEnd(78)} ${(v * 1000).toFixed(1).padStart(9)} us  ${((v * 1000) / G).toFixed(3).padStart(8)} us/glyph`,
  );
