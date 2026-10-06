"""CFF2 reference sizes: the CFF2 table as stored, dehinted, dehinted + desubroutinized; and the exact cubic
point model in our stream (default cubic points as triplets + per-region cubic point deltas, region masters
default + one region's blend deltas, so exact), to separate the cost of the point-delta format from the cost of
the quadratic conversion. Usage: cff2_cubic.py <font.otf> <latin|full>"""
import sys, os, io, gzip
import numpy as np, brotli
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import vmodel as V, venc as D, enc as E, cff2 as C  # noqa: E401,E402
from fontTools.ttLib import TTFont
from fontTools import subset
def sz(b): return [len(b), len(gzip.compress(b, 9)), len(brotli.compress(b, quality=11, lgwin=24))]
path, which = sys.argv[1:3]
font = V.open_set(path, which)
print('CFF2 as stored', sz(font.getTableData('CFF2')))
for desub in (False, True):
    f = V.open_set(path, which); o = subset.Options(); o.hinting = False; o.desubroutinize = desub; o.notdef_outline = True
    o.layout_features = ['*']; o.name_IDs = ['*']; o.glyph_names = True
    s = subset.Subsetter(o); s.populate(glyphs=f.getGlyphOrder()); s.subset(f)
    bio = io.BytesIO(); f.save(bio); bio.seek(0); f = TTFont(bio)
    print('CFF2 dehinted' + (' + desubroutinized' if desub else ''), sz(f.getTableData('CFF2')))
names = font.getGlyphOrder()
recs, regs = C.recordings(font, names, 'A')
models = []; tuples = []
for n in names:
    per = []
    for rec in recs[n]:
        pts = []; cont = []
        for op, args in rec:
            if op == 'moveTo': cont = [(args[0], 0)]; pts.append(cont)
            elif op == 'lineTo': cont.append((args[0], 0))
            elif op == 'curveTo': cont += [(args[0], 2), (args[1], 2), (args[2], 0)]
            elif op in ('closePath', 'endPath'): pass
        per.append(pts)
    # drop a closing duplicate only when every master has it
    for ci in range(len(per[0])):
        if len(per[0][ci]) > 1 and all(m[ci][-1][0] == m[ci][0][0] for m in per):
            for m in per: m[ci].pop()
    keep = [ci for ci in range(len(per[0])) if len(per[0][ci]) > 1]
    if not keep: models.append(('empty',)); tuples.append([]); continue
    base = [[(int(round(p[0])), int(round(p[1])), t) for p, t in per[0][ci]] for ci in keep]
    models.append(('simple', base))
    P0 = np.array([q[:2] for c in base for q in c], np.int64)
    tl = []
    for r in range(1, len(per)):
        Pr = np.array([(int(round(p[0])), int(round(p[1]))) for ci in keep for p, _ in per[r][ci]], np.int64)
        d = Pr - P0
        if np.any(d): tl.append((r - 1, [tuple(map(int, v)) for v in d]))
    tuples.append(tl)
axes, avar = V.axes_avar(font)
data = dict(names=names, models=models, tuples=tuples, regions=regs, axes=axes, avar=avar, ends=[[] for _ in names])
f = E.Flat(models)
print('cubic points', f.points, 'base triplets (cubic, exact)', sz(b''.join(E.triplets(f).values())))
for coder in ('tripz', 'i8esc', 'varint'):
    for pred in ('raw', 'prev'):
        print(f'cubic deltas {coder} {pred}', sz(b''.join(D.delta_streams(data, 'dense', 'region', coder, pred).values())))
pm = []
for lst in tuples:
    if not lst: continue
    ds = [D.predict(d, 'prev') for r, d in sorted(lst, key=lambda t: t[0])]
    pm.append([ds[t][i] for i in range(len(ds[0])) for t in range(len(ds))])
hdr = E.varint([len(lst) for lst in tuples]) + E.varint([t[0] for lst in tuples for t in sorted(lst, key=lambda t: t[0])])
for coder in ('tripz', 'varint'):
    print(f'cubic deltas point-major {coder} prev', sz(hdr + b''.join(D.code_values(pm, coder).values())))
