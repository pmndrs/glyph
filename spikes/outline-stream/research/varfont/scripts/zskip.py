"""Zero-skipping delta encodings (lossless; a skipped point's delta is exactly 0, not interpolated).
Usage: zskip.py tt <font> <latin|full>  |  zskip.py cff2 <model.pkl>
Region-major. Variants:
  dense       every point: triplets with the zero-pair flag, 'prev' prediction            (baseline)
  pairskip    per tuple a bitmap of points whose (dx, dy) != (0, 0); triplets + prev over those points
  axisskip    per tuple and axis a bitmap of nonzero coordinates; x values, then y values, zigzag varint + prev
For TrueType the input is the IUP-expanded dense deltas (rounded), so 'pairskip' is an exact alternative to IUP."""
import sys, os, pickle, gzip
import numpy as np, brotli
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import vmodel as V, venc as D, enc as E, cff2_emit  # noqa: E401,E402
def sz(b): return [len(b), len(gzip.compress(b, 9)), len(brotli.compress(b, quality=11, lgwin=24))]
if sys.argv[1] == 'tt':
    data = V.load_tt(sys.argv[2], sys.argv[3])
    seqs = {}
    for g, lst in enumerate(data['tuples']):
        for tup in lst: seqs.setdefault(tup[0], []).append(V.dense(data, g, tup))
else:
    data = cff2_emit.to_data(pickle.load(open(sys.argv[2], 'rb')))
    seqs = {}
    for g, lst in enumerate(data['tuples']):
        for r, d in lst: seqs.setdefault(r, []).append(d)
order = [s for r in sorted(seqs) for s in seqs[r]]
nz_pairs = sum(1 for s in order for p in s if p != (0, 0)); tot = sum(len(s) for s in order)
nz_coords = sum(1 for s in order for p in s for c in p if c)
print(f'tuples {len(order)}, slots {tot}, nonzero pairs {nz_pairs} ({nz_pairs/tot:.1%}), nonzero coordinates {nz_coords} ({nz_coords/(2*tot):.1%})')
dense = b''.join(D.code_values([D.predict(s, 'prev') for s in order], 'tripz').values())
bm = bytearray(); vals = []
for s in order:
    bm += np.packbits(np.array([p != (0, 0) for p in s], np.uint8), bitorder='little').tobytes()
    vals.append(D.predict([p for p in s if p != (0, 0)], 'prev'))
pairskip = bytes(bm) + b''.join(D.code_values(vals, 'tripz').values())
bx = bytearray(); by = bytearray(); xs = []; ys = []
for s in order:
    a = np.array(s, np.int64).reshape(-1, 2)
    for k, bb, out in ((0, bx, xs), (1, by, ys)):
        nz = a[:, k] != 0
        bb += np.packbits(nz.astype(np.uint8), bitorder='little').tobytes()
        v = a[nz, k]; out.append(np.diff(np.concatenate([[0], v])))
axisskip = bytes(bx) + bytes(by) + E.varint(E.zig(np.concatenate(xs) if xs else np.zeros(0, np.int64))) + E.varint(E.zig(np.concatenate(ys) if ys else np.zeros(0, np.int64)))
for lab, b in (('dense tripz prev', dense), ('pairskip tripz prev', pairskip), ('axisskip varint prev', axisskip)):
    print(f'{lab:24s} raw/gzip/brotli {sz(b)}')
# ---- point-major interleaving: per glyph, per point, every tuple's (prev-predicted) delta, tuples in region order
pm = []
for g, lst in enumerate(data['tuples']):
    if not lst: continue
    if sys.argv[1] == 'tt':
        ds = [D.predict(V.dense(data, g, tup), 'prev') for tup in sorted(lst, key=lambda t: t[0])]
    else:
        ds = [D.predict(d, 'prev') for r, d in sorted(lst, key=lambda t: t[0])]
    n = len(ds[0])
    pm.append([ds[t][i] for i in range(n) for t in range(len(ds))])
pmb = b''.join(D.code_values(pm, 'tripz').values())
pmv = b''.join(D.code_values(pm, 'varint').values())
hdr = E.varint([len(lst) for lst in data['tuples']]) + E.varint([t[0] for lst in data['tuples'] for t in sorted(lst, key=lambda t: t[0])])
print(f'{"pointmajor tripz prev":24s} raw/gzip/brotli {sz(hdr + pmb)}')
print(f'{"pointmajor varint prev":24s} raw/gzip/brotli {sz(hdr + pmv)}')
