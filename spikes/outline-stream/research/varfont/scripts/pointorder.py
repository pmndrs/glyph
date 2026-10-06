"""Q3: does the GPU stencil layout (rotate each contour to start on an on-curve point, append one wrap point)
interact with the delta-to-point mapping?

Usage: pointorder.py <key> <font> <latin|full>
Checks, over every simple glyph and every location of the verify run:
  1. rotation statistics: contours whose first on-curve point is not point 0, wrap points, all-off-curve contours
  2. IUP is rotation-invariant: iup_contour on a rotated contour equals the rotated iup_contour result (max |diff|)
  3. order of operations: stencil(instance) built from the Wasm instancer's decomposed output (sparse, f64) equals
     stencil(fontTools instance), and equals gather(instance, stencil index map built once from the default)
  4. the wrong order: applying stream-order deltas to stencil slots without the index map; mismatching points
"""
import sys, os, json
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import vmodel as V  # noqa: E402
from fontTools.varLib.iup import iup_contour  # noqa: E402

OUT = os.path.join(HERE, '..', 'out')


def stencil_map(tags, sizes):
    """Index map per decomposed glyph: list of source point index, or (-1, a, b) for a synthesized midpoint."""
    out = []; b = 0
    for n in sizes:
        t = tags[b:b + n]
        k = next((i for i, v in enumerate(t) if v == 0), None)
        if k is None:
            idx = [('mid', b + n - 1, b)] + [b + i for i in range(n)]
        else:
            idx = [b + (k + i) % n for i in range(n)]
        idx.append(idx[0])  # wrap point
        out += idx; b += n
    return out


def gather(pts, m):
    res = []
    for e in m:
        if isinstance(e, tuple):
            a, c = pts[e[1]], pts[e[2]]; res.append(((a[0] + c[0]) // 2, (a[1] + c[1]) // 2))
        else:
            res.append(tuple(pts[e]))
    return res


def main():
    key, path, which = sys.argv[1:4]
    data = V.load_tt(path, which)
    ks = f'{key}-{which}'
    idx = json.load(open(os.path.join(OUT, f'inst-{ks}.json')))
    blob = np.fromfile(os.path.join(OUT, f'inst-{ks}.bin'), np.int16)
    NV, DP, G = idx['varpoints'], idx['decomposed'], idx['glyphs']
    per = 2 * NV + 2 * DP + 4 * G
    dbase = idx['dbase']
    # decomposed tags / contour sizes per glyph
    dtags = []; dsizes = []
    for m in data['models']:
        if m[0] == 'simple':
            dtags.append([t for c in m[1] for *_, t in c]); dsizes.append([len(c) for c in m[1]])
        elif m[0] == 'composite':
            tg = []; sz = []
            for gid, *_ in m[1]:
                mm = data['models'][gid]
                if mm[0] == 'simple': tg += [t for c in mm[1] for *_, t in c]; sz += [len(c) for c in mm[1]]
            dtags.append(tg); dsizes.append(sz)
        else:
            dtags.append([]); dsizes.append([])
    maps = [stencil_map(t, s) for t, s in zip(dtags, dsizes)]
    rot = sum(1 for m in data['models'] if m[0] == 'simple' for c in m[1] if c[0][2] != 0)
    allo = sum(1 for m in data['models'] if m[0] == 'simple' for c in m[1] if all(t != 0 for *_, t in c))
    ncont = sum(len(m[1]) for m in data['models'] if m[0] == 'simple')
    drot = sum(1 for t, s in zip(dtags, dsizes) for b, n in zip(np.cumsum([0] + s[:-1]), s) if t[b] != 0)
    dcont = sum(len(s) for s in dsizes)
    # 2. IUP rotation invariance on every sparse simple-glyph tuple
    worst = 0.0; tested = 0
    for g, m in enumerate(data['models']):
        if m[0] != 'simple': continue
        coords = V.base_coords(m)
        for tup in data['tuples'][g]:
            if None not in tup[1]: continue
            st = 0
            for e in data['ends'][g]:
                d = tup[1][st:e + 1]; c = coords[st:e + 1]; n = len(d)
                ref = np.array(iup_contour(d, c), np.float64)
                for k in (1, n // 2, n - 1):
                    if n < 2: break
                    rd = d[k:] + d[:k]; rc = c[k:] + c[:k]
                    if all(v is None for v in rd): continue
                    r = np.array(iup_contour(rd, rc), np.float64)
                    worst = max(worst, float(np.abs(np.roll(r, k, 0) - ref).max())); tested += 1
                st = e + 1
    # 3/4. order of operations per location
    rows = []
    for e in idx['index']:
        if e['variant'] != 'sparse, IUP at load to f64, f64 scalar': continue
        li = e['loc']
        r = V.reference_instance(path, which, idx['locations'][li])
        o = e['offset'] // 2
        a = blob[o:o + per].astype(np.int64)
        dx, dy = a[2 * NV:2 * NV + DP], a[2 * NV + DP:2 * NV + 2 * DP]
        ok_direct = ok_gather = 0; wrong = 0; slots = 0
        dflt = V.reference_instance(path, which, {})
        for g in range(G):
            if not maps[g]: continue
            pts = list(zip(dx[dbase[g]:dbase[g + 1]].tolist(), dy[dbase[g]:dbase[g + 1]].tolist()))
            ft = [tuple(p) for p in r['decomposed'][g]]
            s_ft = gather(ft, stencil_map(dtags[g], dsizes[g]))  # stencil built from the fontTools instance
            s_g = gather(pts, maps[g])                          # Wasm instance through the default-built map
            ok_direct += s_ft == s_g
            # wrong order: deltas in stream order added to the stencil buffer's slots without the map
            base_st = gather([tuple(p) for p in dflt['decomposed'][g]], maps[g])
            dlt = [(p[0] - q[0], p[1] - q[1]) for p, q in zip(ft, dflt['decomposed'][g])]
            naive = [(b[0] + dlt[i][0], b[1] + dlt[i][1]) if i < len(dlt) else b for i, b in enumerate(base_st)]
            wrong += sum(1 for p, q in zip(naive, s_ft) if p != q); slots += len(s_ft)
        rows.append(dict(loc=idx['locations'][li], glyphs_stencil_equal=ok_direct, wrong_order_mismatching_slots=wrong, slots=slots))
    nglyph = sum(1 for m in maps if m)
    print(f'{ks}: simple contours {ncont}, rotated (first point off-curve) {rot}, all-off-curve {allo}; decomposed contours {dcont}, rotated {drot}; wrap points {dcont}')
    print(f'  IUP rotation invariance: {tested} rotated contour tuples, max |diff| {worst}')
    for r in rows:
        print(f"  {json.dumps(r['loc']):50s} stencil(Wasm instance via default map) == stencil(fontTools instance): {r['glyphs_stencil_equal']}/{nglyph} glyphs;"
              f" wrong order (no map): {r['wrong_order_mismatching_slots']}/{r['slots']} slots differ")
    json.dump(dict(contours=ncont, rotated=rot, all_off=allo, decomposed_contours=dcont, decomposed_rotated=drot,
                   iup_tests=tested, iup_max_diff=worst, rows=rows, glyphs=nglyph), open(os.path.join(OUT, f'pointorder-{ks}.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
