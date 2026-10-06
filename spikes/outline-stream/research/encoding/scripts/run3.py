"""Third-round candidates: maintainer's bp16 proposal, StreamVByte planes, implied-point ablation, GPU stencil.

Usage: run3.py <key> <font> <latin|full> [modes...]   -> results/<key>-<set>-r3.json
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import model as M, enc as E, enc3 as E3
from run import sizes, cat

key, path, which = sys.argv[1:4]
uni = M.LATIN if which == 'latin' else None
from fontTools.ttLib import TTFont
is_tt = 'glyf' in TTFont(path)
modes = sys.argv[4:] or (['tt-keep', 'tt-dec'] if is_tt else ['cff-cubic', 'cff-q0.5', 'cff-q1', 'cff-q2'])
rows = []; stats = {}
for mode in modes:
    t0 = time.time()
    names, models, _ = M.load(path, uni, mode)
    f = E.Flat(models)
    cand = OrderedDict = {}
    cand['planes varint, xy interleaved'] = E.planes(f, xy='interleave')
    cand['WOFF2-style triplets'] = E.triplets(f)
    cand['StreamVByte planes (2-bit len ctrl)'] = E3.svb(f)
    if not f.cubic:
        eo, _v = E3.explicit_on(f)
        cand['implied on-curves explicit, no line ctrl'] = eo
        q = E.explicit_quads(f)
        cand['explicit 2n+1 varint (#244 shape)'] = E.explicit_stream(f, q)
        cand['explicit 2n+1, split planes'] = E3.explicit_planes(f, q)
    if not f.comps:
        cand['bp16 maintainer proposal (per-glyph blocks)'] = E3.bp16(f, True)
        cand['bp16, blocks across glyphs'] = E3.bp16(f, False)
        if not f.cubic:
            st, s = E3.stencil(f)
            s['curves_per_point'] = s['curves'] / max(1, s['points'])
            s['bytes_per_curve'] = len(cat(st)) / max(1, s['curves'])
            stats[mode] = s
            cand['GPU stencil i16 (tag in x bit0, wrap pt)'] = st
    for name, planes in cand.items():
        b = cat(planes)
        rows.append((name, mode, *sizes(b)))
        print(f'{key}-{which} {name[:44]:44s} {mode:9s} raw={rows[-1][2]:9d} gz={rows[-1][3]:9d} br={rows[-1][4]:9d}', flush=True)
    print(f'# {mode} done {time.time()-t0:.1f}s {stats.get(mode, "")}', file=sys.stderr, flush=True)
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'results', f'{key}-{which}-r3.json')
json.dump({'rows': rows, 'stencil': stats}, open(out, 'w'), indent=1)
