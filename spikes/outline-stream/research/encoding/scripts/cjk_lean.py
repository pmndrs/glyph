"""Lean measurement for the 16 MB full Noto Sans CJK font: source tables and the leading candidates only
(the per-contour Python loops of run.py's explicit/Slug-layout models take too long at 6M points).
Usage: cjk_lean.py <font>   -> results/cjk-full-lean.json"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model as M, enc as E, enc3 as E3
from run import sizes, cat

path = sys.argv[1]
font = M.open_font(path, None)
rows = [('source CFF', 'font table', *sizes(font.getTableData('CFF ')))]
print(rows[-1], flush=True)
stencil = {}; info = {}
for mode in ('cff-cubic', 'cff-q1'):
    t0 = time.time(); names, models, st = M.load(path, None, mode); f = E.Flat(models)
    info[mode] = dict(points=f.points, contours=int(len(f.cn)), on=int((f.t == 0).sum()))
    print(mode, 'loaded', f'{time.time()-t0:.0f}s', info[mode], flush=True)
    cand = {'planes varint, xy interleaved': E.planes(f, xy='interleave'), 'WOFF2-style triplets': E.triplets(f),
            'bp16 maintainer proposal (per-glyph blocks)': E3.bp16(f, True)}
    if mode != 'cff-cubic':
        s, stt = E3.stencil(f); stt['bytes_per_curve'] = len(cat(s)) / stt['curves']; stencil[mode] = stt
        cand['GPU stencil i16 (tag in x bit0, wrap pt)'] = s
    for k, v in cand.items():
        rows.append((k, mode, *sizes(cat(v)))); print(rows[-1], f'{time.time()-t0:.0f}s', flush=True)
json.dump({'rows': rows, 'stencil': stencil, 'info': info}, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'results', 'cjk-full-lean.json'), 'w'), indent=1)
