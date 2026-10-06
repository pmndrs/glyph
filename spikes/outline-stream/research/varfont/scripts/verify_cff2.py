"""CFF2 instancing check: the Wasm instancer's quadratic instance (out/inst-<key>-<set>.bin) against
fontTools.varLib.instancer's static instance of the same CFF2 font (cubic, coordinates as the instancer writes them),
per cubic segment (65 samples on the cubic, distance to the instanced quadratic chain flattened 64x per piece).
Two references: instantiateVariableFont as shipped (its CFF2 path rounds every blended relative charstring operand,
so absolute positions drift along a contour) and instantiateCFF2(round=noRound) (exact blend, unrounded).
Also: Wasm f64 result vs the Python float instance rounded to the grid (should be identical).
Usage: verify_cff2.py <key> <font.otf> <latin|full> <model.pkl> [glyph sample]"""
import sys, os, json, pickle, io
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import vmodel as V, cff2 as C  # noqa: E401,E402
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
from fontTools.varLib import instancer

key, path, which, pk = sys.argv[1:5]
cap = int(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5].isdigit() else 0
m = pickle.load(open(pk, 'rb')); grid = m['grid']
ks = f"{key}-{os.path.basename(pk).replace('.pkl', '')}"
OUT = os.path.join(HERE, '..', 'out')
idx = json.load(open(os.path.join(OUT, f'inst-{ks}.json')))
blob = np.fromfile(os.path.join(OUT, f'inst-{ks}.bin'), np.int16)
NV, DP, G = idx['varpoints'], idx['decomposed'], idx['glyphs']; per = 2 * NV if idx.get('lean') else 2 * NV + 2 * DP + 4 * G
NOINST = '--no-instancer' in sys.argv
vbase = idx['vbase']
names = m['names']
rng = np.random.default_rng(9)
gsel = range(G) if not cap or cap >= G else sorted(rng.choice(G, cap, replace=False).tolist())
res = []
for li, loc in enumerate(idx['locations']):
    from fontTools.misc.roundTools import noRound
    if NOINST:
        # exact blend through the glyph set at the same normalized location (equal to instantiateCFF2 noRound,
        # checked on Source Serif: max |diff| 0.0)
        f0 = TTFont(path)
        norm0 = V.user_to_norm(dict(axes=m['axes'], avar=m['avar']), loc)
        refs = {'exact blend (glyph set, normalized)': f0.getGlyphSet(location={t: v for (t, *_), v in zip(m['axes'], norm0) if v}, normalized=True) if any(norm0) else f0.getGlyphSet()}
    else:
        font = V.open_set(path, which) if which in ('latin', 'full') else TTFont(path)
        inst = instancer.instantiateVariableFont(font, loc, inplace=False)
        bio = io.BytesIO(); inst.save(bio); bio.seek(0); inst = TTFont(bio)
        exact = V.open_set(path, which) if which in ('latin', 'full') else TTFont(path)
        instancer.instantiateCFF2(exact, instancer.AxisLimits(loc).normalize(exact), round=noRound)
        refs = {'instancer as shipped (rounded operands)': inst.getGlyphSet(), 'instancer, round=noRound': exact.getGlyphSet()}
    norm = V.user_to_norm(dict(axes=m['axes'], avar=m['avar']), loc)
    s = np.array([V.region_scalar(r, norm) for r in m['regions']])
    for e in idx['index']:
        if e['loc'] != li or e['variant'] not in ('dense i16, f64 scalar', 'dense i16, f32 SIMD'): continue
        o = e['offset'] // 2; a = blob[o:o + per].astype(np.int64)
        ox, oy = a[:NV], a[NV:2 * NV]
        for rname, gs in refs.items():
            errs = []; mism_py = 0; glyph_skip = 0; coords = 0
            for g in gsel:
                r = m['rows'][names[g]]
                if r[1] == 'fail' or not r[1]: continue
                P0 = np.array([q for c in r[1] for q in c], np.float64).reshape(-1, 3)[:, :2]
                Q = P0 + sum(si * d for si, d in zip(s, r[2]) if si) if len(r[2]) else P0
                Qr = np.floor(Q + 0.5)
                W = np.stack([ox[vbase[g]:vbase[g + 1]], oy[vbase[g]:vbase[g + 1]]], 1)
                mism_py += int((W != Qr).sum()); coords += W.size
                rec = RecordingPen(); gs[names[g]].draw(rec); cur = None; cubics = []
                for op, args in rec.value:
                    if op in ('moveTo', 'lineTo'): cur = args[-1]
                    elif op == 'curveTo': cubics.append((cur,) + tuple(args)); cur = args[-1]
                if len(cubics) != len(r[3]): glyph_skip += 1; continue
                Wf = W / grid
                offsets = np.cumsum([0] + [len(c) for c in r[1]])
                for k, (ci, st, offs, en) in enumerate(r[3]):
                    b = offsets[ci]
                    errs.append(C.dist(C.cubic_pts(cubics[k]), C.quad_chain(Wf[b + st], [Wf[b + q] for q in offs], Wf[b + en])))
            errs = np.array(errs)
            row = dict(loc=loc, variant=e['variant'], reference=rname, wasm_vs_python_mismatch=mism_py, coords=coords, glyphs_skipped=glyph_skip,
                       cubics=len(errs), max=float(errs.max()), p99=float(np.percentile(errs, 99)), mean=float(errs.mean()))
            res.append(row)
            print(f"{json.dumps(loc):34s} {e['variant']:22s} {rname:40s} Wasm vs Python-float-rounded mismatches {mism_py}/{coords};"
                  f" vs fontTools instancer cubics ({len(errs)}; {glyph_skip} glyphs skipped): max/p99/mean {row['max']:.3f}/{row['p99']:.3f}/{row['mean']:.3f}")
json.dump(res, open(os.path.join(OUT, f'verify-{ks}.json'), 'w'), indent=1)
