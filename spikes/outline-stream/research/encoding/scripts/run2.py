"""Second-round candidates: WOFF2-style triplets, 1-bit flags for cubics, contour dedup.
Usage: run2.py <key> <font> <latin|full> <mode>"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model as M, enc as E
from run import sizes, cat  # noqa

key, path, which, mode = sys.argv[1:5]
uni = M.LATIN if which == 'latin' else None
names, models, _ = M.load(path, uni, mode)
f = E.Flat(models)
rows = []
for name, planes in (('planes varint xy-interleaved (ref)', E.planes(f, xy='interleave')),
                     ('  + 1-bit on/off flags', E.planes_onoff(f)),
                     ('WOFF2-style triplets', E.triplets(f))):
    rows.append((name, mode, *sizes(cat(planes))))
d, st = E.dedup_contours(f)
rows.append(('  + contour dedup (back-refs)', mode, *sizes(cat(d))))
for r in rows: print(f'{key}-{which} {r[0]:36s} {r[1]:10s} raw={r[2]:9d} gz={r[3]:9d} br={r[4]:9d}')
print(f'{key}-{which} dedup stats {st}')
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'results', f'{key}-{which}-{mode}-r2.json')
json.dump({'rows': rows, 'dedup': st}, open(out, 'w'))
