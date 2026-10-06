"""Q5/Q2/Q7 verification: Wasm instancer output (out/inst-<key>-<set>.bin from bench.mjs) against
fontTools.varLib.instancer full instances at the same user locations.

Usage: verify.py <key> <font> <latin|full> [procs]
Per location and variant: mismatching coordinates (own var points = simple points + component offsets, and
decomposed points with composites expanded), max |difference|, ink-bounds mismatches. Writes out/verify-<key>-<set>.json.
"""
import sys, os, json
import numpy as np
from multiprocessing import Pool
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import vmodel as V  # noqa: E402

OUT = os.path.join(HERE, '..', 'out')


def ref(args):
    path, which, loc = args
    return V.reference_instance(path, which, loc)


def main():
    key, path, which = sys.argv[1:4]
    procs = int(sys.argv[4]) if len(sys.argv) > 4 else 4
    ks = f'{key}-{which}'
    idx = json.load(open(os.path.join(OUT, f'inst-{ks}.json')))
    blob = np.fromfile(os.path.join(OUT, f'inst-{ks}.bin'), np.int16)
    NV, DP, G = idx['varpoints'], idx['decomposed'], idx['glyphs']
    locs = idx['locations']
    with Pool(procs) as p:
        refs = p.map(ref, [(path, which, l) for l in locs])
    data = V.load_tt(path, which)
    out = []
    per = 2 * NV + 2 * DP + 4 * G
    for li, r in enumerate(refs):
        own = np.array([q for g in r['own'] for q in g], np.int64).reshape(-1, 2)
        dec = np.array([q for g in r['decomposed'] for q in g], np.int64).reshape(-1, 2)
        assert len(own) == NV and len(dec) == DP, (len(own), NV, len(dec), DP)
        rb = np.array([b if b is not None else (0, 0, 0, 0) for b in r['bounds']], np.int64)
        isc = np.array([m[0] == 'composite' for m in data['models']])
        for e in idx['index']:
            if e['loc'] != li: continue
            o = e['offset'] // 2
            a = blob[o:o + per].astype(np.int64)
            ox, oy = a[:NV], a[NV:2 * NV]; dx, dy = a[2 * NV:2 * NV + DP], a[2 * NV + DP:2 * NV + 2 * DP]
            bb = a[2 * NV + 2 * DP:].reshape(-1, 4)
            d_own = np.abs(np.stack([ox, oy], 1) - own); d_dec = np.abs(np.stack([dx, dy], 1) - dec)
            bmis = np.any(bb != rb, 1)
            row = dict(loc=locs[li], variant=e['variant'],
                       own_coords=int(d_own.size), own_mismatch=int((d_own != 0).sum()), own_max=int(d_own.max()),
                       dec_coords=int(d_dec.size), dec_mismatch=int((d_dec != 0).sum()), dec_max=int(d_dec.max()),
                       bounds_mismatch_simple=int((bmis & ~isc).sum()), bounds_mismatch_composite=int((bmis & isc).sum()),
                       bounds_max=int(np.abs(bb - rb).max()))
            out.append(row)
            print(f"{json.dumps(locs[li]):60s} {e['variant']:40s} own {row['own_mismatch']}/{row['own_coords']} (max {row['own_max']})"
                  f"  decomposed {row['dec_mismatch']}/{row['dec_coords']} (max {row['dec_max']})  bounds simple/composite {row['bounds_mismatch_simple']}/{row['bounds_mismatch_composite']}")
    json.dump(out, open(os.path.join(OUT, f'verify-{ks}.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
